/**
 * Sprint 5.1 — Procurement Process Service
 *
 * Orquestra o ciclo do Processo Licitatório e a GERAÇÃO de documentos (ETP, TR,
 * Edital) como consequência do fluxo — nunca o contrário. Toda inferência usa o
 * Kernel (RAG + copilotos) exclusivamente via kernelAccessService. Documentos são
 * rascunhos fundamentados que o servidor REVISA. Degrada graciosamente sem DB.
 */

import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { assertKernelAccess } from "./kernelAccessService";
import { generateOfficialDocument } from "./documentEngineService";
import { orchestrateMultiCopilot } from "./workspaceOrchestratorService";
import { checkIdempotency, saveIdempotencyResult, failIdempotencyKey } from "./idempotencyService";
import { DOMAIN_COPILOTS } from "../domain/procurementProcess";
import {
  buildDFDDraft,
  createGeneratedDocument,
  defaultPresencialJustification,
  validateEdital,
  type GeneratedDocument,
  type DocumentKind,
  type EditalModality,
  type EditalForm,
  type EditalPlatform,
} from "../domain/generatedDocument";
import { computeLineageId } from "../domain/officialDocument";
import { getDb } from "../db/connection";
import { insertGeneratedDocument, recordProcessEvent, listIntelligentItems, type ProcurementExecutor } from "../db/procurement";

const DOMAIN = "processo_licitatorio" as const;

// ─── C.4A — Replay-safe generation contract ───────────────────────────────────
// Toda geração documental canônica é idempotente por (org, user, idempotencyKey). O commit documental
// (generated_document + official_document + timeline + evento de processo + marcação da idempotency key
// como COMPLETED) ocorre numa ÚNICA transação → rollback = nada persistido; e é IMPOSSÍVEL o cenário
// "official commitado + idempotency failed". A cognição (rede/modelo) roda SEMPRE FORA da transação.
const GENERATE_OP = "procurement.document.generate";

/**
 * Assinatura determinística de UM item aprovado — apenas campos do domínio atual
 * (`listIntelligentItems`) que podem influenciar a geração do ETP/TR. NÃO existe CATSER no
 * domínio de itens inteligentes hoje (só CATMAT), então não é fabricado aqui.
 */
export type ApprovedItemSignature = {
  id: string;
  description?: string;
  quantity?: number;
  unit?: string;
  averagePrice?: number;
  suggestedCATMAT?: string | null;
  status?: string;
};

/**
 * Snapshot determinístico e ORDENADO dos itens aprovados: não hasheia só IDs, mas os campos
 * relevantes (descrição, quantidade, unidade, preço médio, CATMAT sugerido, status). Ordena por
 * id para independer da ordem de leitura. Assim, alterar um campo relevante de um item muda o
 * payloadHash (→ CONFLICT quando aplicável), enquanto a mera reordenação dos mesmos itens não muda.
 */
function approvedItemsSignature(items: ApprovedItemSignature[]): Array<Record<string, unknown>> {
  return items
    .map((i) => ({
      id: i.id,
      d: (i.description ?? "").trim(),
      q: i.quantity ?? null,
      u: (i.unit ?? "").trim(),
      pr: i.averagePrice ?? null,
      cm: i.suggestedCATMAT ?? null,
      st: i.status ?? null,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Hash determinístico do payload lógico (sem correlationId/timestamps/aleatórios). Coleções ordenadas. */
export function generatePayloadHash(p: {
  organizationId: number; processId: string; kind: DocumentKind; object: string;
  approvedItems?: ApprovedItemSignature[]; modality?: string; form?: string; platform?: string | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      op: GENERATE_OP,
      o: p.organizationId,
      p: p.processId,
      k: p.kind,
      obj: (p.object ?? "").trim(),
      items: approvedItemsSignature(p.approvedItems ?? []),
      m: p.modality ?? null,
      f: p.form ?? null,
      pl: p.platform ?? null,
    }))
    .digest("hex");
}

/**
 * C.4A — Correspondência de LINHAGEM determinística (pura, testável, SEM nova coluna neste fase).
 * Formaliza o mapeamento (org + processId + kind) → identidade do generated_document → identidade
 * de linhagem do official_document. Reutiliza EXATAMENTE as mesmas primitivas do pipeline
 * (createGeneratedDocument para o id do rascunho; computeLineageId para a linhagem oficial) — não
 * há segunda fórmula que possa divergir. A reconciliação física é C.4B; aqui apenas o contrato.
 */
export function canonicalDocumentIdentity(p: {
  organizationId: number; processId: string; kind: DocumentKind;
}): { generatedId: string; lineageId: string } {
  const generatedId = createGeneratedDocument({
    organizationId: p.organizationId, processId: p.processId, kind: p.kind,
    title: "", correlationId: "identity", // id NÃO depende de title/correlationId — só de (org, processId, kind)
  }).id;
  const lineageId = computeLineageId({
    tenantId: p.organizationId, businessDomain: DOMAIN, documentType: p.kind, origin: p.processId,
  });
  return { generatedId, lineageId };
}

/**
 * Executa uma operação de geração documental de forma replay-safe. `produce` roda a parte cognitiva/
 * determinística FORA da transação e devolve `{ persist, response }`; `persist(tx)` grava todos os
 * efeitos documentais na transação; `saveIdempotencyResult` marca a chave COMPLETED na MESMA transação.
 * Replay (mesma chave+payload) → resposta cacheada, sem reexecutar cognição/persistência.
 */
async function runReplaySafeGeneration<T>(
  ctx: { organizationId: number; actorUserId: number; idempotencyKey: string; payloadHash: string },
  reviveCached: (raw: unknown) => T,
  produce: () => Promise<{ persist: (tx: ProcurementExecutor) => Promise<void>; response: T }>,
): Promise<{ result: T; replayed: boolean }> {
  const check = await checkIdempotency(ctx.idempotencyKey, ctx.actorUserId, ctx.organizationId, GENERATE_OP, ctx.payloadHash);
  if (check.status === "completed") {
    if (check.payloadMismatch) {
      throw new TRPCError({ code: "CONFLICT", message: "Idempotency-Key reutilizada com payload diferente — geração recusada." });
    }
    return { result: reviveCached(check.response), replayed: true };
  }
  if (check.status === "processing") {
    throw new TRPCError({ code: "CONFLICT", message: "Geração idêntica já está em processamento para esta chave — aguarde a conclusão." });
  }
  // status "new" ou "failed": executa (cognição fora da transação; persistência atômica dentro).
  try {
    const { persist, response } = await produce();
    const db = await getDb();
    if (!db) return { result: response, replayed: false }; // sem DB: degrada sem persistir (nem idempotência)
    await db.transaction(async (tx) => {
      await persist(tx);
      await saveIdempotencyResult(ctx.idempotencyKey, ctx.actorUserId, ctx.organizationId, response, tx);
    });
    return { result: response, replayed: false };
  } catch (err) {
    await failIdempotencyKey(ctx.idempotencyKey, ctx.actorUserId, ctx.organizationId);
    throw err;
  }
}

/**
 * "Criar DFD do zero" (production-ready mínimo): estrutura um RASCUNHO editável do
 * DFD (art. 12, §1º) e persiste como documento canônico (kind "dfd", status
 * "rascunho"). NÃO usa Kernel/IA (template determinístico) — a geração assistida
 * por IA plena fica como evolução. Supervisão humana: sempre rascunho, nunca
 * aprovação automática. Idempotente: id determinístico por (processo, kind) →
 * retry não duplica.
 */
export async function generateDFDDraft(params: {
  organizationId: number; processId: string; object: string; correlationId: string;
  idempotencyKey: string; actorUserId: number;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  const payloadHash = generatePayloadHash({ organizationId: params.organizationId, processId: params.processId, kind: "dfd", object: params.object });
  const { result, replayed } = await runReplaySafeGeneration<GeneratedDocument>(
    { organizationId: params.organizationId, actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, payloadHash },
    (raw) => raw as GeneratedDocument,
    async () => {
      const doc = createGeneratedDocument({
        processId: params.processId, organizationId: params.organizationId,
        kind: "dfd", title: `DFD — ${params.object}`,
        content: buildDFDDraft(params.object),
        sources: ["estrutura:art_12_par_1_lei_14133"],
        authorUserId: params.actorUserId,
        correlationId: params.correlationId,
      });
      return {
        response: doc,
        persist: async (tx) => {
          await insertGeneratedDocument(doc, tx);
          await recordProcessEvent({
            organizationId: params.organizationId, processId: params.processId, eventType: "change",
            actor: "sistema", summary: "DFD criado (rascunho estruturado).", refId: doc.id,
            correlationId: params.correlationId,
          }, tx);
        },
      };
    },
  );
  return { document: result, replayed };
}

/** Salva a edição do rascunho de DFD (mantém status rascunho; atualiza conteúdo). */
export async function saveDFDDraft(params: {
  organizationId: number; processId: string; object: string; content: string; correlationId: string;
}): Promise<GeneratedDocument> {
  const doc = createGeneratedDocument({
    processId: params.processId, organizationId: params.organizationId,
    kind: "dfd", title: `DFD — ${params.object}`,
    content: params.content,
    sources: ["edicao_manual"],
    correlationId: params.correlationId,
  });
  await insertGeneratedDocument(doc); // onDuplicateKeyUpdate → atualiza conteúdo do mesmo documento
  await recordProcessEvent({
    organizationId: params.organizationId, processId: params.processId, eventType: "change",
    actor: String(params.organizationId), summary: "DFD salvo (rascunho).", refId: doc.id,
    correlationId: params.correlationId,
  });
  return doc;
}

/**
 * Gera um documento (ETP/TR) a partir do fluxo: aciona os copilotos do domínio
 * (Planejamento, TR Intelligence, Pesquisa de Preços, Jurídico, Agente de
 * Contratação) via Multi-Copilot Orchestrator e consolida um rascunho fundamentado.
 */
export async function generateDocument(params: {
  organizationId: number;
  processId: string;
  kind: Exclude<DocumentKind, "edital">;
  object: string;
  correlationId: string;
  idempotencyKey: string;
  actorUserId: number;
  invoke?: (prompt: string) => Promise<string>;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  // Regra de arquitetura: acesso ao Kernel só via kernelAccessService.
  assertKernelAccess(DOMAIN, "institutional_rag");
  assertKernelAccess(DOMAIN, "copilot_infrastructure");

  const items = await listIntelligentItems(params.processId, params.organizationId);
  const approved = items.filter(i => i.status === "aprovado");

  // Assinatura determinística dos itens aprovados (campos relevantes, não só IDs) → alterar um item
  // aprovado relevante muda o payloadHash e, sob a mesma chave, resulta em CONFLICT.
  const payloadHash = generatePayloadHash({
    organizationId: params.organizationId, processId: params.processId, kind: params.kind,
    object: params.object, approvedItems: approved,
  });

  const { result, replayed } = await runReplaySafeGeneration<GeneratedDocument>(
    { organizationId: params.organizationId, actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, payloadHash },
    (raw) => raw as GeneratedDocument,
    async () => {
      const request = params.kind === "tr"
        ? `Elaborar Termo de Referência para "${params.object}" com base em ${approved.length} item(ns) inteligente(s) aprovado(s), CATMAT, especificações e histórico.`
        : `Elaborar Estudo Técnico Preliminar (ETP) para "${params.object}" com fundamentação da necessidade, alternativas e riscos.`;

      // Cognição SEMPRE fora da transação (rede/modelo).
      const orchestration = await orchestrateMultiCopilot({
        organizationId: params.organizationId,
        request,
        copilotTypes: DOMAIN_COPILOTS,
        correlationId: params.correlationId,
        invoke: params.invoke,
      });

      const content = [
        `# ${params.kind === "tr" ? "Termo de Referência" : "Estudo Técnico Preliminar"} — ${params.object}`,
        orchestration.consolidated.summary,
        "",
        "## Sugestões consolidadas",
        ...orchestration.consolidated.suggestions.map(s => `- ${s}`),
        "",
        "## Base legal",
        ...orchestration.consolidated.legalBasis.map(l => `- ${l}`),
        "",
        "> Rascunho gerado a partir do fluxo. Revisão obrigatória pelo servidor competente.",
      ].join("\n");

      const doc = createGeneratedDocument({
        organizationId: params.organizationId,
        processId: params.processId,
        kind: params.kind,
        title: `${params.kind.toUpperCase()} — ${params.object}`,
        content,
        sources: [`itens_aprovados:${approved.length}`, `copilotos:${orchestration.selectedCopilots.join(",")}`],
        authorUserId: params.actorUserId,
        correlationId: params.correlationId,
      });

      return {
        response: doc,
        persist: async (tx) => {
          await insertGeneratedDocument(doc, tx);
          // RC-3 — documento oficial pelo pipeline ÚNICO (Document Engine), na MESMA transação.
          await generateOfficialDocument({
            organizationId: params.organizationId, businessDomain: DOMAIN, documentType: params.kind,
            origin: params.processId, title: doc.title, content, author: "multi_copilot", correlationId: params.correlationId,
            metadata: { copilots: orchestration.selectedCopilots, legalBasis: orchestration.consolidated.legalBasis, approvedItems: approved.length },
          }, tx);
          await recordProcessEvent({
            organizationId: params.organizationId, processId: params.processId, eventType: "recommendation",
            actor: "multi_copilot", summary: `${params.kind.toUpperCase()} gerado (rascunho) a partir de ${approved.length} item(ns).`,
            refId: doc.id, correlationId: params.correlationId,
          }, tx);
        },
      };
    },
  );
  return { document: result, replayed };
}

/**
 * Gera o Edital após aprovação do TR. Presencial exige justificativa legal
 * automática; eletrônico exige plataforma. Valida antes de persistir.
 */
export async function generateNotice(params: {
  organizationId: number;
  processId: string;
  object: string;
  modality: EditalModality;
  form: EditalForm;
  platform?: EditalPlatform;
  correlationId: string;
  idempotencyKey: string;
  actorUserId: number;
}): Promise<{ document: GeneratedDocument; validation: { valid: boolean; violations: string[] }; replayed: boolean }> {
  assertKernelAccess(DOMAIN, "document_engine");

  const legalJustification = params.form === "presencial"
    ? defaultPresencialJustification(params.modality)
    : "";

  // Determinístico e puro (sem DB): monta o rascunho e valida ANTES de reservar idempotência.
  const doc = createGeneratedDocument({
    organizationId: params.organizationId,
    processId: params.processId,
    kind: "edital",
    title: `Edital — ${params.object}`,
    content: `# Edital — ${params.object}\nModalidade: ${params.modality} | Forma: ${params.form}${params.platform ? ` | Plataforma: ${params.platform}` : ""}\n\n> Templates, cláusulas e cronograma aplicados conforme a modalidade. Revisão obrigatória.`,
    sources: ["tr_aprovado"],
    modality: params.modality,
    form: params.form,
    platform: params.form === "eletronico" ? (params.platform ?? null) : null,
    legalJustification,
    authorUserId: params.actorUserId,
    correlationId: params.correlationId,
  });
  const validation = validateEdital(doc);
  // Edital inválido: nenhum efeito, nenhuma reserva de idempotência (determinístico — retry livre).
  if (!validation.valid) {
    return { document: doc, validation, replayed: false };
  }

  const payloadHash = generatePayloadHash({
    organizationId: params.organizationId, processId: params.processId, kind: "edital",
    object: params.object, modality: params.modality, form: params.form, platform: params.platform ?? null,
  });

  const { result, replayed } = await runReplaySafeGeneration<{ document: GeneratedDocument; validation: { valid: boolean; violations: string[] } }>(
    { organizationId: params.organizationId, actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, payloadHash },
    (raw) => raw as { document: GeneratedDocument; validation: { valid: boolean; violations: string[] } },
    async () => ({
      response: { document: doc, validation },
      persist: async (tx) => {
        await insertGeneratedDocument(doc, tx);
        // RC-3 — documento oficial pelo pipeline ÚNICO (Document Engine), na MESMA transação.
        await generateOfficialDocument({
          organizationId: params.organizationId, businessDomain: DOMAIN, documentType: "edital",
          origin: params.processId, title: doc.title, content: doc.content, author: "sistema", correlationId: params.correlationId,
          metadata: { modality: params.modality, form: params.form, platform: params.platform ?? null },
        }, tx);
        await recordProcessEvent({
          organizationId: params.organizationId, processId: params.processId, eventType: "decision",
          actor: "sistema", summary: `Edital gerado: ${params.modality}/${params.form}.`, refId: doc.id,
          correlationId: params.correlationId,
        }, tx);
      },
    }),
  );
  return { ...result, replayed };
}

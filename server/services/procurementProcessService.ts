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
  draftContentHash,
  validateEdital,
  type GeneratedDocument,
  type DocumentKind,
  type EditalModality,
  type EditalForm,
  type EditalPlatform,
} from "../domain/generatedDocument";
import { computeLineageId } from "../domain/officialDocument";
import { getDb } from "../db/connection";
import {
  recordProcessEvent, listIntelligentItems, applyDraftContentMutationTx,
  getGeneratedDocumentByKind, type ProcurementExecutor,
} from "../db/procurement";

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
  // C.4B.3A — `persist` retorna o SNAPSHOT CANÔNICO persistido (usado como resposta E cache da
  // idempotência, na MESMA transação). `response` é apenas o fallback de degradação sem DB.
  produce: () => Promise<{ persist: (tx: ProcurementExecutor) => Promise<T>; response: T }>,
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
    let result: T = response;
    await db.transaction(async (tx) => {
      result = await persist(tx); // snapshot canônico persistido
      await saveIdempotencyResult(ctx.idempotencyKey, ctx.actorUserId, ctx.organizationId, result, tx);
    });
    return { result, replayed: false };
  } catch (err) {
    await failIdempotencyKey(ctx.idempotencyKey, ctx.actorUserId, ctx.organizationId);
    throw err;
  }
}

/** Normaliza a resposta cacheada da idempotência: objeto no MySQL 8 (JSON nativo), string no MariaDB
 *  (JSON = LONGTEXT). Garante que o replay reproduza o snapshot canônico em ambos. */
function reviveIdempotent<T>(raw: unknown): T {
  return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
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
    reviveIdempotent,
    async () => {
      // Estado de partida (sentinel explícito de ausência) revalidado sob lock na persistência.
      const before = await getGeneratedDocumentByKind(params.processId, params.organizationId, "dfd");
      const expectedState = before ? { type: "present" as const, contentHash: draftContentHash(before.content) } : { type: "absent" as const };
      const doc = createGeneratedDocument({
        processId: params.processId, organizationId: params.organizationId,
        kind: "dfd", title: `DFD — ${params.object}`,
        content: buildDFDDraft(params.object),
        sources: ["estrutura:art_12_par_1_lei_14133"],
        authorUserId: params.actorUserId,
        lastSubstantiveActorUserId: params.actorUserId,
        correlationId: params.correlationId,
      });
      return {
        response: doc,
        persist: async (tx) => {
          // Criação canônica com proveniência (author = originador; último ator substantivo = criador).
          const { document } = await applyDraftContentMutationTx(tx, {
            organizationId: params.organizationId, processId: params.processId, kind: "dfd",
            actorUserId: params.actorUserId, doc, operation: "ai_regenerate",
            expectedState, idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
          });
          await recordProcessEvent({
            organizationId: params.organizationId, processId: params.processId, eventType: "change",
            actor: "sistema", summary: "DFD criado (rascunho estruturado).", refId: doc.id,
            correlationId: params.correlationId,
          }, tx);
          return document;
        },
      };
    },
  );
  return { document: result, replayed };
}

// C.4B.3A — operação de EDIÇÃO MANUAL governada do DFD (write com proveniência).
const DFD_SAVE_OP = "procurement.dfd.save";

/**
 * C.4B.3A — Salva a edição MANUAL do rascunho de DFD como WRITE GOVERNADO (prova da fundação de
 * proveniência): ator humano do ctx, concorrência otimista (expectedContentHash revalidado sob lock),
 * PRESERVAÇÃO do originador (`author_user_id`), registro do último ator substantivo, ledger append-only
 * (`operation = dfd_manual_edit`) e timeline com o USUÁRIO real — tudo em UMA transação. Idempotente
 * (mesma chave+payload → replay sem novo ledger). DFD permanece fora do lifecycle de emissão.
 */
export async function saveDFDDraft(params: {
  organizationId: number; processId: string; object: string; content: string;
  actorUserId: number; expectedContentHash: string; idempotencyKey: string; correlationId: string;
}): Promise<{ document: GeneratedDocument; replayed: boolean }> {
  const payloadHash = createHash("sha256").update(JSON.stringify({
    op: DFD_SAVE_OP, o: params.organizationId, p: params.processId, k: "dfd",
    exp: params.expectedContentHash, h: draftContentHash(params.content),
  })).digest("hex");

  const doc = createGeneratedDocument({
    processId: params.processId, organizationId: params.organizationId,
    kind: "dfd", title: `DFD — ${params.object}`,
    content: params.content, sources: ["edicao_manual"],
    correlationId: params.correlationId,
  });

  const check = await checkIdempotency(params.idempotencyKey, params.actorUserId, params.organizationId, DFD_SAVE_OP, payloadHash);
  if (check.status === "completed") {
    if (check.payloadMismatch) {
      throw new TRPCError({ code: "CONFLICT", message: "Idempotency-Key reutilizada com conteúdo diferente — edição recusada." });
    }
    return { document: reviveIdempotent<GeneratedDocument>(check.response), replayed: true };
  }
  if (check.status === "processing") {
    throw new TRPCError({ code: "CONFLICT", message: "Uma edição idêntica já está em processamento para esta chave — aguarde a conclusão." });
  }

  // C.4B.3A (Blocker 1) — write GOVERNADO é fail-closed: sem persistência não há save/ledger/provenance
  // /idempotência; NUNCA retornar sucesso simulado. Recusa explícita.
  const db = await getDb();
  if (!db) {
    await failIdempotencyKey(params.idempotencyKey, params.actorUserId, params.organizationId).catch(() => {});
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Persistência indisponível — edição do DFD recusada (nada salvo)." });
  }

  try {
    // Edição humana exige rascunho EXISTENTE cujo hash corresponda ao carregado (estado de partida).
    const expectedState = { type: "present" as const, contentHash: params.expectedContentHash };
    let persisted: GeneratedDocument = doc;
    await db.transaction(async (tx) => {
      const { document } = await applyDraftContentMutationTx(tx, {
        organizationId: params.organizationId, processId: params.processId, kind: "dfd",
        actorUserId: params.actorUserId, doc, operation: "dfd_manual_edit",
        expectedState, idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
      });
      persisted = document;
      await recordProcessEvent({
        organizationId: params.organizationId, processId: params.processId, eventType: "change",
        actor: String(params.actorUserId), summary: "DFD salvo (rascunho).", refId: doc.id,
        correlationId: params.correlationId,
      }, tx);
      // Cacheia o SNAPSHOT CANÔNICO (originador preservado) — resposta = cache = estado persistido.
      await saveIdempotencyResult(params.idempotencyKey, params.actorUserId, params.organizationId, persisted, tx);
    });
    return { document: persisted, replayed: false };
  } catch (err) {
    await failIdempotencyKey(params.idempotencyKey, params.actorUserId, params.organizationId);
    throw err;
  }
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
    reviveIdempotent,
    async () => {
      // C.4B.3A — captura o estado de PARTIDA ANTES da cognição (sentinel de ausência explícito). Se o
      // rascunho mudar enquanto a IA executa, a revalidação sob lock na persistência recusa (CONFLICT)
      // e NÃO sobrescreve a alteração concorrente. 1ª geração: ausência esperada.
      const before = await getGeneratedDocumentByKind(params.processId, params.organizationId, params.kind);
      const expectedState = before ? { type: "present" as const, contentHash: draftContentHash(before.content) } : { type: "absent" as const };

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
        lastSubstantiveActorUserId: params.actorUserId,
        correlationId: params.correlationId,
      });

      return {
        response: doc,
        persist: async (tx) => {
          // C.4B.3A — mutação governada: cria (author = originador) ou regenera (preserva originador,
          // último ator substantivo = solicitante, ledger ai_regenerate) com revalidação sob lock.
          const { document } = await applyDraftContentMutationTx(tx, {
            organizationId: params.organizationId, processId: params.processId, kind: params.kind,
            actorUserId: params.actorUserId, doc, operation: "ai_regenerate",
            expectedState, idempotencyKey: params.idempotencyKey, correlationId: params.correlationId,
          });
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
          return document; // snapshot canônico (originador preservado em regeneração)
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
    lastSubstantiveActorUserId: params.actorUserId,
    correlationId: params.correlationId,
  });
  const validation = validateEdital(doc);
  // Edital inválido: nenhum efeito, nenhuma reserva de idempotência (determinístico — retry livre).
  if (!validation.valid) {
    return { document: doc, validation, replayed: false };
  }

  // C.4B.3A — estado de partida para revalidação sob lock (regeneração não sobrescreve edição concorrente).
  const beforeEdital = await getGeneratedDocumentByKind(params.processId, params.organizationId, "edital");
  const expectedStateEdital = beforeEdital
    ? { type: "present" as const, contentHash: draftContentHash(beforeEdital.content) }
    : { type: "absent" as const };

  const payloadHash = generatePayloadHash({
    organizationId: params.organizationId, processId: params.processId, kind: "edital",
    object: params.object, modality: params.modality, form: params.form, platform: params.platform ?? null,
  });

  const { result, replayed } = await runReplaySafeGeneration<{ document: GeneratedDocument; validation: { valid: boolean; violations: string[] } }>(
    { organizationId: params.organizationId, actorUserId: params.actorUserId, idempotencyKey: params.idempotencyKey, payloadHash },
    reviveIdempotent,
    async () => ({
      response: { document: doc, validation },
      persist: async (tx) => {
        const { document } = await applyDraftContentMutationTx(tx, {
          organizationId: params.organizationId, processId: params.processId, kind: "edital",
          actorUserId: params.actorUserId, doc, operation: "ai_regenerate",
          expectedState: expectedStateEdital, idempotencyKey: params.idempotencyKey,
          correlationId: params.correlationId,
        });
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
        return { document, validation }; // snapshot canônico + validação
      },
    }),
  );
  return { ...result, replayed };
}

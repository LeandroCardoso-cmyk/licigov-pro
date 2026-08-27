/**
 * C.4B.1 — Document Promotion Service (EMISSÃO OFICIAL GOVERNADA do Processo Licitatório).
 *
 * Promove o conteúdo ATUAL do rascunho operacional (`generated_documents`) a uma VERSÃO IMUTÁVEL
 * `emitido` em `official_documents` — a autoridade institucional. Decisão HUMANA governada:
 *   - ator humano identificado (IA/sistema nunca emite) e revisor/emissor ≠ autor do rascunho (SoD);
 *   - papel mínimo institucional (manager) via RBAC canônico;
 *   - hash de conteúdo determinístico + concorrência otimista (expectedContentHash);
 *   - replay-safe idempotente (mesma chave+conteúdo → replay, sem nova versão; chave+conteúdo
 *     diferente → CONFLICT; concorrência → uma única emissão) reusando o idempotencyService;
 *   - COMMIT ATÔMICO: versão oficial `emitido` (append-only, GET_LOCK por linhagem) + ledger imutável
 *     `official_document_promotions` + marcação da idempotency key COMPLETED, numa ÚNICA transação.
 *
 * NÃO aplica ao DFD (fora de escopo C.4B.1). O snapshot `gerado` produzido pela C.4A NÃO é oficial —
 * só `emitido` é. Editar o rascunho depois NÃO altera a versão emitida (imutável): nova promoção cria
 * nova versão. A cognição/carregamento roda FORA da transação.
 */
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { getGeneratedDocumentByKind } from "../db/procurement";
import { insertOfficialPromotion, getLatestOfficialPromotion } from "../db/officialDocumentPromotions";
import { createDocument } from "./officialDocumentLifecycleService";
import { checkIdempotency, saveIdempotencyResult, failIdempotencyKey } from "./idempotencyService";
import { assertInstitutionalDecisionRules, orgRoleMeets } from "./documentWorkflowService";
import { draftContentHash } from "../domain/generatedDocument";
import type { OrgRole } from "../../drizzle/schema";

const PROMOTE_OP = "procurement.document.promote";
const BUSINESS_DOMAIN = "processo_licitatorio" as const;
/** Papel mínimo para EMITIR (autoridade institucional) — mesma exigência de aprovação da C.2B. */
const MIN_EMIT_ROLE: OrgRole = "manager";

export type PromotableKind = "etp" | "tr" | "edital";
const PROMOTABLE_KINDS: readonly PromotableKind[] = ["etp", "tr", "edital"];

/** Hash determinístico do conteúdo do rascunho (integridade da versão emitida) — primitive ÚNICA,
 *  definida no domínio e re-exportada aqui para compatibilidade dos imports existentes. */
export { draftContentHash };

function payloadHashOf(p: { organizationId: number; processId: string; kind: string; contentHash: string }): string {
  return createHash("sha256")
    .update(JSON.stringify({ op: PROMOTE_OP, o: p.organizationId, p: p.processId, k: p.kind, h: p.contentHash }))
    .digest("hex");
}

export interface PromoteOfficialResult {
  officialDocument: { id: string; version: number; status: string; lineageId: string; contentHash: string };
  promoted: boolean;
  replayed: boolean;
}

/**
 * Emite (promove) o rascunho atual de `kind` como versão oficial `emitido`. Governança humana +
 * integridade + replay-safety + commit atômico. `expectedContentHash` (opcional) garante que o
 * emissor promove exatamente a versão que revisou (concorrência otimista).
 */
export async function promoteOfficialDocument(params: {
  organizationId: number;
  processId: string;
  kind: PromotableKind;
  actorUserId: number;
  actorRole: OrgRole | null;
  idempotencyKey: string;
  correlationId: string;
  reason?: string | null;
  /** C.4B.1 — OBRIGATÓRIO: hash do conteúdo que o humano revisou/confirmou (integridade da emissão). */
  expectedContentHash: string;
}): Promise<PromoteOfficialResult> {
  if (!PROMOTABLE_KINDS.includes(params.kind)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Emissão oficial não se aplica a "${params.kind}" nesta fase.` });
  }

  // GUARD (integridade) — a confirmação do conteúdo revisado é obrigatória para emitir.
  if (!params.expectedContentHash || !params.expectedContentHash.trim()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Confirmação de conteúdo obrigatória: informe o hash da versão revisada antes de emitir." });
  }

  // Carregamento FORA da transação (sem rede/modelo aqui — determinístico).
  const draft = await getGeneratedDocumentByKind(params.processId, params.organizationId, params.kind);
  if (!draft || !draft.content.trim()) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Rascunho inexistente ou vazio — nada a emitir." });
  }

  // GUARD (SoD fail-closed) — sem autoria rastreável não é possível provar revisor ≠ autor: recusa.
  if (draft.authorUserId == null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "O rascunho não possui autoria institucional rastreável — regenere/reestabeleça a autoria antes da emissão oficial.",
    });
  }

  const contentHash = draftContentHash(draft.content);

  // Concorrência otimista: o emissor deve promover EXATAMENTE a versão que revisou.
  if (params.expectedContentHash !== contentHash) {
    throw new TRPCError({ code: "CONFLICT", message: "O rascunho mudou desde a revisão — recarregue e revise a versão vigente antes de emitir." });
  }

  const payloadHash = payloadHashOf({ organizationId: params.organizationId, processId: params.processId, kind: params.kind, contentHash });

  const check = await checkIdempotency(params.idempotencyKey, params.actorUserId, params.organizationId, PROMOTE_OP, payloadHash);
  if (check.status === "completed") {
    if (check.payloadMismatch) {
      throw new TRPCError({ code: "CONFLICT", message: "Idempotency-Key reutilizada com conteúdo diferente — emissão recusada." });
    }
    // responsePayload é objeto no MySQL 8 (JSON nativo) e string no MariaDB (JSON = LONGTEXT):
    // normaliza para reproduzir a resposta cacheada em ambos, sem novo efeito.
    const cached = (typeof check.response === "string" ? JSON.parse(check.response) : check.response) as Omit<PromoteOfficialResult, "replayed">;
    return { ...cached, replayed: true, promoted: false };
  }
  if (check.status === "processing") {
    throw new TRPCError({ code: "CONFLICT", message: "Uma emissão idêntica já está em processamento para esta chave — aguarde a conclusão." });
  }

  // status "new"/"failed": governança humana (fora da tx) → commit atômico (dentro da tx).
  try {
    // Governança institucional: papel mínimo + ator humano + segregação de deveres (revisor ≠ autor).
    if (!orgRoleMeets(params.actorRole, MIN_EMIT_ROLE)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Emissão oficial exige papel mínimo "${MIN_EMIT_ROLE}".` });
    }
    assertInstitutionalDecisionRules({
      toState: "approved", // a emissão é o ato de aprovação/autorização institucional
      actorUserId: params.actorUserId,
      authorUserId: draft.authorUserId,
      reason: params.reason ?? null,
    });

    // C.4B.3A — SoD estendida (guard de domínio, fail-closed, sem bypass): o ÚLTIMO ator substantivo do
    // rascunho (quem fez a última alteração material — edição/regeneração) também NÃO pode emitir. Não
    // altera o helper legacy global (documents int); é específico do Processo Licitatório.
    if (draft.lastSubstantiveActorUserId != null && draft.lastSubstantiveActorUserId === params.actorUserId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Segregação de deveres: o último editor substantivo do rascunho não pode emiti-lo — a emissão exige um terceiro revisor.",
      });
    }

    const db = await getDb();
    if (!db) {
      // GUARD (fail-closed) — a emissão CRIA autoridade institucional persistida e auditável. Sem
      // persistência, NADA pode ser considerado emitido: falha explicitamente (nunca promoted=true).
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Persistência indisponível — emissão oficial recusada (nenhuma versão emitida)." });
    }

    let result!: PromoteOfficialResult;
    await db.transaction(async (tx) => {
      // Versão oficial IMUTÁVEL "emitido" (append-only; GET_LOCK por linhagem serializa a numeração).
      const official = await createDocument({
        organizationId: params.organizationId, businessDomain: BUSINESS_DOMAIN, documentType: params.kind,
        origin: params.processId, title: draft.title, content: draft.content, author: String(params.actorUserId),
        status: "emitido", correlationId: params.correlationId,
        metadata: {
          promotedFromDraftId: draft.id, contentHash,
          authorUserId: draft.authorUserId, emitterUserId: params.actorUserId,
          // C.4B.3A — evidência aditiva da SoD estendida (não altera a autoridade existente).
          lastSubstantiveActorUserId: draft.lastSubstantiveActorUserId,
          reason: params.reason ?? null,
        },
      }, tx);

      // Ledger imutável da decisão institucional.
      await insertOfficialPromotion({
        organizationId: params.organizationId, processId: params.processId, officialDocumentId: official.id,
        lineageId: official.lineageId, documentKind: params.kind, version: official.version, contentHash,
        actorUserId: params.actorUserId, authorUserId: draft.authorUserId, previousStatus: draft.status,
        nextStatus: "emitido", reason: params.reason ?? null, correlationId: params.correlationId,
        idempotencyKey: params.idempotencyKey,
      }, tx);

      result = {
        officialDocument: { id: official.id, version: official.version, status: official.status, lineageId: official.lineageId, contentHash },
        promoted: true, replayed: false,
      };
      // Marca a chave COMPLETED com a resposta cacheável — na MESMA transação (atomicidade).
      await saveIdempotencyResult(params.idempotencyKey, params.actorUserId, params.organizationId, result, tx);
    });
    return result;
  } catch (err) {
    await failIdempotencyKey(params.idempotencyKey, params.actorUserId, params.organizationId);
    throw err;
  }
}

export interface OfficialPromotionSummary {
  draft: { exists: boolean; status: string | null; contentHash: string | null };
  latestOfficial: { officialDocumentId: string; version: number; contentHash: string; emittedAt: string } | null;
  /** true quando existe rascunho E já houve emissão E o conteúdo do rascunho difere da última emitida. */
  diverged: boolean;
  /** true quando existe rascunho promovível mas nenhuma versão oficial foi emitida ainda. */
  neverEmitted: boolean;
}

/**
 * Resumo para a UI: hash do rascunho atual × última versão oficial emitida. Permite indicar quando o
 * rascunho divergiu da última emissão (com o hash existente), sem lógica jurídica autônoma.
 */
export async function getOfficialPromotionSummary(params: {
  organizationId: number; processId: string; kind: PromotableKind;
}): Promise<OfficialPromotionSummary> {
  const draft = await getGeneratedDocumentByKind(params.processId, params.organizationId, params.kind);
  const latest = await getLatestOfficialPromotion(params.organizationId, params.processId, params.kind);
  const draftHash = draft && draft.content.trim() ? draftContentHash(draft.content) : null;
  const exists = !!(draft && draft.content.trim());
  return {
    draft: { exists, status: draft?.status ?? null, contentHash: draftHash },
    latestOfficial: latest
      ? { officialDocumentId: latest.officialDocumentId, version: latest.version, contentHash: latest.contentHash, emittedAt: latest.createdAt }
      : null,
    diverged: !!(exists && latest && draftHash !== latest.contentHash),
    neverEmitted: exists && !latest,
  };
}

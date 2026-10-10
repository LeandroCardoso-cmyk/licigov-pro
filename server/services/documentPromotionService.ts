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
import { TR_PARAMS_DIGEST_RE } from "../domain/trStructuredParams";
import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db/connection";
import { runTransactionWithDeadlockRetry } from "./transactionDeadlockRetry";
import { getGeneratedDocumentByKind, getProcess } from "../db/procurement";
import { insertOfficialPromotion, getLatestOfficialPromotion } from "../db/officialDocumentPromotions";
import { createDocument } from "./officialDocumentLifecycleService";
import { checkIdempotency, saveIdempotencyResult, failIdempotencyKey } from "./idempotencyService";
import { assertInstitutionalDecisionRules, orgRoleMeets } from "./documentWorkflowService";
import { draftContentHash } from "../domain/generatedDocument";
import { snapshotInstitutionalIdentity } from "./institutionalIdentityService";
import type { OrgRole } from "../../drizzle/schema";
import { getLatestEmittedByOrigin } from "../db/officialDocuments";
import { getAuthoringSourceState, getEditalSourceState } from "./procurementProcessService";
import { emissionBlockers, lineDiffStats, type EmissionBlocker } from "../domain/emissionPreconditions";
import type { PromotionTemplateIssuanceHook } from "./institutionalTemplates/templateCompositionService";

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

/**
 * R9 / SEM-057 — reúne as entradas das pré-condições semânticas da emissão (leituras tenant-scoped, sem efeito).
 */
async function resolveEmissionPreconditions(params: {
  organizationId: number; processId: string; kind: PromotableKind; content: string; contentHash: string;
}): Promise<{ blockers: EmissionBlocker[]; lastEmittedContent: string | null }> {
  const process = await getProcess(params.processId, params.organizationId);
  const object = process?.object ?? "";
  const [source, lastPromotion, lastEmitted, trEmitted] = await Promise.all([
    params.kind === "edital"
      ? getEditalSourceState({ organizationId: params.organizationId, processId: params.processId, object })
      : getAuthoringSourceState({ organizationId: params.organizationId, processId: params.processId, kind: params.kind, object }),
    getLatestOfficialPromotion(params.organizationId, params.processId, params.kind),
    getLatestEmittedByOrigin(params.organizationId, BUSINESS_DOMAIN, params.processId, params.kind),
    params.kind === "edital" ? getLatestEmittedByOrigin(params.organizationId, BUSINESS_DOMAIN, params.processId, "tr") : Promise.resolve(null),
  ]);
  // Sem objeto AUTORITATIVO no processo (legado/ausente), a autoria usou o objeto informado na geração, que não é
  // reconstituível aqui: a fonte "processo" não é comparável (e o digest global legado também não) — não bloqueia.
  const noAuthoritativeObject = !object.trim();
  const changed = (source.changedSources ?? []).filter((c) => !(noAuthoritativeObject && c.key === "processo"));
  const sourceState = noAuthoritativeObject && source.state === "source_changed" && changed.length === 0 ? "not_comparable" : source.state;
  return {
    blockers: emissionBlockers({
      kind: params.kind, content: params.content, contentHash: params.contentHash,
      sourceState, changedSourceLabels: changed.map((c) => c.label),
      trEmitted: trEmitted !== null,
      lastEmittedContentHash: lastPromotion?.contentHash ?? null, lastEmittedVersion: lastPromotion?.version ?? null,
    }),
    lastEmittedContent: lastEmitted?.content ?? null,
  };
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
/** Marcador `trparams:<sha256 completo, 64 hex>` gravado na geração do TR. Ausente em TR legado/importado; marcador curto/malformado NUNCA é copiado como autoridade. */
function trParamsMarker(sources: readonly string[] | undefined): string | null {
  const m = (sources ?? []).filter((x) => x.startsWith("trparams:")).pop();
  const digest = m ? m.slice("trparams:".length) : null;
  return digest && TR_PARAMS_DIGEST_RE.test(digest) ? digest : null;
}

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
  /**
   * Institutional Templates (Lane B) — OPCIONAL. Ausente ⇒ comportamento idêntico ao anterior. Presente: rascunho
   * composto por template passa pela REVALIDAÇÃO CANÔNICA antes da transação (SOURCE_CHANGED bloqueia; nada é
   * regenerado) e o M2 derivado é gravado DENTRO da transação da promoção (repetida inteira pelo retry do SEM-084).
   */
  templateIssuance?: PromotionTemplateIssuanceHook;
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

    // R9 / SEM-057 — pré-condições SEMÂNTICAS (depois da governança, antes de qualquer escrita): sem [REVISAR],
    // fontes atuais, Edital só após TR emitido, e nunca uma nova versão idêntica à última emitida.
    const { blockers } = await resolveEmissionPreconditions({
      organizationId: params.organizationId, processId: params.processId, kind: params.kind, content: draft.content, contentHash,
    });
    if (blockers.length) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Emissão bloqueada: ${blockers.map((b) => `${b.message} (${b.code})`).join(" ")}`,
      });
    }

    // Institutional Templates — revalidação canônica + M2 preparado (leituras FORA da transação; bloqueio sem efeito).
    const templated = params.templateIssuance
      ? await params.templateIssuance.prepare({
        organizationId: params.organizationId, processId: params.processId, draftId: draft.id, content: draft.content,
        contentHash, actorUserId: params.actorUserId, correlationId: params.correlationId,
      })
      : null;

    const db = await getDb();
    if (!db) {
      // GUARD (fail-closed) — a emissão CRIA autoridade institucional persistida e auditável. Sem
      // persistência, NADA pode ser considerado emitido: falha explicitamente (nunca promoted=true).
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Persistência indisponível — emissão oficial recusada (nenhuma versão emitida)." });
    }

    // R7 / PR-15 (SEM-013) — a versão emitida CONGELA a identidade institucional e a referência do processo da
    // época (mesmo mecanismo do Document Engine: `metadata.institutionalIdentitySnapshot`). Sem isso a reexportação
    // da MESMA versão mostrava a identidade vigente. Leituras determinísticas FORA da transação.
    const [identity, process] = await Promise.all([
      snapshotInstitutionalIdentity(params.organizationId),
      getProcess(params.processId, params.organizationId),
    ]);

    let result!: PromoteOfficialResult;
    // SEM084-A — fronteira DONA da transação (versão emitida + ledger + idempotência): deadlock ⇒ repete INTEIRA.
    await runTransactionWithDeadlockRetry({ label: "official_document.promote", organizationId: params.organizationId, correlationId: params.correlationId }, () => db.transaction(async (tx) => {
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
          institutionalIdentitySnapshot: identity.snapshot,
          institutionalIdentityFingerprint: identity.fingerprint,
          processNumber: process?.processNumber ?? null,
          object: process?.object ?? null,
          // CONTEXT_REUSE 2.0 — snapshot lógico dos Parâmetros estruturados do TR que participaram DESTA versão (marcador do rascunho).
          ...(params.kind === "tr" && trParamsMarker(draft.sources) ? { structuredParamsDigest: trParamsMarker(draft.sources) } : {}),
          ...(templated ? {
            templateGenerationManifestId: templated.issuanceManifest.derivedFromManifestId,
            templateIssuanceManifestId: templated.issuanceManifest.id,
            templateManifestHash: templated.issuanceManifest.manifestHash,
          } : {}),
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

      // Institutional Templates — M2 derivado do M1, na MESMA transação da versão emitida e do ledger.
      if (templated) await templated.persist({ officialDocumentId: official.id, officialVersion: official.version }, tx);

      result = {
        officialDocument: { id: official.id, version: official.version, status: official.status, lineageId: official.lineageId, contentHash },
        promoted: true, replayed: false,
      };
      // Marca a chave COMPLETED com a resposta cacheável — na MESMA transação (atomicidade).
      await saveIdempotencyResult(params.idempotencyKey, params.actorUserId, params.organizationId, result, tx);
    }));
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
  /** R9 / SEM-057 — bloqueios semânticos da emissão (os MESMOS que o backend aplica no clique). */
  blockers: EmissionBlocker[];
  /** R9 / SEM-057 — diferença por linhas do rascunho contra a última versão emitida (null = nunca emitido). */
  diffFromLatest: { added: number; removed: number } | null;
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
  const pre = exists && draftHash
    ? await resolveEmissionPreconditions({ organizationId: params.organizationId, processId: params.processId, kind: params.kind, content: draft!.content, contentHash: draftHash })
    : null;
  return {
    draft: { exists, status: draft?.status ?? null, contentHash: draftHash },
    latestOfficial: latest
      ? { officialDocumentId: latest.officialDocumentId, version: latest.version, contentHash: latest.contentHash, emittedAt: latest.createdAt }
      : null,
    diverged: !!(exists && latest && draftHash !== latest.contentHash),
    neverEmitted: exists && !latest,
    blockers: pre?.blockers ?? [],
    diffFromLatest: exists && pre ? lineDiffStats(pre.lastEmittedContent, draft!.content) : null,
  };
}

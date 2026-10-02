/**
 * Pilot Reset B2/B3 — lifecycle GOVERNADO do Processo Licitatório (domínio puro, determinístico, sem banco).
 *
 * Fonte normativa: este cabeçalho + `docs/architecture/PILOT_RESET_GOVERNED_LIFECYCLE.md`.
 *
 * Identidade: o `id` do processo continua opaco e estável; o NÚMERO é atributo administrativo. Uma LINHAGEM
 * (`lineageId`, opaco) agrupa as GERAÇÕES do mesmo processo. Só uma geração é `active`; as demais são históricas e
 * imutáveis (`superseded`, `discarded`, `cancelled`, `archived`). Nada é apagado: os filhos (DFD, pesquisa, importações,
 * itens, CATMAT, contexto, timeline) continuam apontando para a geração a que pertencem — nunca são reapontados.
 *
 * Ações:
 *  - CORRECT_NUMBER — corrige o número administrativo da geração ativa (antes/depois no ledger);
 *  - DISCARD_DRAFT  — marca a geração ativa como `discarded` (só sem estado de trabalho além da criação);
 *  - RESET_DRAFT    — supera a geração ativa e inicia uma NOVA geração limpa (só sem estado formal/oficial);
 *  - CANCEL         — encerra a geração ativa como `cancelled` (não emitida);
 *  - ARCHIVE        — encerra a geração ativa como `archived` (qualquer estado; registro histórico).
 * Estado formalizado NUNCA é tratado como "reset" (OFFICIAL_STATE_BLOCKS_RESET).
 *
 * Execução: exige `expectedRevision` (CAS), `expectedEligibilityDigest` (o digest do preview que a pessoa viu),
 * `idempotencyKey` e `reason`. Se o estado relevante mudou desde o preview ⇒ STALE_PREVIEW. IA não tem acesso a isto.
 */
import { createHash } from "crypto";

export const LIFECYCLE_ACTIONS = ["CORRECT_NUMBER", "DISCARD_DRAFT", "RESET_DRAFT", "CANCEL", "ARCHIVE"] as const;
export type LifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];
export const LIFECYCLE_STATES = ["active", "superseded", "discarded", "cancelled", "archived"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Domínios FORMAIS/OFICIAIS — qualquer contagem > 0 bloqueia correção de número, descarte e reset. */
export const FORMAL_DOMAINS = [
  "process_issued", "official_promotions", "official_documents_issued", "derived_contracts",
  "signed_institutional_responses", "signed_legal_opinions", "publications",
] as const;
export type FormalDomain = (typeof FORMAL_DOMAINS)[number];

/** Domínios de TRABALHO (estado de piloto) — bloqueiam só o descarte (o reset os preserva na geração antiga). */
export const WORK_DOMAINS = [
  "generated_documents", "document_edits", "price_research", "import_sessions", "import_promotions",
  "procurement_items", "procurement_lots", "catmat_decisions", "context_facts_after_create", "timeline_after_create",
] as const;
export type WorkDomain = (typeof WORK_DOMAINS)[number];

export const BLOCKER_CODE: Record<FormalDomain, string> = {
  process_issued: "PROCESS_ISSUED",
  official_promotions: "OFFICIAL_PROMOTION_EXISTS",
  official_documents_issued: "OFFICIAL_DOCUMENT_ISSUED",
  derived_contracts: "DERIVED_CONTRACT_EXISTS",
  signed_institutional_responses: "SIGNED_INSTITUTIONAL_RESPONSE",
  signed_legal_opinions: "SIGNED_LEGAL_OPINION",
  publications: "PUBLICATION_EXISTS",
};

export const STALE_PREVIEW = "STALE_PREVIEW";
export const STALE_REVISION = "LIFECYCLE_STALE_REVISION";
export const OFFICIAL_STATE_BLOCKS_RESET = "OFFICIAL_STATE_BLOCKS_RESET";
export const WORK_STATE_BLOCKS_DISCARD = "WORK_STATE_BLOCKS_DISCARD";
export const GENERATION_NOT_ACTIVE = "PROCESS_GENERATION_NOT_ACTIVE";
export const LIFECYCLE_IDEMPOTENCY_CONFLICT = "LIFECYCLE_IDEMPOTENCY_CONFLICT";
export const LIFECYCLE_FIELDS_REQUIRED = "LIFECYCLE_FIELDS_REQUIRED";
export const PROCESS_NUMBER_TAKEN = "PROCESS_NUMBER_TAKEN";

/** Estado relevante lido (preview: leitura simples; execução: leitura sob lock na transação). */
export interface LifecycleSnapshot {
  readonly processId: string;
  readonly organizationId: number;
  readonly processNumber: string;
  readonly status: string;
  readonly currentStage: string;
  readonly lineageId: string | null;
  readonly generationNo: number;
  readonly lifecycleState: LifecycleState;
  readonly lifecycleRevision: number;
  readonly formal: Readonly<Record<FormalDomain, number>>;
  readonly work: Readonly<Record<WorkDomain, number>>;
}

export interface Eligibility {
  readonly action: LifecycleAction;
  readonly eligible: boolean;
  /** Códigos estáveis do que impede a ação (vazio quando elegível). */
  readonly blockers: readonly string[];
  readonly reasons: readonly string[];
}

const positive = <K extends string>(rec: Readonly<Record<K, number>>, keys: readonly K[]) => keys.filter((k) => (rec[k] ?? 0) > 0);

/** Elegibilidade pura de uma ação sobre o snapshot. */
export function evaluateEligibility(s: LifecycleSnapshot, action: LifecycleAction): Eligibility {
  const blockers: string[] = [];
  const reasons: string[] = [];
  if (s.lifecycleState !== "active") {
    blockers.push(GENERATION_NOT_ACTIVE);
    reasons.push(`A geração está "${s.lifecycleState}" — é histórica e imutável.`);
    return { action, eligible: false, blockers, reasons };
  }
  const formal = positive(s.formal, FORMAL_DOMAINS);
  const work = positive(s.work, WORK_DOMAINS);
  switch (action) {
    case "CORRECT_NUMBER":
    case "RESET_DRAFT":
      if (formal.length) {
        blockers.push(OFFICIAL_STATE_BLOCKS_RESET, ...formal.map((d) => BLOCKER_CODE[d]));
        reasons.push("Há estado formal/oficial (emissão, promoção oficial, contrato, assinatura ou publicação): use cancelar/arquivar; estado formalizado nunca é reiniciado.");
      }
      break;
    case "DISCARD_DRAFT":
      if (formal.length) {
        blockers.push(OFFICIAL_STATE_BLOCKS_RESET, ...formal.map((d) => BLOCKER_CODE[d]));
        reasons.push("Há estado formal/oficial: o processo não pode ser descartado.");
      }
      if (work.length) {
        blockers.push(WORK_STATE_BLOCKS_DISCARD);
        reasons.push(`Há trabalho registrado (${work.join(", ")}): descartar esconderia esse histórico; use o reset governado (nova geração).`);
      }
      break;
    case "CANCEL":
      if (s.formal.process_issued > 0 || s.formal.publications > 0) {
        blockers.push(OFFICIAL_STATE_BLOCKS_RESET, ...(s.formal.process_issued > 0 ? ["PROCESS_ISSUED"] : []), ...(s.formal.publications > 0 ? ["PUBLICATION_EXISTS"] : []));
        reasons.push("Processo emitido/publicado não é cancelado por esta operação técnica (exige ato institucional próprio): use arquivar.");
      }
      break;
    case "ARCHIVE":
      break;
  }
  return { action, eligible: blockers.length === 0, blockers, reasons };
}

/** Digest determinístico do estado relevante (o que a pessoa viu no preview). */
export function eligibilityDigest(s: LifecycleSnapshot, action: LifecycleAction): string {
  const formal = FORMAL_DOMAINS.map((k) => [k, s.formal[k] ?? 0]);
  const work = WORK_DOMAINS.map((k) => [k, s.work[k] ?? 0]);
  return createHash("sha256").update(JSON.stringify([
    "plc-digest-v1", action, s.organizationId, s.processId, s.processNumber, s.status, s.currentStage, s.lineageId,
    s.generationNo, s.lifecycleState, s.lifecycleRevision, formal, work,
  ])).digest("hex");
}

/** Linhagem materializada de forma determinística a partir do processo raiz (estável em replay). */
export function lineageIdFor(organizationId: number, rootProcessId: string): string {
  return "pln_" + createHash("sha256").update(`pln:${organizationId}:${rootProcessId}`).digest("hex").slice(0, 20);
}

/** Id opaco da nova geração: determinístico por (órgão, linhagem, número da geração) — nunca derivado do número. */
export function generationProcessId(organizationId: number, lineageId: string, generationNo: number): string {
  return createHash("sha256").update(`plp-gen:${organizationId}:${lineageId}:${generationNo}`).digest("hex").slice(0, 20);
}

export function lifecycleEventId(organizationId: number, idempotencyKey: string, eventType: string): string {
  return "ple_" + createHash("sha256").update(`ple:${organizationId}:${idempotencyKey}:${eventType}`).digest("hex").slice(0, 20);
}

export interface LifecycleRequest {
  readonly organizationId: number;
  readonly processId: string;
  readonly action: LifecycleAction;
  readonly expectedRevision: number;
  readonly expectedEligibilityDigest: string;
  readonly idempotencyKey: string;
  readonly reason: string;
  /** Só CORRECT_NUMBER. */
  readonly newProcessNumber?: string;
  readonly actorUserId: number;
}

export function lifecycleRequestHash(r: LifecycleRequest): string {
  return createHash("sha256").update(JSON.stringify([
    "plc-req-v1", r.organizationId, r.processId, r.action, r.expectedRevision, r.expectedEligibilityDigest,
    r.reason.trim(), (r.newProcessNumber ?? "").trim(), r.actorUserId,
  ])).digest("hex");
}

export function validateLifecycleRequest(r: LifecycleRequest): { ok: true } | { ok: false; code: string; fields: string[] } {
  const missing: string[] = [];
  if (!LIFECYCLE_ACTIONS.includes(r.action)) missing.push("action");
  if (!Number.isInteger(r.expectedRevision) || r.expectedRevision < 0) missing.push("expectedRevision");
  if (!/^[0-9a-f]{64}$/.test(r.expectedEligibilityDigest)) missing.push("expectedEligibilityDigest");
  if (r.idempotencyKey.trim().length < 8) missing.push("idempotencyKey");
  if (r.reason.trim().length < 10) missing.push("reason");
  if (r.action === "CORRECT_NUMBER") {
    const n = (r.newProcessNumber ?? "").trim();
    if (!n || n.length > 64) missing.push("newProcessNumber");
  }
  return missing.length ? { ok: false, code: LIFECYCLE_FIELDS_REQUIRED, fields: missing } : { ok: true };
}

/** Estado final da geração alvo por ação. */
export const TARGET_STATE: Record<LifecycleAction, LifecycleState> = {
  CORRECT_NUMBER: "active", DISCARD_DRAFT: "discarded", RESET_DRAFT: "superseded", CANCEL: "cancelled", ARCHIVE: "archived",
};

export const LIFECYCLE_MESSAGES: Record<string, string> = {
  [STALE_PREVIEW]: `O processo mudou desde a pré-visualização. Gere uma nova pré-visualização antes de executar; nada foi alterado (${STALE_PREVIEW}).`,
  [STALE_REVISION]: `O lifecycle do processo foi alterado por outra operação. Recarregue e gere nova pré-visualização; nada foi alterado (${STALE_REVISION}).`,
  [LIFECYCLE_IDEMPOTENCY_CONFLICT]: `Esta solicitação já foi usada para outra operação de lifecycle. Nada foi alterado (${LIFECYCLE_IDEMPOTENCY_CONFLICT}).`,
  [LIFECYCLE_FIELDS_REQUIRED]: `Operação incompleta: informe o motivo (mín. 10 caracteres) e execute a partir de uma pré-visualização válida. Nada foi alterado (${LIFECYCLE_FIELDS_REQUIRED}).`,
  [PROCESS_NUMBER_TAKEN]: `Já existe processo ativo com este número nesta organização; nada foi alterado (${PROCESS_NUMBER_TAKEN}).`,
};

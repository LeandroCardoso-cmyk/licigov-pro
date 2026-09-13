/**
 * V1 PRE-PILOT CLOSURE — Fase A1 — COGNITIVE PROVENANCE (domínio PURO, sem I/O).
 *
 * Contrato de PROVENIÊNCIA COGNITIVA: torna toda execução cognitiva rastreável,
 * explicável, reproduzível (replay-safe), tenant-aware, correlation-aware, capaz de
 * representar DEGRADAÇÃO explicitamente e INCAPAZ de apresentar conteúdo degradado/
 * não-aterrado como plenamente fundamentado.
 *
 * Este módulo é 100% determinístico e sem efeitos colaterais (hashes, classificação,
 * derivação de estado). A persistência mora em `server/db/cognitiveProvenance.ts`; a
 * orquestração/captura em `server/services/cognitive/cognitiveProvenanceService.ts`.
 *
 * Princípios (não negociáveis):
 *   - NUNCA fabricar proveniência para registros históricos (usar `legacy_unclassified`).
 *   - `grounded` significa EVIDÊNCIA REAL recuperada/estruturada — NÃO uma mera referência
 *     normativa no texto do prompt. Fase A1 define o contrato; A2 preenche a recuperação real.
 *   - Falha ≠ sucesso, falha ≠ confiança 0, degradado ≠ "fundamentado".
 *   - Sem segredos, sem chaves de API, sem dump de prompt cru, sem payload gigante — só
 *     hashes/versões/identificadores/metadados mínimos.
 */

import { createHash } from "crypto";

// ─── Semânticas canônicas (conjuntos PEQUENOS e governáveis) ──────────────────

/** Modo de execução: cognitivo (LLM real) vs determinístico (template, sem IA). */
export type ExecutionMode = "cognitive" | "deterministic";

/**
 * Status de execução — SEPARADO do motivo de degradação. Conjunto mínimo:
 *   - completed          — execução plena, sem degradação;
 *   - completed_degraded — produziu saída, porém em estado degradado (ver DegradationReason);
 *   - failed             — não produziu saída autoritativa (ver FailureClass).
 */
export type ExecutionStatus = "completed" | "completed_degraded" | "failed";

/** Motivo de DEGRADAÇÃO (só quando `completed_degraded`). Distinto de FailureClass. */
export type DegradationReason =
  | "provider_unavailable"
  | "grounding_unavailable"
  | "evidence_insufficient"
  | "corpus_unavailable"
  | "timeout"
  | "dev_only_fallback"
  | "partial_output"; // geração cortada por teto de tokens (finishReason=max_tokens)

export const DEGRADATION_REASONS: readonly DegradationReason[] = [
  "provider_unavailable", "grounding_unavailable", "evidence_insufficient",
  "corpus_unavailable", "timeout", "dev_only_fallback", "partial_output",
];

/** Classificação de FALHA (só quando `failed`). Conjunto pequeno e governável. */
export type FailureClass =
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_auth_error"
  | "grounding_unavailable"
  | "invalid_input"
  | "policy_rejected"
  | "internal_failure";

export const FAILURE_CLASSES: readonly FailureClass[] = [
  "provider_unavailable", "provider_timeout", "provider_auth_error",
  "grounding_unavailable", "invalid_input", "policy_rejected", "internal_failure",
];

/**
 * Estado de GROUNDING (semântica mínima e explícita):
 *   - grounded            — evidência REAL recuperada/estruturada e completa;
 *   - partially_grounded  — alguma evidência real recuperada, porém incompleta;
 *   - ungrounded          — grounding/RAG declarado pela task, mas SEM evidência real
 *                           recuperada (referências no prompt NÃO bastam);
 *   - not_applicable      — task determinística/sem grounding/RAG;
 *   - legacy_unclassified — registro histórico pré-provenance (nunca reclassificar como grounded).
 */
export type GroundingState =
  | "grounded"
  | "partially_grounded"
  | "ungrounded"
  | "not_applicable"
  | "legacy_unclassified";

/** Classe de proveniência: moderna/provenienciada vs histórica/pré-provenance. */
export type ProvenanceClass = "provenanced" | "legacy_unclassified";

/**
 * Consciência de aprovação (human-in-the-loop) — distingue geração de revisão/emissão.
 * NÃO inferir aprovação legal a partir de geração; NÃO atribuir edição humana ao provider.
 */
export type ApprovalState =
  | "generated"
  | "human_reviewed_edited"
  | "institutionally_approved_emitted";

// ─── Fingerprints determinísticos ─────────────────────────────────────────────

function sha256Hex(s: string): string {
  return createHash("sha256").update(s ?? "").digest("hex");
}

/**
 * Insumo SEMÂNTICO do pedido cognitivo (o que define O QUE foi pedido). Exclui, por
 * CONSTRUÇÃO, correlationId, timestamps, IDs aleatórios, tokens, latência e a saída —
 * nada disso é parâmetro deste tipo. A ordenação de coleções onde a ordem não é
 * semanticamente relevante (referências) é normalizada antes do hash.
 */
export interface SemanticCognitiveInput {
  readonly tenantId: number;
  readonly task: string;
  readonly businessDomain?: string;
  readonly processId?: string;
  readonly workspaceId?: string;
  readonly stage?: string;
  readonly query: string;
  readonly documentRefs?: readonly string[];
  readonly lawRefs?: readonly string[];
}

/** Normaliza um conjunto de referências: trim, remove vazios, dedupe e ORDENA (ordem irrelevante). */
function normalizeRefSet(refs?: readonly string[]): string[] {
  return [...new Set((refs ?? []).map((r) => (r ?? "").trim()).filter((r) => r.length > 0))].sort();
}

/**
 * Fingerprint determinístico do INSUMO cognitivo semântico. Canonicaliza antes de hashear:
 * campos ausentes viram "" estável; a ordem incidental das referências NÃO altera o hash.
 * NÃO inclui correlationId/tempo/aleatórios (não fazem parte do tipo).
 */
export function computeInputFingerprint(input: SemanticCognitiveInput): string {
  const canonical = {
    tenant: input.tenantId,
    task: (input.task ?? "").trim(),
    domain: (input.businessDomain ?? "").trim(),
    process: (input.processId ?? "").trim(),
    workspace: (input.workspaceId ?? "").trim(),
    stage: (input.stage ?? "").trim(),
    query: (input.query ?? "").trim(),
    docs: normalizeRefSet(input.documentRefs),
    laws: normalizeRefSet(input.lawRefs),
  };
  return sha256Hex(`cinput:${JSON.stringify(canonical)}`);
}

/**
 * Fingerprint determinístico da SAÍDA relevante. NÃO é assinatura legal/digital — apenas
 * hash de integridade/versão do conteúdo produzido (imutável como saída ORIGINAL).
 */
export function computeOutputFingerprint(output: string): string {
  return sha256Hex(`coutput:${output ?? ""}`);
}

/**
 * REGRA CONGELADA — evidência é identificada por (identificador de fonte normativa +
 * locator estável + hash de conteúdo). NUNCA por `blockId` sozinho nem pela ORDEM de
 * recuperação. O agregado é ORDENADO (ordem irrelevante) e deduplicado antes do hash.
 */
export interface EvidenceRef {
  /** Identificador da fonte normativa (ex.: "lei_14133", documentId institucional). */
  readonly sourceId: string;
  /** Locator ESTÁVEL: artigo/inciso/parágrafo/seção/página (não a posição de recuperação). */
  readonly locator: string;
  /** Hash do CONTEÚDO da evidência (sha256). Na fase A1 pode derivar da referência (A2 preenche o real). */
  readonly contentHash: string;
}

/** Constrói uma EvidenceRef calculando o contentHash a partir do conteúdo (ou da referência, na A1). */
export function evidenceRef(sourceId: string, locator: string, content: string): EvidenceRef {
  return { sourceId: (sourceId ?? "").trim(), locator: (locator ?? "").trim(), contentHash: sha256Hex(content ?? "") };
}

/**
 * Fingerprint determinístico do CONJUNTO de evidências (REGRA CONGELADA). Order-independent:
 * a mesma coleção em ordem incidental diferente produz o MESMO fingerprint; um locator OU
 * conteúdo diferente produz fingerprint DIFERENTE. Conjunto vazio → sentinela determinística
 * ("nenhuma evidência") — nunca confundível com um conjunto real.
 */
export function computeEvidenceFingerprint(evidences: readonly EvidenceRef[]): string {
  const norm = [
    ...new Set(
      (evidences ?? [])
        .map((e) => `${(e.sourceId ?? "").trim()}|${(e.locator ?? "").trim()}|${(e.contentHash ?? "").trim()}`)
        .filter((s) => s !== "||"),
    ),
  ].sort();
  if (norm.length === 0) return sha256Hex("cevidence:none");
  return sha256Hex(`cevidence:${norm.join("\n")}`);
}

// ─── Derivação de estado (determinística) ─────────────────────────────────────

/**
 * Deriva o GroundingState de forma HONESTA. `grounded`/`partially_grounded` dependem de
 * EVIDÊNCIA REAL recuperada (`evidenceCount`), nunca de meras referências no prompt.
 *   - sem grounding e sem RAG declarados → not_applicable;
 *   - com grounding/RAG mas sem evidência real → ungrounded;
 *   - com evidência real completa → grounded; incompleta → partially_grounded.
 */
export function deriveGroundingState(p: {
  usesGrounding: boolean;
  usesRAG: boolean;
  evidenceCount: number;
  evidenceComplete: boolean;
}): GroundingState {
  if (!p.usesGrounding && !p.usesRAG) return "not_applicable";
  if (p.evidenceCount <= 0) return "ungrounded";
  return p.evidenceComplete ? "grounded" : "partially_grounded";
}

/**
 * Deriva, de forma DETERMINÍSTICA e HONESTA, o estado de execução (status + motivo de degradação)
 * e o grounding_state a partir de sinais REAIS. SEPARA status de execução do motivo de degradação:
 *   - finishReason=max_tokens → completed_degraded/partial_output (saída possivelmente incompleta);
 *   - grounding/RAG exigido mas SEM evidência real → completed_degraded/grounding_unavailable
 *     (NUNCA apresentar como fundamentado);
 *   - evidência real porém incompleta → completed_degraded/evidence_insufficient;
 *   - caso contrário → completed.
 */
export function deriveExecutionState(p: {
  finishReason: string;
  usesGrounding: boolean;
  usesRAG: boolean;
  evidenceCount: number;
  evidenceComplete: boolean;
}): { status: ExecutionStatus; degradationReason: DegradationReason | null; groundingState: GroundingState } {
  const groundingState = deriveGroundingState({
    usesGrounding: p.usesGrounding, usesRAG: p.usesRAG, evidenceCount: p.evidenceCount, evidenceComplete: p.evidenceComplete,
  });
  const usesGroundingOrRag = p.usesGrounding || p.usesRAG;
  if (p.finishReason === "max_tokens") return { status: "completed_degraded", degradationReason: "partial_output", groundingState };
  if (usesGroundingOrRag && groundingState === "ungrounded") return { status: "completed_degraded", degradationReason: "grounding_unavailable", groundingState };
  if (groundingState === "partially_grounded") return { status: "completed_degraded", degradationReason: "evidence_insufficient", groundingState };
  return { status: "completed", degradationReason: null, groundingState };
}

/** Limite máximo (em caracteres) da mensagem de falha persistida — casa com `failure_message` varchar(300). */
export const MAX_FAILURE_MESSAGE_LENGTH = 300;

/** Redige uma mensagem de erro para persistência: sem segredos/URLs de banco/chaves/SQL cru. */
export function sanitizeFailureMessage(raw: string): string {
  let m = (raw ?? "").toString();
  // Redige URLs de conexão (mysql://user:pass@host/db, postgres://…) e tokens longos.
  m = m.replace(/\b[a-z]+:\/\/[^\s'"]+/gi, "[redacted-url]");
  m = m.replace(/\b(password|senha|secret|token|api[_-]?key|authorization|bearer)\b\s*[:=]\s*\S+/gi, "$1=[redacted]");
  m = m.replace(/\b[A-Za-z0-9_\-]{32,}\b/g, "[redacted-token]"); // possíveis chaves/segredos longos
  m = m.replace(/\s+/g, " ").trim();
  // Truncamento com a elipse DENTRO do limite (nunca excede a coluna): slice(MAX-1) + "…" = MAX chars.
  return m.length > MAX_FAILURE_MESSAGE_LENGTH ? `${m.slice(0, MAX_FAILURE_MESSAGE_LENGTH - 1)}…` : m;
}

/**
 * Classifica uma falha de execução cognitiva num conjunto pequeno e governável e devolve
 * uma mensagem SANITIZADA (nunca SQL/segredos/credenciais cruas).
 */
export function classifyFailure(err: unknown): { failureClass: FailureClass; message: string } {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const name = (err as { name?: string })?.name ?? "";
  const code = (err as { code?: string })?.code ?? "";
  const hay = `${name} ${code} ${raw}`.toLowerCase();

  let failureClass: FailureClass = "internal_failure";
  if (/\b(timeout|timed out|etimedout|deadline exceeded|abort)\b/.test(hay)) failureClass = "provider_timeout";
  else if (/\b(unauthor|forbidden|invalid api key|invalid key|401|403|permission denied)\b/.test(hay)) failureClass = "provider_auth_error";
  else if (/\b(unavailable|econnrefused|enotfound|econnreset|network|503|502|overloaded|rate limit|429|dns)\b/.test(hay)) failureClass = "provider_unavailable";
  else if (/\b(grounding|corpus|evidence)\b/.test(hay)) failureClass = "grounding_unavailable";
  else if (/\b(structured_output_invalid|invalid cognitive|invalid input|validation failed|schema)\b/.test(hay)) failureClass = "invalid_input";
  else if (/\b(policy|not authorized|não autorizado|not allowed|domínio .* não autorizado)\b/.test(hay)) failureClass = "policy_rejected";

  return { failureClass, message: sanitizeFailureMessage(raw) };
}

// ─── Envelope de proveniência (imutável) ──────────────────────────────────────

/**
 * Envelope canônico de proveniência cognitiva. Snapshot IMUTÁVEL da execução original:
 * uma edição humana posterior NÃO altera esta proveniência (nova versão/registro). Sem
 * conteúdo integral, sem prompt cru, sem segredos — apenas hashes/versões/identificadores
 * e metadados mínimos.
 */
export interface ProvenanceEnvelope {
  readonly id: string;
  readonly organizationId: number;
  readonly executionId: string;
  readonly correlationId: string;
  readonly task: string;
  readonly executionMode: ExecutionMode;
  readonly executionStatus: ExecutionStatus;
  readonly degradationReason: DegradationReason | null;
  readonly failureClass: FailureClass | null;
  readonly groundingState: GroundingState;
  readonly provenanceClass: ProvenanceClass;
  readonly provider: string | null;
  readonly model: string | null;
  readonly taskVersion: string;
  readonly promptContractVersion: string;
  readonly orchestratorVersion: string;
  readonly inputFingerprint: string;
  readonly outputFingerprint: string | null;
  readonly evidenceFingerprint: string | null;
  readonly replayHash: string;
  readonly idempotencyKey: string | null;
  readonly isReplay: boolean;
  readonly replayOfExecutionId: string | null;
  readonly approvalState: ApprovalState;
  readonly businessDomain: string | null;
  readonly processId: string | null;
  readonly workspaceId: string | null;
  readonly stage: string | null;
  readonly actorUserId: string | null;
  readonly failureMessage: string | null;
}

/** Versão do contrato de proveniência A1 (bump deliberado quando a semântica evoluir). */
export const PROVENANCE_ORCHESTRATOR_VERSION = "a1.1";

/** id determinístico da proveniência (sem tempo/aleatórios): estável por execução/replay. */
export function provenanceId(p: { organizationId: number; executionId: string; replayHash: string; isReplay: boolean }): string {
  return createHash("sha256")
    .update(`prov:${p.organizationId}:${p.executionId}:${p.replayHash}:${p.isReplay ? "replay" : "orig"}`)
    .digest("hex")
    .slice(0, 24);
}

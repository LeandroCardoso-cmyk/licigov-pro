/**
 * PR-09 (SEM-014 / SEM-009) — Preservação do estado HUMANO na regeneração de ETP/TR/Edital.
 *
 * Regras PURAS (sem IO), consumidas por `procurementProcessService` e pela leitura `reviewableDraft`:
 *
 *   1. `classifyDraftHumanState` — decide se o conteúdo ATUAL do rascunho canônico carrega trabalho humano,
 *      usando SOMENTE a proveniência que já existe: a última linha do ledger append-only
 *      `generated_document_edits` (operação + hash do conteúdo resultante) e os marcadores `sources` do
 *      rascunho. Nenhum modelo novo. Fail-safe: operação desconhecida ou conteúdo que diverge do último
 *      hash registrado (mudança fora do ledger) contam como humano — nunca sobrescrever em silêncio.
 *
 *   2. `humanEditRefusalMessage` — mensagem estável (token `HUMAN_EDIT_WOULD_BE_OVERWRITTEN`) da recusa
 *      governada quando a regeneração não trouxe `confirmReplace: true`.
 *
 *   3. `resolveEditalParameters` — parâmetros do Edital (modalidade/forma/plataforma) são uma DECISÃO
 *      HUMANA persistida por processo (colunas `modality/form/platform` do rascunho canônico do Edital).
 *      A geração usa os parâmetros PERSISTIDOS (leitura no servidor); proposta divergente só vale com
 *      troca EXPLÍCITA (`confirmParameterChange`); ausência de parâmetros ⇒ recusa clara (sem padrões).
 */
import { draftContentHash, type EditalForm, type EditalModality, type EditalPlatform } from "./generatedDocument";

/** Token estável da recusa (CONFLICT) — regenerar sobre conteúdo humano sem confirmação explícita. */
export const HUMAN_EDIT_WOULD_BE_OVERWRITTEN = "HUMAN_EDIT_WOULD_BE_OVERWRITTEN";
/** Token estável (PRECONDITION_FAILED) — Edital sem modalidade/forma definidas (nenhum padrão é assumido). */
export const EDITAL_PARAMETERS_REQUIRED = "EDITAL_PARAMETERS_REQUIRED";
/** Token estável (CONFLICT) — proposta de parâmetros diverge dos persistidos sem troca explícita. */
export const EDITAL_PARAMETERS_CHANGED = "EDITAL_PARAMETERS_CHANGED";

/** Última linha do ledger `generated_document_edits` do rascunho (tenant-scoped na leitura). */
export interface LastDraftEdit {
  readonly operation: string;
  readonly actorUserId: number;
  readonly newContentHash: string;
  readonly createdAt: string;
}

/** Operações do ledger cujo conteúdo resultante é produzido pelo SISTEMA (IA/template), não por humano. */
const SYSTEM_AUTHORED_OPERATIONS: ReadonlySet<string> = new Set(["ai_regenerate", "dfd_regenerate", "dfd_ai_draft"]);
const IMPORT_OPERATIONS: ReadonlySet<string> = new Set(["import_promote", "import_replace"]);

export type DraftHumanReason = "human_edit" | "import" | "untracked_change";

export type DraftHumanState =
  | { readonly human: false }
  | {
      readonly human: true;
      readonly reason: DraftHumanReason;
      /** Operação do ledger que originou o conteúdo atual (null = marcador legado em `sources`). */
      readonly operation: string | null;
      readonly actorUserId: number | null;
      readonly at: string | null;
    };

/**
 * Classifica o conteúdo ATUAL do rascunho. Conteúdo vazio nunca é "humano" (nada a perder).
 *   - Há ledger: o último registro descreve o conteúdo vigente (hash confere) → humano se a operação NÃO
 *     for de autoria do sistema; hash divergente → `untracked_change` (conservador).
 *   - Sem ledger: criação por geração (IA) — exceto marcadores de importação/edição humana legados.
 */
export function classifyDraftHumanState(
  draft: { readonly content: string; readonly sources?: readonly string[] | null },
  lastEdit: LastDraftEdit | null | undefined,
): DraftHumanState {
  if (!draft.content.trim()) return { human: false };
  if (lastEdit) {
    const base = { operation: lastEdit.operation, actorUserId: lastEdit.actorUserId, at: lastEdit.createdAt };
    if (lastEdit.newContentHash !== draftContentHash(draft.content)) {
      return { human: true, reason: "untracked_change", ...base };
    }
    if (SYSTEM_AUTHORED_OPERATIONS.has(lastEdit.operation)) return { human: false };
    return { human: true, reason: IMPORT_OPERATIONS.has(lastEdit.operation) ? "import" : "human_edit", ...base };
  }
  const sources = draft.sources ?? [];
  if (sources.includes("origem:import")) return { human: true, reason: "import", operation: null, actorUserId: null, at: null };
  if (sources.includes("edicao_humana") || sources.includes("edicao_manual")) {
    return { human: true, reason: "human_edit", operation: null, actorUserId: null, at: null };
  }
  return { human: false };
}

const KIND_LABELS: Record<"etp" | "tr" | "edital", string> = { etp: "ETP", tr: "TR", edital: "Edital" };
const REASON_LABELS: Record<DraftHumanReason, string> = {
  human_edit: "edição humana",
  import: "documento importado",
  untracked_change: "alteração sem registro de autoria de IA",
};

/**
 * Recusa governada (null = pode seguir). Só recusa quando o conteúdo atual é humano E o chamador não
 * confirmou explicitamente a substituição. Mensagem estável prefixada pelo token.
 */
export function humanEditRefusalMessage(
  kind: "etp" | "tr" | "edital", state: DraftHumanState, confirmReplace: boolean | undefined,
): string | null {
  if (!state.human || confirmReplace === true) return null;
  return `${HUMAN_EDIT_WOULD_BE_OVERWRITTEN}: o rascunho do ${KIND_LABELS[kind]} contém ${REASON_LABELS[state.reason]} — `
    + "regenerar substituiria esse conteúdo. Confirme a substituição (o conteúdo atual fica preservado no histórico) ou continue editando.";
}

// ─── SEM-009 — parâmetros do Edital ────────────────────────────────────────────────────────────

export interface EditalParameters {
  readonly modality: EditalModality;
  readonly form: EditalForm;
  /** Só existe na forma eletrônica (presencial ⇒ null). */
  readonly platform: EditalPlatform | null;
}

export interface EditalParameterProposal {
  readonly modality?: EditalModality | null;
  readonly form?: EditalForm | null;
  readonly platform?: EditalPlatform | null;
}

/** Parâmetros persistidos no rascunho canônico do Edital (null quando ainda não houve decisão). */
export function persistedEditalParameters(
  row: { readonly modality?: string | null; readonly form?: string | null; readonly platform?: string | null } | null | undefined,
): EditalParameters | null {
  if (!row || !row.modality || !row.form) return null;
  const form = row.form as EditalForm;
  return {
    modality: row.modality as EditalModality, form,
    platform: form === "eletronico" ? ((row.platform as EditalPlatform | null) ?? null) : null,
  };
}

function normalizeProposal(p: EditalParameterProposal): EditalParameters | null {
  if (!p.modality || !p.form) return null;
  return { modality: p.modality, form: p.form, platform: p.form === "eletronico" ? (p.platform ?? null) : null };
}

function isEmptyProposal(p: EditalParameterProposal): boolean {
  return !p.modality && !p.form && !p.platform;
}

export function sameEditalParameters(a: EditalParameters, b: EditalParameters): boolean {
  return a.modality === b.modality && a.form === b.form && (a.platform ?? null) === (b.platform ?? null);
}

export function describeEditalParameters(p: EditalParameters): string {
  return p.form === "eletronico" ? `${p.modality}/${p.form}/${p.platform ?? "sem plataforma"}` : `${p.modality}/${p.form}`;
}

export type EditalParameterResolution =
  | {
      readonly ok: true;
      readonly params: EditalParameters;
      /** persisted = decisão já gravada; first_decision = 1ª definição humana; explicit_change = troca confirmada. */
      readonly source: "persisted" | "first_decision" | "explicit_change";
      readonly previous: EditalParameters | null;
    }
  | {
      readonly ok: false;
      readonly code: "PRECONDITION_FAILED" | "CONFLICT";
      readonly message: string;
      readonly persisted: EditalParameters | null;
      readonly proposed: EditalParameters | null;
    };

/**
 * Parâmetros EFETIVOS da geração do Edital:
 *   - persistidos + sem proposta (ou proposta idêntica) ⇒ persistidos (leitura no servidor);
 *   - persistidos + proposta divergente ⇒ só com `confirmParameterChange` (senão CONFLICT, atual × proposto);
 *   - sem persistidos ⇒ a proposta COMPLETA (modalidade + forma) é a 1ª decisão humana; incompleta ⇒
 *     PRECONDITION_FAILED — nunca um padrão silencioso.
 */
export function resolveEditalParameters(input: {
  readonly persisted: EditalParameters | null;
  readonly proposed: EditalParameterProposal;
  readonly confirmParameterChange?: boolean;
}): EditalParameterResolution {
  const { persisted } = input;
  const proposed = normalizeProposal(input.proposed);
  if (persisted) {
    if (isEmptyProposal(input.proposed)) return { ok: true, params: persisted, source: "persisted", previous: null };
    if (!proposed) {
      return {
        ok: false, code: "PRECONDITION_FAILED", persisted, proposed: null,
        message: `${EDITAL_PARAMETERS_REQUIRED}: informe modalidade E forma para trocar os parâmetros do Edital (ou omita-os para usar os definidos: ${describeEditalParameters(persisted)}).`,
      };
    }
    if (sameEditalParameters(persisted, proposed)) return { ok: true, params: persisted, source: "persisted", previous: null };
    if (input.confirmParameterChange !== true) {
      return {
        ok: false, code: "CONFLICT", persisted, proposed,
        message: `${EDITAL_PARAMETERS_CHANGED}: os parâmetros propostos (${describeEditalParameters(proposed)}) diferem dos definidos para este Edital (${describeEditalParameters(persisted)}). Confirme a troca explicitamente.`,
      };
    }
    return { ok: true, params: proposed, source: "explicit_change", previous: persisted };
  }
  if (!proposed) {
    return {
      ok: false, code: "PRECONDITION_FAILED", persisted: null, proposed: null,
      message: `${EDITAL_PARAMETERS_REQUIRED}: defina a modalidade e a forma (eletrônica/presencial) do Edital antes de gerar — nenhum padrão é assumido.`,
    };
  }
  return { ok: true, params: proposed, source: "first_decision", previous: null };
}

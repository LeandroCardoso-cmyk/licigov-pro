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
 *   3. `resolveEditalParameters` — parâmetros do Edital (modalidade/forma/plataforma + critério de julgamento
 *      e regime de execução, 0311) são uma DECISÃO HUMANA persistida por processo (colunas do rascunho
 *      canônico do Edital). A geração usa os parâmetros PERSISTIDOS (leitura no servidor); proposta que
 *      sobrescreve um fato decidido só vale com troca EXPLÍCITA (`confirmParameterChange`); ausência de
 *      modalidade/forma ⇒ recusa clara (sem padrões); critério/regime NULL ⇒ "requer revisão" ([REVISAR]).
 *
 *   4. `officialRegenerationBlock` — documento APROVADO ou com versão OFICIAL emitida NÃO é regenerado
 *      diretamente (token `OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE`), nem com `confirmReplace`.
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

// ─── R5 (decisão do owner) — documento APROVADO/OFICIAL não é regenerado diretamente ─────────────

/**
 * Token estável (PRECONDITION_FAILED) — o ETP/TR/Edital já é APROVADO (status do rascunho canônico) ou tem
 * versão OFICIAL emitida (ledger `official_document_promotions`). Regenerar diretamente é recusado MESMO com
 * `confirmReplace`: a substituição de um documento oficial exige um novo ciclo de versão governado.
 */
export const OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE = "OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE";

export type OfficialRegenerationBlock =
  | { readonly reason: "official_emitted"; readonly officialVersion: number; readonly emittedAt: string | null }
  | { readonly reason: "approved"; readonly officialVersion: null; readonly emittedAt: null };

/**
 * Representação EXISTENTE da autoridade documental (sem estado novo):
 *   - versão OFICIAL emitida ⇔ há linha no ledger imutável `official_document_promotions` (org+processo+kind) —
 *     a mesma evidência usada pela governança dos Itens (GOVERNED_CHANGE_REQUIRED) e por `issueProcess`;
 *   - APROVADO ⇔ `generated_documents.status = 'aprovado'` (mesma regra do DFD_APPROVED).
 * A emissão oficial tem precedência (é a autoridade institucional). O snapshot `gerado` da C.4A NÃO conta.
 */
export function officialRegenerationBlock(
  draft: { readonly status?: string | null } | null | undefined,
  latestOfficial: { readonly version: number; readonly createdAt?: string | null } | null | undefined,
): OfficialRegenerationBlock | null {
  if (latestOfficial) return { reason: "official_emitted", officialVersion: latestOfficial.version, emittedAt: latestOfficial.createdAt ?? null };
  if (draft?.status === "aprovado") return { reason: "approved", officialVersion: null, emittedAt: null };
  return null;
}

/** Mensagem estável (prefixada pelo token) da recusa: explica que é preciso um novo ciclo de versão governado. */
export function officialRegenerationRefusalMessage(kind: "etp" | "tr" | "edital", block: OfficialRegenerationBlock): string {
  const what = block.reason === "official_emitted"
    ? `já possui versão OFICIAL emitida (v${block.officialVersion})`
    : "está APROVADO";
  return `${OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE}: o ${KIND_LABELS[kind]} ${what} e não pode ser regenerado diretamente `
    + "(nem com confirmação de substituição). A substituição de um documento oficial exige um novo ciclo de versão governado; "
    + "a versão oficial e o rascunho permanecem inalterados.";
}

// ─── SEM-009 — parâmetros do Edital ────────────────────────────────────────────────────────────

/**
 * Limite dos parâmetros institucionais TEXTUAIS do Edital (critério de julgamento / regime de execução).
 * O repositório NÃO define lista fechada para eles (o legado `edital_parameters` também os guarda como
 * varchar(100) livre) — por isso são texto bounded, nunca um enum inventado.
 */
export const EDITAL_TEXT_PARAMETER_MAX = 100;

export interface EditalParameters {
  readonly modality: EditalModality;
  readonly form: EditalForm;
  /** Só existe na forma eletrônica (presencial ⇒ null). */
  readonly platform: EditalPlatform | null;
  /** Critério de julgamento (fato institucional). null = ainda não definido ⇒ "requer revisão" ([REVISAR]). */
  readonly judgmentCriterion: string | null;
  /** Regime de execução (fato institucional). null = ainda não definido ⇒ "requer revisão" ([REVISAR]). */
  readonly executionRegime: string | null;
}

export interface EditalParameterProposal {
  readonly modality?: EditalModality | null;
  readonly form?: EditalForm | null;
  readonly platform?: EditalPlatform | null;
  readonly judgmentCriterion?: string | null;
  readonly executionRegime?: string | null;
}

/** Texto institucional normalizado: trim; vazio ⇒ null (ausência, nunca um valor). */
export function normalizeEditalText(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t ? t : null;
}

/** Parâmetros persistidos no rascunho canônico do Edital (null quando ainda não houve decisão de modalidade/forma). */
export function persistedEditalParameters(
  row: {
    readonly modality?: string | null; readonly form?: string | null; readonly platform?: string | null;
    readonly judgmentCriterion?: string | null; readonly executionRegime?: string | null;
  } | null | undefined,
): EditalParameters | null {
  if (!row || !row.modality || !row.form) return null;
  const form = row.form as EditalForm;
  return {
    modality: row.modality as EditalModality, form,
    platform: form === "eletronico" ? ((row.platform as EditalPlatform | null) ?? null) : null,
    judgmentCriterion: normalizeEditalText(row.judgmentCriterion),
    executionRegime: normalizeEditalText(row.executionRegime),
  };
}

/** Núcleo (modalidade/forma/plataforma) da proposta — null quando incompleto. */
function normalizeCore(p: EditalParameterProposal): Pick<EditalParameters, "modality" | "form" | "platform"> | null {
  if (!p.modality || !p.form) return null;
  return { modality: p.modality, form: p.form, platform: p.form === "eletronico" ? (p.platform ?? null) : null };
}

function isEmptyCore(p: EditalParameterProposal): boolean {
  return !p.modality && !p.form && !p.platform;
}

export function sameEditalParameters(a: EditalParameters, b: EditalParameters): boolean {
  return a.modality === b.modality && a.form === b.form && (a.platform ?? null) === (b.platform ?? null)
    && (a.judgmentCriterion ?? null) === (b.judgmentCriterion ?? null)
    && (a.executionRegime ?? null) === (b.executionRegime ?? null);
}

export function describeEditalParameters(p: EditalParameters): string {
  const core = p.form === "eletronico" ? `${p.modality}/${p.form}/${p.platform ?? "sem plataforma"}` : `${p.modality}/${p.form}`;
  return core
    + (p.judgmentCriterion ? ` · critério de julgamento: ${p.judgmentCriterion}` : "")
    + (p.executionRegime ? ` · regime de execução: ${p.executionRegime}` : "");
}

/**
 * Sobrepõe a proposta aos persistidos: núcleo só quando informado COMPLETO (vazio ⇒ mantém o persistido;
 * incompleto ⇒ null = inválido); critério/regime só quando informados (ausente ⇒ mantém o persistido —
 * nunca "apaga" um fato institucional por omissão).
 */
export function overlayEditalProposal(persisted: EditalParameters, proposal: EditalParameterProposal): EditalParameters | null {
  let core: Pick<EditalParameters, "modality" | "form" | "platform"> = persisted;
  if (!isEmptyCore(proposal)) {
    const c = normalizeCore(proposal);
    if (!c) return null;
    core = c;
  }
  return {
    modality: core.modality, form: core.form, platform: core.platform,
    judgmentCriterion: normalizeEditalText(proposal.judgmentCriterion) ?? persisted.judgmentCriterion,
    executionRegime: normalizeEditalText(proposal.executionRegime) ?? persisted.executionRegime,
  };
}

/**
 * A proposta SOBRESCREVE um fato já decidido? (núcleo diferente, ou critério/regime persistido não-nulo
 * trocado por outro valor). Definir pela 1ª vez um critério/regime ainda NULL não é troca — é 1ª decisão.
 */
function overwritesDecision(persisted: EditalParameters, next: EditalParameters): boolean {
  const coreChanged = persisted.modality !== next.modality || persisted.form !== next.form
    || (persisted.platform ?? null) !== (next.platform ?? null);
  const textChanged = (prev: string | null, nxt: string | null) => prev !== null && prev !== nxt;
  return coreChanged || textChanged(persisted.judgmentCriterion, next.judgmentCriterion)
    || textChanged(persisted.executionRegime, next.executionRegime);
}

export type EditalParameterResolution =
  | {
      readonly ok: true;
      readonly params: EditalParameters;
      /**
       * persisted = decisão já gravada; first_decision = 1ª definição humana (inclui definir pela 1ª vez
       * critério/regime ainda NULL); explicit_change = troca confirmada de um fato já decidido.
       */
      readonly source: "persisted" | "first_decision" | "explicit_change";
      /** Parâmetros anteriores quando havia persistidos e eles mudaram (troca ou complemento). */
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
 *   - persistidos + proposta que sobrescreve fato decidido ⇒ só com `confirmParameterChange` (senão CONFLICT);
 *   - persistidos + proposta que só DEFINE critério/regime ainda NULL ⇒ 1ª decisão (sem confirmação);
 *   - sem persistidos ⇒ a proposta COMPLETA (modalidade + forma) é a 1ª decisão humana; incompleta ⇒
 *     PRECONDITION_FAILED — nunca um padrão silencioso.
 * Critério/regime NÃO são obrigatórios para gerar (o contexto do Edital os marca `[REVISAR]` quando NULL),
 * mas, quando definidos, são persistidos e lidos no servidor como os demais parâmetros.
 */
export function resolveEditalParameters(input: {
  readonly persisted: EditalParameters | null;
  readonly proposed: EditalParameterProposal;
  readonly confirmParameterChange?: boolean;
}): EditalParameterResolution {
  const { persisted } = input;
  if (persisted) {
    const next = overlayEditalProposal(persisted, input.proposed);
    if (!next) {
      return {
        ok: false, code: "PRECONDITION_FAILED", persisted, proposed: null,
        message: `${EDITAL_PARAMETERS_REQUIRED}: informe modalidade E forma para trocar os parâmetros do Edital (ou omita-os para usar os definidos: ${describeEditalParameters(persisted)}).`,
      };
    }
    if (sameEditalParameters(persisted, next)) return { ok: true, params: persisted, source: "persisted", previous: null };
    if (!overwritesDecision(persisted, next)) return { ok: true, params: next, source: "first_decision", previous: persisted };
    if (input.confirmParameterChange !== true) {
      return {
        ok: false, code: "CONFLICT", persisted, proposed: next,
        message: `${EDITAL_PARAMETERS_CHANGED}: os parâmetros propostos (${describeEditalParameters(next)}) diferem dos definidos para este Edital (${describeEditalParameters(persisted)}). Confirme a troca explicitamente.`,
      };
    }
    return { ok: true, params: next, source: "explicit_change", previous: persisted };
  }
  const core = normalizeCore(input.proposed);
  if (!core) {
    return {
      ok: false, code: "PRECONDITION_FAILED", persisted: null, proposed: null,
      message: `${EDITAL_PARAMETERS_REQUIRED}: defina a modalidade e a forma (eletrônica/presencial) do Edital antes de gerar — nenhum padrão é assumido.`,
    };
  }
  return {
    ok: true, source: "first_decision", previous: null,
    params: {
      ...core,
      judgmentCriterion: normalizeEditalText(input.proposed.judgmentCriterion),
      executionRegime: normalizeEditalText(input.proposed.executionRegime),
    },
  };
}

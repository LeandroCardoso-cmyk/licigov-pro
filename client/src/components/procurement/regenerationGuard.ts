/**
 * PR-09 (SEM-014 / SEM-009) — regras PURAS de UI para regenerar ETP/TR/Edital sem perder estado humano.
 *
 *  - `needsReplaceConfirmation`: o rascunho carregado (reviewableDraft) tem conteúdo humano ⇒ a UI pede
 *    confirmação ANTES de chamar a geração (o servidor recusa sem `confirmReplace` de todo modo);
 *  - `isHumanEditRefusal` / `isEditalParametersChangedRefusal`: reconhecem as recusas governadas do
 *    servidor (tokens estáveis) para abrir o diálogo de confirmação em vez de só mostrar erro;
 *  - `resolveEditalFormValues`: guarda de HIDRATAÇÃO do formulário do Edital — o valor exibido é a escolha
 *    explícita do usuário OU o parâmetro PERSISTIDO; nunca um padrão silencioso (vazio até decidir);
 *  - `planRegeneration` (R5): decide ANTES de qualquer chamada ao servidor se a ação "Gerar novamente" é
 *    bloqueada (documento aprovado/oficial), pede confirmação (conteúdo humano / troca de parâmetro) ou
 *    segue. Cancelar o diálogo NÃO chama a mutação (zero efeito);
 *  - critério de julgamento / regime de execução (R5, 0308): hidratação/proposta textual — vazio nunca
 *    apaga o persistido; NULL persistido = "requer revisão".
 */

export const HUMAN_EDIT_WOULD_BE_OVERWRITTEN = "HUMAN_EDIT_WOULD_BE_OVERWRITTEN";
export const EDITAL_PARAMETERS_CHANGED = "EDITAL_PARAMETERS_CHANGED";
export const OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE = "OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE";

/** R5 — bloqueio de regeneração direta devolvido pelo servidor em `reviewableDraft.draft.regenerationBlock`. */
export type RegenerationBlock =
  | { reason: "official_emitted"; officialVersion: number; emittedAt: string | null }
  | { reason: "approved"; officialVersion: null; emittedAt: null }
  | null | undefined;

export type DraftHumanEdit = {
  reason: "human_edit" | "import" | "untracked_change";
  operation: string | null;
  actorUserId: number | null;
  at: string | null;
} | null | undefined;

export function needsReplaceConfirmation(draft: { humanEdit?: DraftHumanEdit } | null | undefined): boolean {
  return !!draft?.humanEdit;
}

export function isHumanEditRefusal(message: string | null | undefined): boolean {
  return (message ?? "").startsWith(`${HUMAN_EDIT_WOULD_BE_OVERWRITTEN}:`);
}

export function isEditalParametersChangedRefusal(message: string | null | undefined): boolean {
  return (message ?? "").startsWith(`${EDITAL_PARAMETERS_CHANGED}:`);
}

export function isOfficialRegenerationRefusal(message: string | null | undefined): boolean {
  return (message ?? "").startsWith(`${OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE}:`);
}

/**
 * Explicação exibida quando o documento é APROVADO/OFICIAL: a regeneração direta não existe; substituir o
 * documento oficial exige um NOVO CICLO DE VERSÃO GOVERNADO (capacidade futura — ainda não há fluxo de
 * reabertura). O caminho EXISTENTE para uma nova versão oficial é a edição humana registrada do rascunho
 * seguida de nova emissão oficial governada (revisão de terceiro / SoD); a versão emitida nunca muda.
 */
export function describeRegenerationBlock(documentLabel: string, block: RegenerationBlock): string | null {
  if (!block) return null;
  const what = block.reason === "official_emitted"
    ? `já possui versão oficial emitida (v${block.officialVersion})`
    : "está aprovado";
  return `Este ${documentLabel} ${what} e não pode ser gerado novamente de forma direta — nem com confirmação. `
    + "Substituí-lo por um novo rascunho de IA exige um novo ciclo de versão governado (ainda não disponível). "
    + "Correções continuam possíveis pela edição do rascunho abaixo, que fica registrada e só vira oficial "
    + "após nova emissão governada; a versão oficial emitida permanece inalterada.";
}

export type RegenerationPlan = "blocked" | "confirm" | "mutate";

/**
 * Decide a ação de "Gerar" SEM efeito colateral (a UI só chama a mutação em `mutate`):
 *   - `blocked`: documento aprovado/oficial — nunca chama o servidor, mesmo após "confirmar";
 *   - `confirm`: conteúdo humano (ou troca de parâmetro) sem confirmação explícita — abre o diálogo;
 *   - `mutate`: segue (IA-only, 1ª geração ou confirmação explícita dada no diálogo).
 * Sem justificativa textual obrigatória: a confirmação explícita basta (decisão do owner).
 */
export function planRegeneration(input: {
  confirmed: boolean;
  needsReplace: boolean;
  parameterChange?: boolean;
  block?: RegenerationBlock;
}): RegenerationPlan {
  if (input.block) return "blocked";
  if (!input.confirmed && (input.needsReplace || input.parameterChange === true)) return "confirm";
  return "mutate";
}

const REASON_TEXT: Record<"human_edit" | "import" | "untracked_change", string> = {
  human_edit: "edição humana",
  import: "documento importado",
  untracked_change: "alteração sem registro de autoria de IA",
};

/** Resumo legível do que será substituído (origem + quando + por quem), para o diálogo de confirmação. */
export function describeHumanEdit(edit: DraftHumanEdit): string {
  if (!edit) return "conteúdo editado";
  const parts = [REASON_TEXT[edit.reason]];
  if (edit.actorUserId !== null) parts.push(`por usuário #${edit.actorUserId}`);
  if (edit.at) {
    const d = new Date(edit.at);
    if (!Number.isNaN(d.getTime())) parts.push(`em ${d.toLocaleString("pt-BR")}`);
  }
  return parts.join(" ");
}

// ─── SEM-009 — hidratação dos parâmetros do Edital ─────────────────────────────────────────────

export type EditalParamValues<M extends string, F extends string, P extends string> = {
  modality: M | null;
  form: F | null;
  platform: P | null;
};

/**
 * Valor EFETIVO de cada campo: a escolha explícita do usuário (`proposed`, null = não tocou) sobrepõe o
 * PERSISTIDO; sem nenhum dos dois ⇒ null (campo vazio, geração bloqueada). Plataforma só na forma eletrônica.
 */
export function resolveEditalFormValues<M extends string, F extends string, P extends string>(
  proposed: EditalParamValues<M, F, P>,
  persisted: EditalParamValues<M, F, P> | null | undefined,
): EditalParamValues<M, F, P> {
  const modality = proposed.modality ?? persisted?.modality ?? null;
  const form = proposed.form ?? persisted?.form ?? null;
  const platform = form === "eletronico"
    ? (proposed.platform ?? (persisted?.form === "eletronico" ? persisted.platform : null) ?? null)
    : null;
  return { modality, form, platform };
}

/** Os valores efetivos diferem dos persistidos? (troca de parâmetro = ação explícita, atual × proposto). */
export function editalParamsDiffer<M extends string, F extends string, P extends string>(
  effective: EditalParamValues<M, F, P>,
  persisted: EditalParamValues<M, F, P> | null | undefined,
): boolean {
  if (!persisted) return false;
  return effective.modality !== persisted.modality || effective.form !== persisted.form
    || (effective.platform ?? null) !== (persisted.platform ?? null);
}

/** Geração só com modalidade + forma definidas (e plataforma na forma eletrônica) — sem padrões. */
export function editalParamsComplete<M extends string, F extends string, P extends string>(
  v: EditalParamValues<M, F, P>,
): boolean {
  return !!v.modality && !!v.form && (v.form !== "eletronico" || !!v.platform);
}

// ─── R5 (0308) — critério de julgamento / regime de execução (texto institucional) ─────────────

export type EditalTextParams = { judgmentCriterion: string | null; executionRegime: string | null };
const TEXT_KEYS = ["judgmentCriterion", "executionRegime"] as const;

const norm = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

/** Valor EXIBIDO: o digitado (null = não tocou) OU o persistido; sem nenhum ⇒ "" (campo vazio, requer revisão). */
export function resolveEditalTextValues(
  proposed: EditalTextParams,
  persisted: Partial<EditalTextParams> | null | undefined,
): { judgmentCriterion: string; executionRegime: string } {
  return {
    judgmentCriterion: proposed.judgmentCriterion ?? persisted?.judgmentCriterion ?? "",
    executionRegime: proposed.executionRegime ?? persisted?.executionRegime ?? "",
  };
}

/**
 * Campos a ENVIAR: só os digitados, não vazios e diferentes do persistido. Vazio NUNCA apaga um fato
 * institucional já definido (o servidor mantém o persistido).
 */
export function editalTextProposal(
  proposed: EditalTextParams,
  persisted: Partial<EditalTextParams> | null | undefined,
): { judgmentCriterion?: string; executionRegime?: string } {
  const out: { judgmentCriterion?: string; executionRegime?: string } = {};
  for (const k of TEXT_KEYS) {
    const v = norm(proposed[k]);
    if (v !== null && v !== (persisted?.[k] ?? null)) out[k] = v;
  }
  return out;
}

/** A proposta SOBRESCREVE um valor já definido? (definir pela 1ª vez um NULL não é troca — sem confirmação). */
export function editalTextOverwrites(
  proposed: EditalTextParams,
  persisted: Partial<EditalTextParams> | null | undefined,
): boolean {
  const sent = editalTextProposal(proposed, persisted);
  return TEXT_KEYS.some((k) => sent[k] !== undefined && (persisted?.[k] ?? null) !== null);
}

/** Campos persistidos ainda NULL ⇒ exibidos como "requer revisão" (a minuta leva [REVISAR]). */
export function editalTextPendingReview(persisted: Partial<EditalTextParams> | null | undefined): Array<keyof EditalTextParams> {
  return TEXT_KEYS.filter((k) => !(persisted?.[k] ?? null));
}

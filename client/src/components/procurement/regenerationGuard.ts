/**
 * PR-09 (SEM-014 / SEM-009) — regras PURAS de UI para regenerar ETP/TR/Edital sem perder estado humano.
 *
 *  - `needsReplaceConfirmation`: o rascunho carregado (reviewableDraft) tem conteúdo humano ⇒ a UI pede
 *    confirmação ANTES de chamar a geração (o servidor recusa sem `confirmReplace` de todo modo);
 *  - `isHumanEditRefusal` / `isEditalParametersChangedRefusal`: reconhecem as recusas governadas do
 *    servidor (tokens estáveis) para abrir o diálogo de confirmação em vez de só mostrar erro;
 *  - `resolveEditalFormValues`: guarda de HIDRATAÇÃO do formulário do Edital — o valor exibido é a escolha
 *    explícita do usuário OU o parâmetro PERSISTIDO; nunca um padrão silencioso (vazio até decidir).
 */

export const HUMAN_EDIT_WOULD_BE_OVERWRITTEN = "HUMAN_EDIT_WOULD_BE_OVERWRITTEN";
export const EDITAL_PARAMETERS_CHANGED = "EDITAL_PARAMETERS_CHANGED";

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

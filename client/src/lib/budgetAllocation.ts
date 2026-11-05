/**
 * LICIGOV-FAST PR-2 — Dados orçamentários do processo (dotação orçamentária e fonte de recursos): lógica PURA da tela.
 *
 * Uma informação, um preenchimento: o servidor informa dotação/fonte UMA vez (Pesquisa de Preços, TR ou Edital oferecem o MESMO registro) e
 * os documentos as reaproveitam. Ausência é pendência INFORMATIVA: não impede gerar nem emitir; o documento mostra o marcador governado.
 * Declarado ≠ verificado: a tela nunca diz que a contabilidade conferiu o dado.
 */
export type BudgetFieldStatus = "DECLARED" | "PENDING" | "NOT_APPLICABLE";
export interface BudgetFieldView { value: string | null; status: BudgetFieldStatus }
export interface BudgetAllocationState {
  dotacao: BudgetFieldView;
  fonte: BudgetFieldView;
  srp: boolean | null;
  catalogVersion: string;
  /** Digest atual dos Dados orçamentários (o mesmo do marcador `orcamento:` gravado na geração do TR). */
  digest?: string;
}

/** Rótulo e tom visual por status (Pendente × Declarado × Não aplicável). */
export const BUDGET_STATUS_LABEL: Readonly<Record<BudgetFieldStatus, string>> = {
  DECLARED: "Declarado",
  PENDING: "Pendente",
  NOT_APPLICABLE: "Não aplicável",
};
export const BUDGET_STATUS_HINT: Readonly<Record<BudgetFieldStatus, string>> = {
  DECLARED: "Informado por pessoa autorizada neste processo (não verificado pelo sistema na contabilidade).",
  PENDING: "Ainda não informado. Não impede gerar nem emitir; o documento indica a pendência.",
  NOT_APPLICABLE: "Registro de preços: indicado na formalização de cada contratação, conforme o regulamento aplicável ao órgão.",
};

export const BUDGET_PROVIDED_BY = "Setor de contabilidade/orçamento do órgão";
export const BUDGET_FIELD_LABEL = { dotacao: "Dotação orçamentária", fonte: "Fonte de recursos" } as const;
export type BudgetFieldKey = keyof typeof BUDGET_FIELD_LABEL;

/** Pendências informativas (para avisos): só o que está PENDENTE. Não aplicável e declarado não aparecem. */
export function budgetPendingItems(a: BudgetAllocationState | null | undefined): { key: BudgetFieldKey; label: string }[] {
  if (!a) return [];
  return (["dotacao", "fonte"] as const).filter((k) => a[k].status === "PENDING").map((k) => ({ key: k, label: BUDGET_FIELD_LABEL[k] }));
}

/**
 * O TR foi gerado com OUTROS dados orçamentários (registrados/alterados depois): aviso informativo para atualizar a seção — nunca bloqueia.
 * Sem marcador no rascunho (TR anterior a esta funcionalidade ou modelo sem dotação) ⇒ nada a comparar.
 */
export function budgetOutdatedInDraft(a: BudgetAllocationState | null | undefined, draftBudgetDigest: string | null | undefined): boolean {
  return !!a?.digest && !!draftBudgetDigest && a.digest !== draftBudgetDigest;
}

export interface BudgetAllocationEdits { dotacao?: string; fonte?: string }
export interface BudgetAllocationPlan {
  /** Campos a enviar (`undefined` = não altera). Texto vazio nunca é enviado: remover um valor não é feito por aqui. */
  payload: { dotacaoOrcamentaria?: string; fonteRecursos?: string };
  /** Campos que SUBSTITUEM um valor já registrado diferente (exige confirmação explícita; nunca silenciosa). */
  replaces: BudgetFieldKey[];
  changed: boolean;
}

const norm = (s: string | undefined): string | undefined => (s === undefined ? undefined : s.replace(/\s+/g, " ").trim());

/** Plano de gravação: só o que mudou; substituição de valor registrado é explicitada para a confirmação. Puro. */
export function budgetAllocationPlan(a: BudgetAllocationState, edits: BudgetAllocationEdits): BudgetAllocationPlan {
  const payload: BudgetAllocationPlan["payload"] = {};
  const replaces: BudgetFieldKey[] = [];
  for (const [key, field] of [["dotacao", "dotacaoOrcamentaria"], ["fonte", "fonteRecursos"]] as const) {
    const next = norm(edits[key]);
    if (!next) continue;
    const current = a[key].value;
    if (current === next) continue;
    payload[field] = next;
    if (current && current.trim() !== "") replaces.push(key);
  }
  return { payload, replaces, changed: Object.keys(payload).length > 0 };
}

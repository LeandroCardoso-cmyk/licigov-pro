/**
 * Contexto Canônico — view-model PURO dos indicadores de origem do DFD (testável sem jsdom).
 * Traduz o estado por campo calculado no servidor (dfdAssistState) em rótulos discretos e ações
 * explícitas. Nenhuma decisão de autoridade é tomada aqui — só apresentação.
 */

export type DFDFieldStateUI =
  | "prefilled" | "ai_draft" | "user_modified" | "stale" | "conflict" | "available" | "unknown";

export interface DFDFieldViewUI {
  key: string;
  label: string;
  state: DFDFieldStateUI;
  documentValue: string | null;
  contextValue: string | null;
  origin: string | null;
  contextOrigin: string | null;
  reconcilable: boolean;
}

const ORIGIN_LABELS: Record<string, string> = {
  process: "Processo",
  organization: "Cadastro do órgão",
  user: "você",
  dfd: "DFD salvo",
  etp: "ETP",
  tr: "TR",
  approved_document: "documento aprovado",
  intelligent_item: "Itens Inteligentes",
  derived: "cálculo do sistema (quantidade prevista × preço de referência)",
  ai_draft: "IA",
};

export function originLabel(origin: string | null | undefined): string {
  return (origin && ORIGIN_LABELS[origin]) || "sistema";
}

export type FieldTone = "neutral" | "info" | "warning" | "muted";

/** Linha de explicação exibida ANTES de qualquer ação (valor atual × valor de origem × origem). */
export interface FieldDetail { label: string; value: string }

export interface FieldIndicator {
  key: string;
  label: string;
  text: string;
  tone: FieldTone;
  /** Rótulo do botão de ação explícita (null = sem ação). */
  action: string | null;
  /** Rótulo acessível do botão: campo + valor atual + valor de origem + origem. */
  actionAriaLabel: string | null;
  /** A ação substitui um valor escrito pelo servidor → exige confirmação. */
  confirmAction: boolean;
  /** Texto da confirmação (com os valores) — null quando a ação não exige confirmação. */
  confirmMessage: string | null;
  /** Valor atual / valor de origem / origem — sempre presente quando há divergência ou ação. */
  details: FieldDetail[] | null;
}

const EMPTY_VALUE = "não preenchido";

function shown(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return t === "" ? EMPTY_VALUE : t;
}

/** Explicação genérica (qualquer campo): o que está no DFD, o que a origem diz e de onde vem. */
export function fieldDetails(f: DFDFieldViewUI): FieldDetail[] {
  return [
    { label: "Valor atual no DFD", value: shown(f.documentValue) },
    { label: "Valor de origem", value: shown(f.contextValue) },
    { label: "Origem", value: originLabel(f.contextOrigin) },
  ];
}

export function fieldIndicator(f: DFDFieldViewUI): FieldIndicator {
  const none = { action: null, actionAriaLabel: null, confirmAction: false, confirmMessage: null, details: null };
  const base = { key: f.key, label: f.label, ...none };
  // Ação SÓ com valor de origem válido e reconciliação permitida pelo servidor (nunca troca "às cegas").
  const canAct = f.reconcilable && f.contextValue !== null;
  const act = (action: string, confirm: boolean) => canAct ? {
    action,
    actionAriaLabel: `${action} em "${f.label}": substituir "${shown(f.documentValue)}" por "${shown(f.contextValue)}" (origem: ${originLabel(f.contextOrigin)})`,
    confirmAction: confirm,
    confirmMessage: confirm
      ? `Substituir o valor de "${f.label}" no DFD?\n\nValor atual no DFD: ${shown(f.documentValue)}\nValor de origem: ${shown(f.contextValue)}\nOrigem: ${originLabel(f.contextOrigin)}\n\nO valor anterior fica no histórico.`
      : null,
  } : none;
  switch (f.state) {
    case "prefilled":
      return { ...base, text: `Preenchido pelo ${originLabel(f.origin)}`, tone: "neutral" };
    case "ai_draft":
      return { ...base, text: "Rascunho gerado por IA — revise antes de prosseguir", tone: "info" };
    case "user_modified":
      return f.origin === null
        ? { ...base, text: "Informado no DFD (sem informação de origem válida) — revise", tone: "neutral" }
        : { ...base, text: "Alterado por você", tone: "neutral" };
    case "stale":
      return { ...base, text: "Informação de origem atualizada", tone: "warning", details: fieldDetails(f), ...act("Atualizar no rascunho", false) };
    case "available":
      return canAct
        ? { ...base, text: `Informação disponível (${originLabel(f.contextOrigin)})`, tone: "info", details: fieldDetails(f), ...act("Atualizar no rascunho", false) }
        : { ...base, text: "Informação ainda não definida", tone: "muted" };
    case "conflict":
      return canAct
        ? { ...base, text: `Diverge da informação de origem (${originLabel(f.contextOrigin)})`, tone: "warning", details: fieldDetails(f), ...act("Usar informação de origem", true) }
        : { ...base, text: "Fontes em conflito — defina o valor no DFD", tone: "warning" };
    default:
      return { ...base, text: "Informação ainda não definida", tone: "muted" };
  }
}

/**
 * Decide se a ação de origem prossegue. Substituição de valor escrito pelo servidor SÓ com confirmação que
 * mostra os valores; cancelar = MANTER o valor do rascunho (nada é enviado). Sem valores ⇒ nunca prossegue.
 */
export function shouldProceedWithFieldAction(f: DFDFieldViewUI | undefined, confirm: (message: string) => boolean): boolean {
  if (!f) return false;
  const ind = fieldIndicator(f);
  if (!ind.action) return false;
  if (!ind.confirmAction) return true;
  return ind.confirmMessage !== null && confirm(ind.confirmMessage);
}

export interface AssistSummary { filled: number; pending: number; attention: number }

export function assistSummary(fields: readonly DFDFieldViewUI[]): AssistSummary {
  let filled = 0, pending = 0, attention = 0;
  for (const f of fields) {
    if (f.state === "prefilled" || f.state === "ai_draft" || f.state === "user_modified") filled++;
    else if (f.state === "unknown") pending++;
    else attention++;
  }
  return { filled, pending, attention };
}

/** Erros definitivos do write explícito ⇒ nova tentativa lógica (nova chave); transitório ⇒ mantém. */
export function shouldRotateAssistKeyOnError(code: string | null | undefined): boolean {
  return code === "CONFLICT" || code === "PRECONDITION_FAILED" || code === "BAD_REQUEST" || code === "NOT_FOUND";
}

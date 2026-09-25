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

export interface FieldIndicator {
  key: string;
  label: string;
  text: string;
  tone: FieldTone;
  /** Rótulo do botão de ação explícita (null = sem ação). */
  action: string | null;
  /** A ação substitui um valor escrito pelo servidor → exige confirmação. */
  confirmAction: boolean;
}

export function fieldIndicator(f: DFDFieldViewUI): FieldIndicator {
  const base = { key: f.key, label: f.label };
  switch (f.state) {
    case "prefilled":
      return { ...base, text: `Preenchido pelo ${originLabel(f.origin)}`, tone: "neutral", action: null, confirmAction: false };
    case "ai_draft":
      return { ...base, text: "Rascunho gerado por IA — revise antes de prosseguir", tone: "info", action: null, confirmAction: false };
    case "user_modified":
      return { ...base, text: "Alterado por você", tone: "neutral", action: null, confirmAction: false };
    case "stale":
      return { ...base, text: "Informação de origem atualizada", tone: "warning", action: f.reconcilable ? "Atualizar no rascunho" : null, confirmAction: false };
    case "available":
      return { ...base, text: `Informação disponível (${originLabel(f.contextOrigin)})`, tone: "info", action: "Atualizar no rascunho", confirmAction: false };
    case "conflict":
      return f.contextValue !== null && f.reconcilable
        ? { ...base, text: `Diverge da informação de origem (${originLabel(f.contextOrigin)})`, tone: "warning", action: "Usar informação de origem", confirmAction: true }
        : { ...base, text: "Fontes em conflito — defina o valor no DFD", tone: "warning", action: null, confirmAction: false };
    default:
      return { ...base, text: "Informação ainda não definida", tone: "muted", action: null, confirmAction: false };
  }
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

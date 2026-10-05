/**
 * SEM-058 — view-model PURO da sugestão de IA para a justificativa do DFD (testável sem DOM).
 *
 * Contrato: a IA só SUGERE. O texto atual do DFD é substituído apenas por um "Aceitar" humano explícito;
 * "Descartar"/fechar não tem efeito algum (nenhuma mutação, nenhum campo alterado). A origem do texto atual
 * (importado / pré-preenchido / escrito por servidor / IA aceita / vazio) é sempre exibida ao lado da sugestão.
 */

export type JustificationOriginUI = "empty" | "prefilled" | "ai_suggestion" | "imported" | "human_edited";

export interface JustificationSuggestionUI {
  suggestion: { text: string; textHash: string };
  explanation: {
    executionId: string; provider: string | null; model: string | null; promptVersion: string; unverifiedNumbers: string[];
  };
  current: { text: string | null; origin: JustificationOriginUI; originLabel: string; contentHash: string };
}

const ORIGIN_NOTE: Record<JustificationOriginUI, string> = {
  empty: "A seção ainda não tem texto.",
  prefilled: "Texto pré-preenchido pelo sistema a partir do processo.",
  ai_suggestion: "Texto que veio de uma sugestão de IA aceita antes.",
  imported: "Texto que veio do documento importado.",
  human_edited: "Texto escrito ou editado por servidor.",
};

export function originNote(origin: JustificationOriginUI): string {
  return ORIGIN_NOTE[origin];
}

/** A sugestão foi comparada com OUTRO conteúdo do DFD (o rascunho mudou desde então): não pode mais ser aceita. */
export function isSuggestionObsolete(s: JustificationSuggestionUI | null, docContentHash: string | null | undefined): boolean {
  return !!s && !!docContentHash && s.current.contentHash !== docContentHash;
}

/** Só substitui quando há texto atual a preservar no histórico: o aviso muda, o aceite continua explícito. */
export function replacesExistingText(s: JustificationSuggestionUI): boolean {
  return (s.current.text ?? "").trim() !== "";
}

export type AcceptBlock = "obsolete" | "unsaved_edits" | "empty_text" | "pending" | null;

/** Decide se o botão "Aceitar" pode agir — motivo explícito quando não pode (nunca falha em silêncio). */
export function acceptBlock(p: {
  suggestion: JustificationSuggestionUI | null; docContentHash: string | null | undefined; text: string; dirty: boolean; pending: boolean;
}): AcceptBlock {
  if (p.pending) return "pending";
  if (isSuggestionObsolete(p.suggestion, p.docContentHash)) return "obsolete";
  if (p.dirty) return "unsaved_edits";
  if (p.text.trim().length < 10) return "empty_text";
  return null;
}

export const ACCEPT_BLOCK_MESSAGES: Record<Exclude<AcceptBlock, null | "pending">, string> = {
  obsolete: "O rascunho do DFD mudou depois que esta sugestão foi gerada. Gere uma nova sugestão para comparar com o texto atual.",
  unsaved_edits: "Há alterações não salvas no editor. Salve-as (ou descarte-as) antes de aceitar: aceitar recarrega o DFD gravado.",
  empty_text: "Informe a justificativa (mínimo de 10 caracteres) para aceitar.",
};

export function acceptLabel(s: JustificationSuggestionUI): string {
  return replacesExistingText(s) ? "Aceitar e substituir o texto atual" : "Aceitar e inserir na seção 2";
}

export function discardLabel(): string {
  return "Descartar sugestão";
}

/** Entrada do aceite — o consentimento é literal e o texto é o que o servidor viu na tela (editado ou não). */
export function buildAcceptInput(p: {
  processId: string; docContentHash: string; suggestion: JustificationSuggestionUI; text: string; idempotencyKey: string;
}) {
  return {
    processId: p.processId,
    expectedContentHash: p.docContentHash,
    suggestionExecutionId: p.suggestion.explanation.executionId,
    text: p.text,
    confirmAccept: true as const,
    idempotencyKey: p.idempotencyKey,
  };
}

/** Texto do resultado após o aceite (o aviso de revisão permanece). */
export function acceptedMessage(edited: boolean): string {
  return edited
    ? "Justificativa registrada com a sua edição. O texto anterior ficou no histórico do DFD. Revise antes de prosseguir."
    : "Sugestão aceita e registrada na seção 2. O texto anterior ficou no histórico do DFD. Revise antes de prosseguir.";
}

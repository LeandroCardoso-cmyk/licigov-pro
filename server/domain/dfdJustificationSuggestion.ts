/**
 * SEM-058 — a justificativa do DFD gerada por IA é uma SUGESTÃO: só um aceite humano explícito a grava.
 *
 * Funções PURAS (sem DB/IA):
 *  - origem do texto ATUAL da seção 2 (vazio / pré-preenchido / sugestão de IA aceita / importado / escrito por humano),
 *    mostrada ao lado da sugestão para o servidor decidir com o texto vigente à vista;
 *  - assinatura do evento de timeline que prova que a sugestão foi gerada pelo servidor (tenant + processo): o aceite
 *    só vale para uma sugestão cujo hash de texto conste desse evento (sem tabela nova);
 *  - texto do `reason` do ledger (`generated_document_edits`) que registra a linhagem do aceite.
 */
import { createHash } from "node:crypto";
import type { DFDFieldState } from "./dfdPrefill";

export type JustificationOrigin = "empty" | "prefilled" | "ai_suggestion" | "imported" | "human_edited";

export const JUSTIFICATION_ORIGIN_LABELS: Record<JustificationOrigin, string> = {
  empty: "vazio (ainda não escrito)",
  prefilled: "pré-preenchido pelo sistema",
  ai_suggestion: "sugestão de IA já aceita anteriormente",
  imported: "importado de documento existente",
  human_edited: "escrito/editado por servidor",
};

const IMPORT_OPERATIONS: ReadonlySet<string> = new Set(["import_promote", "import_replace"]);

/**
 * Classifica a origem do texto vigente da justificativa. `lastEdit` = última linha do ledger do DFD;
 * só descreve o conteúdo vigente quando o hash confere (senão, houve mudança sem rastro ⇒ humano, conservador).
 */
export function classifyJustificationOrigin(p: {
  documentValue: string | null;
  state: DFDFieldState;
  sources: readonly string[];
  lastEdit: { operation: string; newContentHash: string } | null | undefined;
  contentHash: string;
}): JustificationOrigin {
  if (p.documentValue === null || p.documentValue.trim() === "") return "empty";
  if (p.state === "ai_draft") return "ai_suggestion";
  if (p.state === "prefilled") return "prefilled";
  const ledgerMatches = !!p.lastEdit && p.lastEdit.newContentHash === p.contentHash;
  if (ledgerMatches && IMPORT_OPERATIONS.has(p.lastEdit!.operation)) return "imported";
  if (!p.lastEdit && p.sources.includes("origem:import")) return "imported";
  return "human_edited";
}

/** Hash curto do texto da sugestão (normaliza espaços) — vincula o aceite à sugestão realmente gerada. */
export function suggestionTextHash(text: string): string {
  return createHash("sha256").update(text.replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}

/** Normaliza o id de execução para o limite de `process_timeline.ref_id` (40) e o charset dos marcadores. */
export function normalizeSuggestionExecutionId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
}

const EVENT_TAG = /\[sugestao:([a-f0-9]{16})\]$/;

/** Resumo do evento de timeline da SUGESTÃO gerada (não aceita; o DFD não foi alterado). */
export function suggestionEventSummary(executionId: string, textHash: string): string {
  return `DFD: sugestão de justificativa gerada por IA a pedido do servidor — NÃO aceita; o DFD não foi alterado (revisão obrigatória; execução ${executionId.slice(0, 24)}). [sugestao:${textHash}]`;
}

export function parseSuggestionEventHash(summary: string): string | null {
  return EVENT_TAG.exec(summary ?? "")?.[1] ?? null;
}

/** Linhagem do aceite no `reason` do ledger do documento (texto anterior = `previous_content` da mesma linha). */
export function acceptanceLedgerReason(p: {
  executionId: string; edited: boolean; previousOrigin: JustificationOrigin; suggestionTextHash: string; suggestionActor: string;
}): string {
  return JSON.stringify({
    kind: "ai_suggestion_accepted", source: "ai_suggestion", executionId: p.executionId, edited: p.edited,
    previousOrigin: p.previousOrigin, suggestionTextHash: p.suggestionTextHash, suggestionActor: p.suggestionActor,
  });
}

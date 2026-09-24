/**
 * U2A — Desfechos CANÔNICOS da extração de uma sessão de importação de LINHAS (Pesquisa de Preços, itens
 * de TR…) e as INVARIANTES de aprovação/promoção. Puro e determinístico (sem I/O). Não conhece Tesseract
 * nem pdf-parse: o domínio só enxerga o MODO de extração (`native_text` / `ocr` / `mixed`) e os códigos.
 *
 * Sem migration: o `status` persistido continua o enum existente (import_sessions.status); o desfecho fica
 * explícito no `stage` (varchar) + código em `errors[0].code` — ambos já expostos pelo getSessionStatus.
 *
 *   desfecho          status            stage              aprovável  promovível  próximo passo
 *   OCR_REQUIRED      failed            ocr_required       não        não         enviar PDF com texto/planilha
 *   OCR_PROCESSING    parsing           ocr_processing     —          —           aguardar
 *   OCR_FAILED        failed            ocr_failed         não        não         reprocessar ou enviar outro arquivo
 *   PARSER_FAILED     failed            parser_failed      não        não         enviar arquivo válido
 *   NO_VALID_ITEMS    failed            no_items           não        não         enviar arquivo com tabela de itens
 *   REVIEW_REQUIRED   awaiting_review   review_required    após revisão (≥1 aprovado)
 *   READY_FOR_REVIEW  awaiting_review   awaiting_review    após revisão (≥1 aprovado)
 *
 * INVARIANTES (não negociáveis): `validItemCount === 0 ⇒ aprovar PROIBIDO` e `⇒ promover PROIBIDO`.
 */

export type ExtractionMode = "native_text" | "ocr" | "mixed";

export type ImportOutcomeState =
  | "OCR_REQUIRED"
  | "OCR_PROCESSING"
  | "OCR_FAILED"
  | "PARSER_FAILED"
  | "NO_VALID_ITEMS"
  | "REVIEW_REQUIRED"
  | "READY_FOR_REVIEW";

export const OUTCOME_STAGE: Record<ImportOutcomeState, string> = {
  OCR_REQUIRED:     "ocr_required",
  OCR_PROCESSING:   "ocr_processing",
  OCR_FAILED:       "ocr_failed",
  PARSER_FAILED:    "parser_failed",
  NO_VALID_ITEMS:   "no_items",
  REVIEW_REQUIRED:  "review_required",
  READY_FOR_REVIEW: "awaiting_review",
};

/** Mensagens institucionais (sem PII, sem conteúdo do documento) com o PRÓXIMO PASSO explícito. */
export const OUTCOME_MESSAGE: Record<Exclude<ImportOutcomeState, "OCR_PROCESSING" | "REVIEW_REQUIRED" | "READY_FOR_REVIEW">, string> = {
  OCR_REQUIRED:
    "O PDF é digitalizado (somente imagem) e o reconhecimento de texto (OCR) não está disponível. Envie o PDF original com texto ou a planilha (XLSX/CSV).",
  OCR_FAILED:
    "O reconhecimento de texto (OCR) do PDF digitalizado não foi concluído. Tente reprocessar; se persistir, envie o PDF original com texto ou a planilha.",
  PARSER_FAILED:
    "Não foi possível ler o arquivo (inválido, corrompido ou protegido por senha). Envie um arquivo válido.",
  NO_VALID_ITEMS:
    "Nenhum item de preço foi reconhecido no arquivo — não há o que revisar nem aprovar. Envie um arquivo com a tabela de itens (descrição, quantidade, unidade e valor).",
};

/** Desfechos terminais de falha que PERMITEM nova tentativa sobre a MESMA sessão (sem staging revisado). */
export const RECOVERABLE_FAILURE_STAGES: ReadonlySet<string> = new Set([
  OUTCOME_STAGE.OCR_REQUIRED, OUTCOME_STAGE.OCR_FAILED, OUTCOME_STAGE.PARSER_FAILED, OUTCOME_STAGE.NO_VALID_ITEMS,
  // estágios genéricos já existentes (falha antes do U2A / retry esgotado)
  "failed", "retry",
]);

// ─── Invariantes de aprovação / promoção ────────────────────────────────────────

export type ImportInvariantCode = "NO_VALID_ITEMS_TO_APPROVE" | "NO_VALID_ITEMS_TO_PROMOTE" | "REVIEW_INCOMPLETE";

/** Violação de invariante de domínio (o router traduz para PRECONDITION_FAILED com o código no prefixo). */
export class ImportInvariantViolation extends Error {
  constructor(readonly code: ImportInvariantCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "ImportInvariantViolation";
  }
}

export interface StagingCounts { total: number; pending: number; approved: number }

/**
 * Aprovar uma sessão de linhas exige revisão completa (zero pendentes) E ao menos UM item aprovado.
 * Sessão sem itens (ou com todos rejeitados/pulados) NÃO é aprovável: aprovar "nada" é sucesso fingido.
 */
export function assertSessionApprovable(c: StagingCounts): void {
  if (c.pending > 0) {
    throw new ImportInvariantViolation("REVIEW_INCOMPLETE", `Revisão incompleta: ${c.pending} item(ns) pendente(s).`);
  }
  if (c.total === 0) {
    throw new ImportInvariantViolation("NO_VALID_ITEMS_TO_APPROVE", "a sessão não tem nenhum item extraído; não há o que aprovar.");
  }
  if (c.approved === 0) {
    throw new ImportInvariantViolation("NO_VALID_ITEMS_TO_APPROVE", "nenhum item foi aceito na revisão; aceite ao menos um item ou descarte a sessão.");
  }
}

/** Promover exige ao menos um item VÁLIDO (aprovado e com descrição). */
export function assertSessionPromotable(validItemCount: number): void {
  if (validItemCount <= 0) {
    throw new ImportInvariantViolation("NO_VALID_ITEMS_TO_PROMOTE", "nenhum item aprovado válido para promover.");
  }
}

// ─── Classificação do resultado do parser (worker) ──────────────────────────────

/** Códigos de erro fatal DETERMINÍSTICOS: reprocessar o mesmo arquivo não muda o resultado (sem auto-retry). */
const DETERMINISTIC_PARSER_ERRORS = new Set([
  "CORRUPT_FILE", "PROTECTED_PDF", "UNSUPPORTED_FORMAT", "EMPTY_FILE", "SIZE_EXCEEDED",
]);

export function isDeterministicParserError(code: string | undefined): boolean {
  return !!code && DETERMINISTIC_PARSER_ERRORS.has(code);
}

export interface RowsParseSignal {
  itemCount:    number;
  warningCodes: readonly string[];
  fatalCode?:   string;
  /** Algum item carrega aviso que exige atenção (OCR de baixa confiança, valor ambíguo…). */
  itemsNeedAttention: boolean;
}

/**
 * Desfecho DETERMINÍSTICO de uma extração de linhas. `null` = erro fatal transitório (o worker aplica o
 * retry/backoff existente). Nunca devolve estado de revisão com zero itens.
 */
export function classifyRowsOutcome(s: RowsParseSignal): ImportOutcomeState | null {
  if (s.fatalCode) {
    if (s.fatalCode === "OCR_FAILED") return "OCR_FAILED";
    return isDeterministicParserError(s.fatalCode) ? "PARSER_FAILED" : null;
  }
  if (s.itemCount === 0) {
    if (s.warningCodes.includes("OCR_FAILED")) return "OCR_FAILED";
    if (s.warningCodes.includes("OCR_REQUIRED")) return "OCR_REQUIRED";
    return "NO_VALID_ITEMS";
  }
  return s.itemsNeedAttention ? "REVIEW_REQUIRED" : "READY_FOR_REVIEW";
}

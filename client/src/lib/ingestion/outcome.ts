/**
 * U2A / U2A-OCR — Desfecho da extração explicado ao usuário (pt-BR institucional), a partir do estado
 * PERSISTIDO da sessão (status + stage + errors[0].code + resumo da linhagem). Puro e testável.
 *
 * Espelha server/domain/importOutcome.ts (OUTCOME_STAGE). Cada desfecho diz o PRÓXIMO PASSO e se faz
 * sentido reprocessar a mesma sessão (retry) ou enviar outro arquivo. Nada de "IA leu", "validado".
 */

export type OutcomeKind =
  | "ocr_processing"
  | "ocr_required"
  | "ocr_failed"
  | "parser_failed"
  | "no_items"
  | "staging_already_reviewed"
  | "review_required_ocr"
  | "none";

export interface OutcomeView {
  kind: OutcomeKind;
  title: string;
  message: string;
  /** Reprocessar a MESMA sessão pode mudar o resultado (ex.: falha do OCR). */
  canRetry: boolean;
  /** O caminho útil é enviar outro arquivo (PDF com texto, planilha…). */
  suggestNewFile: boolean;
  tone: "info" | "warning" | "danger";
}

export interface OutcomeSessionLike {
  status?: string | null;
  stage?: string | null;
  errors?: Array<{ code?: string; message?: string }> | null;
  extraction?: { mode?: string; ocrPages?: number; meanConfidence?: number | null } | null;
}

const NONE: OutcomeView = { kind: "none", title: "", message: "", canRetry: false, suggestNewFile: false, tone: "info" };

export function describeOutcome(s: OutcomeSessionLike | null | undefined): OutcomeView {
  if (!s) return NONE;
  const code = s.errors?.[0]?.code;
  const serverMessage = s.errors?.[0]?.message;

  if (s.status === "parsing" && s.stage === "ocr_processing") {
    return {
      kind: "ocr_processing", tone: "info", canRetry: false, suggestNewFile: false,
      title: "Reconhecendo o texto do PDF digitalizado (OCR)",
      message: "O arquivo não tem camada de texto; o reconhecimento pode levar alguns minutos. Os itens lidos passarão por revisão humana.",
    };
  }

  if (s.status === "failed") {
    if (s.stage === "ocr_required" || code === "OCR_REQUIRED") {
      return {
        kind: "ocr_required", tone: "warning", canRetry: false, suggestNewFile: true,
        title: "PDF digitalizado sem reconhecimento de texto disponível",
        message: serverMessage ?? "Envie o PDF original com texto ou a planilha (XLSX/CSV).",
      };
    }
    if (s.stage === "ocr_failed" || code === "OCR_FAILED") {
      return {
        kind: "ocr_failed", tone: "danger", canRetry: true, suggestNewFile: true,
        title: "O reconhecimento de texto (OCR) não foi concluído",
        message: serverMessage ?? "Tente reprocessar; se persistir, envie o PDF original com texto ou a planilha.",
      };
    }
    if (s.stage === "no_items" || code === "NO_VALID_ITEMS") {
      return {
        kind: "no_items", tone: "warning", canRetry: false, suggestNewFile: true,
        title: "Nenhum item de preço reconhecido",
        message: serverMessage ?? "Não há o que revisar nem aprovar. Envie um arquivo com a tabela de itens.",
      };
    }
    if (s.stage === "staging_already_reviewed" || code === "STAGING_ALREADY_REVIEWED") {
      return {
        kind: "staging_already_reviewed", tone: "warning", canRetry: false, suggestNewFile: false,
        title: "Reextração bloqueada",
        message: "Esta importação já tem itens revisados; eles não serão sobrescritos.",
      };
    }
    if (s.stage === "parser_failed") {
      return {
        kind: "parser_failed", tone: "danger", canRetry: code === "PARSE_ERROR", suggestNewFile: true,
        title: "Não foi possível ler o arquivo",
        message: code === "PARSE_ERROR"
          ? "O processamento falhou após novas tentativas. Reprocesse ou envie outro arquivo."
          : (serverMessage ?? "Envie um arquivo válido (não corrompido e sem senha)."),
      };
    }
    return NONE;
  }

  const mode = s.extraction?.mode;
  if ((s.status === "awaiting_review" || s.status === "approved") && (mode === "ocr" || mode === "mixed")) {
    const conf = typeof s.extraction?.meanConfidence === "number" ? ` Confiança média do reconhecimento: ${Math.round(s.extraction.meanConfidence)}%.` : "";
    return {
      kind: "review_required_ocr", tone: "warning", canRetry: false, suggestNewFile: false,
      title: mode === "mixed" ? "Parte dos itens foi lida por OCR" : "Itens lidos por OCR (PDF digitalizado)",
      message: `Confira descrição, quantidade e valores de cada item com o documento original antes de aceitar. Nenhum valor foi corrigido automaticamente.${conf}`,
    };
  }
  return NONE;
}

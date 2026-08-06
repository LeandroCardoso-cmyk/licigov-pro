/**
 * Sprint 2.8 — BaseParser + Parser Contracts.
 *
 * Contrato oficial de todos os parsers do motor de importação.
 * Cada parser é isolado, versionado, observável e com fallback.
 */
import type { RawExtractedItem } from "../domain/importExtraction";
import type { ImportWarning, ImportError, ExtractionSummary } from "../domain/importTypes";

// ─── Parser capabilities ──────────────────────────────────────────────────────

/**
 * Estado EXPLÍCITO de capacidade do parser — fonte única para o gating público (getCapabilities).
 * Não inferir suporte por convenção de versão ("-stub"): o parser DECLARA seu estado.
 *   - "supported": extração real disponível;
 *   - "stub":      contrato definido, sem extração real (não deve ser ofertado como funcional);
 *   - "disabled":  desligado operacionalmente (nunca ofertado).
 */
export type ParserCapabilityStatus = "supported" | "stub" | "disabled";

export interface ParserCapabilities {
  supportedMimeTypes:    string[];
  supportedExtensions:   string[];
  maxFileSizeBytes:      number;
  supportsStreaming:     boolean;
  supportsProgressEvents: boolean;
  parserVersion:         string;
  /** Estado explícito de capacidade (obrigatório) — dirige o que a UI pode ofertar. */
  capabilityStatus:      ParserCapabilityStatus;
  /** Se o parser extrai itens estruturados de fato (false em stubs). */
  supportsStructuredExtraction: boolean;
  /** Limitações conhecidas, exibíveis ao operador (ex.: "PDF: extração real na B.2.3"). */
  limitations?:          string[];
  requiresExternalLib?:  string; // nome da lib se não bundlada
}

// ─── Parse options ────────────────────────────────────────────────────────────

export interface ParseOptions {
  importSessionId:  number;
  organizationId:   number;
  sourceFileId:     string;
  sourceFileName:   string;
  sourceMimeType:   string;
  sourceChecksum:   string;
  locale?:          "pt-BR" | "en-US";
  maxItems?:        number;    // limite de segurança
  sheetName?:       string;    // forçar planilha específica
  headerRow?:       number;    // forçar linha de cabeçalho
  onProgress?:      (progress: number) => void;
}

// ─── Parse result ─────────────────────────────────────────────────────────────

export interface ParseResult {
  items:           RawExtractedItem[];
  warnings:        ImportWarning[];
  errors:          ImportError[];
  summary:         ExtractionSummary;
  rawMetadata:     Record<string, unknown>;
}

// ─── Observability hook ───────────────────────────────────────────────────────

export interface ParserObservability {
  onStart:   (sessionId: number, parserType: string) => void;
  onSuccess: (sessionId: number, summary: ExtractionSummary) => void;
  onFailure: (sessionId: number, error: ImportError) => void;
  onWarning: (sessionId: number, warning: ImportWarning) => void;
}

export const noopObservability: ParserObservability = {
  onStart:   () => {},
  onSuccess: () => {},
  onFailure: () => {},
  onWarning: () => {},
};

// ─── BaseParser ───────────────────────────────────────────────────────────────

export abstract class BaseParser {
  abstract readonly parserType:    string;
  abstract readonly capabilities:  ParserCapabilities;
  readonly observability:          ParserObservability = noopObservability;

  abstract canHandle(mimeType: string, extension: string): boolean;

  abstract parse(buffer: Buffer, options: ParseOptions): Promise<ParseResult>;

  /** Valida o arquivo antes de iniciar o parse */
  validate(buffer: Buffer, mimeType: string): ImportError | null {
    if (buffer.length === 0) {
      return { code: "EMPTY_FILE", message: "Arquivo vazio.", fatal: true };
    }
    if (buffer.length > this.capabilities.maxFileSizeBytes) {
      return {
        code:    "SIZE_EXCEEDED",
        message: `Arquivo excede o limite de ${Math.round(this.capabilities.maxFileSizeBytes / 1024 / 1024)}MB.`,
        fatal:   true,
      };
    }
    if (!this.capabilities.supportedMimeTypes.includes(mimeType) &&
        mimeType !== "application/octet-stream") {
      return {
        code:    "UNSUPPORTED_FORMAT",
        message: `Tipo MIME não suportado: ${mimeType}.`,
        fatal:   true,
      };
    }
    return null;
  }

  /** Executa parse com tratamento de erros e observabilidade */
  async safeParse(buffer: Buffer, options: ParseOptions): Promise<ParseResult> {
    const startMs = Date.now();
    this.observability.onStart(options.importSessionId, this.parserType);

    const validationError = this.validate(buffer, options.sourceMimeType);
    if (validationError) {
      const summary = this.emptySummary(Date.now() - startMs);
      this.observability.onFailure(options.importSessionId, validationError);
      return { items: [], warnings: [], errors: [validationError], summary, rawMetadata: {} };
    }

    try {
      const result = await this.parse(buffer, options);
      this.observability.onSuccess(options.importSessionId, result.summary);
      return result;
    } catch (err) {
      const error: ImportError = {
        code:    "PARSER_FAILURE",
        message: err instanceof Error ? err.message : String(err),
        fatal:   true,
        cause:   err instanceof Error ? err.stack : undefined,
      };
      this.observability.onFailure(options.importSessionId, error);
      const summary = this.emptySummary(Date.now() - startMs);
      return { items: [], warnings: [], errors: [error], summary, rawMetadata: {} };
    }
  }

  protected emptySummary(processingMs: number): ExtractionSummary {
    return {
      totalRowsRead:       0,
      totalItemsExtracted: 0,
      totalItemsSkipped:   0,
      totalWarnings:       0,
      totalErrors:         1,
      averageConfidence:   0,
      processingMs,
      parserType:          this.parserType,
      parserVersion:       this.capabilities.parserVersion,
    };
  }

  protected buildSummary(
    rowsRead:    number,
    items:       RawExtractedItem[],
    skipped:     number,
    warnings:    ImportWarning[],
    errors:      ImportError[],
    processingMs: number,
    extras?:     Partial<Pick<ExtractionSummary, "sheetsProcessed" | "pagesProcessed">>,
  ): ExtractionSummary {
    const avgConfidence = items.length > 0
      ? items.reduce((s, i) => s + i.confidenceMetadata.overallScore, 0) / items.length
      : 0;
    return {
      totalRowsRead:       rowsRead,
      totalItemsExtracted: items.length,
      totalItemsSkipped:   skipped,
      totalWarnings:       warnings.length,
      totalErrors:         errors.length,
      averageConfidence:   avgConfidence,
      processingMs,
      parserType:          this.parserType,
      parserVersion:       this.capabilities.parserVersion,
      ...extras,
    };
  }
}

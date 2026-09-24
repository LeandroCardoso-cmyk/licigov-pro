/**
 * U2A-OCR — PORTA de OCR (contrato do domínio). O domínio e os parsers conhecem apenas esta interface;
 * o motor concreto (Tesseract/WASM local) vive na infraestrutura (`server/providers/ocr/`).
 *
 * Princípio: OCR NÃO transforma incerteza em dado definitivo. O resultado carrega o texto BRUTO, as
 * palavras com caixa delimitadora e confiança, e avisos — a reconstrução de colunas é determinística e o
 * conteúdo segue para staging → revisão humana. Nada de LLM: o OCR não reconhece preço, não inventa coluna,
 * não corrige valores.
 */

export interface OcrBBox { x0: number; y0: number; x1: number; y1: number }

export interface OcrWord {
  text:       string;
  /** 0–100 (escala do motor). */
  confidence: number;
  bbox:       OcrBBox;
}

export interface OcrLine {
  text:       string;
  confidence: number;
  bbox:       OcrBBox;
  words:      OcrWord[];
}

export interface OcrPageResult {
  pageNumber: number;
  /** Texto bruto reconhecido na página (preservado para auditoria/replay). */
  text:       string;
  confidence: number;
  width:      number;
  height:     number;
  lines:      OcrLine[];
  durationMs: number;
  warnings:   string[];
}

export interface OcrResult {
  text:          string;
  pages:         OcrPageResult[];
  warnings:      string[];
  /** Média das confianças por página (0–100). */
  confidence:    number;
  engine:        string;
  engineVersion: string;
  language:      string;
  durationMs:    number;
  metadata:      Record<string, unknown>;
}

export interface OcrPageImage { pageNumber: number; image: Buffer; width: number; height: number }

export interface OcrRecognizeOptions {
  /** Orçamento total (ms) — ao estourar, o motor é encerrado e a chamada rejeita com OcrError("OCR_TIMEOUT"). */
  timeoutMs: number;
}

/** Identidade REPRODUTÍVEL do motor/configuração (entra no fingerprint de replay). */
export interface OcrEngineIdentity {
  engine:        string;
  engineVersion: string;
  coreVersion:   string;
  language:      string;
  languageDataVersion: string;
  /** Configuração que influencia a saída (PSM/OEM etc.), serializada de forma estável. */
  config:        Record<string, string | number | boolean>;
}

export interface OcrPort {
  identity(): OcrEngineIdentity;
  recognize(pages: OcrPageImage[], opts: OcrRecognizeOptions): Promise<OcrResult>;
}

export type OcrErrorCode = "OCR_TIMEOUT" | "OCR_ENGINE_UNAVAILABLE" | "OCR_ENGINE_FAILURE";

export class OcrError extends Error {
  constructor(readonly code: OcrErrorCode, message: string) {
    super(message);
    this.name = "OcrError";
  }
}

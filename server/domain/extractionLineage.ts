/**
 * U2A-OCR — LINHAGEM da extração de uma sessão (texto nativo × OCR) e FINGERPRINT de replay.
 *
 * O fingerprint fixa TUDO o que determina a saída: checksum do arquivo, modo por página, heurística de
 * texto útil, motor/versão/núcleo/idioma/dados de idioma/configuração do OCR, largura de renderização,
 * versão do layout e do parser. Reprocessar o MESMO arquivo com a MESMA configuração produz o MESMO
 * fingerprint; qualquer mudança de motor/configuração muda o fingerprint (a linhagem registra o motivo).
 *
 * NÃO-DETERMINISMO registrado: o OCR pode variar entre CPUs/SIMD do WASM mesmo com a mesma configuração.
 * Por isso a linhagem guarda também `ocr.outputDigest` (sha256 do texto bruto reconhecido): um replay pode
 * comparar a saída, e a revisão humana continua obrigatória. Puro (usa só `crypto` para hash).
 */
import { createHash } from "crypto";
import type { ExtractionMode } from "./importOutcome";
import type { OcrEngineIdentity } from "./ocr";

export const EXTRACTION_LINEAGE_VERSION = "1";

export type PageExtractionMode = "native_text" | "ocr" | "skipped";

export interface OcrLineageInfo {
  engine:              string;
  engineVersion:       string;
  coreVersion:         string;
  language:            string;
  languageDataVersion: string;
  config:              Record<string, string | number | boolean>;
  renderWidth:         number;
  layoutVersion:       string;
  pagesRequested:      number;
  pagesProcessed:      number;
  meanConfidence:      number;
  durationMs:          number;
  warningsCount:       number;
  /** sha256 do texto bruto do OCR (comparação de replay; nunca o texto em si). */
  outputDigest:        string | null;
  /** Chave do artefato derivado (texto bruto por página) no storage, quando gravado. */
  artifactKey?:        string | null;
  nondeterministic:    true;
  failure?:            { code: string; message: string } | null;
}

export interface ExtractionLineage {
  lineageVersion:    string;
  extractionMode:    ExtractionMode;
  pageModes:         Record<string, PageExtractionMode>;
  sourceChecksum:    string;
  parserType:        string;
  parserVersion:     string;
  heuristicVersion:  string;
  pageCount:         number;
  nativePages:       number;
  ocrPages:          number;
  /** Motivo do OCR: páginas sem texto útil, ou texto nativo sem nenhuma linha de item. */
  ocrReason:         "no_useful_text" | "native_text_without_items" | null;
  ocr:               OcrLineageInfo | null;
  fingerprint:       string;
  // Preenchidos pelo worker:
  correlationId?:    string | null;
  startedAt?:        string;
  finishedAt?:       string;
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function deriveExtractionMode(pageModes: Record<string, PageExtractionMode>): ExtractionMode {
  const modes = Object.values(pageModes);
  const ocr = modes.filter((m) => m === "ocr").length;
  const native = modes.filter((m) => m === "native_text").length;
  if (ocr > 0 && native > 0) return "mixed";
  return ocr > 0 ? "ocr" : "native_text";
}

/** Fingerprint estável (chaves e páginas ordenadas) — independe de horário, sessão ou correlationId. */
export function computeExtractionFingerprint(input: {
  sourceChecksum: string;
  parserType: string;
  parserVersion: string;
  heuristicVersion: string;
  pageModes: Record<string, PageExtractionMode>;
  ocr: Pick<OcrEngineIdentity, "engine" | "engineVersion" | "coreVersion" | "language" | "languageDataVersion" | "config"> & { renderWidth: number; layoutVersion: string } | null;
}): string {
  const pages = Object.keys(input.pageModes).map(Number).sort((a, b) => a - b).map((p) => [p, input.pageModes[String(p)]]);
  const ocr = input.ocr
    ? [input.ocr.engine, input.ocr.engineVersion, input.ocr.coreVersion, input.ocr.language, input.ocr.languageDataVersion,
       Object.keys(input.ocr.config).sort().map((k) => [k, input.ocr!.config[k]]), input.ocr.renderWidth, input.ocr.layoutVersion]
    : null;
  return sha256Hex(JSON.stringify([
    "extraction-lineage/v1", input.sourceChecksum.toLowerCase(), input.parserType, input.parserVersion,
    input.heuristicVersion, pages, ocr,
  ]));
}

/**
 * U2A-OCR — Adapter de INFRAESTRUTURA: OCR local com Tesseract (tesseract.js 7 / WASM) + dados de
 * idioma português empacotados (@tesseract.js-data/por). Implementa a porta `OcrPort` do domínio.
 *
 * - 100% local/offline: sem serviço externo, sem conta, sem credencial, sem variável secreta. O modelo de
 *   idioma é lido do node_modules (langPath local, gzip) e NUNCA baixado em runtime (cacheMethod "none" —
 *   nada é gravado em disco; compatível com filesystem somente-leitura do Railway).
 * - Um worker Tesseract por chamada (criado → páginas em sequência → encerrado no finally): memória
 *   devolvida ao fim de cada arquivo; nada fica residente entre importações.
 * - Orçamento de tempo TOTAL: ao estourar, o worker é encerrado (terminate) e a chamada rejeita com
 *   OcrError("OCR_TIMEOUT") — nunca fica pendurada.
 * - Concorrência limitada por processo (semáforo; default 1) — a fila de importação já é serial.
 * - Não loga conteúdo do documento (apenas contagens/tempos no chamador).
 */
import { createRequire } from "node:module";
import type { OcrEngineIdentity, OcrLine, OcrPageImage, OcrPageResult, OcrPort, OcrRecognizeOptions, OcrResult, OcrWord } from "../../domain/ocr";
import { OcrError } from "../../domain/ocr";

const require = createRequire(import.meta.url);

/** PSM 6 = bloco uniforme de texto: preserva as LINHAS de tabela (a reconstrução de colunas é nossa). */
const PAGESEG_MODE = "6";
/** OEM 1 = LSTM apenas (modelo do pacote por/4.0.0). */
const OEM_LSTM_ONLY = 1;
const LANGUAGE = "por";

interface TesseractWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }
interface TesseractLine { text: string; confidence: number; bbox: TesseractWord["bbox"]; words: TesseractWord[] }
interface TesseractPage {
  text: string; confidence: number;
  blocks: Array<{ paragraphs: Array<{ lines: TesseractLine[] }> }> | null;
}
interface TesseractWorker {
  setParameters(p: Record<string, string>): Promise<unknown>;
  recognize(image: Buffer, opts?: Record<string, unknown>, output?: Record<string, boolean>): Promise<{ data: TesseractPage }>;
  terminate(): Promise<unknown>;
}
interface TesseractModule {
  createWorker(langs: string, oem: number, options: Record<string, unknown>): Promise<TesseractWorker>;
}

function readVersion(pkgJsonPath: string): string {
  try { return String((require(pkgJsonPath) as { version?: string }).version ?? "unknown"); } catch { return "unknown"; }
}

function resolveLanguageData(): { langPath: string; version: string } {
  const pkg = require("@tesseract.js-data/por") as { langPath: string };
  return { langPath: pkg.langPath, version: `@tesseract.js-data/por@${readVersion("@tesseract.js-data/por/package.json")}/${pkg.langPath.split(/[\\/]/).pop()}` };
}

function coreVersion(): string {
  try {
    const fromTesseract = createRequire(require.resolve("tesseract.js"));
    return readVersion(fromTesseract.resolve("tesseract.js-core/package.json"));
  } catch { return "unknown"; }
}

/** Semáforo simples (FIFO) para limitar reconhecimentos simultâneos no processo. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.max) await new Promise<void>((r) => this.waiters.push(r));
    this.active++;
    return () => { this.active--; this.waiters.shift()?.(); };
  }
}

export class TesseractOcrAdapter implements OcrPort {
  private readonly semaphore: Semaphore;
  private cachedIdentity: OcrEngineIdentity | null = null;

  constructor(opts: { maxConcurrency: number }) {
    this.semaphore = new Semaphore(Math.max(1, opts.maxConcurrency));
  }

  identity(): OcrEngineIdentity {
    if (!this.cachedIdentity) {
      this.cachedIdentity = {
        engine:              "tesseract.js",
        engineVersion:       readVersion("tesseract.js/package.json"),
        coreVersion:         coreVersion(),
        language:            LANGUAGE,
        languageDataVersion: resolveLanguageData().version,
        config:              { psm: PAGESEG_MODE, oem: OEM_LSTM_ONLY, preserve_interword_spaces: "1" },
      };
    }
    return this.cachedIdentity;
  }

  async recognize(pages: OcrPageImage[], opts: OcrRecognizeOptions): Promise<OcrResult> {
    const release = await this.semaphore.acquire();
    const startMs = Date.now();
    let worker: TesseractWorker | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    try {
      let mod: TesseractModule;
      let langPath: string;
      try {
        mod = (await import("tesseract.js")).default as unknown as TesseractModule;
        langPath = resolveLanguageData().langPath;
      } catch (err) {
        throw new OcrError("OCR_ENGINE_UNAVAILABLE", `Motor de OCR indisponível: ${err instanceof Error ? err.message : String(err)}`);
      }

      const run = async (): Promise<OcrPageResult[]> => {
        worker = await mod.createWorker(LANGUAGE, OEM_LSTM_ONLY, {
          langPath, gzip: true, cacheMethod: "none",
          // Erros do worker viram rejeição da chamada (nunca console/stdout com conteúdo).
          errorHandler: () => {},
        });
        await worker.setParameters({ tessedit_pageseg_mode: PAGESEG_MODE, preserve_interword_spaces: "1" });
        const out: OcrPageResult[] = [];
        for (const p of pages) {
          if (timedOut) break;
          const t0 = Date.now();
          const { data } = await worker.recognize(p.image, {}, { text: true, blocks: true });
          out.push(toPageResult(p, data, Date.now() - t0));
        }
        return out;
      };

      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new OcrError("OCR_TIMEOUT", `Tempo de OCR excedido (${opts.timeoutMs} ms).`));
        }, opts.timeoutMs);
      });

      let pageResults: OcrPageResult[];
      try {
        pageResults = await Promise.race([run(), timeout]);
      } catch (err) {
        if (err instanceof OcrError) throw err;
        throw new OcrError("OCR_ENGINE_FAILURE", `Falha no motor de OCR: ${err instanceof Error ? err.message : String(err)}`);
      }

      const id = this.identity();
      const confidence = pageResults.length ? pageResults.reduce((s, p) => s + p.confidence, 0) / pageResults.length : 0;
      return {
        text:          pageResults.map((p) => p.text).join("\n\f\n"),
        pages:         pageResults,
        warnings:      pageResults.flatMap((p) => p.warnings.map((w) => `p${p.pageNumber}:${w}`)),
        confidence,
        engine:        id.engine,
        engineVersion: id.engineVersion,
        language:      id.language,
        durationMs:    Date.now() - startMs,
        metadata:      { coreVersion: id.coreVersion, languageDataVersion: id.languageDataVersion, config: id.config },
      };
    } finally {
      if (timer) clearTimeout(timer);
      const w = worker as TesseractWorker | null;
      if (w) { try { await w.terminate(); } catch { /* já encerrado */ } }
      release();
    }
  }
}

function toPageResult(p: OcrPageImage, data: TesseractPage, durationMs: number): OcrPageResult {
  const lines: OcrLine[] = [];
  for (const b of data.blocks ?? []) {
    for (const para of b.paragraphs ?? []) {
      for (const l of para.lines ?? []) {
        const words: OcrWord[] = (l.words ?? [])
          .filter((w) => (w.text ?? "").trim() !== "")
          .map((w) => ({ text: w.text.trim(), confidence: w.confidence, bbox: { ...w.bbox } }));
        if (words.length) lines.push({ text: (l.text ?? "").trim(), confidence: l.confidence, bbox: { ...l.bbox }, words });
      }
    }
  }
  const warnings: string[] = [];
  if (lines.length === 0) warnings.push("NO_TEXT_RECOGNIZED");
  return {
    pageNumber: p.pageNumber, text: data.text ?? "", confidence: data.confidence ?? 0,
    width: p.width, height: p.height, lines, durationMs, warnings,
  };
}

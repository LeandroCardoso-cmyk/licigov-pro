/**
 * U2A-OCR — Configuração do OCR LOCAL (Tesseract/WASM, sem serviço externo, sem credencial, sem segredo).
 * Mesmo padrão de `config/email.ts`: resolução pura/testável a partir do ambiente.
 *
 * ENV (todas opcionais — nenhuma é segredo):
 *   OCR_ENABLED          = true | false   (default: true; false na suíte de testes — os testes injetam o adapter)
 *   OCR_MAX_PAGES        = páginas digitalizadas processadas por arquivo       (default 20, teto 100)
 *   OCR_TIMEOUT_MS       = orçamento TOTAL de OCR por arquivo, em ms            (default 180000, teto 900000)
 *   OCR_RENDER_WIDTH     = largura (px) da renderização de cada página p/ OCR   (default 2000, 800..3000)
 *   OCR_MIN_CONFIDENCE   = confiança (0–100) abaixo da qual a célula vira aviso (default 75)
 *   OCR_MAX_CONCURRENCY  = reconhecimentos simultâneos no processo               (default 1, teto 2)
 *
 * Desligar (`OCR_ENABLED=false`) é o kill-switch operacional: o PDF digitalizado volta ao desfecho
 * explícito OCR_REQUIRED (nunca "sucesso vazio").
 */

export interface OcrConfigEnv {
  OCR_ENABLED?: string;
  OCR_MAX_PAGES?: string;
  OCR_TIMEOUT_MS?: string;
  OCR_RENDER_WIDTH?: string;
  OCR_MIN_CONFIDENCE?: string;
  OCR_MAX_CONCURRENCY?: string;
}

export interface OcrConfig {
  enabled:        boolean;
  maxPages:       number;
  timeoutMs:      number;
  renderWidth:    number;
  minConfidence:  number;
  maxConcurrency: number;
}

function intIn(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw ? parseInt(raw.trim(), 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function resolveOcrConfig(env: OcrConfigEnv, ctx: { isTest: boolean }): OcrConfig {
  const rawEnabled = (env.OCR_ENABLED ?? "").trim().toLowerCase();
  const enabled = rawEnabled === "true" ? true : rawEnabled === "false" ? false : !ctx.isTest;
  return {
    enabled,
    maxPages:       intIn(env.OCR_MAX_PAGES, 20, 1, 100),
    timeoutMs:      intIn(env.OCR_TIMEOUT_MS, 180_000, 5_000, 900_000),
    renderWidth:    intIn(env.OCR_RENDER_WIDTH, 2000, 800, 3000),
    minConfidence:  intIn(env.OCR_MIN_CONFIDENCE, 75, 0, 100),
    maxConcurrency: intIn(env.OCR_MAX_CONCURRENCY, 1, 1, 2),
  };
}

export const OCR_CONFIG: OcrConfig = resolveOcrConfig(
  {
    OCR_ENABLED:         process.env.OCR_ENABLED,
    OCR_MAX_PAGES:       process.env.OCR_MAX_PAGES,
    OCR_TIMEOUT_MS:      process.env.OCR_TIMEOUT_MS,
    OCR_RENDER_WIDTH:    process.env.OCR_RENDER_WIDTH,
    OCR_MIN_CONFIDENCE:  process.env.OCR_MIN_CONFIDENCE,
    OCR_MAX_CONCURRENCY: process.env.OCR_MAX_CONCURRENCY,
  },
  { isTest: process.env.VITEST === "true" },
);

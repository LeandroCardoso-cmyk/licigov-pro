/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * U2A / U2A-OCR — WORKER da fila existente com o parser de PDF REAL e porta de OCR INJETADA (determinística).
 *
 * Cobre os desfechos persistidos na sessão (status + stage + código), sem banco:
 *   OCR_REQUIRED (OCR desligado) · OCR_FAILED (motor falha; sem auto-retry) · NO_VALID_ITEMS (OCR sem linhas)
 *   · REVIEW_REQUIRED (itens por OCR → staging) · OCR_PROCESSING observável · PARSER_FAILED determinístico
 *   (sem retry) · reextração substitui staging intocado · staging revisado NUNCA é sobrescrito · artefato do
 *   OCR ao lado do original (imutável) · linhagem com correlationId · log estruturado SEM conteúdo do documento.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const store = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../../storage", () => ({
  storageGetBytes: vi.fn(async (k: string) => { const b = store.get(k); if (!b) throw new Error("vazio"); return b; }),
  storagePut: vi.fn(async (k: string, d: string | Buffer) => { store.set(k, Buffer.from(d)); return { key: k, url: "" }; }),
}));
vi.mock("../../services/fileIngestionService", () => ({
  getImportSession: vi.fn(),
  updateSessionStatus: vi.fn().mockResolvedValue(undefined),
  listStuckImportSessions: vi.fn().mockResolvedValue([]),
  claimSessionForRecovery: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../services/importStagingService", async () => {
  class StagingAlreadyReviewedError extends Error { constructor(readonly touched: number) { super(`STAGING_ALREADY_REVIEWED: ${touched}`); } }
  return { StagingAlreadyReviewedError, replaceUnreviewedStagingItems: vi.fn(async (_s: number, _o: number, items: unknown[]) => ({ ids: items.map((_, i) => i + 1), replaced: 0 })) };
});
vi.mock("../../services/featureFlagService", () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(true) }));

import { enqueueImport, getJobStatus } from "../../services/importQueueService";
import * as ingestion from "../../services/fileIngestionService";
import * as staging from "../../services/importStagingService";
import * as storage from "../../storage";
import { setOcrAdapterForTesting } from "../../providers/ocr";
import { OcrError, type OcrPort, type OcrResult } from "../../domain/ocr";
import { scannedPdf, textTablePdf, PRICE_TABLE } from "../fixtures/ocrPdfFixtures";

const IDENTITY = { engine: "fake-ocr", engineVersion: "1.0.0", coreVersion: "1", language: "por", languageDataVersion: "t", config: { psm: "6" } };
const w = (text: string, x0: number, y0: number, confidence = 95) => ({ text, confidence, bbox: { x0, y0, x1: x0 + text.length * 12, y1: y0 + 22 } });
function ocrTable(rows: string[][]): OcrResult {
  const xs = [40, 300, 440, 600, 760];
  const words = rows.flatMap((r, ri) => r.map((t, ci) => w(t, xs[ci], 100 + ri * 40)));
  return {
    text: rows.map((r) => r.join(" ")).join("\n"), confidence: 90, engine: "fake-ocr", engineVersion: "1.0.0", language: "por", durationMs: 1, metadata: {}, warnings: [],
    pages: [{ pageNumber: 1, text: rows.map((r) => r.join(" ")).join("\n"), confidence: 90, width: 1700, height: 2200, durationMs: 1, warnings: [], lines: [{ text: "", confidence: 90, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words }] }],
  };
}
const TABLE = [["Descricao", "Unidade", "Quantidade", "Valor", "Total"], ["Cadeira", "UN", "10", "1.234,56", "12.345,60"], ["Mesa", "UN", "2", "850,00", "1.700,00"]];
const port = (impl: OcrPort["recognize"]): OcrPort => ({ identity: () => IDENTITY, recognize: vi.fn(impl) });

let seq = 500;
let scanned: Buffer;
async function run(bytes: Buffer, over: Record<string, unknown> = {}) {
  const id = ++seq;
  const key = `imports/1/${id}-cotacao.pdf`;
  store.set(key, bytes);
  vi.mocked(ingestion.getImportSession).mockResolvedValue({
    id, organizationId: 1, sourceFileId: key, sourceFileName: "cotacao.pdf", sourceMimeType: "application/pdf",
    parserType: "pdf", importType: "price_research", checksum: "e".repeat(64), procurementProcessId: "PROC-1", correlationId: "corr-ocr", ...over,
  } as any);
  const jobId = enqueueImport(id, 1, key, { correlationId: "corr-ocr" })!;
  for (let i = 0; i < 400; i++) {
    const s = getJobStatus(jobId)?.status;
    if (s === "done" || s === "failed" || s === "dlq") break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const calls = vi.mocked(ingestion.updateSessionStatus).mock.calls.filter((c) => c[0] === id);
  return { id, key, jobId, calls, last: calls[calls.length - 1] };
}

let logs: string[] = [];
let spies: Array<{ mockRestore(): void }> = [];
beforeEach(async () => {
  vi.clearAllMocks();
  scanned ??= await scannedPdf([PRICE_TABLE]);
  logs = [];
  spies = (["info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation((l: unknown) => { logs.push(String(l)); }));
}, 30_000);
afterEach(() => { setOcrAdapterForTesting(undefined); spies.forEach((s) => s.mockRestore()); });

describe("worker — desfechos explícitos (nunca revisão com zero itens)", { timeout: 30_000 }, () => {
  it("OCR desligado ⇒ failed/ocr_required, sem staging, sem retry", async () => {
    setOcrAdapterForTesting(null);
    const r = await run(scanned);
    expect(r.last[2]).toBe("failed");
    expect(r.last[3]).toMatchObject({ stage: "ocr_required", errors: [{ code: "OCR_REQUIRED", fatal: true }] });
    expect(staging.replaceUnreviewedStagingItems).not.toHaveBeenCalled();
    expect(r.calls.some((c) => c[2] === "queued")).toBe(false); // sem auto-retry
  });

  it("motor falha ⇒ failed/ocr_failed (linhagem registra a falha); sem auto-retry", async () => {
    setOcrAdapterForTesting(port(async () => { throw new OcrError("OCR_ENGINE_FAILURE", "x"); }));
    const r = await run(scanned);
    expect(r.last[3]).toMatchObject({ stage: "ocr_failed", errors: [{ code: "OCR_FAILED" }] });
    expect((r.last[3] as any).extractionSummary.extraction.ocr.failure.code).toBe("OCR_ENGINE_FAILURE");
    expect(r.calls.some((c) => c[2] === "queued")).toBe(false);
  });

  it("OCR sem linhas de item ⇒ failed/no_items (NO_VALID_ITEMS)", async () => {
    setOcrAdapterForTesting(port(async () => ocrTable([["Oficio", "de", "encaminhamento"], ["Secretaria", "de", "Administracao"]])));
    const r = await run(scanned);
    expect(r.last[3]).toMatchObject({ stage: "no_items", errors: [{ code: "NO_VALID_ITEMS" }] });
    expect(staging.replaceUnreviewedStagingItems).not.toHaveBeenCalled();
  });

  it("OCR com itens ⇒ OCR_PROCESSING observável → staging → awaiting_review/review_required + linhagem + artefato", async () => {
    setOcrAdapterForTesting(port(async () => ocrTable(TABLE)));
    const r = await run(scanned);
    expect(r.calls.some((c) => c[2] === "parsing" && (c[3] as any)?.stage === "ocr_processing")).toBe(true);
    expect(r.last[2]).toBe("awaiting_review");
    expect(r.last[3]).toMatchObject({ stage: "review_required", errors: [] });
    const items = vi.mocked(staging.replaceUnreviewedStagingItems).mock.calls[0][2] as any[];
    expect(items.map((i) => [i.rawDescription, i.rawUnitPrice])).toEqual([["Cadeira", "1.234,56"], ["Mesa", "850,00"]]);
    const lineage = (r.last[3] as any).extractionSummary.extraction;
    expect(lineage).toMatchObject({ extractionMode: "ocr", correlationId: "corr-ocr", sourceChecksum: "e".repeat(64), ocr: { engine: "fake-ocr", engineVersion: "1.0.0" } });
    expect(lineage.startedAt).toBeTruthy();
    // Artefato DERIVADO gravado ao lado do original; o original permanece intacto.
    expect(lineage.ocr.artifactKey).toBe(`${r.key}.ocr-${lineage.fingerprint.slice(0, 16)}.json`);
    expect(store.get(r.key)!.equals(scanned)).toBe(true);
    expect(JSON.parse(store.get(lineage.ocr.artifactKey)!.toString()).pages[0].text).toMatch(/Cadeira/);
  });

  it("log estruturado do desfecho tem os identificadores e NENHUM conteúdo do documento", async () => {
    setOcrAdapterForTesting(port(async () => ocrTable(TABLE)));
    await run(scanned);
    const line = logs.find((l) => l.includes("import_extraction_outcome"))!;
    const e = JSON.parse(line);
    expect(e).toMatchObject({ correlationId: "corr-ocr", organizationId: 1, processId: "PROC-1", extractionMode: "ocr", ocrEngine: "fake-ocr", ocrEngineVersion: "1.0.0", pageCount: 1, finalState: "REVIEW_REQUIRED", items: 2 });
    expect(e.checksum).toBe("e".repeat(64));
    expect(logs.join("\n")).not.toMatch(/Cadeira|1\.234,56/);
  });

  it("PDF nativo não aciona o OCR e segue para revisão", async () => {
    const p = port(async () => ocrTable(TABLE));
    setOcrAdapterForTesting(p);
    const r = await run(await textTablePdf([PRICE_TABLE]));
    expect(p.recognize).not.toHaveBeenCalled();
    expect(r.last[2]).toBe("awaiting_review");
    expect((r.last[3] as any).extractionSummary.extraction.extractionMode).toBe("native_text");
  });

  it("PDF corrompido ⇒ PARSER_FAILED terminal SEM retry (determinístico)", async () => {
    setOcrAdapterForTesting(null);
    const r = await run(Buffer.from("%PDF-1.4 corrompido"));
    expect(r.last[2]).toBe("failed");
    expect((r.last[3] as any).stage).toBe("parser_failed");
    expect(r.calls.some((c) => c[2] === "queued")).toBe(false);
  });

  it("staging já revisado por humano ⇒ reextração bloqueada (nunca sobrescreve decisão)", async () => {
    setOcrAdapterForTesting(port(async () => ocrTable(TABLE)));
    vi.mocked(staging.replaceUnreviewedStagingItems).mockRejectedValueOnce(new (staging as any).StagingAlreadyReviewedError(2));
    const r = await run(scanned);
    expect(r.last[2]).toBe("failed");
    expect(r.last[3]).toMatchObject({ stage: "staging_already_reviewed", errors: [{ code: "STAGING_ALREADY_REVIEWED" }] });
  });

  it("falha ao gravar o artefato NÃO derruba a extração (fail-soft, registrado)", async () => {
    setOcrAdapterForTesting(port(async () => ocrTable(TABLE)));
    vi.mocked(storage.storagePut).mockRejectedValueOnce(new Error("s3 indisponível"));
    const r = await run(scanned);
    expect(r.last[2]).toBe("awaiting_review");
    expect((r.last[3] as any).extractionSummary.extraction.ocr.artifactKey).toBeNull();
    expect(logs.some((l) => l.includes("ocr_artifact_not_stored"))).toBe(true);
  });

  it("modo documento (DFD/ETP/TR) não recebe a porta de OCR", async () => {
    const p = port(async () => ocrTable(TABLE));
    setOcrAdapterForTesting(p);
    const r = await run(scanned, { importType: "document_dfd" });
    expect(p.recognize).not.toHaveBeenCalled();
    expect(r.last[3]).toMatchObject({ errors: [{ code: "OCR_REQUIRED" }] });
  });
});

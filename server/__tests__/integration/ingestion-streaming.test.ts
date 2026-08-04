/**
 * PR B.2.1 — Testes do upload em STREAMING (streamFileToStorage).
 * Cobre: streaming feliz (SHA-256 incremental, sem Buffer completo), limite aplicado durante
 * o fluxo com abort, conteúdo divergente do MIME, checksum divergente, interrupção do cliente
 * no meio do upload, cleanup de objeto parcial em falha, e concorrência de uploads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "node:stream";
import { createHash } from "crypto";

// Storage mockado: storagePutStream drena o stream (como o S3 faria); storageDelete registra cleanup.
vi.mock("../../storage", () => ({
  storagePutStream: vi.fn().mockImplementation(async (key: string, body: Readable) => {
    // Consome o stream até o fim (respeitando backpressure); propaga erro se o sink for destruído.
    for await (const _chunk of body) { void _chunk; }
    return { key };
  }),
  storageDelete: vi.fn().mockResolvedValue({ key: "x", deleted: true }),
}));

import { streamFileToStorage } from "../../services/ingestionUploadService";
import * as storage from "../../storage";

const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MIME_CSV  = "text/csv";

/** ZIP (OOXML) header + preenchimento até `size` bytes. */
function zipBytes(size = 64): Buffer {
  const b = Buffer.alloc(size, 0x20);
  b[0] = 0x50; b[1] = 0x4b; b[2] = 0x03; b[3] = 0x04;
  return b;
}
const pdfBytes = () => Buffer.from("%PDF-1.4\n" + "x".repeat(40), "latin1");
const csvBytes = () => Buffer.from("fornecedor,item\nACME,Caneta\n".repeat(3), "utf-8");

/** Readable que emite os chunks e então ERRA (simula queda/interrupção do cliente). */
function interruptedSource(chunks: Buffer[]): Readable {
  let i = 0;
  return new Readable({
    read() {
      if (i < chunks.length) { this.push(chunks[i++]); }
      else { this.destroy(new Error("conexão interrompida pelo cliente")); }
    },
  });
}

beforeEach(() => vi.clearAllMocks());

describe("streamFileToStorage — caminho feliz", () => {
  it("faz streaming ao storage e calcula SHA-256 incremental (sem Buffer completo)", async () => {
    const buf = zipBytes(128);
    const r = await streamFileToStorage({
      source: Readable.from([buf.subarray(0, 40), buf.subarray(40)]), // 2 chunks
      storageKey: "imports/1/x.xlsx",
      declaredMime: MIME_XLSX,
      fileName: "x.xlsx",
    });
    expect(r.size).toBe(128);
    expect(r.checksum).toBe(createHash("sha256").update(buf).digest("hex"));
    expect(storage.storagePutStream).toHaveBeenCalledTimes(1);
    expect(storage.storageDelete).not.toHaveBeenCalled();
  });

  it("valida checksum declarado contra o calculado", async () => {
    const buf = csvBytes();
    const r = await streamFileToStorage({
      source: Readable.from(buf),
      storageKey: "imports/1/x.csv",
      declaredMime: MIME_CSV,
      fileName: "x.csv",
      declaredChecksum: createHash("sha256").update(buf).digest("hex"),
    });
    expect(r.size).toBe(buf.length);
  });
});

describe("streamFileToStorage — falhas abortam e limpam o parcial", () => {
  it("limite excedido DURANTE o streaming → PAYLOAD_TOO_LARGE + cleanup", async () => {
    await expect(streamFileToStorage({
      source: Readable.from(zipBytes(500)),
      storageKey: "imports/1/big.xlsx",
      declaredMime: MIME_XLSX,
      fileName: "big.xlsx",
      maxBytes: 64, // teto pequeno para o teste
    })).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    expect(storage.storageDelete).toHaveBeenCalledWith("imports/1/big.xlsx");
  });

  it("conteúdo divergente do MIME declarado → BAD_REQUEST + cleanup", async () => {
    await expect(streamFileToStorage({
      source: Readable.from(pdfBytes()),
      storageKey: "imports/1/fake.xlsx",
      declaredMime: MIME_XLSX, // declara xlsx mas envia PDF
      fileName: "fake.xlsx",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.storageDelete).toHaveBeenCalledWith("imports/1/fake.xlsx");
  });

  it("checksum divergente → BAD_REQUEST + cleanup", async () => {
    await expect(streamFileToStorage({
      source: Readable.from(csvBytes()),
      storageKey: "imports/1/x.csv",
      declaredMime: MIME_CSV,
      fileName: "x.csv",
      declaredChecksum: "0".repeat(64),
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.storageDelete).toHaveBeenCalledWith("imports/1/x.csv");
  });

  it("interrupção do cliente no meio do upload → erro + cleanup do parcial", async () => {
    await expect(streamFileToStorage({
      source: interruptedSource([zipBytes(32), Buffer.alloc(16, 0x20)]),
      storageKey: "imports/1/partial.xlsx",
      declaredMime: MIME_XLSX,
      fileName: "partial.xlsx",
    })).rejects.toBeTruthy();
    expect(storage.storageDelete).toHaveBeenCalledWith("imports/1/partial.xlsx");
  });

  it("arquivo vazio → BAD_REQUEST + cleanup", async () => {
    await expect(streamFileToStorage({
      source: Readable.from([]),
      storageKey: "imports/1/empty.csv",
      declaredMime: MIME_CSV,
      fileName: "empty.csv",
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(storage.storageDelete).toHaveBeenCalledWith("imports/1/empty.csv");
  });
});

describe("streamFileToStorage — concorrência", () => {
  it("dois uploads simultâneos resolvem de forma independente", async () => {
    const a = streamFileToStorage({ source: Readable.from(zipBytes(64)), storageKey: "imports/1/a.xlsx", declaredMime: MIME_XLSX, fileName: "a.xlsx" });
    const b = streamFileToStorage({ source: Readable.from(csvBytes()),  storageKey: "imports/1/b.csv",  declaredMime: MIME_CSV,  fileName: "b.csv"  });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.size).toBe(64);
    expect(rb.size).toBeGreaterThan(0);
    expect(storage.storagePutStream).toHaveBeenCalledTimes(2);
    expect(storage.storageDelete).not.toHaveBeenCalled();
  });
});

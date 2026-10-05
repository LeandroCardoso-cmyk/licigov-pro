/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * R9 / SEM-043 — ledger de artefatos oficiais, sem DB (persistência e storage mockados).
 * O comportamento contra MySQL real está em integration/sem043-official-artifact-ledger-mysql-smoke.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

const calls = vi.hoisted(() => [] as string[]);
const lock = vi.hoisted(() => ({ ok: 1 }));
const state = vi.hoisted(() => ({ hasDb: true, created: true }));

vi.mock("../../db/connection", () => ({
  getDb: async () => {
    if (!state.hasDb) return null;
    return {
      transaction: async (cb: (tx: any) => Promise<unknown>) => {
        calls.push("tx:begin");
        const tx = { execute: async (q: any) => { const t = JSON.stringify(q); calls.push(t.includes("GET_LOCK") ? "lock" : "unlock"); return [[{ ok: lock.ok }]]; } };
        try { return await cb(tx); } finally { calls.push("tx:end"); }
      },
    };
  },
}));
vi.mock("../../db/officialDocumentArtifacts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/officialDocumentArtifacts")>();
  return {
    ...actual,
    insertOfficialDocumentArtifact: vi.fn(async (rec: any) => {
      calls.push("ledger:insert");
      return { artifact: { ...rec, id: actual.computeArtifactId(rec), createdAt: "2026-10-04 00:00:00.000" }, created: state.created };
    }),
  };
});
vi.mock("../../db/officialDocuments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/officialDocuments")>();
  return {
    ...actual,
    countDocumentTimeline: vi.fn(async () => { calls.push("timeline:count"); return 3; }),
    insertDocumentTimelineEntry: vi.fn(async () => { calls.push("timeline:insert"); }),
  };
});
vi.mock("../../storage", () => ({
  assertStorageUsable: () => undefined,
  isStorageConfigured: () => true,
  storageFallbackAllowed: () => true,
  storagePut: vi.fn(async (key: string) => { calls.push("s3:put"); return { key, url: "u" }; }),
  storageSignedUrl: vi.fn(async (key: string) => ({ key, url: `signed://${key}` })),
}));

import { storeRenderedArtifact, recordOfficialArtifact } from "../../services/officialDocumentLifecycleService";
import { insertOfficialDocumentArtifact, computeArtifactId, sha256Hex } from "../../db/officialDocumentArtifacts";
import { insertDocumentTimelineEntry } from "../../db/officialDocuments";
import { storagePut } from "../../storage";
import { createOfficialDocument } from "../../domain/officialDocument";
import { exportDocument } from "../../services/documentExportService";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const doc = () => createOfficialDocument({
  tenantId: 7, businessDomain: "contratos", documentType: "contrato", origin: "o1", title: "Contrato Z",
  content: "# Contrato\nTexto fiel", version: 2, author: "1", correlationId: "c",
});

beforeEach(() => {
  calls.length = 0; lock.ok = 1; state.hasDb = true; state.created = true;
  vi.mocked(insertOfficialDocumentArtifact).mockClear(); vi.mocked(insertDocumentTimelineEntry).mockClear(); vi.mocked(storagePut).mockClear();
});

describe("SEM-043 — hash e id determinísticos", () => {
  it("sha256Hex é determinístico e sensível a 1 byte", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe(sha256Hex(Buffer.from("abc")));
    expect(sha256Hex(Buffer.from("abc"))).toBe(sha("abc"));
    expect(sha256Hex(Buffer.from("abc"))).not.toBe(sha256Hex(Buffer.from("abd")));
  });
  it("computeArtifactId: mesma entrada ⇒ mesmo id; tenant, documento, formato e hash compõem a identidade", () => {
    const base = { tenantId: 1, documentId: "d", format: "pdf", artifactHash: "h".repeat(64) };
    expect(computeArtifactId(base)).toBe(computeArtifactId({ ...base }));
    expect(computeArtifactId(base)).toHaveLength(24);
    for (const alt of [{ tenantId: 2 }, { documentId: "e" }, { format: "docx" }, { artifactHash: "i".repeat(64) }]) {
      expect(computeArtifactId({ ...base, ...alt })).not.toBe(computeArtifactId(base));
    }
  });
});

describe("SEM-043 — storeRenderedArtifact registra no ledger (nunca na linha da versão)", () => {
  it("DOCX ≠ PDF: hashes distintos, formatos distintos, ator humano, origem (conteúdo/replay) corretos", async () => {
    const d = doc();
    const docxBytes = Buffer.from("PK-docx"); const pdfBytes = Buffer.from("%PDF-pdf");
    const a = await storeRenderedArtifact({ doc: d, format: "docx", buffer: docxBytes, actorUserId: 5, correlationId: "k1" });
    const b = await storeRenderedArtifact({ doc: d, format: "pdf", buffer: pdfBytes, actorUserId: 5, correlationId: "k2" });
    expect(a.artifactHash).toBe(sha(docxBytes)); expect(b.artifactHash).toBe(sha(pdfBytes));
    expect(a.artifactHash).not.toBe(b.artifactHash);
    expect(a.storageKey).not.toBe(b.storageKey);
    const [r1, r2] = vi.mocked(insertOfficialDocumentArtifact).mock.calls.map((c) => c[0]);
    expect([r1.format, r2.format]).toEqual(["docx", "pdf"]);
    expect(r1).toMatchObject({
      tenantId: 7, documentId: d.id, lineageId: d.lineageId, version: 2, createdBy: "user:5", correlationId: "k1",
      sourceContentHash: sha(d.content), sourceReplayHash: d.replayHash, storageKey: a.storageKey, sizeBytes: docxBytes.length,
    });
  });

  it("evento documento_exportado cita formato + hash, ator humano, insertOnly (um id por evento)", async () => {
    const d = doc(); const buf = Buffer.from("PK-x");
    await storeRenderedArtifact({ doc: d, format: "docx", buffer: buf, actorUserId: 9, correlationId: "kk" });
    const [entry, , opts] = vi.mocked(insertDocumentTimelineEntry).mock.calls[0] as any;
    expect(entry).toMatchObject({ tenantId: 7, lineageId: d.lineageId, documentId: d.id, order: 3, eventType: "documento_exportado", actor: "user:9", correlationId: "kk" });
    expect(entry.summary).toContain("DOCX"); expect(entry.summary).toContain(`sha256:${sha(buf)}`);
    expect(opts).toEqual({ insertOnly: true });
  });

  it("bytes idênticos (created=false) ⇒ no-op: sem evento novo, mesmo id devolvido", async () => {
    state.created = false;
    const r = await storeRenderedArtifact({ doc: doc(), format: "pdf", buffer: Buffer.from("same"), actorUserId: 1 });
    expect(r.artifactRecorded).toBe(false);
    expect(insertDocumentTimelineEntry).not.toHaveBeenCalled();
  });

  it("S3 fica FORA da transação/lock: put → (tx: lock → ledger → timeline → unlock)", async () => {
    await storeRenderedArtifact({ doc: doc(), format: "pdf", buffer: Buffer.from("o"), actorUserId: 1 });
    expect(calls).toEqual(["s3:put", "tx:begin", "lock", "ledger:insert", "timeline:count", "timeline:insert", "unlock", "tx:end"]);
  });

  it("chave S3 é endereçada pelo hash: bytes diferentes nunca sobrescrevem o objeto anterior", async () => {
    const d = doc();
    const a = await storeRenderedArtifact({ doc: d, format: "pdf", buffer: Buffer.from("um"), actorUserId: 1 });
    const b = await storeRenderedArtifact({ doc: d, format: "pdf", buffer: Buffer.from("dois"), actorUserId: 1 });
    const c = await storeRenderedArtifact({ doc: d, format: "pdf", buffer: Buffer.from("um"), actorUserId: 1 });
    expect(a.storageKey).not.toBe(b.storageKey);
    expect(c.storageKey).toBe(a.storageKey);
    expect(a.storageKey).toContain(sha("um").slice(0, 16));
    expect(a.storageKey!.length).toBeLessThanOrEqual(255);
  });

  it("lock indisponível ⇒ CONFLICT estável, ZERO escrita no ledger/timeline", async () => {
    lock.ok = 0;
    await expect(recordOfficialArtifact({ doc: doc(), format: "pdf", artifactHash: sha("x"), sizeBytes: 1, mimeType: "application/pdf", actorUserId: 1 }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE") });
    expect(insertOfficialDocumentArtifact).not.toHaveBeenCalled();
    expect(insertDocumentTimelineEntry).not.toHaveBeenCalled();
  });

  it("ator inválido (0, negativo, fracionário, NaN) ⇒ recusa antes de qualquer escrita", async () => {
    for (const bad of [0, -3, 1.2, Number.NaN]) {
      await expect(recordOfficialArtifact({ doc: doc(), format: "pdf", artifactHash: sha("x"), sizeBytes: 1, mimeType: "application/pdf", actorUserId: bad }))
        .rejects.toThrow(/OFFICIAL_ARTIFACT_ACTOR_REQUIRED/);
    }
    expect(calls).toEqual([]);
  });

  it("sem DB (desenvolvimento) degrada: artifact null, sem erro nem escrita", async () => {
    state.hasDb = false;
    const r = await recordOfficialArtifact({ doc: doc(), format: "pdf", artifactHash: sha("x"), sizeBytes: 1, mimeType: "application/pdf", actorUserId: 1 });
    expect(r).toEqual({ artifact: null, created: false });
    expect(insertOfficialDocumentArtifact).not.toHaveBeenCalled();
  });
});

describe("SEM-043 — exportDocument devolve o hash dos bytes realmente enviados ao storage", () => {
  it("artifactHash = sha256(buffer do storagePut); DOCX ≠ PDF para o mesmo conteúdo (renderers reais)", async () => {
    const meta = { documentTitle: "T", statusLabel: "EMITIDO", isDraft: false, version: 1, exportedAtLabel: "01/01/2026 às 10:00" } as any;
    const docx = await exportDocument({ organizationId: 1, content: "# Título\n\nTexto.", baseName: "x", format: "docx", meta });
    const pdf = await exportDocument({ organizationId: 1, content: "# Título\n\nTexto.", baseName: "x", format: "pdf", meta });
    const sent = vi.mocked(storagePut).mock.calls.map((c) => c[1] as Buffer);
    expect(docx.artifactHash).toBe(sha(sent[0])); expect(pdf.artifactHash).toBe(sha(sent[1]));
    expect(docx.sizeBytes).toBe(sent[0].length); expect(pdf.sizeBytes).toBe(sent[1].length);
    expect(docx.artifactHash).not.toBe(pdf.artifactHash);
  }, 30_000);
});

describe("SEM-043 — repositório: duplicado ⇒ no-op que devolve a linha existente", () => {
  it("ER_DUP_ENTRY (inclusive em cause) vira created=false; outro erro propaga (fail-closed)", async () => {
    const actual = await vi.importActual<typeof import("../../db/officialDocumentArtifacts")>("../../db/officialDocumentArtifacts");
    const rec = { tenantId: 1, documentId: "d", lineageId: "l", version: 1, format: "pdf", artifactHash: "a".repeat(64), sizeBytes: 1, mimeType: "application/pdf", storageKey: "", sourceContentHash: "", sourceReplayHash: "", identityFingerprint: "", correlationId: "", createdBy: "user:1" };
    const row = { ...rec, id: actual.computeArtifactId(rec), createdAt: "t" };
    const mk = (err: unknown, rows: unknown[]) => ({
      insert: () => ({ values: async () => { if (err) throw err; } }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
    }) as any;
    const dup = await actual.insertOfficialDocumentArtifact(rec, mk({ cause: { errno: 1062 } }, [row]));
    expect(dup).toMatchObject({ created: false, artifact: { id: row.id } });
    await expect(actual.insertOfficialDocumentArtifact(rec, mk(new Error("boom"), []))).rejects.toThrow("boom");
    await expect(actual.insertOfficialDocumentArtifact(rec, mk({ code: "ER_DUP_ENTRY" }, []))).rejects.toBeDefined(); // duplicado sem linha legível: estado inesperado
    expect(await actual.insertOfficialDocumentArtifact(rec, mk(null, [row]))).toMatchObject({ created: true });
  });
});

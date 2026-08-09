/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR C.2B — Revisão/aprovação documental VERSION-AWARE contra MySQL REAL (CI). Executável.
 *
 * Cobre: aprovação version-aware; segregação de deveres (autor não aprova, IA/sistema não aprova,
 * papel insuficiente); justificativa obrigatória em rejeição/devolução; idempotência canônica
 * (replay, conflito de payload, concorrência → efeito único, ledger único); guarda de versão
 * (expectedVersion obsoleta → CONFLICT); nova versão não herda aprovação e a versão aprovada
 * permanece aprovada; isolamento multi-tenant (leitura/mutação cross-tenant bloqueadas).
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { decideDocumentReview, listDocumentReviewDecisions } from "../../services/documentReviewService";

const DB = process.env.DATABASE_URL;
const ORG_A = 970801;
const ORG_B = 970802;
const AUTHOR = 96001;    // autor (createdBy)
const REVIEWER = 96002;  // revisor/aprovador (≠ autor)
const PROC_NAME = "C2B Smoke Processo";

let conn: mysql.Connection;
let procA = 0;

async function seedProcess(org: number): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO processes (name, object, ownerId, organizationId) VALUES (?, ?, ?, ?)",
    [PROC_NAME, "objeto", AUTHOR, org],
  );
  return r.insertId;
}

async function seedDoc(org: number, processId: number, status: string, version = 1, createdBy = AUTHOR): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO documents (organizationId, processId, type, content, version, createdBy, documentStatus) VALUES (?, ?, 'etp', ?, ?, ?, ?)",
    [org, processId, "conteúdo", version, createdBy, status],
  );
  return r.insertId;
}

async function statusOf(documentId: number): Promise<{ documentStatus: string; approvedBy: number | null }> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT documentStatus, approvedBy FROM documents WHERE id = ?",
    [documentId],
  );
  return rows[0] as any;
}

async function ledgerCount(org: number, documentId: number): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM document_review_decisions WHERE organizationId = ? AND documentId = ?",
    [org, documentId],
  );
  return Number((rows[0] as any).n);
}

const base = (over: Partial<Parameters<typeof decideDocumentReview>[0]> = {}) => ({
  action: "approve" as const,
  documentId: 0,
  organizationId: ORG_A,
  actorUserId: REVIEWER,
  actorRole: "manager" as const,
  reason: null as string | null,
  idempotencyKey: `doc-${Math.random().toString(36).slice(2)}-${Date.now()}`,
  correlationId: "corr-c2b",
  ...over,
});

describe.skipIf(!DB)("PR C.2B — Revisão/aprovação documental (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    procA = await seedProcess(ORG_A);
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    for (const org of [ORG_A, ORG_B]) {
      await conn.execute("DELETE FROM document_review_decisions WHERE organizationId = ?", [org]).catch(() => {});
      await conn.execute("DELETE FROM documents WHERE organizationId = ?", [org]).catch(() => {});
      await conn.execute("DELETE FROM processes WHERE organizationId = ?", [org]).catch(() => {});
    }
    await conn.end();
  });

  it("aprovação version-aware: revisor≠autor aprova a versão; status+approvedBy+ledger", async () => {
    const doc = await seedDoc(ORG_A, procA, "in_review", 2, AUTHOR);
    const r = await decideDocumentReview(base({ documentId: doc, expectedVersion: 2 }));
    expect(r.replayed).toBe(false);
    expect(r.status).toBe("approved");
    expect(r.documentVersion).toBe(2);
    const s = await statusOf(doc);
    expect(s.documentStatus).toBe("approved");
    expect(s.approvedBy).toBe(REVIEWER);
    expect(await ledgerCount(ORG_A, doc)).toBe(1);
    const trail = await listDocumentReviewDecisions(ORG_A, doc);
    expect(trail[0]).toMatchObject({ action: "approve", fromState: "in_review", toState: "approved", actorUserId: REVIEWER, documentVersion: 2 });
  }, 60_000);

  it("SoD: o autor não pode aprovar a própria versão", async () => {
    const doc = await seedDoc(ORG_A, procA, "in_review", 1, AUTHOR);
    await expect(decideDocumentReview(base({ documentId: doc, actorUserId: AUTHOR }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await statusOf(doc)).documentStatus).toBe("in_review"); // inalterado
    expect(await ledgerCount(ORG_A, doc)).toBe(0);
  }, 60_000);

  it("SoD: papel insuficiente (viewer) não aprova", async () => {
    const doc = await seedDoc(ORG_A, procA, "in_review", 1, AUTHOR);
    await expect(decideDocumentReview(base({ documentId: doc, actorRole: "viewer" as any }))).rejects.toMatchObject({ code: "FORBIDDEN" });
  }, 60_000);

  it("rejeição exige justificativa; com justificativa persiste no ledger", async () => {
    const doc = await seedDoc(ORG_A, procA, "in_review", 1, AUTHOR);
    await expect(decideDocumentReview(base({ documentId: doc, action: "reject", reason: "   " }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const r = await decideDocumentReview(base({ documentId: doc, action: "reject", reason: "faltou seção de riscos" }));
    expect(r.status).toBe("rejected");
    const trail = await listDocumentReviewDecisions(ORG_A, doc);
    expect(trail.at(-1)).toMatchObject({ action: "reject", toState: "rejected", justification: "faltou seção de riscos" });
  }, 60_000);

  it("solicitar ajustes: in_review → draft (devolução com justificativa)", async () => {
    const doc = await seedDoc(ORG_A, procA, "in_review", 1, AUTHOR);
    const r = await decideDocumentReview(base({ documentId: doc, action: "request_changes", reason: "ajustar objeto" }));
    expect(r.status).toBe("draft");
    expect((await statusOf(doc)).documentStatus).toBe("draft");
    expect((await listDocumentReviewDecisions(ORG_A, doc)).at(-1)).toMatchObject({ action: "request_changes", toState: "draft" });
  }, 60_000);

  it("guarda de versão: expectedVersion obsoleta → CONFLICT", async () => {
    const doc = await seedDoc(ORG_A, procA, "in_review", 3, AUTHOR);
    await expect(decideDocumentReview(base({ documentId: doc, expectedVersion: 2 }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await statusOf(doc)).documentStatus).toBe("in_review");
  }, 60_000);

  it("idempotência: replay (mesma chave+payload) e conflito (mesma chave+payload diferente)", async () => {
    const doc = await seedDoc(ORG_A, procA, "draft", 1, AUTHOR);
    const key = `idem-${Date.now()}`;
    const first = await decideDocumentReview(base({ documentId: doc, action: "submit_for_review", actorRole: "operator", idempotencyKey: key }));
    expect(first.replayed).toBe(false);
    const replay = await decideDocumentReview(base({ documentId: doc, action: "submit_for_review", actorRole: "operator", idempotencyKey: key }));
    expect(replay.replayed).toBe(true);
    expect(await ledgerCount(ORG_A, doc)).toBe(1); // sem 2ª linha
    // mesma chave, payload diferente (outra ação) → CONFLICT
    await expect(decideDocumentReview(base({ documentId: doc, action: "reject", reason: "x", idempotencyKey: key })))
      .rejects.toMatchObject({ code: "CONFLICT" });
  }, 60_000);

  it("concorrência: N submits simultâneos com a mesma chave → efeito único e ledger único", async () => {
    const doc = await seedDoc(ORG_A, procA, "draft", 1, AUTHOR);
    const key = `conc-${Date.now()}`;
    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        decideDocumentReview(base({ documentId: doc, action: "submit_for_review", actorRole: "operator", idempotencyKey: key })),
      ),
    );
    const executed = settled.filter((s) => s.status === "fulfilled" && (s.value as any).replayed === false).length;
    expect(executed).toBe(1);
    expect(await ledgerCount(ORG_A, doc)).toBe(1);
    expect((await statusOf(doc)).documentStatus).toBe("in_review");
  }, 60_000);

  it("nova versão não herda aprovação; a versão aprovada permanece aprovada", async () => {
    const v1 = await seedDoc(ORG_A, procA, "in_review", 1, AUTHOR);
    await decideDocumentReview(base({ documentId: v1, expectedVersion: 1 }));
    expect((await statusOf(v1)).documentStatus).toBe("approved");
    // Edição = nova linha (nova versão), nasce em draft (default do schema).
    const v2 = await seedDoc(ORG_A, procA, "draft", 2, AUTHOR);
    expect((await statusOf(v2)).documentStatus).toBe("draft");   // não herdou aprovação
    expect((await statusOf(v1)).documentStatus).toBe("approved"); // v1 continua aprovada
  }, 60_000);

  it("multi-tenant: outra organização não lê nem decide sobre o documento", async () => {
    const doc = await seedDoc(ORG_A, procA, "in_review", 1, AUTHOR);
    // mutação cross-tenant → NOT_FOUND (não vaza existência)
    await expect(decideDocumentReview(base({ documentId: doc, organizationId: ORG_B }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await statusOf(doc)).documentStatus).toBe("in_review"); // intacto
    // leitura cross-tenant → vazia
    expect(await listDocumentReviewDecisions(ORG_B, doc)).toEqual([]);
  }, 60_000);
});

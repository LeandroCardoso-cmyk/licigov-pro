/**
 * R2 / LEG-009 — desligamento GOVERNADO do router legado `documents.*` — smoke contra MySQL REAL.
 * Só roda com DATABASE_URL definido (pulado localmente sem banco). Complementa o teste mockado
 * `r2-leg009-legacy-documents-disabled.test.ts`.
 *
 * Fixture: dois órgãos (A e B), processo LEGADO em cada um (tabela `processes`) com linhas `documents`
 * pré-existentes (DFD textual + ETP com s3Key de upload) e um membro de processo em A. Atores: owner de A,
 * operator de A (membro do processo), viewer de A e owner de B (cross-tenant).
 *
 * Contrato verificado, contra o banco real e via appRouter (middlewares reais de auth/tenant):
 *  - as 13 procedures (listByProcess, list, save, getByType, generateNext, updateDocument, generateDocument,
 *    uploadDocument, getDownloadUrl, getVersionHistory, restoreVersion, downloadDocx, downloadPdf) recusam
 *    TODA chamada com FORBIDDEN + LEGACY_ENDPOINT_DISABLED, com erro IDÊNTICO para qualquer ator e para recurso
 *    próprio, de outro tenant ou inexistente (anti-enumeração);
 *  - nenhuma linha nova/alterada em `documents` (histórico preservado byte a byte), `processes.status`
 *    inalterado, nenhum `activity_logs` gravado para os processos;
 *  - um evento `legacy_endpoint_disabled` (surfaceId LEG-009) por chamada, sem o input do cliente.
 * Nenhum dado é apagado pelo guard; o afterAll só remove a própria fixture deste teste.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 950191;
const ORG_B = 950192;
const SENTINEL = "SENTINEL-LEG009-MYSQL";

describe.skipIf(!DB)("R2 / LEG-009 — router legado documents.* desativado (MySQL real)", () => {
  let conn: mysql.Connection;
  let ownerA: number;
  let operatorA: number;
  let viewerA: number;
  let ownerB: number;
  let processA: number;
  let processB: number;
  let dfdA: number;
  let etpA: number;
  let dfdB: number;
  const stamp = Date.now();

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);

    async function insertUser(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`,
        [`leg009-${tag}-${stamp}`, `Usuário ${tag}`, `leg009-${tag}-${stamp}@teste.local`],
      );
      return r.insertId;
    }
    ownerA = await insertUser("owner-a");
    operatorA = await insertUser("operator-a");
    viewerA = await insertUser("viewer-a");
    ownerB = await insertUser("owner-b");

    const member = async (org: number, user: number, role: string) =>
      conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, user, role]);
    await member(ORG_A, ownerA, "owner");
    await member(ORG_A, operatorA, "operator");
    await member(ORG_A, viewerA, "viewer");
    await member(ORG_B, ownerB, "owner");

    async function insertProcess(org: number, owner: number, status: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, 'Processo LEG-009', 'Objeto legado', ?, ?)`,
        [org, owner, status],
      );
      return r.insertId;
    }
    processA = await insertProcess(ORG_A, ownerA, "em_etp");
    processB = await insertProcess(ORG_B, ownerB, "em_dfd");
    await conn.execute(
      `INSERT INTO process_members (processId, userId, permission, invitedBy) VALUES (?, ?, 'editor', ?)`,
      [processA, operatorA, ownerA],
    );

    async function insertDocument(org: number, processId: number, owner: number, type: string, extra: { s3Key?: string } = {}) {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO documents (organizationId, processId, type, content, sourceType, s3Key, version, createdBy, documentStatus)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'draft')`,
        [org, processId, type, extra.s3Key ? null : `# ${type.toUpperCase()} legado`, extra.s3Key ? "upload" : "ai", extra.s3Key ?? null, owner],
      );
      return r.insertId;
    }
    dfdA = await insertDocument(ORG_A, processA, ownerA, "dfd");
    etpA = await insertDocument(ORG_A, processA, ownerA, "etp", { s3Key: `processes/${processA}/etp/${stamp}_etp.pdf` });
    dfdB = await insertDocument(ORG_B, processB, ownerB, "dfd");
  }, 60_000);

  afterAll(async () => {
    if (conn) {
      const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
      await del(`DELETE FROM activity_logs WHERE processId IN (?, ?)`, [processA, processB]);
      await del(`DELETE FROM documents WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
      await del(`DELETE FROM process_members WHERE processId IN (?, ?)`, [processA, processB]);
      await del(`DELETE FROM processes WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
      await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
      await del(`DELETE FROM users WHERE id IN (?, ?, ?, ?)`, [ownerA, operatorA, viewerA, ownerB]);
      await conn.end();
    }
  });

  async function makeCaller(userId: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Usuário ${userId}`, email: `u${userId}@teste.local` },
      req: { headers: {} },
      res: {},
      correlationId: "test-leg009",
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  type Caller = Awaited<ReturnType<typeof makeCaller>>;

  /** As 13 procedures, apontadas para um processo/documento-alvo (próprio, cross-tenant ou inexistente). */
  function calls(c: Caller, processId: number, documentId: number): Array<[string, () => Promise<unknown>]> {
    const b64 = Buffer.from(SENTINEL).toString("base64");
    return [
      ["listByProcess", () => c.documents.listByProcess({ processId })],
      ["list", () => c.documents.list({ processId })],
      ["save", () => c.documents.save({ processId, type: "etp", content: SENTINEL })],
      ["getByType", () => c.documents.getByType({ processId, type: "dfd" })],
      ["generateNext", () => c.documents.generateNext({ processId })],
      ["updateDocument", () => c.documents.updateDocument({ documentId, content: SENTINEL })],
      ["generateDocument", () => c.documents.generateDocument({ processId, docType: "tr" })],
      ["uploadDocument", () => c.documents.uploadDocument({ processId, docType: "tr", fileName: "leg009.pdf", fileBase64: b64, mimeType: "application/pdf" })],
      ["getDownloadUrl", () => c.documents.getDownloadUrl({ documentId })],
      ["getVersionHistory", () => c.documents.getVersionHistory({ documentId })],
      ["restoreVersion", () => c.documents.restoreVersion({ documentId, versionId: documentId })],
      ["downloadDocx", () => c.documents.downloadDocx({ documentId })],
      ["downloadPdf", () => c.documents.downloadPdf({ documentId })],
    ];
  }

  async function snapshot() {
    const [docs] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT id, organizationId, processId, type, content, sourceType, s3Key, version, documentStatus, createdBy
         FROM documents WHERE organizationId IN (?, ?) ORDER BY id`,
      [ORG_A, ORG_B],
    );
    const [procs] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT id, status, ownerId FROM processes WHERE id IN (?, ?) ORDER BY id`, [processA, processB],
    );
    const [logs] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM activity_logs WHERE processId IN (?, ?)`, [processA, processB],
    );
    return {
      docs: docs.map((r) => ({ ...r })),
      procs: procs.map((r) => ({ ...r })),
      logs: Number((logs[0] as { cnt: number }).cnt),
    };
  }

  async function errOf(p: () => Promise<unknown>): Promise<{ code?: string; message?: string }> {
    try { await p(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
    return { code: "RESOLVED", message: "" };
  }

  it("fixture: histórico legado presente (3 documentos, processos em em_etp/em_dfd, sem activity logs)", async () => {
    const s = await snapshot();
    expect(s.docs.map((d) => Number(d.id))).toEqual([dfdA, etpA, dfdB]);
    expect(s.procs.map((p) => p.status)).toEqual(["em_etp", "em_dfd"]);
    expect(s.logs).toBe(0);
  });

  it("13 procedures × (owner, operator-membro, viewer, cross-tenant, inexistente): MESMO erro governado e NADA muda no banco", async () => {
    const before = await snapshot();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cOwnerA = await makeCaller(ownerA);
      const cOperatorA = await makeCaller(operatorA);
      const cViewerA = await makeCaller(viewerA);
      const cOwnerB = await makeCaller(ownerB);
      const scenarios: Array<[string, Caller, number, number]> = [
        ["owner A → recurso próprio", cOwnerA, processA, etpA],
        ["operator/membro A → recurso de A", cOperatorA, processA, dfdA],
        ["viewer A → recurso de A", cViewerA, processA, etpA],
        ["owner B → recurso de A (cross-tenant)", cOwnerB, processA, etpA],
        ["owner A → recurso de B (cross-tenant)", cOwnerA, processB, dfdB],
        ["owner A → inexistente", cOwnerA, 999_999_991, 999_999_992],
      ];

      let total = 0;
      let reference: { code?: string; message?: string } | undefined;
      for (const [label, caller, pid, did] of scenarios) {
        for (const [proc, call] of calls(caller, pid, did)) {
          const err = await errOf(call);
          total++;
          expect(err.code, `${label} · ${proc}`).toBe("FORBIDDEN");
          expect(err.message, `${label} · ${proc}`).toMatch(/LEGACY_ENDPOINT_DISABLED/);
          expect(err.message).not.toContain(SENTINEL);
          reference ??= err;
          expect(err, `${label} · ${proc}`).toEqual(reference);
        }
      }
      expect(total).toBe(6 * 13);

      // um evento governado por chamada, LEG-009, sem o input do cliente
      const events = warnSpy.mock.calls
        .map((a) => String(a[0]))
        .filter((raw) => raw.includes("legacy_endpoint_disabled"));
      expect(events).toHaveLength(total);
      for (const raw of events) {
        const e = JSON.parse(raw) as Record<string, unknown>;
        expect(e.surfaceId).toBe("LEG-009");
        expect(String(e.procedure)).toMatch(/^documents\./);
        expect(raw).not.toContain(SENTINEL);
        expect(Object.keys(e)).not.toContain("processId");
        expect(Object.keys(e)).not.toContain("documentId");
      }
    } finally {
      warnSpy.mockRestore();
    }

    const after = await snapshot();
    expect(after.docs).toEqual(before.docs); // nenhuma versão nova, nenhum conteúdo/status/s3Key alterado
    expect(after.procs).toEqual(before.procs); // processes.status inalterado (generateNext/generateDocument inertes)
    expect(after.logs).toBe(0); // nenhum activity log
  }, 60_000);
});

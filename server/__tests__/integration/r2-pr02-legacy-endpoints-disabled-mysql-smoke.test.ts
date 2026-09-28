/**
 * R2 / PR-02 — desligamento GOVERNADO das superfícies legadas LEG-006, LEG-008, LEG-010 e LEG-011 — smoke
 * contra MySQL REAL (appRouter.createCaller, tenant resolvido por organization_members). Só roda com DATABASE_URL.
 *
 * Fixtures inseridas DIRETAMENTE no banco (nunca `processes.create`, desativado por
 * LEGACY_PROCESS_PIPELINE_DISABLED): processo legado + documento (draft) no órgão A, processo canônico
 * (procurement_processes) em REVIEW e workspace de contratação direta.
 *
 * Contrato verificado:
 *  - as 6 procedures recusam com FORBIDDEN + LEGACY_ENDPOINT_DISABLED para owner/operator/viewer e para um
 *    chamador de OUTRO órgão (mesmo erro; `procurementProcess.updateStage` mantém o gate orgRoleProcedure
 *    ("operator"), então o viewer é barrado pelo RBAC antes do handler);
 *  - linhas intactas: documents.documentStatus, processes.status, procurement_processes current_stage/status,
 *    direct_procurement_workspaces current_stage/status;
 *  - nenhuma nova linha em activity_logs, process_timeline ou notifications;
 *  - evento `legacy_endpoint_disabled` com surfaceId e sem o input do cliente;
 *  - caminhos canônicos seguem funcionando: `procurementProcess.issueProcess` sem Edital oficial ⇒
 *    PRECONDITION_FAILED (etapa inalterada); `documentReview.submitForReview` + `documentReview.approve`
 *    (revisor ≠ autor) levam o documento a in_review → approved com ledger.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 960201;
const ORG_B = 960202;
const SENTINEL = "SENTINEL-R2PR02-SMOKE";

describe.skipIf(!DB)("R2 / PR-02 — superfícies legadas desativadas (MySQL real)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  const ppId = `r2p02-${stamp}`;
  const wsId = `r2w02-${stamp}`;
  let owner: number, operator: number, viewer: number, manager: number, foreign: number;
  let processA: number, documentA: number;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A R2PR02 ${stamp}`, `org-a-r2pr02-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B R2PR02 ${stamp}`, `org-b-r2pr02-${stamp}`]);

    async function user(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')`,
        [`r2pr02-${tag}-${stamp}`, `R2PR02 ${tag}`, `r2pr02-${tag}-${stamp}@teste.local`]);
      return r.insertId;
    }
    async function member(org: number, userId: number, role: string) {
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, userId, role]);
    }
    owner = await user("owner"); operator = await user("operator"); viewer = await user("viewer");
    manager = await user("manager"); foreign = await user("foreign");
    await member(ORG_A, owner, "owner"); await member(ORG_A, operator, "operator");
    await member(ORG_A, viewer, "viewer"); await member(ORG_A, manager, "manager");
    await member(ORG_B, foreign, "owner");

    const [p] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, ?, 'Objeto R2PR02', ?, 'em_dfd')`,
      [ORG_A, `Processo R2PR02 ${stamp}`, owner]);
    processA = p.insertId;
    const [d] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO documents (organizationId, processId, type, content, version, createdBy, documentStatus) VALUES (?, ?, 'etp', '# ETP', 1, ?, 'draft')`,
      [ORG_A, processA, owner]);
    documentA = d.insertId;

    await conn.execute(
      `INSERT INTO procurement_processes (id, organization_id, process_number, object, modality, current_stage, status, responsible_user, correlation_id)
       VALUES (?, ?, ?, 'Objeto canônico R2PR02', 'pregao_eletronico', 'REVIEW', 'em_revisao', ?, 'r2pr02-seed')`,
      [ppId, ORG_A, `R2PR02/${stamp}`, owner]);
    await conn.execute(
      `INSERT INTO direct_procurement_workspaces (id, organization_id, process_number, object, current_stage, status, responsible_user, correlation_id)
       VALUES (?, ?, ?, 'Objeto direto R2PR02', 'REQUIRED_DOCUMENTS', 'em_andamento', ?, 'r2pr02-seed')`,
      [wsId, ORG_A, `R2PR02-D/${stamp}`, owner]);
  }, 60_000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, params: unknown[]) => { await conn.execute(sql, params).catch(() => {}); };
    const users = [owner, operator, viewer, manager, foreign];
    const inUsers = users.map(() => "?").join(",");
    await del(`DELETE FROM document_review_decisions WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM documents WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM activity_logs WHERE processId = ? OR organizationId IN (?, ?) OR userId IN (${inUsers})`, [processA, ORG_A, ORG_B, ...users]);
    await del(`DELETE FROM notifications WHERE userId IN (${inUsers})`, users);
    await del(`DELETE FROM process_timeline WHERE process_id IN (?, ?)`, [ppId, wsId]);
    await del(`DELETE FROM procurement_processes WHERE id = ?`, [ppId]);
    await del(`DELETE FROM direct_procurement_workspaces WHERE id = ?`, [wsId]);
    await del(`DELETE FROM processes WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM users WHERE id IN (${inUsers})`, users);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function caller(userId: number, org: number, correlationId = `r2pr02-${userId}`) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  type Caller = Awaited<ReturnType<typeof caller>>;

  const one = async (sql: string, params: unknown[]) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params);
    return rows[0];
  };
  async function snapshot() {
    const users = [owner, operator, viewer, manager, foreign];
    const inUsers = users.map(() => "?").join(",");
    return {
      documentStatus: (await one(`SELECT documentStatus FROM documents WHERE id = ?`, [documentA])).documentStatus,
      processStatus: (await one(`SELECT status FROM processes WHERE id = ?`, [processA])).status,
      pp: await one(`SELECT current_stage, status, updated_at FROM procurement_processes WHERE id = ?`, [ppId]),
      ws: await one(`SELECT current_stage, status, updated_at FROM direct_procurement_workspaces WHERE id = ?`, [wsId]),
      activity: Number((await one(
        `SELECT COUNT(*) n FROM activity_logs WHERE processId = ? OR organizationId IN (?, ?) OR userId IN (${inUsers})`,
        [processA, ORG_A, ORG_B, ...users])).n),
      timeline: Number((await one(`SELECT COUNT(*) n FROM process_timeline WHERE process_id IN (?, ?)`, [ppId, wsId])).n),
      notifications: Number((await one(`SELECT COUNT(*) n FROM notifications WHERE userId IN (${inUsers})`, users)).n),
      reviewLedger: Number((await one(`SELECT COUNT(*) n FROM document_review_decisions WHERE documentId = ?`, [documentA])).n),
    };
  }
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
    return { code: "RESOLVED", message: "" };
  };

  const SURFACES: Array<{ procedure: string; surfaceId: string; viewerBlockedByRbac: boolean; call: (c: Caller) => Promise<unknown> }> = [
    { procedure: "processes.updateStatus", surfaceId: "LEG-006", viewerBlockedByRbac: false,
      call: (c) => c.processes.updateStatus({ id: processA, status: "concluido" }) },
    { procedure: "documents.submitForReview", surfaceId: "LEG-008", viewerBlockedByRbac: false,
      call: (c) => c.documents.submitForReview({ documentId: documentA }) },
    { procedure: "documents.approveDocument", surfaceId: "LEG-008", viewerBlockedByRbac: false,
      call: (c) => c.documents.approveDocument({ documentId: documentA }) },
    { procedure: "documents.rejectDocument", surfaceId: "LEG-008", viewerBlockedByRbac: false,
      call: (c) => c.documents.rejectDocument({ documentId: documentA, reason: SENTINEL }) },
    { procedure: "procurementProcess.updateStage", surfaceId: "LEG-010", viewerBlockedByRbac: true,
      call: (c) => c.procurementProcess.updateStage({ processId: ppId, stage: "ISSUED" }) },
    { procedure: "directProcurement.updateStage", surfaceId: "LEG-011", viewerBlockedByRbac: false,
      call: (c) => c.directProcurement.updateStage({ workspaceId: wsId, stage: "PUBLICATION" }) },
  ];

  it("as 6 procedures desativadas recusam para owner/operator/viewer/outro tenant com o MESMO erro e sem efeito", async () => {
    const warn = vi.spyOn(console, "warn");
    try {
      const before = await snapshot();
      const actors = { owner: await caller(owner, ORG_A), operator: await caller(operator, ORG_A),
        foreign: await caller(foreign, ORG_B), viewer: await caller(viewer, ORG_A) };

      for (const s of SURFACES) {
        const own = await errOf(() => s.call(actors.owner));
        expect(own.code, s.procedure).toBe("FORBIDDEN");
        expect(own.message, s.procedure).toContain("LEGACY_ENDPOINT_DISABLED");
        expect(await errOf(() => s.call(actors.operator)), s.procedure).toEqual(own);
        // outro órgão: MESMO erro — não revela que o recurso existe no órgão A
        expect(await errOf(() => s.call(actors.foreign)), s.procedure).toEqual(own);
        const v = await errOf(() => s.call(actors.viewer));
        expect(v.code, s.procedure).toBe("FORBIDDEN");
        if (s.viewerBlockedByRbac) expect(v.message, s.procedure).toMatch(/papel mínimo 'operator'/);
        else expect(v, s.procedure).toEqual(own);
      }

      const after = await snapshot();
      expect(after).toEqual(before);
      expect(after.documentStatus).toBe("draft");
      expect(after.processStatus).toBe("em_dfd");
      expect(after.pp).toMatchObject({ current_stage: "REVIEW", status: "em_revisao" });
      expect(after.ws).toMatchObject({ current_stage: "REQUIRED_DOCUMENTS", status: "em_andamento" });

      const events = warn.mock.calls.map((a) => String(a[0])).filter((l) => l.includes("legacy_endpoint_disabled"));
      // 6 procedures × (owner + operator + foreign + viewer) − 1 viewer barrado pelo RBAC
      expect(events).toHaveLength(SURFACES.length * 4 - 1);
      for (const s of SURFACES) {
        expect(events.some((l) => { const e = JSON.parse(l); return e.procedure === s.procedure && e.surfaceId === s.surfaceId; }), s.procedure).toBe(true);
      }
      const foreignEvents = events.map((l) => JSON.parse(l)).filter((e) => e.actorUserId === foreign);
      expect(foreignEvents.every((e) => e.organizationId === ORG_B)).toBe(true);
      for (const l of events) {
        expect(l).not.toContain(SENTINEL);
        expect(l).not.toContain(ppId);
        expect(l).not.toContain(wsId);
        expect(Object.keys(JSON.parse(l))).not.toContain("input");
      }
    } finally {
      warn.mockRestore();
    }
  }, 60_000);

  it("canônico: procurementProcess.issueProcess continua recusando sem Edital oficial (PRECONDITION_FAILED)", async () => {
    const mgr = await caller(manager, ORG_A);
    const err = await errOf(() => mgr.procurementProcess.issueProcess({ processId: ppId }));
    expect(err.code).toBe("PRECONDITION_FAILED");
    const pp = await one(`SELECT current_stage, status FROM procurement_processes WHERE id = ?`, [ppId]);
    expect(pp).toMatchObject({ current_stage: "REVIEW", status: "em_revisao" });
  }, 60_000);

  it("canônico: documentReview.submitForReview + documentReview.approve seguem funcionando (draft → in_review → approved)", async () => {
    const op = await caller(operator, ORG_A);
    const mgr = await caller(manager, ORG_A);
    const submitted = await op.documentReview.submitForReview({ documentId: documentA, idempotencyKey: `r2pr02-sub-${stamp}` });
    expect(submitted.status).toBe("in_review");
    const approved = await mgr.documentReview.approve({ documentId: documentA, idempotencyKey: `r2pr02-apr-${stamp}`, expectedVersion: 1 });
    expect(approved.status).toBe("approved");
    const row = await one(`SELECT documentStatus, approvedBy FROM documents WHERE id = ?`, [documentA]);
    expect(row).toMatchObject({ documentStatus: "approved", approvedBy: manager });
    const ledger = await one(`SELECT COUNT(*) n FROM document_review_decisions WHERE organizationId = ? AND documentId = ?`, [ORG_A, documentA]);
    expect(Number(ledger.n)).toBe(2);
  }, 60_000);
});

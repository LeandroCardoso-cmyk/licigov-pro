/**
 * R4 / PR-07 (SEM-004) + R4.3 — ledger APPEND-ONLY de decisões institucionais contra MySQL REAL
 * (appRouter.createCaller → directProcurement.ratify / getRatificationDecision; migration 0312).
 *
 * Contrato (server/domain/institutionalDecision.ts):
 *  D1  registro: revisão 1, autoridade DECLARADA ≠ quem registrou, authority_validation NOT_VALIDATED_POLICY_PENDING,
 *      etapa RATIFICATION/status ratificado, 1 evento de timeline (id estável);
 *  D2  sem default: resultado ausente ⇒ BAD_REQUEST (schema); campos do ato ausentes ⇒ DECISION_FIELDS_REQUIRED;
 *      zero escrita;
 *  D3  replay: mesma chave + mesmo pedido ⇒ a MESMA decisão, zero linha/evento novo;
 *  D4  mesma chave + pedido diferente ⇒ CONFLICT DECISION_IDEMPOTENCY_CONFLICT, zero escrita;
 *  D5  CAS: expectedRevision desatualizada ⇒ CONFLICT DECISION_STALE_REVISION, zero escrita;
 *  D6  superação: nova revisão referencia a anterior; a anterior permanece intacta byte a byte; "não ratificado"
 *      não põe o workspace em status ratificado e bloqueia a publicação;
 *  D7  concorrência: N registros simultâneos com a mesma revisão esperada ⇒ exatamente 1 vence;
 *  D8  tenant: outro órgão ⇒ NOT_FOUND neutro, zero escrita; leitura isolada;
 *  D9  migration 0312: tabela/índices conforme o contrato; reaplicar o SQL = no-op;
 *  D10 append-only: nenhum caminho de UPDATE/DELETE em institutional_decisions no código de produção.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const DB = process.env.DATABASE_URL;
const ORG_A = 960711;
const ORG_B = 960712;

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "__tests__") walk(full, acc); }
    else if (full.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

describe("R4 / PR-07 — ledger append-only (guarda estática, sem banco)", () => {
  it("D10 — nenhum UPDATE/DELETE de institutionalDecisionsTable no código de produção", () => {
    const offenders = walk(path.join(process.cwd(), "server"))
      .filter((f) => /\.(update|delete)\(\s*institutionalDecisionsTable\b/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(process.cwd(), f));
    expect(offenders).toEqual([]);
    const sql = readFileSync(path.join(process.cwd(), "drizzle", "0312_institutional_decision_ledger.sql"), "utf8").replace(/^\s*--.*$/gm, "");
    expect(sql).not.toMatch(/\b(DROP|UPDATE|DELETE|TRUNCATE|ALTER)\b/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS `institutional_decisions`/);
  });
});

describe.skipIf(!DB)("R4 / PR-07 — decisão institucional (ratificação) no ledger (MySQL real)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  let manager: number, manager2: number, foreignOwner: number;
  let ws1: string, ws2: string, ws3: string, ws4: string;
  let key = 0;

  const one = async (sql: string, p: unknown[]) => ((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0])[0];
  const all = async (sql: string, p: unknown[]) => (await conn.execute<mysql.RowDataPacket[]>(sql, p))[0];
  const snapshot = async (wsId: string) => JSON.stringify({
    d: await all(`SELECT * FROM institutional_decisions WHERE organization_id = ? AND subject_id = ? ORDER BY revision`, [ORG_A, wsId]),
    w: await all(`SELECT current_stage, status, updated_at FROM direct_procurement_workspaces WHERE id = ?`, [wsId]),
    t: await all(`SELECT id, summary FROM process_timeline WHERE organization_id = ? AND process_id = ? ORDER BY event_order, id`, [ORG_A, wsId]),
  });

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A PR07 ${stamp}`, `org-a-pr07-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B PR07 ${stamp}`, `org-b-pr07-${stamp}`]);
    const user = async (tag: string) => (await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`, [`pr07-${tag}-${stamp}`, `PR07 ${tag}`, `pr07-${tag}-${stamp}@teste.local`]))[0].insertId;
    manager = await user("manager"); manager2 = await user("manager2"); foreignOwner = await user("foreign");
    for (const [org, u, role] of [[ORG_A, manager, "manager"], [ORG_A, manager2, "manager"], [ORG_B, foreignOwner, "owner"]] as const) {
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, u, role]);
    }
    const { createDirectProcurementWorkspace } = await import("../../domain/directProcurementWorkspace");
    const { insertDirectProcurementWorkspace } = await import("../../db/directProcurement");
    const seed = async (n: string) => {
      const ws = createDirectProcurementWorkspace({
        organizationId: ORG_A, processNumber: `PR07-${n}/${stamp}`, object: "Objeto PR-07", procurementType: "dispensa",
        startOption: "sem_dfd", responsibleUser: manager, correlationId: "pr07-seed",
      });
      await insertDirectProcurementWorkspace(ws);
      return ws.id;
    };
    ws1 = await seed("1"); ws2 = await seed("2"); ws3 = await seed("3"); ws4 = await seed("4");
  }, 60_000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    for (const t of ["institutional_decisions", "process_timeline", "direct_procurement_workspaces", "generated_publications"]) {
      await del(`DELETE FROM ${t} WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]);
    }
    await del(`DELETE FROM official_documents WHERE tenant_id IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM users WHERE id IN (?, ?, ?)`, [manager, manager2, foreignOwner]);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function caller(userId: number, org: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId: `pr07-${userId}-${Math.random().toString(36).slice(2, 8)}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message ?? "" }; }
    return { code: "RESOLVED", message: "" };
  };
  const input = (workspaceId: string, over: Record<string, unknown> = {}) => ({
    workspaceId, decision: "ratificado" as const, decidedByName: "Maria Autoridade", decidedByRole: "Prefeita Municipal",
    decidedAt: "2026-09-30", basisReference: "Despacho nº 10/2026", justification: "Ratifico a dispensa conforme instrução.",
    evidence: ["parecer-1"], expectedRevision: 0, idempotencyKey: `pr07-${stamp}-${key++}`, ...over,
  });

  it("D1 — registro: revisão 1, autoridade declarada ≠ registrador, competência NÃO validada, etapa e 1 evento", async () => {
    const m = await caller(manager, ORG_A);
    const r = await m.directProcurement.ratify(input(ws1));
    expect(r.replayed).toBe(false);
    expect(r.decision).toMatchObject({ revision: 1, outcome: "ratificado", supersedesDecisionId: null, recordedByUserId: manager, decidedByName: "Maria Autoridade", decidedByUserId: null, authorityValidation: "NOT_VALIDATED_POLICY_PENDING" });
    const row = await one(`SELECT * FROM institutional_decisions WHERE organization_id = ? AND subject_id = ?`, [ORG_A, ws1]);
    expect(row).toMatchObject({ revision: 1, outcome: "ratificado", recorded_by_user_id: manager, decided_by_role: "Prefeita Municipal", decided_at: "2026-09-30", basis_reference: "Despacho nº 10/2026" });
    expect(await one(`SELECT current_stage, status FROM direct_procurement_workspaces WHERE id = ?`, [ws1])).toMatchObject({ current_stage: "RATIFICATION", status: "ratificado" });
    expect((await all(`SELECT id FROM process_timeline WHERE organization_id = ? AND process_id = ? AND ref_id = ?`, [ORG_A, ws1, r.decision.id])).length).toBe(1);
    const read = await m.directProcurement.getRatificationDecision({ workspaceId: ws1 });
    expect(read).toMatchObject({ currentRevision: 1, legacyRatification: null });
    expect(read.history).toHaveLength(1);
  }, 60_000);

  it("D2 — sem default e sem campos do ato ⇒ recusa antes de escrever", async () => {
    const m = await caller(manager, ORG_A);
    const before = await snapshot(ws2);
    const noOutcome = await errOf(() => m.directProcurement.ratify({ ...input(ws2), decision: undefined } as never));
    expect(noOutcome.code).toBe("BAD_REQUEST");
    for (const over of [{ decidedByName: "  " }, { decidedByRole: "" }, { decidedAt: "30/09/2026" }, { basisReference: "" }, { justification: "curta" }]) {
      const e = await errOf(() => m.directProcurement.ratify(input(ws2, over)));
      expect(e.code, JSON.stringify(over)).toBe("BAD_REQUEST");
      expect(e.message).toMatch(/DECISION_FIELDS_REQUIRED/);
    }
    expect(await snapshot(ws2)).toBe(before);
  }, 60_000);

  it("D3/D4 — replay idempotente converge sem escrita; mesma chave + pedido diferente ⇒ CONFLICT", async () => {
    const m = await caller(manager, ORG_A);
    const req = input(ws2);
    const first = await m.directProcurement.ratify(req);
    const after = await snapshot(ws2);
    const again = await m.directProcurement.ratify(req);
    expect(again.replayed).toBe(true);
    expect(again.decision.id).toBe(first.decision.id);
    expect(await snapshot(ws2)).toBe(after);
    const diff = await errOf(() => m.directProcurement.ratify({ ...req, justification: "Outra justificativa diferente." }));
    expect(diff.code).toBe("CONFLICT");
    expect(diff.message).toMatch(/DECISION_IDEMPOTENCY_CONFLICT/);
    const otherActor = await errOf(async () => (await caller(manager2, ORG_A)).directProcurement.ratify(req));
    expect(otherActor.code).toBe("CONFLICT");
    expect(await snapshot(ws2)).toBe(after);
  }, 60_000);

  it("D5/D6 — CAS e superação: revisão desatualizada recusada; nova revisão supera a anterior (preservada); não ratificado bloqueia publicação", async () => {
    const m = await caller(manager, ORG_A);
    const r1 = await m.directProcurement.ratify(input(ws3));
    const rev1Row = JSON.stringify(await one(`SELECT * FROM institutional_decisions WHERE id = ?`, [r1.decision.id]));
    const before = await snapshot(ws3);
    const stale = await errOf(() => m.directProcurement.ratify(input(ws3, { decision: "nao_ratificado", expectedRevision: 0 })));
    expect(stale.code).toBe("CONFLICT");
    expect(stale.message).toMatch(/DECISION_STALE_REVISION/);
    expect(await snapshot(ws3)).toBe(before);

    const r2 = await m.directProcurement.ratify(input(ws3, { decision: "nao_ratificado", expectedRevision: 1, justification: "Revogo a ratificação por vício na instrução." }));
    expect(r2.decision).toMatchObject({ revision: 2, outcome: "nao_ratificado", supersedesDecisionId: r1.decision.id });
    expect(JSON.stringify(await one(`SELECT * FROM institutional_decisions WHERE id = ?`, [r1.decision.id]))).toBe(rev1Row);
    const read = await m.directProcurement.getRatificationDecision({ workspaceId: ws3 });
    expect(read.current?.id).toBe(r2.decision.id);
    expect(read.history.map((d) => d.revision)).toEqual([1, 2]);
    const pub = await errOf(() => m.directProcurement.publish({ workspaceId: ws3 }));
    expect(pub.code).toBe("PRECONDITION_FAILED");
    expect(Number((await one(`SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND origin = ? AND document_type = 'ratificacao'`, [ORG_A, ws3])).n)).toBe(0);

    // "não ratificado" como 1ª decisão nunca põe o workspace em status ratificado.
    const r4 = await m.directProcurement.ratify(input(ws4, { decision: "nao_ratificado" }));
    expect(r4.decision.outcome).toBe("nao_ratificado");
    expect((await one(`SELECT status FROM direct_procurement_workspaces WHERE id = ?`, [ws4])).status).not.toBe("ratificado");
  }, 60_000);

  it("D7 — concorrência: 4 registros simultâneos da mesma revisão ⇒ exatamente 1 vence, 3 CONFLICT", async () => {
    const { createDirectProcurementWorkspace } = await import("../../domain/directProcurementWorkspace");
    const { insertDirectProcurementWorkspace } = await import("../../db/directProcurement");
    const ws = createDirectProcurementWorkspace({
      organizationId: ORG_A, processNumber: `PR07-C/${stamp}`, object: "Objeto concorrência", procurementType: "dispensa",
      startOption: "sem_dfd", responsibleUser: manager, correlationId: "pr07-seed",
    });
    await insertDirectProcurementWorkspace(ws);
    const m = await caller(manager, ORG_A);
    const res = await Promise.allSettled([0, 1, 2, 3].map((i) => m.directProcurement.ratify(input(ws.id, { justification: `Decisão concorrente número ${i}.` }))));
    const outcomes = res.map((r) => (r.status === "fulfilled" ? "ok" : (r.reason as { code?: string }).code)).sort();
    expect(outcomes).toEqual(["CONFLICT", "CONFLICT", "CONFLICT", "ok"]);
    expect((await all(`SELECT id FROM institutional_decisions WHERE organization_id = ? AND subject_id = ?`, [ORG_A, ws.id])).length).toBe(1);
  }, 60_000);

  it("D8 — tenant: outro órgão ⇒ NOT_FOUND neutro (igual a inexistente), zero escrita; leitura isolada", async () => {
    const fo = await caller(foreignOwner, ORG_B);
    const before = await snapshot(ws1);
    const cross = await errOf(() => fo.directProcurement.ratify(input(ws1)));
    const missing = await errOf(() => fo.directProcurement.ratify(input("ws-inexistente-pr07")));
    expect(cross).toEqual({ code: "NOT_FOUND", message: "Processo de contratação direta não encontrado nesta organização." });
    expect(cross).toEqual(missing);
    expect((await errOf(() => fo.directProcurement.getRatificationDecision({ workspaceId: ws1 }))).code).toBe("NOT_FOUND");
    expect(await snapshot(ws1)).toBe(before);
    expect(Number((await one(`SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ?`, [ORG_B])).n)).toBe(0);
  }, 60_000);

  it("D9 — migration 0312: colunas/índices do contrato; reaplicar o SQL é no-op", async () => {
    const idx = await all(`SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols, MIN(NON_UNIQUE) nu
      FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutional_decisions' GROUP BY INDEX_NAME ORDER BY INDEX_NAME`, []);
    expect(idx.map((r) => `${r.INDEX_NAME}:${r.cols}:${Number(r.nu)}`)).toEqual([
      "PRIMARY:id:0",
      "uq_idc_org_idempotency:organization_id,idempotency_key:0",
      "uq_idc_subject_revision:organization_id,subject_type,subject_id,revision:0",
    ]);
    const outcomeCol = await one(`SELECT IS_NULLABLE n, COLUMN_DEFAULT d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutional_decisions' AND COLUMN_NAME = 'outcome'`, []);
    expect(outcomeCol).toMatchObject({ n: "NO", d: null }); // sem resultado padrão no banco
    const before = await all(`SELECT COUNT(*) n FROM institutional_decisions`, []);
    const sql = readFileSync(path.join(process.cwd(), "drizzle", "0312_institutional_decision_ledger.sql"), "utf8")
      .split("--> statement-breakpoint").map((s) => s.replace(/^\s*--.*$/gm, "").trim()).filter(Boolean);
    for (const s of sql) await conn.query(s);
    expect(await all(`SELECT COUNT(*) n FROM institutional_decisions`, [])).toEqual(before);
  }, 60_000);
});

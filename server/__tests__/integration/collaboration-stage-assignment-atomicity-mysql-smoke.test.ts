/**
 * R1 / PR-01A — NEW-001 (P1 operacional, BLOCKER de R1.7): consistência do ENUM `notifications.type` e atribuição
 * de etapa ATÔMICA + replay-safe — smoke contra MySQL REAL. Só roda com DATABASE_URL definido.
 *
 * Problema reproduzido na main pré-fix (banco migrado): `collaboration.assignStage` no MESMO órgão gravava a
 * atribuição, o insert da notificação `stage_assigned` falhava (ENUM físico da 0004 sem o valor) e a requisição
 * respondia INTERNAL_SERVER_ERROR — estado parcial; e o retry INSERIA outra atribuição (sem chave única em
 * (processId, docType)).
 *
 * Matriz:
 *  T1  migration em banco LIMPO (cadeia completa pelo runner de release) → ENUM físico com `stage_assigned`;
 *  T2  UPGRADE a partir do estado imediatamente anterior à 0307 → aplica a 0307 e migrations posteriores;
 *  T3  rerun do runner → no-op (ledger não cresce, tipo inalterado);
 *  T4  dados preexistentes preservados (todos os valores antigos, NOT NULL, default, PK);
 *  T5/T6/T13  sucesso completo e atômico: 1 atribuição + 1 notificação `stage_assigned` + 1 activity log;
 *  T7  falha intermediária (notificação OU activity log, forçada por trigger TEMPORÁRIO do banco de teste) ⇒
 *      rollback total — nenhuma atribuição, notificação ou log;
 *  T8  retry com o mesmo payload ⇒ sucesso idempotente (`changed: false`), sem duplicar nada; concorrente idem;
 *  T9  payload diferente (nota/usuário) ⇒ atualização da MESMA etapa + notificação/log da mudança real;
 *      duplicatas históricas convergem (nenhuma linha apagada);
 *  T10 processo de outro órgão ⇒ NOT_FOUND sem efeito; T11 alvo de outro órgão ⇒ NOT_FOUND sem efeito;
 *  T12 usuário multi-org resolvido no órgão da sessão;
 *  T14 leitor (`notifications.list`/`unreadCount`) aceita `stage_assigned`;
 *  T15 activity log com organizationId + correlationId; evento `stage_assignment_applied` sem PII.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { migrateWithAdvisoryLock } from "../../db/releaseMigrate";
import { collectSchemaProblems } from "../../bootstrap";

const DB = process.env.DATABASE_URL;
const DRZ = path.join(process.cwd(), "drizzle");
const TAG_0307 = "0307_notifications_stage_assigned";
const OLD_VALUES = ["member_added", "document_edited", "document_approved", "comment_added", "general"] as const;
const FINAL_TYPE = "enum('member_added','document_edited','document_approved','comment_added','stage_assigned','general')";

function urlFor(dbName: string): string {
  const u = new URL(DB!);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function columnInfo(conn: mysql.Connection) {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COLUMN_TYPE AS t, IS_NULLABLE AS n, COLUMN_DEFAULT AS d FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications' AND COLUMN_NAME = 'type'`);
  const r = rows[0];
  return { type: String(r.t), nullable: String(r.n), def: String(r.d).replace(/^'|'$/g, "") };
}
async function ledgerCount(conn: mysql.Connection) {
  const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM __drizzle_migrations");
  return Number(rows[0].n);
}

// ── T1–T4: migrations em bancos DEDICADOS (herméticos) ─────────────────────────────────────────────────────────
describe.skipIf(!DB)("PR-01A / NEW-001 — migration 0307 (MySQL real, bancos dedicados)", () => {
  const stamp = Date.now();
  const cleanDb = `pr01a_clean_${stamp}`;
  const upgradeDb = `pr01a_upgrade_${stamp}`;
  let admin: mysql.Connection;
  let tmpFolder = "";

  beforeAll(async () => {
    admin = await mysql.createConnection(DB!);
    await admin.query(`CREATE DATABASE \`${cleanDb}\``);
    await admin.query(`CREATE DATABASE \`${upgradeDb}\``);
    // Pasta de migrations no estado IMEDIATAMENTE ANTERIOR à 0307.
    tmpFolder = mkdtempSync(path.join(os.tmpdir(), "pr01a-pre0307-"));
    mkdirSync(path.join(tmpFolder, "meta"));
    for (const f of readdirSync(DRZ).filter((x) => /^\d{4}_.+\.sql$/.test(x) && Number(x.slice(0, 4)) < 307)) {
      cpSync(path.join(DRZ, f), path.join(tmpFolder, f));
    }
    const journal = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx < 307);
    writeFileSync(path.join(tmpFolder, "meta", "_journal.json"), JSON.stringify(journal));
  }, 60000);

  afterAll(async () => {
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS \`${cleanDb}\``).catch(() => {});
      await admin.query(`DROP DATABASE IF EXISTS \`${upgradeDb}\``).catch(() => {});
      await admin.end();
    }
    if (tmpFolder) rmSync(tmpFolder, { recursive: true, force: true });
  });

  it("a 0307 permanece na ordem do journal, antes das migrations posteriores", () => {
    const journal = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8"));
    const entry = journal.entries.find((e: { tag: string }) => e.tag === TAG_0307);
    expect(entry?.idx).toBe(307);
    expect(entry?.when).toBeGreaterThan(journal.entries.find((e: { idx: number }) => e.idx === 306)?.when);
  });

  it("T1 — banco LIMPO: cadeia completa pelo runner de release ⇒ ENUM físico com stage_assigned e schema válido", async () => {
    const conn = await mysql.createConnection(urlFor(cleanDb));
    try {
      await migrateWithAdvisoryLock(conn);
      expect(await columnInfo(conn)).toEqual({ type: FINAL_TYPE, nullable: "NO", def: "general" });
      expect(await collectSchemaProblems(conn)).toEqual([]);
    } finally {
      await conn.end();
    }
  }, 240000);

  it("T2/T3/T4 — UPGRADE do estado pré-0307 com dados ⇒ aplica pendentes, preserva dados; rerun = no-op", async () => {
    const conn = await mysql.createConnection(urlFor(upgradeDb));
    try {
      await migrate(drizzle(conn), { migrationsFolder: tmpFolder });
      const before = await ledgerCount(conn);
      expect(await columnInfo(conn)).toEqual({ type: `enum(${OLD_VALUES.map((v) => `'${v}'`).join(",")})`, nullable: "NO", def: "general" });
      // pré-fix: o valor é recusado fisicamente (é exatamente o NEW-001)
      await expect(conn.query(`INSERT INTO notifications (userId, title, message, type) VALUES (1, 'x', 'x', 'stage_assigned')`)).rejects.toThrow();

      // T4 — fixture pré-migration: uma linha por valor antigo + uma com o default
      for (const v of OLD_VALUES) {
        await conn.query(`INSERT INTO notifications (userId, title, message, type, processId) VALUES (?, ?, 'm', ?, 7)`, [42, `pre-${v}`, v]);
      }
      await conn.query(`INSERT INTO notifications (userId, title, message) VALUES (42, 'pre-default', 'm')`);
      const [pre] = await conn.query<mysql.RowDataPacket[]>(`SELECT id, title, type, isRead FROM notifications ORDER BY id`);

      // T2 — runner real: aplica a 0307 e as migrations posteriores.
      await migrateWithAdvisoryLock(conn);
      const fullJournal = JSON.parse(readFileSync(path.join(DRZ, "meta", "_journal.json"), "utf8"));
      expect(await ledgerCount(conn)).toBe(before + fullJournal.entries.filter((e: { idx: number }) => e.idx >= 307).length);
      expect(await columnInfo(conn)).toEqual({ type: FINAL_TYPE, nullable: "NO", def: "general" });
      const [post] = await conn.query<mysql.RowDataPacket[]>(`SELECT id, title, type, isRead FROM notifications ORDER BY id`);
      expect(post).toEqual(pre);                                                  // T4 — mesmas linhas, mesmos valores
      const [pk] = await conn.query<mysql.RowDataPacket[]>(`SHOW INDEX FROM notifications WHERE Key_name = 'PRIMARY'`);
      expect(pk.length).toBe(1);
      await conn.query(`INSERT INTO notifications (userId, title, message, type) VALUES (42, 'pos', 'm', 'stage_assigned')`);
      const [sa] = await conn.query<mysql.RowDataPacket[]>(`SELECT type FROM notifications WHERE title = 'pos'`);
      expect(sa[0].type).toBe("stage_assigned");
      await expect(conn.query(`INSERT INTO notifications (userId, title, message, type) VALUES (42, 'x', 'x', 'nao_existe')`)).rejects.toThrow();

      // T3 — rerun: ledger não cresce, tipo e dados inalterados
      const ledgerAfter = await ledgerCount(conn);
      await migrateWithAdvisoryLock(conn);
      expect(await ledgerCount(conn)).toBe(ledgerAfter);
      expect(await columnInfo(conn)).toEqual({ type: FINAL_TYPE, nullable: "NO", def: "general" });
      const [again] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n FROM notifications`);
      expect(Number(again[0].n)).toBe(OLD_VALUES.length + 2);
    } finally {
      await conn.end();
    }
  }, 240000);
});

// ── T5–T15: comportamento de assignStage no banco de teste migrado ─────────────────────────────────────────────
describe.skipIf(!DB)("PR-01A / NEW-001 — assignStage atômico e replay-safe (MySQL real)", () => {
  const ORG_A = 960201;
  const ORG_B = 960202;
  let conn: mysql.Connection;
  const stamp = Date.now();
  const email = (tag: string) => `r1a-${tag}-${stamp}@teste.local`;
  const nameOf = (tag: string) => `R1A ${tag} ${stamp}`;
  let owner: number, m1: number, m2: number, multi: number, bUser: number, bOwner: number;
  const procs: number[] = [];
  let pB: number;

  async function proc(org: number, ownerId: number): Promise<number> {
    const [r] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, ?, 'Objeto R1A', ?, 'em_dfd')`,
      [org, `Processo R1A ${org} ${stamp} ${procs.length}`, ownerId]);
    procs.push(r.insertId);
    return r.insertId;
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A R1A ${stamp}`, `org-a-r1a-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B R1A ${stamp}`, `org-b-r1a-${stamp}`]);
    async function user(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')`, [`r1a-${tag}-${stamp}`, nameOf(tag), email(tag)]);
      return r.insertId;
    }
    const member = (org: number, u: number, role = "operator") =>
      conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, u, role]);
    owner = await user("owner"); m1 = await user("m1"); m2 = await user("m2"); multi = await user("multi");
    bUser = await user("b-user"); bOwner = await user("b-owner");
    await member(ORG_A, owner, "owner"); await member(ORG_A, m1); await member(ORG_A, m2);
    await member(ORG_A, multi); await member(ORG_B, multi);
    await member(ORG_B, bUser); await member(ORG_B, bOwner, "owner");
    pB = await proc(ORG_B, bOwner);
  }, 60000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    await conn.query("DROP TRIGGER IF EXISTS pr01a_fail_notification").catch(() => {});
    await conn.query("DROP TRIGGER IF EXISTS pr01a_fail_activity").catch(() => {});
    const users = [owner, m1, m2, multi, bUser, bOwner];
    const inP = procs.map(() => "?").join(",");
    await del(`DELETE FROM stage_assignments WHERE processId IN (${inP})`, procs);
    await del(`DELETE FROM notifications WHERE processId IN (${inP})`, procs);
    await del(`DELETE FROM activity_logs WHERE processId IN (${inP})`, procs);
    await del(`DELETE FROM processes WHERE id IN (${inP})`, procs);
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM users WHERE id IN (${users.map(() => "?").join(",")})`, users);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function caller(userId: number, org: number, correlationId = `r1a-${userId}-${org}`) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  const n = async (sql: string, p: unknown[]) => Number((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0][0].n);
  const state = async (p: number) => ({
    assignments: await n(`SELECT COUNT(*) n FROM stage_assignments WHERE processId = ?`, [p]),
    notifications: await n(`SELECT COUNT(*) n FROM notifications WHERE processId = ? AND type = 'stage_assigned'`, [p]),
    activity: await n(`SELECT COUNT(*) n FROM activity_logs WHERE processId = ? AND action LIKE 'designou %'`, [p]),
  });
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
    return { code: "RESOLVED", message: "" };
  };

  it("T5/T6/T13 — mesmo órgão: sucesso completo e atômico (1 atribuição + 1 notificação stage_assigned + 1 log)", async () => {
    const p = await proc(ORG_A, owner);
    const c = await caller(owner, ORG_A, "r1a-t5");
    const out = await c.collaboration.assignStage({ processId: p, docType: "tr", assignedUserId: m1, note: "revisar" });
    expect(out).toEqual({ success: true, changed: true });
    expect(await state(p)).toEqual({ assignments: 1, notifications: 1, activity: 1 });
    const [row] = (await conn.execute<mysql.RowDataPacket[]>(
      `SELECT docType, assignedUserId, assignedBy, note FROM stage_assignments WHERE processId = ?`, [p]))[0];
    expect(row).toMatchObject({ docType: "tr", assignedUserId: m1, assignedBy: owner, note: "revisar" });
    const [notif] = (await conn.execute<mysql.RowDataPacket[]>(
      `SELECT userId, type, title, message, isRead FROM notifications WHERE processId = ?`, [p]))[0];
    expect(notif).toMatchObject({ userId: m1, type: "stage_assigned", title: "Você foi designado como responsável por uma etapa" });
    expect(String(notif.message)).toContain("etapa TR");
    expect(String(notif.message)).toContain("Nota: revisar");
    expect(Number(notif.isRead)).toBe(0);
  }, 30000);

  it("T7 — falha na NOTIFICAÇÃO (trigger temporário do banco de teste) ⇒ rollback total", async () => {
    const p = await proc(ORG_A, owner);
    await conn.query(`CREATE TRIGGER pr01a_fail_notification BEFORE INSERT ON notifications FOR EACH ROW
      BEGIN IF NEW.processId = ${p} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pr01a forced notification failure'; END IF; END`);
    try {
      const err = await errOf(async () => (await caller(owner, ORG_A)).collaboration.assignStage({ processId: p, docType: "etp", assignedUserId: m1 }));
      expect(err.code).toBe("INTERNAL_SERVER_ERROR");
      expect(await state(p)).toEqual({ assignments: 0, notifications: 0, activity: 0 });
    } finally {
      await conn.query("DROP TRIGGER IF EXISTS pr01a_fail_notification");
    }
    // sem o trigger, a mesma chamada converge normalmente (o rollback não deixou resíduo que bloqueie o retry)
    await (await caller(owner, ORG_A)).collaboration.assignStage({ processId: p, docType: "etp", assignedUserId: m1 });
    expect(await state(p)).toEqual({ assignments: 1, notifications: 1, activity: 1 });
  }, 30000);

  it("T7 — falha no ACTIVITY LOG (último write) ⇒ rollback total, inclusive da notificação já inserida", async () => {
    const p = await proc(ORG_A, owner);
    await conn.query(`CREATE TRIGGER pr01a_fail_activity BEFORE INSERT ON activity_logs FOR EACH ROW
      BEGIN IF NEW.processId = ${p} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'pr01a forced activity failure'; END IF; END`);
    try {
      const err = await errOf(async () => (await caller(owner, ORG_A)).collaboration.assignStage({ processId: p, docType: "dfd", assignedUserId: m2 }));
      expect(err.code).toBe("INTERNAL_SERVER_ERROR");
      expect(await state(p)).toEqual({ assignments: 0, notifications: 0, activity: 0 });
      expect(await n(`SELECT COUNT(*) n FROM notifications WHERE processId = ?`, [p])).toBe(0);
    } finally {
      await conn.query("DROP TRIGGER IF EXISTS pr01a_fail_activity");
    }
  }, 30000);

  it("T8 — retry com o MESMO payload ⇒ sucesso idempotente, sem duplicar atribuição/notificação/log", async () => {
    const p = await proc(ORG_A, owner);
    const c = await caller(owner, ORG_A);
    const input = { processId: p, docType: "edital" as const, assignedUserId: m1, note: "prazo" };
    expect(await c.collaboration.assignStage(input)).toEqual({ success: true, changed: true });
    expect(await c.collaboration.assignStage(input)).toEqual({ success: true, changed: false });
    expect(await c.collaboration.assignStage(input)).toEqual({ success: true, changed: false });
    expect(await state(p)).toEqual({ assignments: 1, notifications: 1, activity: 1 });
    // nota ausente ≡ nota vazia (o router sempre persistiu `note || null`)
    const q = await proc(ORG_A, owner);
    await c.collaboration.assignStage({ processId: q, docType: "tr", assignedUserId: m1 });
    expect(await c.collaboration.assignStage({ processId: q, docType: "tr", assignedUserId: m1, note: "" })).toEqual({ success: true, changed: false });
    expect(await state(q)).toEqual({ assignments: 1, notifications: 1, activity: 1 });
  }, 30000);

  it("T8 — retries CONCORRENTES do mesmo payload ⇒ exatamente 1 atribuição, 1 notificação e 1 log (lock do processo)", async () => {
    const p = await proc(ORG_A, owner);
    const c = await caller(owner, ORG_A);
    const input = { processId: p, docType: "ata" as const, assignedUserId: m2 };
    const results = await Promise.all([1, 2, 3, 4].map(() => c.collaboration.assignStage(input)));
    expect(results.filter((r) => r.changed).length).toBe(1);
    expect(await state(p)).toEqual({ assignments: 1, notifications: 1, activity: 1 });
  }, 30000);

  it("T9 — payload diferente na MESMA etapa ⇒ atualiza a atribuição existente e notifica/loga a mudança real", async () => {
    const p = await proc(ORG_A, owner);
    const c = await caller(owner, ORG_A);
    await c.collaboration.assignStage({ processId: p, docType: "parecer", assignedUserId: m1, note: "v1" });
    expect(await c.collaboration.assignStage({ processId: p, docType: "parecer", assignedUserId: m1, note: "v2" })).toEqual({ success: true, changed: true });
    expect(await c.collaboration.assignStage({ processId: p, docType: "parecer", assignedUserId: m2, note: "v2" })).toEqual({ success: true, changed: true });
    expect(await state(p)).toEqual({ assignments: 1, notifications: 3, activity: 3 });
    const [row] = (await conn.execute<mysql.RowDataPacket[]>(`SELECT assignedUserId, note FROM stage_assignments WHERE processId = ?`, [p]))[0];
    expect(row).toMatchObject({ assignedUserId: m2, note: "v2" });
    expect(await n(`SELECT COUNT(*) n FROM notifications WHERE processId = ? AND userId = ?`, [p, m2])).toBe(1);
    // etapas diferentes são independentes
    await c.collaboration.assignStage({ processId: p, docType: "dfd", assignedUserId: m1 });
    expect(await n(`SELECT COUNT(*) n FROM stage_assignments WHERE processId = ?`, [p])).toBe(2);
  }, 30000);

  it("T9 — duplicatas HISTÓRICAS da etapa convergem ao estado pedido (nenhuma linha apagada) e o replay fica idempotente", async () => {
    const p = await proc(ORG_A, owner);
    for (const u of [m1, m2]) {
      await conn.execute(`INSERT INTO stage_assignments (processId, docType, assignedUserId, assignedBy) VALUES (?, 'contrato', ?, ?)`, [p, u, owner]);
    }
    const c = await caller(owner, ORG_A);
    expect(await c.collaboration.assignStage({ processId: p, docType: "contrato", assignedUserId: m2, note: "final" })).toEqual({ success: true, changed: true });
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(`SELECT assignedUserId, note FROM stage_assignments WHERE processId = ?`, [p]);
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.assignedUserId === m2 && r.note === "final")).toBe(true);
    expect(await c.collaboration.assignStage({ processId: p, docType: "contrato", assignedUserId: m2, note: "final" })).toEqual({ success: true, changed: false });
  }, 30000);

  it("T10 — processo de OUTRO órgão ⇒ o mesmo NOT_FOUND e nenhuma escrita em lugar algum", async () => {
    const before = { ...(await state(pB)), all: await n(`SELECT COUNT(*) n FROM notifications WHERE userId = ?`, [m1]) };
    const err = await errOf(async () => (await caller(owner, ORG_A)).collaboration.assignStage({ processId: pB, docType: "tr", assignedUserId: m1 }));
    expect(err).toEqual({ code: "NOT_FOUND", message: "Processo não encontrado." });
    expect({ ...(await state(pB)), all: await n(`SELECT COUNT(*) n FROM notifications WHERE userId = ?`, [m1]) }).toEqual(before);
  }, 30000);

  it("T11 — alvo de OUTRO órgão ⇒ NOT_FOUND idêntico ao inexistente e nenhuma escrita (SEM-001 não regride)", async () => {
    const p = await proc(ORG_A, owner);
    const c = await caller(owner, ORG_A);
    const foreign = await errOf(() => c.collaboration.assignStage({ processId: p, docType: "tr", assignedUserId: bUser }));
    const missing = await errOf(() => c.collaboration.assignStage({ processId: p, docType: "tr", assignedUserId: 2147480000 }));
    expect(foreign).toEqual({ code: "NOT_FOUND", message: "Usuário não encontrado nesta organização." });
    expect(missing).toEqual(foreign);
    expect(await state(p)).toEqual({ assignments: 0, notifications: 0, activity: 0 });
    expect(await n(`SELECT COUNT(*) n FROM notifications WHERE userId = ?`, [bUser])).toBe(0);
  }, 30000);

  it("T12 — usuário com membership em A e B é atribuído dentro de A quando a sessão está em A", async () => {
    const p = await proc(ORG_A, owner);
    await (await caller(owner, ORG_A)).collaboration.assignStage({ processId: p, docType: "etp", assignedUserId: multi });
    expect(await state(p)).toEqual({ assignments: 1, notifications: 1, activity: 1 });
  }, 30000);

  it("T14 — leitor de notificações aceita stage_assigned (list/unreadCount/markAsRead sem erro)", async () => {
    const reader = await caller(m1, ORG_A);
    const list = await reader.notifications.list({ limit: 100 });
    const mine = list.filter((x) => x.type === "stage_assigned");
    expect(mine.length).toBeGreaterThan(0);
    expect(await reader.notifications.unreadCount()).toBeGreaterThanOrEqual(mine.length);
    await expect(reader.notifications.markAsRead({ notificationId: mine[0].id })).resolves.toEqual({ success: true });
  }, 30000);

  it("T15 — activity log com organizationId + correlationId (truncado a 36) e evento stage_assignment_applied sem PII", async () => {
    const p = await proc(ORG_A, owner);
    const info = vi.spyOn(console, "info");
    try {
      const corr = `r1a-t15-${"z".repeat(60)}`;
      await (await caller(owner, ORG_A, corr)).collaboration.assignStage({ processId: p, docType: "tr", assignedUserId: m2 });
      const [log] = (await conn.execute<mysql.RowDataPacket[]>(
        `SELECT organizationId, correlationId, userId, details FROM activity_logs WHERE processId = ?`, [p]))[0];
      expect(log).toMatchObject({ organizationId: ORG_A, correlationId: corr.slice(0, 36), userId: owner });
      expect(JSON.parse(String(log.details))).toEqual({ docType: "tr", assignedUserId: m2 });
      const line = info.mock.calls.map((a) => String(a[0])).find((l) => l.includes("stage_assignment_applied") && l.includes(`"processId":${p}`));
      expect(line).toBeDefined();
      expect(line).toContain('"decision":"insert"');
      expect(line).not.toContain(nameOf("m2"));
      expect(line).not.toContain(email("m2"));
    } finally {
      info.mockRestore();
    }
  }, 30000);
});

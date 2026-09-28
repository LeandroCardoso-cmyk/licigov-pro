/**
 * R2 / LEG-005 — smoke contra MySQL REAL do desligamento governado das procedures legadas de itens do
 * TR / CATMAT (`processes.addItemsToTR`, `getProcessItems`, `parseItemsFile`, `generateCatmatSuggestions`,
 * `getCatmatSuggestions`, `approveCatmatSuggestion`, `rejectCatmatSuggestion`, `updateProcessItem`,
 * `deleteProcessItem`). Só roda com DATABASE_URL definido.
 *
 * Fixture: processo LEGADO por tenant (A e B) + `process_items` + `catmat_suggestions` (pendentes) +
 * um `activity_logs` pré-existente. Todas as 9 procedures são chamadas pelo appRouter real, por owner /
 * operator / viewer do tenant A e pelo owner do tenant B, contra ids próprios e de outro tenant. Prova:
 *  - toda chamada → FORBIDDEN + LEGACY_ENDPOINT_DISABLED, com a MESMA mensagem para todos;
 *  - as linhas de process_items / catmat_suggestions ficam byte-a-byte inalteradas (nada aprovado,
 *    rejeitado, editado, apagado ou inserido), nenhum activity_log novo e nenhum ai_usage_tracking novo
 *    (generateCatmatSuggestions não chega à IA nem ao rastreio de uso).
 * Os dados históricos são PRESERVADOS — o guard não apaga nada (o afterAll remove só a própria fixture).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 997051;
const ORG_B = 997052;
const TOKEN = "LEGACY_ENDPOINT_DISABLED";

type Ids = { process: number; item: number; suggestion: number };

const PROCEDURES: readonly { name: string; input: (i: Ids) => unknown }[] = [
  { name: "addItemsToTR", input: (i) => ({ processId: i.process, items: [{ itemType: "material", description: "Item novo que não pode ser gravado", unit: "UN", quantity: 5 }] }) },
  { name: "getProcessItems", input: (i) => ({ processId: i.process }) },
  { name: "parseItemsFile", input: () => ({ fileContent: Buffer.from("descricao\nCaneta esferográfica azul").toString("base64"), fileName: "itens.xlsx", columnMapping: { description: 0 } }) },
  { name: "generateCatmatSuggestions", input: (i) => ({ processItemId: i.item, description: "Caneta esferográfica azul", itemType: "material" }) },
  { name: "getCatmatSuggestions", input: (i) => ({ processItemId: i.item }) },
  { name: "approveCatmatSuggestion", input: (i) => ({ suggestionId: i.suggestion, processItemId: i.item }) },
  { name: "rejectCatmatSuggestion", input: (i) => ({ suggestionId: i.suggestion }) },
  { name: "updateProcessItem", input: (i) => ({ itemId: i.item, description: "Descrição alterada indevidamente", quantity: 999, catmatCode: "424242" }) },
  { name: "deleteProcessItem", input: (i) => ({ itemId: i.item }) },
];

describe.skipIf(!DB)("R2 / LEG-005 — itens do TR / CATMAT legados desativados (MySQL real)", () => {
  let conn: mysql.Connection;
  const users: Record<"ownerA" | "operatorA" | "viewerA" | "ownerB", number> = { ownerA: 0, operatorA: 0, viewerA: 0, ownerB: 0 };
  let idsA: Ids;
  let idsB: Ids;
  let processIds: number[] = [];
  let itemIds: number[] = [];
  let suggestionIds: number[] = [];
  let activityLogId = 0;

  async function snapshot() {
    const [items] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT * FROM process_items WHERE processId IN (?) ORDER BY id`, [processIds],
    );
    const [suggestions] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT * FROM catmat_suggestions WHERE processItemId IN (?) ORDER BY id`, [itemIds],
    );
    const [logs] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id, processId, userId, action FROM activity_logs WHERE processId IN (?) ORDER BY id`, [processIds],
    );
    const [usage] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM ai_usage_tracking WHERE userId IN (?)`, [Object.values(users)],
    );
    const [procs] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id, organizationId, name, status FROM processes WHERE id IN (?) ORDER BY id`, [processIds],
    );
    return JSON.parse(JSON.stringify({ items, suggestions, logs, usage: usage[0].n, procs }));
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    const stamp = Date.now();

    for (const tag of Object.keys(users) as (keyof typeof users)[]) {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`,
        [`leg005-${tag}-${stamp}`, `Usuário ${tag}`, `leg005-${tag}-${stamp}@teste.local`],
      );
      users[tag] = r.insertId;
    }
    const members: [number, number, string][] = [
      [ORG_A, users.ownerA, "owner"], [ORG_A, users.operatorA, "operator"], [ORG_A, users.viewerA, "viewer"],
      [ORG_B, users.ownerB, "owner"],
    ];
    for (const [org, userId, role] of members) {
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, userId, role]);
    }

    async function legacyFixture(org: number, owner: number): Promise<Ids> {
      const [p] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, 'Processo legado LEG-005', 'Objeto legado', ?, 'em_tr')`,
        [org, owner],
      );
      const [it] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO process_items (processId, itemType, catmatCode, description, unit, quantity, estimatedPrice) VALUES (?, 'material', 111111, 'Caneta esferográfica azul', 'UN', 10, 150)`,
        [p.insertId],
      );
      const [it2] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO process_items (processId, itemType, description, unit, quantity) VALUES (?, 'service', 'Serviço de manutenção predial', 'MES', 12)`,
        [p.insertId],
      );
      const [s] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO catmat_suggestions (processItemId, catmatCode, description, confidenceScore, reasoning, status) VALUES (?, 'CAT-222222', 'Caneta azul', 80, 'motivo', 'pending')`,
        [it.insertId],
      );
      const [s2] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO catmat_suggestions (processItemId, catmatCode, description, confidenceScore, reasoning, status) VALUES (?, 'CAT-333333', 'Caneta azul fina', 60, 'motivo 2', 'pending')`,
        [it.insertId],
      );
      processIds.push(p.insertId);
      itemIds.push(it.insertId, it2.insertId);
      suggestionIds.push(s.insertId, s2.insertId);
      return { process: p.insertId, item: it.insertId, suggestion: s.insertId };
    }
    idsA = await legacyFixture(ORG_A, users.ownerA);
    idsB = await legacyFixture(ORG_B, users.ownerB);

    const [log] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO activity_logs (processId, userId, action, organizationId) VALUES (?, ?, 'fixture LEG-005', ?)`,
      [idsA.process, users.ownerA, ORG_A],
    );
    activityLogId = log.insertId;
  }, 30000);

  afterAll(async () => {
    if (conn) {
      const del = async (sql: string, p: unknown[]) => { await conn.query(sql, p).catch(() => {}); };
      // Remove SOMENTE a própria fixture deste smoke (ids capturados no beforeAll).
      if (suggestionIds.length) await del(`DELETE FROM catmat_suggestions WHERE id IN (?)`, [suggestionIds]);
      if (itemIds.length) await del(`DELETE FROM process_items WHERE id IN (?)`, [itemIds]);
      if (activityLogId) await del(`DELETE FROM activity_logs WHERE id = ?`, [activityLogId]);
      if (processIds.length) await del(`DELETE FROM processes WHERE id IN (?)`, [processIds]);
      await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
      await del(`DELETE FROM users WHERE id IN (?)`, [Object.values(users)]);
      await conn.end();
    }
  });

  async function makeCaller(userId: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Usuário ${userId}`, email: `u${userId}@teste.local` },
      req: { headers: {} },
      res: {},
      correlationId: "test-leg005",
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }

  it("as 9 procedures recusam (FORBIDDEN + token) para owner/operator/viewer/cross-tenant e NADA muda no banco", async () => {
    const before = await snapshot();
    expect(before.items).toHaveLength(4);
    expect(before.suggestions).toHaveLength(4);
    expect(before.logs).toHaveLength(1);

    const messages = new Set<string>();
    const scenarios: { user: number; ids: Ids }[] = [
      { user: users.ownerA, ids: idsA },
      { user: users.operatorA, ids: idsA },
      { user: users.viewerA, ids: idsA },
      { user: users.ownerA, ids: idsB }, // A mirando recursos de B
      { user: users.ownerB, ids: idsA }, // B mirando recursos de A
      { user: users.ownerB, ids: idsB },
    ];
    for (const { user, ids } of scenarios) {
      const caller = (await makeCaller(user)) as unknown as { processes: Record<string, (i: unknown) => Promise<unknown>> };
      for (const p of PROCEDURES) {
        let err: { code?: string; message?: string } | null = null;
        try {
          await caller.processes[p.name](p.input(ids));
        } catch (e) {
          err = e as { code?: string; message?: string };
        }
        expect(err, `processes.${p.name} deveria recusar`).not.toBeNull();
        expect(err!.code, `processes.${p.name}`).toBe("FORBIDDEN");
        expect(err!.message, `processes.${p.name}`).toContain(TOKEN);
        messages.add(`${err!.code}|${err!.message}`);
      }
    }
    // Resposta única: não diferencia papel, tenant, existência ou procedure.
    expect(messages.size, [...messages].join(" || ")).toBe(1);

    const after = await snapshot();
    expect(after).toEqual(before);
    // Explícito: sugestões seguem pendentes, itens com os mesmos valores, nenhum uso de IA rastreado.
    expect(after.suggestions.every((s: { status: string }) => s.status === "pending")).toBe(true);
    expect(after.usage).toBe(before.usage);
  }, 60000);

  it("procedures fora do escopo LEG-005 seguem vivas sobre o mesmo processo legado (getById próprio ok; cross-tenant NOT_FOUND)", async () => {
    const callerA = await makeCaller(users.ownerA);
    const own = await callerA.processes.getById({ id: idsA.process });
    expect(own?.id).toBe(idsA.process);
    await expect(callerA.processes.getById({ id: idsB.process })).rejects.toThrow(/não encontrado/i);
  });
});

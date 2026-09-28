/**
 * PR-12 (SEM-023) — "Contrato vigente só muda por instrumento" — smoke contra MySQL REAL, pelo router
 * real (`tenantProcedure`, membership do banco) e pelo UPDATE condicional real em `contract_workspaces`.
 *
 *   - revisão divergente ⇒ CONFLICT `CONTRACT_REVISION_CONFLICT`, linha intacta;
 *   - dois saves concorrentes com a MESMA revisão ⇒ exatamente um vence (o outro CONFLICT), um evento;
 *   - contrato vigente: alterar valor/contratado/objeto ⇒ BAD_REQUEST
 *     `CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT`, linha intacta (FALHA em main — ver relatório R3.1);
 *   - minuta: a mesma alteração é permitida e persistida;
 *   - vigente: gestor/fiscal editáveis com CAS; revisão avança e a antiga passa a ser recusada;
 *   - cross-tenant ⇒ NOT_FOUND inalterado, linha intacta.
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { contractWorkspaceRouter } from "../../routers/contractWorkspaceRouter";
import { createManualContract } from "../../services/contractService";

const DB = process.env.DATABASE_URL;
const ORG_A = 991701;
const ORG_B = 991702;
const CORR = "corr-pr12-smoke";
const TOKEN_CONFLICT = "CONTRACT_REVISION_CONFLICT";
const TOKEN_INSTRUMENT = "CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT";

let conn: mysql.Connection;
let userA = 0;
let userB = 0;

function caller(userId: number) {
  return contractWorkspaceRouter.createCaller({
    user: { id: userId, role: "user" }, req: { headers: {} }, res: {},
    correlationId: `pr12-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  } as unknown as Parameters<typeof contractWorkspaceRouter.createCaller>[0]);
}

async function insertUser(tag: string): Promise<number> {
  const [r] = await conn.execute<mysql.ResultSetHeader>(
    "INSERT INTO users (openId, name, email) VALUES (?, ?, ?)",
    [`pr12-smoke-${tag}-${Date.now()}`, `PR12 ${tag}`, `pr12-smoke-${tag}-${Date.now()}@teste.local`],
  );
  return r.insertId;
}

/** Linha persistida inteira (colunas editáveis + revisão), para provar "zero escritas". */
async function row(id: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT contract_number, contractor, object, CAST(value AS CHAR) AS value, term, status, manager, inspector,
            DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s.%f') AS updated_at
       FROM contract_workspaces WHERE id = ?`, [id],
  );
  return rows[0] ?? null;
}

async function changeEvents(id: string): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS n FROM process_timeline WHERE process_id = ? AND organization_id = ? AND event_type = 'change'", [id, ORG_A],
  );
  return Number(rows[0].n);
}

/** Cria contrato (fluxo avulso real, nasce minuta) e, se pedido, coloca-o em outro status (fixture SQL). */
async function seedContract(number: string, status: "minuta" | "vigente" | "aditado" = "minuta") {
  const ws = await createManualContract({
    organizationId: ORG_A, contractNumber: number, contractor: "ACME LTDA", object: "Serviços de limpeza",
    value: 100000, term: "12 meses", manager: "Ana", inspector: "Bruno", createdBy: userA, correlationId: CORR,
  });
  if (status !== "minuta") {
    await conn.execute("UPDATE contract_workspaces SET status = ? WHERE id = ? AND organization_id = ?", [status, ws.id, ORG_A]);
  }
  const { workspace } = await caller(userA).loadContract({ contractId: ws.id });
  return workspace!;
}

async function cleanup() {
  for (const org of [ORG_A, ORG_B]) {
    for (const [t, col] of [["process_timeline", "organization_id"], ["contract_workspaces", "organization_id"], ["idempotency_keys", "organizationId"], ["organization_members", "organizationId"]] as const) {
      await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
    }
  }
}

describe.skipIf(!DB)("PR-12 · contrato vigente só muda por instrumento (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await cleanup();
    for (const id of [ORG_A, ORG_B]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `Org PR12 ${id}`, `pr12-${id}`]);
    }
    userA = await insertUser("a");
    userB = await insertUser("b");
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)", [ORG_A, userA]);
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)", [ORG_B, userB]);
  }, 60_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup();
    await conn.execute("DELETE FROM users WHERE id IN (?, ?)", [userA, userB]).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("1) contrato VIGENTE: alterar valor / contratado / objeto ⇒ BAD_REQUEST com token; linha intacta, sem evento", async () => {
    const ws = await seedContract("CT-PR12-VIG-ECON", "vigente");
    const before = await row(ws.id);
    const events = await changeEvents(ws.id);
    for (const patch of [{ value: 999999 }, { contractor: "Outra SA" }, { object: "Objeto trocado sem aditivo" }]) {
      const p = caller(userA).updateContract({ contractId: ws.id, expectedUpdatedAt: ws.updatedAt, ...patch });
      await expect(p).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(p).rejects.toThrow(TOKEN_INSTRUMENT);
    }
    expect(await row(ws.id)).toEqual(before);
    expect(before).toMatchObject({ value: "100000.00", contractor: "ACME LTDA", object: "Serviços de limpeza", status: "vigente" });
    expect(await changeEvents(ws.id)).toBe(events);
  }, 60_000);

  it("2) contrato ADITADO (pós-minuta) também recusa valor; linha intacta", async () => {
    const ws = await seedContract("CT-PR12-ADT-ECON", "aditado");
    const before = await row(ws.id);
    await expect(caller(userA).updateContract({ contractId: ws.id, expectedUpdatedAt: ws.updatedAt, value: 1 })).rejects.toThrow(TOKEN_INSTRUMENT);
    expect(await row(ws.id)).toEqual(before);
  }, 60_000);

  it("3) MINUTA: a mesma alteração econômica é permitida e persistida; revisão avança; evento com antes/depois", async () => {
    const ws = await seedContract("CT-PR12-MIN-ECON");
    const { workspace } = await caller(userA).updateContract({ contractId: ws.id, expectedUpdatedAt: ws.updatedAt, value: 150000, contractor: "Outra SA", object: "Objeto revisado" });
    expect(await row(ws.id)).toMatchObject({ value: "150000.00", contractor: "Outra SA", object: "Objeto revisado", status: "minuta" });
    expect(Date.parse(workspace.updatedAt)).toBeGreaterThan(Date.parse(ws.updatedAt));
    const reloaded = (await caller(userA).loadContract({ contractId: ws.id })).workspace!;
    expect(reloaded.updatedAt).toBe(workspace.updatedAt); // a revisão devolvida É a persistida (round-trip DATETIME(3))
    const [ev] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT actor, summary FROM process_timeline WHERE process_id = ? AND organization_id = ? AND event_type = 'change' ORDER BY event_order DESC LIMIT 1", [ws.id, ORG_A],
    );
    expect(ev[0].actor).toBe(`user:${userA}`);
    expect(String(ev[0].summary)).toContain('value: "100000" → "150000"');
  }, 60_000);

  it("4) VIGENTE: alteração não econômica (gestor/fiscal, formulário inteiro reenviado) é permitida com CAS; a revisão antiga passa a ser recusada", async () => {
    const ws = await seedContract("CT-PR12-VIG-MGR", "vigente");
    const { workspace } = await caller(userA).updateContract({
      contractId: ws.id, expectedUpdatedAt: ws.updatedAt, manager: "Carla", inspector: "Davi",
      contractor: ws.contractor, object: ws.object, term: ws.term, value: ws.value,
    });
    expect(await row(ws.id)).toMatchObject({ manager: "Carla", inspector: "Davi", value: "100000.00", status: "vigente" });
    const after = await row(ws.id);
    // mesma revisão antiga de novo ⇒ CONFLICT, nada muda
    const stale = caller(userA).updateContract({ contractId: ws.id, expectedUpdatedAt: ws.updatedAt, manager: "Eva" });
    await expect(stale).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(stale).rejects.toThrow(TOKEN_CONFLICT);
    expect(await row(ws.id)).toEqual(after);
    // com a revisão nova ⇒ ok
    await caller(userA).updateContract({ contractId: ws.id, expectedUpdatedAt: workspace.updatedAt, manager: "Eva" });
    expect((await row(ws.id))!.manager).toBe("Eva");
  }, 60_000);

  it("5) revisão divergente (arbitrária) ⇒ CONFLICT com token; linha intacta", async () => {
    const ws = await seedContract("CT-PR12-STALE");
    const before = await row(ws.id);
    const p = caller(userA).updateContract({ contractId: ws.id, expectedUpdatedAt: "2001-01-01T00:00:00.000Z", manager: "Z", value: 5 });
    await expect(p).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p).rejects.toThrow(TOKEN_CONFLICT);
    expect(await row(ws.id)).toEqual(before);
  }, 60_000);

  it("6) dois saves CONCORRENTES com a mesma revisão ⇒ exatamente um vence; o outro CONFLICT; um único evento", async () => {
    const ws = await seedContract("CT-PR12-RACE");
    const events = await changeEvents(ws.id);
    const results = await Promise.allSettled([
      caller(userA).updateContract({ contractId: ws.id, expectedUpdatedAt: ws.updatedAt, manager: "Vencedor-1", value: 111 }),
      caller(userA).updateContract({ contractId: ws.id, expectedUpdatedAt: ws.updatedAt, manager: "Vencedor-2", value: 222 }),
    ]);
    const ok = results.filter(r => r.status === "fulfilled");
    const ko = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0].reason).toMatchObject({ code: "CONFLICT" });
    expect(String(ko[0].reason.message)).toContain(TOKEN_CONFLICT);
    const winner = (ok[0] as PromiseFulfilledResult<{ workspace: { manager: string; value: number } }>).value.workspace;
    expect(await row(ws.id)).toMatchObject({ manager: winner.manager, value: `${winner.value}.00` }); // nenhuma mistura dos dois
    expect(await changeEvents(ws.id)).toBe(events + 1);
  }, 60_000);

  it("7) cross-tenant: usuário da org B ⇒ NOT_FOUND inalterado; linha da org A intacta", async () => {
    const ws = await seedContract("CT-PR12-XTENANT");
    const before = await row(ws.id);
    await expect(caller(userB).updateContract({ contractId: ws.id, expectedUpdatedAt: ws.updatedAt, manager: "Invasor", value: 1 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await row(ws.id)).toEqual(before);
  }, 60_000);
});

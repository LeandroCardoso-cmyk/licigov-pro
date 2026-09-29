/**
 * NEW-022 (P1 authority/lifecycle) — `contractWorkspace.updateContract` NÃO ativa contrato — MySQL REAL.
 * Só roda com DATABASE_URL definido.
 *
 * Defeito (main 5924b4a): o editor genérico permitia `minuta → vigente` (o ato que dá vigência institucional)
 * sem evidência de formalização, comando/evento dedicado, idempotência específica ou autoridade contextual.
 *
 * Contrato verificado (tenant resolvido pelo banco — memberships reais):
 *  - viewer / operator / manager / owner / admin de plataforma: `minuta → vigente` ⇒ FORBIDDEN com
 *    CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION, mensagem idêntica;
 *  - ZERO escrita: a linha do contrato (status, campos, updated_at) e a timeline ficam idênticas;
 *  - tentativa de transição + edição de campo no MESMO pedido é atômica (nada dos campos é gravado);
 *  - outras edições da minuta continuam funcionando; transições que não são ativação seguem a máquina;
 *  - status terminal não reabre (BAD_REQUEST, nada gravado);
 *  - cross-tenant ⇒ NOT_FOUND neutro (idêntico a id inexistente), nada gravado;
 *  - retry ⇒ mesma recusa; `status: "vigente"` num contrato já vigente não é ativação (no-op aceito).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import { createContractWorkspace, type ContractStatus } from "../../domain/contractWorkspace";
import { insertContractWorkspace } from "../../db/contractWorkspace";
import {
  CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION,
  CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION_MESSAGE,
} from "../../services/contractActivationGuard";

const DB = process.env.DATABASE_URL;
const ORG_A = 960221;
const ORG_B = 960222;

describe.skipIf(!DB)("NEW-022 — ativação genérica de contrato bloqueada (MySQL real)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  const ids: Record<string, number> = {};
  const contracts: Record<string, string> = {};

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A N022 ${stamp}`, `org-a-n022-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B N022 ${stamp}`, `org-b-n022-${stamp}`]);
    async function user(tag: string, role: "user" | "admin" = "user") {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, ?)`, [`n022-${tag}-${stamp}`, `N022 ${tag}`, `n022-${tag}-${stamp}@teste.local`, role]);
      ids[tag] = r.insertId;
    }
    for (const tag of ["viewer", "operator", "manager", "owner", "other-b"]) await user(tag);
    await user("platform-admin", "admin");
    for (const [tag, role] of [["viewer", "viewer"], ["operator", "operator"], ["manager", "manager"], ["owner", "owner"]] as const) {
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, ids[tag], role]);
    }
    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`, [ORG_B, ids["other-b"]]);

    async function contract(key: string, status: ContractStatus) {
      const ws = createContractWorkspace({
        organizationId: ORG_A, originType: "avulso", contractNumber: `N022-${key}-${stamp}`,
        contractor: "ACME LTDA", object: "Serviços de limpeza", value: 100000, term: "12 meses",
        manager: "Gestor Original", inspector: "Fiscal Original", status, correlationId: "n022-seed",
        createdAt: "2026-09-01T10:00:00.000Z",
      });
      await insertContractWorkspace(ws);
      contracts[key] = ws.id;
    }
    await contract("minuta", "minuta");
    await contract("minuta-edit", "minuta");
    await contract("vigente", "vigente");
    await contract("arquivado", "arquivado");
  });

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    const users = Object.values(ids);
    await del(`DELETE FROM process_timeline WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM contract_workspaces WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM audit_logs WHERE adminId = ?`, [ids["platform-admin"]]);
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM users WHERE id IN (${users.map(() => "?").join(",")})`, users);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function caller(tag: string, org: number, correlationId = `n022-${tag}`) {
    const { appRouter } = await import("../../routers");
    const role = tag === "platform-admin" ? "admin" : "user";
    return appRouter.createCaller({
      user: { id: ids[tag], role, name: `N022 ${tag}`, email: `n022-${tag}-${stamp}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId,
      requestId: `req-${correlationId}`,
      organizationId: null,
      orgMembership: null,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  async function row(id: string) {
    const [r] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT status, contractor, object, value, term, manager, inspector, contract_number, updated_at FROM contract_workspaces WHERE id = ?`, [id]);
    return JSON.stringify(r[0] ?? null);
  }
  async function timelineCount(id: string) {
    const [r] = await conn.execute<mysql.RowDataPacket[]>(`SELECT COUNT(*) n FROM process_timeline WHERE process_id = ?`, [id]);
    return Number((r[0] as { n: number }).n);
  }
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
    return { code: "RESOLVED", message: "" };
  };
  function captureWarn() {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
    return { lines, restore: () => spy.mockRestore() };
  }

  for (const tag of ["viewer", "operator", "manager", "owner", "platform-admin"]) {
    it(`${tag}: minuta → vigente pelo editor genérico ⇒ FORBIDDEN ${CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION}, zero escrita`, async () => {
      const id = contracts.minuta;
      const before = await row(id);
      const tl = await timelineCount(id);
      const c = await caller(tag, ORG_A);
      const err = await errOf(() => c.contractWorkspace.updateContract({ contractId: id, status: "vigente" }));
      expect(err).toEqual({ code: "FORBIDDEN", message: CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION_MESSAGE });
      expect(await row(id)).toBe(before);
      expect(JSON.parse(await row(id)).status).toBe("minuta");
      expect(await timelineCount(id)).toBe(tl);
    }, 30_000);
  }

  it("transição + edição de campo no MESMO pedido é atômica: nenhum campo é gravado", async () => {
    const id = contracts.minuta;
    const before = await row(id);
    const c = await caller("owner", ORG_A);
    const err = await errOf(() => c.contractWorkspace.updateContract({
      contractId: id, status: "vigente", contractor: "OUTRA LTDA", value: 1, manager: "Novo Gestor",
    }));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain(CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION);
    expect(await row(id)).toBe(before);
  }, 30_000);

  it("outras edições da minuta continuam funcionando (sem status)", async () => {
    const id = contracts["minuta-edit"];
    const c = await caller("owner", ORG_A);
    const res = await c.contractWorkspace.updateContract({ contractId: id, contractor: "NOVA RAZÃO LTDA" });
    expect(res.workspace.status).toBe("minuta");
    expect(JSON.parse(await row(id))).toMatchObject({ status: "minuta", contractor: "NOVA RAZÃO LTDA" });
  }, 30_000);

  it("transições que NÃO são ativação seguem a máquina: vigente → encerrado grava", async () => {
    const id = contracts.vigente;
    const c = await caller("owner", ORG_A);
    const res = await c.contractWorkspace.updateContract({ contractId: id, status: "encerrado" });
    expect(res.workspace.status).toBe("encerrado");
    expect(JSON.parse(await row(id)).status).toBe("encerrado");
  }, 30_000);

  it("status terminal não reabre: arquivado → vigente ⇒ BAD_REQUEST (máquina), nada gravado", async () => {
    const id = contracts.arquivado;
    const before = await row(id);
    const c = await caller("owner", ORG_A);
    const err = await errOf(() => c.contractWorkspace.updateContract({ contractId: id, status: "vigente" }));
    expect(err.code).toBe("BAD_REQUEST");
    expect(err.message).not.toContain(CONTRACT_ACTIVATION_REQUIRES_GOVERNED_ACTION);
    expect(await row(id)).toBe(before);
  }, 30_000);

  it("cross-tenant: owner da Org B tentando ativar contrato da Org A ⇒ NOT_FOUND neutro (= id inexistente), nada gravado", async () => {
    const id = contracts.minuta;
    const before = await row(id);
    const c = await caller("other-b", ORG_B);
    const cross = await errOf(() => c.contractWorkspace.updateContract({ contractId: id, status: "vigente" }));
    const missing = await errOf(() => c.contractWorkspace.updateContract({ contractId: "nao-existe-n022", status: "vigente" }));
    expect(cross.code).toBe("NOT_FOUND");
    expect(cross).toEqual(missing);
    expect(await row(id)).toBe(before);
  }, 30_000);

  it("retry: 5 tentativas seguidas ⇒ mesma recusa, contrato segue minuta; evento de recusa sem PII", async () => {
    const id = contracts.minuta;
    const before = await row(id);
    const c = await caller("manager", ORG_A, "n022-retry");
    const cap = captureWarn();
    const errs = [];
    try {
      for (let i = 0; i < 5; i++) errs.push(await errOf(() => c.contractWorkspace.updateContract({ contractId: id, status: "vigente" })));
    } finally { cap.restore(); }
    expect(new Set(errs.map((e) => JSON.stringify(e))).size).toBe(1);
    expect(await row(id)).toBe(before);
    const events = cap.lines.map((l) => { try { return JSON.parse(l) as Record<string, unknown>; } catch { return null; } })
      .filter((e) => e && e.operation === "contract_generic_activation_refused");
    expect(events).toHaveLength(5);
    expect(events[0]).toMatchObject({ service: "contractActivationGuard", actorUserId: ids.manager, organizationId: ORG_A, contractId: id, correlationId: "n022-retry" });
    expect(JSON.stringify(events)).not.toContain("teste.local");
  }, 30_000);

  it("`status: \"vigente\"` num contrato já vigente não é ativação (no-op aceito pela máquina)", async () => {
    const ws = createContractWorkspace({ organizationId: ORG_A, originType: "avulso", contractNumber: `N022-noop-${stamp}`, status: "vigente", correlationId: "n022-seed" });
    await insertContractWorkspace(ws);
    const c = await caller("owner", ORG_A);
    const res = await c.contractWorkspace.updateContract({ contractId: ws.id, status: "vigente", object: "Objeto ajustado" });
    expect(res.workspace.status).toBe("vigente");
  }, 30_000);
});

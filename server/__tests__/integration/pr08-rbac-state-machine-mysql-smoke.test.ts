/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR-08 — Paridade RBAC (SEM-026) e máquina de estados do contrato (SEM-025) contra MySQL REAL.
 * Só roda com DATABASE_URL (skip caso contrário). Faz parte de `pnpm test:smoke:security`.
 *
 * Prova, pelo appRouter REAL com memberships reais (x-organization-id), que:
 *  A. `itemIntelligence.decidirCATMAT`: viewer ⇒ FORBIDDEN e NADA gravado (ledger, item, timeline); operator
 *     decide e o efeito persiste; outro tenant ⇒ NOT_FOUND sem efeito.
 *  B. `itemIntelligence.approveItem`: TODOS os papéis ⇒ FORBIDDEN `LEGACY_ENDPOINT_DISABLED`, item intocado;
 *     a rota canônica `procurementProcess.approveItem` (operator) segue aprovando.
 *  C. Aditivo/apostilamento em contrato encerrado/rescindido/arquivado ⇒ BAD_REQUEST
 *     `CONTRACT_STATUS_TRANSITION_INVALID`; linha do contrato, aditivos, apostilamentos, minutas, documentos
 *     oficiais e timeline INALTERADOS. Transições válidas continuam funcionando; cross-tenant ⇒ NOT_FOUND.
 *  D. Corrida: contrato rescindido entre a avaliação e a escrita ⇒ o compare-and-set real não casa, a transação
 *     real faz ROLLBACK (nenhum aditivo gravado) e a recusa é a da máquina contra o status real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

// Wrapper transparente sobre o repositório REAL — só usado em D para simular a leitura "velha" (stale) do
// contrato que antecede uma rescisão concorrente. Por padrão delega à implementação real.
vi.mock("../../db/contractWorkspace", async (orig) => {
  const real = await orig<typeof import("../../db/contractWorkspace")>();
  return { ...real, getContractWorkspace: vi.fn(real.getContractWorkspace) };
});

import { runMigrations, validateSchema } from "../../bootstrap";
import { createIntelligentItem } from "../../domain/intelligentItem";
import { insertIntelligentItem, getIntelligentItem } from "../../db/procurement";
import { setCatmatThresholdConfig } from "../../db/catmatGovernance";
import { createManualContract, createAddendum } from "../../services/contractService";
import { getContractWorkspace, compareAndSetContractWorkspaceStatus } from "../../db/contractWorkspace";
import { ContractStatusTransitionError, CONTRACT_STATUS_TRANSITION_INVALID } from "../../domain/contractWorkspace";
import { LEGACY_ENDPOINT_DISABLED } from "../../services/legacyEndpointGuard";

const DB = process.env.DATABASE_URL;
const ORG_A = 990801;
const ORG_B = 990802;
const ROLES = ["viewer", "operator", "manager", "admin", "owner"] as const;
type Role = typeof ROLES[number];

describe.skipIf(!DB)("PR-08 — RBAC de Itens Inteligentes e máquina de estados do contrato (MySQL real)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  const users: Record<Role, number> = {} as any;
  let ownerB = 0;

  async function caller(userId: number, org: number, correlationId = `pr08-${userId}-${org}`) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
    try { await p; return null; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
  }
  const count = async (sql: string, p: unknown[]) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, p);
    return Number(rows[0].n);
  };
  async function cleanup() {
    for (const t of ["intelligent_items", "process_timeline", "contract_workspaces", "contract_addenda", "contract_ws_apostilles", "contract_ws_documents"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
    }
    await conn.query("DELETE FROM `catmat_decisions` WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.query("DELETE FROM `catmat_threshold_config` WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.query("DELETE FROM `official_documents` WHERE tenant_id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.query("DELETE FROM `organization_members` WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.query("DELETE FROM `organizations` WHERE id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await cleanup();
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A ${ORG_A}`, `org-${ORG_A}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B ${ORG_B}`, `org-${ORG_B}`]);
    async function insertUser(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`,
        [`pr08-${tag}-${stamp}`, `Usuário ${tag}`, `pr08-${tag}-${stamp}@teste.local`],
      );
      return r.insertId;
    }
    for (const r of ROLES) {
      users[r] = await insertUser(r);
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, users[r], r]);
    }
    ownerB = await insertUser("owner-b");
    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`, [ORG_B, ownerB]);
    // Limiar institucional configurado (decisão humana) — sem ele, decidirCATMAT é recusado por PRECONDITION.
    await setCatmatThresholdConfig({ organizationId: ORG_A, minScore: 0.5, reason: "Limiar do smoke PR-08", actorUserId: users.manager, correlationId: "pr08" });
  }, 300_000);

  afterAll(async () => {
    await cleanup().catch(() => {});
    const ids = [...Object.values(users), ownerB].filter(Boolean);
    if (ids.length) await conn.query(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids).catch(() => {});
    await conn?.end();
  });

  async function seedItem(processId: string) {
    const it = createIntelligentItem({
      organizationId: ORG_A, processId, sourceResearchId: `res-${processId}`.slice(0, 20),
      description: `Caneta esferográfica ${processId}`, quantity: 10, unit: "un", correlationId: `corr-${processId}`,
    });
    await insertIntelligentItem(it);
    return it;
  }
  const itemEffects = async (itemId: string, processId: string) => ({
    decisions: await count("SELECT COUNT(*) n FROM catmat_decisions WHERE organizationId = ? AND itemId = ?", [ORG_A, itemId]),
    timeline: await count("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND process_id = ?", [ORG_A, processId]),
    item: await getIntelligentItem(itemId, ORG_A),
  });

  // ─── A. decidirCATMAT ───────────────────────────────────────────────────────
  const decisionInput = (itemId: string, key: string) => ({
    itemId, decision: "substituido", idempotencyKey: key, catmatCode: "654321", justification: "Código correto conforme catálogo.",
  });

  it("A1) viewer é recusado (FORBIDDEN) e NADA é gravado", async () => {
    const it0 = await seedItem("pr08-a1");
    const before = await itemEffects(it0.id, "pr08-a1");
    const e = await err((await caller(users.viewer, ORG_A)).itemIntelligence.decidirCATMAT(decisionInput(it0.id, `pr08-a1-${stamp}`)));
    expect(e?.code).toBe("FORBIDDEN");
    const after = await itemEffects(it0.id, "pr08-a1");
    expect(after.decisions).toBe(0);
    expect(after.timeline).toBe(before.timeline);
    expect(after.item?.suggestedCATMAT ?? null).toBe(before.item?.suggestedCATMAT ?? null);
    expect(after.item?.updatedAt).toBe(before.item?.updatedAt);
  }, 60_000);

  it("A2) operator decide: ledger, código no item e evento persistidos", async () => {
    const it0 = await seedItem("pr08-a2");
    const before = await itemEffects(it0.id, "pr08-a2");
    const res = await (await caller(users.operator, ORG_A)).itemIntelligence.decidirCATMAT(decisionInput(it0.id, `pr08-a2-${stamp}`));
    expect(res.success).toBe(true);
    const after = await itemEffects(it0.id, "pr08-a2");
    expect(after.decisions).toBe(1);
    expect(after.item?.suggestedCATMAT).toBe("654321");
    expect(after.timeline).toBe(before.timeline + 1);
  }, 60_000);

  it("A3) cross-tenant inalterado: owner da Org B ⇒ NOT_FOUND sobre item da Org A, sem efeito", async () => {
    const it0 = await seedItem("pr08-a3");
    const before = await itemEffects(it0.id, "pr08-a3");
    const e = await err((await caller(ownerB, ORG_B)).itemIntelligence.decidirCATMAT(decisionInput(it0.id, `pr08-a3-${stamp}`)));
    expect(e?.code).toBe("NOT_FOUND");
    const after = await itemEffects(it0.id, "pr08-a3");
    expect(after.decisions).toBe(0);
    expect(after.timeline).toBe(before.timeline);
    expect(await count("SELECT COUNT(*) n FROM catmat_decisions WHERE organizationId = ?", [ORG_B])).toBe(0);
  }, 60_000);

  // ─── B. approveItem desligado ───────────────────────────────────────────────
  it("B1) approveItem: todos os papéis ⇒ FORBIDDEN LEGACY_ENDPOINT_DISABLED; item e timeline intocados", async () => {
    const it0 = await seedItem("pr08-b1");
    const before = await itemEffects(it0.id, "pr08-b1");
    for (const r of ROLES) {
      const e = await err((await caller(users[r], ORG_A)).itemIntelligence.approveItem({ itemId: it0.id }));
      expect(e?.code, r).toBe("FORBIDDEN");
      expect(e?.message, r).toContain(LEGACY_ENDPOINT_DISABLED);
    }
    const after = await itemEffects(it0.id, "pr08-b1");
    expect(after.item?.status).toBe("pendente");
    expect(after.item?.approvedBy ?? null).toBeNull();
    expect(after.timeline).toBe(before.timeline);
  }, 60_000);

  it("B2) a alternativa canônica segue funcionando: procurementProcess.approveItem (operator) aprova", async () => {
    const it0 = await seedItem("pr08-b2");
    expect((await err((await caller(users.viewer, ORG_A)).procurementProcess.approveItem({ itemId: it0.id })))?.code).toBe("FORBIDDEN");
    const res = await (await caller(users.operator, ORG_A)).procurementProcess.approveItem({ itemId: it0.id });
    expect(res.status).toBe("aprovado");
    expect((await getIntelligentItem(it0.id, ORG_A))?.status).toBe("aprovado");
  }, 60_000);

  // ─── C. Máquina de estados do contrato ──────────────────────────────────────
  async function seedContract(tag: string, status: string) {
    const ws = await createManualContract({
      organizationId: ORG_A, contractNumber: `CT-PR08-${tag}-${stamp}`, contractor: "Fornecedor PR-08", object: `Objeto ${tag}`,
      value: 100000, term: "12 meses", correlationId: "pr08", createdBy: users.owner,
    });
    await conn.execute("UPDATE contract_workspaces SET status = ? WHERE id = ? AND organization_id = ?", [status, ws.id, ORG_A]);
    return ws.id;
  }
  async function contractSnapshot(id: string) {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT status, value, contractor, updated_at FROM contract_workspaces WHERE id = ? AND organization_id = ?", [id, ORG_A]);
    return {
      row: JSON.stringify(rows[0]),
      addenda: await count("SELECT COUNT(*) n FROM contract_addenda WHERE contract_id = ?", [id]),
      apostilles: await count("SELECT COUNT(*) n FROM contract_ws_apostilles WHERE contract_id = ?", [id]),
      minutas: await count("SELECT COUNT(*) n FROM contract_ws_documents WHERE contract_id = ?", [id]),
      official: await count("SELECT COUNT(*) n FROM official_documents WHERE origin = ?", [id]),
      timeline: await count("SELECT COUNT(*) n FROM process_timeline WHERE process_id = ?", [id]),
    };
  }

  it.each(["encerrado", "rescindido", "arquivado"])("C1) contrato %s: aditivo e apostilamento recusados; contrato e tabelas inalterados", async (status) => {
    const id = await seedContract(`c1-${status}`, status);
    const before = await contractSnapshot(id);
    const api = await caller(users.owner, ORG_A);
    const a = await err(api.contractWorkspace.createAddendum({ contractId: id, addendumType: "valor", justification: "Reabrir?", newValue: 1 }));
    expect(a?.code).toBe("BAD_REQUEST");
    expect(a?.message).toContain(`Transição de contrato inválida: ${status} → aditado`);
    expect(a?.message).toContain(CONTRACT_STATUS_TRANSITION_INVALID);
    const p = await err(api.contractWorkspace.createApostille({ contractId: id, kind: "gestor", newManager: "Maria" }));
    expect(p?.code).toBe("BAD_REQUEST");
    expect(p?.message).toContain(`${status} → apostilado`);
    expect(await contractSnapshot(id)).toEqual(before);
    expect(JSON.parse(before.row).status).toBe(status); // nunca ressuscita
  }, 120_000);

  it("C2) transições válidas continuam: vigente → aditado → apostilado → aditado (2º aditivo mantém aditado)", async () => {
    const id = await seedContract("c2", "vigente");
    const api = await caller(users.owner, ORG_A);
    const r1 = await api.contractWorkspace.createAddendum({ contractId: id, addendumType: "prazo", justification: "Prorrogação.", newTerm: "18 meses" });
    expect(r1.addendum?.status).toBe("finalizado");
    expect((await getContractWorkspace(id, ORG_A))?.status).toBe("aditado");
    await api.contractWorkspace.createAddendum({ contractId: id, addendumType: "qualitativo", justification: "Ajuste." });
    expect((await getContractWorkspace(id, ORG_A))?.status).toBe("aditado");
    await api.contractWorkspace.createApostille({ contractId: id, kind: "gestor", newManager: "Maria" });
    expect((await getContractWorkspace(id, ORG_A))?.status).toBe("apostilado");
    const r4 = await api.contractWorkspace.createAddendum({ contractId: id, addendumType: "valor", justification: "Acréscimo.", newValue: 1000 });
    expect(r4.requiresLegalOpinion).toBe(true);
    expect((await getContractWorkspace(id, ORG_A))?.status).toBe("aditado");
    const snap = await contractSnapshot(id);
    expect(snap.addenda).toBe(3);
    expect(snap.apostilles).toBe(1);
    expect(snap.minutas).toBe(4); // minuta gerada para cada instrumento persistido
    const [rows] = await conn.execute<mysql.RowDataPacket[]>("SELECT sequence, status FROM contract_addenda WHERE contract_id = ? ORDER BY sequence", [id]);
    expect(rows.map((r) => r.status)).toEqual(["finalizado", "finalizado", "aguardando_parecer"]);
  }, 180_000);

  it("C3) minuta: comportamento de hoje mantido (minuta → aditado) até decisão humana", async () => {
    const id = await seedContract("c3", "minuta");
    await (await caller(users.owner, ORG_A)).contractWorkspace.createAddendum({ contractId: id, addendumType: "prazo", justification: "Prorrogação.", newTerm: "18 meses" });
    expect((await getContractWorkspace(id, ORG_A))?.status).toBe("aditado");
  }, 120_000);

  it("C4) cross-tenant inalterado: owner da Org B ⇒ NOT_FOUND sobre contrato da Org A, sem efeito", async () => {
    const id = await seedContract("c4", "vigente");
    const before = await contractSnapshot(id);
    const apiB = await caller(ownerB, ORG_B);
    expect((await err(apiB.contractWorkspace.createAddendum({ contractId: id, addendumType: "prazo", justification: "x" })))?.code).toBe("NOT_FOUND");
    expect((await err(apiB.contractWorkspace.createApostille({ contractId: id, kind: "gestor", newManager: "x" })))?.code).toBe("NOT_FOUND");
    expect(await contractSnapshot(id)).toEqual(before);
  }, 60_000);

  // ─── D. Corrida: compare-and-set + rollback reais ───────────────────────────
  it("D1) CAS real: só grava a partir do status esperado", async () => {
    const id = await seedContract("d1", "rescindido");
    const before = await contractSnapshot(id);
    expect(await compareAndSetContractWorkspaceStatus({ id, orgId: ORG_A, fromStatus: "vigente", toStatus: "aditado", updatedAt: new Date().toISOString() })).toBe(false);
    expect(await compareAndSetContractWorkspaceStatus({ id, orgId: ORG_B, fromStatus: "rescindido", toStatus: "aditado", updatedAt: new Date().toISOString() })).toBe(false); // tenant
    expect(await contractSnapshot(id)).toEqual(before);
  }, 60_000);

  it("D2) rescisão concorrente: leitura velha 'vigente', banco 'rescindido' ⇒ ROLLBACK real, nenhum aditivo, recusa da máquina", async () => {
    const id = await seedContract("d2", "rescindido");
    const before = await contractSnapshot(id);
    const stale = { ...(await getContractWorkspace(id, ORG_A))!, status: "vigente" as const };
    vi.mocked(getContractWorkspace).mockResolvedValueOnce(stale); // 1ª leitura do serviço (anterior à rescisão)
    const e = await createAddendum({ organizationId: ORG_A, contractId: id, addendumType: "prazo", justification: "Prorrogação.", correlationId: "pr08-d2" })
      .then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(ContractStatusTransitionError);
    expect((e as Error).message).toContain("rescindido → aditado");
    expect(await contractSnapshot(id)).toEqual(before); // aditivo inserido no tx foi desfeito; sem minuta/evento
  }, 60_000);
});

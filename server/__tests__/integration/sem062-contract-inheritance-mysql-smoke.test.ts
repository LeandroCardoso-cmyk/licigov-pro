/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SW-C1 / SEM-062 — herança do contrato (contratado/valor) a partir da origem, contra MySQL REAL, pelo router real.
 * Só roda com DATABASE_URL.
 *
 *  - Licitação: NÃO há registro canônico de adjudicação ⇒ `no_canonical_evidence` (nada pré-preenchido).
 *  - Contratação direta: só com decisão VIGENTE `ratificado` no ledger + propostas registradas; o servidor NÃO escolhe a
 *    proposta (devolve candidatas com procedência); o humano seleciona (`sourceProposalId`) e o servidor re-deriva
 *    contratado/valor do REGISTRO, grava a procedência na timeline; divergência humana fica registrada.
 *  - Recusas (proposta alheia/outro tenant ⇒ NOT_FOUND; decisão superada para "não ratificado" ⇒ PRECONDITION_FAILED):
 *    ZERO escrita. Sem seleção, o contrato nasce em branco (nenhum default silencioso). Retry converge.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 995311;
const ORG_B = 995312;
const RUN = Date.now().toString(36);

describe.skipIf(!DB)("SW-C1 / SEM-062 — herança do contrato com procedência e confirmação humana (MySQL real)", () => {
  let conn: mysql.Connection;
  const U = { manager: 0, operator: 0, viewer: 0, ownerB: 0 };
  let seq = 0;
  let keyN = 0;

  async function caller(userId: number, org: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `swc1i-${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {}, correlationId: `corr-swc1i-${userId}-${++seq}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
    try { await p; return null; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
  }
  const rows = async <T = mysql.RowDataPacket>(sql: string, p: unknown[] = []): Promise<T[]> => ((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0]) as unknown as T[];
  const n = async (sql: string, p: unknown[] = []) => Number((await rows<{ n: number }>(sql, p))[0].n);
  const contractsCount = () => n("SELECT COUNT(*) n FROM contract_workspaces WHERE organization_id IN (?, ?)", [ORG_A, ORG_B]);
  const eventsCount = () => n("SELECT COUNT(*) n FROM process_timeline WHERE organization_id IN (?, ?)", [ORG_A, ORG_B]);

  async function seedDirect(tag: string, org = ORG_A): Promise<string> {
    const { createDirectProcurementWorkspace } = await import("../../domain/directProcurementWorkspace");
    const { insertDirectProcurementWorkspace } = await import("../../db/directProcurement");
    const ws = createDirectProcurementWorkspace({
      organizationId: org, processNumber: `SWC1-${tag}-${RUN}`, object: `Objeto da dispensa ${tag}`, procurementType: "dispensa",
      startOption: "sem_dfd", responsibleUser: U.manager, correlationId: "swc1i-seed",
    });
    await insertDirectProcurementWorkspace(ws);
    return ws.id;
  }
  async function seedProposal(ws: string, name: string, value: number, idx: number, org = ORG_A): Promise<string> {
    const { createProposalCollection } = await import("../../domain/directProcurementProcedure");
    const { insertProposalCollection } = await import("../../db/directProcurement");
    const p = createProposalCollection({ organizationId: org, workspaceId: ws, supplierName: name, supplierDocument: "12.345.678/0001-90", proposalValue: value, protocol: `PROT-${idx}`, index: idx, correlationId: "swc1i-seed" });
    await insertProposalCollection(p);
    return p.id;
  }
  async function ratify(ws: string, decision: "ratificado" | "nao_ratificado", expectedRevision: number) {
    return (await caller(U.manager, ORG_A)).directProcurement.ratify({
      workspaceId: ws, decision, decidedByName: "Maria Autoridade", decidedByRole: "Prefeita Municipal", decidedAt: "2026-09-30",
      basisReference: "Despacho nº 10/2026", justification: "Decisão registrada para o smoke SW-C1.", evidence: [], expectedRevision,
      idempotencyKey: `swc1i-${RUN}-${keyN++}-xx`,
    });
  }

  async function cleanup() {
    for (const t of ["institutional_decisions", "process_timeline", "contract_workspaces", "proposal_collections", "direct_procurement_workspaces", "procurement_processes"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
    }
    await conn.query("DELETE FROM organization_members WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await cleanup();
    for (const org of [ORG_A, ORG_B]) {
      await conn.query("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1", [org, `Org SWC1i ${org}`, `swc1i-${org}`]);
    }
    for (const k of Object.keys(U) as Array<keyof typeof U>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`swc1i-${k}-${RUN}`, `SWC1i ${k}`, `swc1i-${k}-${RUN}@teste.local`]);
      U[k] = r.insertId;
    }
    for (const [org, u, role] of [[ORG_A, U.manager, "manager"], [ORG_A, U.operator, "operator"], [ORG_A, U.viewer, "viewer"], [ORG_B, U.ownerB, "owner"]] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
  }, 120_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE openId LIKE ?", [`swc1i-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("P1 licitação: sem registro canônico de adjudicação ⇒ no_canonical_evidence; inexistente/outro tenant ⇒ NOT_FOUND idêntico", async () => {
    await conn.execute("INSERT INTO procurement_processes (id, organization_id, process_number, object) VALUES (?, ?, ?, ?)", [`pp-swc1-${RUN}`.slice(0, 20), ORG_A, `PL-${RUN}`, "Objeto licitação"]);
    const pid = `pp-swc1-${RUN}`.slice(0, 20);
    const r = await (await caller(U.viewer, ORG_A)).contractWorkspace.proposeInheritance({ sourceType: "processo_licitatorio", sourceId: pid });
    expect(r).toMatchObject({ kind: "no_canonical_evidence", reason: "PROCUREMENT_NO_AWARD_RECORD", candidates: [] });
    const missing = await err((await caller(U.viewer, ORG_A)).contractWorkspace.proposeInheritance({ sourceType: "processo_licitatorio", sourceId: "nao-existe" }));
    const foreign = await err((await caller(U.ownerB, ORG_B)).contractWorkspace.proposeInheritance({ sourceType: "processo_licitatorio", sourceId: pid }));
    expect(missing).toEqual(foreign);
    expect(missing?.code).toBe("NOT_FOUND");
    // Criar contrato do processo continua NÃO herdando nada.
    const created = await (await caller(U.operator, ORG_A)).contractWorkspace.createFromProcurement({ processId: pid, contractNumber: `CT-P1-${RUN}` });
    expect([created.workspace.contractor, created.workspace.value]).toEqual(["", 0]);
  }, 120_000);

  it("P2 direta: sem decisão / não ratificada / sem propostas ⇒ no_canonical_evidence com motivo estável", async () => {
    const ws = await seedDirect("p2");
    const api = await caller(U.viewer, ORG_A);
    expect(await api.contractWorkspace.proposeInheritance({ sourceType: "contratacao_direta", sourceId: ws })).toMatchObject({ kind: "no_canonical_evidence", reason: "DIRECT_NOT_RATIFIED" });
    await seedProposal(ws, "Fornecedor Alfa", 1500.5, 0);
    await ratify(ws, "nao_ratificado", 0);
    expect(await api.contractWorkspace.proposeInheritance({ sourceType: "contratacao_direta", sourceId: ws })).toMatchObject({ kind: "no_canonical_evidence", reason: "DIRECT_NOT_RATIFIED" });
    const ws2 = await seedDirect("p2b");
    await ratify(ws2, "ratificado", 0);
    expect(await api.contractWorkspace.proposeInheritance({ sourceType: "contratacao_direta", sourceId: ws2 })).toMatchObject({ kind: "no_canonical_evidence", reason: "DIRECT_NO_PROPOSALS" });
  }, 120_000);

  it("P3 direta ratificada com 2 propostas: devolve CANDIDATAS com procedência (o servidor não escolhe); outro tenant ⇒ NOT_FOUND", async () => {
    const ws = await seedDirect("p3");
    const a = await seedProposal(ws, "Fornecedor Alfa", 1500.5, 0);
    const b = await seedProposal(ws, "Fornecedor Beta", 1400, 1);
    await ratify(ws, "ratificado", 0);
    const r = await (await caller(U.viewer, ORG_A)).contractWorkspace.proposeInheritance({ sourceType: "contratacao_direta", sourceId: ws });
    expect(r.kind).toBe("proposal");
    if (r.kind !== "proposal") throw new Error("esperado proposal");
    expect(r.candidates.map((c) => c.proposalId).sort()).toEqual([a, b].sort());
    expect(r.candidates.find((c) => c.proposalId === a)).toMatchObject({ supplierName: "Fornecedor Alfa", value: 1500.5, protocol: "PROT-0" });
    expect(r.decision).toMatchObject({ revision: 1, outcome: "ratificado", decidedByRole: "Prefeita Municipal" });
    expect(r.notice).toContain("não escolhe");
    expect((await err((await caller(U.ownerB, ORG_B)).contractWorkspace.proposeInheritance({ sourceType: "contratacao_direta", sourceId: ws })))?.code).toBe("NOT_FOUND");
  }, 120_000);

  it("P4 confirmação humana: sourceProposalId ⇒ contratado/valor do REGISTRO + procedência na timeline; sem seleção ⇒ em branco (sem default silencioso); retry converge", async () => {
    const ws = await seedDirect("p4");
    const a = await seedProposal(ws, "Fornecedor Alfa", 1500.5, 0);
    await seedProposal(ws, "Fornecedor Beta", 1400, 1);
    await ratify(ws, "ratificado", 0);
    const api = await caller(U.operator, ORG_A);
    const blank = await api.contractWorkspace.createFromDirectProcurement({ directWorkspaceId: ws, contractNumber: `CT-P4-BLANK-${RUN}` });
    expect([blank.workspace.contractor, blank.workspace.value]).toEqual(["", 0]);
    const ok = await api.contractWorkspace.createFromDirectProcurement({ directWorkspaceId: ws, contractNumber: `CT-P4-${RUN}`, sourceProposalId: a });
    expect(ok.workspace).toMatchObject({ contractor: "Fornecedor Alfa", value: 1500.5, status: "minuta", originType: "contratacao_direta" });
    const [decision] = await rows<{ id: string }>("SELECT id FROM institutional_decisions WHERE organization_id = ? AND subject_id = ?", [ORG_A, ws]);
    const [ev] = await rows<{ summary: string }>("SELECT summary FROM process_timeline WHERE process_id = ? AND event_type = 'workspace_created'", [ok.workspace.id]);
    expect(ev.summary).toContain(`proposta ${a}`);
    expect(ev.summary).toContain(decision.id);
    expect(ev.summary).toContain(`confirmados por user:${U.operator}`);
    expect(ev.summary).not.toContain("com alteração");
    // Retry da MESMA criação converge (mesmo contrato, nenhum evento novo).
    const events = await eventsCount();
    const again = await api.contractWorkspace.createFromDirectProcurement({ directWorkspaceId: ws, contractNumber: `CT-P4-${RUN}`, sourceProposalId: a });
    expect(again.workspace.id).toBe(ok.workspace.id);
    expect(await eventsCount()).toBe(events);
  }, 120_000);

  it("P5 correção humana prevalece e fica REGISTRADA como divergência", async () => {
    const ws = await seedDirect("p5");
    const a = await seedProposal(ws, "Fornecedor Alfa", 1500.5, 0);
    await ratify(ws, "ratificado", 0);
    const r = await (await caller(U.operator, ORG_A)).contractWorkspace.createFromDirectProcurement({
      directWorkspaceId: ws, contractNumber: `CT-P5-${RUN}`, sourceProposalId: a, contractor: "Fornecedor Alfa LTDA", value: 1400,
    });
    expect(r.workspace).toMatchObject({ contractor: "Fornecedor Alfa LTDA", value: 1400 });
    const [ev] = await rows<{ summary: string }>("SELECT summary FROM process_timeline WHERE process_id = ? AND event_type = 'workspace_created'", [r.workspace.id]);
    expect(ev.summary).toContain("com alteração dos valores sugeridos");
  }, 120_000);

  it("P6 recusas ⇒ ZERO escrita: proposta de outro workspace, inexistente, de outro tenant; decisão superada para 'não ratificado'; sem ratificação", async () => {
    const ws = await seedDirect("p6");
    const other = await seedDirect("p6o");
    const mine = await seedProposal(ws, "Fornecedor Alfa", 100, 0);
    const alien = await seedProposal(other, "Fornecedor Alheio", 999, 0);
    const foreignWs = await seedDirect("p6f", ORG_B);
    const foreignProp = await seedProposal(foreignWs, "Fornecedor B", 5, 0, ORG_B);
    await ratify(ws, "ratificado", 0);
    await ratify(other, "ratificado", 0);
    const api = await caller(U.operator, ORG_A);
    const c0 = await contractsCount(); const e0 = await eventsCount();
    for (const proposalId of [alien, "nao-existe", foreignProp]) {
      const e = await err(api.contractWorkspace.createFromDirectProcurement({ directWorkspaceId: ws, contractNumber: `CT-P6-${RUN}-x`, sourceProposalId: proposalId }));
      expect(e?.code, proposalId).toBe("NOT_FOUND");
      expect(e?.message).toContain("CONTRACT_INHERITANCE_PROPOSAL_NOT_FOUND");
    }
    // Superada para "não ratificado" ⇒ nenhuma herança.
    await ratify(ws, "nao_ratificado", 1);
    const sup = await err(api.contractWorkspace.createFromDirectProcurement({ directWorkspaceId: ws, contractNumber: `CT-P6-${RUN}-y`, sourceProposalId: mine }));
    expect(sup?.code).toBe("PRECONDITION_FAILED");
    expect(sup?.message).toContain("CONTRACT_INHERITANCE_NOT_RATIFIED");
    // Sem ratificação alguma.
    const bare = await seedDirect("p6b");
    const bp = await seedProposal(bare, "Fornecedor C", 7, 0);
    expect((await err(api.contractWorkspace.createFromDirectProcurement({ directWorkspaceId: bare, contractNumber: `CT-P6-${RUN}-z`, sourceProposalId: bp })))?.code).toBe("PRECONDITION_FAILED");
    expect(await contractsCount()).toBe(c0);
    // (os eventos de ratificação das chamadas acima são do ledger; contrato/timeline de contrato não mudaram)
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE event_type = 'workspace_created' AND organization_id = ? AND summary LIKE ?", [ORG_A, "%CT-P6-%"])).toBe(0);
    expect(await eventsCount()).toBeGreaterThanOrEqual(e0);
  }, 180_000);
});

/**
 * NEW-005 — RBAC institucional da Contratação Direta contra MySQL REAL (appRouter.createCaller, tenant resolvido
 * por organization_members, papel checado pelo `orgRoleProcedure` real). Só roda com DATABASE_URL.
 *
 * Contrato verificado (matriz: server/routers/directProcurementRbacMatrix.ts):
 *  - viewer NÃO cria/escreve (createProcess, selectLegalBasis, registerProposal, validateDocuments,
 *    generateJustification, requestLegalOpinion…) e NÃO alcança configureFlags/ratify/publish;
 *  - operator redige (createProcess, selectLegalBasis, registerProposal, validateDocuments) mas é barrado em
 *    configureFlags, ratify e publish;
 *  - manager (piso técnico) alcança configureFlags, ratify e publish; owner/admin do órgão e admin de plataforma
 *    (X-Organization-Id, auditado) também — coerente com o ranking do orgRoleProcedure;
 *  - outro órgão: NOT_FOUND neutro, idêntico ao de um id inexistente (sem vazar existência); viewer de outro órgão
 *    recebe o MESMO FORBIDDEN para id existente e inexistente;
 *  - em TODA recusa: zero linhas escritas (todas as tabelas do domínio + official_documents), zero eventos de
 *    timeline, zero notificações (request_notifications/notifications), zero chamadas de IA
 *    (AIExecutionEngine.executeCognitiveTask / orquestrador multi-copiloto).
 *
 * `manager` é apenas o PISO técnico de RBAC; este teste NÃO afirma que manager seja a autoridade legalmente
 * competente para ratificar (autoridade competente / decidedBy × recordedBy / SoD = PR-07).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

vi.mock("../../services/aiExecutionEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/aiExecutionEngine")>();
  return { ...actual, executeCognitiveTask: vi.fn(actual.executeCognitiveTask) };
});
vi.mock("../../services/workspaceOrchestratorService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/workspaceOrchestratorService")>();
  return { ...actual, orchestrateMultiCopilot: vi.fn(actual.orchestrateMultiCopilot) };
});

import * as aiEngine from "../../services/aiExecutionEngine";
import * as orchestrator from "../../services/workspaceOrchestratorService";

const DB = process.env.DATABASE_URL;
const ORG_A = 960501;
const ORG_B = 960502;
const ROLE_DENIED = (min: string) => `Esta ação requer papel mínimo '${min}' na organização.`;
const NOT_FOUND_MSG = "Processo de contratação direta não encontrado nesta organização.";

/** Tabelas do domínio escopadas por organization_id (todo efeito do router cai numa delas). */
const ORG_TABLES = [
  "direct_procurement_workspaces", "direct_procurement_procedures", "proposal_collections", "proposal_documents",
  "contract_justifications", "price_justifications", "required_documents", "ratifications", "generated_publications",
  "price_research", "price_research_items", "process_timeline", "institutional_requests", "request_assignments",
  "request_timelines", "request_notifications", "ai_execution_audits", "institutional_decisions",
] as const;

describe.skipIf(!DB)("NEW-005 — RBAC da Contratação Direta (MySQL real)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  let owner: number, orgAdmin: number, manager: number, operator: number, viewer: number;
  let foreignOwner: number, foreignViewer: number, platformAdmin: number;
  let wsId: string;
  let allUsers: number[] = [];

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A NEW005 ${stamp}`, `org-a-new005-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B NEW005 ${stamp}`, `org-b-new005-${stamp}`]);
    async function user(tag: string, role: "user" | "admin" = "user"): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, ?)`,
        [`new005-${tag}-${stamp}`, `NEW005 ${tag}`, `new005-${tag}-${stamp}@teste.local`, role]);
      return r.insertId;
    }
    async function member(org: number, userId: number, role: string) {
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, userId, role]);
    }
    owner = await user("owner"); orgAdmin = await user("orgadmin"); manager = await user("manager");
    operator = await user("operator"); viewer = await user("viewer");
    foreignOwner = await user("foreign-owner"); foreignViewer = await user("foreign-viewer");
    platformAdmin = await user("platform-admin", "admin");
    allUsers = [owner, orgAdmin, manager, operator, viewer, foreignOwner, foreignViewer, platformAdmin];
    await member(ORG_A, owner, "owner"); await member(ORG_A, orgAdmin, "admin"); await member(ORG_A, manager, "manager");
    await member(ORG_A, operator, "operator"); await member(ORG_A, viewer, "viewer");
    await member(ORG_B, foreignOwner, "owner"); await member(ORG_B, foreignViewer, "viewer");

    // Workspace semeado pela camada de dados real (o caminho do router é o que está sob teste).
    const { createDirectProcurementWorkspace } = await import("../../domain/directProcurementWorkspace");
    const { insertDirectProcurementWorkspace } = await import("../../db/directProcurement");
    const ws = createDirectProcurementWorkspace({
      organizationId: ORG_A, processNumber: `NEW005-SEED/${stamp}`, object: "Objeto NEW005", procurementType: "dispensa",
      startOption: "sem_dfd", responsibleUser: owner, correlationId: "new005-seed",
    });
    await insertDirectProcurementWorkspace(ws);
    wsId = ws.id;
  }, 60_000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, params: unknown[]) => { await conn.execute(sql, params).catch(() => {}); };
    for (const t of ORG_TABLES) await del(`DELETE FROM ${t} WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM official_documents WHERE tenant_id IN (?, ?)`, [ORG_A, ORG_B]);
    const inUsers = allUsers.map(() => "?").join(",");
    if (allUsers.length) {
      await del(`DELETE FROM notifications WHERE userId IN (${inUsers})`, allUsers);
      await del(`DELETE FROM audit_logs WHERE adminId IN (${inUsers})`, allUsers);
    }
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    if (allUsers.length) await del(`DELETE FROM users WHERE id IN (${inUsers})`, allUsers);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function caller(userId: number, org: number, opts: { platformAdmin?: boolean; correlationId?: string } = {}) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: opts.platformAdmin ? "admin" : "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId: opts.correlationId ?? `new005-${userId}-${stamp}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  type Caller = Awaited<ReturnType<typeof caller>>;

  const one = async (sql: string, params: unknown[]) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params);
    return rows[0];
  };
  async function snapshot() {
    const counts: Record<string, number> = {};
    for (const t of ORG_TABLES) counts[t] = Number((await one(`SELECT COUNT(*) n FROM ${t} WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B])).n);
    counts.official_documents = Number((await one(`SELECT COUNT(*) n FROM official_documents WHERE tenant_id IN (?, ?)`, [ORG_A, ORG_B])).n);
    const inUsers = allUsers.map(() => "?").join(",");
    counts.notifications = Number((await one(`SELECT COUNT(*) n FROM notifications WHERE userId IN (${inUsers})`, allUsers)).n);
    const ws = await one(
      `SELECT current_stage, status, flags, legal_basis, procedure_type, updated_at FROM direct_procurement_workspaces WHERE id = ?`, [wsId]);
    return { counts, ws: JSON.stringify(ws) };
  }
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
    return { code: "RESOLVED", message: "" };
  };
  const aiCalls = () => vi.mocked(aiEngine.executeCognitiveTask).mock.calls.length + vi.mocked(orchestrator.orchestrateMultiCopilot).mock.calls.length;

  /** Espera recusa com `expected` e prova ausência TOTAL de efeito (linhas, timeline, notificações, IA). */
  async function expectDeniedWithoutEffect(label: string, fn: () => Promise<unknown>, expected: { code: string; message: string }) {
    const before = await snapshot();
    const ai = aiCalls();
    const e = await errOf(fn);
    expect(e, label).toEqual(expected);
    expect(await snapshot(), label).toEqual(before);
    expect(aiCalls(), `${label} — IA`).toBe(ai);
  }

  const WRITES: Array<{ name: string; call: (c: Caller) => Promise<unknown> }> = [
    { name: "createProcess", call: (c) => c.directProcurement.createProcess({ processNumber: `NEW005-V/${stamp}`, object: "x", procurementType: "dispensa", startOption: "sem_dfd" }) },
    { name: "importDFD", call: (c) => c.directProcurement.importDFD({ workspaceId: wsId, source: "pdf" }) },
    { name: "selectLegalBasis", call: (c) => c.directProcurement.selectLegalBasis({ workspaceId: wsId, legalBasis: "art. 75, II" }) },
    { name: "characterizeNeed", call: (c) => c.directProcurement.characterizeNeed({ workspaceId: wsId, description: "x" }) },
    { name: "importPriceResearch", call: (c) => c.directProcurement.importPriceResearch({ workspaceId: wsId, source: "colar", text: "Caneta;1;un;1,50", idempotencyKey: `new005-viewer-${stamp}` } as never) },
    { name: "configureProcedure", call: (c) => c.directProcurement.configureProcedure({ workspaceId: wsId, procedureType: "eletronico", platform: "compras_gov" }) },
    { name: "registerProposal", call: (c) => c.directProcurement.registerProposal({ workspaceId: wsId, supplierName: "Fornecedor V" }) },
    { name: "generateJustification", call: (c) => c.directProcurement.generateJustification({ workspaceId: wsId }) },
    { name: "generatePriceJustification", call: (c) => c.directProcurement.generatePriceJustification({ workspaceId: wsId, source: "manual", justification: "Justificativa de preço viewer.", referenceValue: 10, confirmOfficial: true }) },
    { name: "acceptJustification", call: (c) => c.directProcurement.acceptJustification({ workspaceId: wsId, need: "Necessidade viewer teste", publicInterest: "", motivation: "Motivação viewer teste", legalFoundation: "Art. 75, II (teste)", benefits: "", alternatives: "", basedOnSuggestion: false, confirmAccept: true }) },
    { name: "validateDocuments", call: (c) => c.directProcurement.validateDocuments({ workspaceId: wsId }) },
    { name: "requestLegalOpinion", call: (c) => c.directProcurement.requestLegalOpinion({ workspaceId: wsId }) },
  ];
  // R4 / PR-07: o ratify exige o ato completo (autoridade declarada, data, referência, CAS e chave por tentativa).
  let ratKey = 0;
  const ratifyInput = (workspaceId: string) => ({
    workspaceId, decision: "ratificado" as const, decidedByName: "Autoridade NEW005", decidedByRole: "Secretário(a)",
    decidedAt: "2026-09-30", basisReference: "Despacho NEW005/2026", justification: "Registro NEW005 (teste de RBAC).",
    expectedRevision: 0, idempotencyKey: `new005-rat-${stamp}-${ratKey++}`,
  });
  const ratifyCall = (c: Caller) => c.directProcurement.ratify(ratifyInput(wsId));
  const publishCall = (c: Caller) => c.directProcurement.publish({ workspaceId: wsId });
  const flagsCall = (c: Caller) => c.directProcurement.configureFlags({ workspaceId: wsId, requiresLegalOpinion: false });

  it("viewer: lê, mas é barrado em TODA escrita/decisão/publicação/configuração — sem efeito algum", async () => {
    const v = await caller(viewer, ORG_A);
    const loaded = await v.directProcurement.loadProcess({ workspaceId: wsId });
    expect(loaded.workspace?.id).toBe(wsId);
    const listed = await v.directProcurement.listProcesses({});
    expect(listed.workspaces.map(w => w.id)).toContain(wsId);

    for (const w of WRITES) await expectDeniedWithoutEffect(`viewer ${w.name}`, () => w.call(v), { code: "FORBIDDEN", message: ROLE_DENIED("operator") });
    await expectDeniedWithoutEffect("viewer configureFlags", () => flagsCall(v), { code: "FORBIDDEN", message: ROLE_DENIED("manager") });
    await expectDeniedWithoutEffect("viewer ratify", () => ratifyCall(v), { code: "FORBIDDEN", message: ROLE_DENIED("manager") });
    await expectDeniedWithoutEffect("viewer publish", () => publishCall(v), { code: "FORBIDDEN", message: ROLE_DENIED("manager") });
  }, 120_000);

  it("operator: redige (cria processo, fundamento, proposta, checklist) mas é barrado em configureFlags/ratify", async () => {
    const op = await caller(operator, ORG_A);
    const tl0 = Number((await one(`SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ?`, [ORG_A])).n);

    const created = await op.directProcurement.createProcess({ processNumber: `NEW005-OP/${stamp}`, object: "Objeto do operador", procurementType: "dispensa", startOption: "sem_dfd" });
    expect((await one(`SELECT organization_id FROM direct_procurement_workspaces WHERE id = ?`, [created.workspace.id])).organization_id).toBe(ORG_A);
    await op.directProcurement.selectLegalBasis({ workspaceId: wsId, legalBasis: "Lei 14.133/2021, art. 75, II" });
    expect((await one(`SELECT legal_basis FROM direct_procurement_workspaces WHERE id = ?`, [wsId])).legal_basis).toBe("Lei 14.133/2021, art. 75, II");
    await op.directProcurement.registerProposal({ workspaceId: wsId, supplierName: "Fornecedor Operador" });
    const docs = await op.directProcurement.validateDocuments({ workspaceId: wsId });
    expect(docs.documents.length).toBeGreaterThan(0);
    expect(Number((await one(`SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ?`, [ORG_A])).n)).toBeGreaterThan(tl0);

    await expectDeniedWithoutEffect("operator configureFlags", () => flagsCall(op), { code: "FORBIDDEN", message: ROLE_DENIED("manager") });
    await expectDeniedWithoutEffect("operator ratify", () => ratifyCall(op), { code: "FORBIDDEN", message: ROLE_DENIED("manager") });
  }, 120_000);

  it("manager (piso técnico) alcança configureFlags e ratify", async () => {
    const m = await caller(manager, ORG_A);
    const res = await flagsCall(m);
    expect(res.workspace.flags.requiresLegalOpinion).toBe(false);
    expect(JSON.parse(String((await one(`SELECT flags FROM direct_procurement_workspaces WHERE id = ?`, [wsId])).flags)).requiresLegalOpinion).toBe(false);

    const r = await ratifyCall(m);
    expect(r.decision.outcome).toBe("ratificado");
    // PR-07: quem REGISTROU (manager) ≠ autoridade declarada; competência não validada pelo sistema.
    const row = await one(`SELECT recorded_by_user_id, decided_by_name, outcome, revision, authority_validation FROM institutional_decisions WHERE subject_id = ? AND organization_id = ?`, [wsId, ORG_A]);
    expect(row).toMatchObject({ recorded_by_user_id: manager, decided_by_name: "Autoridade NEW005", outcome: "ratificado", revision: 1, authority_validation: "NOT_VALIDATED_POLICY_PENDING" });
    expect((await one(`SELECT current_stage FROM direct_procurement_workspaces WHERE id = ?`, [wsId])).current_stage).toBe("RATIFICATION");
  }, 120_000);

  it("com ratificação 'ratificado' registrada, viewer/operator seguem barrados em publish; manager publica", async () => {
    // A recusa é de RBAC — a pré-condição do service (ratificação) já está satisfeita.
    await expectDeniedWithoutEffect("viewer publish (ratificado)", async () => publishCall(await caller(viewer, ORG_A)), { code: "FORBIDDEN", message: ROLE_DENIED("manager") });
    await expectDeniedWithoutEffect("operator publish (ratificado)", async () => publishCall(await caller(operator, ORG_A)), { code: "FORBIDDEN", message: ROLE_DENIED("manager") });

    const out = await publishCall(await caller(manager, ORG_A));
    expect(out.publications.map(p => p.kind)).toEqual(expect.arrayContaining(["aviso", "ratificacao", "extrato_contrato"]));
    expect(Number((await one(`SELECT COUNT(*) n FROM generated_publications WHERE workspace_id = ? AND organization_id = ?`, [wsId, ORG_A])).n)).toBeGreaterThanOrEqual(3);
    expect((await one(`SELECT current_stage FROM direct_procurement_workspaces WHERE id = ?`, [wsId])).current_stage).toBe("PUBLICATION");
  }, 120_000);

  it("outro órgão: NOT_FOUND neutro idêntico ao de id inexistente; viewer externo recebe o mesmo FORBIDDEN — sem efeito", async () => {
    const fo = await caller(foreignOwner, ORG_B);
    const neutral = { code: "NOT_FOUND", message: NOT_FOUND_MSG };
    const missing = "ws-inexistente-0005";
    for (const [label, fn] of [
      ["ratify", () => ratifyCall(fo)], ["publish", () => publishCall(fo)], ["configureFlags", () => flagsCall(fo)],
      ["selectLegalBasis", () => fo.directProcurement.selectLegalBasis({ workspaceId: wsId, legalBasis: "x" })],
    ] as Array<[string, () => Promise<unknown>]>) {
      await expectDeniedWithoutEffect(`foreign owner ${label}`, fn, neutral);
    }
    expect(await errOf(() => fo.directProcurement.ratify(ratifyInput(missing)))).toEqual(neutral);
    expect((await fo.directProcurement.loadProcess({ workspaceId: wsId })).workspace).toBeNull();

    const fv = await caller(foreignViewer, ORG_B);
    await expectDeniedWithoutEffect("foreign viewer ratify (existente)", () => ratifyCall(fv), { code: "FORBIDDEN", message: ROLE_DENIED("manager") });
    expect(await errOf(() => fv.directProcurement.ratify(ratifyInput(missing)))).toEqual({ code: "FORBIDDEN", message: ROLE_DENIED("manager") });

    // Membro do órgão B tentando se passar pelo órgão A via header: barrado pela resolução de tenant, sem efeito.
    await expectDeniedWithoutEffect("foreign owner com header do órgão A", async () => ratifyCall(await caller(foreignOwner, ORG_A)),
      { code: "FORBIDDEN", message: "Sem acesso à organização solicitada." });
  }, 120_000);

  it("owner/admin do órgão e admin de plataforma (auditado) alcançam configureFlags — coerente com orgRoleProcedure", async () => {
    await flagsCall(await caller(owner, ORG_A));
    await flagsCall(await caller(orgAdmin, ORG_A));
    const corr = `new005-platform-${stamp}`;
    await flagsCall(await caller(platformAdmin, ORG_A, { platformAdmin: true, correlationId: corr }));
    const audit = await one(`SELECT details FROM audit_logs WHERE adminId = ? ORDER BY id DESC LIMIT 1`, [platformAdmin]);
    expect(JSON.parse(String(audit.details))).toMatchObject({ event: "platform_admin_tenant_access", organizationId: ORG_A, correlationId: corr });
  }, 120_000);
});

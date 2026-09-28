/**
 * NEW-006 — RBAC do `contractWorkspaceRouter` contra MySQL REAL + router REAL (`appRouter.createCaller`,
 * resolução de tenant real via `organization_members`). Só roda com DATABASE_URL.
 *
 * Prova, por classe da matriz (`CONTRACT_WORKSPACE_RBAC_MATRIX`):
 *  - viewer recusado (FORBIDDEN) em TODAS as mutations; operator recusado em aditivo/apostilamento e
 *    em mudança de status via `updateContract`; manager permitido;
 *  - toda recusa: ZERO linhas novas/alteradas em QUALQUER tabela escopada pelas organizações do teste
 *    (inclui contract_workspaces, contract_addenda, contract_ws_documents, process_timeline,
 *    request_notifications, official_documents…) e ZERO chamadas ao AIExecutionEngine;
 *  - recusa registrada por UM log estruturado `rbac/org_role_denied` com correlationId;
 *  - isolamento: contrato de outra organização ⇒ NOT_FOUND (inalterado), também para manager.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import mysql from "mysql2/promise";

// Conta as chamadas cognitivas SEM provider real (a porta única do AIExecutionEngine).
vi.mock("../../services/aiExecutionEngine", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../services/aiExecutionEngine")>();
  return { ...orig, executeCognitiveTask: vi.fn(async () => ({ response: { content: "Cláusula sugerida (mock NEW-006)." } })) };
});

import { executeCognitiveTask } from "../../services/aiExecutionEngine";
import { createContractWorkspace } from "../../domain/contractWorkspace";
import { insertContractWorkspace } from "../../db/contractWorkspace";
import { CONTRACT_WORKSPACE_RBAC_MATRIX, type ContractWorkspaceProcedureName } from "../../routers/contractWorkspaceRbac";

const DB = process.env.DATABASE_URL;
const ORG_A = 970061;
const ORG_B = 970062;
const ORGS = [ORG_A, ORG_B];

describe.skipIf(!DB)("NEW-006 — RBAC do contractWorkspaceRouter (MySQL real, router real)", () => {
  let conn: mysql.Connection;
  const users: Record<string, number> = {};
  let orgTables: Array<{ table: string; column: string }> = [];
  let CT_OP = ""; // contrato vigente da org A usado nas recusas e nas ações de operator
  let CT_MGR = ""; // contrato vigente da org A usado nas ações de manager

  async function purgeOrgRows() {
    for (const { table, column } of orgTables) {
      await conn.query(`DELETE FROM \`${table}\` WHERE \`${column}\` IN (?, ?)`, ORGS).catch(() => {});
    }
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    // Toda tabela com coluna de tenant ⇒ o "zero escrita" vale para o banco inteiro, não só para uma lista.
    const [cols] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('organization_id','organizationId','tenant_id','tenantId')
          AND TABLE_NAME NOT IN ('organization_members','__drizzle_migrations')`,
    );
    orgTables = cols.map(r => ({ table: String(r.t), column: String(r.c) }));
    for (const must of ["contract_workspaces", "contract_addenda", "contract_ws_apostilles", "contract_ws_documents", "contract_occurrences",
      "process_timeline", "request_notifications", "institutional_requests", "official_documents", "imported_contracts", "idempotency_keys"]) {
      expect(orgTables.map(o => o.table), `tabela ${must} coberta pelo snapshot`).toContain(must);
    }
    await purgeOrgRows();
    await conn.query(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, ORGS);
    await conn.query(`DELETE FROM organizations WHERE id IN (?, ?)`, ORGS);

    const stamp = Date.now();
    for (const tag of ["viewerA", "operatorA", "managerA", "operatorB", "managerB"]) {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')`,
        [`new006-${tag}-${stamp}`, `NEW006 ${tag}`, `new006-${tag}-${stamp}@teste.local`],
      );
      users[tag] = r.insertId;
    }
    for (const org of ORGS) {
      await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [org, `Org NEW006 ${org}`, `org-new006-${org}`]);
    }
    const member = (org: number, uid: number, role: string) =>
      conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, uid, role]);
    await member(ORG_A, users.viewerA, "viewer");
    await member(ORG_A, users.operatorA, "operator");
    await member(ORG_A, users.managerA, "manager");
    await member(ORG_B, users.operatorB, "operator");
    await member(ORG_B, users.managerB, "manager");

    for (const [n, set] of [["CT-NEW006-OP", (id: string) => { CT_OP = id; }], ["CT-NEW006-MGR", (id: string) => { CT_MGR = id; }]] as const) {
      const ws = createContractWorkspace({
        organizationId: ORG_A, originType: "avulso", contractNumber: n, contractor: "Fornecedor Original", object: "Objeto original",
        value: 1000, term: "12 meses", status: "vigente", correlationId: "seed-new006", createdBy: users.managerA,
      });
      await insertContractWorkspace(ws);
      set(ws.id);
    }
  }, 60_000);

  afterAll(async () => {
    if (!conn) return;
    await purgeOrgRows();
    await conn.query(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, ORGS).catch(() => {});
    await conn.query(`DELETE FROM organizations WHERE id IN (?, ?)`, ORGS).catch(() => {});
    const ids = Object.values(users);
    if (ids.length) await conn.query(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids).catch(() => {});
    await conn.end();
  });

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.mocked(executeCognitiveTask).mockClear();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  function denialLogs(): Array<Record<string, unknown>> {
    return warn.mock.calls
      .map(a => { try { return JSON.parse(String(a[0])) as Record<string, unknown>; } catch { return null; } })
      .filter((e): e is Record<string, unknown> => !!e && e.service === "rbac" && e.operation === "org_role_denied");
  }

  /** Estado COMPLETO das organizações do teste: contagem por tabela + conteúdo dos contratos. */
  async function snapshot(): Promise<string> {
    const union = orgTables.map(({ table, column }) =>
      `SELECT '${table}' AS t, COUNT(*) AS n FROM \`${table}\` WHERE \`${column}\` IN (${ORG_A}, ${ORG_B})`).join(" UNION ALL ");
    const [counts] = await conn.query<mysql.RowDataPacket[]>(union);
    const [contracts] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT id, status, contractor, object, value, term, manager, inspector, contract_number, updated_at
         FROM contract_workspaces WHERE organization_id IN (?, ?) ORDER BY id`, ORGS);
    return JSON.stringify({ counts: counts.map(r => [r.t, Number(r.n)]), contracts });
  }

  async function caller(userTag: string, correlationId = `corr-new006-${userTag}`) {
    const { appRouter } = await import("../../routers");
    const id = users[userTag];
    return appRouter.createCaller({
      user: { id, role: "user", name: `U${id}`, email: `u${id}@teste.local` },
      req: { headers: {} }, res: {}, correlationId, requestId: "r", organizationId: null, orgMembership: null,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  async function call(userTag: string, name: ContractWorkspaceProcedureName, input: unknown, corr?: string): Promise<unknown> {
    const c = await caller(userTag, corr);
    return (c.contractWorkspace as unknown as Record<string, (i: unknown) => Promise<unknown>>)[name](input);
  }

  const inputs = (contractId: string): Record<ContractWorkspaceProcedureName, unknown> => ({
    createFromProcurement: { processId: "proc-new006", contractNumber: "CT-NEW006-FP" },
    createFromDirectProcurement: { directWorkspaceId: "dir-new006", contractNumber: "CT-NEW006-FD" },
    createManual: { idempotencyKey: `idem-new006-${contractId}`, contractNumber: "CT-NEW006-MAN" },
    importExternalContract: { source: "pdf", rawText: "CONTRATO Nº 77/2026\nCONTRATADA: Empresa X\nOBJETO: teste\nVALOR: R$ 10.000,00\nVIGÊNCIA: 12 meses", contractNumber: "CT-NEW006-IMP" },
    loadContract: { contractId },
    listContracts: undefined,
    listImported: undefined,
    updateContract: { contractId, contractor: "Fornecedor Alterado" },
    generateDocuments: { contractId, kind: "contrato" },
    createAddendum: { contractId, addendumType: "prazo", justification: "prorrogação" },
    createApostille: { contractId, kind: "reajuste", description: "reajuste anual" },
    registerOccurrence: { contractId, description: "atraso na entrega" },
    requestLegalOpinion: { contractId },
    getLegalOpinion: { requestId: "req-inexistente" },
  });

  const MUTATIONS = (Object.keys(CONTRACT_WORKSPACE_RBAC_MATRIX) as ContractWorkspaceProcedureName[])
    .filter(n => CONTRACT_WORKSPACE_RBAC_MATRIX[n].minRole !== null);

  async function expectDeniedWithoutEffects(userTag: string, name: ContractWorkspaceProcedureName, input: unknown, procedure: string, requiredRole: string) {
    const before = await snapshot();
    const corr = `corr-deny-${userTag}-${name}`;
    await expect(call(userTag, name, input, corr)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await snapshot(), `${userTag} → ${name}: nenhuma linha nova/alterada`).toBe(before);
    expect(vi.mocked(executeCognitiveTask), `${userTag} → ${name}: zero IA`).not.toHaveBeenCalled();
    const logs = denialLogs();
    expect(logs, `${userTag} → ${name}: um log de recusa`).toHaveLength(1);
    expect(logs[0]).toMatchObject({ procedure, requiredRole, userId: users[userTag], organizationId: ORG_A, correlationId: corr });
  }

  it("matriz: 10 mutations protegidas (8 operator, 2 manager)", () => {
    expect(MUTATIONS).toHaveLength(10);
    expect(MUTATIONS.filter(n => CONTRACT_WORKSPACE_RBAC_MATRIX[n].minRole === "manager").sort()).toEqual(["createAddendum", "createApostille"]);
  });

  it("viewer: FORBIDDEN em TODAS as mutations, zero escrita em qualquer tabela, zero IA, log com correlationId", async () => {
    for (const name of MUTATIONS) {
      await expectDeniedWithoutEffects("viewerA", name, inputs(CT_OP)[name], `contractWorkspace.${name}`, CONTRACT_WORKSPACE_RBAC_MATRIX[name].minRole!);
      warn.mockClear();
    }
  }, 60_000);

  it("viewer: leituras continuam permitidas (loadContract, listContracts, listImported, getLegalOpinion)", async () => {
    const r = await call("viewerA", "loadContract", { contractId: CT_OP }) as { workspace: { id: string } | null };
    expect(r.workspace?.id).toBe(CT_OP);
    const l = await call("viewerA", "listContracts", undefined) as { contracts: Array<{ id: string }> };
    expect(l.contracts.map(c => c.id)).toContain(CT_OP);
    await expect(call("viewerA", "listImported", undefined)).resolves.toBeDefined();
    await expect(call("viewerA", "getLegalOpinion", { requestId: "req-inexistente" })).resolves.toBeDefined();
  }, 30_000);

  it("operator: FORBIDDEN em createAddendum/createApostille (instrumento muda status do contrato) — zero escrita, zero IA", async () => {
    for (const name of ["createAddendum", "createApostille"] as const) {
      await expectDeniedWithoutEffects("operatorA", name, inputs(CT_OP)[name], `contractWorkspace.${name}`, "manager");
      warn.mockClear();
    }
  }, 30_000);

  it("operator: updateContract mudando status (vigente → rescindido/encerrado/arquivado) ⇒ FORBIDDEN, nem os campos são gravados", async () => {
    for (const to of ["rescindido", "encerrado", "arquivado"]) {
      await expectDeniedWithoutEffects("operatorA", "updateContract", { contractId: CT_OP, contractor: "Não gravar", status: to },
        "contractWorkspace.updateContract#status", "manager");
      warn.mockClear();
    }
  }, 30_000);

  it("operator: permitido nas ações de rascunho/edição/minuta/ocorrência/solicitação (efeitos reais gravados)", async () => {
    const count = async (sql: string, p: unknown[]) => Number(((await conn.query<mysql.RowDataPacket[]>(sql, p))[0][0] as { n: number }).n);

    const upd = await call("operatorA", "updateContract", { contractId: CT_OP, contractor: "Fornecedor Editado", status: "vigente" }) as { workspace: { contractor: string; status: string } };
    expect(upd.workspace).toMatchObject({ contractor: "Fornecedor Editado", status: "vigente" }); // mesmo status ⇒ não é mudança

    const docsBefore = await count(`SELECT COUNT(*) n FROM contract_ws_documents WHERE organization_id = ? AND contract_id = ?`, [ORG_A, CT_OP]);
    await call("operatorA", "generateDocuments", { contractId: CT_OP, kind: "contrato" });
    expect(await count(`SELECT COUNT(*) n FROM contract_ws_documents WHERE organization_id = ? AND contract_id = ?`, [ORG_A, CT_OP])).toBe(docsBefore + 1);
    expect(vi.mocked(executeCognitiveTask)).toHaveBeenCalled(); // o contador de IA funciona (prova do "zero IA" nas recusas)
    const [[od]] = await conn.query<mysql.RowDataPacket[]>(`SELECT status FROM official_documents WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`, [ORG_A]);
    expect(od.status).toBe("gerado"); // minuta — nunca "emitido"
    const [[ct]] = await conn.query<mysql.RowDataPacket[]>(`SELECT status FROM contract_workspaces WHERE id = ? AND organization_id = ?`, [CT_OP, ORG_A]);
    expect(ct.status).toBe("vigente"); // gerar minuta não muda o status

    // operator PASSA pelo RBAC em registerOccurrence. Achado pré-existente, fora do escopo (reportado à
    // parte): `insertContractOccurrence` grava `createdAt` ISO ("…T…Z") sem `toDbDatetime` e o MySQL/MariaDB
    // estrito recusa. Aceita as duas saídas para o teste continuar válido quando o bug for corrigido —
    // o que importa aqui é: nunca FORBIDDEN.
    const occ = await call("operatorA", "registerOccurrence", { contractId: CT_OP, description: "atraso" }).then(() => null, (e: unknown) => e as { code?: string; message?: string });
    if (occ === null) {
      expect(await count(`SELECT COUNT(*) n FROM contract_occurrences WHERE organization_id = ? AND contract_id = ?`, [ORG_A, CT_OP])).toBe(1);
    } else {
      expect(occ.code).not.toBe("FORBIDDEN");
      expect(String(occ.message)).toMatch(/contract_occurrences/);
    }

    const notifBefore = await count(`SELECT COUNT(*) n FROM request_notifications WHERE organization_id = ?`, [ORG_A]);
    const op = await call("operatorA", "requestLegalOpinion", { contractId: CT_OP }) as { requestId: string };
    expect(op.requestId).toBeTruthy();
    expect(await count(`SELECT COUNT(*) n FROM request_notifications WHERE organization_id = ?`, [ORG_A])).toBe(notifBefore + 1);

    for (const name of ["createManual", "createFromProcurement", "createFromDirectProcurement", "importExternalContract"] as const) {
      const r = await call("operatorA", name, inputs(CT_OP)[name]) as { workspace: { status: string; organizationId: number } };
      expect(r.workspace, name).toMatchObject({ status: "minuta", organizationId: ORG_A });
    }
    expect(denialLogs()).toHaveLength(0);
  }, 60_000);

  it("manager: permitido em createAddendum, createApostille e mudança de status via updateContract", async () => {
    const add = await call("managerA", "createAddendum", { contractId: CT_MGR, addendumType: "prazo", justification: "prorrogação" }) as { addendum: { contractId: string } };
    expect(add.addendum.contractId).toBe(CT_MGR);
    const ap = await call("managerA", "createApostille", { contractId: CT_MGR, kind: "reajuste" }) as { apostille: { contractId: string } };
    expect(ap.apostille.contractId).toBe(CT_MGR);
    const [[ct]] = await conn.query<mysql.RowDataPacket[]>(`SELECT status FROM contract_workspaces WHERE id = ? AND organization_id = ?`, [CT_MGR, ORG_A]);
    expect(ct.status).toBe("apostilado");
    const upd = await call("managerA", "updateContract", { contractId: CT_MGR, status: "encerrado" }) as { workspace: { status: string } };
    expect(upd.workspace.status).toBe("encerrado");
    expect(denialLogs()).toHaveLength(0);
  }, 60_000);

  it("isolamento inalterado: operator/manager da org B sobre contrato da org A ⇒ NOT_FOUND, zero escrita, zero IA", async () => {
    const before = await snapshot();
    const i = inputs(CT_OP);
    for (const [tag, name] of [
      ["operatorB", "updateContract"], ["operatorB", "generateDocuments"], ["operatorB", "registerOccurrence"], ["operatorB", "requestLegalOpinion"],
      ["managerB", "createAddendum"], ["managerB", "createApostille"],
    ] as const) {
      await expect(call(tag, name, i[name]), `${tag} → ${name}`).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(call("managerB", "updateContract", { contractId: CT_OP, status: "rescindido" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const r = await call("operatorB", "loadContract", { contractId: CT_OP }) as { workspace: unknown };
    expect(r.workspace).toBeNull();
    expect(await snapshot()).toBe(before);
    expect(vi.mocked(executeCognitiveTask)).not.toHaveBeenCalled();
  }, 60_000);
});

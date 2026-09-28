/**
 * NEW-006 — RBAC do `contractWorkspaceRouter` (mockado, sem DB).
 *
 * 1. CONGELAMENTO: a matriz exportada (`CONTRACT_WORKSPACE_RBAC_MATRIX`) cobre exatamente as
 *    procedures do router e confere com o builder declarado no código-fonte.
 * 2. COMPORTAMENTO por papel (viewer / operator / manager / admin / owner) sobre o router real, com
 *    tenant e serviços mockados: recusa ⇒ FORBIDDEN, ZERO chamadas a serviço/escrita, e UM log
 *    estruturado `rbac/org_role_denied` com correlationId.
 * 3. `updateContract` dividido: operator edita campos; mudança de status exige manager (antes de
 *    qualquer escrita); status igual ao atual não é mudança.
 *
 * A prova contra MySQL real + router real está em `new006-contract-workspace-rbac-mysql-smoke.test.ts`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import { TRPCError } from "@trpc/server";

const h = vi.hoisted(() => ({
  ORG: 70601,
  draftId: "ctw-new006-minuta",
  roleByUser: new Map<number, string>(),
  contract: {
    id: "ctw-new006", organizationId: 70601, originType: "avulso", originProcess: "", contractNumber: "CT-NEW006",
    contractor: "Fornecedor", object: "Objeto", value: 100, term: "12 meses", status: "vigente", manager: "", inspector: "",
    activeCopilots: [], correlationId: "c", createdBy: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  },
}));

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async (userId: number) => {
    const role = h.roleByUser.get(userId);
    if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "sem membership" });
    return {
      organizationId: h.ORG,
      membership: { id: userId, organizationId: h.ORG, userId, role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
    };
  }),
}));

vi.mock("../../services/contractService", () => {
  class ManualContractConflictError extends Error { constructor(public readonly existingId: string) { super("conflito"); } }
  return {
    ManualContractConflictError,
    createFromProcurement: vi.fn(async () => h.contract),
    createFromDirectProcurement: vi.fn(async () => h.contract),
    importExternalContract: vi.fn(async () => ({ workspace: h.contract, confidence: 1, reconstructed: {}, assisted: true, disclaimer: "" })),
    createManualContract: vi.fn(async () => h.contract),
    generateContractDocument: vi.fn(async () => ({ document: null, officialDocumentId: "od", recommendation: {} })),
    createAddendum: vi.fn(async () => ({ addendum: null, requiresLegalOpinion: false })),
    createApostille: vi.fn(async () => null),
    registerOccurrence: vi.fn(async () => null),
    requestContractLegalOpinion: vi.fn(async () => ({ requestId: "req-1" })),
    getContractLegalOpinion: vi.fn(async () => ({ response: null, documents: [] })),
  };
});

vi.mock("../../db/contractWorkspace", () => ({
  getContractWorkspace: vi.fn(async (id: string, orgId: number) => {
    if (orgId !== h.ORG) return null;
    if (id === h.contract.id) return { ...h.contract };
    if (id === h.draftId) return { ...h.contract, id: h.draftId, status: "minuta" };
    return null;
  }),
  insertContractWorkspace: vi.fn(async (ws: unknown) => ws),
  listContractWorkspaces: vi.fn(async () => []),
  listImportedContractWorkspaces: vi.fn(async () => []),
  listContractWsDocuments: vi.fn(async () => []),
  listContractAddenda: vi.fn(async () => []),
  listContractApostilles: vi.fn(async () => []),
  listContractOccurrences: vi.fn(async () => []),
}));

vi.mock("../../db/procurement", () => ({ listProcessTimeline: vi.fn(async () => []) }));

vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn(async () => ({ status: "new" })),
  saveIdempotencyResult: vi.fn(async () => undefined),
  failIdempotencyKey: vi.fn(async () => undefined),
}));

import { contractWorkspaceRouter } from "../../routers/contractWorkspaceRouter";
import { CONTRACT_WORKSPACE_RBAC_MATRIX, type ContractWorkspaceProcedureName } from "../../routers/contractWorkspaceRbac";
import * as contractService from "../../services/contractService";
import * as contractDb from "../../db/contractWorkspace";
import * as idem from "../../services/idempotencyService";

const ROLES = ["viewer", "operator", "manager", "admin", "owner"] as const;
type Role = (typeof ROLES)[number];
const RANK: Record<Role, number> = { viewer: 1, operator: 2, manager: 3, admin: 4, owner: 5 };
const USER_BY_ROLE: Record<Role, number> = { viewer: 11, operator: 12, manager: 13, admin: 14, owner: 15 };
for (const r of ROLES) h.roleByUser.set(USER_BY_ROLE[r], r);

const CID = h.contract.id; // vigente
const DRAFT = h.draftId; // minuta
// Revisão carregada pelo cliente. Inócua em main (zod descarta a chave); obrigatória no CAS da PR-12 —
// incluída desde já para a matriz valer sem reescrita na integração.
const REV = h.contract.updatedAt;
/** Entrada VÁLIDA (zod) de cada procedure — a recusa tem de vir do RBAC, nunca da validação. */
const VALID_INPUT: Record<ContractWorkspaceProcedureName, unknown> = {
  createFromProcurement: { processId: "p-1", contractNumber: "CT-1" },
  createFromDirectProcurement: { directWorkspaceId: "d-1", contractNumber: "CT-2" },
  createManual: { idempotencyKey: "k-1", contractNumber: "CT-3" },
  importExternalContract: { source: "pdf", rawText: "CONTRATO Nº 9/2026 — objeto: teste" },
  loadContract: { contractId: CID },
  listContracts: undefined,
  listImported: undefined,
  updateContract: { contractId: DRAFT, contractor: "Novo Fornecedor", expectedUpdatedAt: REV },
  generateDocuments: { contractId: CID, kind: "contrato" },
  createAddendum: { contractId: CID, addendumType: "prazo", justification: "prorrogação" },
  createApostille: { contractId: CID, kind: "reajuste" },
  registerOccurrence: { contractId: CID, description: "atraso na entrega" },
  requestLegalOpinion: { contractId: CID },
  getLegalOpinion: { requestId: "req-1" },
};

/** Todo efeito (serviço/escrita) que uma procedure pode disparar — tem de ficar em ZERO numa recusa. */
const EFFECT_MOCKS = () => [
  contractService.createFromProcurement, contractService.createFromDirectProcurement, contractService.importExternalContract,
  contractService.createManualContract, contractService.generateContractDocument, contractService.createAddendum,
  contractService.createApostille, contractService.registerOccurrence, contractService.requestContractLegalOpinion,
  contractDb.insertContractWorkspace, idem.checkIdempotency, idem.saveIdempotencyResult, idem.failIdempotencyKey,
].map(f => vi.mocked(f));

function caller(role: Role, correlationId = `corr-new006-${role}`) {
  const userId = USER_BY_ROLE[role];
  return contractWorkspaceRouter.createCaller({
    user: { id: userId, role: "user", name: `U${userId}`, email: `u${userId}@teste.local` },
    req: { headers: {} }, res: {}, correlationId, requestId: "r", organizationId: null, orgMembership: null,
  } as unknown as Parameters<typeof contractWorkspaceRouter.createCaller>[0]);
}

function call(role: Role, name: ContractWorkspaceProcedureName, input: unknown = VALID_INPUT[name], corr?: string): Promise<unknown> {
  const c = caller(role, corr) as unknown as Record<string, (i: unknown) => Promise<unknown>>;
  return c[name](input);
}

function allowed(role: Role, name: ContractWorkspaceProcedureName): boolean {
  const min = CONTRACT_WORKSPACE_RBAC_MATRIX[name].minRole;
  return min === null || RANK[role] >= RANK[min];
}

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

function denialLogs(): Array<Record<string, unknown>> {
  return warn.mock.calls
    .map(args => { try { return JSON.parse(String(args[0])) as Record<string, unknown>; } catch { return null; } })
    .filter((e): e is Record<string, unknown> => !!e && e.service === "rbac" && e.operation === "org_role_denied");
}

// ─── 1. Congelamento ───────────────────────────────────────────────────────────

describe("NEW-006 — matriz RBAC congelada do contractWorkspaceRouter", () => {
  const src = fs.readFileSync("server/routers/contractWorkspaceRouter.ts", "utf-8");
  const procedures = Object.keys(contractWorkspaceRouter._def.procedures).sort();

  it("a matriz cobre EXATAMENTE as procedures do router (nova procedure ⇒ atualizar a matriz deliberadamente)", () => {
    expect(Object.keys(CONTRACT_WORKSPACE_RBAC_MATRIX).sort()).toEqual(procedures);
    expect(procedures).toHaveLength(14);
  });

  it("o builder declarado no código-fonte confere com a matriz, procedure a procedure", () => {
    for (const [name, entry] of Object.entries(CONTRACT_WORKSPACE_RBAC_MATRIX)) {
      const expected = entry.minRole === null ? "tenantProcedure\\b" : `orgRoleProcedure\\("${entry.minRole}"\\)`;
      expect(new RegExp(`\\n  ${name}: ${expected}`).test(src), `${name} deveria usar ${expected}`).toBe(true);
    }
    // Nenhuma mutation ficou em tenantProcedure.
    const tenantDecls = [...src.matchAll(/\n  (\w+): tenantProcedure\b/g)].map(m => m[1]).sort();
    expect(tenantDecls).toEqual(["getLegalOpinion", "listContracts", "listImported", "loadContract"]);
  });

  it("todas as mutations exigem pelo menos operator; as leituras seguem tenantProcedure", () => {
    for (const name of procedures as ContractWorkspaceProcedureName[]) {
      const type = (contractWorkspaceRouter._def.procedures as Record<string, { _def: { type: string } }>)[name]._def.type;
      const entry = CONTRACT_WORKSPACE_RBAC_MATRIX[name];
      if (type === "mutation") expect(entry.minRole, name).not.toBeNull();
      else { expect(entry.minRole, name).toBeNull(); expect(entry.classes).toEqual(["READ"]); }
    }
  });

  it("instrumentos que mudam o status do contrato (aditivo/apostilamento) têm piso manager; updateContract divide por status", () => {
    expect(CONTRACT_WORKSPACE_RBAC_MATRIX.createAddendum.minRole).toBe("manager");
    expect(CONTRACT_WORKSPACE_RBAC_MATRIX.createApostille.minRole).toBe("manager");
    expect(CONTRACT_WORKSPACE_RBAC_MATRIX.updateContract.minRole).toBe("operator");
    expect(CONTRACT_WORKSPACE_RBAC_MATRIX.updateContract.conditionalMinRole.minRole).toBe("manager");
    expect(src).toMatch(/assertOrgRoleAtLeast\(ctx, "manager", "contractWorkspace\.updateContract#status"\)/);
  });

  it("o piso manager é declarado como PISO TÉCNICO (competência legal fora do escopo: PR-07/PR-18/PR-20)", () => {
    const matrixSrc = fs.readFileSync("server/routers/contractWorkspaceRbac.ts", "utf-8");
    expect(matrixSrc).toMatch(/PISO T[ÉE]CNICO/);
    expect(matrixSrc).toMatch(/PR-07 \/ PR-18 \/ PR-20/);
    expect(src).toMatch(/PR-07\/PR-18\/PR-20/);
  });
});

// ─── 2. Comportamento por papel ──────────────────────────────────────────────────

describe("NEW-006 — comportamento por papel (router real, serviços mockados)", () => {
  const names = Object.keys(CONTRACT_WORKSPACE_RBAC_MATRIX) as ContractWorkspaceProcedureName[];

  for (const role of ROLES) {
    for (const name of names) {
      if (allowed(role, name)) {
        it(`${role} → ${name}: permitido`, async () => {
          await expect(call(role, name)).resolves.toBeDefined();
          expect(denialLogs()).toHaveLength(0);
        });
      } else {
        it(`${role} → ${name}: FORBIDDEN, zero efeitos, log de recusa com correlationId`, async () => {
          const corr = `corr-deny-${role}-${name}`;
          await expect(call(role, name, VALID_INPUT[name], corr)).rejects.toMatchObject({ code: "FORBIDDEN" });
          for (const m of EFFECT_MOCKS()) expect(m).not.toHaveBeenCalled();
          // A recusa acontece ANTES do lookup do contrato (nem existência é consultada).
          expect(vi.mocked(contractDb.getContractWorkspace)).not.toHaveBeenCalled();
          const logs = denialLogs();
          expect(logs).toHaveLength(1);
          expect(logs[0]).toMatchObject({
            level: "warn", procedure: name, requiredRole: CONTRACT_WORKSPACE_RBAC_MATRIX[name].minRole,
            userRole: role, userId: USER_BY_ROLE[role], organizationId: h.ORG, correlationId: corr,
          });
        });
      }
    }
  }

  it("viewer é recusado em TODAS as 10 mutations e aceito nas 4 leituras", () => {
    const denied = names.filter(n => !allowed("viewer", n));
    expect(denied.sort()).toEqual([
      "createAddendum", "createApostille", "createFromDirectProcurement", "createFromProcurement", "createManual",
      "generateDocuments", "importExternalContract", "registerOccurrence", "requestLegalOpinion", "updateContract",
    ]);
  });

  it("operator é recusado exatamente em createAddendum e createApostille", () => {
    expect(names.filter(n => !allowed("operator", n)).sort()).toEqual(["createAddendum", "createApostille"]);
  });
});

// ─── 3. updateContract dividido ──────────────────────────────────────────────────

describe("NEW-006 — updateContract: campos = operator; mudança de status = manager", () => {
  it("operator edita campos (sem status) e grava", async () => {
    await expect(call("operator", "updateContract", { contractId: DRAFT, contractor: "X", expectedUpdatedAt: REV })).resolves.toMatchObject({ workspace: { contractor: "X" } });
    expect(vi.mocked(contractDb.insertContractWorkspace)).toHaveBeenCalledTimes(1);
  });

  it("operator enviando o MESMO status atual (minuta) não é mudança de status ⇒ permitido", async () => {
    await expect(call("operator", "updateContract", { contractId: DRAFT, contractor: "Y", status: "minuta", expectedUpdatedAt: REV })).resolves.toBeDefined();
    expect(vi.mocked(contractDb.insertContractWorkspace)).toHaveBeenCalledTimes(1);
  });

  for (const to of ["encerrado", "rescindido", "arquivado", "aditado"] as const) {
    it(`operator mudando status vigente → ${to} ⇒ FORBIDDEN, nada gravado, log de recusa`, async () => {
      await expect(call("operator", "updateContract", { contractId: CID, status: to, expectedUpdatedAt: REV }, "corr-op-status"))
        .rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(vi.mocked(contractDb.insertContractWorkspace)).not.toHaveBeenCalled();
      const logs = denialLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ procedure: "contractWorkspace.updateContract#status", requiredRole: "manager", userRole: "operator", correlationId: "corr-op-status" });
    });
  }

  it("manager muda status vigente → encerrado (transição válida) e grava", async () => {
    await expect(call("manager", "updateContract", { contractId: CID, status: "encerrado", expectedUpdatedAt: REV })).resolves.toMatchObject({ workspace: { status: "encerrado" } });
    expect(vi.mocked(contractDb.insertContractWorkspace)).toHaveBeenCalledTimes(1);
  });

  it("manager com transição INVÁLIDA continua BAD_REQUEST da máquina de estados (RBAC não mascara a regra)", async () => {
    await expect(call("manager", "updateContract", { contractId: CID, status: "minuta", expectedUpdatedAt: REV })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(vi.mocked(contractDb.insertContractWorkspace)).not.toHaveBeenCalled();
  });

  it("contrato de outra organização ⇒ NOT_FOUND (inalterado), mesmo para operator pedindo mudança de status", async () => {
    await expect(call("operator", "updateContract", { contractId: "ctw-outra-org", status: "rescindido", expectedUpdatedAt: REV })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(call("manager", "createAddendum", { contractId: "ctw-outra-org", addendumType: "prazo", justification: "j" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(vi.mocked(contractDb.insertContractWorkspace)).not.toHaveBeenCalled();
    expect(vi.mocked(contractService.createAddendum)).not.toHaveBeenCalled();
  });
});

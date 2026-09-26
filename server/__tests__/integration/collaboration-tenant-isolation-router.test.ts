/**
 * R1 / PR-01 — SEM-001: contrato do boundary tenant-scoped do `collaborationRouter` com a camada de dados MOCKADA
 * (complementa o smoke MySQL real `collaboration-tenant-isolation-mysql-smoke.test.ts`).
 *
 * Cobre o que o banco migrado não permite verificar hoje (drift pré-existente do ENUM `notifications.type`, sem
 * `stage_assigned`) e a ORDEM dos gates: tenant do processo → permissão no processo → alvo no tenant → escrita →
 * notificação → activity log. Negação ⇒ nenhuma chamada de escrita, inclusive em retry (replay).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 7,
    membership: { id: 1, organizationId: 7, userId: 10, role: "operator", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
}));

vi.mock("../../db", () => ({
  getProcessByIdForOrganization: vi.fn(),
  getProcessMember: vi.fn(),
  getActiveOrganizationUserByEmail: vi.fn(),
  getActiveOrganizationUserById: vi.fn(),
  addProcessMember: vi.fn(),
  removeProcessMember: vi.fn(),
  updateProcessMemberPermission: vi.fn(),
  updateProcessMemberFunctionalRole: vi.fn(),
  upsertStageAssignment: vi.fn(),
  removeStageAssignment: vi.fn(),
  createNotification: vi.fn(),
  createActivityLogForOrganization: vi.fn(),
  getProcessMembersForOrganization: vi.fn(),
  getStageAssignmentsForOrganization: vi.fn(),
  // as variantes GLOBAIS não fazem parte do boundary; se forem chamadas, o teste falha
  getProcessById: vi.fn(() => { throw new Error("lookup global de processo não pode ser usado"); }),
  getUserByEmail: vi.fn(() => { throw new Error("lookup global de usuário por e-mail não pode ser usado"); }),
  getUserById: vi.fn(() => { throw new Error("lookup global de usuário por id não pode ser usado"); }),
}));

import * as db from "../../db";
import { collaborationRouter } from "../../routers/collaborationRouter";

const ORG = 7;
const OWNER = 10;
const PROCESS = { id: 100, name: "Processo X", ownerId: OWNER };
const m = vi.mocked;
const writes = () => [
  db.addProcessMember, db.removeProcessMember, db.updateProcessMemberPermission, db.updateProcessMemberFunctionalRole,
  db.upsertStageAssignment, db.removeStageAssignment, db.createNotification, db.createActivityLogForOrganization,
].map((f) => m(f).mock.calls.length);

function caller(userId = OWNER, correlationId = "corr-router") {
  return collaborationRouter.createCaller({
    user: { id: userId, role: "user", name: "Dono", email: "dono@x.gov" },
    req: { headers: {}, ip: "127.0.0.1" },
    res: {},
    correlationId,
  } as unknown as Parameters<typeof collaborationRouter.createCaller>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  m(db.getProcessByIdForOrganization).mockImplementation(async (id: number, org: number) => (id === PROCESS.id && org === ORG ? PROCESS : undefined) as never);
  m(db.getProcessMember).mockResolvedValue(undefined as never);
  m(db.getActiveOrganizationUserByEmail).mockImplementation(async (email: string, org: number) =>
    (org === ORG && email === "colega@org7.gov" ? { id: 11, name: "Colega" } : undefined) as never);
  m(db.getActiveOrganizationUserById).mockImplementation(async (id: number, org: number) =>
    (org === ORG && id === 11 ? { id: 11, name: "Colega" } : undefined) as never);
});

describe("R1 / SEM-001 — boundary tenant-scoped (DB mockado)", () => {
  it("T3 — addMember no mesmo órgão: membro → notificação → activity log com organizationId e correlationId", async () => {
    await caller().addMember({ processId: PROCESS.id, userEmail: "colega@org7.gov", permission: "editor" });
    expect(db.getActiveOrganizationUserByEmail).toHaveBeenCalledWith("colega@org7.gov", ORG);
    expect(db.addProcessMember).toHaveBeenCalledWith(expect.objectContaining({ processId: PROCESS.id, userId: 11, permission: "editor", invitedBy: OWNER }));
    expect(db.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 11, type: "member_added", processId: PROCESS.id }));
    expect(db.createActivityLogForOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ processId: PROCESS.id, userId: OWNER, correlationId: "corr-router" }), ORG);
  });

  it("T5 — assignStage no mesmo órgão: atribuição → notificação 'stage_assigned' → activity log (contrato completo)", async () => {
    await caller().assignStage({ processId: PROCESS.id, docType: "tr", assignedUserId: 11, note: "revisar" });
    expect(db.getActiveOrganizationUserById).toHaveBeenCalledWith(11, ORG);
    expect(db.upsertStageAssignment).toHaveBeenCalledWith(expect.objectContaining({ processId: PROCESS.id, docType: "tr", assignedUserId: 11 }));
    expect(db.createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 11, type: "stage_assigned" }));
    expect(db.createActivityLogForOrganization).toHaveBeenCalledWith(expect.objectContaining({ processId: PROCESS.id }), ORG);
  });

  it("T1/T2 — alvo de outro órgão e alvo inexistente ⇒ contrato externo IDÊNTICO e nenhuma escrita", async () => {
    const run = (email: string) => caller().addMember({ processId: PROCESS.id, userEmail: email, permission: "viewer" })
      .then(() => ({ code: "RESOLVED" }), (e) => ({ code: e.code, message: e.message }));
    const foreign = await run("fora@org8.gov");
    const missing = await run("nao-existe@x.gov");
    expect(foreign).toEqual({ code: "NOT_FOUND", message: "Usuário não encontrado nesta organização." });
    expect(missing).toEqual(foreign);
    expect(writes().every((n) => n === 0)).toBe(true);
  });

  it("processo de outro órgão ⇒ NOT_FOUND ANTES de qualquer resolução de alvo ou permissão", async () => {
    await expect(caller().addMember({ processId: 999, userEmail: "colega@org7.gov", permission: "viewer" }))
      .rejects.toMatchObject({ code: "NOT_FOUND", message: "Processo não encontrado." });
    expect(db.getProcessByIdForOrganization).toHaveBeenCalledWith(999, ORG);
    expect(db.getActiveOrganizationUserByEmail).not.toHaveBeenCalled();
    expect(db.getProcessMember).not.toHaveBeenCalled();
    expect(writes().every((n) => n === 0)).toBe(true);
  });

  it("replay: repetir a mesma tentativa negada continua sem nenhuma escrita/notificação/log", async () => {
    for (let i = 0; i < 3; i++) {
      await expect(caller().assignStage({ processId: PROCESS.id, docType: "etp", assignedUserId: 99 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(writes().every((n) => n === 0)).toBe(true);
  });

  it("removeMember de associação estrangeira existente no processo do tenant ⇒ permitido, log sem nome", async () => {
    m(db.getProcessMember).mockImplementation(async (_p: number, u: number) => (u === 55 ? { userId: 55, permission: "viewer" } : undefined) as never);
    await caller().removeMember({ processId: PROCESS.id, userId: 55 });
    expect(db.removeProcessMember).toHaveBeenCalledWith(PROCESS.id, 55);
    expect(db.createActivityLogForOrganization).toHaveBeenCalledWith(expect.objectContaining({ action: "removeu um membro do processo" }), ORG);
  });

  it("updatePermission de associação estrangeira ⇒ NOT_FOUND e nenhuma elevação", async () => {
    m(db.getProcessMember).mockImplementation(async (_p: number, u: number) => (u === 55 ? { userId: 55, permission: "viewer" } : undefined) as never);
    await expect(caller().updatePermission({ processId: PROCESS.id, userId: 55, permission: "approver" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(db.updateProcessMemberPermission).not.toHaveBeenCalled();
  });

  it("correlationId longo do cliente é truncado a 36 (coluna varchar(36)) — nunca falha após a escrita", async () => {
    await caller(OWNER, "x".repeat(80)).unassignStage({ processId: PROCESS.id, docType: "dfd" });
    expect(m(db.createActivityLogForOrganization).mock.calls[0][0]).toMatchObject({ correlationId: "x".repeat(36) });
  });

  it("listMembers/getStageAssignments usam as leituras tenant-scoped e nunca as globais", async () => {
    m(db.getProcessMembersForOrganization).mockResolvedValue({ members: [], hiddenCount: 1 } as never);
    m(db.getStageAssignmentsForOrganization).mockResolvedValue({ assignments: [], hiddenCount: 0 } as never);
    expect(await caller().listMembers({ processId: PROCESS.id })).toEqual([]);
    expect(await caller().getStageAssignments({ processId: PROCESS.id })).toEqual([]);
    expect(db.getProcessMembersForOrganization).toHaveBeenCalledWith(PROCESS.id, ORG);
    expect(db.getStageAssignmentsForOrganization).toHaveBeenCalledWith(PROCESS.id, ORG);
  });
});

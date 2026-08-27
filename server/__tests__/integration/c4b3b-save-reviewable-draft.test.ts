/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.4B.3B — Edição HUMANA governada de ETP/TR/Edital (ROUTER saveReviewableDraft, unit).
 *
 * Cobre RBAC (operator+ edita; viewer não), existência (NOT_FOUND), tenant-scope e o contrato de write
 * governado (operation=human_edit, expectedState present, snapshot canônico). Persistência mockada; o
 * comportamento real (provenance/ledger/concorrência/idempotência) tem cobertura no smoke MySQL C.4B.3B.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let membershipRole = "operator";

vi.mock("../../db/procurement");
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({ transaction: async (cb: (tx: unknown) => unknown) => cb({}) })),
}));
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn(async () => ({ status: "new" })),
  saveIdempotencyResult: vi.fn(async () => undefined),
  failIdempotencyKey: vi.fn(async () => undefined),
}));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: membershipRole, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
  getMembership: vi.fn(async () => ({ id: 1, organizationId: 1, userId: 1, role: membershipRole, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() })),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("fake-token"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import * as procDb from "../../db/procurement";
import { makeContext, mockUser } from "../helpers/fixtures";

const PID = "proc-c4b3b-1";
const mockProcess = { id: PID, organizationId: 1, processNumber: "800/2026", object: "Aquisição Z" };
const existingDraft = { id: "gd-etp", kind: "etp", title: "ETP — Z", content: "conteúdo persistido", status: "rascunho", authorUserId: 5, lastSubstantiveActorUserId: 5, updatedAt: "2026-08-27T00:00:00.000Z" };

function callInput(overrides: Record<string, unknown> = {}) {
  return { processId: PID, kind: "etp" as const, content: "novo conteúdo humano", expectedContentHash: "a".repeat(64), idempotencyKey: "edit-key-1", ...overrides };
}

describe("C.4B.3B — saveReviewableDraft (edição humana governada)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    membershipRole = "operator";
    vi.mocked(procDb.getProcess).mockResolvedValue(mockProcess as any);
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ ...existingDraft } as any);
    vi.mocked(procDb.applyDraftContentMutationTx).mockImplementation(async (_tx: any, input: any) => ({ created: false, changed: true, document: input.doc }));
    vi.mocked(procDb.recordProcessEvent).mockResolvedValue(undefined as any);
  });

  it("operator PODE editar ETP → write governado (operation=human_edit, expectedState present, tenant do ctx)", async () => {
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const { document } = await caller.saveReviewableDraft(callInput());
    expect(document.kind).toBe("etp");
    const call = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1];
    expect(call.operation).toBe("human_edit");
    expect(call.expectedState).toEqual({ type: "present", contentHash: "a".repeat(64) });
    expect(call.actorUserId).toBe(mockUser.id);
    // tenant-scoped: carrega o draft com o org do contexto (1), nunca do cliente.
    expect(vi.mocked(procDb.getGeneratedDocumentByKind).mock.calls[0][1]).toBe(1);
    expect(procDb.recordProcessEvent).toHaveBeenCalledTimes(1);
  });

  it("viewer NÃO pode editar → FORBIDDEN (papel mínimo operator)", async () => {
    membershipRole = "viewer";
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await expect(caller.saveReviewableDraft(callInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
  });

  it("rascunho inexistente → NOT_FOUND (não cria por esta via)", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(null as any);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await expect(caller.saveReviewableDraft(callInput())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
  });

  it("TR e Edital seguem o MESMO contrato", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ ...existingDraft, kind: "tr", title: "TR — Z" } as any);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await caller.saveReviewableDraft(callInput({ kind: "tr" }));
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].kind).toBe("tr");
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].operation).toBe("human_edit");
  });

  it("exige autenticação (UNAUTHORIZED)", async () => {
    await expect(
      procurementProcessRouter.createCaller(makeContext(null)).saveReviewableDraft(callInput()),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

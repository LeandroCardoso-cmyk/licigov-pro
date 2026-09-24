/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Contexto Canônico — ROUTER: RBAC preservado (viewer lê, só operator+ escreve), isolamento multi-tenant
 * (organizationId SEMPRE do ctx autenticado; processo de outro tenant → NOT_FOUND sem efeito) e o fato
 * "unidade requisitante" gravado NA transação de criação do processo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const role = { value: "owner" as string };
vi.mock("../../db/procurement");
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => null) }));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: role.value, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
  getMembership: vi.fn(async () => ({ id: 1, organizationId: 1, userId: 1, role: role.value, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() })),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("fake-token"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../services/canonicalContextService", () => ({
  resolveProcurementContext: vi.fn(async () => ({ organizationId: 1, processId: "p1", digest: "d".repeat(64), version: 0 })),
  recordContextAssertions: vi.fn(async () => 1),
}));
vi.mock("../../services/procurementProcessService", async (orig) => ({
  ...(await orig<typeof import("../../services/procurementProcessService")>()),
  getDFDAssistState: vi.fn(async () => ({ available: true, fields: [] })),
  reconcileDFDFieldDraft: vi.fn(async () => ({ document: { id: "d" }, replayed: false })),
  generateDFDJustificationDraft: vi.fn(async () => ({ document: { id: "d" }, explanation: { executionId: "e" }, replayed: false })),
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import * as procDb from "../../db/procurement";
import * as svc from "../../services/procurementProcessService";
import * as ctxSvc from "../../services/canonicalContextService";
import { makeContext, mockUser } from "../helpers/fixtures";

const caller = () => procurementProcessRouter.createCaller(makeContext(mockUser));
const process1 = { id: "p1", organizationId: 1, processNumber: "1/2026", object: "Objeto" };

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "owner";
  vi.mocked(procDb.getProcess).mockImplementation(async (id: string, org: number) => (id === "p1" && org === 1 ? process1 : null) as any);
});

describe("Contexto Canônico — RBAC e tenant", () => {
  it("viewer LÊ contexto/estado, mas NÃO reconcilia nem gera IA (FORBIDDEN, sem efeito)", async () => {
    role.value = "viewer";
    await expect(caller().canonicalContext({ processId: "p1" })).resolves.toBeDefined();
    await expect(caller().dfdAssistState({ processId: "p1" })).resolves.toMatchObject({ available: true });
    await expect(caller().reconcileDFDField({ processId: "p1", fieldKey: "identificacao.unidade", expectedContentHash: "h", idempotencyKey: "k" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller().generateDFDJustification({ processId: "p1", expectedContentHash: "h", idempotencyKey: "k" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(svc.reconcileDFDFieldDraft).not.toHaveBeenCalled();
    expect(svc.generateDFDJustificationDraft).not.toHaveBeenCalled();
  });

  it("operator executa; organizationId e ator vêm SEMPRE do ctx (nunca do cliente)", async () => {
    role.value = "operator";
    await caller().reconcileDFDField({ processId: "p1", fieldKey: "item:0123456789abcdef", expectedContentHash: "h", idempotencyKey: "k" });
    expect(vi.mocked(svc.reconcileDFDFieldDraft).mock.calls[0][0]).toMatchObject({ organizationId: 1, actorUserId: mockUser.id, fieldKey: "item:0123456789abcdef" });
    await caller().generateDFDJustification({ processId: "p1", expectedContentHash: "h", confirmReplace: true, idempotencyKey: "k2" });
    expect(vi.mocked(svc.generateDFDJustificationDraft).mock.calls[0][0]).toMatchObject({ organizationId: 1, actorUserId: mockUser.id, confirmReplace: true });
  });

  it("fieldKey fora do contrato é recusado na validação", async () => {
    await expect(caller().reconcileDFDField({ processId: "p1", fieldKey: "../../x", expectedContentHash: "h", idempotencyKey: "k" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("processo de OUTRO tenant → NOT_FOUND em leitura e escrita, sem resolver contexto", async () => {
    await expect(caller().canonicalContext({ processId: "p-outro" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller().dfdAssistState({ processId: "p-outro" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller().generateDFDJustification({ processId: "p-outro", expectedContentHash: "h", idempotencyKey: "k" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ctxSvc.resolveProcurementContext).not.toHaveBeenCalled();
    expect(svc.generateDFDJustificationDraft).not.toHaveBeenCalled();
  });
});

describe("Criar processo — unidade requisitante (opcional) como fato do contexto", () => {
  it("grava o fato (fonte Processo, confirmado, ator do ctx) NA MESMA transação da criação", async () => {
    vi.mocked(procDb.createProcessWithInitialEvent).mockImplementation(async (p: any, _e: any, withinTx?: any) => { await withinTx?.({ __tx: true }); return p; });
    const { process } = await caller().createProcess({ processNumber: "9/2026", object: "Objeto", startOption: "criar_dfd", requestingUnit: "  Secretaria de Saúde " });
    const rec = vi.mocked(ctxSvc.recordContextAssertions).mock.calls[0][0];
    expect(rec).toMatchObject({ organizationId: 1, processId: process.id, executor: { __tx: true } });
    expect(rec.facts).toEqual([expect.objectContaining({ path: "demand.requestingUnit", value: "Secretaria de Saúde", sourceType: "process", status: "confirmed", actorUserId: mockUser.id })]);
  });

  it("sem unidade: criação inalterada (nenhum fato gravado)", async () => {
    vi.mocked(procDb.createProcessWithInitialEvent).mockImplementation(async (p: any, _e: any, withinTx?: any) => { await withinTx?.({}); return p; });
    await caller().createProcess({ processNumber: "10/2026", object: "Objeto", startOption: "criar_dfd" });
    expect(vi.mocked(procDb.createProcessWithInitialEvent).mock.calls[0][2]).toBeUndefined();
    expect(ctxSvc.recordContextAssertions).not.toHaveBeenCalled();
  });
});

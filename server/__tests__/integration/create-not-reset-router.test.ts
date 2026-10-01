/**
 * R3 / PR-05 — routers `procurementProcess.createProcess` e `directProcurement.createProcess` com persistência
 * MOCKADA: a decisão pós-colisão (converge × CONFLICT) é tomada SÓ com leituras, no órgão do contexto, e devolve
 * o registro PERSISTIDO (nunca ecoa o pedido). O comportamento real está no smoke MySQL
 * `create-not-reset-processes-mysql-smoke.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/procurement");
vi.mock("../../db/directProcurement");
vi.mock("../../db/procurementContext");

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "operator", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: 1, userId: 1, role: "operator", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));

vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("fake-token"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import { directProcurementRouter } from "../../routers/directProcurementRouter";
import * as procDb from "../../db/procurement";
import * as directDb from "../../db/directProcurement";
import * as ctxDb from "../../db/procurementContext";
import { ProcessAlreadyExistsError, PROCUREMENT_PROCESS_ALREADY_EXISTS_MESSAGE, DIRECT_PROCUREMENT_ALREADY_EXISTS_MESSAGE } from "../../domain/processCreateContract";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { createDirectProcurementWorkspace } from "../../domain/directProcurementWorkspace";
import { makeContext, mockUser } from "../helpers/fixtures";

const ppInput = { processNumber: "100/2026", object: "Aquisição de notebooks", startOption: "criar_dfd" as const, requestingUnit: "Secretaria de Educação" };
const dpInput = { processNumber: "DP-1/2026", object: "Manutenção predial", procurementType: "dispensa" as const, startOption: "criar_dfd" as const };

const persistedPP = () => ({
  ...createProcurementWorkspace({ organizationId: 1, processNumber: "100/2026", object: "Aquisição de notebooks", startOption: "criar_dfd", responsibleUser: mockUser.id, correlationId: "orig" }),
  currentStage: "ISSUED" as const, status: "emitido" as const,
});
const createFact = (value: string) => ({
  id: 1, path: "demand.requestingUnit", value, valueHash: "h", sourceType: "process", sourceId: "x", sourceVersion: "create",
  status: "confirmed", actorUserId: mockUser.id, basisValueHash: null, createdAt: "2026-01-01T00:00:00.000Z",
}) as unknown as Awaited<ReturnType<typeof ctxDb.listContextFacts>>[number];

describe("R3 / PR-05 — procurementProcess.createProcess (persistência mockada)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(procDb.createProcessWithInitialEvent).mockImplementation(async (p) => p);
    vi.mocked(ctxDb.listContextFacts).mockResolvedValue([]);
  });

  it("criação nova ⇒ created: true", async () => {
    const out = await procurementProcessRouter.createCaller(makeContext(mockUser)).createProcess(ppInput);
    expect(out.created).toBe(true);
    expect(procDb.getProcess).not.toHaveBeenCalled();
  });

  it("colisão + mesma criação ⇒ devolve o registro PERSISTIDO (etapa preservada), created: false, sem escrita", async () => {
    const existing = persistedPP();
    vi.mocked(procDb.createProcessWithInitialEvent).mockRejectedValue(new ProcessAlreadyExistsError(existing.id));
    vi.mocked(procDb.getProcess).mockResolvedValue(existing);
    vi.mocked(ctxDb.listContextFacts).mockResolvedValue([createFact("Secretaria de Educação")]);
    const out = await procurementProcessRouter.createCaller(makeContext(mockUser)).createProcess(ppInput);
    expect(out).toEqual({ process: existing, created: false });
    expect(procDb.getProcess).toHaveBeenCalledWith(existing.id, 1); // lido NO órgão do contexto
    expect(procDb.recordProcessEvent).not.toHaveBeenCalled();
    expect(procDb.updateProcessStage).not.toHaveBeenCalled();
    expect(procDb.insertProcess).not.toHaveBeenCalled();
    expect(ctxDb.appendContextFacts).not.toHaveBeenCalled();
  });

  it("colisão + payload diferente ⇒ CONFLICT com mensagem estável, sem escrita", async () => {
    const existing = persistedPP();
    vi.mocked(procDb.createProcessWithInitialEvent).mockRejectedValue(new ProcessAlreadyExistsError(existing.id));
    vi.mocked(procDb.getProcess).mockResolvedValue(existing);
    vi.mocked(ctxDb.listContextFacts).mockResolvedValue([createFact("Secretaria de Educação")]);
    await expect(procurementProcessRouter.createCaller(makeContext(mockUser)).createProcess({ ...ppInput, object: "Outro" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: PROCUREMENT_PROCESS_ALREADY_EXISTS_MESSAGE });
    await expect(procurementProcessRouter.createCaller(makeContext({ ...mockUser, id: 99 })).createProcess(ppInput))
      .rejects.toMatchObject({ code: "CONFLICT" }); // outro ator
    expect(procDb.recordProcessEvent).not.toHaveBeenCalled();
    expect(ctxDb.appendContextFacts).not.toHaveBeenCalled();
  });

  it("colisão sem registro visível no órgão ⇒ CONFLICT (nunca cria nem expõe dado de outro órgão)", async () => {
    vi.mocked(procDb.createProcessWithInitialEvent).mockRejectedValue(new ProcessAlreadyExistsError("zzz"));
    vi.mocked(procDb.getProcess).mockResolvedValue(null);
    await expect(procurementProcessRouter.createCaller(makeContext(mockUser)).createProcess(ppInput))
      .rejects.toMatchObject({ code: "CONFLICT", message: PROCUREMENT_PROCESS_ALREADY_EXISTS_MESSAGE });
  });

  it("outros erros de persistência continuam INTERNAL_SERVER_ERROR com mensagem amigável", async () => {
    vi.mocked(procDb.createProcessWithInitialEvent).mockRejectedValue(new Error("db down"));
    await expect(procurementProcessRouter.createCaller(makeContext(mockUser)).createProcess(ppInput))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: expect.stringContaining("Não foi possível criar o processo") });
  });
});

describe("R3 / PR-05 — directProcurement.createProcess (persistência mockada)", () => {
  const persistedDP = () => ({
    ...createDirectProcurementWorkspace({ organizationId: 1, processNumber: "DP-1/2026", object: "Manutenção predial", procurementType: "dispensa", startOption: "criar_dfd", responsibleUser: mockUser.id, correlationId: "orig" }),
    currentStage: "RATIFICATION" as const, status: "ratificado" as const,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(directDb.createDirectProcurementWorkspaceWithInitialEvent).mockImplementation(async (ws) => ws);
  });

  it("criação nova usa o caminho estrito (nunca o upsert de salvar) ⇒ created: true", async () => {
    const out = await directProcurementRouter.createCaller(makeContext(mockUser)).createProcess(dpInput);
    expect(out.created).toBe(true);
    expect(directDb.createDirectProcurementWorkspaceWithInitialEvent).toHaveBeenCalledTimes(1);
    expect(directDb.insertDirectProcurementWorkspace).not.toHaveBeenCalled();
    expect(procDb.recordProcessEvent).not.toHaveBeenCalled(); // o evento inicial vai na MESMA transação do insert
  });

  it("colisão + mesma criação ⇒ devolve o workspace PERSISTIDO, created: false, sem escrita", async () => {
    const existing = persistedDP();
    vi.mocked(directDb.createDirectProcurementWorkspaceWithInitialEvent).mockRejectedValue(new ProcessAlreadyExistsError(existing.id));
    vi.mocked(directDb.getDirectProcurementWorkspace).mockResolvedValue(existing);
    const out = await directProcurementRouter.createCaller(makeContext(mockUser)).createProcess(dpInput);
    expect(out).toEqual({ workspace: existing, created: false });
    expect(directDb.getDirectProcurementWorkspace).toHaveBeenCalledWith(existing.id, 1);
    expect(directDb.insertDirectProcurementWorkspace).not.toHaveBeenCalled();
    expect(directDb.updateDirectProcurementStage).not.toHaveBeenCalled();
    expect(procDb.recordProcessEvent).not.toHaveBeenCalled();
  });

  it("colisão + payload diferente (tipo) ⇒ CONFLICT estável, sem escrita", async () => {
    const existing = persistedDP();
    vi.mocked(directDb.createDirectProcurementWorkspaceWithInitialEvent).mockRejectedValue(new ProcessAlreadyExistsError(existing.id));
    vi.mocked(directDb.getDirectProcurementWorkspace).mockResolvedValue(existing);
    await expect(directProcurementRouter.createCaller(makeContext(mockUser)).createProcess({ ...dpInput, procurementType: "inexigibilidade" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: DIRECT_PROCUREMENT_ALREADY_EXISTS_MESSAGE });
    expect(directDb.insertDirectProcurementWorkspace).not.toHaveBeenCalled();
    expect(procDb.recordProcessEvent).not.toHaveBeenCalled();
  });

  it("erro não relacionado a colisão é propagado (sem mascarar como CONFLICT)", async () => {
    vi.mocked(directDb.createDirectProcurementWorkspaceWithInitialEvent).mockRejectedValue(new Error("db down"));
    await expect(directProcurementRouter.createCaller(makeContext(mockUser)).createProcess(dpInput)).rejects.not.toMatchObject({ code: "CONFLICT" });
  });
});

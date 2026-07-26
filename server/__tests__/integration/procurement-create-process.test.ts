/**
 * PR B (homologação) — Teste do ROUTER canônico `procurementProcess.createProcess`.
 *
 * Cobre a criação com número "100/2026" + forma "Criar DFD do zero", a
 * idempotência (id determinístico → retry não duplica) e o tratamento do erro
 * real (falha de persistência → mensagem amigável pt-BR, SEM vazar o erro
 * técnico ao usuário; o técnico é logado no servidor). A persistência é mockada;
 * a regressão real de DATETIME é coberta pelo smoke MySQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/procurement");

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));

vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("fake-token"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import * as procDb from "../../db/procurement";
import { makeContext, mockUser } from "../helpers/fixtures";

const input = { processNumber: "100/2026", object: "Aquisição de Equipamentos de Informática", startOption: "criar_dfd" as const };

describe("procurementProcess.createProcess (PR B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(procDb.insertProcess).mockResolvedValue({} as any);
    vi.mocked(procDb.recordProcessEvent).mockResolvedValue(undefined as any);
  });

  it("cria processo com número 100/2026 e forma 'Criar DFD do zero'", async () => {
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const result = await caller.createProcess(input);

    expect(result.process.processNumber).toBe("100/2026");
    expect(result.process.startOption).toBe("criar_dfd");
    // criar_dfd NÃO pula etapa: começa em NEW_PROCESS (Adaptive Process Engine).
    expect(result.process.currentStage).toBe("NEW_PROCESS");
    expect(result.process.status).toBe("rascunho");
    expect(procDb.insertProcess).toHaveBeenCalledTimes(1);
    expect(procDb.recordProcessEvent).toHaveBeenCalledTimes(1);
  });

  it("gera processId determinístico → retry não cria duplicata (idempotência)", async () => {
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const a = await caller.createProcess(input);
    const b = await caller.createProcess(input);
    expect(a.process.id).toBe(b.process.id);
    expect(a.process.id.length).toBeGreaterThan(0);
  });

  it("preserva o processId retornado (mesmo id do workspace persistido)", async () => {
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const result = await caller.createProcess(input);
    const persisted = vi.mocked(procDb.insertProcess).mock.calls[0][0];
    expect(result.process.id).toBe(persisted.id);
  });

  it("falha de persistência → mensagem amigável pt-BR, sem vazar o erro técnico", async () => {
    vi.mocked(procDb.insertProcess).mockRejectedValue(new Error("Incorrect datetime value: '2026-07-26T23:40:16.123Z'"));
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));

    await expect(caller.createProcess(input)).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: expect.stringContaining("Não foi possível criar o processo"),
    });
    // O detalhe técnico (mensagem do MySQL) NÃO é exposto ao usuário.
    await expect(caller.createProcess(input)).rejects.not.toMatchObject({
      message: expect.stringContaining("datetime"),
    });
  });

  it("falha ao registrar evento também é tratada com mensagem amigável", async () => {
    vi.mocked(procDb.recordProcessEvent).mockRejectedValue(new Error("db down"));
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await expect(caller.createProcess(input)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("exige autenticação (UNAUTHORIZED) antes de qualquer gravação", async () => {
    await expect(
      procurementProcessRouter.createCaller(makeContext(null)).createProcess(input),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(procDb.insertProcess).not.toHaveBeenCalled();
  });
});

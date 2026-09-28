/**
 * PR-12 (SEM-023) — "Contrato vigente só muda por instrumento" — contrato de domínio + router (mockado).
 *
 * `contractWorkspace.updateContract` ("Salvar contrato"):
 *   - CAS de revisão: `expectedUpdatedAt` OBRIGATÓRIO; divergente ⇒ CONFLICT `CONTRACT_REVISION_CONFLICT`,
 *     zero escritas; CAS perdido na escrita (0 linhas) ⇒ CONFLICT;
 *   - fora de `minuta`, contractNumber/contractor/object/value/term ⇒ BAD_REQUEST
 *     `CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT`, zero escritas; manager/inspector seguem editáveis;
 *   - reenvio do MESMO valor (formulário inteiro) não conta como alteração;
 *   - máquina de estados inalterada; cross-tenant NOT_FOUND inalterado.
 * Persistência mockada; o smoke `pr12-contract-governed-change-mysql-smoke` cobre o MySQL real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

vi.mock("../../db/contractWorkspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/contractWorkspace")>();
  return { ...actual, getContractWorkspace: vi.fn(), compareAndSetContractWorkspace: vi.fn(), insertContractWorkspace: vi.fn() };
});
vi.mock("../../db/procurement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db/procurement")>();
  return { ...actual, recordProcessEvent: vi.fn() };
});

import { contractWorkspaceRouter } from "../../routers/contractWorkspaceRouter";
import * as repo from "../../db/contractWorkspace";
import * as procurement from "../../db/procurement";
import { makeContext, mockUser } from "../helpers/fixtures";
import {
  createContractWorkspace, updateContractFields, governedFieldChanges, assertContractFieldsEditable,
  pickEditableContractFields, nextContractRevision, isSameContractRevision,
  ContractEconomicFieldsRequireInstrumentError, CONTRACT_INSTRUMENT_GOVERNED_FIELDS, CONTRACT_FREELY_EDITABLE_FIELDS,
  CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT, CONTRACT_REVISION_CONFLICT, CONTRACT_DRAFT_STATUS,
  type ContractStatus, type ContractWorkspace,
} from "../../domain/contractWorkspace";

const REV = "2026-09-01T10:00:00.123Z";
const ALL_STATUSES: ContractStatus[] = ["minuta", "vigente", "aditado", "apostilado", "encerrado", "rescindido", "arquivado"];

function contract(status: ContractStatus, over: Partial<ContractWorkspace> = {}): ContractWorkspace {
  return {
    ...createContractWorkspace({
      organizationId: 1, originType: "avulso", contractNumber: "CT-PR12/001", contractor: "ACME LTDA",
      object: "Serviços de limpeza", value: 100000, term: "12 meses", manager: "Ana", inspector: "Bruno",
      status, correlationId: "corr-pr12", createdAt: REV,
    }),
    ...over,
  };
}

const caller = () => contractWorkspaceRouter.createCaller(makeContext(mockUser) as never);
const getWs = () => vi.mocked(repo.getContractWorkspace);
const cas = () => vi.mocked(repo.compareAndSetContractWorkspace);
const upsert = () => vi.mocked(repo.insertContractWorkspace);
const event = () => vi.mocked(procurement.recordProcessEvent);

function expectNoWrites() {
  expect(cas()).not.toHaveBeenCalled();
  expect(upsert()).not.toHaveBeenCalled();
  expect(event()).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  cas().mockResolvedValue(true);
  event().mockResolvedValue(undefined);
});

// ─── Domínio ──────────────────────────────────────────────────────────────────

describe("PR-12 · domínio — campos governados por instrumento", () => {
  it("lista explícita: econômicos/identidade × livres (decisão auditada SEM-023)", () => {
    expect([...CONTRACT_INSTRUMENT_GOVERNED_FIELDS]).toEqual(["contractNumber", "contractor", "object", "value", "term"]);
    expect([...CONTRACT_FREELY_EDITABLE_FIELDS]).toEqual(["manager", "inspector"]);
    expect(CONTRACT_DRAFT_STATUS).toBe("minuta");
  });

  it.each(ALL_STATUSES.filter(s => s !== "minuta"))("status %s: alterar valor/contratado/objeto/vigência/número ⇒ recusa com token", (status) => {
    const ws = contract(status);
    for (const [field, v] of [["value", 150000], ["contractor", "Outra SA"], ["object", "Outro objeto"], ["term", "24 meses"], ["contractNumber", "CT-X"]] as const) {
      let err: unknown;
      try { updateContractFields(ws, { [field]: v }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(ContractEconomicFieldsRequireInstrumentError);
      expect((err as Error).message).toContain(CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT);
      expect((err as ContractEconomicFieldsRequireInstrumentError).fields).toEqual([field]);
    }
  });

  it.each(ALL_STATUSES)("status %s: gestor/fiscal continuam editáveis", (status) => {
    const out = updateContractFields(contract(status), { manager: "Carla", inspector: "Davi" });
    expect(out.manager).toBe("Carla");
    expect(out.inspector).toBe("Davi");
  });

  it("minuta: campos econômicos editáveis (rascunho)", () => {
    const out = updateContractFields(contract("minuta"), { value: 150000, contractor: "Outra SA", object: "Novo", term: "6 meses" });
    expect(out).toMatchObject({ value: 150000, contractor: "Outra SA", object: "Novo", term: "6 meses" });
  });

  it("reenvio do valor persistido (formulário inteiro) não é alteração — inclusive valor em centavos equivalente", () => {
    const ws = contract("vigente", { value: 1234.5 });
    expect(governedFieldChanges(ws, { value: 1234.50, contractor: "ACME LTDA", object: "Serviços de limpeza", term: "12 meses", manager: "Nova" })).toEqual([]);
    expect(() => assertContractFieldsEditable(ws, { value: 1234.5, manager: "Nova" })).not.toThrow();
    expect(governedFieldChanges(ws, { value: 1234.51 })).toEqual(["value"]);
  });

  it("whitelist: patch não injeta status/id/organizationId/updatedAt", () => {
    const patch = { status: "arquivado", id: "x", organizationId: 99, updatedAt: "2000-01-01T00:00:00.000Z", expectedUpdatedAt: REV, manager: "M" };
    expect(pickEditableContractFields(patch)).toEqual({ manager: "M" });
    const out = updateContractFields(contract("minuta"), patch as never, "2026-09-02T00:00:00.000Z");
    expect(out).toMatchObject({ status: "minuta", id: contract("minuta").id, organizationId: 1, manager: "M", updatedAt: "2026-09-02T00:00:00.000Z" });
    expect(out).not.toHaveProperty("expectedUpdatedAt");
  });

  it("revisão: comparação por instante; próxima revisão sempre ESTRITAMENTE posterior à esperada", () => {
    expect(isSameContractRevision("2026-09-01T10:00:00.123Z", "2026-09-01T10:00:00.123Z")).toBe(true);
    expect(isSameContractRevision("2026-09-01T10:00:00.123Z", "2026-09-01T10:00:00.124Z")).toBe(false);
    expect(isSameContractRevision("lixo", "lixo")).toBe(false);
    // relógio "atrasado"/mesmo milissegundo ⇒ expected + 1ms
    expect(nextContractRevision(REV, new Date(REV))).toBe("2026-09-01T10:00:00.124Z");
    expect(nextContractRevision(REV, new Date("2020-01-01T00:00:00.000Z"))).toBe("2026-09-01T10:00:00.124Z");
    expect(nextContractRevision(REV, new Date("2026-09-05T00:00:00.000Z"))).toBe("2026-09-05T00:00:00.000Z");
  });
});

// ─── Router ───────────────────────────────────────────────────────────────────

describe("PR-12 · contractWorkspace.updateContract — CAS + campos econômicos", () => {
  it("expectedUpdatedAt é OBRIGATÓRIO (sem ele não há CAS) ⇒ BAD_REQUEST de input, zero escritas", async () => {
    getWs().mockResolvedValue(contract("minuta"));
    await expect(caller().updateContract({ contractId: "c", manager: "X" } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expectNoWrites();
  });

  it("revisão divergente ⇒ CONFLICT CONTRACT_REVISION_CONFLICT, zero escritas", async () => {
    getWs().mockResolvedValue(contract("minuta", { updatedAt: "2026-09-01T10:00:05.000Z" }));
    const p = caller().updateContract({ contractId: "c", expectedUpdatedAt: REV, manager: "X" });
    await expect(p).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p).rejects.toThrow(CONTRACT_REVISION_CONFLICT);
    expectNoWrites();
  });

  it("revisão divergente vence a checagem econômica (recarregar primeiro), zero escritas", async () => {
    getWs().mockResolvedValue(contract("vigente", { updatedAt: "2026-09-01T10:00:05.000Z" }));
    await expect(caller().updateContract({ contractId: "c", expectedUpdatedAt: REV, value: 1 })).rejects.toMatchObject({ code: "CONFLICT" });
    expectNoWrites();
  });

  it.each(["vigente", "aditado", "apostilado", "encerrado", "rescindido", "arquivado"] as const)(
    "contrato %s: alterar valor ⇒ BAD_REQUEST CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT, zero escritas", async (status) => {
      getWs().mockResolvedValue(contract(status));
      const p = caller().updateContract({ contractId: "c", expectedUpdatedAt: REV, value: 999999 });
      await expect(p).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(p).rejects.toThrow(CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT);
      await expect(p).rejects.toThrow(/Termo Aditivo ou Apostilamento/);
      expectNoWrites();
    });

  it("contrato vigente: trocar contratado/objeto/vigência ⇒ recusa, zero escritas", async () => {
    getWs().mockResolvedValue(contract("vigente"));
    for (const patch of [{ contractor: "Outra SA" }, { object: "Outro" }, { term: "36 meses" }, { contractNumber: "CT-NOVO" }]) {
      await expect(caller().updateContract({ contractId: "c", expectedUpdatedAt: REV, ...patch })).rejects.toThrow(CONTRACT_ECONOMIC_FIELDS_REQUIRE_INSTRUMENT);
    }
    expectNoWrites();
  });

  it("minuta: mesma alteração econômica é permitida — grava por CAS com a revisão esperada + evento antes/depois", async () => {
    getWs().mockResolvedValue(contract("minuta"));
    const { workspace } = await caller().updateContract({ contractId: "c", expectedUpdatedAt: REV, value: 150000, contractor: "Outra SA" });
    expect(workspace).toMatchObject({ value: 150000, contractor: "Outra SA", status: "minuta" });
    expect(Date.parse(workspace.updatedAt)).toBeGreaterThan(Date.parse(REV));
    expect(cas()).toHaveBeenCalledTimes(1);
    expect(cas().mock.calls[0][1]).toBe(REV);
    expect(cas().mock.calls[0][0]).toMatchObject({ value: 150000, contractor: "Outra SA", updatedAt: workspace.updatedAt });
    expect(upsert()).not.toHaveBeenCalled(); // o save nunca mais é upsert cego
    expect(event()).toHaveBeenCalledTimes(1);
    const ev = event().mock.calls[0][0];
    expect(ev).toMatchObject({ eventType: "change", actor: `user:${mockUser.id}`, processId: workspace.id, organizationId: 1 });
    expect(ev.summary).toContain('value: "100000" → "150000"');
    expect(ev.summary).toContain('contractor: "ACME LTDA" → "Outra SA"');
  });

  it("contrato vigente: alteração NÃO econômica (gestor/fiscal) é permitida, com CAS, reenviando o formulário inteiro", async () => {
    getWs().mockResolvedValue(contract("vigente"));
    const { workspace } = await caller().updateContract({
      contractId: "c", expectedUpdatedAt: REV, manager: "Carla", inspector: "Davi",
      contractor: "ACME LTDA", object: "Serviços de limpeza", term: "12 meses", value: 100000,
    });
    expect(workspace).toMatchObject({ manager: "Carla", inspector: "Davi", value: 100000, status: "vigente" });
    expect(cas()).toHaveBeenCalledTimes(1);
    expect(cas().mock.calls[0][1]).toBe(REV);
    expect(event().mock.calls[0][0].summary).toContain('manager: "Ana" → "Carla"');
  });

  it("CAS perdido na escrita (0 linhas casam — outro save venceu) ⇒ CONFLICT, sem evento", async () => {
    getWs().mockResolvedValue(contract("vigente"));
    cas().mockResolvedValue(false);
    const p = caller().updateContract({ contractId: "c", expectedUpdatedAt: REV, manager: "Carla" });
    await expect(p).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(p).rejects.toThrow(CONTRACT_REVISION_CONFLICT);
    expect(event()).not.toHaveBeenCalled();
  });

  it("falha do timeline APÓS o CAS vencer não vira erro (a edição já foi gravada)", async () => {
    getWs().mockResolvedValue(contract("vigente"));
    event().mockRejectedValue(new Error("timeline down"));
    const { workspace } = await caller().updateContract({ contractId: "c", expectedUpdatedAt: REV, manager: "Carla" });
    expect(workspace.manager).toBe("Carla");
  });

  it("cross-tenant/inexistente ⇒ NOT_FOUND inalterado, zero escritas", async () => {
    getWs().mockResolvedValue(null);
    await expect(caller().updateContract({ contractId: "de-outra-org", expectedUpdatedAt: REV, manager: "X" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expectNoWrites();
  });

  it("máquina de estados inalterada: minuta → vigente permitido (via CAS); minuta → encerrado recusado sem escrita", async () => {
    getWs().mockResolvedValue(contract("minuta"));
    const { workspace } = await caller().updateContract({ contractId: "c", expectedUpdatedAt: REV, status: "vigente", value: 120000 });
    expect(workspace).toMatchObject({ status: "vigente", value: 120000 });
    expect(Date.parse(workspace.updatedAt)).toBeGreaterThan(Date.parse(REV));
    expect(cas().mock.calls[0][0]).toMatchObject({ status: "vigente" });

    vi.clearAllMocks();
    getWs().mockResolvedValue(contract("minuta"));
    await expect(caller().updateContract({ contractId: "c", expectedUpdatedAt: REV, status: "encerrado" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Transição de contrato inválida: minuta → encerrado" });
    expectNoWrites();
  });
});

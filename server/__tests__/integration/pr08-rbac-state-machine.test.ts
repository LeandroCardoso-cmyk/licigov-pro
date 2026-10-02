/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR-08 — Paridade RBAC (SEM-026) e máquina de estados do contrato (SEM-025). Contrato SEM banco (mocks).
 *
 * SEM-026:
 *   - `itemIntelligence.decidirCATMAT` exige papel mínimo `operator` (paridade com a aprovação canônica
 *     `procurementProcess.approveItem`): viewer é recusado ANTES de qualquer leitura/escrita; operator decide,
 *     com o organizationId SEMPRE do contexto.
 *   - `itemIntelligence.approveItem` (rota duplicada, sem caller de UI) está DESLIGADA de forma governada:
 *     continua registrada com o MESMO input, e toda chamada — de qualquer papel — recebe FORBIDDEN com o token
 *     `LEGACY_ENDPOINT_DISABLED`, sem tocar serviço/DB.
 * SEM-025:
 *   - `planInstrumentStatusChange` só admite o que a máquina `STATUS_TRANSITIONS` define (+ "status igual", que
 *     não é transição). Rev. 2 (decisão do responsável pelo produto): SEM exceção para `minuta` — aditivo/
 *     apostilamento em contrato não formalizado é recusado (BAD_REQUEST `CONTRACT_STATUS_TRANSITION_INVALID`,
 *     zero efeitos); estados encerrado/rescindido/arquivado nunca reabrem; instrumentos sucessivos são admitidos
 *     em vigente/aditado/apostilado; parecer exigido pelo próprio fluxo e ausente ⇒ status NÃO efetivado.
 *   - `createAddendum`/`createApostille` recusam ANTES de qualquer efeito (sem contagem, escrita, IA, evento);
 *     corrida perdida no compare-and-set ⇒ ROLLBACK e recusa estável; router mapeia BAD_REQUEST/CONFLICT.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const role = vi.hoisted(() => ({ value: "viewer" as string, org: 1 }));

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: role.org,
    membership: { id: 1, organizationId: role.org, userId: 1, role: role.value, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
vi.mock("../../services/featureFlagService", () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(true) }));

// ─── SEM-026: dependências do itemIntelligenceRouter ─────────────────────────
const item = vi.hoisted(() => ({
  getIntelligentItem: vi.fn(async () => ({ id: "i1", processId: "p1", description: "Caneta", updatedAt: "2026-01-01T00:00:00.000Z" })),
  listCatmatMatches: vi.fn(async () => []),
  updateItemCatmat: vi.fn(async () => true),
  recordProcessEvent: vi.fn(async () => undefined),
  applyGovernedItemTransition: vi.fn(async () => ({ success: true, itemId: "i1", status: "aprovado" })),
  decideCatmat: vi.fn(async () => ({ decision: { catmatCode: "654321" }, replayed: false })),
}));
vi.mock("../../db/procurement", async (orig) => ({
  ...(await orig<typeof import("../../db/procurement")>()),
  getIntelligentItem: item.getIntelligentItem,
  listCatmatMatches: item.listCatmatMatches,
  updateItemCatmat: item.updateItemCatmat,
  recordProcessEvent: item.recordProcessEvent,
}));
vi.mock("../../services/itemIntelligenceService", async (orig) => ({
  ...(await orig<typeof import("../../services/itemIntelligenceService")>()),
  applyGovernedItemTransition: item.applyGovernedItemTransition,
}));
vi.mock("../../services/catmatGovernanceService", () => ({ decideCatmat: item.decideCatmat }));

// ─── SEM-025: dependências do contractService ────────────────────────────────
const cw = vi.hoisted(() => ({
  status: "vigente" as string,
  freshStatus: null as string | null,
  casResult: true,
  getContractWorkspace: vi.fn(),
  countContractAddenda: vi.fn(async () => 0),
  countContractApostilles: vi.fn(async () => 0),
  insertContractAddendum: vi.fn(async (a: unknown) => a),
  insertContractApostille: vi.fn(async (a: unknown) => a),
  compareAndSetContractWorkspaceStatus: vi.fn(),
  insertContractWsDocument: vi.fn(async (d: unknown) => d),
  orchestrateMultiCopilot: vi.fn(async () => ({ consolidated: { suggestions: ["s"], legalBasis: ["Lei 14.133/2021"], confidence: 0.5, summary: "r" }, selectedCopilots: ["contratos"] })),
  generateOfficialDocument: vi.fn(async () => ({ id: "off-1" })),
  transaction: vi.fn(),
}));
vi.mock("../../db/contractWorkspace", async (orig) => ({
  ...(await orig<typeof import("../../db/contractWorkspace")>()),
  getContractWorkspace: cw.getContractWorkspace,
  countContractAddenda: cw.countContractAddenda,
  countContractApostilles: cw.countContractApostilles,
  insertContractAddendum: cw.insertContractAddendum,
  insertContractApostille: cw.insertContractApostille,
  compareAndSetContractWorkspaceStatus: cw.compareAndSetContractWorkspaceStatus,
  insertContractWsDocument: cw.insertContractWsDocument,
}));
vi.mock("../../services/workspaceOrchestratorService", () => ({ orchestrateMultiCopilot: cw.orchestrateMultiCopilot }));
vi.mock("../../services/documentEngineService", () => ({ generateOfficialDocument: cw.generateOfficialDocument }));
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => ({ transaction: cw.transaction })) }));

import { itemIntelligenceRouter } from "../../routers/itemIntelligenceRouter";
import { contractWorkspaceRouter } from "../../routers/contractWorkspaceRouter";
import {
  planInstrumentStatusChange, ContractStatusTransitionError, canContractTransition, transitionContractStatus,
  createContractWorkspace, CONTRACT_STATUS_TRANSITION_INVALID, type ContractStatus,
} from "../../domain/contractWorkspace";
import { createAddendum, createApostille, ContractStatusConflictError } from "../../services/contractService";
import { LEGACY_ENDPOINT_DISABLED } from "../../services/legacyEndpointGuard";
import { makeContext, mockUser } from "../helpers/fixtures";

const ii = () => itemIntelligenceRouter.createCaller(makeContext(mockUser) as any);
const cwr = () => contractWorkspaceRouter.createCaller(makeContext(mockUser) as any);

async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try { await p; return null; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
}

const ALL_ROLES = ["viewer", "operator", "manager", "admin", "owner"] as const;
const STATUSES: ContractStatus[] = ["minuta", "vigente", "aditado", "apostilado", "encerrado", "rescindido", "arquivado"];
const CLOSED: ContractStatus[] = ["encerrado", "rescindido", "arquivado"];
/** Estados que NÃO admitem aditivo/apostilamento (rev. 2: `minuta` incluída — sem exceção). */
const REFUSING: ContractStatus[] = ["minuta", ...CLOSED];

function contractWith(status: string) {
  return { ...createContractWorkspace({ organizationId: role.org, originType: "avulso", contractNumber: "CT-PR08", correlationId: "c" }), status };
}

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "viewer"; role.org = 1;
  cw.status = "vigente"; cw.freshStatus = null; cw.casResult = true;
  let reads = 0;
  cw.getContractWorkspace.mockImplementation(async () => {
    reads += 1;
    return contractWith(reads > 1 && cw.freshStatus ? cw.freshStatus : cw.status);
  });
  cw.compareAndSetContractWorkspaceStatus.mockImplementation(async () => cw.casResult);
  // Transação simulada: o callback roda com um "tx" sentinela; exceção ⇒ rollback (propaga).
  cw.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({ __tx: true }));
});

// ════════════════════════════════════════════════════════════════════════════
describe("SEM-026 — itemIntelligence.decidirCATMAT exige operator (paridade RBAC)", () => {
  const input = { itemId: "i1", decision: "substituido", idempotencyKey: "k".repeat(12), catmatCode: "654321", justification: "Código correto do catálogo." };

  it("viewer é recusado (FORBIDDEN) ANTES de qualquer leitura/escrita/evento", async () => {
    const e = await err(ii().decidirCATMAT(input));
    expect(e?.code).toBe("FORBIDDEN");
    expect(e?.message).toContain("operator");
    expect(item.getIntelligentItem).not.toHaveBeenCalled();
    expect(item.decideCatmat).not.toHaveBeenCalled();
    expect(item.updateItemCatmat).not.toHaveBeenCalled();
    expect(item.recordProcessEvent).not.toHaveBeenCalled();
  });

  it("operator (e acima) decide — organizationId SEMPRE do contexto autenticado", async () => {
    for (const r of ["operator", "manager", "admin", "owner"]) {
      vi.clearAllMocks();
      role.value = r; role.org = 77;
      const res = await ii().decidirCATMAT(input);
      expect(res.success).toBe(true);
      expect(item.decideCatmat).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 77, itemId: "i1", decision: "substituido" }));
      expect(item.updateItemCatmat).toHaveBeenCalledWith("i1", 77, "654321", expect.any(String));
    }
  });

  it("paridade: mesmo papel mínimo da aprovação canônica e dos demais comandos CATMAT", async () => {
    for (const call of [
      () => ii().decidirCATMAT(input),
      () => ii().acceptCATMAT({ itemId: "i1", matchId: "m1", catmatCode: "1" }),
      () => ii().rejectCATMAT({ matchId: "m1" }),
      () => ii().manualCATMAT({ itemId: "i1", catmatCode: "1" }),
    ]) {
      expect((await err(call()))?.code).toBe("FORBIDDEN");
    }
  });

  it("leituras continuam abertas ao viewer do próprio tenant", async () => {
    await ii().getCATMATDecisions({ itemId: "i1" }).catch(() => undefined);
    const e = await err(ii().getCATMATSuggestions({ itemId: "i1" }));
    expect(e).toBeNull();
    expect(item.getIntelligentItem).toHaveBeenCalledWith("i1", 1);
  });
});

describe("SEM-026 — itemIntelligence.approveItem desligado de forma governada (rota duplicada)", () => {
  it.each(ALL_ROLES)("papel %s ⇒ FORBIDDEN LEGACY_ENDPOINT_DISABLED, sem tocar serviço/DB", async (r) => {
    role.value = r;
    const e = await err(ii().approveItem({ itemId: "i1" }));
    expect(e?.code).toBe("FORBIDDEN");
    expect(e?.message).toContain(LEGACY_ENDPOINT_DISABLED);
    expect(e?.message).toContain("procurementProcess.approveItem");
    expect(item.applyGovernedItemTransition).not.toHaveBeenCalled();
    expect(item.getIntelligentItem).not.toHaveBeenCalled();
    expect(item.recordProcessEvent).not.toHaveBeenCalled();
  });

  it("freeze: procedure segue registrada e o input schema é o MESMO (itemId obrigatório)", async () => {
    const procs = (itemIntelligenceRouter as any)._def.procedures as Record<string, any>;
    expect(procs.approveItem).toBeDefined();
    expect(procs.approveItem._def.type).toBe("mutation");
    expect(procs.approveItem._def.inputs).toHaveLength(1);
    role.value = "owner";
    // Input inválido continua sendo rejeitado pelo MESMO schema (antes do handler).
    expect((await err(ii().approveItem({ itemId: "" })))?.code).toBe("BAD_REQUEST");
  });
});

// ════════════════════════════════════════════════════════════════════════════
describe("SEM-025 — planInstrumentStatusChange só admite o que a máquina define", () => {
  it("tabela completa: status × instrumento", () => {
    const expected: Record<ContractStatus, Record<"aditivo" | "apostilamento", string>> = {
      minuta:     { aditivo: "REFUSED",   apostilamento: "REFUSED" }, // rev. 2: exceção removida
      vigente:    { aditivo: "machine",   apostilamento: "machine" },
      aditado:    { aditivo: "unchanged", apostilamento: "machine" },
      apostilado: { aditivo: "machine",   apostilamento: "unchanged" },
      encerrado:  { aditivo: "REFUSED",   apostilamento: "REFUSED" },
      rescindido: { aditivo: "REFUSED",   apostilamento: "REFUSED" },
      arquivado:  { aditivo: "REFUSED",   apostilamento: "REFUSED" },
    };
    for (const s of STATUSES) {
      for (const inst of ["aditivo", "apostilamento"] as const) {
        let got: string;
        try { got = planInstrumentStatusChange(s, inst).mode; } catch (e) {
          expect(e).toBeInstanceOf(ContractStatusTransitionError);
          got = "REFUSED";
        }
        expect(`${s}/${inst}=${got}`).toBe(`${s}/${inst}=${expected[s][inst]}`);
      }
    }
  });

  it("parecer exigido pelo fluxo ⇒ `deferred_pending_legal_opinion` (to === from) só onde o instrumento é admissível", () => {
    for (const s of STATUSES) {
      for (const inst of ["aditivo", "apostilamento"] as const) {
        let got: string;
        try {
          const plan = planInstrumentStatusChange(s, inst, { requiresLegalOpinion: true });
          expect(plan.to).toBe(s); // status do contrato NÃO efetivado
          expect(plan.instrumentStatus).toBe(inst === "aditivo" ? "aditado" : "apostilado");
          got = plan.mode;
        } catch (e) {
          expect(e).toBeInstanceOf(ContractStatusTransitionError);
          got = "REFUSED";
        }
        const expected = REFUSING.includes(s) ? "REFUSED" : "deferred_pending_legal_opinion";
        expect(`${s}/${inst}=${got}`).toBe(`${s}/${inst}=${expected}`);
      }
    }
    // Sem a flag (ou false) o plano é o da máquina — a flag nunca é inferida por default.
    expect(planInstrumentStatusChange("vigente", "aditivo").mode).toBe("machine");
    expect(planInstrumentStatusChange("vigente", "aditivo", { requiresLegalOpinion: false }).mode).toBe("machine");
  });

  it("minuta → aditado/apostilado NÃO está na máquina e não há exceção (rev. 2)", () => {
    expect(canContractTransition("minuta", "aditado")).toBe(false);
    expect(canContractTransition("minuta", "apostilado")).toBe(false);
    expect(() => planInstrumentStatusChange("minuta", "aditivo")).toThrow("Transição de contrato inválida: minuta → aditado");
    expect(() => planInstrumentStatusChange("minuta", "apostilamento")).toThrow("Transição de contrato inválida: minuta → apostilado");
  });

  it("`machine` ⇔ a transição existe em STATUS_TRANSITIONS (nenhuma regra nova inventada)", () => {
    for (const s of STATUSES) {
      for (const inst of ["aditivo", "apostilamento"] as const) {
        const to = inst === "aditivo" ? "aditado" : "apostilado";
        let mode: string | null = null;
        try { mode = planInstrumentStatusChange(s, inst).mode; } catch { mode = null; }
        expect(mode === "machine").toBe(s !== to && canContractTransition(s, to));
      }
    }
  });

  it("status desconhecido é fail-closed e a mensagem da máquina é preservada", () => {
    expect(canContractTransition("inexistente" as ContractStatus, "aditado")).toBe(false);
    expect(() => planInstrumentStatusChange("inexistente" as ContractStatus, "aditivo")).toThrow(ContractStatusTransitionError);
    const ws = contractWith("rescindido") as any;
    expect(() => transitionContractStatus(ws, "vigente")).toThrow("Transição de contrato inválida: rescindido → vigente");
    try { transitionContractStatus(ws, "vigente"); } catch (e: any) { expect(e.code).toBe(CONTRACT_STATUS_TRANSITION_INVALID); }
  });
});

describe("SEM-025 — createAddendum/createApostille recusam minuta e estados encerrados SEM nenhum efeito", () => {
  it.each(REFUSING)("contrato %s: aditivo e apostilamento recusados antes de contar/gravar/gerar/registrar", async (status) => {
    cw.status = status;
    await expect(createAddendum({ organizationId: 1, contractId: "c1", addendumType: "prazo", justification: "j", correlationId: "c" }))
      .rejects.toBeInstanceOf(ContractStatusTransitionError);
    await expect(createApostille({ organizationId: 1, contractId: "c1", kind: "gestor", newManager: "Maria", correlationId: "c" }))
      .rejects.toBeInstanceOf(ContractStatusTransitionError);
    for (const fn of [cw.countContractAddenda, cw.countContractApostilles, cw.insertContractAddendum, cw.insertContractApostille,
      cw.compareAndSetContractWorkspaceStatus, cw.transaction, cw.orchestrateMultiCopilot, cw.generateOfficialDocument,
      cw.insertContractWsDocument, item.recordProcessEvent]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("router: BAD_REQUEST com a mensagem da máquina + token estável; nada escrito", async () => {
    role.value = "owner"; cw.status = "rescindido";
    const a = await err(cwr().createAddendum({ contractId: "c1", addendumType: "valor", justification: "j", newValue: 10 }));
    expect(a?.code).toBe("BAD_REQUEST");
    expect(a?.message).toContain("Transição de contrato inválida: rescindido → aditado");
    expect(a?.message).toContain(CONTRACT_STATUS_TRANSITION_INVALID);
    const p = await err(cwr().createApostille({ contractId: "c1", kind: "reajuste", newValue: 10 }));
    expect(p?.code).toBe("BAD_REQUEST");
    expect(p?.message).toContain("rescindido → apostilado");
    expect(cw.insertContractAddendum).not.toHaveBeenCalled();
    expect(cw.insertContractApostille).not.toHaveBeenCalled();
    expect(cw.orchestrateMultiCopilot).not.toHaveBeenCalled();
  });

  it("router: contrato em minuta ⇒ BAD_REQUEST CONTRACT_STATUS_TRANSITION_INVALID; sem linha, IA, minuta, CAS ou timeline", async () => {
    role.value = "owner"; cw.status = "minuta";
    const a = await err(cwr().createAddendum({ contractId: "c1", addendumType: "prazo", justification: "Prorrogação", newTerm: "18 meses" }));
    expect(a?.code).toBe("BAD_REQUEST");
    expect(a?.message).toContain("Transição de contrato inválida: minuta → aditado");
    expect(a?.message).toContain(CONTRACT_STATUS_TRANSITION_INVALID);
    const p = await err(cwr().createApostille({ contractId: "c1", kind: "gestor", newManager: "Maria" }));
    expect(p?.code).toBe("BAD_REQUEST");
    expect(p?.message).toContain("minuta → apostilado");
    expect(p?.message).toContain(CONTRACT_STATUS_TRANSITION_INVALID);
    for (const fn of [cw.countContractAddenda, cw.countContractApostilles, cw.insertContractAddendum, cw.insertContractApostille,
      cw.compareAndSetContractWorkspaceStatus, cw.transaction, cw.orchestrateMultiCopilot, cw.generateOfficialDocument,
      cw.insertContractWsDocument, item.recordProcessEvent]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});

describe("SEM-025 — transições válidas: instrumento + status + evento na MESMA transação, CAS a partir do status avaliado", () => {
  it("vigente → aditado: aditivo final e CAS vigente→aditado no tx; minuta gerada DEPOIS", async () => {
    cw.status = "vigente";
    const res = await createAddendum({ organizationId: 1, contractId: "c1", addendumType: "prazo", justification: "Prorrogação", newTerm: "18 meses", correlationId: "c" });
    expect(res.addendum?.status).toBe("finalizado");
    expect(cw.insertContractAddendum).toHaveBeenCalledWith(expect.objectContaining({ status: "finalizado" }), { __tx: true }, { failOnDuplicate: true });
    expect(cw.compareAndSetContractWorkspaceStatus).toHaveBeenCalledWith(expect.objectContaining({ fromStatus: "vigente", toStatus: "aditado", orgId: 1 }), { __tx: true });
    expect(item.recordProcessEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "change" }), { __tx: true });
    expect(cw.orchestrateMultiCopilot).toHaveBeenCalledTimes(1);
    expect(cw.insertContractAddendum.mock.invocationCallOrder[0]).toBeLessThan(cw.orchestrateMultiCopilot.mock.invocationCallOrder[0]);
  });

  it("aditivo que o fluxo marca como exigindo parecer ⇒ aguardando_parecer e status do contrato NÃO efetivado (CAS vigente→vigente)", async () => {
    for (const addendumType of ["valor", "quantitativo"] as const) {
      vi.clearAllMocks();
      const res = await createAddendum({ organizationId: 1, contractId: "c1", addendumType, justification: "Acréscimo", newValue: 10, correlationId: "c" });
      expect(res.requiresLegalOpinion).toBe(true);
      expect(res.addendum?.status).toBe("aguardando_parecer");
      expect(cw.insertContractAddendum).toHaveBeenCalledWith(expect.objectContaining({ status: "aguardando_parecer" }), { __tx: true }, { failOnDuplicate: true });
      expect(cw.compareAndSetContractWorkspaceStatus).toHaveBeenCalledWith(expect.objectContaining({ fromStatus: "vigente", toStatus: "vigente" }), { __tx: true });
      expect(item.recordProcessEvent).toHaveBeenCalledWith(expect.objectContaining({ summary: expect.stringContaining("status do contrato mantido (vigente)") }), { __tx: true });
    }
  });

  it("aditivo que NÃO exige parecer (prazo/qualitativo) segue efetivando pela máquina", async () => {
    for (const addendumType of ["prazo", "qualitativo"] as const) {
      vi.clearAllMocks();
      const res = await createAddendum({ organizationId: 1, contractId: "c1", addendumType, justification: "j", correlationId: "c" });
      expect(res.requiresLegalOpinion).toBe(false);
      expect(res.addendum?.status).toBe("finalizado");
      expect(cw.compareAndSetContractWorkspaceStatus).toHaveBeenCalledWith(expect.objectContaining({ fromStatus: "vigente", toStatus: "aditado" }), { __tx: true });
    }
  });

  it("parecer exigido em contrato recusante ⇒ recusa continua (a flag nunca abre estado não admissível)", async () => {
    for (const status of REFUSING) {
      cw.status = status;
      await expect(createAddendum({ organizationId: 1, contractId: "c1", addendumType: "valor", justification: "j", newValue: 1, correlationId: "c" }))
        .rejects.toBeInstanceOf(ContractStatusTransitionError);
    }
    expect(cw.insertContractAddendum).not.toHaveBeenCalled();
    expect(cw.transaction).not.toHaveBeenCalled();
  });

  it("aditado + 2º aditivo ⇒ status inalterado (CAS aditado→aditado); apostilado → aditado pela máquina", async () => {
    cw.status = "aditado";
    await createAddendum({ organizationId: 1, contractId: "c1", addendumType: "prazo", justification: "j", correlationId: "c" });
    expect(cw.compareAndSetContractWorkspaceStatus).toHaveBeenLastCalledWith(expect.objectContaining({ fromStatus: "aditado", toStatus: "aditado" }), { __tx: true });
    cw.status = "apostilado";
    await createAddendum({ organizationId: 1, contractId: "c1", addendumType: "prazo", justification: "j", correlationId: "c" });
    expect(cw.compareAndSetContractWorkspaceStatus).toHaveBeenLastCalledWith(expect.objectContaining({ fromStatus: "apostilado", toStatus: "aditado" }), { __tx: true });
  });

  it("cadeia de instrumentos sucessivos: vigente → aditivo → aditivo → apostilamento → aditivo → apostilamento", async () => {
    // O mock de CAS aplica o status (como o banco): cada passo parte do status resultante do anterior.
    cw.compareAndSetContractWorkspaceStatus.mockImplementation(async (p: { fromStatus: string; toStatus: string }) => {
      if (p.fromStatus !== cw.status) return false;
      cw.status = p.toStatus; return true;
    });
    cw.status = "vigente";
    const steps: Array<[string, () => Promise<unknown>]> = [
      ["aditado",    () => createAddendum({ organizationId: 1, contractId: "c1", addendumType: "prazo", justification: "1", correlationId: "c" })],
      ["aditado",    () => createAddendum({ organizationId: 1, contractId: "c1", addendumType: "qualitativo", justification: "2", correlationId: "c" })],
      ["apostilado", () => createApostille({ organizationId: 1, contractId: "c1", kind: "reajuste", newValue: 5, correlationId: "c" })],
      ["aditado",    () => createAddendum({ organizationId: 1, contractId: "c1", addendumType: "prazo", justification: "3", correlationId: "c" })],
      ["apostilado", () => createApostille({ organizationId: 1, contractId: "c1", kind: "fiscal", newInspector: "João", correlationId: "c" })],
      ["apostilado", () => createApostille({ organizationId: 1, contractId: "c1", kind: "gestor", newManager: "Ana", correlationId: "c" })],
      ["apostilado", () => createAddendum({ organizationId: 1, contractId: "c1", addendumType: "valor", justification: "4", newValue: 9, correlationId: "c" })], // parecer ⇒ inalterado
    ];
    for (const [expected, run] of steps) {
      await run();
      expect(cw.status).toBe(expected);
    }
    expect(cw.insertContractAddendum).toHaveBeenCalledTimes(4);
    expect(cw.insertContractApostille).toHaveBeenCalledTimes(3);
  });
});

describe("SEM-025 — corrida: contrato muda de status durante a operação", () => {
  it("rescindido em paralelo: CAS não casa ⇒ rollback, recusa da máquina contra o status REAL, sem minuta", async () => {
    cw.status = "vigente"; cw.freshStatus = "rescindido"; cw.casResult = false;
    await expect(createAddendum({ organizationId: 1, contractId: "c1", addendumType: "prazo", justification: "j", correlationId: "c" }))
      .rejects.toThrow("Transição de contrato inválida: rescindido → aditado");
    expect(item.recordProcessEvent).not.toHaveBeenCalled(); // evento só após CAS vencedor
    expect(cw.orchestrateMultiCopilot).not.toHaveBeenCalled(); // nenhuma minuta de instrumento não persistido
    expect(cw.generateOfficialDocument).not.toHaveBeenCalled();
  });

  it("instrumento concorrente com a MESMA sequência ⇒ ER_DUP_ENTRY no INSERT puro ⇒ rollback + CONFLICT (sem linha híbrida)", async () => {
    cw.status = "aditado";
    const dup = Object.assign(new Error("Failed query"), { cause: Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY", errno: 1062 }) });
    cw.insertContractAddendum.mockRejectedValueOnce(dup);
    const e = await createAddendum({ organizationId: 1, contractId: "c1", addendumType: "prazo", justification: "j", correlationId: "c" }).then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(ContractStatusConflictError);
    expect((e as ContractStatusConflictError).reason).toBe("sequence");
    expect(cw.compareAndSetContractWorkspaceStatus).not.toHaveBeenCalled();
    expect(item.recordProcessEvent).not.toHaveBeenCalled();
    expect(cw.orchestrateMultiCopilot).not.toHaveBeenCalled();
    role.value = "owner";
    cw.insertContractApostille.mockRejectedValueOnce(dup);
    expect((await err(cwr().createApostille({ contractId: "c1", kind: "gestor", newManager: "Maria" })))?.code).toBe("CONFLICT");
  });

  it("mudou para status que ainda admitiria ⇒ ContractStatusConflictError (router: CONFLICT)", async () => {
    cw.status = "vigente"; cw.freshStatus = "apostilado"; cw.casResult = false;
    await expect(createAddendum({ organizationId: 1, contractId: "c1", addendumType: "prazo", justification: "j", correlationId: "c" }))
      .rejects.toBeInstanceOf(ContractStatusConflictError);
    role.value = "owner";
    // Router: requireContract (1ª leitura) + serviço (2ª) + releitura pós-CAS (3ª, fresca).
    let n = 0;
    cw.getContractWorkspace.mockImplementation(async () => contractWith(++n > 2 ? "apostilado" : "vigente"));
    const e = await err(cwr().createApostille({ contractId: "c1", kind: "gestor", newManager: "Maria" }));
    expect(e?.code).toBe("CONFLICT");
  });
});

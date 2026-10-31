/**
 * M8 — resolução da origem do parecer no PRÓPRIO tenant (leituras mockadas por organização). Contrato de outra organização,
 * solicitação inexistente ou leitura com falha ⇒ origem não identificada (null), nunca o id técnico.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  requests: new Map<string, { org: number; sourceDomain: string }>(),
  contracts: new Map<string, { org: number; contractNumber: string; originType: string; originProcess: string }>(),
  processes: new Map<string, { org: number; processNumber: string }>(),
  failContracts: false,
}));
vi.mock("../../db/institutionalRequests", () => ({
  getRequest: vi.fn(async (id: string, org: number) => { const r = h.requests.get(id); return r && r.org === org ? { id, sourceDomain: r.sourceDomain } : null; }),
}));
vi.mock("../../db/contractWorkspace", () => ({
  getContractWorkspace: vi.fn(async (id: string, org: number) => {
    if (h.failContracts) throw new Error("db");
    const c = h.contracts.get(id); return c && c.org === org ? c : null;
  }),
}));
vi.mock("../../db/procurement", () => ({
  getProcess: vi.fn(async (id: string, org: number) => { const p = h.processes.get(id); return p && p.org === org ? p : null; }),
}));
vi.mock("../../db/directProcurement", () => ({ getDirectProcurementWorkspace: vi.fn(async () => null) }));

import { resolveOpinionReference } from "../../services/legalOpinionReference";

beforeEach(() => {
  h.requests.clear(); h.contracts.clear(); h.processes.clear(); h.failContracts = false;
  h.requests.set("req-a", { org: 2, sourceDomain: "contratos" });
  h.contracts.set("ctw-a", { org: 2, contractNumber: "CT-HV-1461", originType: "legado", originProcess: "" });
  h.contracts.set("ctw-p", { org: 2, contractNumber: "CT-9", originType: "processo_licitatorio", originProcess: "proc-1" });
  h.processes.set("proc-1", { org: 2, processNumber: "1461/2026" });
});

describe("resolveOpinionReference", () => {
  it("contrato legado ⇒ 'Contrato nº …' (sem inventar processo)", async () => {
    expect(await resolveOpinionReference(2, "req-a", "ctw-a")).toEqual({ sourceDomain: "contratos", label: "Contrato nº CT-HV-1461" });
  });
  it("contrato vinculado ⇒ número do processo de origem", async () => {
    expect((await resolveOpinionReference(2, "req-a", "ctw-p")).label).toBe("Contrato nº CT-9 — Processo nº 1461/2026");
  });
  it("isolamento: a mesma solicitação/contrato lidos por outra organização não resolvem", async () => {
    expect(await resolveOpinionReference(3, "req-a", "ctw-a")).toEqual({ sourceDomain: null, label: null });
  });
  it("referência inválida, solicitação ausente ou falha de leitura ⇒ origem não identificada", async () => {
    expect((await resolveOpinionReference(2, "req-a", "ctw-inexistente")).label).toBeNull();
    expect((await resolveOpinionReference(2, null, "ctw-a")).label).toBeNull();
    expect((await resolveOpinionReference(2, "req-a", "  ")).label).toBeNull();
    h.failContracts = true;
    expect((await resolveOpinionReference(2, "req-a", "ctw-a")).label).toBeNull();
  });
});

/**
 * SW-C1 / SEM-062 — domínio puro da herança do contrato: só evidência canônica; sem escolha automática.
 */
import { describe, it, expect } from "vitest";
import {
  buildDirectInheritanceProposal, buildProcurementInheritanceProposal, inheritanceDiverges, INHERITANCE_NO_EVIDENCE_MESSAGES,
} from "../../domain/contractInheritance";

const decision = (outcome: string) => ({ id: "idc_1", revision: 2, outcome, decidedAt: "2026-09-30", decidedByRole: "Prefeita" });
const props = [
  { id: "p1", supplierName: "Alfa", supplierDocument: "1", proposalValue: 10.5, protocol: "A", receivedVia: "protocolo" },
  { id: "p2", supplierName: "Beta", supplierDocument: "2", proposalValue: 9, protocol: "B", receivedVia: "email" },
];

describe("SEM-062 — herança: evidência canônica", () => {
  it("licitação: nunca há proposta (não existe registro de adjudicação)", () => {
    const r = buildProcurementInheritanceProposal("proc-1");
    expect(r).toMatchObject({ kind: "no_canonical_evidence", reason: "PROCUREMENT_NO_AWARD_RECORD", candidates: [] });
    expect(r.kind === "no_canonical_evidence" && r.message).toBe(INHERITANCE_NO_EVIDENCE_MESSAGES.PROCUREMENT_NO_AWARD_RECORD);
  });
  it("direta: sem decisão, 'nao_ratificado' ou qualquer outro resultado ⇒ sem evidência", () => {
    for (const d of [null, decision("nao_ratificado"), decision("qualquer")]) {
      expect(buildDirectInheritanceProposal({ directWorkspaceId: "w", currentDecision: d, proposals: props })).toMatchObject({ kind: "no_canonical_evidence", reason: "DIRECT_NOT_RATIFIED" });
    }
  });
  it("direta ratificada sem propostas ⇒ sem evidência", () => {
    expect(buildDirectInheritanceProposal({ directWorkspaceId: "w", currentDecision: decision("ratificado"), proposals: [] })).toMatchObject({ reason: "DIRECT_NO_PROPOSALS" });
  });
  it("direta ratificada: TODAS as propostas como candidatas, na ordem do registro, sem escolher nenhuma; procedência da decisão", () => {
    const r = buildDirectInheritanceProposal({ directWorkspaceId: "w", currentDecision: decision("ratificado"), proposals: props });
    expect(r.kind).toBe("proposal");
    if (r.kind !== "proposal") return;
    expect(r.candidates.map((c) => [c.proposalId, c.supplierName, c.value])).toEqual([["p1", "Alfa", 10.5], ["p2", "Beta", 9]]);
    expect(r.decision).toEqual({ decisionId: "idc_1", revision: 2, outcome: "ratificado", decidedAt: "2026-09-30", decidedByRole: "Prefeita" });
    expect(Object.keys(r)).not.toContain("selected");
  });
  it("divergência: compara contratado (trim) e valor em centavos", () => {
    const c = { supplierName: "Alfa", value: 10.5 };
    expect(inheritanceDiverges(c, { contractor: " Alfa ", value: 10.5 })).toBe(false);
    expect(inheritanceDiverges(c, { contractor: "Alfa LTDA", value: 10.5 })).toBe(true);
    expect(inheritanceDiverges(c, { contractor: "Alfa", value: 10.51 })).toBe(true);
  });
});

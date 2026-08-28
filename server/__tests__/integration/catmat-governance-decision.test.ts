/**
 * PR C.2 — Governança operacional CATMAT/CATSER (unit/behavioral, sem DB).
 *
 * Cobre as invariantes de negócio da decisão HUMANA supervisionada:
 *   - o código NUNCA é fabricado (confirmar exige sugestão real);
 *   - justificativa obrigatória em rejeição/substituição/sem-correspondência;
 *   - código proibido em rejeição/sem-correspondência;
 *   - proveniência correta por decisão;
 *   - decideCatmat (sem DB) valida, resolve proveniência e degrada com segurança.
 *
 * A persistência, idempotência e o isolamento multi-tenant são cobertos contra MySQL
 * real em `catmat-governance-mysql-smoke.test.ts` (roda no CI com DATABASE_URL).
 */

import { describe, it, expect } from "vitest";
import {
  validateDecision,
  requiresJustification,
  requiresCatmatCode,
  decisionSource,
  CATMAT_GOVERNANCE_DECISIONS,
} from "../../domain/catmatGovernance";
import { decideCatmat, type AvailableSuggestion } from "../../services/catmatGovernanceService";

const SUGGESTIONS: AvailableSuggestion[] = [
  { id: "s1", catmatCode: "111111", catmatDescription: "caneta esferográfica azul", score: 0.92, source: "catalogo-interno" },
  { id: "s2", catmatCode: "222222", catmatDescription: "lápis preto nº 2", score: 0.40, source: "sugestao-ia" },
];
const codes = SUGGESTIONS.map(s => s.catmatCode);

describe("PR C.2 — invariantes da decisão CATMAT/CATSER (domínio puro)", () => {
  it("expõe exatamente os quatro estados institucionais", () => {
    expect([...CATMAT_GOVERNANCE_DECISIONS]).toEqual([
      "confirmado", "rejeitado", "substituido", "sem_correspondencia_segura",
    ]);
  });

  it("justificativa é obrigatória exceto em confirmação", () => {
    expect(requiresJustification("confirmado")).toBe(false);
    expect(requiresJustification("rejeitado")).toBe(true);
    expect(requiresJustification("substituido")).toBe(true);
    expect(requiresJustification("sem_correspondencia_segura")).toBe(true);
  });

  it("código é fixado apenas em confirmar/substituir", () => {
    expect(requiresCatmatCode("confirmado")).toBe(true);
    expect(requiresCatmatCode("substituido")).toBe(true);
    expect(requiresCatmatCode("rejeitado")).toBe(false);
    expect(requiresCatmatCode("sem_correspondencia_segura")).toBe(false);
  });

  it("CONFIRMAR nunca fabrica: código tem de pertencer a uma sugestão real", () => {
    expect(validateDecision({ decision: "confirmado", catmatCode: "111111", suggestionCodes: codes }).ok).toBe(true);
    const forged = validateDecision({ decision: "confirmado", catmatCode: "999999", suggestionCodes: codes });
    expect(forged.ok).toBe(false);
    expect(forged.ok === false && forged.reason).toBe("confirm_requires_existing_suggestion");
  });

  it("CONFIRMAR sem código é recusado", () => {
    const r = validateDecision({ decision: "confirmado", catmatCode: "", suggestionCodes: codes });
    expect(r.ok === false && r.reason).toBe("catmat_code_required");
  });

  it("REJEITAR exige justificativa e não aceita código", () => {
    expect(validateDecision({ decision: "rejeitado", justification: "fora do escopo", suggestionCodes: codes }).ok).toBe(true);
    expect(validateDecision({ decision: "rejeitado", justification: "  ", suggestionCodes: codes }).ok).toBe(false);
    const withCode = validateDecision({ decision: "rejeitado", justification: "x", catmatCode: "111111", suggestionCodes: codes });
    expect(withCode.ok === false && withCode.reason).toBe("catmat_code_not_allowed_for_decision");
  });

  it("SUBSTITUIR aceita código manual fora das sugestões (override humano), com justificativa", () => {
    const r = validateDecision({ decision: "substituido", catmatCode: "888888", justification: "código correto do catálogo oficial", suggestionCodes: codes });
    expect(r.ok).toBe(true);
    expect(validateDecision({ decision: "substituido", catmatCode: "888888", suggestionCodes: codes }).ok).toBe(false); // sem justificativa
    expect(validateDecision({ decision: "substituido", justification: "x", suggestionCodes: codes }).ok).toBe(false); // sem código
  });

  it("SEM-CORRESPONDÊNCIA exige justificativa e não fixa código (fail-closed assumido pelo humano)", () => {
    expect(validateDecision({ decision: "sem_correspondencia_segura", justification: "nenhum código adequado", suggestionCodes: codes }).ok).toBe(true);
    expect(validateDecision({ decision: "sem_correspondencia_segura", suggestionCodes: codes }).ok).toBe(false);
    const withCode = validateDecision({ decision: "sem_correspondencia_segura", justification: "x", catmatCode: "111111", suggestionCodes: codes });
    expect(withCode.ok === false && withCode.reason).toBe("catmat_code_not_allowed_for_decision");
  });

  it("proveniência: confirmar herda a fonte da sugestão; substituir é sempre manual; rejeitar/none sem fonte", () => {
    expect(decisionSource("confirmado", "sugestao-ia")).toBe("sugestao-ia");
    expect(decisionSource("confirmado", null)).toBe("catalogo-interno");
    expect(decisionSource("substituido", "sugestao-ia")).toBe("manual");
    expect(decisionSource("rejeitado", "sugestao-ia")).toBeNull();
    expect(decisionSource("sem_correspondencia_segura", null)).toBeNull();
  });
});

describe("PR C.2 / V1 — decideCatmat (serviço, sem DB): valida e FAIL-CLOSED por limiar", () => {
  const base = {
    organizationId: 77001,
    actorUserId: 7,
    correlationId: "corr-c2-nodb",
    itemId: "item-abc",
    processId: "proc-1",
    suggestions: SUGGESTIONS,
  };

  // As validações do domínio (fail-closed de payload) ocorrem ANTES do gate de limiar → BAD_REQUEST.

  it("confirmar código inexistente (fabricado) é recusado com BAD_REQUEST (antes do gate de limiar)", async () => {
    await expect(
      decideCatmat({ ...base, idempotencyKey: "idem-forge", decision: "confirmado", catmatCode: "999999" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejeitar sem justificativa é recusado com BAD_REQUEST (antes do gate de limiar)", async () => {
    await expect(
      decideCatmat({ ...base, idempotencyKey: "idem-rej-bad", decision: "rejeitado" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // Sem DB não há limiar institucional ativo → FAIL-CLOSED real: mesmo decisões válidas são RECUSADAS
  // com PRECONDITION_FAILED antes de qualquer efeito (a resolução por limiar exige DB; a persistência e
  // as 4 decisões funcionais são cobertas pelo smoke MySQL com limiar configurado).

  it("confirmar válido sem limiar (no-DB) → PRECONDITION_FAILED (fail-closed)", async () => {
    await expect(
      decideCatmat({ ...base, idempotencyKey: "idem-confirm-1", decision: "confirmado", suggestionId: "s1" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("rejeitar válido sem limiar (no-DB) → PRECONDITION_FAILED", async () => {
    await expect(
      decideCatmat({ ...base, idempotencyKey: "idem-rej-ok", decision: "rejeitado", suggestionId: "s2", justification: "irrelevante ao objeto" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("substituir válido sem limiar (no-DB) → PRECONDITION_FAILED", async () => {
    await expect(
      decideCatmat({ ...base, idempotencyKey: "idem-sub", decision: "substituido", catmatCode: "888888", catmatDescription: "código do catálogo oficial", justification: "correção manual" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });

  it("sem-correspondência-segura válido sem limiar (no-DB) → PRECONDITION_FAILED", async () => {
    await expect(
      decideCatmat({ ...base, idempotencyKey: "idem-none", decision: "sem_correspondencia_segura", justification: "nenhum adequado" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

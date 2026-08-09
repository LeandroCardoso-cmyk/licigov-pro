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

describe("PR C.2 — decideCatmat (serviço, sem DB: valida e degrada com segurança)", () => {
  const base = {
    organizationId: 77001,
    actorUserId: 7,
    correlationId: "corr-c2-nodb",
    itemId: "item-abc",
    processId: "proc-1",
    suggestions: SUGGESTIONS,
  };

  it("confirmar uma sugestão real resolve código, descrição, score e proveniência", async () => {
    const { decision } = await decideCatmat({
      ...base, idempotencyKey: "idem-confirm-1", decision: "confirmado", suggestionId: "s1",
    });
    expect(decision.decision).toBe("confirmado");
    expect(decision.catmatCode).toBe("111111");
    expect(decision.catmatDescription).toBe("caneta esferográfica azul");
    expect(decision.score).toBe(0.92);
    expect(decision.source).toBe("catalogo-interno");
    expect(decision.actorUserId).toBe(7);
  });

  it("confirmar código inexistente (fabricado) é recusado com BAD_REQUEST", async () => {
    await expect(
      decideCatmat({ ...base, idempotencyKey: "idem-forge", decision: "confirmado", catmatCode: "999999" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejeitar sem justificativa é recusado; com justificativa não fixa código", async () => {
    await expect(
      decideCatmat({ ...base, idempotencyKey: "idem-rej-bad", decision: "rejeitado" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const { decision } = await decideCatmat({
      ...base, idempotencyKey: "idem-rej-ok", decision: "rejeitado", suggestionId: "s2", justification: "irrelevante ao objeto",
    });
    expect(decision.decision).toBe("rejeitado");
    expect(decision.catmatCode).toBeNull();
    expect(decision.source).toBeNull();
  });

  it("substituir fixa o código manual informado pelo servidor", async () => {
    const { decision } = await decideCatmat({
      ...base, idempotencyKey: "idem-sub", decision: "substituido", catmatCode: "888888",
      catmatDescription: "código do catálogo oficial", justification: "correção manual",
    });
    expect(decision.decision).toBe("substituido");
    expect(decision.catmatCode).toBe("888888");
    expect(decision.source).toBe("manual");
  });

  it("sem-correspondência-segura registra a decisão fail-closed sem código", async () => {
    const { decision } = await decideCatmat({
      ...base, idempotencyKey: "idem-none", decision: "sem_correspondencia_segura", justification: "nenhum adequado",
    });
    expect(decision.decision).toBe("sem_correspondencia_segura");
    expect(decision.catmatCode).toBeNull();
  });
});

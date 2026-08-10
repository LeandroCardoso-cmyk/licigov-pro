/**
 * PR C.3A — Comparação shadow (pura) + flag fail-closed (unit, sem DB).
 *
 * O comportamento end-to-end (flag ON, observabilidade persistida, replay, multi-tenant) é coberto
 * contra MySQL real em `direct-contract-shadow-mysql-smoke.test.ts` (CI).
 */
import { describe, it, expect } from "vitest";
import { compareDirectContractShadow } from "../../domain/directContractShadow";
import { runDirectContractShadow } from "../../services/directContractShadowService";

const LEGACY_DISPENSA = "# Termo de Dispensa\n\n## Objeto\nAquisição X. Fundamento: Lei 14.133/2021, art. 75. Justificativa: urgência.";

describe("PR C.3A — comparação de equivalência estrutural (pura)", () => {
  it("EQUIVALENT_STRUCTURE quando os sinais obrigatórios coincidem", () => {
    const r = compareDirectContractShadow({
      docType: "termo_dispensa",
      legacyContent: LEGACY_DISPENSA,
      canonicalContent: "Objeto: serviço Y conforme Lei 14.133/2021. Justificativa apresentada.",
    });
    expect(r.classification).toBe("EQUIVALENT_STRUCTURE");
    expect(r.divergenceType).toBeNull();
    expect(r.legacyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.canonicalHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("MISSING_REQUIRED_FIELD quando o canônico não traz um sinal obrigatório presente no legado", () => {
    const r = compareDirectContractShadow({
      docType: "termo_dispensa",
      legacyContent: LEGACY_DISPENSA,
      canonicalContent: "Texto genérico sem fundamento nem objeto nem justificativa.",
    });
    expect(r.classification).toBe("MISSING_REQUIRED_FIELD");
    expect(r.divergenceType).toMatch(/^missing:/);
  });

  it("LEGACY_ERROR quando o legado está vazio/falhou", () => {
    const r = compareDirectContractShadow({ docType: "termo_dispensa", legacyContent: null, canonicalContent: "qualquer" });
    expect(r.classification).toBe("LEGACY_ERROR");
  });

  it("CANONICAL_ERROR quando o canônico está vazio/falhou", () => {
    const r = compareDirectContractShadow({ docType: "termo_dispensa", legacyContent: LEGACY_DISPENSA, canonicalContent: null, canonicalError: true });
    expect(r.classification).toBe("CANONICAL_ERROR");
  });

  it("NÃO produz julgamento jurídico — apenas classes estruturais definidas", () => {
    const r = compareDirectContractShadow({ docType: "termo_dispensa", legacyContent: LEGACY_DISPENSA, canonicalContent: "Objeto e Lei 14.133/2021 e justificativa." });
    expect(["EQUIVALENT_STRUCTURE","STRUCTURAL_DIVERGENCE","MISSING_REQUIRED_FIELD","CANONICAL_ERROR","LEGACY_ERROR","NOT_COMPARABLE"]).toContain(r.classification);
  });
});

describe("PR C.3A — flag fail-closed (sem DB → shadow não executa)", () => {
  it("runDirectContractShadow retorna ran=false (flag_off) quando a flag não está habilitada", async () => {
    const r = await runDirectContractShadow({
      organizationId: 12345,
      actorUserId: 1,
      correlationId: "corr-c3a-unit",
      docType: "termo_dispensa",
      directContract: { id: 1, processId: null, object: "obj", value: 1000, justification: "just", type: "dispensa", legalArticleId: 1 },
      legacyContent: LEGACY_DISPENSA,
    });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe("flag_off");
  });
});

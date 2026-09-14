/**
 * A3-RD1 — `directContracts.create` em DOIS DOMÍNIOS DISJUNTOS (governed/legacy).
 *
 * Cobre (spec §15 C/D/E/F + identidade):
 *   - GOVERNED: resolve reference set ativo, tipo é autoridade governada, valor via value override;
 *     persiste legalReferenceEntryId (legalArticleId = null); audit referenceMode=governed;
 *   - LEGACY: usa legalArticleId + validação legada; persiste legalArticleId (governed = null);
 *   - identidade: governado NUNCA consulta o catálogo legado e vice-versa; IDs nunca misturados;
 *   - refine estrito: ambos/nenhum → FAIL-CLOSED;
 *   - readiness fail-closed: sem set ativo → governed create falha.
 * Persistência e resolução são mockadas; o smoke MySQL cobre o caminho real ponta a ponta.
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

vi.mock("../../db");
vi.mock("../../services/legalFrameworkAssistant");
vi.mock("../../services/contractValidation");

import { directContractsRouter } from "../../routers/directContractsRouter";
import * as db from "../../db";
import * as assistant from "../../services/legalFrameworkAssistant";
import * as contractValidation from "../../services/contractValidation";
import { makeContext, mockUser } from "../helpers/fixtures";

const GOVERNED_ENTRY = {
  id: 42, setId: 5, law: "lei-14.133-2021", article: "Art. 75", inciso: "I", alinea: null,
  canonicalLocator: "lei-14.133-2021/art-75/inc-I", canonicalDisplay: "Art. 75, I",
  procurementType: "dispensa" as const, hypothesisSummary: "x",
  sourceAuthority: "a", sourceIdentifier: "b", sourceUrl: "u", publicationDate: null,
  contentHash: "h", createdAt: new Date(),
};

const base = {
  number: "001/2026", year: 2026,
  object: "Aquisição de material de expediente",
  justification: "Justificativa técnica e jurídica suficiente para o enquadramento.",
  value: 10000000, // R$ 100.000,00 (abaixo do override 130.984,20)
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.createDirectContract).mockResolvedValue({ id: 999 } as never);
  vi.mocked(db.createDirectContractAuditLog).mockResolvedValue(undefined as never);
});

describe("A3-RD1 — create GOVERNADO", () => {
  it("resolve reference set, persiste identidade governada (legalArticleId null) e audita referenceMode=governed", async () => {
    vi.mocked(db.resolveGovernedReference).mockResolvedValue({ referenceSetVersion: 1, setId: 5, entry: GOVERNED_ENTRY, valueCents: 13098420 } as never);
    vi.mocked(assistant.validateGovernedValue).mockResolvedValue({ isValid: true, message: "ok", limitCents: 13098420, referenceSetVersion: 1 } as never);

    const caller = directContractsRouter.createCaller(makeContext(mockUser));
    await caller.create({ ...base, type: "dispensa", canonicalLocator: "lei-14.133-2021/art-75/inc-I", asOfDate: "2026-06-01" });

    expect(db.resolveGovernedReference).toHaveBeenCalledWith("lei-14.133-2021/art-75/inc-I", "2026-06-01");
    expect(db.getLegalArticleById).not.toHaveBeenCalled(); // domínio legado NUNCA consultado
    const insert = vi.mocked(db.createDirectContract).mock.calls[0][0];
    expect(insert.legalReferenceEntryId).toBe(42);
    expect(insert.legalReferenceSetVersion).toBe(1);
    expect(insert.legalReferenceLocator).toBe("lei-14.133-2021/art-75/inc-I");
    expect(insert.legalArticleId).toBeNull();
    const audit = vi.mocked(db.createDirectContractAuditLog).mock.calls[0][0];
    expect((audit.details as Record<string, unknown>).referenceMode).toBe("governed");
    expect((audit.details as Record<string, unknown>).resolvedValueOverrideCents).toBe(13098420);
  });

  it("valor acima do override governado → FAIL (nunca DISPENSA_LIMITS)", async () => {
    vi.mocked(db.resolveGovernedReference).mockResolvedValue({ referenceSetVersion: 1, setId: 5, entry: GOVERNED_ENTRY, valueCents: 13098420 } as never);
    vi.mocked(assistant.validateGovernedValue).mockResolvedValue({ isValid: false, message: "excede limite", limitCents: 13098420, referenceSetVersion: 1 } as never);

    const caller = directContractsRouter.createCaller(makeContext(mockUser));
    await expect(caller.create({ ...base, value: 20000000, type: "dispensa", canonicalLocator: "lei-14.133-2021/art-75/inc-I" })).rejects.toThrow(/excede limite/);
    expect(db.createDirectContract).not.toHaveBeenCalled();
    expect(contractValidation.validateDispensaValue).not.toHaveBeenCalled(); // caminho governado não usa validação legada
  });

  it("tipo divergente do registro governado → FAIL-CLOSED", async () => {
    vi.mocked(db.resolveGovernedReference).mockResolvedValue({ referenceSetVersion: 1, setId: 5, entry: { ...GOVERNED_ENTRY, procurementType: "inexigibilidade" }, valueCents: null } as never);

    const caller = directContractsRouter.createCaller(makeContext(mockUser));
    await expect(caller.create({ ...base, type: "dispensa", canonicalLocator: "lei-14.133-2021/art-75/inc-I" })).rejects.toThrow(/divergente/i);
    expect(db.createDirectContract).not.toHaveBeenCalled();
  });

  it("readiness fail-closed: sem set ativo → create governado falha", async () => {
    vi.mocked(db.resolveGovernedReference).mockRejectedValue(new Error("LEGAL_REFERENCE_SET_MISSING"));

    const caller = directContractsRouter.createCaller(makeContext(mockUser));
    await expect(caller.create({ ...base, type: "dispensa", canonicalLocator: "lei-14.133-2021/art-75/inc-I" })).rejects.toThrow(/SET_MISSING/);
    expect(db.createDirectContract).not.toHaveBeenCalled();
  });

  it("versão esperada divergente da ativa → FAIL", async () => {
    vi.mocked(db.resolveGovernedReference).mockResolvedValue({ referenceSetVersion: 1, setId: 5, entry: GOVERNED_ENTRY, valueCents: 13098420 } as never);

    const caller = directContractsRouter.createCaller(makeContext(mockUser));
    await expect(caller.create({ ...base, type: "dispensa", canonicalLocator: "lei-14.133-2021/art-75/inc-I", referenceSetVersion: 2 })).rejects.toThrow(/vers[aã]o do reference set divergente/i);
  });
});

describe("A3-RD1 — create LEGADO", () => {
  it("usa legalArticleId + validação legada; persiste governed = null; audita referenceMode=legacy", async () => {
    vi.mocked(db.getLegalArticleById).mockResolvedValue({ id: 7, article: "Art. 75, II", type: "dispensa" } as never);
    vi.mocked(contractValidation.validateDispensaValue).mockReturnValue({ isValid: true, limit: 6549211, estimatedValue: base.value, legalBasis: "art75_ii_outros" } as never);

    const caller = directContractsRouter.createCaller(makeContext(mockUser));
    await caller.create({ ...base, type: "dispensa", legalArticleId: 7 });

    expect(db.resolveGovernedReference).not.toHaveBeenCalled(); // governado NUNCA consultado
    const insert = vi.mocked(db.createDirectContract).mock.calls[0][0];
    expect(insert.legalArticleId).toBe(7);
    expect(insert.legalReferenceEntryId).toBeNull();
    const audit = vi.mocked(db.createDirectContractAuditLog).mock.calls[0][0];
    expect((audit.details as Record<string, unknown>).referenceMode).toBe("legacy");
  });
});

describe("A3-RD1 — refine estrito (exatamente-um domínio)", () => {
  it("ambos os domínios → FAIL-CLOSED (nunca misturar IDs)", async () => {
    const caller = directContractsRouter.createCaller(makeContext(mockUser));
    await expect(caller.create({ ...base, type: "dispensa", legalArticleId: 7, canonicalLocator: "lei-14.133-2021/art-75/inc-I" } as never)).rejects.toThrow();
    expect(db.createDirectContract).not.toHaveBeenCalled();
  });

  it("nenhum domínio → FAIL-CLOSED", async () => {
    const caller = directContractsRouter.createCaller(makeContext(mockUser));
    await expect(caller.create({ ...base, type: "dispensa" } as never)).rejects.toThrow();
    expect(db.createDirectContract).not.toHaveBeenCalled();
  });
});

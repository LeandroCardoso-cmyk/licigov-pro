import { describe, expect, it } from "vitest";
import {
  cycleRefusal, emissionOrdinal, isCycleOpenFor, latestOfficialVersion, nextOfficialVersion, reasonRefusal,
  type OpenVersionCycle,
} from "../../domain/officialVersionCycle";
import { officialRegenerationBlock } from "../../domain/draftRegeneration";

const cycle = (over: Partial<OpenVersionCycle> = {}): OpenVersionCycle => ({
  organizationId: 9, lineageId: "lin-1", kind: "tr", baseOfficialVersion: 2, baseOfficialDocumentId: "doc-v2",
  openedByUserId: 7, reason: "Fontes alteradas após a emissão", correlationId: "corr-1", openedAt: "2026-10-26T00:00:00.000Z",
  ...over,
});

describe("numeração de versões oficiais (derivada do ledger + linhagem)", () => {
  const ledger = [{ version: 2, officialDocumentId: "a" }, { version: 3, officialDocumentId: "b" }, { version: 7, officialDocumentId: "c" }];

  it("última emissão e ordinal da emissão não são presumidos contíguos", () => {
    expect(latestOfficialVersion([])).toBeNull();
    expect(latestOfficialVersion(ledger)).toBe(7);
    expect([2, 3, 7].map((v) => emissionOrdinal(ledger, v))).toEqual([1, 2, 3]);
    expect(() => emissionOrdinal(ledger, 4)).toThrow(/não consta/);
  });

  it("próxima versão = MAX(linhagem) + 1, inclusive com snapshot técnico posterior à última emissão", () => {
    expect(nextOfficialVersion({ lineageMaxVersion: 1, ledger: [] })).toBe(2);
    expect(nextOfficialVersion({ lineageMaxVersion: 7, ledger })).toBe(8);
    expect(nextOfficialVersion({ lineageMaxVersion: 9, ledger })).toBe(10);
  });

  it("linhagem menor que a última emissão é inconsistência (erro, nunca número inventado)", () => {
    expect(() => nextOfficialVersion({ lineageMaxVersion: 6, ledger })).toThrow(/inconsistente/);
    expect(() => nextOfficialVersion({ lineageMaxVersion: 1.5, ledger: [] })).toThrow(/inconsistente/);
  });
});

describe("ciclo de nova versão — invariantes", () => {
  it("vale só sobre a emissão vigente do mesmo órgão/linhagem/tipo/documento", () => {
    const latest = { version: 2, officialDocumentId: "doc-v2", lineageId: "lin-1", kind: "tr", organizationId: 9 };
    expect(cycleRefusal(cycle(), latest)).toBeNull();
    expect(isCycleOpenFor(latest, cycle())).toBe(true);
    expect(cycleRefusal(cycle(), null)).toBe("CYCLE_BASE_NOT_LATEST");
    expect(cycleRefusal(cycle(), { ...latest, kind: "etp" })).toBe("CYCLE_KIND_MISMATCH");
    expect(cycleRefusal(cycle(), { ...latest, lineageId: "lin-2" })).toBe("CYCLE_LINEAGE_MISMATCH");
    expect(cycleRefusal(cycle(), { ...latest, officialDocumentId: "outro" })).toBe("CYCLE_DOCUMENT_MISMATCH");
    expect(cycleRefusal(cycle({ baseOfficialVersion: 3 }), latest)).toBe("CYCLE_BASE_NOT_LATEST");
    expect(cycleRefusal(cycle(), { ...latest, organizationId: 10 })).toBe("CYCLE_ORGANIZATION_MISMATCH");
  });

  it("FAIL-CLOSED: sem a identidade completa da emissão vigente o ciclo não vale (nunca por coincidência de número)", () => {
    const full = { version: 2, officialDocumentId: "doc-v2", lineageId: "lin-1", kind: "tr", organizationId: 9 };
    for (const k of ["officialDocumentId", "lineageId", "kind", "organizationId"] as const) {
      const partial = { ...full, [k]: null };
      expect(cycleRefusal(cycle(), partial)).toBe("CYCLE_IDENTITY_UNKNOWN");
      expect(officialRegenerationBlock({ status: "rascunho" }, partial, cycle())).toMatchObject({ reason: "official_emitted" });
    }
    expect(officialRegenerationBlock(null, { version: 2 }, cycle())).toMatchObject({ reason: "official_emitted" });
  });

  it("emissão posterior fecha o ciclo implicitamente", () => {
    const v3 = { version: 3, officialDocumentId: "doc-v3", lineageId: "lin-1", kind: "tr", organizationId: 9 };
    expect(cycleRefusal(cycle(), v3)).toBe("CYCLE_CLOSED_BY_EMISSION");
    expect(isCycleOpenFor(v3, cycle())).toBe(false);
    expect(isCycleOpenFor({ ...v3, version: 2, officialDocumentId: "doc-v2" }, null)).toBe(false);
  });
});

const V2 = { version: 2, officialDocumentId: "doc-v2", lineageId: "lin-1", kind: "tr", organizationId: 9 } as const;

describe("officialRegenerationBlock com ciclo (fundação; nenhum chamador o passa ainda)", () => {
  const drafts = [null, { status: "rascunho" }, { status: "em_revisao" }, { status: "aprovado" }];
  const latests = [null, { version: 2, createdAt: "2026-09-01T00:00:00.000Z" }, { version: 5 }];

  it("sem ciclo (2 ou 3 argumentos) ⇒ comportamento idêntico ao anterior", () => {
    for (const d of drafts) for (const l of latests) {
      const before = officialRegenerationBlock(d, l);
      expect(officialRegenerationBlock(d, l, null)).toEqual(before);
      expect(officialRegenerationBlock(d, l, undefined)).toEqual(before);
    }
  });

  it("ciclo válido libera só o bloqueio de versão emitida", () => {
    expect(officialRegenerationBlock({ status: "rascunho" }, V2, cycle())).toBeNull();
    expect(officialRegenerationBlock(null, V2, cycle())).toBeNull();
  });

  it("ciclo nunca libera rascunho APROVADO", () => {
    expect(officialRegenerationBlock({ status: "aprovado" }, V2, cycle()))
      .toEqual({ reason: "approved", officialVersion: null, emittedAt: null });
    expect(officialRegenerationBlock({ status: "aprovado" }, null, cycle()))
      .toEqual({ reason: "approved", officialVersion: null, emittedAt: null });
  });

  it("ciclo antigo (base v2, vigente v3) continua bloqueado pela emissão vigente", () => {
    expect(officialRegenerationBlock({ status: "rascunho" }, { ...V2, version: 3, officialDocumentId: "doc-v3" }, cycle()))
      .toEqual({ reason: "official_emitted", officialVersion: 3, emittedAt: null });
  });

  it("ciclo de outro documento/linhagem não libera", () => {
    expect(officialRegenerationBlock(null, { ...V2, lineageId: "lin-2" }, cycle())).toMatchObject({ reason: "official_emitted" });
    expect(officialRegenerationBlock(null, { ...V2, kind: "edital" }, cycle())).toMatchObject({ reason: "official_emitted" });
    expect(officialRegenerationBlock(null, { ...V2, organizationId: 10 }, cycle())).toMatchObject({ reason: "official_emitted" });
  });
});

describe("política — contrato sem instância", () => {
  it("motivo validado só conforme a política informada", () => {
    expect(reasonRefusal({ reasonRequired: false }, null)).toBeNull();
    expect(reasonRefusal({ reasonRequired: true }, "  ")).toBe("REASON_REQUIRED");
    expect(reasonRefusal({ reasonRequired: true, reasonMinChars: 20 }, "curto")).toBe("REASON_TOO_SHORT");
    expect(reasonRefusal({ reasonRequired: true, reasonMinChars: 5 }, " motivo ok ")).toBeNull();
  });

  it("o módulo não exporta instância/padrão de política nem comando de abertura", async () => {
    const mod = await import("../../domain/officialVersionCycle");
    const names = Object.keys(mod);
    expect(names.some((n) => /policy|default|open(Cycle|Version)/i.test(n) && typeof (mod as Record<string, unknown>)[n] !== "function")).toBe(false);
    expect(names.filter((n) => /^open/i.test(n))).toEqual([]);
  });
});

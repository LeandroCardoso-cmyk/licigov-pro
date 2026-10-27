/**
 * C2 — escopo do Edital escolhido antes da 1ª geração: registrado como fato `edital.scope` (fonte `user`), lido de volta ao
 * recarregar. Sem padrão presumido; fora da versão/digest do contexto de DFD.
 */
import { describe, expect, it } from "vitest";
import {
  decodeEditalScope, editalScopeSelection, encodeEditalScope, normalizeEditalScope, EDITAL_SCOPE_PATH,
} from "../../domain/editalScopeSelection";
import { factValueHash, isSourceAllowed, resolveCanonicalContext, type FactAssertion } from "../../domain/canonicalProcurementContext";

const fact = (id: number, value: string | null, over: Partial<FactAssertion> = {}): FactAssertion => ({
  id, path: EDITAL_SCOPE_PATH, value, valueHash: factValueHash(value), sourceType: "user", sourceId: "edital-scope",
  sourceVersion: `rev:${id - 1}`, status: "confirmed", actorUserId: 7, basisValueHash: null, createdAt: `2026-10-2${id}T00:00:00.000Z`, ...over,
});

describe("normalizeEditalScope", () => {
  it("exige modalidade e forma; plataforma só na forma eletrônica", () => {
    expect(normalizeEditalScope({ modality: "pregao", form: "eletronico", platform: "bll" }))
      .toEqual({ ok: true, scope: { modality: "pregao", form: "eletronico", platform: "bll" } });
    expect(normalizeEditalScope({ modality: "pregao", form: "presencial", platform: "bll" }))
      .toEqual({ ok: true, scope: { modality: "pregao", form: "presencial", platform: null } });
    expect(normalizeEditalScope({ modality: "pregao", form: "eletronico" })).toEqual({ ok: false, reason: "SCOPE_INCOMPLETE" });
    expect(normalizeEditalScope({ form: "presencial" })).toEqual({ ok: false, reason: "SCOPE_INCOMPLETE" });
  });

  it("valor fora das listas conhecidas é recusado (nunca gravado)", () => {
    expect(normalizeEditalScope({ modality: "convite", form: "presencial" })).toEqual({ ok: false, reason: "SCOPE_INVALID" });
    expect(normalizeEditalScope({ modality: "pregao", form: "eletronico", platform: "x" })).toEqual({ ok: false, reason: "SCOPE_INVALID" });
  });
});

describe("codificação do fato", () => {
  it("canônica e reversível; mesmo escopo ⇒ mesmo hash", () => {
    const s = { modality: "concorrencia", form: "eletronico", platform: "compras_gov" } as const;
    const enc = encodeEditalScope(s);
    expect(decodeEditalScope(enc)).toEqual(s);
    expect(factValueHash(enc)).toBe(factValueHash(encodeEditalScope({ ...s })));
  });

  it("valor corrompido/incompleto ⇒ null (nenhum escopo presumido)", () => {
    expect(decodeEditalScope("{")).toBeNull();
    expect(decodeEditalScope(JSON.stringify({ modality: "pregao" }))).toBeNull();
    expect(decodeEditalScope(42)).toBeNull();
    expect(decodeEditalScope(null)).toBeNull();
  });
});

describe("editalScopeSelection (leitura do ledger)", () => {
  const a = encodeEditalScope({ modality: "pregao", form: "eletronico", platform: "bll" });
  const b = encodeEditalScope({ modality: "pregao", form: "presencial", platform: null });

  it("nada registrado ⇒ escopo nulo e hash nulo", () => {
    expect(editalScopeSelection([])).toEqual({ scope: null, valueHash: null, actorUserId: null, updatedAt: null, conflict: false });
  });

  it("superação consciente: a escolha posterior feita sobre a anterior vale", () => {
    const sel = editalScopeSelection([fact(1, a), fact(2, b, { basisValueHash: factValueHash(a) })]);
    expect(sel.scope).toEqual({ modality: "pregao", form: "presencial", platform: null });
    expect(sel.valueHash).toBe(factValueHash(b));
    expect(sel.conflict).toBe(false);
  });

  it("só a fonte `user` afirma o escopo (IA, documentos e processo nunca)", () => {
    expect(isSourceAllowed(EDITAL_SCOPE_PATH, "user")).toBe(true);
    for (const s of ["ai_draft", "tr", "process", "approved_document", "dfd"] as const) expect(isSourceAllowed(EDITAL_SCOPE_PATH, s)).toBe(false);
    expect(editalScopeSelection([fact(1, a, { sourceType: "ai_draft" })]).scope).toBeNull();
  });

  it("o escopo do Edital não altera versão nem digest do contexto de DFD", () => {
    const base = {
      organizationId: 9, processId: "p1", process: { number: "1/2026", object: "Objeto", responsibleUserId: 1, createdAt: "2026-10-01T00:00:00.000Z" },
      organization: null, intelligentItems: [],
    };
    const without = resolveCanonicalContext({ ...base, assertions: [] });
    const withScope = resolveCanonicalContext({ ...base, assertions: [fact(5, a)] });
    expect(withScope.version).toBe(without.version);
    expect(withScope.digest).toBe(without.digest);
  });
});

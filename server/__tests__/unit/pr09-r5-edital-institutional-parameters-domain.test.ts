/**
 * PR-09 / R5 (decisões do owner) — regras PURAS:
 *   B) documento APROVADO / com versão OFICIAL emitida NÃO é regenerado diretamente (token estável
 *      OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE), nem com confirmReplace;
 *   C) critério de julgamento / regime de execução são FATOS institucionais persistidos: hidratados do
 *      rascunho canônico, NULL = "requer revisão" (nunca um padrão/inferência); sobrescrever um valor
 *      decidido exige troca explícita; definir pela 1ª vez um NULL é 1ª decisão; omitir nunca apaga.
 */
import { describe, it, expect } from "vitest";
import {
  officialRegenerationBlock, officialRegenerationRefusalMessage, OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE,
  persistedEditalParameters, resolveEditalParameters, overlayEditalProposal, describeEditalParameters,
  sameEditalParameters, normalizeEditalText, EDITAL_PARAMETERS_CHANGED, EDITAL_TEXT_PARAMETER_MAX,
} from "../../domain/draftRegeneration";

describe("B — documento aprovado/oficial não é regenerado diretamente", () => {
  it("versão oficial emitida (ledger de promoção) ⇒ bloqueio com a versão; tem precedência sobre status", () => {
    expect(officialRegenerationBlock({ status: "rascunho" }, { version: 2, createdAt: "2026-09-01T00:00:00.000Z" }))
      .toEqual({ reason: "official_emitted", officialVersion: 2, emittedAt: "2026-09-01T00:00:00.000Z" });
    expect(officialRegenerationBlock({ status: "aprovado" }, { version: 1 })).toMatchObject({ reason: "official_emitted", officialVersion: 1 });
  });

  it("status aprovado (sem emissão) ⇒ bloqueio; rascunho/em revisão/ausente ⇒ livre", () => {
    expect(officialRegenerationBlock({ status: "aprovado" }, null)).toEqual({ reason: "approved", officialVersion: null, emittedAt: null });
    expect(officialRegenerationBlock({ status: "rascunho" }, null)).toBeNull();
    expect(officialRegenerationBlock({ status: "em_revisao" }, null)).toBeNull();
    expect(officialRegenerationBlock(null, null)).toBeNull();
  });

  it("mensagem estável prefixada pelo token e explica o novo ciclo de versão governado", () => {
    const m = officialRegenerationRefusalMessage("edital", { reason: "official_emitted", officialVersion: 3, emittedAt: null });
    expect(m.startsWith(`${OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE}:`)).toBe(true);
    expect(m).toContain("Edital");
    expect(m).toContain("v3");
    expect(m).toMatch(/novo ciclo de versão governado/);
    expect(m).toMatch(/nem com confirmação/);
    expect(officialRegenerationRefusalMessage("tr", { reason: "approved", officialVersion: null, emittedAt: null })).toMatch(/TR está APROVADO/);
  });
});

describe("C — critério de julgamento / regime de execução persistidos", () => {
  const core = { modality: "pregao", form: "eletronico", platform: "compras_gov" } as const;

  it("hidratação: lê as colunas persistidas; NULL/vazio ⇒ null (requer revisão), nunca um padrão", () => {
    expect(persistedEditalParameters({ ...core, judgmentCriterion: "  Menor preço  ", executionRegime: "Empreitada por preço global" }))
      .toEqual({ ...core, judgmentCriterion: "Menor preço", executionRegime: "Empreitada por preço global" });
    // Linha antiga (pré-0308): colunas ausentes/NULL ⇒ null.
    expect(persistedEditalParameters(core)).toEqual({ ...core, judgmentCriterion: null, executionRegime: null });
    expect(persistedEditalParameters({ ...core, judgmentCriterion: "   ", executionRegime: null }))
      .toMatchObject({ judgmentCriterion: null, executionRegime: null });
    expect(normalizeEditalText(undefined)).toBeNull();
    expect(EDITAL_TEXT_PARAMETER_MAX).toBe(100);
  });

  it("persistidos + sem proposta ⇒ usa os PERSISTIDOS (inclusive critério/regime)", () => {
    const persisted = persistedEditalParameters({ ...core, judgmentCriterion: "Maior desconto", executionRegime: "Empreitada por preço unitário" })!;
    expect(resolveEditalParameters({ persisted, proposed: {} })).toEqual({ ok: true, params: persisted, source: "persisted", previous: null });
  });

  it("definir pela 1ª vez critério/regime ainda NULL ⇒ 1ª decisão (sem confirmação), anterior registrado", () => {
    const persisted = persistedEditalParameters(core)!;
    const r = resolveEditalParameters({ persisted, proposed: { judgmentCriterion: "Menor preço" } });
    expect(r).toEqual({
      ok: true, source: "first_decision", previous: persisted,
      params: { ...core, judgmentCriterion: "Menor preço", executionRegime: null },
    });
  });

  it("sobrescrever critério/regime já decidido sem confirmação ⇒ CONFLICT; com confirmação ⇒ troca explícita", () => {
    const persisted = persistedEditalParameters({ ...core, judgmentCriterion: "Menor preço", executionRegime: null })!;
    const refused = resolveEditalParameters({ persisted, proposed: { judgmentCriterion: "Técnica e preço" } });
    expect(refused).toMatchObject({ ok: false, code: "CONFLICT" });
    if (!refused.ok) {
      expect(refused.message.startsWith(`${EDITAL_PARAMETERS_CHANGED}:`)).toBe(true);
      expect(refused.message).toContain("critério de julgamento: Técnica e preço");
      expect(refused.message).toContain("critério de julgamento: Menor preço");
    }
    const ok = resolveEditalParameters({ persisted, proposed: { judgmentCriterion: "Técnica e preço" }, confirmParameterChange: true });
    expect(ok).toMatchObject({ ok: true, source: "explicit_change", previous: persisted, params: { judgmentCriterion: "Técnica e preço" } });
  });

  it("omitir/vazio NUNCA apaga um fato institucional definido; proposta idêntica ⇒ persistidos", () => {
    const persisted = persistedEditalParameters({ ...core, judgmentCriterion: "Menor preço", executionRegime: "Tarefa" })!;
    expect(overlayEditalProposal(persisted, { judgmentCriterion: "", executionRegime: "   " })).toEqual(persisted);
    expect(resolveEditalParameters({ persisted, proposed: { judgmentCriterion: " Menor preço " } })).toMatchObject({ ok: true, source: "persisted" });
    // Troca de núcleo explícita PRESERVA critério/regime persistidos.
    const r = resolveEditalParameters({ persisted, proposed: { modality: "concorrencia", form: "presencial" }, confirmParameterChange: true });
    expect(r).toMatchObject({ ok: true, params: { modality: "concorrencia", form: "presencial", platform: null, judgmentCriterion: "Menor preço", executionRegime: "Tarefa" } });
  });

  it("sem persistidos: 1ª decisão completa inclui critério/regime informados; sem eles ⇒ NULL (sem padrão)", () => {
    expect(resolveEditalParameters({ persisted: null, proposed: { ...core, executionRegime: " Empreitada integral " } }))
      .toMatchObject({ ok: true, source: "first_decision", params: { judgmentCriterion: null, executionRegime: "Empreitada integral" } });
    expect(resolveEditalParameters({ persisted: null, proposed: { ...core } }))
      .toMatchObject({ ok: true, params: { judgmentCriterion: null, executionRegime: null } });
    // Critério/regime NÃO substituem modalidade/forma: sem núcleo ⇒ EDITAL_PARAMETERS_REQUIRED.
    expect(resolveEditalParameters({ persisted: null, proposed: { judgmentCriterion: "Menor preço" } })).toMatchObject({ ok: false, code: "PRECONDITION_FAILED" });
  });

  it("descrição/igualdade incluem critério/regime (timeline e staleness)", () => {
    const a = persistedEditalParameters({ ...core, judgmentCriterion: "Menor preço" })!;
    expect(describeEditalParameters(a)).toBe("pregao/eletronico/compras_gov · critério de julgamento: Menor preço");
    expect(describeEditalParameters(persistedEditalParameters(core)!)).toBe("pregao/eletronico/compras_gov");
    expect(sameEditalParameters(a, { ...a, executionRegime: "Tarefa" })).toBe(false);
  });
});

describe("C — contexto do Edital consome os valores persistidos", () => {
  const base = {
    organizationId: 1, processId: "p", object: "Obra", modality: "concorrencia", form: "presencial", platform: null,
    processObject: "Obra", processNumber: "2026/0001", currentStage: "NOTICE", dfd: null, etp: null, tr: null, approvedItems: [],
  };

  it("definidos ⇒ linhas com o valor (sem [REVISAR]) e fora de `missing`; NULL ⇒ [REVISAR] preservado", async () => {
    const { buildEditalSourceContext } = await import("../../services/authoring/editalContext");
    const set = buildEditalSourceContext({ ...base, criterioJulgamento: "Menor preço", regimeContratacao: "Empreitada por preço global" });
    expect(set.promptContext).toContain("- Critério de julgamento: Menor preço");
    expect(set.promptContext).toContain("- Regime de contratação/execução: Empreitada por preço global");
    expect(set.promptContext).not.toContain("[REVISAR: definir critério de julgamento");
    expect(set.promptContext).not.toContain("[REVISAR: definir regime de execução");
    expect(set.missing).not.toContain("criterio_julgamento");
    expect(set.missing).not.toContain("regime_contratacao");

    const unset = buildEditalSourceContext({ ...base, criterioJulgamento: null, regimeContratacao: null });
    expect(unset.promptContext).toContain("[REVISAR: definir critério de julgamento");
    expect(unset.promptContext).toContain("[REVISAR: definir regime de execução");
    expect(unset.missing).toEqual(expect.arrayContaining(["criterio_julgamento", "regime_contratacao"]));
    // Definir o fato institucional muda o digest (a minuta anterior fica "source_changed", nunca silenciosa).
    expect(set.sourcesDigest).not.toBe(unset.sourcesDigest);
  });
});

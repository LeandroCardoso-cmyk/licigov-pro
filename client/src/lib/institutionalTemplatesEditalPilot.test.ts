/**
 * Piloto Edital — view-model PURO: aplicabilidade explícita, filtros do catálogo, evidência jurídica (campos opcionais nunca
 * inventados), prontidão e formulário de registro.
 */
import { describe, expect, it } from "vitest";
import {
  catalogFilterOptions, emptyLegalEvidenceForm, emptyRegisterForm, emptyScopeForm, legalEvidencePayload, pinnedRevisionLabel, readinessHeadline, scopeFormProblems,
  scopeFromForm, scopeLabel, validateLegalEvidenceForm, validateRegisterForm, type CatalogRowView, type ReadinessMatrixView,
} from "@/lib/institutionalTemplatesView";

const SHA = "a".repeat(64);
const full = { ...emptyScopeForm(), modality: "PREGAO", form: "ELETRONICA", platform: "BLL", regime: "EMPREITADA_PRECO_UNITARIO", criterion: "MENOR_PRECO" };

describe("aplicabilidade explícita no formulário", () => {
  it("Edital exige modalidade, forma, regime e critério; forma eletrônica (com/sem acento) exige plataforma; token inválido é apontado", () => {
    expect(scopeFormProblems("edital", full)).toEqual({});
    expect(Object.keys(scopeFormProblems("edital", emptyScopeForm())).sort()).toEqual(["criterion", "form", "modality", "regime"]);
    expect(scopeFormProblems("edital", { ...full, platform: "" }).platform).toMatch(/plataforma/);
    expect(scopeFormProblems("edital", { ...full, form: "Eletrônica", platform: "" }).platform).toMatch(/plataforma/);
    expect(scopeFormProblems("edital", { ...full, form: "PRESENCIAL", platform: "" })).toEqual({});
    expect(scopeFormProblems("edital", { ...full, modality: "com espaço" }).modality).toMatch(/token/);
    expect(scopeFormProblems("tr", emptyScopeForm())).toEqual({});
  });

  it("scopeFromForm só envia o que foi declarado (nada vira valor padrão) e scopeLabel descreve as 5 dimensões", () => {
    expect(scopeFromForm({ ...emptyScopeForm(), modality: " PREGAO " })).toEqual({ modality: "PREGAO" });
    expect(scopeFromForm(emptyScopeForm())).toEqual({});
    expect(scopeLabel(scopeFromForm(full))).toBe("modalidade: PREGAO · forma: ELETRONICA · plataforma: BLL · regime: EMPREITADA_PRECO_UNITARIO · critério: MENOR_PRECO");
    expect(scopeLabel({})).toMatch(/não declarado/);
  });
});

const row = (over: Partial<CatalogRowView> = {}): CatalogRowView => ({
  identityId: "ti1", documentKind: "edital", slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL", displayNameSource: "REGISTRATION_PROVENANCE",
  templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", declaredScope: { modality: "PREGAO", form: "ELETRONICA", platform: "BLL" }, headline: "h", bindingStatus: "BOUND",
  revisions: [{ id: "tr1", revision: 1, status: "PUBLISHED", semanticHash: "b".repeat(64) }],
  bindings: [{ bindingId: "tb1", active: true, scope: { modality: "PREGAO", form: "ELETRONICA", platform: "BLL" }, scopeHeadline: "Pregão | Eletrônica | BLL", pinnedRevisionId: "tr1", pinnedRevision: 1, pinnedRevisionStatus: "PUBLISHED", pinnedSemanticHash: "b".repeat(64), health: "OK", effectiveFrom: "2026-10-01T00:00:00Z" }],
  ...over,
});

describe("catálogo e filtros", () => {
  it("opções dos filtros = valores existentes + sugestões; revisão fixada é sempre exata (nº + status + hash)", () => {
    const rows = [row(), row({ identityId: "ti2", declaredScope: { modality: "PREGAO", form: "PRESENCIAL" }, bindings: [] })];
    const o = catalogFilterOptions(rows, { platform: { COMPRASGOV: "Compras.gov.br" } });
    expect(o).toEqual({ modality: ["PREGAO"], form: ["ELETRONICA", "PRESENCIAL"], platform: ["BLL", "COMPRASGOV"] });
    expect(pinnedRevisionLabel(rows[0].bindings[0])).toBe("PUBLISHED revisão 1 (bbbbbbbb)");
    expect(pinnedRevisionLabel({ ...rows[0].bindings[0], pinnedRevision: null, pinnedRevisionStatus: null, pinnedSemanticHash: null })).toMatch(/indisponível/);
  });
});

describe("evidência de aprovação jurídica — formulário", () => {
  const ok = { ...emptyLegalEvidenceForm("2026-10-07"), sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, decidedByName: "Procuradoria Jurídica", decidedByRole: "Órgão", basisReference: "Doc X", reason: "Registro de aprovação externa.", confirmed: true };
  it("válido só com versão lógica, SHA-256, autoridade declarada, base, justificativa e confirmação explícita; parecer/protocolo/procurador são opcionais", () => {
    expect(validateLegalEvidenceForm(ok).valid).toBe(true);
    const bad = validateLegalEvidenceForm({ ...emptyLegalEvidenceForm("2026-10-07") });
    expect(Object.keys(bad.errors).sort()).toEqual(["basisReference", "confirmed", "decidedByName", "decidedByRole", "reason", "sourceLogicalVersion", "sourceSha256"]);
    expect(validateLegalEvidenceForm({ ...ok, parecerDate: "01/10/2026" }).errors.parecerDate).toBeDefined();
    expect(validateLegalEvidenceForm({ ...ok, sourceSha256: "A".repeat(64) }).valid).toBe(false);
  });
  it("o payload NÃO inclui campos opcionais vazios (nada é inventado) e inclui exatamente o informado", () => {
    expect(legalEvidencePayload(ok)).toEqual({ sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA });
    expect(legalEvidencePayload({ ...ok, parecerNumber: " 55/2026 ", procurador: "Fulano", refs: "a\n\n b \n" })).toEqual({
      sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, parecerNumber: "55/2026", procurador: "Fulano", evidenceRefs: ["a", "b"],
    });
    expect(Object.keys(legalEvidencePayload(ok))).not.toContain("parecerNumber");
  });
});

describe("registro do modelo", () => {
  const preset = { presetId: "EDITAL_PREGAO_ELETRONICO_BLL", templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", documentKind: "edital", slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL", scope: { modality: "PREGAO", form: "ELETRONICA", platform: "BLL" } };
  it("o preset preenche rótulos e escopo (não conteúdo, SHA ou autoridade)", () => {
    const f = emptyRegisterForm("2026-10-07", preset);
    expect(f).toMatchObject({ templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL", sourceText: "", sourceSha256: "", decidedByName: "", confirmed: false });
    expect(f.scope).toMatchObject({ modality: "PREGAO", form: "ELETRONICA", platform: "BLL", regime: "", criterion: "" });
  });
  it("validação: escopo completo, fonte, SHA-256, versão, autoridade, justificativa e confirmação", () => {
    const f = { ...emptyRegisterForm("2026-10-07", preset) };
    const v = validateRegisterForm(f, false);
    expect(v.valid).toBe(false);
    for (const k of ["scope.regime", "scope.criterion", "source", "sourceLogicalVersion", "sourceSha256", "decidedByName", "decidedByRole", "basisReference", "reason", "confirmed"]) expect(v.errors[k], k).toBeDefined();
    const ok = { ...f, scope: { ...f.scope, regime: "X", criterion: "Y" }, sourceText: JSON.stringify({ schema: "tpl-ast/1", root: [] }), sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, decidedByName: "A", decidedByRole: "B", basisReference: "C", reason: "Justificativa ok.", confirmed: true };
    expect(validateRegisterForm(ok, false)).toEqual({ valid: true, errors: {} });
    expect(validateRegisterForm({ ...ok, sourceText: "{" }, false).errors.source).toMatch(/JSON/);
    expect(validateRegisterForm({ ...ok, sourceKind: "DOCX", sourceText: "" }, false).errors.source).toBeDefined();
    expect(validateRegisterForm({ ...ok, sourceKind: "DOCX", sourceText: "" }, true).valid).toBe(true);
  });
});

describe("prontidão — texto de resumo", () => {
  const m = (blocked: number): ReadinessMatrixView => ({ revisionId: "r", revisionSemanticHash: SHA, overall: blocked ? "BLOCKED" : "READY", matrixHash: SHA, summary: { pass: 9 - blocked, blocked, notApplicable: 2 }, notices: [], checks: [] });
  it("não esconde bloqueios e deixa claro que publicar continua sendo decisão humana", () => {
    expect(readinessHeadline(m(0))).toMatch(/decisão humana/);
    expect(readinessHeadline(m(2))).toMatch(/2 verificação\(ões\) BLOCKED.*não são ocultados/);
  });
});

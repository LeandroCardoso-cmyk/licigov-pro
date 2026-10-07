/**
 * Piloto Edital — componentes de UX (react-dom/server): catálogo multi-modelo, filtros, aplicabilidade, matriz de prontidão, evidência
 * jurídica (campos ausentes = "não informado"), dossiê sem efeitos, registro e a fronteira estrutural (sem páginas separadas por modelo).
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { CatalogRowView, ReadinessMatrixView } from "@/lib/institutionalTemplatesView";

type Mods = {
  CatalogCard: typeof import("./CatalogCard").CatalogCard;
  CatalogFilters: typeof import("./CatalogFilters").CatalogFilters;
  ScopeFields: typeof import("./ScopeFields").ScopeFields;
  ReadinessMatrixPanel: typeof import("./ReadinessMatrixPanel").ReadinessMatrixPanel;
  GovernanceSummary: typeof import("./LegalEvidencePanel").GovernanceSummary;
  LegalEvidenceForm: typeof import("./LegalEvidencePanel").LegalEvidenceForm;
  PreviewDossierPanel: typeof import("./PreviewDossierPanel").PreviewDossierPanel;
  RegisterModelForm: typeof import("./RegisterModelForm").RegisterModelForm;
};
let M: Mods;
let V: typeof import("@/lib/institutionalTemplatesView");
const h = (c: unknown, props: object) => renderToStaticMarkup(React.createElement(c as React.ComponentType<never>, props as never));
// `Link` (wouter) precisa de um roteador; no SSR de teste usa-se `ssrPath` (sem `location`/DOM).
const hr = (c: unknown, props: object) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(c as React.ComponentType<never>, props as never)));

beforeAll(async () => {
  (globalThis as { React?: unknown }).React = React;
  M = { ...(await import("./CatalogCard")), ...(await import("./CatalogFilters")), ...(await import("./ScopeFields")), ...(await import("./ReadinessMatrixPanel")), ...(await import("./LegalEvidencePanel")), ...(await import("./PreviewDossierPanel")), ...(await import("./RegisterModelForm")) } as Mods;
  V = await import("@/lib/institutionalTemplatesView");
});

const H = "b".repeat(64);
const row = (over: Partial<CatalogRowView> = {}): CatalogRowView => ({
  identityId: "ti1", documentKind: "edital", slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL", displayNameSource: "REGISTRATION_PROVENANCE", templateKey: "EDITAL_PREGAO_ELETRONICO_BLL",
  declaredScope: { modality: "PREGAO", form: "ELETRONICA", platform: "BLL" },
  headline: "Edital — Pregão Eletrônico — BLL / Pregão | Eletrônica | BLL / PUBLISHED revisão 1 (bbbbbbbb)", bindingStatus: "BOUND",
  revisions: [{ id: "tr1", revision: 1, status: "PUBLISHED", semanticHash: H }, { id: "tr2", revision: 2, status: "DRAFT", semanticHash: "c".repeat(64) }],
  bindings: [{ bindingId: "tb1", active: true, scope: { modality: "PREGAO", form: "ELETRONICA", platform: "BLL", regime: "EMPREITADA_PRECO_UNITARIO", criterion: "MENOR_PRECO" }, scopeHeadline: "Pregão | Eletrônica | BLL | Empreitada por preço unitário | Menor preço", pinnedRevisionId: "tr1", pinnedRevision: 1, pinnedRevisionStatus: "PUBLISHED", pinnedSemanticHash: H, health: "OK", effectiveFrom: "2026-10-01T00:00:00Z" }],
  ...over,
});

describe("CatalogCard (multi-modelo)", () => {
  it("mostra nome de exibição + origem do nome, slug, templateKey, status das revisões, escopo explícito, revisão EXATA fixada e saúde do vínculo", () => {
    const html = hr(M.CatalogCard, { row: row() });
    for (const t of ["Edital — Pregão Eletrônico — BLL", "edital-pregao-eletronico-bll", "EDITAL_PREGAO_ELETRONICO_BLL", "Nome: nome do registro de procedência", "PUBLISHED revisão 1 (bbbbbbbb)",
      "Rev. 1 · Publicada (PUBLISHED)", "Rev. 2 · Rascunho (DRAFT)", "Vinculado", "modalidade: PREGAO · forma: ELETRONICA · plataforma: BLL", "Vínculo íntegro (revisão exata publicada)", 'href="/modelos-institucionais/ti1"']) expect(html, t).toContain(t);
    expect(html).not.toMatch(/latest|[úu]ltima revis[aã]o/i);
  });

  it("sem displayName registrado cai para o slug e SINALIZA isso; conflito e revisão não publicada são bloqueios visíveis", () => {
    const noName = hr(M.CatalogCard, { row: row({ displayName: "so-slug", displayNameSource: "SLUG", templateKey: null }) });
    expect(noName).toContain("slug (sem nome de exibição registrado)");
    const conflict = hr(M.CatalogCard, { row: row({ bindingStatus: "CONFLICT", bindings: [{ ...row().bindings[0], health: "SCOPE_CONFLICT" }] }) });
    expect(conflict).toContain("Conflito de vínculo");
    expect(conflict).toContain("falha fechada");
    const dep = hr(M.CatalogCard, { row: row({ bindings: [{ ...row().bindings[0], health: "REVISION_NOT_PUBLISHED", pinnedRevisionStatus: "DEPRECATED" }] }) });
    expect(dep).toContain("geração bloqueada");
    expect(hr(M.CatalogCard, { row: row({ bindings: [], bindingStatus: "NOT_BOUND" }) })).toContain("Nenhum vínculo");
  });

  it("vários modelos do mesmo tipo convivem (nenhum é assumido como único)", () => {
    const html = [row(), row({ identityId: "ti2", slug: "edital-pregao-presencial", displayName: "Edital — Pregão Presencial" }), row({ identityId: "ti3", slug: "edital-concorrencia", displayName: "Edital — Concorrência" })].map((r) => hr(M.CatalogCard, { row: r })).join("");
    for (const t of ["Edital — Pregão Eletrônico — BLL", "Edital — Pregão Presencial", "Edital — Concorrência"]) expect(html).toContain(t);
  });
});

describe("CatalogFilters", () => {
  it("expõe os 5 filtros (tipo, modalidade, forma, plataforma, status) com todos os 4 status canônicos", () => {
    const html = h(M.CatalogFilters, { value: V.EMPTY_CATALOG_FILTER, onChange: () => undefined, documentKinds: ["edital", "tr"], options: { modality: ["PREGAO"], form: ["ELETRONICA", "PRESENCIAL"], platform: ["BLL"] } });
    for (const id of ["flt-documentKind", "flt-modality", "flt-form", "flt-platform", "flt-status"]) expect(html).toContain(`id="${id}"`);
    for (const t of ["Edital", "Termo de Referência", "PREGAO", "PRESENCIAL", "BLL", "Rascunho (DRAFT)", "Aprovada (APPROVED)", "Publicada (PUBLISHED)", "Depreciada (DEPRECATED)"]) expect(html).toContain(t);
  });
});

describe("ScopeFields", () => {
  it("5 dimensões explícitas com sugestões (não fechadas); erros só após a tentativa; dimensão não persistida é sinalizada", () => {
    const base = { idPrefix: "t", documentKind: "edital", value: V.emptyScopeForm(), onChange: () => undefined, suggestions: { form: { ELETRONICA: "Eletrônica" } } };
    const quiet = h(M.ScopeFields, base);
    for (const l of ["Modalidade", "Forma", "Plataforma", "Regime de contratação", "Critério de julgamento"]) expect(quiet).toContain(l);
    expect(quiet).toContain('<option value="ELETRONICA">Eletrônica</option>');
    expect(quiet).not.toContain("declare explicitamente");
    expect(h(M.ScopeFields, { ...base, showErrors: true })).toContain("declare explicitamente");
    const unsupported = h(M.ScopeFields, { ...base, persistedDimensions: ["modality", "regime", "criterion"] });
    expect(unsupported.match(/ainda não é gravada pela persistência atual/g)).toHaveLength(2);
  });
});

const matrix = (): ReadinessMatrixView => ({
  revisionId: "tr1", revisionSemanticHash: H, overall: "BLOCKED", matrixHash: "d".repeat(64), summary: { pass: 1, blocked: 1, notApplicable: 1 }, notices: ["A matriz é recalculada pelo servidor na publicação: qualquer BLOCKED impede a publicação (PUBLICATION_BLOCKED)."],
  checks: [
    { id: "SOURCE_PROVENANCE", label: "Procedência da fonte", status: "PASS", detail: "ok", findings: [], findingsTotal: 0 },
    { id: "ITEMS_BACKING", label: "Backing de ITEMS", status: "BLOCKED", detail: "sem backing", findings: ["variável ITEMS: ent.i160"], findingsTotal: 30 },
    { id: "CERTAME_CONFIG", label: "Capacidade CERTAME_CONFIG", status: "NOT_APPLICABLE", detail: "n/a", findings: [], findingsTotal: 0 },
  ],
});
describe("ReadinessMatrixPanel", () => {
  it("mostra PASS, BLOCKED e NOT_APPLICABLE sem esconder bloqueios; alerta acessível e achados truncados com contagem", () => {
    const html = h(M.ReadinessMatrixPanel, { matrix: matrix() });
    for (const t of ["PASS", "BLOCKED", "NOT_APPLICABLE", "variável ITEMS: ent.i160", "… e mais 29 achado(s)", "PUBLICATION_BLOCKED", 'data-check="ITEMS_BACKING"']) expect(html, t).toContain(t);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Os bloqueios não são ocultados e impedem a publicação");
  });
});

describe("GovernanceSummary e LegalEvidenceForm", () => {
  const gov = (ev: object | null) => ({
    provenance: { templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", displayName: "Edital — Pregão Eletrônico — BLL", sourceLogicalVersion: "1.0.1-draft", sourceSha256: "a".repeat(64), sourceFormat: "NATIVE", recordedByUserId: 7, recordedAt: "2026-10-07T10:00:00.000Z", inventory: { sha256: H, inputsTotal: 160, controlOnlyInputs: 3, conditionTypes: 48 } },
    legalEvidence: ev, legalEvidenceHistory: ev ? [ev] : [], malformedRecords: 0, lifecycleNote: "Evidência jurídica e procedência são metadados de governança: não alteram o status da revisão nem substituem a aprovação e a publicação humanas no sistema.",
  });
  const evidence = { decisionId: "idc1", version: 1, sourceLogicalVersion: "1.0.1-draft", sourceSha256: "a".repeat(64), revisionSemanticHash: H, recordedByUserId: 7, recordedAt: "2026-10-07T10:00:00.000Z", declaredBy: { name: "Procuradoria Jurídica", role: "Órgão", userId: null }, actDate: "2026-10-05", basisReference: "Doc X", reason: "ok ok ok ok", parecerNumber: null, parecerDate: null, protocol: null, procurador: null, evidenceRefs: [], authorityValidation: "NOT_VALIDATED_POLICY_PENDING" };

  it("campos opcionais ausentes aparecem como 'não informado' (nunca inventados); mostra versão lógica, SHA, quem registrou, quando e que a competência não é validada", () => {
    const html = h(M.GovernanceSummary, { governance: gov(evidence) });
    expect(html.match(/não informado/g)?.length).toBeGreaterThanOrEqual(4);
    for (const t of ["1.0.1-draft", "aaaaaaaaaaaa…", "#7 · 2026-10-07T10:00:00.000Z", "NOT_VALIDATED_POLICY_PENDING", "o sistema não valida a competência", "160 entradas · 3 control-only · 48 tipos de condição", "não alteram o status da revisão"]) expect(html, t).toContain(t);
    expect(h(M.GovernanceSummary, { governance: gov({ ...evidence, parecerNumber: "55/2026", procurador: "Fulano" }) })).toContain("55/2026");
  });
  it("sem evidência: texto de pendência (opcional para o ciclo de vida); registro ilegível é alertado e não tratado como válido", () => {
    const html = h(M.GovernanceSummary, { governance: { ...gov(null), malformedRecords: 2 } });
    expect(html).toContain("Nenhuma evidência registrada");
    expect(html).toContain("2 registro(s) de governança ilegíveis");
  });
  it("o formulário diz que NÃO é status, deixa opcionais em branco e exige confirmação humana explícita desmarcada por padrão", () => {
    const html = h(M.LegalEvidenceForm, { value: V.emptyLegalEvidenceForm("2026-10-07"), onChange: () => undefined, showErrors: true });
    expect(html).toContain("Não é um status");
    for (const l of ["Número do parecer (opcional)", "Data do parecer (opcional)", "Protocolo (opcional)", "Procurador (opcional)"]) expect(html).toContain(l);
    expect(html).not.toMatch(/checked=""/);
    expect(html).toContain("É necessária a confirmação humana explícita.");
  });
});

describe("PreviewDossierPanel", () => {
  const dossier = (over: object = {}) => ({
    status: "COMPOSED", resolution: { status: "RESOLVED", revision: 1, revisionId: "tr1", semanticHash: H },
    template: { identityId: "ti1", slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL", displayNameSource: "REGISTRATION_PROVENANCE", documentKind: "edital" },
    revision: { id: "tr1", revision: 1, status: "PUBLISHED", semanticHash: H, hashVersion: "tpl-hash/1", catalogVersion: "c/1" },
    context: { scope: { modality: "PREGAO", form: "ELETRONICA", platform: "BLL" }, scopeHeadline: "Pregão | Eletrônica | BLL", appliedScopeVariables: [{ name: "edital.plataforma", value: "BLL" }], sampleValueCount: 3 },
    composeError: null, contentText: "Texto composto", conditionDecisions: [{ nodePath: "root[3]", result: true, traceHash: "t" }], sourcePins: [{ key: "PARAMS", digest: "d".repeat(64) }],
    dynamicTables: [{ path: "root[5]", columns: 2, dynamicVariables: ["itens"] }], annexes: [{ id: "anexo-i" }], crossReferences: { sectionKeys: ["s1"], annexIds: ["anexo-i"], docRefs: [{ kind: "TR", where: "BODY" }] },
    aiSlots: [{ slotKey: "justificativa", maxTokens: 600, status: "PLACEHOLDER_ONLY" }], manifestPreview: { stage: "GENERATION", persisted: false, manifestHash: "e".repeat(64), composedOutputHash: "f".repeat(64) },
    sideEffects: { persisted: false, aiCalled: false, officialDocumentCreated: false, issued: false, published: false, processTouched: false }, notices: ["Pré-visualização: nenhuma IA foi chamada e nada foi persistido."], ...over,
  });
  it("exibe identidade, revisão exata, contexto, condições, pins, tabelas dinâmicas, anexos, referências, slots de IA e manifest — e o aviso de ausência de efeitos", () => {
    const html = h(M.PreviewDossierPanel, { dossier: dossier() });
    for (const t of ["Edital — Pregão Eletrônico — BLL", "Revisão 1 · bbbbbbbb", "Pregão | Eletrônica | BLL", "edital.plataforma=BLL", "root[3]", "incluído", "PARAMS", "root[5]", "anexo-i", "TR (pin exato)", "justificativa", "a IA não foi chamada", "Não persistido", "nada foi persistido, emitido ou publicado", 'data-testid="no-side-effects"']) expect(html, t).toContain(t);
  });
  it("binding não resolvido ⇒ sem prévia e com o motivo; erro de composição ⇒ alerta, sem texto composto", () => {
    const nr = h(M.PreviewDossierPanel, { dossier: dossier({ status: "NOT_RESOLVED", template: null, revision: null, contentText: null, notices: ["O binding exato não resolveu (ausente, ambíguo ou inválido)."] }) });
    expect(nr).toContain("O binding exato não resolveu");
    expect(nr).not.toContain("Texto composto");
    const ce = h(M.PreviewDossierPanel, { dossier: dossier({ status: "COMPOSE_ERROR", composeError: "MISSING_REQUIRED", contentText: null }) });
    expect(ce).toContain("MISSING_REQUIRED");
    expect(ce).not.toContain("Texto composto");
  });
});

describe("RegisterModelForm", () => {
  const preset = { presetId: "EDITAL_PREGAO_ELETRONICO_BLL", templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", documentKind: "edital", slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL", scope: { modality: "PREGAO", form: "ELETRONICA", platform: "BLL" } };
  it("oferece o preset BLL, declara que nasce RASCUNHO e nunca aprova/publica, e não pré-marca a confirmação", () => {
    const html = h(M.RegisterModelForm, { value: V.emptyRegisterForm("2026-10-07", preset), onChange: () => undefined, presets: [preset], documentKinds: ["edital", "tr"], today: "2026-10-07", hasDocx: false });
    for (const t of ["Edital — Pregão Eletrônico — BLL", "EDITAL_PREGAO_ELETRONICO_BLL", "edital-pregao-eletronico-bll", "RASCUNHO (DRAFT)", "Nunca aprova nem publica", "Aplicabilidade", "AST nativo (JSON)", "SHA-256 da fonte", "Versão lógica da fonte"]) expect(html, t).toContain(t);
    expect(html).not.toMatch(/checked=""[^>]*\/><span>Confirmo/);
  });
});

describe("fronteira estrutural — tudo dentro de /modelos-institucionais; sem páginas por modelo", () => {
  const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");
  it("nenhuma rota nova (/edital-bll, /edital-presencial, /concorrencia…): só /modelos-institucionais e /:identityId", () => {
    const app = read("client/src/App.tsx");
    const routes = [...app.matchAll(/path=\{"([^"]+)"\}/g)].map((m) => m[1]).filter((p) => /modelos|edital|concorr|bll|pregao/i.test(p));
    expect(routes.sort()).toEqual(["/modelos-institucionais", "/modelos-institucionais/:identityId"]);
    const files = ["client/src/pages/InstitutionalTemplates.tsx", "client/src/pages/InstitutionalTemplateDetail.tsx"];
    for (const f of files) expect(read(f), f).not.toMatch(/path=["{]+\/(edital|concorr|pregao|bll)/i);
  });
  it("as páginas só chamam o router institutionalTemplates (nunca o legado); sem HTML injetado/eval", () => {
    for (const f of ["client/src/pages/InstitutionalTemplates.tsx", "client/src/pages/InstitutionalTemplateDetail.tsx"]) {
      const src = read(f);
      expect([...src.matchAll(/trpc\.([A-Za-z]+)\./g)].map((m) => m[1]).filter((r) => r !== "useUtils")).toEqual(Array(src.match(/trpc\.institutionalTemplates\./g)?.length ?? 0).fill("institutionalTemplates"));
      expect(src).not.toMatch(/dangerouslySetInnerHTML|\beval\s*\(|new\s+Function\s*\(|\.innerHTML\s*=/);
    }
  });
});

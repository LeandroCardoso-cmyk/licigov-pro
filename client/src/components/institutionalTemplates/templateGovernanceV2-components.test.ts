/**
 * Template Governance V2 — UX: origem (plataforma · própria · derivada), política do órgão, readiness por camada com justificativa,
 * derivação e upload. Renderizado no servidor (react-dom/server; env "node", sem jsdom). Prova o que a pessoa VÊ e as regras de habilitação.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import {
  ASSURANCE_LABEL, canDeriveFrom, derivableRevision, emptyDeriveForm, emptyPolicyForm, filterByOwnership, groupChecksByLayer, legalPolicyExplanation, originBadge, ownershipCounts,
  POLICY_KIND_LABEL, policyHeadline, validateDeriveForm, validatePolicyForm, type CatalogRowView, type OriginView, type PolicyView, type ReadinessMatrixView,
} from "@/lib/institutionalTemplatesView";

type Mods = {
  OriginBadge: typeof import("./OriginBadge").OriginBadge;
  OwnershipTabs: typeof import("./OwnershipTabs").OwnershipTabs;
  TemplatePolicyCard: typeof import("./TemplatePolicyCard").TemplatePolicyCard;
  DeriveTemplateForm: typeof import("./DeriveTemplateForm").DeriveTemplateForm;
  ReadinessMatrixPanel: typeof import("./ReadinessMatrixPanel").ReadinessMatrixPanel;
  CatalogCard: typeof import("./CatalogCard").CatalogCard;
  IntegrityPanel: typeof import("./IntegrityPanel").IntegrityPanel;
  RegisterModelForm: typeof import("./RegisterModelForm").RegisterModelForm;
};
let V: typeof import("@/lib/institutionalTemplatesView");
let M: Mods;
const h = (c: unknown, props: object) => renderToStaticMarkup(React.createElement(c as React.ComponentType<never>, props as never));
// `Link` (wouter) precisa de um roteador; no SSR de teste usa-se `ssrPath` (sem `location`/DOM).
const hr = (c: unknown, props: object) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(c as React.ComponentType<never>, props as never)));
beforeAll(async () => {
  (globalThis as { React?: unknown }).React = React;
  M = { ...(await import("./OriginBadge")), ...(await import("./OwnershipTabs")), ...(await import("./TemplatePolicyCard")), ...(await import("./DeriveTemplateForm")), ...(await import("./ReadinessMatrixPanel")), ...(await import("./CatalogCard")), ...(await import("./IntegrityPanel")), ...(await import("./RegisterModelForm")) } as Mods;
  V = await import("@/lib/institutionalTemplatesView");
});

const H64 = "a".repeat(64);
const platform: OriginView = { ownership: "PLATFORM", source: "PLATFORM_CATALOG", lineage: null, original: null, declaredAuthor: null };
const tenant: OriginView = { ownership: "TENANT", source: "TENANT_UPLOAD", lineage: null, original: { sha256: H64, sizeBytes: 10, filename: "m.docx", storageKey: null }, declaredAuthor: null };
const derived: OriginView = { ownership: "DERIVED", source: "TENANT_AUTHORED", lineage: { kind: "PLATFORM_PACKAGE", packageKey: "EDITAL_BLL", packageVersion: "1.0.0", sourceSha256: H64 }, original: null, declaredAuthor: "Setor" };
const row = (over: Partial<CatalogRowView> = {}): CatalogRowView => ({
  identityId: "ti1", documentKind: "edital", slug: "edital-x", displayName: "Edital X", displayNameSource: "IDENTITY", templateKey: null, declaredScope: {}, headline: "h", bindingStatus: "NOT_BOUND",
  revisions: [{ id: "tr1", revision: 1, status: "PUBLISHED", semanticHash: H64 }, { id: "tr2", revision: 2, status: "DRAFT", semanticHash: H64 }], bindings: [], origin: tenant, originState: "RECORDED", ...over,
});
const dec = { decidedByName: "A", decidedByRole: "B", decidedAt: "2026-10-14", basisReference: "Portaria 1", reason: "Justificativa longa", confirmed: true };
const defaultPolicy: PolicyView = { kind: "PLATFORM_DEFAULT", version: 0, malformed: false, policy: { legalEvidence: "OPTIONAL", approveMinRole: "manager", publishMinRole: "manager" }, history: [] };
const legacyPolicy: PolicyView = { ...defaultPolicy, kind: "LEGACY_COMPAT", policy: { legalEvidence: "REQUIRED", approveMinRole: "manager", publishMinRole: "manager" }, transition: { cutoverAt: "2026-10-20T13:00:00.000Z", source: "LEDGER_MARKER" as const, legacyOrganization: true, explanation: "O órgão já possuía modelos antes da transição. Nada foi alterado em silêncio." } };
const ownPolicy: PolicyView = { ...defaultPolicy, kind: "TENANT_DEFINED", version: 1, policy: { legalEvidence: "REQUIRED", approveMinRole: "manager", publishMinRole: "manager" } };

describe("origem dos modelos", () => {
  it("selos distintos para plataforma / própria / derivada (com lineage legível) e estados sem origem ditos como são", () => {
    expect(originBadge({ origin: platform, originState: "RECORDED" })).toMatchObject({ label: "Modelo da plataforma", tone: "info" });
    expect(originBadge({ origin: tenant, originState: "RECORDED" })).toMatchObject({ label: "Modelo próprio", tone: "success" });
    const d = originBadge({ origin: derived, originState: "RECORDED" });
    expect(d).toMatchObject({ label: "Modelo derivado", tone: "warning" });
    expect(d.detail).toContain("EDITAL_BLL v1.0.0");
    expect(originBadge({ origin: null, originState: "LEGACY_UNCLASSIFIED" }).label).toBe("Origem não classificada");
    expect(originBadge({ origin: null, originState: "MALFORMED" })).toMatchObject({ label: "Origem ilegível", tone: "danger" });
    expect(originBadge({}).label).toBe("Sem procedência");          // nunca "plataforma" por padrão
    expect(h(M.OriginBadge, { origin: derived, originState: "RECORDED" })).toContain("Modelo derivado");
  });

  it("filtro e contagem por propriedade: nada some em 'Todos'; sem origem registrada fica em 'Sem classificação'", () => {
    const rows = [row({ identityId: "1", origin: platform }), row({ identityId: "2" }), row({ identityId: "3", origin: derived }), row({ identityId: "4", origin: null, originState: "LEGACY_UNCLASSIFIED" })];
    expect(ownershipCounts(rows)).toEqual({ ALL: 4, PLATFORM: 1, TENANT: 1, DERIVED: 1, UNCLASSIFIED: 1 });
    expect(filterByOwnership(rows, "ALL")).toHaveLength(4);
    expect(filterByOwnership(rows, "DERIVED").map((r) => r.identityId)).toEqual(["3"]);
    expect(filterByOwnership(rows, "UNCLASSIFIED").map((r) => r.identityId)).toEqual(["4"]);
    const html = h(M.OwnershipTabs, { value: "TENANT", counts: ownershipCounts(rows), onChange: () => undefined });
    expect(html).toContain("Da minha prefeitura"); expect(html).toContain("(4)"); expect(html).toContain('aria-selected="true"');
  });

  it("o card mostra a origem e só oferece 'Derivar' sobre revisão JÁ decidida (nunca rascunho)", () => {
    expect(canDeriveFrom("DRAFT")).toBe(false);
    for (const s of ["APPROVED", "PUBLISHED", "DEPRECATED"] as const) expect(canDeriveFrom(s)).toBe(true);
    expect(derivableRevision(row())).toMatchObject({ id: "tr1" });
    expect(derivableRevision(row({ revisions: [{ id: "tr9", revision: 1, status: "DRAFT", semanticHash: H64 }] }))).toBeNull();
    const withAction = hr(M.CatalogCard, { row: row(), onDerive: () => undefined });
    expect(withAction).toContain("Modelo próprio"); expect(withAction).toContain("Derivar modelo");
    expect(hr(M.CatalogCard, { row: row() })).not.toContain("Derivar modelo");                                   // sem permissão ⇒ sem ação
    expect(hr(M.CatalogCard, { row: row({ revisions: [{ id: "tr9", revision: 1, status: "DRAFT", semanticHash: H64 }] }), onDerive: () => undefined })).not.toContain("Derivar modelo");
  });
});

describe("política do órgão", () => {
  it("manchete explicita o regime: padrão da plataforma (OPCIONAL) · regime anterior (OBRIGATÓRIA) · política do órgão · não resolvida", () => {
    expect(policyHeadline(defaultPolicy)).toContain("Padrão da plataforma"); expect(policyHeadline(defaultPolicy)).toContain("OPCIONAL");
    expect(policyHeadline(legacyPolicy)).toContain("Regime anterior preservado"); expect(policyHeadline(legacyPolicy)).toContain("OBRIGATÓRIA");
    expect(policyHeadline(ownPolicy)).toContain("versão 1"); expect(policyHeadline(ownPolicy)).toContain("OBRIGATÓRIA");
    expect(policyHeadline({ ...defaultPolicy, kind: "UNRESOLVED_STRICT", malformed: true })).toContain("padrão estrito");
    expect(POLICY_KIND_LABEL.LEGACY_COMPAT.tone).toBe("warning");
  });

  it("formulário: exige autoridade/justificativa/confirmação humana; 'sem alteração' só se a decisão já é do órgão; confirmar o regime anterior/padrão É uma decisão válida", () => {
    const f = emptyPolicyForm(ownPolicy.policy, "2026-10-14");
    const v0 = validatePolicyForm(f, ownPolicy);
    expect(v0.valid).toBe(false); expect(v0.errors.unchanged).toBeTruthy();
    expect(v0.errors.confirmed).toBeTruthy();                                                                        // sem checkbox pré-marcado
    expect(validatePolicyForm({ ...f, legalEvidence: "OPTIONAL", decision: dec }, ownPolicy)).toEqual({ valid: true, errors: {} });
    expect(validatePolicyForm({ ...f, decision: dec }, ownPolicy).errors.unchanged).toBeTruthy();
    // órgão legado confirma REQUIRED explicitamente (mesmos valores) ⇒ válido: encerra a compatibilidade e passa a ser decisão própria
    expect(validatePolicyForm({ ...emptyPolicyForm(legacyPolicy.policy, "2026-10-14"), decision: dec }, legacyPolicy)).toEqual({ valid: true, errors: {} });
    expect(validatePolicyForm({ ...emptyPolicyForm(defaultPolicy.policy, "2026-10-14"), decision: dec }, defaultPolicy)).toEqual({ valid: true, errors: {} });
    // registro ilegível pode ser restabelecido sem mudar os valores
    expect(validatePolicyForm({ ...f, decision: dec }, { ...ownPolicy, malformed: true }).valid).toBe(true);
  });
  it("card: papel sem permissão só lê; gerente vê 'Alterar política'; aviso de que não substitui a Procuradoria e histórico visível", () => {
    const base = { policy: { ...defaultPolicy, note: "Não substitui a análise jurídica dos documentos elaborados (Procuradoria).", history: [{ version: 1, policy: { legalEvidence: "OPTIONAL" as const, approveMinRole: "manager" as const, publishMinRole: "owner" as const }, declaredBy: { name: "Ana", role: "Secretária" }, actDate: "2026-10-01", reason: "Decisão do órgão" }] }, form: null, onOpen: () => undefined, onChange: () => undefined, onCancel: () => undefined, onSubmit: () => undefined };
    const ro = h(M.TemplatePolicyCard, { ...base, canEdit: false });
    expect(ro).toContain("Somente gerentes"); expect(ro).not.toContain("Alterar política"); expect(ro).toContain("Procuradoria"); expect(ro).toContain("Versão 1"); expect(ro).toContain("publicar ≥ owner");
    expect(h(M.TemplatePolicyCard, { ...base, canEdit: true })).toContain("Alterar política");
    const legacyHtml = h(M.TemplatePolicyCard, { ...base, policy: { ...legacyPolicy, history: [] }, canEdit: true });
    expect(legacyHtml).toContain("Compatibilidade (regime anterior)"); expect(legacyHtml).toContain("Nada foi alterado em silêncio");
    const open = h(M.TemplatePolicyCard, { ...base, canEdit: true, form: emptyPolicyForm(defaultPolicy.policy, "2026-10-14"), showErrors: true });
    expect(open).toContain("Registrar política"); expect(open).toContain("nunca fica abaixo de gerente"); expect(open).not.toMatch(/checked=""[^>]*name="confirm/);
  });
});

describe("readiness por camada, com justificativa", () => {
  const check = (id: string, layer: string | undefined, status: "PASS" | "BLOCKED" | "NOT_APPLICABLE") => ({ id, label: id, status, detail: `detalhe ${id}`, findings: status === "BLOCKED" ? ["motivo do bloqueio"] : [], findingsTotal: status === "BLOCKED" ? 1 : 0, ...(layer ? { layer } : {}) });
  const matrix = (over: Partial<ReadinessMatrixView> = {}): ReadinessMatrixView => ({
    revisionId: "tr1", revisionSemanticHash: H64, overall: "READY", matrixHash: H64, summary: { pass: 1, blocked: 0, notApplicable: 1 }, notices: [],
    checks: [check("STRUCTURE", "TECHNICAL_TEMPLATE_READINESS", "PASS"), check("LEGAL_APPROVAL_EVIDENCE", "TENANT_TEMPLATE_POLICY", "NOT_APPLICABLE")] as never,
    policy: { kind: "TENANT_DEFINED", legalEvidence: "OPTIONAL", decisionId: "idc_1", malformed: false }, ...over,
  });
  it("agrupa em camadas na ordem fixa; servidor sem `layer` cai na camada técnica (compatibilidade)", () => {
    const g = groupChecksByLayer(matrix());
    expect(g.map((x) => x.layer)).toEqual(["TECHNICAL_TEMPLATE_READINESS", "TENANT_TEMPLATE_POLICY"]);
    expect(groupChecksByLayer(matrix({ checks: [check("A", undefined, "PASS")] as never })).map((x) => x.layer)).toEqual(["TECHNICAL_TEMPLATE_READINESS"]);
  });
  it("com política OPCIONAL: explica que não bloqueia, mantém auditável e deixa a análise do documento com a Procuradoria", () => {
    const html = h(M.ReadinessMatrixPanel, { matrix: matrix() });
    expect(html).toContain("Política do órgão sobre seus modelos"); expect(html).toContain("OPCIONAL"); expect(html).toContain("Procuradoria");
    expect(html).toContain("NOT_APPLICABLE"); expect(html).not.toContain("role=\"alert\"");
  });
  it("com regime anterior/obrigatória/ilegível: explica o bloqueio e NÃO oculta justificativas dos bloqueios", () => {
    const mk = (policy: ReadinessMatrixView["policy"]) => matrix({ overall: "BLOCKED", summary: { pass: 1, blocked: 1, notApplicable: 0 }, policy,
      checks: [check("STRUCTURE", "TECHNICAL_TEMPLATE_READINESS", "PASS"), check("LEGAL_APPROVAL_EVIDENCE", "TENANT_TEMPLATE_POLICY", "BLOCKED")] as never });
    const html = h(M.ReadinessMatrixPanel, { matrix: mk({ kind: "LEGACY_COMPAT", legalEvidence: "REQUIRED", decisionId: null, malformed: false }) });
    expect(html).toContain("Compatibilidade com o regime anterior"); expect(html).toContain("motivo do bloqueio"); expect(html).toContain('role="alert"');
    expect(legalPolicyExplanation({ kind: "TENANT_DEFINED", legalEvidence: "REQUIRED", decisionId: "x", malformed: false })).toContain("exige evidência");
    expect(legalPolicyExplanation({ kind: "UNRESOLVED_STRICT", legalEvidence: "REQUIRED", decisionId: null, malformed: true })).toContain("ESTRITO");
    expect(legalPolicyExplanation(undefined)).toContain("ESTRITO");                                   // servidor antigo/sem política ⇒ nunca assume OPCIONAL
    expect(legalPolicyExplanation({ kind: "PLATFORM_DEFAULT", legalEvidence: "OPTIONAL", decisionId: null, malformed: false })).toContain("Padrão da plataforma");
    expect(legalPolicyExplanation({ kind: "PLATFORM_DEFAULT", legalEvidence: "OPTIONAL", decisionId: null, malformed: false })).toContain("Procuradoria");
  });
});

describe("integridade da fonte e upload", () => {
  const integrity = {
    items: [
      { id: "DECLARED_SOURCE_SHA256", label: "Hash declarado da fonte", value: H64, assurance: "CLIENT_DECLARED_UNVERIFIED" as const, explanation: "Informado por quem registrou." },
      { id: "SERVER_FILE_SHA256", label: "Hash calculado do arquivo enviado", value: "b".repeat(64), assurance: "SERVER_COMPUTED" as const, explanation: "Calculado pelo servidor." },
      { id: "SEMANTIC_HASH", label: "Hash semântico do modelo", value: "c".repeat(64), assurance: "SERVER_DERIVED" as const, explanation: "Derivado." },
    ],
    relations: [{ id: "DECLARED_VS_FILE", status: "DIFFERENT" as const, message: "Não é necessariamente erro." }], serverAssured: ["SERVER_FILE_SHA256", "SEMANTIC_HASH"], notices: ["Hashes DECLARADOS não são provas criptográficas verificadas."],
  };
  it("painel separa declarado (não verificado) de calculado/derivado pelo servidor e explica as comparações; nunca chama declaração de prova", () => {
    const html = h(M.IntegrityPanel, { integrity, hasOriginal: false });
    expect(html).toContain("Declarado — não verificado"); expect(html).toContain("Calculado pelo servidor"); expect(html).toContain("Derivado pelo servidor");
    expect(html).toContain("Não é necessariamente erro"); expect(html).toContain("não são provas criptográficas");
    expect(html).not.toContain("Reverificar arquivo original");                                          // sem original ⇒ sem ação
    expect(ASSURANCE_LABEL.CLIENT_DECLARED_UNVERIFIED.tone).toBe("warning");
  });
  it("reverificação do original: botão só com original; resultado VERIFIED/MISMATCH explicado, MISMATCH como alerta", () => {
    const withBtn = h(M.IntegrityPanel, { integrity, hasOriginal: true, onVerify: () => undefined });
    expect(withBtn).toContain("Reverificar arquivo original");
    const ok = h(M.IntegrityPanel, { integrity, hasOriginal: true, verification: { applicable: true, status: "VERIFIED", message: "confere" } });
    expect(ok).toContain("Original conferido");
    const bad = h(M.IntegrityPanel, { integrity, hasOriginal: true, verification: { applicable: true, status: "MISMATCH", message: "NÃO confere" } });
    expect(bad).toContain("Original NÃO confere"); expect(bad).toContain('role="alert"');
    expect(h(M.IntegrityPanel, { integrity, hasOriginal: true, verification: { applicable: false, reason: "Sem arquivo original." } })).toContain("Sem arquivo original.");
  });
  it("origem de upload mostra o arquivo preservado (sha + verificação); formulário sem armazenamento explica e desabilita o envio de arquivo", () => {
    const up: OriginView = { ownership: "TENANT", source: "TENANT_UPLOAD", lineage: null, declaredAuthor: null, original: { sha256: H64, sizeBytes: 10, filename: "m.docx", contentType: "x", storageKey: `institutional-templates/1/originals/${H64}-m.docx`, preservation: "READBACK_SHA256" } };
    expect(originBadge({ origin: up, originState: "RECORDED" }).detail).toContain("arquivo enviado pela organização");
    const html = h(M.RegisterModelForm, { value: V.emptyRegisterForm("2026-10-14"), onChange: () => undefined, presets: [], documentKinds: ["edital"], today: "2026-10-14", hasDocx: false, uploadsAvailable: false, uploadsUnavailableReason: "O armazenamento de arquivos não está disponível." });
    expect(html).toContain("O armazenamento de arquivos não está disponível."); expect(html).toContain('data-testid="uploads-unavailable"');
    expect(html.match(/<input type="radio" disabled=""[^>]*name="reg-source"/g)).toHaveLength(2);   // Markdown e DOCX desabilitados; estrutura nativa segue disponível
  });
});

describe("derivação e upload", () => {
  it("formulário de derivação: slug canônico, nome, autor em uma linha, autoridade declarada e confirmação explícita", () => {
    const f = emptyDeriveForm("2026-10-14", "Edital BLL");
    expect(f.displayName).toBe("Edital BLL (adaptado)");
    expect(validateDeriveForm(f).valid).toBe(false);
    const ok = { ...f, slug: "edital-municipal", declaredAuthor: "Setor de Licitações", decision: dec };
    expect(validateDeriveForm(ok)).toEqual({ valid: true, errors: {} });
    for (const slug of ["", "Edital Municipal", "../x", "a--b", "-a"]) expect(validateDeriveForm({ ...ok, slug }).errors.slug, slug).toBeTruthy();
    expect(validateDeriveForm({ ...ok, declaredAuthor: "a\nb" }).errors.declaredAuthor).toBeTruthy();
    expect(validateDeriveForm({ ...ok, decision: { ...dec, confirmed: false } }).errors.confirmed).toBeTruthy();
    const html = h(M.DeriveTemplateForm, { sourceLabel: "Modelo da plataforma: Edital BLL", value: ok, onChange: () => undefined });
    expect(html).toContain("Modelo da plataforma: Edital BLL"); expect(html).toContain("permanece intacta"); expect(html).toContain("Não publica nem vincula nada");
  });
});

/**
 * Template Governance V2 — UX: origem (plataforma · própria · derivada), política do órgão, readiness por camada com justificativa,
 * derivação e upload. Renderizado no servidor (react-dom/server; env "node", sem jsdom). Prova o que a pessoa VÊ e as regras de habilitação.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import {
  canDeriveFrom, derivableRevision, emptyDeriveForm, emptyPolicyForm, filterByOwnership, groupChecksByLayer, legalPolicyExplanation, originBadge, ownershipCounts,
  policyHeadline, validateDeriveForm, validatePolicyForm, type CatalogRowView, type OriginView, type PolicyView, type ReadinessMatrixView,
} from "@/lib/institutionalTemplatesView";

type Mods = {
  OriginBadge: typeof import("./OriginBadge").OriginBadge;
  OwnershipTabs: typeof import("./OwnershipTabs").OwnershipTabs;
  TemplatePolicyCard: typeof import("./TemplatePolicyCard").TemplatePolicyCard;
  DeriveTemplateForm: typeof import("./DeriveTemplateForm").DeriveTemplateForm;
  ReadinessMatrixPanel: typeof import("./ReadinessMatrixPanel").ReadinessMatrixPanel;
  CatalogCard: typeof import("./CatalogCard").CatalogCard;
};
let M: Mods;
const h = (c: unknown, props: object) => renderToStaticMarkup(React.createElement(c as React.ComponentType<never>, props as never));
// `Link` (wouter) precisa de um roteador; no SSR de teste usa-se `ssrPath` (sem `location`/DOM).
const hr = (c: unknown, props: object) => renderToStaticMarkup(React.createElement(Router, { ssrPath: "/" }, React.createElement(c as React.ComponentType<never>, props as never)));
beforeAll(async () => {
  (globalThis as { React?: unknown }).React = React;
  M = { ...(await import("./OriginBadge")), ...(await import("./OwnershipTabs")), ...(await import("./TemplatePolicyCard")), ...(await import("./DeriveTemplateForm")), ...(await import("./ReadinessMatrixPanel")), ...(await import("./CatalogCard")) } as Mods;
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
const defaultPolicy: PolicyView = { kind: "PLATFORM_DEFAULT", version: 0, malformed: false, policy: { legalEvidence: "REQUIRED", approveMinRole: "manager", publishMinRole: "manager" }, history: [] };

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
  it("manchete explicita se é padrão da plataforma ou do órgão, o que é exigido e o que NÃO muda", () => {
    expect(policyHeadline(defaultPolicy)).toContain("Padrão da plataforma"); expect(policyHeadline(defaultPolicy)).toContain("OBRIGATÓRIA");
    const optional: PolicyView = { ...defaultPolicy, kind: "TENANT_DEFINED", version: 2, policy: { ...defaultPolicy.policy, legalEvidence: "OPTIONAL" } };
    expect(policyHeadline(optional)).toContain("versão 2"); expect(policyHeadline(optional)).toContain("OPCIONAL");
    expect(policyHeadline({ ...defaultPolicy, malformed: true })).toContain("padrão estrito");
  });

  it("formulário: exige autoridade/justificativa/confirmação humana e recusa 'sem alteração'; papel só manager|owner", () => {
    const f = emptyPolicyForm(defaultPolicy.policy, "2026-10-14");
    const v0 = validatePolicyForm(f, defaultPolicy);
    expect(v0.valid).toBe(false); expect(v0.errors.unchanged).toBeTruthy();
    expect(v0.errors.confirmed).toBeTruthy();                                                                        // sem checkbox pré-marcado
    expect(validatePolicyForm({ ...f, legalEvidence: "OPTIONAL", decision: dec }, defaultPolicy)).toEqual({ valid: true, errors: {} });
    expect(validatePolicyForm({ ...f, decision: dec }, defaultPolicy).errors.unchanged).toBeTruthy();
    // registro ilegível pode ser restabelecido sem mudar os valores
    expect(validatePolicyForm({ ...f, decision: dec }, { ...defaultPolicy, malformed: true }).valid).toBe(true);
  });

  it("card: papel sem permissão só lê; gerente vê 'Alterar política'; aviso de que não substitui a Procuradoria e histórico visível", () => {
    const base = { policy: { ...defaultPolicy, note: "Não substitui a análise jurídica dos documentos elaborados (Procuradoria).", history: [{ version: 1, policy: { legalEvidence: "OPTIONAL" as const, approveMinRole: "manager" as const, publishMinRole: "owner" as const }, declaredBy: { name: "Ana", role: "Secretária" }, actDate: "2026-10-01", reason: "Decisão do órgão" }] }, form: null, onOpen: () => undefined, onChange: () => undefined, onCancel: () => undefined, onSubmit: () => undefined };
    const ro = h(M.TemplatePolicyCard, { ...base, canEdit: false });
    expect(ro).toContain("Somente gerentes"); expect(ro).not.toContain("Alterar política"); expect(ro).toContain("Procuradoria"); expect(ro).toContain("Versão 1"); expect(ro).toContain("publicar ≥ owner");
    expect(h(M.TemplatePolicyCard, { ...base, canEdit: true })).toContain("Alterar política");
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
  it("com política obrigatória/padrão/ilegível: explica o bloqueio e NÃO oculta justificativas dos bloqueios", () => {
    const blocked = matrix({ overall: "BLOCKED", summary: { pass: 1, blocked: 1, notApplicable: 0 }, policy: { kind: "PLATFORM_DEFAULT", legalEvidence: "REQUIRED", decisionId: null, malformed: false },
      checks: [check("STRUCTURE", "TECHNICAL_TEMPLATE_READINESS", "PASS"), check("LEGAL_APPROVAL_EVIDENCE", "TENANT_TEMPLATE_POLICY", "BLOCKED")] as never });
    const html = h(M.ReadinessMatrixPanel, { matrix: blocked });
    expect(html).toContain("Padrão da plataforma"); expect(html).toContain("motivo do bloqueio"); expect(html).toContain('role="alert"');
    expect(legalPolicyExplanation({ kind: "TENANT_DEFINED", legalEvidence: "REQUIRED", decisionId: "x", malformed: false })).toContain("exige evidência");
    expect(legalPolicyExplanation({ kind: "PLATFORM_DEFAULT", legalEvidence: "REQUIRED", decisionId: null, malformed: true })).toContain("ESTRITO");
    expect(legalPolicyExplanation(undefined)).toContain("Padrão da plataforma");
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

/**
 * Operação do primeiro modelo — UI "last mile": (1) ativação governada de FF_INSTITUTIONAL_TEMPLATES_V1 pelo featureFlagAdmin existente
 * e (2) registro por MODEL_PACKAGE (pacote aprovado versionado no servidor). Sem DOM: lógica pura + SSR do formulário + guard estrutural.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  TEMPLATES_FLAG, TEMPLATES_REASON_MIN_LENGTH, buildTemplatesFlagRequest, canMutateTemplatesFlag, canSeeTemplatesFlagControl, validateTemplatesFlagReason,
} from "@/lib/featureFlags/templatesFlagSurface";
import type { RegistrationPresetView } from "@/lib/institutionalTemplatesView";

let V: typeof import("@/lib/institutionalTemplatesView");
let Form: typeof import("./RegisterModelForm").RegisterModelForm;
const h = (c: unknown, props: object) => renderToStaticMarkup(React.createElement(c as React.ComponentType<never>, props as never));
beforeAll(async () => {
  (globalThis as { React?: unknown }).React = React;
  V = await import("@/lib/institutionalTemplatesView");
  Form = (await import("./RegisterModelForm")).RegisterModelForm;
});

const SHA = "6795b2abc858660d5658d8ce55afa3633cdbab772e1a7e32fd771cec43997904";
const bll: RegistrationPresetView = {
  presetId: "EDITAL_PREGAO_ELETRONICO_BLL", templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", documentKind: "edital", slug: "edital-pregao-eletronico-bll",
  displayName: "Edital — Pregão Eletrônico — BLL", scope: { modality: "pregao", form: "eletronica", platform: "bll" },
  sourceKind: "MODEL_PACKAGE", sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA,
};
const filled = (over: object = {}) => ({ ...V.emptyRegisterForm("2026-10-08", bll), decidedByName: "Maria Souza", decidedByRole: "Procuradora", basisReference: "Ato 1/2026", reason: "Registro do primeiro modelo aprovado.", confirmed: true, ...over });
const render = (value: object, presets: RegistrationPresetView[] = [bll]) => h(Form, { value, onChange: () => undefined, presets, documentKinds: ["edital", "tr"], today: "2026-10-08", hasDocx: false });
const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("ativação governada — regras puras", () => {
  it("A/B: o controle aparece só para platform admin; non-admin não vê", () => {
    expect(canSeeTemplatesFlagControl("admin")).toBe(true);
    for (const r of ["owner", "manager", "operator", "viewer", "user", null, undefined]) expect(canSeeTemplatesFlagControl(r as never)).toBe(false);
  });
  it("A/C: a mutação só é permitida com writeAllowed=true do backend", () => {
    expect(canMutateTemplatesFlag({ writeAllowed: true })).toBe(true);
    expect(canMutateTemplatesFlag({ writeAllowed: false })).toBe(false);
    expect(canMutateTemplatesFlag(undefined)).toBe(false);
  });
  it("D: o payload usa a flagName EXATA, expiresAt null, o tenant recebido e a chave por operação", () => {
    const on = buildTemplatesFlagRequest({ organizationId: 1, enabled: true, reason: "  Habilitação controlada dos Modelos Institucionais.  ", idempotencyKey: "k-1" });
    expect(on).toEqual({ organizationId: 1, flagName: "FF_INSTITUTIONAL_TEMPLATES_V1", enabled: true, expiresAt: null, reason: "Habilitação controlada dos Modelos Institucionais.", idempotencyKey: "k-1" });
    expect(TEMPLATES_FLAG).toBe("FF_INSTITUTIONAL_TEMPLATES_V1");
    expect(buildTemplatesFlagRequest({ organizationId: 1, enabled: false, reason: "Desativação controlada.....", idempotencyKey: "k-2" }).enabled).toBe(false);
  });
  it("justificativa obrigatória (mínimo espelhado do backend)", () => {
    expect(validateTemplatesFlagReason("").valid).toBe(false);
    expect(validateTemplatesFlagReason("x".repeat(TEMPLATES_REASON_MIN_LENGTH - 1)).valid).toBe(false);
    expect(validateTemplatesFlagReason("x".repeat(TEMPLATES_REASON_MIN_LENGTH)).valid).toBe(true);
  });
});

describe("ativação governada — guard estrutural do card e da página", () => {
  const card = read("client/src/components/institutionalTemplates/TemplateActivationCard.tsx");
  const code = strip(card);
  const page = strip(read("client/src/pages/InstitutionalTemplates.tsx"));
  it("E: só getTenantFlag/setTenantFlag; nenhuma flag arbitrária, organizationId digitado, DB, localStorage ou ENV", () => {
    expect(card).toContain("featureFlagAdmin.getTenantFlag.useQuery");
    expect(card).toContain("featureFlagAdmin.setTenantFlag.useMutation");
    expect(code).not.toMatch(/setFlagName|flagNameInput|flagName:\s*[a-z]\w*State/);
    expect(code).not.toMatch(/<Input[^>]*organizationId|setOrganizationId|useState<number/);
    expect(code).not.toMatch(/from\s+["'].*server\/|tenant_feature_flags|getDb\(|localStorage|sessionStorage|process\.env|import\.meta\.env|railway/i);
    expect((code.match(/FF_[A-Z_0-9]+/g) ?? []).filter((f) => f !== "FF_INSTITUTIONAL_TEMPLATES_V1")).toEqual([]);
    expect(code).toContain("crypto.randomUUID()");
    expect(code).toMatch(/role|canSeeTemplatesFlagControl/);
  });
  it("F: após o sucesso refaz a consulta da flag e invalida/refaz getCapabilities", () => {
    expect(code).toMatch(/onSuccess[\s\S]*flag\.refetch\(\)[\s\S]*onChanged\(\)/);
    expect(page).toMatch(/TemplateActivationCard[^>]*organizationId=\{caps\.data\.organizationId\}/);
    expect(page).toMatch(/onChanged=\{\(\) => \{ void utils\.institutionalTemplates\.getCapabilities\.invalidate\(\)/);
  });
  it("o organizationId vem do contexto autenticado (getCapabilities), nunca de campo digitado, slug, URL ou localStorage", () => {
    expect(page).not.toMatch(/useParams\(\)[\s\S]{0,80}organizationId|localStorage/);
  });
});

describe("registro por MODEL_PACKAGE", () => {
  it("G: selecionar o preset BLL define sourceKind=MODEL_PACKAGE, com versão lógica e SHA-256 do servidor", () => {
    const f = V.emptyRegisterForm("2026-10-08", bll);
    expect(f.sourceKind).toBe("MODEL_PACKAGE");
    expect(f.sourceLogicalVersion).toBe("1.0.1-draft");
    expect(f.sourceSha256).toBe(SHA);
    expect(f.templateKey).toBe("EDITAL_PREGAO_ELETRONICO_BLL");
  });
  it("H/I: no modo pacote não pede AST/Markdown/DOCX/inventário; metadados do pacote ficam read-only", () => {
    const html = render(filled());
    expect(html).toContain("Pacote aprovado versionado no servidor");
    expect(html).toContain(SHA);
    expect(html).toContain("1.0.1-draft");
    expect(html).not.toContain("Conteúdo-fonte\" ");                 // sem textarea de conteúdo
    expect(html).not.toMatch(/<textarea[^>]*aria-label="Conteúdo-fonte"/);
    expect(html).not.toContain('type="file"');
    expect(html).not.toContain("reg-inventory");
    for (const id of ["reg-templateKey", "reg-sourceLogicalVersion", "reg-sourceSha256"]) expect(html).toMatch(new RegExp(`id="${id}"[^>]*readOnly=""|readOnly=""[^>]*id="${id}"`));
  });
  it("J: o payload do pacote é {kind:'MODEL_PACKAGE', modelKey} — nenhum conteúdo jurídico trafega", () => {
    expect(V.packageSourceOf(filled())).toEqual({ kind: "MODEL_PACKAGE", modelKey: "EDITAL_PREGAO_ELETRONICO_BLL" });
    const page = strip(read("client/src/pages/InstitutionalTemplates.tsx"));
    expect(page).toContain("packageSourceOf(reg)");
    expect(page).toMatch(/reg\.sourceKind !== "MODEL_PACKAGE" && reg\.inventoryText/);
  });
  it("K: o registro continua só DRAFT (aviso, confirmação humana, sem auto-aprovar/publicar/vincular)", () => {
    const html = render(filled({ confirmed: false }));
    expect(html).toContain("RASCUNHO (DRAFT)");
    expect(html).toContain("Nunca aprova nem publica");
    expect(V.validateRegisterForm(filled({ confirmed: false }), false).errors.confirmed).toBeTruthy();
    const v = V.validateRegisterForm(filled(), false);
    expect(v.valid).toBe(true);                                       // pacote válido SEM texto-fonte nem inventário
    for (const k of ["decidedByName", "decidedByRole", "decidedAt", "basisReference", "reason"]) expect(V.validateRegisterForm(filled({ [k]: "" }), false).errors[k], k).toBeTruthy();
  });
  it("L: o registro livre AST/MARKDOWN/DOCX continua funcionando (inclui validação e campos editáveis)", () => {
    const free = { ...V.emptyRegisterForm("2026-10-08"), slug: "meu-modelo", templateKey: "MEU_MODELO", displayName: "Meu modelo", scope: { ...V.emptyRegisterForm("2026-10-08").scope, modality: "pregao", form: "eletronica" },
      sourceKind: "AST" as const, sourceText: '{"schema":"tpl-ast/1","root":[]}', sourceLogicalVersion: "1", sourceSha256: "a".repeat(64), decidedByName: "A", decidedByRole: "B", basisReference: "C", reason: "Registro livre de teste.", confirmed: true };
    expect(V.validateRegisterForm(free, false).errors.source).toBeUndefined();
    expect(V.validateRegisterForm({ ...free, sourceText: "{" }, false).errors.source).toBeTruthy();
    expect(V.validateRegisterForm({ ...free, sourceKind: "DOCX", sourceText: "" }, true).errors.source).toBeUndefined();
    const html = render(free, [bll]);
    expect(html).toContain("AST nativo (JSON)");
    expect(html).toMatch(/aria-label="Conteúdo-fonte"/);
    expect(html).not.toMatch(/id="reg-sourceSha256"[^>]*readOnly=""/);
  });
  it("sem preset de pacote (registro livre) a opção de pacote não é oferecida", () => {
    expect(render(V.emptyRegisterForm("2026-10-08"), [])).not.toContain("Pacote aprovado versionado no servidor");
  });
});

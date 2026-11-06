/**
 * Correção pós-homologação H5 (staging, processo 2167/2026):
 *
 *  F1 — o backend autoriza `manager` a governar o Perfil de Licitações (`institutionalTemplates.governed.recordOrganizationFields`/
 *       `recordLicitacoesProfile` = `templatesProcedure("govern")`, piso `manager` + membership REAL), mas a única tela do Perfil ficava em
 *       Configurações (admin+) ⇒ os links "Configurar agora" / "Informar no Perfil de Licitações" / "Abrir o Perfil" levavam a "Acesso não
 *       autorizado". Correção mínima: rota PRÓPRIA `/perfil-licitacoes` com o MESMO painel, liberada ao piso que o backend já aplica; nada do
 *       backend muda; Configurações (identidade institucional, usuários) continua admin+.
 *  F2 — "(padrão: veda)" (descrição técnica do catálogo publicado) aparecia na lista de pendências e em "Antes de publicar", sugerindo uma
 *       decisão que não existe. Rótulo NEUTRO só na apresentação; catálogo, AST, hash semântico, manifests e documentos inalterados.
 *
 * Puro (sem banco); a reautorização do backend com MySQL está nos smokes de RBAC/isolamento já existentes.
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { TEMPLATE_ACTION_MIN_ROLE } from "../../services/institutionalTemplates/authority";
import { describeVariable } from "../../services/institutionalTemplates/editalPreparationService";
import { presentationOf } from "../../domain/institutionalTemplates/editalPresentation";
import { CONTENT_PENDING_VARIABLES } from "../../domain/institutionalTemplates/contentPending";
import { composeTemplate } from "../../domain/institutionalTemplates/composer";
import type { TemplateAST2, VariableCatalog2 } from "../../domain/institutionalTemplates";
import { BLL_MODEL_DIR, FULL_SCENARIO, bllCatalog, bllComposeRequest } from "../helpers/institutionalTemplatesBllHarness";
import {
  ORG_ROLE_RANK, canGovernLicitacoesProfile, canManageOrgUsers, LICITACOES_PROFILE_PATH, type OrgRole,
} from "../../../client/src/utils/orgPermissions";
import { fixAction } from "../../../client/src/lib/editalPreparation";
import { publicationPending } from "../../../client/src/lib/editalReadiness";
import type { PreparationStateView } from "../../../client/src/lib/editalPreparation";
import { isPublicRoute } from "../../../client/src/lib/publicRoutes";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const ROLES: readonly OrgRole[] = ["viewer", "operator", "manager", "admin", "owner"];

describe("F1 — acesso ao Perfil de Licitações para quem o backend autoriza (manager+)", () => {
  it("1) manager, admin e owner governam o Perfil; operator, viewer e sem papel não", () => {
    expect(ROLES.filter((r) => canGovernLicitacoesProfile(r))).toEqual(["manager", "admin", "owner"]);
    expect(canGovernLicitacoesProfile(null)).toBe(false);
    expect(canGovernLicitacoesProfile(undefined)).toBe(false);
  });

  it("2) espelho EXATO do piso `govern` do backend (se o backend mudar, este teste quebra)", () => {
    expect(TEMPLATE_ACTION_MIN_ROLE.govern).toBe("manager");
    for (const r of ROLES) expect(canGovernLicitacoesProfile(r), r).toBe(ORG_ROLE_RANK[r] >= ORG_ROLE_RANK[TEMPLATE_ACTION_MIN_ROLE.govern]);
  });

  it("3) não concede gestão de usuários/identidade institucional: manager continua SEM `canManageOrgUsers`", () => {
    expect(canManageOrgUsers("manager")).toBe(false);
    expect(canManageOrgUsers("admin")).toBe(true);
  });

  it("4) backend inalterado: gravações do Perfil continuam `govern` + membership real; leitura continua tenant-scoped", () => {
    const router = read("server/routers/institutionalTemplatesRouter.ts");
    expect(router).toMatch(/recordOrganizationFields: templatesProcedure\("govern"\)/);
    expect(router).toMatch(/recordLicitacoesProfile: templatesProcedure\("govern"\)/);
    expect(router).toMatch(/INSTITUTIONAL_TEMPLATE_ACTIONS[^=]*= new Set<TemplateAction>\(\[[^\]]*"govern"/);
    expect(router).toMatch(/requireInstitutionalAuthority\(/);
    const proc = read("server/routers/procurementProcessRouter.ts");
    expect(proc).toMatch(/licitacoesProfile: tenantProcedure/);
  });

  it("5) rota dedicada autenticada (shell), não pública; Configurações continua existindo", () => {
    expect(LICITACOES_PROFILE_PATH).toBe("/perfil-licitacoes");
    const app = read("client/src/App.tsx");
    expect(app).toContain("const LicitacoesProfileRoute = withAuthenticatedShell(LicitacoesProfilePage);");
    expect(app).toContain('<Route path={"/perfil-licitacoes"} component={LicitacoesProfileRoute} />');
    expect(app).toContain('<Route path={"/configuracoes"} component={SettingsRoute} />');
    expect(isPublicRoute("/perfil-licitacoes")).toBe(false);
  });

  it("6) página reaplica o gate ANTES do painel e reutiliza o MESMO painel (sem segunda implementação, sem dados administrativos)", () => {
    const page = read("client/src/pages/LicitacoesProfile.tsx");
    expect(page).toContain('import LicitacoesProfilePanel from "@/components/procurement/LicitacoesProfilePanel";');
    const gate = page.indexOf("if (!canGovernLicitacoesProfile(role)) return <LicitacoesProfileAccessDenied");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(page.lastIndexOf("<LicitacoesProfilePanel />"));
    // A página não toca usuários, identidade documental, segredos, integrações nem billing; não chama tRPC por conta própria.
    expect(page).not.toMatch(/trpc\.|documentSettings|billing|invitation|listMembers|organizationUsers|secret/i);
    // Configurações continua admin+ e mantém o mesmo painel para administradores.
    const settings = read("client/src/pages/Settings.tsx");
    expect(settings).toMatch(/if \(!canManageUsers\)/);
    expect(settings).toContain("<LicitacoesProfilePanel />");
    // Um único painel no código cliente.
    expect(read("client/src/components/procurement/LicitacoesProfilePanel.tsx")).toContain("export default function LicitacoesProfilePanel()");
  });

  it("7) operador/visualizador recebem mensagem clara (sem formulário, sem leitura do Perfil)", async () => {
    (globalThis as { React?: unknown }).React = React;
    const { LicitacoesProfileAccessDenied } = await import("../../../client/src/pages/LicitacoesProfile");
    const op = renderToStaticMarkup(React.createElement(LicitacoesProfileAccessDenied, { role: "operator" }));
    expect(op).toContain("Acesso restrito ao Perfil de Licitações");
    expect(op).toContain("mantido por Gestores e Administradores");
    expect(op).toContain("Seu papel neste órgão: Operador.");
    expect(op).not.toMatch(/<form|<input|<button/);
    const none = renderToStaticMarkup(React.createElement(LicitacoesProfileAccessDenied, { role: null }));
    expect(none).toContain("Acesso restrito ao Perfil de Licitações");
    expect(none).not.toContain("Seu papel");
  });

  it("8) menu: item próprio para manager+ (e módulo ligado); Configurações/Usuários continuam só admin+", () => {
    const layout = read("client/src/components/DashboardLayout.tsx");
    expect(layout).toMatch(/label: "Perfil de Licitações", path: "\/perfil-licitacoes", requiresLicitacoesProfileGovern: true, requiresInstitutionalTemplates: true/);
    expect(layout).toContain("canGovernLicitacoesProfile(orgRole)");
    expect(layout).toMatch(/label: "Configurações", path: "\/configuracoes", requiresOrgAdmin: true/);
    expect(layout).toMatch(/label: "Usuários", path: "\/usuarios", requiresOrgAdmin: true/);
  });

  it("9) os links da preparação levam à rota acessível; cadastro do órgão (identidade) continua em Configurações", () => {
    expect(fixAction("PLATFORM_PROFILE")).toMatchObject({ href: "/perfil-licitacoes" });
    expect(fixAction("ORG_PROFILE")).toMatchObject({ href: "/perfil-licitacoes" });
    expect(fixAction("ORG_REGISTRY")).toMatchObject({ href: "/configuracoes" });
    const view = read("client/src/components/procurement/EditalPreparationView.tsx");
    expect(view).not.toContain("/configuracoes#perfil-licitacoes");
    expect(view.match(/href=\{LICITACOES_PROFILE_PATH\}/g)?.length).toBe(3);
    expect(read("client/src/lib/editalPreparation.ts")).not.toContain("/configuracoes#perfil-licitacoes");
  });

  it("10) título de navegação da nova rota", () => {
    expect(read("client/src/hooks/useNavigationHistory.ts")).toContain('"/perfil-licitacoes": "Perfil de Licitações"');
  });
});

describe("F2 — rótulo neutro para a adesão à Ata (apresentação apenas)", () => {
  const ADESAO = "decisao.adesaoAta";
  const CATALOG_DIRS = ["edital-pregao-eletronico-bll", "edital-pregao-eletronico-bll-1.0.2"];
  const catalogOf = (dir: string) => JSON.parse(read(`server/domain/institutionalTemplates/models/${dir}/catalog.v2.json`)) as VariableCatalog2;

  it("1) o descritor das duas revisões publicadas traz rótulo neutro (sem 'padrão', sem presumir veda/admite)", () => {
    for (const dir of CATALOG_DIRS) {
      const d = describeVariable(catalogOf(dir).vars.find((v) => v.name === ADESAO)!);
      expect(d.description, dir).toBe("Adesão à Ata de Registro de Preços");
      expect(d.description).not.toMatch(/padr[ãa]o|veda|admite/i);
      expect(d.question).toMatch(/nenhuma opção é presumida/);
      expect(d.enumValues).toEqual(catalogOf(dir).vars.find((v) => v.name === ADESAO)!.enumValues);   // opções intactas
    }
    expect(presentationOf(ADESAO)?.label).toBe(CONTENT_PENDING_VARIABLES[ADESAO]!.label);   // mesmo rótulo da política informativa
  });

  it("2) catálogo publicado, AST e mapeamento INALTERADOS (bytes idênticos ao último estado publicado)", () => {
    // A descrição técnica continua no catálogo (fonte do hash semântico); só a apresentação mudou.
    for (const dir of CATALOG_DIRS) {
      expect(catalogOf(dir).vars.find((v) => v.name === ADESAO)!.description).toContain("(padrão: veda)");
    }
    const sha = (rel: string) => createHash("sha256").update(readFileSync(path.join(ROOT, `server/domain/institutionalTemplates/models/${rel}`))).digest("hex");
    expect(sha("edital-pregao-eletronico-bll/catalog.v2.json")).toBe("deb5685d514e504f72b12bd33bfdab39b92048c59060c9cbe3ea6d01313fdaa1");
    expect(sha("edital-pregao-eletronico-bll/ast.json")).toBe("f416477f36d50168d7e3835d011fe53b563b8b0351409a37fa68b0a917624e11");
    expect(sha("edital-pregao-eletronico-bll-1.0.2/catalog.v2.json")).toBe("15481326b8ce6ebbdcf2a4784f8db7f34b1bab8632fa42f1d436a3de2ef5241a");
    // Nenhum módulo de composição/manifesto/pendência de conteúdo importa a camada de apresentação.
    for (const rel of ["server/domain/institutionalTemplates/composer.ts", "server/domain/institutionalTemplates/manifest.ts", "server/domain/institutionalTemplates/contentPending.ts"]) {
      expect(read(rel), rel).not.toContain("editalPresentation");
    }
  });

  it("3) a composição não muda: com a política ausente não escolhe ramo; com 'veda' registrada usa o valor do órgão (determinístico)", () => {
    const ast = JSON.parse(readFileSync(path.join(BLL_MODEL_DIR, "ast.json"), "utf8")) as TemplateAST2;
    const AI = ["justificativa-art49-lc123", "justificativa-vedacao-consorcio", "justificativa-vedacao-subcontratacao", "obrigacoes-especificas-contratado", "obrigacoes-especificas-contratante", "finalidades-tratamento-dados"];
    const aiNarratives = AI.map((slotKey) => ({ organizationId: 975001, slotKey, executionId: `aiexec_${slotKey}`, text: `Texto proposto para ${slotKey}, sujeito a revisão humana.` }));
    const compose = (omit: readonly string[]) => composeTemplate(bllComposeRequest(ast, FULL_SCENARIO, { aiNarratives }, omit));
    const absent = compose([ADESAO]);
    if (!absent.ok) throw new Error(JSON.stringify(absent.issues).slice(0, 400));
    expect(absent.value.content.text).toContain(CONTENT_PENDING_VARIABLES[ADESAO]!.absentText);
    expect(absent.value.content.text).not.toMatch(/Não será admitida a adesão à Ata|Será admitida a adesão à Ata/);
    const a = compose([]), b = compose([]);
    if (!a.ok || !b.ok) throw new Error("composição com política registrada falhou");
    expect(a.value.content.text).toBe(b.value.content.text);
    expect(a.value.content.text).not.toContain(CONTENT_PENDING_VARIABLES[ADESAO]!.absentText);
    expect(bllCatalog.vars.find((v) => v.name === ADESAO)!.description).toContain("(padrão: veda)");
  });

  describe("listas da tela (pendências informativas e 'Antes de publicar')", () => {
    const label = describeVariable(bllCatalog.vars.find((v) => v.name === ADESAO)!).description;
    const pending = [{ name: ADESAO, description: label, reason: "Ainda não registrada no Perfil de Licitações", fix: "ORG_PROFILE" as const, providedBy: "Autoridade competente do órgão (Perfil de Licitações)", neededBefore: "PUBLICATION" as const }];
    const state = (over: Partial<PreparationStateView> = {}): PreparationStateView => ({
      status: "READY_FOR_PREPARATION", revisionId: "r2", catalogVersion: "cat/2", revisions: { process: 0, organization: 0, budget: 0 }, budgetDisclosure: "publico",
      participation: { default: "Ampla participação" }, participationPending: false, trPin: { state: "VALID", ref: { documentId: "d", version: 1, contentHash: "h" } }, sections: [], facts: {},
      canonicalFields: [], orgProfile: null, summary: { groups: [], reusedAutomatically: 0, pendingDecisions: 0 },
      metrics: { TOTAL_TEMPLATE_FIELDS: 0, AUTO_RESOLVED: 0, ORG_REUSED: 0, TR_PROJECTED: 0, DECIDED: 0, CONDITIONAL_HIDDEN: 0, POST_AWARD_HIDDEN: 0, OPTIONAL_HIDDEN: 0, MANUAL_DECISIONS_VISIBLE: 0, LEGACY_SHADOWED: 0 },
      upstream: { trDigest: "x", trPending: [], sourcePending: [], profilePending: [], contentPending: pending },
      ...over,
    } as PreparationStateView);
    let Notice: typeof import("../../../client/src/components/procurement/PublicationPendingNotice").PublicationPendingNotice;
    let View: typeof import("../../../client/src/components/procurement/EditalPreparationView").default;
    beforeAll(async () => {
      (globalThis as { React?: unknown }).React = React;
      Notice = (await import("../../../client/src/components/procurement/PublicationPendingNotice")).PublicationPendingNotice;
      View = (await import("../../../client/src/components/procurement/EditalPreparationView")).default;
    });

    it("4) 'Antes de publicar' (elaboração e finalização) mostra o rótulo neutro e o marcador, nunca '(padrão: veda)'", () => {
      const v = publicationPending(state());
      expect(v.items).toEqual([{ name: ADESAO, label: "Adesão à Ata de Registro de Preços" }]);
      for (const variant of ["drafting", "finalizing"] as const) {
        const html = renderToStaticMarkup(React.createElement(Notice, { pending: v, variant }));
        expect(html, variant).toContain("Adesão à Ata de Registro de Preços");
        expect(html, variant).not.toMatch(/padr[ãa]o: veda/);
      }
    });

    it("5) lista de pendências informativas da preparação: rótulo neutro + caminho acessível ao Perfil", async () => {
      const { pendingItems, optionalItems } = await import("../../../client/src/lib/editalPreparation");
      const st = state();
      const noop = () => {};
      const out = renderToStaticMarkup(React.createElement(View as unknown as React.ComponentType<never>, {
        state: st, edits: {}, fieldErrors: {}, pending: pendingItems(st), optional: optionalItems(st), onEdit: noop, plan: { writes: [], errors: {}, decisionCount: 0 }, reviewing: false,
        onStartReview: noop, onCancelReview: noop, decision: { decidedByName: "", decidedByRole: "", decidedAt: "2026-11-06", basisReference: "", reason: "", confirmed: false },
        onDecision: noop, showErrors: false, busy: false, outcome: null, notice: null, onConfirm: noop,
      } as never));
      expect(out).toContain("Pendências informativas — não impedem gerar a minuta");
      expect(out).toContain("<strong>Adesão à Ata de Registro de Preços</strong>");
      expect(out).not.toMatch(/padr[ãa]o: veda/);
      expect(out).toContain('href="/perfil-licitacoes"');
    });

    it("6) valor DECIDIDO continua exibido como registrado (a pendência some; opções do catálogo intactas para o Perfil)", () => {
      const decided = publicationPending(state({ upstream: { trDigest: "x", trPending: [], sourcePending: [], profilePending: [], contentPending: [] } }));
      expect(decided.items).toEqual([]);
      const d = describeVariable(bllCatalog.vars.find((v) => v.name === ADESAO)!);
      expect(d.enumValues).toEqual(["admite", "veda"]);
      expect(d.type).toBe(bllCatalog.vars.find((v) => v.name === ADESAO)!.type);
    });
  });
});

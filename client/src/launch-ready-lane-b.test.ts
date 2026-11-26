/**
 * LICIGOV-LAUNCH-READY — Lane B — comunicação pública e de produto coerente com o comportamento real.
 * PRD-01 landing · PRD-02 emissão · PRD-03 privacidade/termos · PRD-04 cadastro · PRD-05 links/credenciamento · COM-01 proposta.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DraftReviewNotice, DRAFT_REVIEW_NOTICE_TEXT } from "./components/procurement/DraftReviewNotice";

(globalThis as { React?: typeof React }).React = React;

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("PRD-01 — landing sem promessa de publicação externa nem alegação absoluta", () => {
  const landing = read("client/src/pages/LandingPage.tsx");
  it("Edital prepara minuta; não 'publica'", () => {
    expect(landing).not.toContain("Publica com segurança");
    expect(landing).toContain("Prepara a minuta a partir do processo");
  });
  it("sem 'seguro no conteúdo' absoluto", () => {
    expect(landing).not.toContain("seguro no conteúdo");
  });
});

describe("PRD-02 — emissão interna comunicada conforme o backend (sem 'terceiro obrigatório')", () => {
  const files = [
    "client/src/components/procurement/ETPWorkspace.tsx",
    "client/src/components/procurement/TRWorkspace.tsx",
    "client/src/components/procurement/EditalWorkspace.tsx",
    "client/src/components/ingestion/DocumentImportPanel.tsx",
    "server/domain/processIssuance.ts",
  ];
  it.each(files)("%s não afirma revisão obrigatória por terceiro", (f) => {
    expect(read(f)).not.toMatch(/revisão de (um )?terceiro/);
  });
  it("ETP/TR/Edital usam o aviso único", () => {
    for (const f of files.slice(0, 3)) expect(read(f)).toContain("<DraftReviewNotice");
  });
  it("aviso distingue emissão interna de parecer, aprovação, assinatura e publicação", () => {
    const html = renderToStaticMarkup(createElement(DraftReviewNotice, { origin: "Gerado com base no processo ou importado." }));
    expect(html).toContain("Revisão obrigatória.");
    expect(html).toContain("Gerado com base no processo ou importado.");
    for (const term of ["papel de gestor", "parecer jurídico", "aprovação da autoridade competente", "assinatura", "publicação"]) {
      expect(DRAFT_REVIEW_NOTICE_TEXT).toContain(term);
    }
  });
  it("o backend continua exigindo papel mínimo manager (texto ancorado na regra real)", () => {
    expect(read("server/services/documentPromotionService.ts")).toMatch(/MIN_EMIT_ROLE: OrgRole = "manager"/);
  });
  it("Edital: 'antes da emissão' (não 'antes da aprovação')", () => {
    expect(read("client/src/components/procurement/EditalWorkspace.tsx")).not.toContain("antes da aprovação");
  });
});

describe("PRD-03 — privacidade/termos sem afirmações factuais falsas", () => {
  const privacy = read("client/src/pages/PrivacyPolicy.tsx");
  const terms = read("client/src/pages/TermsOfUse.tsx");
  it("sem OAuth, sem 'servidores no Brasil', sem conformidade absoluta, sem criptografia em repouso não verificada", () => {
    expect(privacy).not.toContain("OAuth");
    expect(privacy).not.toContain("localizados no Brasil");
    expect(privacy).not.toContain("em conformidade com a Lei Geral");
    expect(privacy).not.toContain("em repouso");
  });
  it("termos não exigem criar conta (acesso por convite) e não prometem publicação", () => {
    expect(terms).not.toContain("você deve criar uma conta");
    expect(terms).toContain("não publica documentos em portais oficiais");
  });
  it("Voltar não leva visitante público a /configuracoes", () => {
    expect(privacy).not.toContain('setLocation("/configuracoes")');
    expect(terms).not.toContain('setLocation("/configuracoes")');
  });
  it("minuta institucional existe e está marcada como não publicável", () => {
    const draft = read("docs/legal/PRIVACY_TERMS_LAUNCH_READY_DRAFT.md");
    expect(draft).toContain("NÃO PUBLICAR");
    expect(draft).toContain("[PENDENTE");
  });
});

describe("PRD-04 — 'Criar conta' só quando o cadastro público está habilitado", () => {
  it("Login condiciona o link ao registrationStatus e orienta o acesso por convite", () => {
    const login = read("client/src/pages/Login.tsx");
    expect(login).toContain("trpc.auth.registrationStatus.useQuery");
    expect(login).toMatch(/registrationStatus\.data\?\.publicRegistrationEnabled \?/);
    expect(login).toContain("convite do administrador do seu órgão");
    expect(login).toContain('href="/termos"');
    expect(login).toContain('href="/privacidade"');
  });
  it("Register é fail-closed: sem confirmação do servidor, não mostra o formulário", () => {
    const reg = read("client/src/pages/Register.tsx");
    expect(reg).toContain("publicRegistrationEnabled === true");
    expect(reg).toContain('data-testid="register-disabled"');
  });
});

describe("PRD-05 — links e recursos anunciados existem", () => {
  it("sem navegação para a rota inexistente /process/:id", () => {
    expect(read("client/src/components/NotificationBell.tsx")).not.toContain("/process/${");
    expect(read("client/src/pages/PublicationLogs.tsx")).not.toContain("/process/${");
  });
  it("Contratação Direta não anuncia credenciamento (fluxo só tem dispensa/inexigibilidade)", () => {
    expect(read("client/src/pages/ExecutiveDashboard.tsx")).not.toMatch(/Dispensa, inexigibilidade, credenciamento/);
  });
});

describe("COM-01 — solicitação de proposta é manifestação de interesse", () => {
  const page = read("client/src/pages/SolicitarProposta.tsx");
  it("sem orientação de empenho nem promessa de liberação em 48h", () => {
    expect(page).not.toContain("48h");
    expect(page).not.toMatch(/empenho/i);
  });
  it("mensagem de sucesso sugerida e ausência de obrigação", () => {
    expect(page).toContain("Nossa equipe entrará em contato para apresentar a plataforma e esclarecer as");
    expect(page).toContain("A eventual contratação observará os procedimentos legais aplicáveis ao órgão.");
    expect(page).toContain("não gera obrigação contratual");
  });
  it("sucesso só depois da persistência (await mutateAsync antes de setStep)", () => {
    expect(page).toMatch(/await createProposalMutation\.mutateAsync\(formData\);\s*setStep\("success"\)/);
  });
});

describe("Convergência LR-03/LR-07 — jornada comercial institucional", () => {
  it("/planos não exibe checkout: rota e página redirecionam para a proposta", () => {
    const app = read("client/src/App.tsx");
    expect(app).toMatch(/path=\{"\/planos"\} component=\{\(\) => <Redirect to="\/solicitar-proposta" replace \/>\}/);
    const plans = read("client/src/pages/Plans.tsx");
    expect(plans).not.toMatch(/useMutation|<Button|billing\./);
    expect(plans).toContain('<Redirect to="/solicitar-proposta" replace />');
  });
  it("proposta sem seleção de plano/preço de seed", () => {
    const page = read("client/src/pages/SolicitarProposta.tsx");
    expect(page).not.toMatch(/R\$ \d|planSlug|municipal-basico/);
  });
  it("gestão comercial sem 'Ativar Assinatura' e sem proposal.id como user.id", () => {
    const mgmt = read("client/src/pages/CommercialManagement.tsx");
    const table = read("client/src/components/commercial/CommercialProposalsTable.tsx");
    expect(mgmt).not.toMatch(/activateSubscription|userId: proposalId/);
    expect(table).not.toMatch(/onActivate|<CheckCircle/);
    expect(mgmt).toContain("/admin/organizacoes");
  });
  it("landing não anuncia busca completa CATMAT/CATSER nem recurso sob flag como oferta geral", () => {
    const landing = read("client/src/pages/LandingPage.tsx");
    expect(landing).toContain("Apoio à classificação CATMAT/CATSER");
    expect(landing).toContain("Modelos institucionais (habilitáveis por órgão)");
  });
});

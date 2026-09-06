/**
 * Regressão da V1 UI/UX Stabilization — NAVEGAÇÃO e identidade de telas.
 *
 * Testes ESTRUTURAIS (leitura de fonte, sem DOM — coerente com o ambiente vitest
 * "node" do projeto e com darkmode-tokens.test.ts). Protegem contra três regressões
 * concretas observadas na homologação manual:
 *  1. Dashboard e Centro de Operações voltarem a ser ALIAS da mesma tela.
 *  2. Itens do menu lateral voltarem a renderizar FORA do shell (sem sidebar).
 *  3. O workspace do Parecer voltar a ficar SEM afordância de retorno à Caixa.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

describe("V1 UI/UX · Dashboard × Centro de Operações NÃO são alias", () => {
  const app = read("client/src/App.tsx");

  it("ExecutiveDashboard é importado e ligado a /dashboard", () => {
    expect(app).toMatch(/import\s+ExecutiveDashboard\s+from\s+["']\.\/pages\/ExecutiveDashboard["']/);
    expect(app).toMatch(/const\s+DashboardShellRoute\s*=\s*withAuthenticatedShell\(ExecutiveDashboard\)/);
    expect(app).toMatch(/path=\{"\/dashboard"\}\s+component=\{DashboardShellRoute\}/);
  });

  it("/centro-operacoes serve o workspace operacional (CentroOperacoes)", () => {
    expect(app).toMatch(/const\s+OperationsHomeShellRoute\s*=\s*withAuthenticatedShell\(CentroOperacoes\)/);
    expect(app).toMatch(/path=\{"\/centro-operacoes"\}\s+component=\{OperationsHomeShellRoute\}/);
  });

  it("as duas rotas apontam para componentes DIFERENTES (sem alias acidental)", () => {
    const dashRoute = app.match(/path=\{"\/dashboard"\}\s+component=\{(\w+)\}/)?.[1];
    const centroRoute = app.match(/path=\{"\/centro-operacoes"\}\s+component=\{(\w+)\}/)?.[1];
    expect(dashRoute).toBeTruthy();
    expect(centroRoute).toBeTruthy();
    expect(dashRoute).not.toBe(centroRoute);
  });

  it("Dashboard usa SOMENTE dados já existentes (departmentOperation.*), sem backend novo", () => {
    const dash = read("client/src/pages/ExecutiveDashboard.tsx");
    // Consome os mesmos endpoints já existentes; não cria nova rota tRPC.
    expect(dash).toMatch(/departmentOperation\.(indicators|dashboard)/);
    expect(dash).toMatch(/OperationalIndicators/);
  });
});

describe("V1 UI/UX · itens do menu lateral renderizam DENTRO do shell (sidebar consistente)", () => {
  const app = read("client/src/App.tsx");

  it.each([
    ["Settings", "SettingsRoute"],
    ["Templates", "TemplatesRoute"],
    ["AdminPlatforms", "AdminPlatformsRoute"],
  ])("%s renderiza no shell (withAuthenticatedShell)", (component, routeConst) => {
    const re = new RegExp(`const\\s+${routeConst}\\s*=\\s*withAuthenticatedShell\\(${component}\\)`);
    expect(app).toMatch(re);
  });

  it("Settings não volta mais para a landing pública ('/') no Cancelar", () => {
    const settings = read("client/src/pages/Settings.tsx");
    // O botão Cancelar aponta para a home autenticada, não para a landing.
    expect(settings).toMatch(/setLocation\("\/dashboard"\)/);
  });
});

describe("V1 UI/UX · afordância de Voltar em workspaces/subfluxos", () => {
  it("Parecer: workspace aberto oferece 'Voltar à caixa' que limpa o workspace sem mutação", () => {
    const src = read("client/src/components/legal-opinion/LegalOpinionHome.tsx");
    expect(src).toMatch(/Voltar à caixa/);
    // O retorno é puramente de estado (limpa workspaceId) — sem mutação, sem reload.
    expect(src).toMatch(/onClick=\{\(\)\s*=>\s*setWorkspaceId\(""\)\}/);
  });

  it("PageHeader canônico provê 'Voltar' (BackToDashboard) quando showBack", () => {
    // V1 Visual Refinement: as páginas de módulo usam PageShell/PageHeader; a
    // afordância de voltar é canônica no PageHeader (showBack), não mais inline por página.
    expect(read("client/src/components/ui/PageHeader.tsx")).toMatch(/BackToDashboard/);
  });

  it("Contratação Direta: retorno contextual 'Voltar aos processos' sem 'Voltar' genérico redundante", () => {
    // Final Micro-Polish: a raiz NÃO força `showBack` — o retorno ao dashboard fica no
    // breadcrumb (Home) e o retorno intra-módulo é o contextual 'Voltar aos processos',
    // evitando duas afordâncias genéricas de Voltar competindo no detalhe.
    expect(read("client/src/pages/DirectProcurement.tsx")).not.toMatch(/showBack/);
    expect(read("client/src/components/direct-procurement/DirectProcurementHome.tsx")).toMatch(/Voltar aos processos/);
  });

  it("Contratos: raiz com Voltar (showBack) e workspace com 'Voltar aos contratos'", () => {
    expect(read("client/src/pages/ContratosWorkspace.tsx")).toMatch(/showBack/);
    expect(read("client/src/components/contract-workspace/ContractWorkspace.tsx")).toMatch(/Voltar aos contratos/);
  });

  it("Processo Licitatório: detalhe oferece 'Voltar aos processos'", () => {
    expect(read("client/src/pages/ProcessoLicitatorio.tsx")).toMatch(/Voltar aos processos/);
  });
});

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  BUSINESS_DOMAIN_NAV, BUSINESS_DOMAIN_PATHS, LEGACY_PATHS,
} from "../../../client/src/config/businessDomains";

/**
 * RC-1 — Integração do frontend: valida que os 5 Business Domains estão conectados
 * à navegação principal (registro canônico, rotas em App.tsx, Home portal e Sidebar),
 * e que as telas legadas saíram da navegação. Roda em node (sem render React):
 * assertiva sobre dados puros + varredura do código-fonte.
 */

const CLIENT = path.resolve(process.cwd(), "client", "src");
function read(rel: string): string {
  return fs.readFileSync(path.join(CLIENT, rel), "utf-8");
}

const APP = read("App.tsx");
const HOME = read("pages/ModuleSelectionDashboard.tsx");
const SIDEBAR = read("components/DashboardLayout.tsx");

describe("RC-1 — Integração do Frontend & Navegação", () => {

  // ─── Registro canônico ──────────────────────────────────────────────────────

  describe("registro de Business Domains", () => {
    it("declara os 5 Business Domains principais", () => {
      expect(BUSINESS_DOMAIN_NAV).toHaveLength(5);
      const ids = BUSINESS_DOMAIN_NAV.map((d) => d.id);
      expect(ids).toEqual(["processo_licitatorio", "contratacao_direta", "parecer_juridico", "contratos", "centro_operacoes"]);
    });

    it("todos possuem caminho canônico, título e ícone", () => {
      for (const d of BUSINESS_DOMAIN_NAV) {
        expect(d.path.startsWith("/")).toBe(true);
        expect(d.title.length).toBeGreaterThan(0);
        expect(d.icon.length).toBeGreaterThan(0);
        expect(d.available).toBe(true);
      }
    });

    it("caminho canônico difere do legado (deixa de usar o legado)", () => {
      for (const d of BUSINESS_DOMAIN_NAV) {
        if (d.legacyPath) expect(d.path).not.toBe(d.legacyPath);
      }
      expect(LEGACY_PATHS).toContain("/direct-contracts");
      expect(LEGACY_PATHS).toContain("/contracts");
      expect(LEGACY_PATHS).toContain("/parecer-juridico");
    });
  });

  // ─── App.tsx: rotas + imports ───────────────────────────────────────────────

  describe("App.tsx — rotas dos Business Domains", () => {
    it("cada Business Domain tem uma <Route path> canônica", () => {
      for (const d of BUSINESS_DOMAIN_NAV) {
        expect(APP, `rota ausente para ${d.id} (${d.path})`).toContain(`path={"${d.path}"}`);
      }
    });

    it("importa as páginas dos novos domínios", () => {
      for (const p of ["DirectProcurement", "ParecerJuridico", "ContratosWorkspace", "CentroOperacoes"]) {
        expect(APP).toContain(`import ${p} from "./pages/${p}"`);
      }
    });

    it("mantém as rotas legadas (compatibilidade, não removidas)", () => {
      expect(APP).toContain("/direct-contracts");
      expect(APP).toContain("/parecer-juridico");
    });
  });

  // ─── Home portal ────────────────────────────────────────────────────────────

  describe("Business Domain Portal (Home)", () => {
    it("aponta para os caminhos canônicos, não para os legados", () => {
      expect(HOME).toContain(`path: "${BUSINESS_DOMAIN_PATHS.contratacao_direta}"`);
      expect(HOME).toContain(`path: "${BUSINESS_DOMAIN_PATHS.contratos}"`);
      expect(HOME).toContain(`path: "${BUSINESS_DOMAIN_PATHS.parecer_juridico}"`);
      expect(HOME).toContain(`path: "${BUSINESS_DOMAIN_PATHS.centro_operacoes}"`);
      // não deve mais navegar para os caminhos legados diretamente
      expect(HOME).not.toContain(`path: "/direct-contracts"`);
      expect(HOME).not.toContain(`path: "/contracts"`);
      expect(HOME).not.toContain(`path: "/parecer-juridico"`);
    });

    it("exibe o Centro de Operações como módulo", () => {
      expect(HOME).toContain("Centro de Operações");
    });
  });

  // ─── Sidebar ────────────────────────────────────────────────────────────────

  describe("Sidebar (DashboardLayout)", () => {
    it("inclui todos os Business Domains na navegação principal", () => {
      for (const d of BUSINESS_DOMAIN_NAV) {
        expect(SIDEBAR, `sidebar sem ${d.path}`).toContain(`path: "${d.path}"`);
      }
    });
  });

  // ─── Páginas-wrapper e Homes (antes órfãs, agora roteadas) ──────────────────

  describe("páginas dos domínios conectadas às Homes", () => {
    const map: Array<{ page: string; home: string; homePath: string }> = [
      { page: "DirectProcurement", home: "DirectProcurementHome", homePath: "components/direct-procurement/DirectProcurementHome.tsx" },
      { page: "ParecerJuridico", home: "LegalOpinionHome", homePath: "components/legal-opinion/LegalOpinionHome.tsx" },
      { page: "ContratosWorkspace", home: "ContractsHome", homePath: "components/contract-workspace/ContractsHome.tsx" },
      { page: "CentroOperacoes", home: "DepartmentOperationHome", homePath: "components/department-operation/DepartmentOperationHome.tsx" },
    ];
    it("cada página importa e renderiza a Home correspondente (e a Home existe)", () => {
      for (const m of map) {
        const src = read(`pages/${m.page}.tsx`);
        expect(src).toContain(m.home);
        expect(fs.existsSync(path.join(CLIENT, m.homePath)), `Home ausente: ${m.homePath}`).toBe(true);
      }
    });
  });
});

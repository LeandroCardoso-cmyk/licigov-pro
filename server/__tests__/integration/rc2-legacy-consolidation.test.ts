import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { BUSINESS_DOMAIN_NAV, LEGACY_PATHS } from "../../../client/src/config/businessDomains";

/**
 * RC-2 — Consolidação do legado: valida que NENHUMA navegação oficial aponta para
 * telas legadas, que o Business Domain Portal/Sidebar/Modules usam apenas os módulos
 * novos, e que a COMPATIBILIDADE foi preservada (páginas e rotas legadas continuam
 * existindo, apenas fora da navegação principal). Roda em node (varredura de fonte).
 */

const ROOT = process.cwd();
const CLIENT = path.resolve(ROOT, "client", "src");
const read = (rel: string) => fs.readFileSync(path.join(CLIENT, rel), "utf-8");

const HOME = read("pages/ModuleSelectionDashboard.tsx");
const SIDEBAR = read("components/DashboardLayout.tsx");
const MODULES = read("pages/Modules.tsx");
const APP = read("App.tsx");

/** Caminhos legados que NÃO podem aparecer como destino de navegação oficial. */
const LEGACY_NAV = ["/direct-contracts", "/contracts", "/parecer-juridico", "/gestao-departamento", "/gestao-comercial"];

describe("RC-2 — Legacy Migration & Product Consolidation", () => {

  // ─── Navegação oficial sem legado ───────────────────────────────────────────

  describe("navegação oficial não referencia legado", () => {
    it("Home (Business Domain Portal) usa apenas caminhos canônicos", () => {
      for (const legacy of LEGACY_NAV) {
        expect(HOME.includes(`path: "${legacy}"`), `Home ainda navega para legado ${legacy}`).toBe(false);
      }
      // usa os canônicos
      for (const d of BUSINESS_DOMAIN_NAV) {
        expect(HOME).toContain(`path: "${d.path}"`);
      }
    });

    it("Sidebar não referencia nenhum caminho legado", () => {
      for (const legacy of LEGACY_NAV) {
        expect(SIDEBAR.includes(`path: "${legacy}"`), `Sidebar ainda tem legado ${legacy}`).toBe(false);
      }
      // contém os itens oficiais exigidos
      for (const label of ["Dashboard", "Centro de Operações", "Templates", "Configurações"]) {
        expect(SIDEBAR).toContain(label);
      }
    });

    it("página Modules usa rotas canônicas (Parecer e Centro de Operações migrados)", () => {
      expect(MODULES).toContain(`route: "/parecer"`);
      expect(MODULES).toContain(`route: "/centro-operacoes"`);
      expect(MODULES.includes(`route: "/parecer-juridico"`)).toBe(false);
      expect(MODULES.includes(`route: "/gestao-departamento"`)).toBe(false);
    });
  });

  // ─── Compatibilidade preservada ─────────────────────────────────────────────

  describe("compatibilidade preservada (nada removido)", () => {
    it("as rotas legadas continuam registradas em App.tsx (acesso por URL direta)", () => {
      for (const legacy of ["/direct-contracts", "/contracts", "/parecer-juridico"]) {
        expect(APP, `rota legada ${legacy} foi removida (deveria permanecer por compat)`).toContain(legacy);
      }
    });

    it("App.tsx marca explicitamente as rotas legadas como compatibilidade", () => {
      expect(APP.toUpperCase()).toContain("COMPATIBILIDADE");
    });

    it("as páginas legadas continuam existindo (compilando)", () => {
      const legacyPages = ["Contracts", "NewContract", "ContractDetails", "DirectContracts", "NewDirectContract", "LegalOpinions", "NewLegalOpinion", "CommercialManagement", "DepartmentManagement"];
      for (const p of legacyPages) {
        expect(fs.existsSync(path.join(CLIENT, "pages", `${p}.tsx`)), `página legada ausente: ${p}`).toBe(true);
      }
    });

    it("o registro canônico mapeia cada domínio ao seu legado equivalente", () => {
      expect(LEGACY_PATHS).toContain("/direct-contracts");
      expect(LEGACY_PATHS).toContain("/contracts");
      expect(LEGACY_PATHS).toContain("/parecer-juridico");
      expect(LEGACY_PATHS).toContain("/gestao-departamento");
    });
  });

  // ─── Documentação ───────────────────────────────────────────────────────────

  describe("documentação do legado", () => {
    it("existe o inventário oficial de legado", () => {
      const inv = path.resolve(ROOT, "docs", "architecture", "LEGACY_INVENTORY.md");
      expect(fs.existsSync(inv)).toBe(true);
      const txt = fs.readFileSync(inv, "utf-8");
      // classifica os módulos (Classe 1/2/3)
      expect(txt).toContain("Classe 3");
      expect(txt).toContain("Contract Workspace");
      expect(txt).toContain("Direct Procurement");
      expect(txt).toContain("Legal Opinion Workspace");
    });
  });
});

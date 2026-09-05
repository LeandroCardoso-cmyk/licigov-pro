/**
 * Regressão do V1 Visual Refinement — invariantes ESTRUTURAIS (leitura de fonte).
 *
 * Protege a consistência introduzida nesta fase:
 *  1. As páginas de módulo usam o cabeçalho institucional CANÔNICO (PageShell/PageHeader),
 *     em vez de faixas de header montadas à mão — garantindo mesma hierarquia/identidade.
 *  2. A linguagem canônica de status (statusStyles) existe com tons theme-aware.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const MODULE_PAGES = [
  "client/src/pages/ExecutiveDashboard.tsx",
  "client/src/pages/CentroOperacoes.tsx",
  "client/src/pages/ParecerJuridico.tsx",
  "client/src/pages/DirectProcurement.tsx",
  "client/src/pages/ContratosWorkspace.tsx",
  "client/src/pages/TirarDuvidas.tsx",
];

describe("V1 Visual Refinement · PageHeader canônico", () => {
  it.each(MODULE_PAGES)("%s usa o cabeçalho canônico (PageShell/PageHeader)", (rel) => {
    const src = read(rel);
    expect(src).toMatch(/from "@\/components\/ui\/PageHeader"/);
    expect(src).toMatch(/<PageShell|<PageHeader/);
  });

  it("PageHeader expõe título, breadcrumb, back e ícone institucional", () => {
    const src = read("client/src/components/ui/PageHeader.tsx");
    expect(src).toMatch(/Breadcrumbs/);
    expect(src).toMatch(/BackToDashboard/);
    expect(src).toMatch(/showBack/);
    expect(src).toMatch(/icon\?/);
  });
});

describe("V1 Visual Refinement · linguagem canônica de status", () => {
  const src = read("client/src/components/ui/statusStyles.ts");
  it("define tons institucionais theme-aware (light + dark)", () => {
    for (const tone of ["neutral", "info", "success", "warning", "danger", "priority", "cognitive"]) {
      expect(src).toContain(`${tone}:`);
    }
    // Tons funcionais são theme-aware (têm variante dark: na mesma definição).
    expect(src).toMatch(/success:\s*"bg-green-100 dark:bg-green-950/);
  });
});

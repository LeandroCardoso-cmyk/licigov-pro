/**
 * G8 (Bloco B) — guarda de regressão da navegação canônica.
 *
 * Trava os invariantes de UI que o Gate de Produção Interna exige para G8:
 *   - NENHUMA rota de teste/debug (`/test`, `/test2`, …) registrada na aplicação (caem no NotFound);
 *   - as rotas canônicas dos Business Domains permanecem registradas;
 *   - as rotas LEGADAS (mantidas só por compatibilidade de URL) permanecem sob o bloco documentado,
 *     NÃO na navegação oficial. A remoção definitiva é governada (pós-RC-5) — este teste NÃO a força.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const APP = readFileSync(path.join(process.cwd(), "client/src/App.tsx"), "utf8");
const DOMAIN_NAV = readFileSync(path.join(process.cwd(), "client/src/components/business-domains/DomainNavigation.tsx"), "utf8");

/** Remove comentários de bloco/linha para inspecionar apenas rotas ATIVAS. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
const ACTIVE = stripComments(APP);

describe("G8 — navegação canônica (guarda de regressão)", () => {
  it("nenhuma rota de teste/debug (/test*) registrada na aplicação", () => {
    // Uma rota ativa seria algo como: <Route path={"/test"} component={...} />
    expect(ACTIVE).not.toMatch(/path=\{["']\/test\d*["']\}\s*component=/);
  });

  it("rotas canônicas dos Business Domains permanecem registradas", () => {
    for (const canonical of ["/contratacao-direta", "/parecer", "/contratos", "/tirar-duvidas", "/processos", "/centro-operacoes"]) {
      expect(ACTIVE).toMatch(new RegExp(`path=\\{["']${canonical}["']\\}`));
    }
  });

  it("rotas legadas permanecem apenas como COMPATIBILIDADE, com o bloco documentado (não removidas à força aqui)", () => {
    // O bloco legado explica que essas rotas NÃO fazem parte da navegação oficial (remoção pós-RC-5).
    expect(APP).toMatch(/rotas LEGADAS/i);
    // O seletor de módulos legado e a criação legada de processo redirecionam ao fluxo canônico.
    expect(ACTIVE).toMatch(/path=\{["']\/modulos["']\}\s*component=\{\(\)\s*=>\s*<Redirect/);
    expect(ACTIVE).toMatch(/path=\{["']\/novo-processo["']\}\s*component=\{\(\)\s*=>\s*<Redirect/);
  });

  it("a NAVEGAÇÃO OFICIAL (DomainNavigation) não aponta para nenhuma rota legada (invariante arquitetural)", () => {
    // G8 real: o menu canônico dos Business Domains nunca linka rotas legadas duplicadas. Auto-navegação
    // interna das páginas legadas (acesso por URL direta) está fora deste componente — este é o menu oficial.
    for (const legacy of ["/direct-contracts", "/parecer-juridico", "/modulos"]) {
      expect(DOMAIN_NAV).not.toContain(legacy);
    }
    // "/contracts" só como rota legada exata (não confundir com a canônica "/contratos").
    expect(DOMAIN_NAV).not.toMatch(/["']\/contracts(["'/]|$)/);
  });
});

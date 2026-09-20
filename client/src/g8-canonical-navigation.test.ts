/**
 * G8 — Guarda arquitetural da consolidação canônica (transição governada).
 *
 * Verifica, por varredura de fonte (padrão do projeto, sem testing-library):
 * - o CANÔNICO absorve criação/detalhe contextual (rotas /parecer/novo, /contratos/novo,
 *   /contratacao-direta/novo, + :id e analytics), reusando os componentes existentes;
 * - as rotas LEGADAS viram redirects de compatibilidade para o canônico, preservando query/:id;
 * - o núcleo (ProcessDetails) e os componentes de detalhe/criação NÃO navegam mais para paths legados;
 * - detalhes leem `:id` de forma agnóstica à rota (useParams), funcionando sob o path canônico;
 * - navegação principal não expõe legados; nenhuma rota /test*.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

const APP = read("client/src/App.tsx");
const PROCESSO_SHELL = read("client/src/pages/ProcessoLicitatorio.tsx");
const DIRECT_DETAILS = read("client/src/pages/DirectContractDetails.tsx");
const LEGAL_DETAILS = read("client/src/pages/LegalOpinionDetails.tsx");
const BUSINESS_DOMAINS = read("client/src/config/businessDomains.ts");

const LEGACY_PREFIXES = ["/direct-contracts", "/contracts", "/parecer-juridico"];

describe("G8 · rotas canônicas de criação/detalhe contextual", () => {
  it("registra as rotas canônicas de criação contextual", () => {
    expect(APP).toContain('path={\'/parecer/novo\'}');
    expect(APP).toContain('path={\'/contratos/novo\'}');
    expect(APP).toContain('path={\'/contratacao-direta/novo\'}');
  });

  it("registra detalhe e analytics canônicos", () => {
    for (const p of [
      "/parecer/:id", "/parecer/analytics",
      "/contratos/:id", "/contratos/alertas",
      "/contratacao-direta/:id", "/contratacao-direta/analytics",
    ]) {
      expect(APP).toContain(`path={'${p}'}`);
    }
  });

  it("estáticas antes de :id (evita captura errada por wouter)", () => {
    for (const [staticP, idP] of [
      ["/parecer/novo", "/parecer/:id"],
      ["/contratos/novo", "/contratos/:id"],
      ["/contratacao-direta/novo", "/contratacao-direta/:id"],
    ]) {
      expect(APP.indexOf(`path={'${staticP}'}`)).toBeLessThan(APP.indexOf(`path={'${idP}'}`));
    }
  });
});

describe("G8 · rotas legadas viram redirect de compatibilidade (preservam query/:id)", () => {
  it("LegacyRedirect preserva a query string", () => {
    expect(APP).toContain("function LegacyRedirect");
    expect(APP).toContain("useSearch");
    expect(APP).toMatch(/search\s*\?\s*`\$\{to\}\?\$\{search\}`\s*:\s*to/);
  });

  it("cada família legada redireciona para o canônico", () => {
    expect(APP).toContain('<LegacyRedirect to="/contratacao-direta"');
    expect(APP).toContain('<LegacyRedirect to="/contratos"');
    expect(APP).toContain('<LegacyRedirect to="/parecer"');
    // :id preservado via render-prop
    expect(APP).toContain('to={`/contratacao-direta/${p.id}`}');
    expect(APP).toContain('to={`/contratos/${p.id}`}');
    expect(APP).toContain('to={`/parecer/${p.id}`}');
  });

  it("App não renderiza mais as listas legadas diretamente", () => {
    expect(APP).not.toMatch(/component=\{DirectContractsRoute\}/);
    expect(APP).not.toMatch(/component=\{LegalOpinionsRoute\}/);
    expect(APP).not.toMatch(/component=\{\(\)\s*=>\s*<AuthenticatedRoute component=\{Contracts\}/);
    expect(APP).not.toMatch(/import\s+Contracts\s+from/);
    expect(APP).not.toMatch(/import\s+DirectContracts\s+from/);
    expect(APP).not.toMatch(/import\s+LegalOpinions\s+from/);
  });
});

describe("G8 · núcleo e detalhes não dependem de UI legada", () => {
  it("o fluxo canônico do processo (shell) NÃO cross-linka rotas legadas", () => {
    // ProcessDetails legado é órfão (não roteado/importado); o fluxo VIVO é o shell canônico.
    for (const legacy of LEGACY_PREFIXES) {
      expect(PROCESSO_SHELL).not.toContain(legacy);
    }
  });

  it("DirectContractDetails encaminha para parecer/contrato canônicos", () => {
    expect(DIRECT_DETAILS).toContain("/parecer/novo?contractId=");
    expect(DIRECT_DETAILS).toContain("/contratos/novo?");
    for (const legacy of LEGACY_PREFIXES) {
      expect(DIRECT_DETAILS).not.toContain(legacy);
    }
  });

  it("detalhes leem :id de forma agnóstica à rota (useParams, não useRoute hardcoded)", () => {
    expect(LEGAL_DETAILS).toContain("useParams");
    expect(LEGAL_DETAILS).not.toContain('useRoute("/parecer-juridico/:id")');
    expect(DIRECT_DETAILS).toContain("useParams");
    expect(DIRECT_DETAILS).not.toContain('useRoute("/direct-contracts/:id")');
  });
});

describe("G8 · navegação principal sem legados e sem debug", () => {
  it("registry canônico mantém legados fora da navegação principal", () => {
    expect(BUSINESS_DOMAINS).toContain("LEGACY_PATHS");
    expect(BUSINESS_DOMAINS).toContain('path: "/parecer"');
    expect(BUSINESS_DOMAINS).toContain('path: "/contratos"');
    expect(BUSINESS_DOMAINS).toContain('path: "/contratacao-direta"');
  });

  it("nenhuma rota /test* e nenhum import de TestPage", () => {
    expect(APP).not.toMatch(/path=\{?"\/test\d?"/);
    expect(APP).not.toMatch(/import\s+TestPage\d?\s+from/);
  });
});

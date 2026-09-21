/**
 * Landing V2 — guarda de superfície pública e do overlay de atalhos.
 *
 * Trava dois invariantes introduzidos com a Landing V2:
 *   (A) as páginas legais canônicas `/privacidade` e `/termos` são PÚBLICAS — renderizam os
 *       componentes diretamente, sem AuthenticatedRoute (visitante não é redirecionado a /login);
 *   (B) o overlay "Atalhos de Teclado" (área autenticada) NÃO monta em superfícies públicas,
 *       via classificação canônica isPublicRoute — e CONTINUA disponível na área autenticada.
 *
 * Padrão do projeto: varredura de fonte (vitest env "node", sem jsdom) + verificação runtime da
 * função pura isPublicRoute. Comentários são removidos para inspecionar apenas rotas ATIVAS.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isPublicRoute } from "./lib/publicRoutes";

const APP = readFileSync(path.join(process.cwd(), "client/src/App.tsx"), "utf8");
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
const ACTIVE = stripComments(APP);

describe("Landing V2 · superfície pública (roteamento)", () => {
  it("/ (landing) permanece pública", () => {
    expect(ACTIVE).toMatch(/path=\{"\/"\}\s*component=\{LandingPage\}/);
    expect(isPublicRoute("/")).toBe(true);
  });

  it("/privacidade e /termos renderizam os componentes diretamente (públicas, sem AuthenticatedRoute)", () => {
    expect(ACTIVE).toMatch(/path=\{"\/termos"\}\s*component=\{TermsOfUse\}/);
    expect(ACTIVE).toMatch(/path=\{"\/privacidade"\}\s*component=\{PrivacyPolicy\}/);
    // Os wrappers autenticados foram removidos por completo (não sobra referência).
    expect(ACTIVE).not.toContain("TermsOfUseRoute");
    expect(ACTIVE).not.toContain("PrivacyPolicyRoute");
    expect(isPublicRoute("/privacidade")).toBe(true);
    expect(isPublicRoute("/termos")).toBe(true);
  });

  it("visitante não autenticado não é redirecionado das legais para /login", () => {
    // O único mecanismo que navega para /login é o AuthenticatedRoute; as rotas legais não o usam.
    expect(ACTIVE).not.toMatch(/path=\{"\/termos"\}[^\n]*AuthenticatedRoute/);
    expect(ACTIVE).not.toMatch(/path=\{"\/privacidade"\}[^\n]*AuthenticatedRoute/);
  });
});

describe("Landing V2 · overlay de atalhos (gating por rota pública)", () => {
  it("gating centralizado por isPublicRoute (sem pathname !== espalhado)", () => {
    expect(ACTIVE).toContain('import { isPublicRoute } from "./lib/publicRoutes"');
    expect(ACTIVE).toContain("const shouldShowShortcuts = !isPublicRoute(location)");
    expect(ACTIVE).toContain("{shouldShowShortcuts && <KeyboardShortcutsTooltip />}");
    // Não pode existir uma montagem incondicional do overlay.
    expect(ACTIVE).not.toMatch(/^\s*<KeyboardShortcutsTooltip \/>/m);
  });

  it("overlay suprimido na landing e nas páginas legais públicas", () => {
    for (const p of ["/", "/login", "/solicitar-proposta", "/privacidade", "/termos"]) {
      // shouldShowShortcuts = !isPublicRoute(p) => false em superfície pública
      expect(!isPublicRoute(p)).toBe(false);
    }
  });

  it("overlay permanece disponível na área autenticada", () => {
    for (const p of ["/dashboard", "/processos", "/usuarios", "/contratos", "/configuracoes"]) {
      expect(!isPublicRoute(p)).toBe(true);
    }
  });

  it("a FUNCIONALIDADE de atalhos não é desabilitada (hook global permanece)", () => {
    expect(ACTIVE).toContain("useKeyboardNavigation()");
  });
});

describe("Landing V2 · sem regressão de guarda autenticada", () => {
  it("rotas protegidas seguem sob AuthenticatedRoute/shell e o guard redireciona a /login", () => {
    // O guard de autenticação segue intacto (redireciona anônimo para /login).
    expect(APP).toMatch(/navigate\("\/login"\)/);
    // Rotas protegidas representativas seguem shelladas (área autenticada).
    expect(ACTIVE).toMatch(/path=\{"\/usuarios"\}\s*component=\{UsuariosShellRoute\}/);
    expect(ACTIVE).toMatch(/path=\{"\/processos"\}\s*component=\{ProcessosShellRoute\}/);
  });

  it("primitivas de RBAC/auth do backend permanecem intactas (mudança é só frontend)", () => {
    const TRPC = readFileSync(path.join(process.cwd(), "server/_core/trpc.ts"), "utf8");
    expect(TRPC).toContain("export const protectedProcedure");
    expect(TRPC).toContain("export const adminProcedure");
    expect(TRPC).toContain("export function orgRoleProcedure");
    expect(TRPC).toContain("export const tenantProcedure");
  });
});

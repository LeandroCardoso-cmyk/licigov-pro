/**
 * Landing V2 — classificação canônica de rota pública (isPublicRoute).
 *
 * Prova o contrato usado tanto pelo roteamento das páginas legais públicas quanto pelo gating
 * do overlay de "Atalhos de Teclado":
 *   - superfícies públicas (landing, login, proposta, páginas legais) são reconhecidas;
 *   - rotas da área autenticada NÃO são classificadas como públicas (sem regressão de acesso);
 *   - normalização de query/hash/barra final é estável.
 */
import { describe, it, expect } from "vitest";
import { isPublicRoute, PUBLIC_ROUTES } from "./publicRoutes";

describe("isPublicRoute · superfícies públicas", () => {
  it("landing, login, proposta e páginas legais são públicas", () => {
    for (const p of ["/", "/login", "/solicitar-proposta", "/privacidade", "/termos"]) {
      expect(isPublicRoute(p)).toBe(true);
    }
  });

  it("todas as rotas da lista canônica são públicas", () => {
    for (const p of PUBLIC_ROUTES) {
      expect(isPublicRoute(p)).toBe(true);
    }
  });

  it("rotas da área autenticada NÃO são públicas (invariante de acesso)", () => {
    for (const p of [
      "/dashboard",
      "/processos",
      "/usuarios",
      "/contratos",
      "/parecer",
      "/contratacao-direta",
      "/centro-operacoes",
      "/configuracoes",
      "/admin",
      "/admin/organizacoes",
    ]) {
      expect(isPublicRoute(p)).toBe(false);
    }
  });

  it("normaliza query, hash e barra final", () => {
    expect(isPublicRoute("/privacidade?ref=footer")).toBe(true);
    expect(isPublicRoute("/termos#secao-2")).toBe(true);
    expect(isPublicRoute("/termos/")).toBe(true);
    expect(isPublicRoute("")).toBe(true); // raiz normalizada
    // Não classifica sub-rota autenticada como pública por prefixo.
    expect(isPublicRoute("/termos-internos")).toBe(false);
    expect(isPublicRoute("/login/extra")).toBe(false);
  });
});

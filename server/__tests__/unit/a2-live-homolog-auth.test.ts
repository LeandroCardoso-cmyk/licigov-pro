/**
 * V1 PRE-PILOT CLOSURE — Fase A2 — autenticação do endpoint efêmero /__a2/live-homolog.
 *
 * O token é aceito SOMENTE por cabeçalho (Authorization: Bearer … | X-A2-Homolog-Token) — nunca por query
 * string — para não vazar segredo em URL/proxy/access logs. Ausente/incorreto → não autorizado (403 na rota).
 */
import { describe, it, expect } from "vitest";
import { extractHomologToken, isHomologAuthorized } from "../../_core/a2LiveHomologation";

/** Helper: constrói um getter de header case-insensitive a partir de um mapa. */
function headerGetter(headers: Record<string, string>): (name: string) => string | undefined {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return (name: string) => lower[name.toLowerCase()];
}

const EXPECTED = "s3cr3t-homolog-token";

describe("A2 live-homolog — extractHomologToken (só header)", () => {
  it("extrai o token de Authorization: Bearer", () => {
    expect(extractHomologToken(headerGetter({ Authorization: `Bearer ${EXPECTED}` }))).toBe(EXPECTED);
  });

  it("aceita 'bearer' case-insensitive e apara espaços", () => {
    expect(extractHomologToken(headerGetter({ authorization: `bearer   ${EXPECTED}  ` }))).toBe(EXPECTED);
  });

  it("extrai o token de X-A2-Homolog-Token", () => {
    expect(extractHomologToken(headerGetter({ "X-A2-Homolog-Token": EXPECTED }))).toBe(EXPECTED);
  });

  it("prefere Authorization: Bearer sobre o header alternativo", () => {
    const got = extractHomologToken(headerGetter({ Authorization: `Bearer ${EXPECTED}`, "X-A2-Homolog-Token": "outro" }));
    expect(got).toBe(EXPECTED);
  });

  it("retorna null quando não há header de token", () => {
    expect(extractHomologToken(headerGetter({}))).toBeNull();
  });

  it("retorna null para Bearer vazio", () => {
    expect(extractHomologToken(headerGetter({ Authorization: "Bearer " }))).toBeNull();
  });

  it("NÃO lê token de query string (getter só de header) — retorna null", () => {
    // O getter representa apenas cabeçalhos; um '?token=' na URL nunca chega aqui.
    expect(extractHomologToken(headerGetter({}))).toBeNull();
  });
});

describe("A2 live-homolog — isHomologAuthorized (fail-closed)", () => {
  it("autoriza quando o token do header bate com o esperado", () => {
    expect(isHomologAuthorized(EXPECTED, EXPECTED)).toBe(true);
  });

  it("nega token incorreto", () => {
    expect(isHomologAuthorized("errado", EXPECTED)).toBe(false);
  });

  it("nega token ausente (null)", () => {
    expect(isHomologAuthorized(null, EXPECTED)).toBe(false);
  });

  it("nega quando o esperado não está configurado (undefined/vazio) — fail-closed", () => {
    expect(isHomologAuthorized(EXPECTED, undefined)).toBe(false);
    expect(isHomologAuthorized(EXPECTED, "")).toBe(false);
  });
});

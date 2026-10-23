/**
 * Preflight somente leitura do índice global dos catálogos (`pnpm catalog:preflight`): guarda de ambiente (só metadados
 * não sensíveis; produção sempre recusada) e catálogo fixo de consultas exclusivamente SELECT. Sem banco e sem rede.
 */
import { describe, it, expect } from "vitest";
import { assessPreflightTarget, PREFLIGHT_QUERIES } from "../../../scripts/catalog-index-preflight";

const STAGING_DB = "mysql://u:segredo@mysql.railway.internal:3306/railway";

describe("catalog:preflight — guarda de ambiente", () => {
  it("staging no Railway com banco na rede privada ⇒ permitido (host e banco, nunca credenciais)", () => {
    const t = assessPreflightTarget({ APP_ENV: "staging", RAILWAY_ENVIRONMENT_NAME: "staging", DATABASE_URL: STAGING_DB });
    expect(t).toEqual({ ok: true, appEnv: "staging", host: "mysql.railway.internal", database: "railway" });
    expect(JSON.stringify(t)).not.toMatch(/segredo|u:/);
  });

  it("produção é SEMPRE recusada (APP_ENV ou ambiente Railway), mesmo com banco privado", () => {
    expect(assessPreflightTarget({ APP_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "staging", DATABASE_URL: STAGING_DB })).toMatchObject({ ok: false, reason: expect.stringContaining("PRODUÇÃO") });
    expect(assessPreflightTarget({ APP_ENV: "staging", RAILWAY_ENVIRONMENT_NAME: "production", DATABASE_URL: STAGING_DB })).toMatchObject({ ok: false, reason: expect.stringContaining("PRODUÇÃO") });
    expect(assessPreflightTarget({ NODE_ENV: "production", DATABASE_URL: STAGING_DB })).toMatchObject({ ok: false });
  });

  it("staging fora do Railway staging ou com banco público/de outro ambiente ⇒ recusado; motivo sem credenciais", () => {
    expect(assessPreflightTarget({ APP_ENV: "staging", DATABASE_URL: STAGING_DB })).toMatchObject({ ok: false, reason: expect.stringContaining("ausente") });
    const pub = assessPreflightTarget({ APP_ENV: "staging", RAILWAY_ENVIRONMENT_NAME: "staging", DATABASE_URL: "mysql://u:segredo@shuttle.proxy.rlwy.net:41234/railway" });
    expect(pub).toMatchObject({ ok: false, reason: expect.stringContaining("rede privada") });
    expect(JSON.stringify(pub)).not.toContain("segredo");
  });

  it("development só com banco local; DATABASE_URL ausente/inválida/não MySQL ou APP_ENV desconhecido ⇒ recusado", () => {
    expect(assessPreflightTarget({ APP_ENV: "development", DATABASE_URL: "mysql://root:x@127.0.0.1:3306/licigov" })).toMatchObject({ ok: true, appEnv: "development" });
    expect(assessPreflightTarget({ APP_ENV: "development", DATABASE_URL: STAGING_DB })).toMatchObject({ ok: false });
    expect(assessPreflightTarget({ APP_ENV: "development", RAILWAY_ENVIRONMENT_NAME: "staging", DATABASE_URL: "mysql://root:x@localhost/licigov" })).toMatchObject({ ok: false });
    expect(assessPreflightTarget({ APP_ENV: "staging", RAILWAY_ENVIRONMENT_NAME: "staging" })).toMatchObject({ ok: false, reason: expect.stringContaining("DATABASE_URL") });
    expect(assessPreflightTarget({ APP_ENV: "staging", RAILWAY_ENVIRONMENT_NAME: "staging", DATABASE_URL: "postgres://u:p@x.railway.internal/db" })).toMatchObject({ ok: false });
    expect(assessPreflightTarget({ APP_ENV: "qa", DATABASE_URL: "mysql://root:x@127.0.0.1/licigov" })).toMatchObject({ ok: false });
  });
});

describe("catalog:preflight — consultas", () => {
  it("todas são uma única instrução SELECT, sem escrita, DDL, bloqueio de linhas ou parâmetros externos", () => {
    expect(PREFLIGHT_QUERIES.length).toBeGreaterThan(5);
    for (const [label, sql] of PREFLIGHT_QUERIES) {
      expect(sql, label).toMatch(/^SELECT\s/);
      expect(sql, label).not.toMatch(/;/);
      expect(sql, label).not.toMatch(/\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|ALTER|DROP|CREATE|GRANT|RENAME|CALL|LOAD|HANDLER|GET_LOCK|RELEASE_LOCK|FOR\s+UPDATE|LOCK\s+IN\s+SHARE|INTO\s+(OUT|DUMP)FILE|SLEEP)\b/i);
      expect(sql, label).not.toContain("?");
    }
  });
});

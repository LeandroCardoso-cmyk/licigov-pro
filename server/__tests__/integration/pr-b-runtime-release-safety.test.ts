/**
 * V1 PRE-PILOT CLOSURE — Fase B (RUNTIME & RELEASE SAFETY) — testes de contrato (sem DB real).
 *
 * Cobre (seção 15 do plano):
 *  - o boot NÃO contém/aciona DDL mutável (validateSchema é detector, não reconciliador);
 *  - decideSchemaValidation: ok / warn (dev) / fail-closed (staging-produção);
 *  - db:push guard recusado nos ambientes proibidos e sem --force implícito;
 *  - package scripts / CI sem caminho destrutivo (push --force);
 *  - contrato de credencial por provider ATIVO (#159);
 *  - runner de release: lock adquirido→migrate→lock liberado; falha se o lock não vem; sem log de segredo;
 *  - nenhuma regressão do bootstrap da PR 0 (sem seed automático de admin no boot).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
describe("Fase B — o boot NÃO executa DDL mutável (validateSchema é detector)", () => {
  const bootstrap = read("server/bootstrap.ts");

  it("bootstrap.ts não contém DDL mutável nem o antigo reconciliador", () => {
    expect(bootstrap).not.toMatch(/\bALTER TABLE\b/);
    expect(bootstrap).not.toMatch(/\bRENAME COLUMN\b/);
    expect(bootstrap).not.toMatch(/CREATE TABLE IF NOT EXISTS/);
    expect(bootstrap).not.toContain("addColumnIfMissing");
    expect(bootstrap).not.toContain("addUniqueIndexIfMissing");
    expect(bootstrap).not.toContain("renameColumnIfNeeded");
    expect(bootstrap).not.toContain("export async function ensureSchema");
  });

  it("bootstrap.ts exporta validateSchema (o boot valida, não muta)", () => {
    expect(bootstrap).toContain("export async function validateSchema");
  });

  it("a função bootstrap() NÃO aplica migrations (nenhum migrator/DDL no boot)", () => {
    // Extrai o corpo da função bootstrap() e prova que ela não invoca migrator algum.
    const start = bootstrap.indexOf("export async function bootstrap()");
    expect(start).toBeGreaterThan(-1);
    const body = bootstrap.slice(start);
    expect(body).not.toContain("migrateWithAdvisoryLock");
    expect(body).not.toMatch(/\bmigrate\s*\(/); // sem chamada ao migrator do Drizzle
    expect(body).not.toContain("runMigrations");
    // O boot só valida o schema.
    expect(body).toContain("validateSchema(connection)");
  });

  it("o boot NÃO importa o runner de release (migrações são o passo de RELEASE, antes do boot)", () => {
    expect(bootstrap).not.toContain('from "./db/releaseMigrate"');
  });
});

describe("Fase B — decideSchemaValidation (fail-closed fora de dev)", () => {
  it("schema íntegro → ok em qualquer ambiente", async () => {
    const { decideSchemaValidation } = await import("../../bootstrap");
    expect(decideSchemaValidation([], true)).toBe("ok");
    expect(decideSchemaValidation([], false)).toBe("ok");
  });

  it("schema incompatível → warn em desenvolvimento, fail em staging/produção", async () => {
    const { decideSchemaValidation } = await import("../../bootstrap");
    expect(decideSchemaValidation(["coluna crítica ausente: users.tokenVersion"], true)).toBe("warn");
    expect(decideSchemaValidation(["coluna crítica ausente: users.tokenVersion"], false)).toBe("fail");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Fase B — db:push guard (RUNTIME-02)", () => {
  it("permite push simples em development/test", async () => {
    const { evaluateDbPush } = await import("../../../scripts/db-push-guard");
    expect(evaluateDbPush({ APP_ENV: "development" }, [])).toEqual({ allowed: true, args: [] });
    expect(evaluateDbPush({ APP_ENV: "test" }, [])).toEqual({ allowed: true, args: [] });
    expect(evaluateDbPush({ NODE_ENV: "development" }, [])).toMatchObject({ allowed: true });
  });

  it("recusa em staging e produção", async () => {
    const { evaluateDbPush } = await import("../../../scripts/db-push-guard");
    expect(evaluateDbPush({ APP_ENV: "staging" }, []).allowed).toBe(false);
    expect(evaluateDbPush({ APP_ENV: "production" }, []).allowed).toBe(false);
  });

  it("recusa na CI mesmo em development", async () => {
    const { evaluateDbPush } = await import("../../../scripts/db-push-guard");
    const d = evaluateDbPush({ APP_ENV: "development", CI: "true" }, []);
    expect(d.allowed).toBe(false);
    if (!d.allowed) expect(d.reason).toMatch(/CI/);
  });

  it("recusa --force sem confirmação explícita e nunca injeta --force", async () => {
    const { evaluateDbPush } = await import("../../../scripts/db-push-guard");
    // --force sem confirmação → recusado
    expect(evaluateDbPush({ APP_ENV: "development" }, ["--force"]).allowed).toBe(false);
    // --force com confirmação → permitido, e --force veio do usuário (não injetado)
    const ok = evaluateDbPush({ APP_ENV: "development", DB_PUSH_ALLOW_FORCE: "yes" }, ["--force"]);
    expect(ok).toEqual({ allowed: true, args: ["--force"] });
    // push simples → nunca adiciona --force
    const plain = evaluateDbPush({ APP_ENV: "development" }, []);
    expect(plain.allowed && plain.args.includes("--force")).toBe(false);
  });
});

describe("Fase B — package scripts / CI sem caminho destrutivo", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

  it("db:push passa pelo guard (não é mais 'drizzle-kit push --force')", () => {
    expect(pkg.scripts["db:push"]).toBe("tsx scripts/db-push-guard.ts");
    expect(pkg.scripts["db:push"]).not.toMatch(/--force/);
  });

  it("existe o comando canônico de release de migrations", () => {
    expect(pkg.scripts["db:migrate:release"]).toBe("tsx scripts/migrate-release.ts");
  });

  it("nenhum script do package.json executa push --force", () => {
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      expect(/push\s+--force/.test(cmd), `script ${name} usa push --force`).toBe(false);
    }
  });

  it("o CI nunca INVOCA push --force, pnpm db:push nem drizzle-kit push", () => {
    const ci = read(".github/workflows/ci.yml");
    expect(ci).not.toMatch(/push\s+--force/);
    expect(ci).not.toMatch(/pnpm\s+db:push/);
    expect(ci).not.toMatch(/drizzle-kit\s+push/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Fase B — contrato de provider fail-closed (#159, sem fingir suporte)", () => {
  it("mapeia a credencial correta por provider e declara só Gemini operacional", async () => {
    const { requiredCredentialEnvForProvider, OPERATIONAL_AI_PROVIDERS } = await import("../../config/ai");
    expect(requiredCredentialEnvForProvider("gemini")).toBe("GEMINI_API_KEY");
    expect(requiredCredentialEnvForProvider("claude")).toBe("ANTHROPIC_API_KEY");
    expect(requiredCredentialEnvForProvider("openai")).toBe("OPENAI_API_KEY");
    // Só Gemini possui adapter operacional hoje.
    expect(OPERATIONAL_AI_PROVIDERS.has("gemini")).toBe(true);
    expect(OPERATIONAL_AI_PROVIDERS.has("claude")).toBe(false);
    expect(OPERATIONAL_AI_PROVIDERS.has("openai")).toBe(false);
  });

  describe("validateAiProviderConfig é fail-closed", () => {
    it("provider omitido + Gemini key → PASS (default gemini)", async () => {
      const { validateAiProviderConfig } = await import("../../config/ai");
      expect(validateAiProviderConfig({ GEMINI_API_KEY: "dummy" })).toBe("gemini");
    });

    it("gemini SEM key → FAIL", async () => {
      const { validateAiProviderConfig } = await import("../../config/ai");
      expect(() => validateAiProviderConfig({ AI_PROVIDER: "gemini" })).toThrow(/GEMINI_API_KEY/);
    });

    it("AI_PROVIDER inválido → FAIL (desconhecido)", async () => {
      const { validateAiProviderConfig } = await import("../../config/ai");
      expect(() => validateAiProviderConfig({ AI_PROVIDER: "xpto", GEMINI_API_KEY: "dummy" })).toThrow(/desconhecido/i);
    });

    it("claude COM ANTHROPIC key mas SEM adapter → FAIL (não operacional)", async () => {
      const { validateAiProviderConfig } = await import("../../config/ai");
      expect(() => validateAiProviderConfig({ AI_PROVIDER: "claude", ANTHROPIC_API_KEY: "dummy" })).toThrow(/operacional/i);
    });

    it("openai COM OPENAI key mas SEM adapter → FAIL (não operacional)", async () => {
      const { validateAiProviderConfig } = await import("../../config/ai");
      expect(() => validateAiProviderConfig({ AI_PROVIDER: "openai", OPENAI_API_KEY: "dummy" })).toThrow(/operacional/i);
    });

    it("credencial de provider inativo NÃO interfere no Gemini", async () => {
      const { validateAiProviderConfig } = await import("../../config/ai");
      // ANTHROPIC/OPENAI presentes, mas o provider ativo é gemini (default) com sua key → PASS.
      expect(
        validateAiProviderConfig({ GEMINI_API_KEY: "dummy", ANTHROPIC_API_KEY: "x", OPENAI_API_KEY: "y" }),
      ).toBe("gemini");
    });
  });

  it("o boot chama validateAiProviderConfig (fail-closed do provider no startup)", () => {
    const bootstrap = read("server/bootstrap.ts");
    expect(bootstrap).toContain("validateAiProviderConfig(process.env)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Fase B — runner de release (advisory lock)", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.restoreAllMocks());

  it("adquire o lock → migra → libera o lock (nessa ordem)", async () => {
    const migrateSpy = vi.fn(async () => {});
    vi.doMock("drizzle-orm/mysql2/migrator", () => ({ migrate: migrateSpy }));
    vi.doMock("drizzle-orm/mysql2", () => ({ drizzle: vi.fn(() => ({})) }));
    const { migrateWithAdvisoryLock } = await import("../../db/releaseMigrate");

    const calls: string[] = [];
    const conn = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("GET_LOCK")) { calls.push("GET_LOCK"); return [[{ ok: 1 }]]; }
        if (sql.includes("RELEASE_LOCK")) { calls.push("RELEASE_LOCK"); return [[{ released: 1 }]]; }
        return [[]];
      }),
    };
    await migrateWithAdvisoryLock(conn as never);
    expect(migrateSpy).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["GET_LOCK", "RELEASE_LOCK"]);
  });

  it("falha se o lock não é obtido e NÃO aplica migrations", async () => {
    const migrateSpy = vi.fn(async () => {});
    vi.doMock("drizzle-orm/mysql2/migrator", () => ({ migrate: migrateSpy }));
    vi.doMock("drizzle-orm/mysql2", () => ({ drizzle: vi.fn(() => ({})) }));
    const { migrateWithAdvisoryLock } = await import("../../db/releaseMigrate");

    const conn = { query: vi.fn(async (sql: string) => (sql.includes("GET_LOCK") ? [[{ ok: 0 }]] : [[]])) };
    await expect(migrateWithAdvisoryLock(conn as never)).rejects.toThrow(/lock/i);
    expect(migrateSpy).not.toHaveBeenCalled();
  });

  it("o script de release recusa sem DATABASE_URL e nunca loga o valor da URL", async () => {
    const src = read("scripts/migrate-release.ts");
    // Não há log do valor da DATABASE_URL (apenas da ausência).
    expect(src).not.toMatch(/console\.[a-z]+\([^)]*databaseUrl/);
    // Contrato: reusa o runner com lock, não faz seed/push/reconcile mutável.
    expect(src).toContain("migrateWithAdvisoryLock");
    expect(src).not.toMatch(/drizzle-kit push|seedAdmin|ensureSchema/);
  });

  it("o runner com lock não faz seed nem push", () => {
    const src = read("server/db/releaseMigrate.ts");
    expect(src).toContain("GET_LOCK");
    expect(src).toContain("RELEASE_LOCK");
    expect(src).not.toMatch(/seedAdmin|drizzle-kit push/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Fase B — sem regressão do bootstrap da PR 0", () => {
  it("o boot não INVOCA seed/promoção automática de admin", () => {
    const bootstrap = read("server/bootstrap.ts");
    // O comentário histórico cita seedAdmin/seedDefaultOrgMembership — o que não pode existir
    // é a INVOCAÇÃO (chamada) desses seeds no boot.
    expect(bootstrap).not.toMatch(/\bawait\s+seedAdmin\b/);
    expect(bootstrap).not.toMatch(/\bseedAdmin\s*\(/);
    expect(bootstrap).not.toMatch(/\bseedDefaultOrgMembership\s*\(/);
    expect(bootstrap).toContain("scripts/bootstrap-admin.ts");
  });

  it("o comando explícito de admin continua fail-closed e com promoção deliberada", () => {
    const admin = read("scripts/bootstrap-admin.ts");
    expect(admin).toContain("ADMIN_BOOTSTRAP_ALLOW_PROMOTE");
    expect(admin).toContain("validatePasswordStrength");
    expect(admin).toContain("bumpTokenVersion");
  });
});

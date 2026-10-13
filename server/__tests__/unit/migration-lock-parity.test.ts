/**
 * O lock usado por `runMigrations` (smokes) e o do passo de release precisam ser o MESMO (nome e prazo), e `runMigrations` precisa usá-lo —
 * senão arquivos de teste concorrentes sobre um banco não migrado voltam a executar `CREATE TABLE` ao mesmo tempo.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AdvisoryLockTimeoutError, MIGRATION_LOCK_NAME, MIGRATION_LOCK_TIMEOUT_SECONDS, withAdvisoryLock, withMigrationLock } from "../../db/migrationLock";
import { candidateRegistrationLockName } from "../../services/institutionalTemplates/candidateRegistrationService";
import * as release from "../../db/releaseMigrate";

describe("lock de migração", () => {
  it("mesmo nome e prazo do release", () => {
    expect(MIGRATION_LOCK_NAME).toBe(release.MIGRATION_LOCK_NAME);
    expect(MIGRATION_LOCK_TIMEOUT_SECONDS).toBe(release.MIGRATION_LOCK_TIMEOUT_SECONDS);
  });
  it("runMigrations migra sob o lock; o boot continua sem importar o runner de release", () => {
    const src = readFileSync(path.resolve("server/bootstrap.ts"), "utf8");
    expect(src).toMatch(/withMigrationLock\(connection, \(\) => migrate\(/);
    expect(src).not.toContain('from "./db/releaseMigrate"');
  });
  it("obtém, executa e SEMPRE libera (também em erro); sem lock ⇒ falha sem executar", async () => {
    const calls: string[] = [];
    const conn = { query: vi.fn(async (sql: string) => { calls.push(sql.includes("GET_LOCK") ? "GET" : "REL"); return [[{ ok: 1 }]]; }) };
    await expect(withMigrationLock(conn as never, async () => { calls.push("RUN"); throw new Error("x"); })).rejects.toThrow("x");
    expect(calls).toEqual(["GET", "RUN", "REL"]);
    const denied = { query: vi.fn(async () => [[{ ok: 0 }]]) };
    const fn = vi.fn();
    await expect(withMigrationLock(denied as never, fn)).rejects.toThrow(/lock de migração/);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("advisory lock nomeado (registro de candidato por organização+identidade)", () => {
  it("o nome é determinístico, ≤ 64 caracteres e distinto por organização e por identidade (nunca global)", () => {
    const a = candidateRegistrationLockName(1, "ti0001");
    expect(candidateRegistrationLockName(1, "ti0001")).toBe(a);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(new Set([a, candidateRegistrationLockName(2, "ti0001"), candidateRegistrationLockName(1, "ti0002")]).size).toBe(3);
    expect(a).not.toBe(MIGRATION_LOCK_NAME);
  });
  it("withAdvisoryLock: obtém, executa e libera mesmo em erro; sem lock ⇒ AdvisoryLockTimeoutError e `fn` não roda", async () => {
    const calls: string[] = [];
    const ok = { query: vi.fn(async (sql: string, args: unknown[]) => { calls.push(`${sql.includes("GET_LOCK") ? "GET" : "REL"}:${String(args[0])}`); return [[{ ok: 1 }]]; }) };
    await expect(withAdvisoryLock(ok as never, "lk", 5, async () => { calls.push("RUN"); throw new Error("x"); })).rejects.toThrow("x");
    expect(calls).toEqual(["GET:lk", "RUN", "REL:lk"]);
    const denied = { query: vi.fn(async () => [[{ ok: 0 }]]) };
    const fn = vi.fn();
    await expect(withAdvisoryLock(denied as never, "lk", 1, fn)).rejects.toBeInstanceOf(AdvisoryLockTimeoutError);
    expect(fn).not.toHaveBeenCalled();
  });
});

/**
 * A3-RD1 — orquestrador de PRE-DEPLOY (release). Contrato PURO (sem DB), com deps injetadas:
 * migrations → (só em sucesso) instalação governada do reference data. Fail-closed.
 *
 * Cobre (spec §4):
 *   - migration falha → installer NÃO executa;
 *   - migration passa + instalação nova → PASS;
 *   - migration passa + replay/no-op → PASS;
 *   - migration passa + hash divergente (installer lança) → FAIL-CLOSED;
 *   - installer falha → predeploy falha;
 *   - separação de responsabilidades preservada (migrate-release continua migrations-only) e
 *     o comando canônico `db:release:predeploy` existe.
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runPredeploy } from "../../../scripts/predeploy-release";

const read = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");
const silent = () => {};

describe("A3-RD1 — runPredeploy (ordem + fail-closed)", () => {
  it("migration falha → installer NÃO executa e o erro é propagado", async () => {
    const migrate = vi.fn(async () => { throw new Error("migration boom"); });
    const installReference = vi.fn(async () => {});
    await expect(runPredeploy({ migrate, installReference, log: silent })).rejects.toThrow(/migration boom/);
    expect(migrate).toHaveBeenCalledTimes(1);
    expect(installReference).not.toHaveBeenCalled();
  });

  it("migration passa + instalação nova → PASS, na ordem migrate→install", async () => {
    const order: string[] = [];
    const migrate = vi.fn(async () => { order.push("migrate"); });
    const installReference = vi.fn(async () => { order.push("install"); });
    await expect(runPredeploy({ migrate, installReference, log: silent })).resolves.toBeUndefined();
    expect(order).toEqual(["migrate", "install"]);
  });

  it("migration passa + replay/no-op do installer → PASS", async () => {
    // Replay/no-op é sucesso do installer (resolve sem lançar).
    const migrate = vi.fn(async () => {});
    const installReference = vi.fn(async () => { /* no-op idempotente */ });
    await expect(runPredeploy({ migrate, installReference, log: silent })).resolves.toBeUndefined();
    expect(installReference).toHaveBeenCalledTimes(1);
  });

  it("migration passa + hash divergente (installer lança) → FAIL-CLOSED", async () => {
    const migrate = vi.fn(async () => {});
    const installReference = vi.fn(async () => {
      throw new Error("LEGAL_REFERENCE_CONTENT_HASH_INVALID");
    });
    await expect(runPredeploy({ migrate, installReference, log: silent })).rejects.toThrow(/CONTENT_HASH_INVALID/);
    expect(migrate).toHaveBeenCalledTimes(1);
  });

  it("installer falha (qualquer erro) → predeploy falha", async () => {
    const migrate = vi.fn(async () => {});
    const installReference = vi.fn(async () => { throw new Error("install boom"); });
    await expect(runPredeploy({ migrate, installReference, log: silent })).rejects.toThrow(/install boom/);
  });
});

describe("A3-RD1 — separação de responsabilidades do release (package/scripts)", () => {
  const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };

  it("existe o comando canônico de pre-deploy e ele aponta para o orquestrador", () => {
    expect(pkg.scripts["db:release:predeploy"]).toBe("tsx scripts/predeploy-release.ts");
  });

  it("migrate:release continua migrations-only (não vira seed/reference runner)", () => {
    expect(pkg.scripts["db:migrate:release"]).toBe("tsx scripts/migrate-release.ts");
    const src = read("scripts/migrate-release.ts");
    expect(src).toContain("migrateWithAdvisoryLock");
    expect(src).not.toMatch(/installGovernedLegalReferenceV1|install-reference-data/);
  });

  it("o orquestrador reusa as main() dos dois passos e não spawna shell", () => {
    const src = read("scripts/predeploy-release.ts");
    expect(src).toContain('from "./migrate-release"');
    expect(src).toContain('from "./install-reference-data"');
    expect(src).not.toMatch(/["']node:child_process["']|["']child_process["']|execSync\(|spawnSync\(|\bspawn\(/);
  });
});

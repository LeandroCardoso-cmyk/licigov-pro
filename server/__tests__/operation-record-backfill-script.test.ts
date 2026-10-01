/**
 * Executor do backfill de agenda — proteções de configuração (sem banco): argumentos obrigatórios e recusa
 * de dataset versionável dentro do repositório (dados reais nunca entram no Git).
 */
import { describe, it, expect } from "vitest";
import { resolve } from "path";
import { tmpdir } from "os";
import { ConfigError, assertDatasetOutsideGit, parseArgs } from "../../scripts/operation-record-schedule-backfill";

const ROOT = resolve(__dirname, "../..");

describe("executor do backfill — guardrails", () => {
  it("exige --org, --expect-slug e --file; dry-run é o padrão", () => {
    expect(() => parseArgs([])).toThrow(ConfigError);
    expect(() => parseArgs(["--org", "1", "--file", "x"])).toThrow(/expect-slug/);
    expect(() => parseArgs(["--org", "0", "--expect-slug", "s", "--file", "x"])).toThrow(/--org/);
    expect(parseArgs(["--org", "1", "--expect-slug", "s", "--file", "-"])).toEqual({ org: 1, expectSlug: "s", file: "-", apply: false });
    expect(parseArgs(["--org", "1", "--expect-slug", "s", "--file", "-", "--apply"]).apply).toBe(true);
  });

  it("recusa dataset versionável no repositório; aceita ops-private/, caminho externo e stdin", () => {
    expect(() => assertDatasetOutsideGit(resolve(ROOT, "data.json"), ROOT)).toThrow(ConfigError);
    expect(() => assertDatasetOutsideGit(resolve(ROOT, "server/fixtures/data.json"), ROOT)).toThrow(/versionável/);
    expect(() => assertDatasetOutsideGit(resolve(ROOT, "ops-private/agenda.json"), ROOT)).not.toThrow();
    expect(() => assertDatasetOutsideGit(resolve(tmpdir(), "agenda.json"), ROOT)).not.toThrow();
    expect(() => assertDatasetOutsideGit("-", ROOT)).not.toThrow();
  });
});

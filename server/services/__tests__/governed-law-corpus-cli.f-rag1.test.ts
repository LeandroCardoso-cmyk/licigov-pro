import { afterEach, describe, expect, it } from "vitest";
import {
  parseArgs,
  validateRuntimeEnvironment,
} from "../../../scripts/materialize-governed-law-corpus";

const original = {
  APP_ENV: process.env.APP_ENV,
  DATABASE_URL: process.env.DATABASE_URL,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};

afterEach(() => {
  process.env.APP_ENV = original.APP_ENV;
  process.env.DATABASE_URL = original.DATABASE_URL;
  process.env.GEMINI_API_KEY = original.GEMINI_API_KEY;
});

describe("F-RAG1 materialization CLI guards", () => {
  it("aceita dry-run de staging sem runId", () => {
    expect(parseArgs([
      "--dry-run",
      "--environment", "staging",
      "--as-of-date", "2026-09-16",
    ])).toMatchObject({
      mode: "dry-run",
      environment: "staging",
      asOfDate: "2026-09-16",
      productionApproved: false,
    });
  });

  it("apply exige runId", () => {
    expect(() => parseArgs([
      "--apply",
      "--environment", "staging",
      "--as-of-date", "2026-09-16",
    ])).toThrow("GOVERNED_LAW_CORPUS_RUN_ID_REQUIRED");
  });

  it("produção exige flag explícita e staging rejeita a flag", () => {
    expect(() => parseArgs([
      "--dry-run",
      "--environment", "production",
      "--as-of-date", "2026-09-16",
    ])).toThrow("GOVERNED_LAW_CORPUS_PRODUCTION_APPROVAL_FLAG_REQUIRED");

    expect(() => parseArgs([
      "--dry-run",
      "--environment", "staging",
      "--as-of-date", "2026-09-16",
      "--production-approved",
    ])).toThrow("GOVERNED_LAW_CORPUS_STAGING_REJECTS_PRODUCTION_FLAG");
  });

  it("runtime exige APP_ENV correspondente, DB e provider apenas no apply", () => {
    process.env.APP_ENV = "staging";
    process.env.DATABASE_URL = "mysql://example.invalid/db";
    delete process.env.GEMINI_API_KEY;

    const dry = parseArgs([
      "--dry-run",
      "--environment", "staging",
      "--as-of-date", "2026-09-16",
    ]);
    expect(() => validateRuntimeEnvironment(dry)).not.toThrow();

    const apply = parseArgs([
      "--apply",
      "--environment", "staging",
      "--as-of-date", "2026-09-16",
      "--run-id", "11111111-1111-4111-8111-111111111111",
    ]);
    expect(() => validateRuntimeEnvironment(apply)).toThrow("GOVERNED_LAW_CORPUS_PROVIDER_NOT_CONFIGURED");
  });
});

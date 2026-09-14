import { describe, expect, it } from "vitest";
import { parseReindexArgs } from "../../../scripts/reindex-legal-embeddings";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

describe("F-EMB1 reindex CLI governance", () => {
  it("aceita dry-run explícito em staging sem runId", () => {
    expect(parseReindexArgs(["--dry-run", "--environment", "staging"])).toEqual({
      mode: "dry-run",
      environment: "staging",
      runId: undefined,
      productionApproved: false,
    });
  });

  it("aceita apply explícito em staging com runId", () => {
    expect(parseReindexArgs([
      "--apply",
      "--environment=staging",
      `--run-id=${RUN_ID}`,
    ])).toEqual({
      mode: "apply",
      environment: "staging",
      runId: RUN_ID,
      productionApproved: false,
    });
  });

  it("rejeita ausência ou ambiguidade de modo", () => {
    expect(() => parseReindexArgs(["--environment", "staging"]))
      .toThrow("EMBEDDING_REINDEX_MODE_REQUIRED");
    expect(() => parseReindexArgs(["--dry-run", "--apply", "--environment", "staging"]))
      .toThrow("EMBEDDING_REINDEX_MODE_REQUIRED");
  });

  it("rejeita apply sem runId e dry-run com runId", () => {
    expect(() => parseReindexArgs(["--apply", "--environment", "staging"]))
      .toThrow("EMBEDDING_REINDEX_RUN_ID_REQUIRED");
    expect(() => parseReindexArgs([
      "--dry-run",
      "--environment", "staging",
      "--run-id", RUN_ID,
    ])).toThrow("EMBEDDING_REINDEX_DRY_RUN_ID_NOT_ALLOWED");
  });

  it("restringe ambientes operacionais conhecidos", () => {
    expect(() => parseReindexArgs(["--dry-run", "--environment", "development"]))
      .toThrow("EMBEDDING_REINDEX_ENVIRONMENT_NOT_ALLOWED");
  });

  it("produção exige acknowledgement adicional e staging rejeita a flag produtiva", () => {
    expect(() => parseReindexArgs([
      "--apply",
      "--environment", "production",
      "--run-id", RUN_ID,
    ])).toThrow("EMBEDDING_REINDEX_PRODUCTION_APPROVAL_REQUIRED");

    expect(parseReindexArgs([
      "--apply",
      "--environment", "production",
      "--run-id", RUN_ID,
      "--production-approved",
    ])).toMatchObject({
      mode: "apply",
      environment: "production",
      productionApproved: true,
    });

    expect(() => parseReindexArgs([
      "--apply",
      "--environment", "staging",
      "--run-id", RUN_ID,
      "--production-approved",
    ])).toThrow("EMBEDDING_REINDEX_PRODUCTION_FLAG_INVALID");
  });
});

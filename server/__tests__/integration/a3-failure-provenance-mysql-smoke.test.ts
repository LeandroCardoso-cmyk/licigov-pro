/**
 * A3 — Failure Provenance contra MySQL REAL (CI). Regressão da LIVE: erro longo do provider
 * (ex.: Gemini 400 sobre `additionalProperties`) estourava `failure_message` varchar(300)
 * (`slice(0,300)+"…"` = 301) → "Data too long" → `failure_provenance_persist_failed`.
 *
 * Prova que `captureCognitiveFailure` PERSISTE a falha (executionStatus=failed) sem estourar a
 * coluna, com provider/model/tenant/correlation corretos e mensagem sanitizada (sem segredo/SQL cru).
 * A1 fail-safe: a captura da falha não substitui a exceção original (aqui exercemos só a captura).
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, validateSchema } from "../../bootstrap";
import { captureCognitiveFailure } from "../../services/cognitive/cognitiveProvenanceService";
import { listProvenanceByCorrelation } from "../../db/cognitiveProvenance";
import { MAX_FAILURE_MESSAGE_LENGTH } from "../../domain/cognitiveProvenance";

const DB = process.env.DATABASE_URL;
const ORG = 990990;
const ACTOR = "7";

// Erro longo do provider (mimetiza Gemini 400) com espaços — NÃO é um único token, então
// permanece longo após sanitização e exercita o caminho de truncamento (> 300 chars).
const LONG_GEMINI_400 =
  "GoogleGenerativeAIError: [400 Bad Request] Invalid JSON payload received. " +
  'Unknown name "additionalProperties" at generation_config response_schema Cannot find field. '.repeat(5);

async function cleanup(conn: mysql.Connection) {
  await conn.query("DELETE FROM `cognitive_provenance` WHERE organization_id = ?", [ORG]).catch(() => {});
}

describe.skipIf(!DB)("A3 — failure provenance (MySQL real, strict)", () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await cleanup(conn);
  }, 300_000);

  afterAll(async () => {
    await cleanup(conn).catch(() => {});
    await conn?.end();
  });

  it("persiste falha de erro LONGO do provider sem estourar failure_message(300)", async () => {
    const correlationId = "a3-fail-prov-catmat";
    expect(LONG_GEMINI_400.length).toBeGreaterThan(MAX_FAILURE_MESSAGE_LENGTH);

    const env = await captureCognitiveFailure({
      organizationId: ORG,
      executionId: "exec-a3-fail-1",
      correlationId,
      task: "CATMAT_MATCHING",
      provider: "gemini",
      model: "gemini-3.8-flash",
      replayHash: "rh-a3-fail-1",
      usesGrounding: false,
      usesRAG: false,
      actorUserId: ACTOR,
      semanticInput: { tenantId: ORG, task: "CATMAT_MATCHING", query: "caneta esferográfica azul" },
      error: new Error(LONG_GEMINI_400),
    });
    // Com o fix, a persistência NÃO falha (antes retornava null por "Data too long").
    expect(env).not.toBeNull();

    const rows = await listProvenanceByCorrelation(ORG, correlationId);
    const rec = rows.find((r) => r.executionId === "exec-a3-fail-1");
    expect(rec).toBeTruthy();
    expect(rec!.executionStatus).toBe("failed");
    expect(rec!.executionMode).toBe("cognitive");
    expect(rec!.provider).toBe("gemini");
    expect(rec!.model).toBe("gemini-3.8-flash");
    expect(rec!.actorUserId).toBe(ACTOR);
    expect(rec!.failureClass).toBeTruthy();
    expect(rec!.isReplay).toBe(0);
    expect((rec!.failureMessage ?? "").length).toBeLessThanOrEqual(MAX_FAILURE_MESSAGE_LENGTH);
  }, 60_000);

  it("mensagem longa com segredo é persistida REDIGIDA e dentro do limite", async () => {
    const correlationId = "a3-fail-prov-secret";
    const err = new Error(`falha ao conectar mysql://root:s3nh4Secreta@db.internal:3306/licigov ${"detalhe ".repeat(60)}`);

    const env = await captureCognitiveFailure({
      organizationId: ORG,
      executionId: "exec-a3-fail-2",
      correlationId,
      task: "LEGAL_ANALYSIS",
      provider: "gemini",
      model: "gemini-3.8-flash",
      replayHash: "rh-a3-fail-2",
      usesGrounding: false,
      usesRAG: false,
      actorUserId: ACTOR,
      semanticInput: { tenantId: ORG, task: "LEGAL_ANALYSIS", query: "consulta jurídica" },
      error: err,
    });
    expect(env).not.toBeNull();

    const rows = await listProvenanceByCorrelation(ORG, correlationId);
    const rec = rows.find((r) => r.executionId === "exec-a3-fail-2");
    expect(rec).toBeTruthy();
    const fm = rec!.failureMessage ?? "";
    expect(fm.length).toBeLessThanOrEqual(MAX_FAILURE_MESSAGE_LENGTH);
    expect(fm).not.toContain("mysql://");
    expect(fm).not.toContain("s3nh4Secreta");
  }, 60_000);
});

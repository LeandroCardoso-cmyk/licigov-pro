/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * V1 PRE-PILOT CLOSURE — Fase A1 — Cognitive Provenance / Degraded State / Replay (MySQL real).
 *
 * Executável (não source inspection). Cobre as seções A–J do plano:
 *   A. proveniência ORIGINAL persistida (provider/model reais, fingerprints, provenanced, tenant-aware);
 *   B. REPLAY (provider chamado 1x; 2ª devolve replay; sem duplicar a original; marcador is_replay);
 *   C. CONFLITO (mesma chave + payload diferente → CONFLICT, sem chamar provider, sem duplicar);
 *   D. MULTI-TENANT (A não lê proveniência de B; B não força replay com a chave de A);
 *   E. DEGRADADO (max_tokens → completed_degraded/partial_output; grounding exigido sem evidência →
 *      completed_degraded/grounding_unavailable + grounding_state ungrounded);
 *   F. HISTÓRICO (backfill legacy_unclassified: sem provider/model/evidence fabricados; não deterministic);
 *   G. ARTIFACT LINEAGE (linkage por correlação → generated/official, tenant-scoped);
 *   H/J. FAIL-CLOSED (falha → status failed + failure_class; NÃO confiança 0, NÃO sucesso vazio).
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { cognitiveProvenanceTable } from "../../../drizzle/schema";
import { runMigrations } from "../../bootstrap";
import { createExecutionContext, type AIExecutionContext } from "../../domain/aiExecutionContext";
import type { CognitiveResponse } from "../../domain/cognitiveResponse";
import { provenanceId } from "../../domain/cognitiveProvenance";
import { getProvenanceByExecutionId, getOriginalProvenanceByIdempotencyKey, linkProvenanceArtifact } from "../../db/cognitiveProvenance";
import {
  captureCognitiveProvenance, captureCognitiveFailure, runReplaySafeCognition,
  type CognitiveReplayResult,
} from "../../services/cognitive/cognitiveProvenanceService";

const DB = process.env.DATABASE_URL;
const ORG_A = 994201;
const ORG_B = 994202;
const USER = 7;

async function cleanup(conn: mysql.Connection) {
  for (const org of [ORG_A, ORG_B]) {
    await conn.query("DELETE FROM `cognitive_provenance` WHERE organization_id = ?", [org]).catch(() => {});
    await conn.query("DELETE FROM `idempotency_keys` WHERE organizationId = ?", [org]).catch(() => {});
    await conn.query("DELETE FROM `cognitive_observability` WHERE tenant_id = ?", [org]).catch(() => {});
  }
}

function fakeContext(p: { org: number; correlationId: string; task?: string; provider?: string; model?: string; grounding?: boolean; rag?: boolean }): AIExecutionContext {
  return createExecutionContext({
    request: {
      tenantId: p.org, userId: "u1", businessDomain: "processo_licitatorio",
      workspaceId: "w1", processId: "p1", stage: "planejamento",
      task: (p.task ?? "GENERATE_DOCUMENT") as any, prompt: "PROMPT", correlationId: p.correlationId,
    },
    grounding: {
      groundingApplied: !!p.grounding, ragApplied: !!p.rag, knowledgeGraphApplied: false,
      documentsUsed: [], lawsUsed: [], knowledgeGraphNodes: [], copilot: "agente_contratacao" as any,
    },
    outcome: {
      provider: p.provider ?? "mock", model: p.model ?? "mock-default", latencyMs: 10,
      tokens: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, confidence: 0.7, reasoning: "r", finishReason: "stop",
    },
  });
}

const fakeResponse = (content: string): CognitiveResponse =>
  ({ content, contractVersion: "rc-4.0.1" } as unknown as CognitiveResponse);

async function rowFor(org: number, executionId: string) {
  const db = await getDb();
  const rows = await db!.select().from(cognitiveProvenanceTable)
    .where(and(eq(cognitiveProvenanceTable.organizationId, org), eq(cognitiveProvenanceTable.executionId, executionId)));
  return rows[0] ?? null;
}

describe.skipIf(!DB)("A1 — Cognitive Provenance / Degraded / Replay (MySQL real)", () => {
  let conn: mysql.Connection;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup(conn);
  }, 300_000);

  afterAll(async () => {
    await cleanup(conn).catch(() => {});
    await conn?.end();
  });

  // ── A. Proveniência ORIGINAL ────────────────────────────────────────────────
  it("A. persiste proveniência ORIGINAL (provider/model reais, fingerprints, provenanced, tenant-aware)", async () => {
    const ctx = fakeContext({ org: ORG_A, correlationId: "corr-A1", provider: "gemini", model: "gemini-2.5-flash" });
    const env = await captureCognitiveProvenance({
      context: ctx, response: fakeResponse("Rascunho ETP"), query: "Elaborar ETP",
      documentRefs: ["d1"], lawRefs: ["lei 14.133 art. 18"], usesGrounding: false, usesRAG: false, finishReason: "stop",
    });
    expect(env).not.toBeNull();
    const row = await getProvenanceByExecutionId(ORG_A, ctx.id);
    expect(row).not.toBeNull();
    expect(row!.provider).toBe("gemini");
    expect(row!.model).toBe("gemini-2.5-flash");
    expect(row!.provenanceClass).toBe("provenanced");
    expect(row!.executionMode).toBe("cognitive");
    expect(row!.correlationId).toBe("corr-A1");
    expect(row!.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.outputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.executionStatus).toBe("completed"); // sem grounding declarado
    expect(row!.groundingState).toBe("not_applicable");
  }, 60_000);

  // ── B/C. Replay + Conflito ──────────────────────────────────────────────────
  it("B/C. REPLAY chama o provider 1x; 2ª devolve replay (sem duplicar original); payload diferente → CONFLICT", async () => {
    let providerCalls = 0;
    const key = "idem-replay-1";
    const input = { tenantId: ORG_A, task: "GENERATE_DOCUMENT", query: "Q1", documentRefs: ["d1"], lawRefs: [] };

    const exec = async (): Promise<CognitiveReplayResult> => {
      providerCalls++;
      const ctx = fakeContext({ org: ORG_A, correlationId: "corr-replay", provider: "gemini", model: "m" });
      // A execução real captura a proveniência ORIGINAL:
      await captureCognitiveProvenance({
        context: ctx, response: fakeResponse("saida"), query: "Q1", documentRefs: ["d1"], lawRefs: [],
        usesGrounding: false, usesRAG: false, finishReason: "stop", idempotencyKey: key,
      });
      return {
        executionId: ctx.id, replayHash: ctx.replayHash, correlationId: "corr-replay",
        content: "saida", provider: "gemini", model: "m", executionStatus: "completed",
        groundingState: "not_applicable", outputFingerprint: "of", executionMode: "cognitive",
      };
    };

    const first = await runReplaySafeCognition({ organizationId: ORG_A, actorUserId: USER, idempotencyKey: key, input }, exec);
    expect(first.replayed).toBe(false);
    expect(providerCalls).toBe(1);

    const second = await runReplaySafeCognition({ organizationId: ORG_A, actorUserId: USER, idempotencyKey: key, input }, exec);
    expect(second.replayed).toBe(true);
    expect(providerCalls).toBe(1); // provider NÃO re-chamado no replay
    expect(second.result.content).toBe("saida");

    // Marcador de replay (is_replay=1) referenciando a original; original NÃO duplicada.
    const db = await getDb();
    const all = await db!.select().from(cognitiveProvenanceTable)
      .where(and(eq(cognitiveProvenanceTable.organizationId, ORG_A), eq(cognitiveProvenanceTable.idempotencyKey, key)));
    const originals = all.filter((r) => r.isReplay === 0);
    const replays = all.filter((r) => r.isReplay === 1);
    expect(originals.length).toBe(1);          // sem duplicar a original
    expect(replays.length).toBeGreaterThanOrEqual(1);
    expect(replays[0].replayOfExecutionId).toBe(originals[0].executionId);

    // CONFLITO: mesma chave, payload diferente → CONFLICT, sem chamar o provider, sem duplicar.
    const conflictInput = { ...input, query: "Q1-DIFERENTE" };
    await expect(
      runReplaySafeCognition({ organizationId: ORG_A, actorUserId: USER, idempotencyKey: key, input: conflictInput }, exec),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(providerCalls).toBe(1); // continua 1 — nenhuma execução nova
  }, 90_000);

  // ── D. Multi-tenant (IDOR) ──────────────────────────────────────────────────
  it("D. multi-tenant: A não lê proveniência de B; B não força replay com a chave de A", async () => {
    const ctxA = fakeContext({ org: ORG_A, correlationId: "corr-tenant-A", provider: "gemini", model: "m" });
    await captureCognitiveProvenance({
      context: ctxA, response: fakeResponse("A"), query: "segredoA", documentRefs: [], lawRefs: [],
      usesGrounding: false, usesRAG: false, finishReason: "stop", idempotencyKey: "shared-key",
    });
    // B não enxerga a execução de A por executionId:
    expect(await getProvenanceByExecutionId(ORG_B, ctxA.id)).toBeNull();
    // B não recupera a original de A pela chave (escopo de tenant):
    expect(await getOriginalProvenanceByIdempotencyKey(ORG_B, "shared-key")).toBeNull();
    // A recupera a sua:
    expect(await getProvenanceByExecutionId(ORG_A, ctxA.id)).not.toBeNull();

    // B tentando "forçar replay" com a MESMA chave executa a SUA própria cognição (isolamento):
    let bCalls = 0;
    const bExec = async (): Promise<CognitiveReplayResult> => {
      bCalls++;
      return { executionId: "bexec", replayHash: "brh", correlationId: "corr-B", content: "B-own",
        provider: "gemini", model: "m", executionStatus: "completed", groundingState: "not_applicable",
        outputFingerprint: "of", executionMode: "cognitive" };
    };
    const bRes = await runReplaySafeCognition(
      { organizationId: ORG_B, actorUserId: USER, idempotencyKey: "shared-key", input: { tenantId: ORG_B, task: "T", query: "b" } },
      bExec,
    );
    expect(bRes.replayed).toBe(false); // NÃO herdou o replay de A
    expect(bRes.result.content).toBe("B-own");
    expect(bCalls).toBe(1);
  }, 60_000);

  // ── E. Estado degradado ─────────────────────────────────────────────────────
  it("E. estado DEGRADADO explícito: max_tokens→partial_output; grounding exigido sem evidência→grounding_unavailable", async () => {
    // max_tokens → completed_degraded / partial_output
    const ctx1 = fakeContext({ org: ORG_A, correlationId: "corr-deg-1", provider: "gemini", model: "m" });
    await captureCognitiveProvenance({
      context: ctx1, response: fakeResponse("cortado"), query: "q", documentRefs: [], lawRefs: [],
      usesGrounding: false, usesRAG: false, finishReason: "max_tokens",
    });
    const r1 = await rowFor(ORG_A, ctx1.id);
    expect(r1!.executionStatus).toBe("completed_degraded");
    expect(r1!.degradationReason).toBe("partial_output");

    // grounding exigido, sem evidência real → completed_degraded / grounding_unavailable / ungrounded
    const ctx2 = fakeContext({ org: ORG_A, correlationId: "corr-deg-2", grounding: true, rag: true });
    await captureCognitiveProvenance({
      context: ctx2, response: fakeResponse("sem grounding real"), query: "q2", documentRefs: ["d"], lawRefs: ["l"],
      usesGrounding: true, usesRAG: true, finishReason: "stop", evidenceCount: 0,
    });
    const r2 = await rowFor(ORG_A, ctx2.id);
    expect(r2!.executionStatus).toBe("completed_degraded");
    expect(r2!.degradationReason).toBe("grounding_unavailable");
    expect(r2!.groundingState).toBe("ungrounded"); // NUNCA "grounded" por referências no prompt
  }, 60_000);

  // ── F. Histórico (backfill legacy_unclassified) ─────────────────────────────
  it("F. HISTÓRICO: backfill classifica como legacy_unclassified SEM fabricar provider/model/evidence nem deterministic", async () => {
    // Semeia uma observabilidade histórica (pré-provenance) para ORG_A.
    await conn.query(
      "INSERT INTO `cognitive_observability` (id, tenant_id, correlation_id, task, replay_hash, provider, execution_status, payload, created_at) VALUES (?,?,?,?,?,?,?,?, NOW(3))",
      ["hist-obs-0001", ORG_A, "corr-hist", "LEGAL_ANALYSIS", "rhhist", "gemini", "completed", "{}"],
    );
    // Executa o backfill EXATO da migration 0298 (INSERT IGNORE ... SELECT).
    await conn.query(
      "INSERT IGNORE INTO `cognitive_provenance` (id,organization_id,execution_id,correlation_id,task,execution_mode,execution_status,grounding_state,provenance_class,provider,model,input_fingerprint,replay_hash,is_replay,approval_state,orchestrator_version,created_at) " +
      "SELECT CONCAT('leg',LEFT(id,21)),tenant_id,id,correlation_id,LEFT(task,60),'cognitive',CASE WHEN execution_status IN ('failed','invalid') THEN 'failed' ELSE 'completed' END,'legacy_unclassified','legacy_unclassified',NULL,NULL,'',LEFT(replay_hash,64),0,'generated','legacy',created_at FROM `cognitive_observability` WHERE tenant_id = ?",
      [ORG_A],
    );
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT * FROM `cognitive_provenance` WHERE organization_id = ? AND execution_id = 'hist-obs-0001'",
      [ORG_A],
    );
    expect(rows.length).toBe(1);
    const h = rows[0];
    expect(h.provenance_class).toBe("legacy_unclassified");
    expect(h.grounding_state).toBe("legacy_unclassified");
    expect(h.provider).toBeNull();       // NÃO fabrica provider
    expect(h.model).toBeNull();          // NÃO fabrica model
    expect(h.output_fingerprint).toBeNull();   // NÃO fabrica evidência/saída
    expect(h.evidence_fingerprint).toBeNull();
    expect(h.execution_mode).not.toBe("deterministic"); // NÃO marca falsamente deterministic
  }, 60_000);

  // ── G. Artifact lineage ─────────────────────────────────────────────────────
  it("G. LINKAGE de artefato por correlação (generated/official), tenant-scoped", async () => {
    const ctx = fakeContext({ org: ORG_A, correlationId: "corr-link", provider: "gemini", model: "m" });
    await captureCognitiveProvenance({
      context: ctx, response: fakeResponse("etp"), query: "q", documentRefs: [], lawRefs: [],
      usesGrounding: false, usesRAG: false, finishReason: "stop",
    });
    const db = await getDb();
    await linkProvenanceArtifact(db!, {
      organizationId: ORG_A, correlationId: "corr-link",
      artifactKind: "etp", artifactId: "gd-123", officialDocumentId: "od-456", officialLineageId: "lin-789",
    });
    const row = await getProvenanceByExecutionId(ORG_A, ctx.id);
    expect(row!.artifactKind).toBe("etp");
    expect(row!.artifactId).toBe("gd-123");
    expect(row!.officialDocumentId).toBe("od-456");
    expect(row!.officialLineageId).toBe("lin-789");

    // Não vaza para outro tenant: linkar em ORG_B pela mesma correlação não afeta ORG_A.
    await linkProvenanceArtifact(db!, { organizationId: ORG_B, correlationId: "corr-link", artifactKind: "x", artifactId: "y" });
    const stillA = await getProvenanceByExecutionId(ORG_A, ctx.id);
    expect(stillA!.artifactId).toBe("gd-123"); // inalterado
  }, 60_000);

  // ── H/J. Fail-closed ────────────────────────────────────────────────────────
  it("H/J. FALHA → status failed + failure_class + msg sanitizada (NÃO confiança 0, NÃO sucesso vazio)", async () => {
    const executionId = provenanceId({ organizationId: ORG_A, executionId: "failexec", replayHash: "frh", isReplay: false });
    await captureCognitiveFailure({
      organizationId: ORG_A, executionId: "failexec", correlationId: "corr-fail", task: "LEGAL_ANALYSIS",
      provider: "gemini", model: "m", replayHash: "frh",
      semanticInput: { tenantId: ORG_A, task: "LEGAL_ANALYSIS", query: "q" },
      error: new Error("Request timeout after 30s connecting mysql://root:pw@h/db"),
    });
    const row = await rowFor(ORG_A, "failexec");
    expect(row).not.toBeNull();
    expect(row!.id).toBe(executionId);
    expect(row!.executionStatus).toBe("failed");           // falha ≠ completed
    expect(row!.failureClass).toBe("provider_timeout");
    expect(row!.outputFingerprint).toBeNull();             // falha ≠ sucesso vazio (sem saída fabricada)
    expect(row!.failureMessage).not.toContain("mysql://"); // sanitizado
    expect(row!.failureMessage).not.toContain("pw@");
  }, 60_000);
});

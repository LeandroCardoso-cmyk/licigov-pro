/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * V1 PRE-PILOT CLOSURE — Fase A1 (FECHAMENTO FINAL) — Cognitive Provenance / Degraded / Replay (MySQL real).
 *
 * Executável (não source inspection). Cobre as seções do fechamento final:
 *   A. proveniência ORIGINAL persistida (provider/model reais, fingerprints, provenanced, tenant-aware);
 *   B/C. REPLAY no ENTRYPOINT REAL (executeCognitiveTask): provider chamado 1x; 2ª devolve replay; mesma
 *        chave + payload diferente → CONFLICT, sem nova execução original;
 *   D. MARCADOR de replay registra o PEDIDO ATUAL (correlation/actor/task) + replayOfExecutionId original;
 *   E. IMUTABILIDADE insert-once (duplicate divergente NÃO reescreve; failed não vira completed);
 *   F. EVIDENCE fingerprint SOMENTE com evidência REAL (sem evidência → NULL, grounding ungrounded);
 *      ordem incidental de EvidenceRefs reais → mesmo fingerprint;
 *   G. GROUNDING de falha factual (task com grounding + falha → NÃO not_applicable);
 *   H. FALHA → status failed + failure_class + msg sanitizada;
 *   J. ATOMICIDADE do artefato: proveniência ausente (linked=0) → rollback (nada persistido);
 *   + MULTI-TENANT (IDOR) e ARTIFACT LINEAGE.
 * Só roda com DATABASE_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { cognitiveProvenanceTable, generatedDocumentsTable } from "../../../drizzle/schema";
import { runMigrations } from "../../bootstrap";
import { createExecutionContext, type AIExecutionContext } from "../../domain/aiExecutionContext";
import type { CognitiveResponse } from "../../domain/cognitiveResponse";
import { provenanceId, evidenceRef, computeEvidenceFingerprint } from "../../domain/cognitiveProvenance";
import { insertCognitiveProvenance, getProvenanceByExecutionId, getOriginalProvenanceByIdempotencyKey, linkProvenanceArtifact } from "../../db/cognitiveProvenance";
import { captureCognitiveProvenance, captureCognitiveFailure } from "../../services/cognitive/cognitiveProvenanceService";
import { executeCognitiveTask } from "../../services/aiExecutionEngine";

const DB = process.env.DATABASE_URL;
const ORG_A = 994201;
const ORG_B = 994202;
const USER = 7;

async function cleanup(conn: mysql.Connection) {
  for (const org of [ORG_A, ORG_B]) {
    await conn.query("DELETE FROM `cognitive_provenance` WHERE organization_id = ?", [org]).catch(() => {});
    await conn.query("DELETE FROM `idempotency_keys` WHERE organizationId = ?", [org]).catch(() => {});
    await conn.query("DELETE FROM `generated_documents` WHERE organization_id = ?", [org]).catch(() => {});
  }
}

function fakeContext(p: { org: number; correlationId: string; provider?: string; model?: string; grounding?: boolean; rag?: boolean }): AIExecutionContext {
  return createExecutionContext({
    request: {
      tenantId: p.org, userId: "u1", businessDomain: "processo_licitatorio",
      workspaceId: "w1", processId: "p1", stage: "planejamento",
      task: "GENERATE_DOCUMENT" as any, prompt: "PROMPT", correlationId: p.correlationId,
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
async function rowsByCorrelation(org: number, correlationId: string) {
  const db = await getDb();
  return db!.select().from(cognitiveProvenanceTable)
    .where(and(eq(cognitiveProvenanceTable.organizationId, org), eq(cognitiveProvenanceTable.correlationId, correlationId)));
}

describe.skipIf(!DB)("A1 (final) — Cognitive Provenance / Degraded / Replay (MySQL real)", () => {
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
    expect(row!.provider).toBe("gemini");
    expect(row!.model).toBe("gemini-2.5-flash");
    expect(row!.provenanceClass).toBe("provenanced");
    expect(row!.correlationId).toBe("corr-A1");
    expect(row!.inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.outputFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.executionStatus).toBe("completed");
    expect(row!.groundingState).toBe("not_applicable");
    // #6 — sem evidência real: evidenceFingerprint NULL (não fabricado a partir de refs declaradas).
    expect(row!.evidenceFingerprint).toBeNull();
  }, 60_000);

  // ── B/C/D. Replay no ENTRYPOINT REAL + conflito + marcador do pedido atual ──
  it("B/C/D. executeCognitiveTask: provider 1x; 2ª = replay (marca pedido atual); payload diferente → CONFLICT", async () => {
    const key = "idem-real-entry-1";
    const base = { task: "PROCUREMENT_REASONING" as any, tenantId: ORG_A, userId: "u-actor", actorUserId: USER, idempotencyKey: key, query: "Analisar contratação X" };

    // 1ª chamada (original) — correlationId "corr-orig".
    const first = await executeCognitiveTask({ ...base, correlationId: "corr-orig" });
    expect(first.replayed).toBeFalsy();
    const originalsAfterFirst = (await rowsByCorrelation(ORG_A, "corr-orig")).filter((r) => r.isReplay === 0);
    expect(originalsAfterFirst.length).toBe(1); // 1 execução original (provider chamado 1x)
    const originalExecId = originalsAfterFirst[0].executionId;

    // 2ª chamada, MESMA chave + MESMO payload, correlationId ATUAL diferente → REPLAY (provider não re-chamado).
    const second = await executeCognitiveTask({ ...base, correlationId: "corr-replay-atual" });
    expect(second.replayed).toBe(true);
    expect(second.response.content).toBe(first.response.content);
    // Nenhuma nova execução original para "corr-orig" (continua 1) — provider chamado só na original.
    const originalsAfterSecond = (await rowsByCorrelation(ORG_A, "corr-orig")).filter((r) => r.isReplay === 0);
    expect(originalsAfterSecond.length).toBe(1);

    // D — marcador do PEDIDO ATUAL: correlationId atual, actor/task atuais, replayOfExecutionId → original.
    const markers = (await rowsByCorrelation(ORG_A, "corr-replay-atual")).filter((r) => r.isReplay === 1);
    expect(markers.length).toBe(1);
    expect(markers[0].correlationId).toBe("corr-replay-atual");
    expect(markers[0].actorUserId).toBe("u-actor");
    expect(markers[0].task).toBe("PROCUREMENT_REASONING");
    expect(markers[0].idempotencyKey).toBe(key);
    expect(markers[0].replayOfExecutionId).toBe(originalExecId);

    // C — mesma chave + payload DIFERENTE → CONFLICT (sem nova execução original).
    await expect(
      executeCognitiveTask({ ...base, correlationId: "corr-conflict", query: "Payload DIFERENTE" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const originalsAfterConflict = (await rowsByCorrelation(ORG_A, "corr-orig")).filter((r) => r.isReplay === 0);
    expect(originalsAfterConflict.length).toBe(1); // continua 1 — nenhuma nova execução
  }, 120_000);

  // ── Lineage de idempotência na ORIGINAL (is_replay=0) ───────────────────────
  it("IDENTITY: execução keyed persiste idempotency_key na ORIGINAL; getOriginalProvenanceByIdempotencyKey recupera (tenant-scoped); keyless → NULL", async () => {
    const key = "idem-lineage-1";
    const base = { task: "PROCUREMENT_REASONING" as any, tenantId: ORG_A, userId: "u-actor", actorUserId: USER, idempotencyKey: key, query: "lineage de idempotência" };
    await executeCognitiveTask({ ...base, correlationId: "corr-lineage" });

    // A linha ORIGINAL (is_replay=0) da correlação carrega a idempotency_key.
    const originals = (await rowsByCorrelation(ORG_A, "corr-lineage")).filter((r) => r.isReplay === 0);
    expect(originals.length).toBe(1);
    expect(originals[0].idempotencyKey).toBe(key);

    // getOriginalProvenanceByIdempotencyKey volta a funcionar (factual + tenant-scoped).
    const found = await getOriginalProvenanceByIdempotencyKey(ORG_A, key);
    expect(found).not.toBeNull();
    expect(found!.executionId).toBe(originals[0].executionId);
    expect(found!.isReplay).toBe(0);
    // Outro tenant NÃO recupera.
    expect(await getOriginalProvenanceByIdempotencyKey(ORG_B, key)).toBeNull();

    // Execução KEYLESS → original com idempotency_key NULL (nunca fabricada).
    await executeCognitiveTask({ task: "PROCUREMENT_REASONING" as any, tenantId: ORG_A, userId: "u-actor", query: "sem chave", correlationId: "corr-keyless" });
    const keyless = (await rowsByCorrelation(ORG_A, "corr-keyless")).filter((r) => r.isReplay === 0);
    expect(keyless.length).toBe(1);
    expect(keyless[0].idempotencyKey).toBeNull();
  }, 120_000);

  // ── E. Imutabilidade insert-once ────────────────────────────────────────────
  it("E. IMUTABILIDADE: duplicate divergente NÃO reescreve a original; failed não vira completed", async () => {
    const execId = "imut-exec-1";
    const rh = "immutable-replay-hash";
    const id = provenanceId({ organizationId: ORG_A, executionId: execId, replayHash: rh, isReplay: false });
    const original = {
      id, organizationId: ORG_A, executionId: execId, correlationId: "corr-imut", task: "LEGAL_ANALYSIS",
      executionMode: "cognitive" as const, executionStatus: "failed" as const, degradationReason: null,
      failureClass: "provider_timeout" as const, groundingState: "ungrounded" as const, provenanceClass: "provenanced" as const,
      provider: "gemini", model: "m", taskVersion: "1", promptContractVersion: "", orchestratorVersion: "a1.1",
      inputFingerprint: "input-fp-original", outputFingerprint: null, evidenceFingerprint: null, replayHash: rh,
      idempotencyKey: null, isReplay: false, replayOfExecutionId: null, approvalState: "generated" as const,
      businessDomain: null, processId: null, workspaceId: null, stage: null, actorUserId: null, failureMessage: "timeout",
    };
    await insertCognitiveProvenance(original);
    // Segunda tentativa com MESMO id porém divergente (failed→completed, output/input diferentes).
    await insertCognitiveProvenance({
      ...original, executionStatus: "completed", failureClass: null, outputFingerprint: "OUTRO", inputFingerprint: "OUTRO", failureMessage: null,
    });
    const row = await rowFor(ORG_A, execId);
    expect(row!.executionStatus).toBe("failed");        // NÃO virou completed
    expect(row!.failureClass).toBe("provider_timeout"); // preservado
    expect(row!.inputFingerprint).toBe("input-fp-original"); // fingerprint imutável
    expect(row!.outputFingerprint).toBeNull();
  }, 60_000);

  // ── F. Evidence fingerprint SOMENTE com evidência REAL ──────────────────────
  it("F. evidência: sem evidência real → NULL + ungrounded; com EvidenceRef real → fingerprint (ordem irrelevante)", async () => {
    // Sem evidência real, mas task exige grounding/RAG → evidenceFingerprint NULL, grounding ungrounded.
    const ctxNone = fakeContext({ org: ORG_A, correlationId: "corr-ev-none", grounding: true, rag: true });
    await captureCognitiveProvenance({
      context: ctxNone, response: fakeResponse("sem evidência"), query: "q", documentRefs: ["d1", "d2"], lawRefs: ["lei X"],
      usesGrounding: true, usesRAG: true, finishReason: "stop", // sem `evidences`
    });
    const rNone = await rowFor(ORG_A, ctxNone.id);
    expect(rNone!.evidenceFingerprint).toBeNull();     // refs declaradas NÃO viram evidência
    expect(rNone!.groundingState).toBe("ungrounded");

    // Com EvidenceRef REAIS → fingerprint persistido; ordem incidental não altera.
    const e1 = evidenceRef("lei_14133", "art. 18", "texto 18");
    const e2 = evidenceRef("lei_14133", "art. 6", "texto 6");
    const ctxReal = fakeContext({ org: ORG_A, correlationId: "corr-ev-real", grounding: true, rag: true });
    await captureCognitiveProvenance({
      context: ctxReal, response: fakeResponse("com evidência"), query: "q", documentRefs: [], lawRefs: [],
      usesGrounding: true, usesRAG: true, finishReason: "stop", evidences: [e1, e2], evidenceComplete: true,
    });
    const rReal = await rowFor(ORG_A, ctxReal.id);
    expect(rReal!.evidenceFingerprint).toBe(computeEvidenceFingerprint([e2, e1])); // ordem irrelevante
    expect(rReal!.groundingState).toBe("grounded");
  }, 60_000);

  // ── G. Grounding de falha factual ───────────────────────────────────────────
  it("G. FALHA de task com grounding → grounding_state NÃO é not_applicable (factual: ungrounded)", async () => {
    await captureCognitiveFailure({
      organizationId: ORG_A, executionId: "fail-grounded", correlationId: "corr-fg", task: "LEGAL_ANALYSIS",
      provider: "gemini", model: "m", replayHash: "frh-g", usesGrounding: true, usesRAG: false,
      semanticInput: { tenantId: ORG_A, task: "LEGAL_ANALYSIS", query: "q" },
      error: new Error("ECONNREFUSED upstream unavailable"),
    });
    const row = await rowFor(ORG_A, "fail-grounded");
    expect(row!.executionStatus).toBe("failed");
    expect(row!.groundingState).not.toBe("not_applicable");
    expect(row!.groundingState).toBe("ungrounded");
  }, 60_000);

  // ── H. Falha fail-closed ────────────────────────────────────────────────────
  it("H. FALHA → status failed + failure_class + msg sanitizada (NÃO confiança 0, NÃO sucesso vazio)", async () => {
    await captureCognitiveFailure({
      organizationId: ORG_A, executionId: "failexec", correlationId: "corr-fail", task: "LEGAL_ANALYSIS",
      provider: "gemini", model: "m", replayHash: "frh", usesGrounding: false, usesRAG: false,
      semanticInput: { tenantId: ORG_A, task: "LEGAL_ANALYSIS", query: "q" },
      error: new Error("Request timeout after 30s connecting mysql://root:pw@h/db"),
    });
    const row = await rowFor(ORG_A, "failexec");
    expect(row!.executionStatus).toBe("failed");
    expect(row!.failureClass).toBe("provider_timeout");
    expect(row!.outputFingerprint).toBeNull();
    expect(row!.failureMessage).not.toContain("mysql://");
    expect(row!.failureMessage).not.toContain("pw@");
  }, 60_000);

  // ── J. Atomicidade do artefato (rollback real) ──────────────────────────────
  it("J. proveniência ausente (linked=0) → geração aborta e faz ROLLBACK (nenhum generated_document persistido)", async () => {
    const db = await getDb();
    const gid = "gd-atomic-1";
    await expect(
      db!.transaction(async (tx: any) => {
        await tx.insert(generatedDocumentsTable).values({
          id: gid, organizationId: ORG_A, processId: "p-atomic", kind: "etp", title: "ETP atômico", content: "x",
          correlationId: "corr-sem-proveniencia",
        });
        // Proveniência OBRIGATÓRIA ausente para esta correlação → linked=0 → fail-closed.
        const { linked } = await linkProvenanceArtifact(tx, {
          organizationId: ORG_A, correlationId: "corr-sem-proveniencia", artifactKind: "etp", artifactId: gid,
        });
        expect(linked).toBe(0);
        if (linked === 0) throw new Error("proveniência obrigatória ausente — abortar");
      }),
    ).rejects.toThrow();
    // O generated_document foi revertido (rollback real).
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT id FROM generated_documents WHERE id = ? AND organization_id = ?", [gid, ORG_A],
    );
    expect(rows.length).toBe(0);
  }, 60_000);

  // ── Multi-tenant (IDOR) ─────────────────────────────────────────────────────
  it("multi-tenant: A não lê proveniência de B por executionId (escopo de tenant)", async () => {
    const ctxA = fakeContext({ org: ORG_A, correlationId: "corr-tenant-A", provider: "gemini", model: "m" });
    await captureCognitiveProvenance({
      context: ctxA, response: fakeResponse("A"), query: "segredoA", documentRefs: [], lawRefs: [],
      usesGrounding: false, usesRAG: false, finishReason: "stop",
    });
    expect(await getProvenanceByExecutionId(ORG_B, ctxA.id)).toBeNull(); // B não enxerga A
    expect(await getProvenanceByExecutionId(ORG_A, ctxA.id)).not.toBeNull();
  }, 60_000);

  // ── Artifact lineage (linkage factual + tenant-scoped) ──────────────────────
  it("linkage de artefato por correlação (generated/official), tenant-scoped e não sobrescreve", async () => {
    const ctx = fakeContext({ org: ORG_A, correlationId: "corr-link", provider: "gemini", model: "m" });
    await captureCognitiveProvenance({
      context: ctx, response: fakeResponse("etp"), query: "q", documentRefs: [], lawRefs: [],
      usesGrounding: false, usesRAG: false, finishReason: "stop",
    });
    const db = await getDb();
    const { linked } = await linkProvenanceArtifact(db!, {
      organizationId: ORG_A, correlationId: "corr-link",
      artifactKind: "etp", artifactId: "gd-123", officialDocumentId: "od-456", officialLineageId: "lin-789",
    });
    expect(linked).toBeGreaterThanOrEqual(1);
    const row = await getProvenanceByExecutionId(ORG_A, ctx.id);
    expect(row!.artifactId).toBe("gd-123");
    expect(row!.officialDocumentId).toBe("od-456");

    // Não sobrescreve linkage já estabelecido (segunda tentativa com artefato diferente → 0 linhas).
    const again = await linkProvenanceArtifact(db!, { organizationId: ORG_A, correlationId: "corr-link", artifactKind: "tr", artifactId: "gd-OUTRO" });
    expect(again.linked).toBe(0);
    const stillA = await getProvenanceByExecutionId(ORG_A, ctx.id);
    expect(stillA!.artifactId).toBe("gd-123"); // inalterado
  }, 60_000);
});

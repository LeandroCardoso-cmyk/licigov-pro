/**
 * V1 PRE-PILOT CLOSURE — Fase A2 — HOMOLOGAÇÃO LIVE (PROVIDER REAL) — harness staging-only.
 *
 * Endpoint AUTOMATIZÁVEL e efêmero para provar que a autoria estruturada ETP/TR funciona com o PROVIDER
 * REAL (Gemini) no ambiente de staging — a cadeia completa: corpus → retrieval → ContextPackage → Gemini
 * (responseSchema, UMA chamada) → structured output → Zod → validação legal → EvidenceRefs → proveniência
 * → artefato vinculado.
 *
 * SEGURANÇA (fail-closed):
 *   - NUNCA é registrado em produção (só quando `!APP_CONFIG.isProduction`);
 *   - exige o token `A2_HOMOLOG_TOKEN` (setado só em staging); sem token/errado → 403;
 *   - usa um tenant de teste dedicado e LIMPA tudo o que cria (não polui dados reais).
 * É um harness de homologação — pode ser removido após o fechamento da A2.
 */

import type { Express, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { APP_CONFIG } from "../config/app";
import { getDb } from "../db/connection";
import { generateDocument } from "../services/procurementProcessService";

const TEST_ORG = 990990; // tenant de teste dedicado (limpo ao final).

async function cleanup(org: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const stmts = [
    sql`DELETE FROM cognitive_provenance WHERE organization_id = ${org}`,
    sql`DELETE FROM generated_document_edits WHERE organization_id = ${org}`,
    sql`DELETE FROM official_document_timeline WHERE tenant_id = ${org}`,
    sql`DELETE FROM official_documents WHERE tenant_id = ${org}`,
    sql`DELETE FROM process_timeline WHERE organization_id = ${org}`,
    sql`DELETE FROM generated_documents WHERE organization_id = ${org}`,
    sql`DELETE FROM idempotency_keys WHERE organizationId = ${org}`,
  ];
  for (const s of stmts) await db.execute(s).catch(() => {});
}

async function runOne(kind: "etp" | "tr"): Promise<Record<string, unknown>> {
  const ts = Date.now();
  const correlationId = `a2-live-${kind}-${ts}`;
  // `generated_documents.process_id` é varchar(20) no schema — o id do processo tem de caber em 20 chars
  // (o correlationId, varchar(64), permanece descritivo). base36 do timestamp mantém o valor compacto e único.
  const processId = `a2${kind}${ts.toString(36)}`; // ex.: "a2etpmlxr8k9" (≤ 20 chars)
  const object = kind === "tr" ? "Serviço de limpeza predial (homologação live)" : "Aquisição de material de escritório (homologação live)";
  // COGNIÇÃO REAL — sem `invoke`: o provider ativo (Gemini em staging) produz o structured output.
  const { document, replayed } = await generateDocument({
    organizationId: TEST_ORG, processId, kind, object,
    correlationId, idempotencyKey: `a2-live-${kind}-${ts}`, actorUserId: 1,
  });

  const db = await getDb();
  const result = await db!.execute(
    sql`SELECT provider, model, execution_status, grounding_state, evidence_fingerprint, is_replay, artifact_kind, artifact_id, correlation_id FROM cognitive_provenance WHERE organization_id = ${TEST_ORG} AND correlation_id = ${correlationId}`,
  );
  const rows = (Array.isArray(result) ? result[0] : (result as { rows?: unknown[] }).rows ?? []) as Record<string, unknown>[];
  const originals = rows.filter((r) => Number(r.is_replay) === 0);
  const original = originals[0] ?? null;
  return {
    kind,
    replayed,
    provider: original?.provider ?? null,
    model: original?.model ?? null,
    executionStatus: original?.execution_status ?? null,
    groundingState: original?.grounding_state ?? null,
    evidenceFingerprint: original?.evidence_fingerprint ?? null,
    artifactKind: original?.artifact_kind ?? null,
    artifactLinked: !!original?.artifact_id,
    correlationPreserved: original?.correlation_id === correlationId,
    // 1 chamada cognitiva por documento → exatamente UMA proveniência ORIGINAL (is_replay=0).
    singleCognitiveExecution: originals.length === 1,
    documentKind: document.kind,
    documentContainsObject: typeof document.content === "string" && document.content.includes("homologação live"),
  };
}

/**
 * HOMOLOGAÇÃO LIVE NO BOOT (staging-only, opt-in por `A2_HOMOLOG_ON_BOOT=1`). Roda ETP+TR com o provider
 * REAL uma única vez após o boot e imprime UMA linha JSON `[A2-LIVE-HOMOLOG] {...}` no stdout — legível
 * pelos logs de deploy (mecanismo automatizável quando o egress externo ao serviço é bloqueado). No-op em
 * produção e quando a flag não está ligada. Best-effort: nunca derruba o processo.
 */
export function runA2LiveHomologationOnBoot(): void {
  if (APP_CONFIG.isProduction) return;
  if (process.env.A2_HOMOLOG_ON_BOOT !== "1") return;
  void (async () => {
    try {
      await cleanup(TEST_ORG);
      const etp = await runOne("etp");
      const tr = await runOne("tr");
      const ok =
        etp.singleCognitiveExecution === true && tr.singleCognitiveExecution === true &&
        etp.artifactLinked === true && tr.artifactLinked === true &&
        String(etp.executionStatus).startsWith("completed") && String(tr.executionStatus).startsWith("completed") &&
        etp.correlationPreserved === true && tr.correlationPreserved === true;
      console.info(`[A2-LIVE-HOMOLOG] ${JSON.stringify({ ok, provider: etp.provider, appEnv: APP_CONFIG.env, etp, tr })}`);
    } catch (err) {
      const cause = err instanceof Error && err.cause ? String((err.cause as { message?: unknown })?.message ?? err.cause) : undefined;
      console.info(`[A2-LIVE-HOMOLOG] ${JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err), cause })}`);
    } finally {
      await cleanup(TEST_ORG).catch(() => {});
    }
  })();
}

/**
 * Registra o endpoint de homologação live (staging-only, token-gated). No-op em produção.
 */
export function registerA2LiveHomologationRoute(app: Express): void {
  if (APP_CONFIG.isProduction) return; // NUNCA em produção.
  app.get("/__a2/live-homolog", async (req: Request, res: Response) => {
    const expected = process.env.A2_HOMOLOG_TOKEN; // token efêmero, setado só em staging
    const token = String(req.query.token ?? "");
    if (!expected || token !== expected) { res.status(403).json({ error: "forbidden" }); return; }
    try {
      await cleanup(TEST_ORG);
      const etp = await runOne("etp");
      const tr = await runOne("tr");
      const ok =
        etp.singleCognitiveExecution === true && tr.singleCognitiveExecution === true &&
        etp.artifactLinked === true && tr.artifactLinked === true &&
        String(etp.executionStatus).startsWith("completed") && String(tr.executionStatus).startsWith("completed") &&
        etp.correlationPreserved === true && tr.correlationPreserved === true;
      res.json({ ok, provider: etp.provider, appEnv: APP_CONFIG.env, etp, tr });
    } catch (err) {
      res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      await cleanup(TEST_ORG).catch(() => {});
    }
  });
}

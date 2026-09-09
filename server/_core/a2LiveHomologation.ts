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
/**
 * Erro de COTA/limite (HTTP 429, "Quota exceeded", *PerDayPerProjectPerModel-FreeTier*, resource exhausted,
 * rate limit): NUNCA re-tentar — re-tentar apenas consome mais cota diária. Classificação explícita para o
 * smoke não reesgotar a janela do free-tier.
 */
function isQuotaOrRateLimitError(err: unknown): boolean {
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /\b429\b|quota exceeded|too many requests|resource[_ ]?exhausted|rate limit|generaterequestsper|freetier|free_tier/.test(m);
}

/**
 * SÓ 503 "high demand" (e afins não-cota: 500/502/504, unavailable, overloaded, timeout) permite UMA nova
 * tentativa espaçada. Cota/limite (429) é sempre NÃO-retryable (ver acima).
 */
function isRetryableHighDemand(err: unknown): boolean {
  if (isQuotaOrRateLimitError(err)) return false;
  const m = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /\b(500|502|503|504)\b|high demand|unavailable|overloaded|timeout|timed out|deadline/.test(m);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function runA2LiveHomologationOnBoot(): void {
  if (APP_CONFIG.isProduction) return;
  if (process.env.A2_HOMOLOG_ON_BOOT !== "1") return;
  // Sob free-tier do Gemini a cota diária é escassa (20 req/dia). Política CONSERVADORA de cota:
  //   - 429 / cota diária / rate limit  → PARA na hora, NUNCA re-tenta (não queima mais cota);
  //   - 503 "high demand" (e afins não-cota) → no máximo UMA nova tentativa espaçada;
  //   - erro determinístico do código → PARA e reporta.
  // Combine com AI_MAX_ATTEMPTS=1 em staging para que a chamada interna também não re-tente 429.
  const maxRounds = 2; // 1 tentativa + no máximo 1 nova (exclusiva para 503 high demand).
  const roundDelayMs = 60_000;
  void (async () => {
    let lastErr: unknown = null;
    for (let round = 1; round <= maxRounds; round++) {
      try {
        await cleanup(TEST_ORG);
        const etp = await runOne("etp");
        const tr = await runOne("tr");
        const ok =
          etp.singleCognitiveExecution === true && tr.singleCognitiveExecution === true &&
          etp.artifactLinked === true && tr.artifactLinked === true &&
          String(etp.executionStatus).startsWith("completed") && String(tr.executionStatus).startsWith("completed") &&
          etp.correlationPreserved === true && tr.correlationPreserved === true;
        console.info(`[A2-LIVE-HOMOLOG] ${JSON.stringify({ ok, round, provider: etp.provider, appEnv: APP_CONFIG.env, etp, tr })}`);
        await cleanup(TEST_ORG).catch(() => {});
        return; // fechou (ok true/false determinístico) — não re-tenta.
      } catch (err) {
        lastErr = err;
        const quota = isQuotaOrRateLimitError(err);
        const retryable = isRetryableHighDemand(err);
        console.info(`[A2-LIVE-HOMOLOG] ${JSON.stringify({ ok: false, round, quota, retryable, error: err instanceof Error ? err.message : String(err) })}`);
        await cleanup(TEST_ORG).catch(() => {});
        if (quota) break;                       // COTA DIÁRIA: para imediatamente, sem re-tentar.
        if (!retryable || round === maxRounds) break; // determinístico ou fim das rodadas.
        await sleep(roundDelayMs);              // 503 high demand: uma única nova tentativa espaçada.
      }
    }
    const cause = lastErr instanceof Error && lastErr.cause ? String((lastErr.cause as { message?: unknown })?.message ?? lastErr.cause) : undefined;
    console.info(`[A2-LIVE-HOMOLOG] ${JSON.stringify({ ok: false, exhausted: true, quota: isQuotaOrRateLimitError(lastErr), error: lastErr instanceof Error ? lastErr.message : String(lastErr), cause })}`);
  })();
}

/**
 * Extrai o token de homologação SOMENTE de cabeçalhos (nunca de query string — evita vazar segredo em
 * URL/proxy/access logs). Preferência `Authorization: Bearer <token>`; alternativa `X-A2-Homolog-Token`.
 * Puro/testável: recebe um getter de header case-insensitive. Retorna null quando ausente.
 */
export function extractHomologToken(getHeader: (name: string) => string | undefined): string | null {
  const auth = getHeader("authorization");
  if (auth) {
    const m = /^bearer\s+(.+)$/i.exec(auth.trim());
    if (m) { const t = m[1].trim(); return t.length > 0 ? t : null; }
  }
  const x = getHeader("x-a2-homolog-token");
  if (x && x.trim().length > 0) return x.trim();
  return null;
}

/** Autorização do endpoint efêmero: exige token esperado configurado E token do request igual. Fail-closed. */
export function isHomologAuthorized(token: string | null, expected: string | undefined): boolean {
  return typeof expected === "string" && expected.length > 0 && token !== null && token === expected;
}

/**
 * Registra o endpoint de homologação live (staging-only, token-gated). No-op em produção.
 */
export function registerA2LiveHomologationRoute(app: Express): void {
  if (APP_CONFIG.isProduction) return; // NUNCA em produção.
  app.get("/__a2/live-homolog", async (req: Request, res: Response) => {
    const expected = process.env.A2_HOMOLOG_TOKEN; // token efêmero, setado só em staging
    // Token SOMENTE via header (Authorization: Bearer … | X-A2-Homolog-Token) — nunca query string; nunca logado.
    const token = extractHomologToken((name) => req.header(name) ?? undefined);
    if (!isHomologAuthorized(token, expected)) { res.status(403).json({ error: "forbidden" }); return; }
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

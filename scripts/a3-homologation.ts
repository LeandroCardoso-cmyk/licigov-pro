/**
 * PHASE A3 — LIVE HOMOLOGATION RUNNER (TEMPORÁRIO, STAGING-ONLY, one-shot).
 *
 * ⚠️ ARTEFATO DE HOMOLOGAÇÃO — NÃO É PARTE DO PRODUTO. Deve ser REMOVIDO antes do merge da PR #222.
 *
 * Propósito: provar, com execução COGNITIVA LIVE em staging (Gemini real, modelo pinado), que os
 * fluxos migrados na A3 roteiam pelo Cognitive Kernel (`executeCognitiveTask`) e persistem
 * proveniência honesta (A1). NÃO abre porta HTTP, NÃO cria rota, NÃO fica residente, NÃO agenda,
 * NÃO faz retry loop, NÃO escreve `official_documents`, NÃO aprova/assina, NÃO cria authority.
 *
 * Guarda de segurança (fail-closed, sem override para produção):
 *   - só executa se APP_ENV === "staging" E A3_HOMOLOGATION_RUN === "1";
 *   - em qualquer outro ambiente (incl. production) ou sem a flag → aborta com exit != 0.
 *
 * Execução (no ambiente conectado ao Railway staging, via Pre-Deploy temporário):
 *   APP_ENV=staging A3_HOMOLOGATION_RUN=1 [A3_HOMOLOGATION_RUN_ID=...] pnpm tsx scripts/a3-homologation.ts
 *
 * Nenhum secret é lido/impresso pelo script: GEMINI_API_KEY/DATABASE_URL vêm do ambiente Railway.
 */

import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { APP_ENV } from "../server/config/env";
import { findCatmatMatches, type CatmatMatch } from "../server/services/catmatMatcher";
import { suggestModality } from "../server/services/ai/suggestions";
import type { ProcessContext } from "../server/services/ai/promptBuilder";
import { generateLegalOpinion } from "../server/services/legalOpinionService";
import { suggestLegalArticle } from "../server/services/legalFrameworkAssistant";
import { listProvenanceByCorrelation, type CognitiveProvenanceRecord } from "../server/db/cognitiveProvenance";

// ─── Constantes institucionais da homologação (NÃO-secretas) ──────────────────
/** Tenant de homologação já usado nas fixtures A1/A2 (não é organization 1, não é dado de produção). */
export const HOMOLOG_TENANT_ID = 990990;
/** Ator de homologação determinístico (apenas propagado ao Kernel/provenance; NÃO é platform admin, não é persistido). */
export const HOMOLOG_ACTOR_USER_ID = 990001;
export const EXPECTED_PROVIDER = "gemini";
export const EXPECTED_MODEL = "gemini-3.8-flash";
export const EXPECTED_FLOW_COUNT = 4;

// ─── Envelope de log SANITIZADO ───────────────────────────────────────────────
export interface HomologEnvelope {
  ok: boolean;
  runId: string;
  flow: string;
  task?: string;
  provider?: string;
  model?: string;
  tenantId?: number;
  correlationId?: string;
  executionStatus?: string;
  groundingState?: string | null;
  evidenceFingerprint?: string | null;
  isReplay?: boolean;
  requiresHumanValidation?: boolean;
  classification?: string;
  message?: string;
}

/**
 * Constrói a linha de log a partir de uma LISTA FIXA de campos seguros (allowlist) — jamais
 * serializa o objeto cru, prompts, env ou qualquer chave inesperada. Garante ausência de secrets.
 */
export function buildHomologLogLine(env: HomologEnvelope): string {
  const safe: HomologEnvelope = {
    ok: env.ok,
    runId: env.runId,
    flow: env.flow,
    task: env.task,
    provider: env.provider,
    model: env.model,
    tenantId: env.tenantId,
    correlationId: env.correlationId,
    executionStatus: env.executionStatus,
    groundingState: env.groundingState,
    evidenceFingerprint: env.evidenceFingerprint ?? null,
    isReplay: env.isReplay,
    requiresHumanValidation: env.requiresHumanValidation,
    classification: env.classification,
    message: env.message,
  };
  // Remove chaves undefined para um log enxuto (nunca inclui campos fora da allowlist acima).
  const compact = Object.fromEntries(Object.entries(safe).filter(([, v]) => v !== undefined));
  return `[A3-LIVE-HOMOLOG] ${JSON.stringify(compact)}`;
}

function emit(env: HomologEnvelope): void {
  console.info(buildHomologLogLine(env));
}

// ─── Guarda staging-only (pura/testável) ──────────────────────────────────────
export function isHomologAllowed(appEnv: string, flag: string | undefined): boolean {
  return appEnv === "staging" && flag === "1";
}

// ─── Agregador (puro/testável): só ok quando os 4 fluxos passam ───────────────
export function aggregateOk(results: readonly { ok: boolean }[]): boolean {
  return results.length === EXPECTED_FLOW_COUNT && results.every((r) => r.ok);
}

// ─── Avaliação de proveniência (pura/testável) ────────────────────────────────
export type GroundingExpectation = "not_applicable_strict" | "not_grounded";

export interface ProvenanceExpectation {
  tenantId: number;
  actorUserId: number;
  task: string;
  correlationId: string;
  grounding: GroundingExpectation;
}

/**
 * Valida a proveniência A1 persistida contra o contrato A3. Fail-closed: qualquer divergência
 * é um problema. NUNCA aceita grounding falso (grounded/partially sem evidência real).
 */
export function evaluateProvenance(
  rec: CognitiveProvenanceRecord | undefined | null,
  exp: ProvenanceExpectation,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (!rec) return { ok: false, problems: ["provenance_not_found"] };
  if (rec.organizationId !== exp.tenantId) problems.push("tenant_mismatch");
  if (rec.correlationId !== exp.correlationId) problems.push("correlation_mismatch");
  if (rec.task !== exp.task) problems.push("task_mismatch");
  if (rec.executionMode !== "cognitive") problems.push("execution_mode_not_cognitive");
  if (rec.provider !== EXPECTED_PROVIDER) problems.push("provider_not_gemini");
  if (rec.model !== EXPECTED_MODEL) problems.push("model_not_pinned");
  if (rec.actorUserId !== String(exp.actorUserId)) problems.push("actor_mismatch");
  if (rec.approvalState !== "generated") problems.push("approval_not_generated");
  if (rec.isReplay !== 0) problems.push("unexpected_replay");
  // Execução: sucesso é "completed" ou "completed_degraded" (degradação honesta, ex.: sem grounding real).
  if (rec.executionStatus !== "completed" && rec.executionStatus !== "completed_degraded") {
    problems.push(`execution_status_${rec.executionStatus}`);
  }
  // Grounding HONESTO: sem evidência real, nunca grounded/partially; evidenceFingerprint deve ser null.
  if (rec.groundingState === "grounded" || rec.groundingState === "partially_grounded") {
    problems.push("false_grounding");
  }
  if (rec.evidenceFingerprint != null) problems.push("unexpected_evidence_fingerprint");
  if (exp.grounding === "not_applicable_strict") {
    if (rec.groundingState !== "not_applicable") problems.push("grounding_not_not_applicable");
  } else {
    // Tasks que declaram grounding/RAG mas sem EvidenceRef real → not_applicable OU ungrounded (honesto).
    if (rec.groundingState !== "not_applicable" && rec.groundingState !== "ungrounded") {
      problems.push(`grounding_unexpected_${rec.groundingState}`);
    }
  }
  return { ok: problems.length === 0, problems };
}

// ─── Avaliação do resultado CATMAT (pura/testável) — §35 ──────────────────────
export function evaluateCatmatResult(matches: readonly CatmatMatch[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (matches.length < 1) problems.push("no_candidates");
  if (matches.length > 3) problems.push("too_many_candidates");
  if (!matches.every((m) => m.requiresHumanValidation === true)) problems.push("missing_human_validation_flag");
  return { ok: problems.length === 0, problems };
}

// ─── Runner LIVE (executa apenas sob a guarda; não é chamado nos testes) ──────
interface FlowResult {
  ok: boolean;
  envelope: HomologEnvelope;
}

/** Pequena espera limitada (NÃO é retry loop): a proveniência é persistida (await) pelo Kernel. */
async function settle(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function checkProvenance(
  runId: string,
  flow: string,
  correlationId: string,
  task: string,
  grounding: GroundingExpectation,
  extra: Partial<HomologEnvelope> = {},
): Promise<FlowResult> {
  await settle(400); // assentamento curto (persistência é awaited no engine); sem loop de retry
  const rows = await listProvenanceByCorrelation(HOMOLOG_TENANT_ID, correlationId);
  const rec = rows.find((r) => r.task === task) ?? rows[0] ?? null;
  const evalp = evaluateProvenance(rec, {
    tenantId: HOMOLOG_TENANT_ID,
    actorUserId: HOMOLOG_ACTOR_USER_ID,
    task,
    correlationId,
    grounding,
  });
  const envelope: HomologEnvelope = {
    ok: evalp.ok,
    runId,
    flow,
    task,
    provider: rec?.provider,
    model: rec?.model,
    tenantId: HOMOLOG_TENANT_ID,
    correlationId,
    executionStatus: rec?.executionStatus,
    groundingState: rec?.groundingState ?? null,
    evidenceFingerprint: rec?.evidenceFingerprint ?? null,
    isReplay: rec ? rec.isReplay === 1 : undefined,
    ...extra,
    ...(evalp.ok ? {} : { classification: "PROVENANCE_MISMATCH", message: evalp.problems.join(",") }),
  };
  return { ok: evalp.ok, envelope };
}

async function runFlow(
  runId: string,
  flow: string,
  fn: () => Promise<FlowResult>,
): Promise<FlowResult> {
  try {
    const result = await fn();
    emit(result.envelope);
    return result;
  } catch (err) {
    // Erro do provider/serviço → defeito funcional (§41). Mensagem curta, sem secret.
    const message = err instanceof Error ? err.message.slice(0, 200) : "erro desconhecido";
    const envelope: HomologEnvelope = { ok: false, runId, flow, classification: "FUNCTIONAL_DEFECT_OR_PROVIDER_ERROR", message };
    emit(envelope);
    return { ok: false, envelope };
  }
}

export async function runHomologation(runId: string): Promise<{ ok: boolean; results: FlowResult[] }> {
  const results: FlowResult[] = [];

  // Anotação explícita: o LIVE positivo de DIRECT NÃO significa catálogo jurídico completo.
  emit({
    ok: true,
    runId,
    flow: "note",
    classification: "REFERENCE_DATA_DEFECT",
    message: "DIRECT PROCUREMENT REFERENCE DATA DEFECT — Art. 75, II ausente do catálogo — tracked by F-LEGAL1",
  });

  // FLUXO 1 — CATMAT_MATCHING (assistivo, não-grounded)
  results.push(
    await runFlow(runId, "catmat", async () => {
      const correlationId = `a3-homolog-catmat-${runId}`;
      const matches = await findCatmatMatches({
        itemDescription: "caneta esferográfica azul, corpo plástico",
        itemType: "material",
        organizationId: HOMOLOG_TENANT_ID,
        correlationId,
        userId: HOMOLOG_ACTOR_USER_ID,
      });
      const catmatEval = evaluateCatmatResult(matches);
      const prov = await checkProvenance(runId, "catmat", correlationId, "CATMAT_MATCHING", "not_applicable_strict", {
        requiresHumanValidation: matches.every((m) => m.requiresHumanValidation === true),
      });
      const ok = prov.ok && catmatEval.ok;
      return {
        ok,
        envelope: ok ? prov.envelope : { ...prov.envelope, ok, classification: prov.envelope.classification ?? "CATMAT_RESULT_INVALID", message: [prov.envelope.message, ...catmatEval.problems].filter(Boolean).join(",") },
      };
    }),
  );

  // FLUXO 2 — AI SUGGESTION (suggestModality → PROCUREMENT_REASONING)
  results.push(
    await runFlow(runId, "suggestion", async () => {
      const correlationId = `a3-homolog-suggestion-${runId}`;
      const ctx: ProcessContext = {
        name: "Homologação A3",
        object: "Aquisição de material de expediente",
        estimatedValue: 1500000, // R$ 15.000,00 em centavos — pequeno e plausível
        modality: null,
      };
      const text = await suggestModality(ctx, {
        organizationId: HOMOLOG_TENANT_ID,
        correlationId,
        userId: HOMOLOG_ACTOR_USER_ID,
      });
      if (!text || text.trim().length === 0) {
        return { ok: false, envelope: { ok: false, runId, flow: "suggestion", classification: "EMPTY_OUTPUT", message: "sugestão vazia" } };
      }
      return checkProvenance(runId, "suggestion", correlationId, "PROCUREMENT_REASONING", "not_grounded");
    }),
  );

  // FLUXO 3 — LEGAL_ANALYSIS (generateLegalOpinion, sourceType "other")
  results.push(
    await runFlow(runId, "legal", async () => {
      const correlationId = `a3-homolog-legal-${runId}`;
      const opinion = await generateLegalOpinion({
        title: "Homologação A3 — consulta jurídica",
        legalQuestion: "É admissível dispensa de licitação por valor para aquisição de material de expediente de baixo valor, à luz da Lei 14.133/2021?",
        sourceType: "other",
        meta: { organizationId: HOMOLOG_TENANT_ID, correlationId, userId: HOMOLOG_ACTOR_USER_ID },
      });
      const structOk = !!opinion.opinion && !!opinion.conclusion && Array.isArray(opinion.citedArticles) && Array.isArray(opinion.jurisprudence);
      if (!structOk) {
        return { ok: false, envelope: { ok: false, runId, flow: "legal", classification: "STRUCTURED_OUTPUT_INVALID", message: "campos do parecer ausentes" } };
      }
      return checkProvenance(runId, "legal", correlationId, "LEGAL_ANALYSIS", "not_grounded");
    }),
  );

  // FLUXO 4 — DIRECT_PROCUREMENT_REASONING (suggestLegalArticle)
  // Cenário coberto por um registro REAL do catálogo (seedDirectContractLegalArticles):
  // FORNECEDOR EXCLUSIVO → Art. 74, I (inexigibilidade). NÃO usar o cenário "material de
  // expediente de baixo valor" da 2ª LIVE: ele levava a Art. 75, II, que NÃO existe no catálogo
  // (DIRECT PROCUREMENT REFERENCE DATA DEFECT — Art. 75, II ausente — tracked by F-LEGAL1).
  // O objetivo é provar o fluxo técnico migrado ponta a ponta com uma referência disponível,
  // sem inserir dado ad hoc nem induzir escolha juridicamente incorreta.
  results.push(
    await runFlow(runId, "direct", async () => {
      const correlationId = `a3-homolog-direct-${runId}`;
      const suggestion = await suggestLegalArticle(
        {
          situation: "Aquisição de peças originais de veículo que só podem ser fornecidas por representante comercial exclusivo, com atestado de exclusividade do fabricante.",
          object: "Peças originais de veículo (fornecedor exclusivo)",
          estimatedValue: 4000000, // R$ 40.000,00 em centavos
          urgency: "normal",
          hasExclusiveSupplier: true,
        },
        { organizationId: HOMOLOG_TENANT_ID, correlationId, userId: HOMOLOG_ACTOR_USER_ID },
      );
      // O serviço é fail-closed: só retorna se o articleNumber casar (semanticamente) com o catálogo.
      const catalogOk = suggestion.articleId > 0 && !!suggestion.articleNumber && (suggestion.articleType === "dispensa" || suggestion.articleType === "inexigibilidade");
      if (!catalogOk) {
        return { ok: false, envelope: { ok: false, runId, flow: "direct", classification: "ARTICLE_NOT_IN_CATALOG", message: "artigo sugerido não resolveu no catálogo" } };
      }
      return checkProvenance(runId, "direct", correlationId, "DIRECT_PROCUREMENT_REASONING", "not_grounded");
    }),
  );

  return { ok: aggregateOk(results), results };
}

// ─── Entrypoint (só executa em run direto; nunca em import/teste/boot) ─────────
async function main(): Promise<void> {
  const flag = process.env.A3_HOMOLOGATION_RUN;
  if (!isHomologAllowed(APP_ENV, flag)) {
    emit({
      ok: false,
      runId: "-",
      flow: "guard",
      classification: "HOMOLOGATION_NOT_ALLOWED",
      message: `requer APP_ENV=staging e A3_HOMOLOGATION_RUN=1 (APP_ENV atual=${APP_ENV})`,
    });
    process.exit(1);
    return;
  }
  const runId = (process.env.A3_HOMOLOGATION_RUN_ID ?? "").trim() || randomUUID().slice(0, 8);
  const { ok, results } = await runHomologation(runId);
  emit({
    ok,
    runId,
    flow: "summary",
    message: results.map((r) => `${r.envelope.flow}:${r.ok ? "pass" : "fail"}`).join(" "),
  });
  process.exit(ok ? 0 : 1);
}

// Executa APENAS quando invocado diretamente (`tsx scripts/a3-homologation.ts`).
// Em import por testes/vitest, `process.argv[1]` não é este arquivo → main() não roda.
const invokedDirectly = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
  } catch {
    return false;
  }
})();
if (invokedDirectly) void main();

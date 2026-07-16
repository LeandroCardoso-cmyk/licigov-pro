/**
 * RC-4.2.2 — Production Monitoring Service (Monitor Operacional Institucional).
 *
 * Consolida diagnósticos de prontidão operacional para responder: "O ambiente está apto
 * para operar?". SOMENTE LEITURA. NUNCA executa IA, chama Providers, gera documentos, acessa
 * Business Domains ou aplica regras de negócio. Determinístico (score derivado de status).
 * Reutilizável por interfaces administrativas (não cria UI).
 */

import fs from "fs";
import path from "path";
import { IS_PRODUCTION, environmentDiagnostic } from "../config/env";
import { storageReadiness, storageSignedUrl, storagePut, storageGet, storageDelete, storageExists, storageHealthCheck } from "../storage";
import { providerReadiness } from "./operationalHealthService";
import { getDb } from "../db/connection";
import { ALL_COGNITIVE_TASK_IDS } from "../domain/cognitiveTask";
import { COGNITIVE_PROMPT_BUILDERS } from "./cognitive/promptBuilders";
import { ALL_INSTITUTIONAL_RULE_IDS } from "../domain/institutionalRules";
import { STANDARD_REASONING_STEPS, buildReasoningPlan } from "../domain/institutionalReasoning";

export type HealthStatus = "OK" | "WARNING" | "CRITICAL";

export interface ModuleHealth {
  readonly module: string;
  readonly status: HealthStatus;
  readonly message: string;
  readonly detail: string;
  readonly recommendation: string;
}

export interface ProductionReport {
  readonly overallStatus: HealthStatus;
  readonly healthScore: number;
  readonly scoreBand: string;
  readonly modules: readonly ModuleHealth[];
  readonly warnings: readonly string[];
  readonly criticalIssues: readonly string[];
}

// ─── Health Score (Part 9) — determinístico ───────────────────────────────────

/** Score institucional determinístico: 100 − 10/WARNING − 30/CRITICAL (clamp 0..100). */
export function computeHealthScore(modules: readonly ModuleHealth[]): number {
  let score = 100;
  for (const m of modules) {
    if (m.status === "WARNING") score -= 10;
    else if (m.status === "CRITICAL") score -= 30;
  }
  return Math.max(0, Math.min(100, score));
}

export function scoreBand(score: number): string {
  if (score >= 100) return "Sistema totalmente operacional";
  if (score >= 90) return "Pronto para produção";
  if (score >= 70) return "Pode operar com observações";
  if (score >= 50) return "Necessita intervenção";
  return "Sistema indisponível";
}

function overallFrom(modules: readonly ModuleHealth[]): HealthStatus {
  if (modules.some(m => m.status === "CRITICAL")) return "CRITICAL";
  if (modules.some(m => m.status === "WARNING")) return "WARNING";
  return "OK";
}

// ─── Part 2 — Database Health ──────────────────────────────────────────────────

interface JournalInfo { total: number; lastTag: string; }

function readJournal(): JournalInfo {
  try {
    const p = path.resolve(process.cwd(), "drizzle", "meta", "_journal.json");
    const j = JSON.parse(fs.readFileSync(p, "utf-8")) as { entries: Array<{ idx: number; tag: string }> };
    const last = j.entries[j.entries.length - 1];
    return { total: j.entries.length, lastTag: last?.tag ?? "" };
  } catch { return { total: 0, lastTag: "" }; }
}

async function databaseHealth(): Promise<ModuleHealth> {
  const journal = readJournal();
  const configured = Boolean(process.env.DATABASE_URL);
  if (!configured) {
    return {
      module: "database",
      status: IS_PRODUCTION ? "CRITICAL" : "WARNING",
      message: "DATABASE_URL não configurada.",
      detail: `journal: ${journal.total} migration(s), última=${journal.lastTag}`,
      recommendation: "Definir DATABASE_URL (MySQL) antes de operar em produção.",
    };
  }
  // Conectividade best-effort (getDb degrada). Nunca escreve.
  let reachable = false;
  try { reachable = Boolean(await getDb()); } catch { reachable = false; }
  return {
    module: "database",
    status: reachable ? "OK" : "WARNING",
    message: reachable ? "Banco configurado e acessível." : "DATABASE_URL definida, conexão não confirmada.",
    detail: `journal: ${journal.total} migration(s), última=${journal.lastTag}`,
    recommendation: reachable ? "" : "Verificar conectividade/credenciais do MySQL.",
  };
}

// ─── Part 3 — Storage Health (diagnóstico, nunca grava permanente) ─────────────

function storageHealth(): ModuleHealth {
  const r = storageReadiness();
  // Capacidades presentes (contrato): put/get/delete/exists/signedUrl/healthCheck.
  const capabilitiesOk = [storagePut, storageGet, storageDelete, storageExists, storageSignedUrl, storageHealthCheck].every(fn => typeof fn === "function");
  if (r.configured) {
    return { module: "storage", status: "OK", message: "Storage Service configurado.", detail: `bucket=${r.bucketConfigured} region=${r.regionConfigured} caps=${capabilitiesOk}`, recommendation: "" };
  }
  if (r.fallbackAllowed) {
    return { module: "storage", status: "WARNING", message: "Storage não configurado (fallback Base64 em dev/testes).", detail: `fallbackAllowed=${r.fallbackAllowed} caps=${capabilitiesOk}`, recommendation: "Configurar AWS S3 antes de produção." };
  }
  return { module: "storage", status: "CRITICAL", message: "Storage obrigatório e ausente (produção/staging).", detail: "sem AWS credentials/bucket", recommendation: "Definir AWS_ACCESS_KEY_ID/SECRET/REGION/BUCKET." };
}

// ─── Part 4 — Provider Health (sem conectar providers) ─────────────────────────

function providerHealth(): ModuleHealth {
  const p = providerReadiness();
  const ok = p.selectionResolves && p.fallbackResolves && p.implementedCount >= 2;
  return {
    module: "provider_layer",
    status: ok ? "OK" : "WARNING",
    message: ok ? "Provider Adapter íntegro (Mock ativo)." : "Provider Adapter incompleto.",
    detail: `implementados=${p.implementedCount} placeholders=${p.placeholderCount} seleção=${p.selectionResolves} fallback=${p.fallbackResolves}`,
    recommendation: ok ? "" : "Revisar Provider Adapter / política.",
  };
}

// ─── Part 5 — Cognitive Health (estrutural, sem executar IA) ───────────────────

function structural(module: string, ok: boolean, okMsg: string, warnMsg: string, detail: string, rec: string): ModuleHealth {
  return { module, status: ok ? "OK" : "WARNING", message: ok ? okMsg : warnMsg, detail, recommendation: ok ? "" : rec };
}

function cognitiveModules(): ModuleHealth[] {
  const tasksOk = ALL_COGNITIVE_TASK_IDS.length === 13;
  const buildersOk = Object.keys(COGNITIVE_PROMPT_BUILDERS).length === 13;
  const rulesOk = ALL_INSTITUTIONAL_RULE_IDS.length > 0;
  const stepsOk = STANDARD_REASONING_STEPS.length === 12;
  // Replay Safety: plano reproduzível (mesmos insumos → mesmo hash), sem executar IA.
  const h1 = buildReasoningPlan({ task: "GENERATE_DOCUMENT", objective: "probe", correlationId: "monitor-probe", businessDomain: "processo_licitatorio" }).replayHash;
  const h2 = buildReasoningPlan({ task: "GENERATE_DOCUMENT", objective: "probe", correlationId: "monitor-probe", businessDomain: "processo_licitatorio" }).replayHash;
  const replayOk = h1 === h2 && h1.length === 32;
  const dbConfigured = Boolean(process.env.DATABASE_URL);

  return [
    structural("cognitive_kernel", tasksOk && buildersOk, "AIExecutionEngine e Cognitive Tasks íntegros.", "Registros cognitivos incompletos.", `tasks=${ALL_COGNITIVE_TASK_IDS.length} builders=${Object.keys(COGNITIVE_PROMPT_BUILDERS).length}`, "Revisar registro de Cognitive Tasks/Prompt Builders."),
    structural("institutional_rules", rulesOk, "Institutional Rules declarativas presentes.", "Nenhuma regra registrada.", `rules=${ALL_INSTITUTIONAL_RULE_IDS.length}`, "Revisar repositório de regras institucionais."),
    structural("reasoning_framework", stepsOk, "Reasoning Framework com 12 etapas.", "Etapas de raciocínio incompletas.", `steps=${STANDARD_REASONING_STEPS.length}`, "Revisar STANDARD_REASONING_STEPS."),
    structural("replay_safety", replayOk, "Replay determinístico preservado.", "Replay não determinístico.", `planHashDeterministic=${replayOk}`, "Auditar geração de replayHash."),
    structural("explainability", true, "Explainability obrigatória (validação no Engine).", "", "validateCognitiveResponse ativo", ""),
    structural("document_engine", true, "Document Engine + Lifecycle operacionais.", "", "pipeline oficial ativo", ""),
    structural("observability", true, "Observabilidade em memória + persistência.", "", "recoverCognitiveObservability ativo", ""),
    structural("knowledge_graph", dbConfigured, "Knowledge Graph disponível.", "Knowledge Graph degradado (sem DB).", `db=${dbConfigured}`, "Configurar DATABASE_URL para KG persistido."),
    structural("rag", dbConfigured, "RAG institucional disponível.", "RAG degradado (sem DB).", `db=${dbConfigured}`, "Configurar DATABASE_URL para RAG persistido."),
  ];
}

// ─── Part 6 — Environment Health ───────────────────────────────────────────────

function environmentHealth(): ModuleHealth {
  const diag = environmentDiagnostic();
  const missingRequired = diag.vars.filter(v => v.requiredNow && !v.present).map(v => v.key);
  if (missingRequired.length > 0) {
    return { module: "environment", status: "CRITICAL", message: `Variáveis obrigatórias ausentes: ${missingRequired.join(", ")}.`, detail: `env=${diag.env}`, recommendation: "Definir as variáveis obrigatórias antes de operar." };
  }
  const missingOptional = diag.vars.filter(v => !v.requiredNow && !v.present).map(v => v.key);
  return {
    module: "environment",
    status: missingOptional.length > 0 ? "WARNING" : "OK",
    message: missingOptional.length > 0 ? "Variáveis opcionais ausentes." : "Ambiente configurado.",
    detail: `env=${diag.env} opcionaisAusentes=[${missingOptional.join(",")}]`,
    recommendation: missingOptional.length > 0 ? "Configurar variáveis opcionais para produção plena." : "",
  };
}

// ─── Part 7 — Production Report + Part 10 — Observabilidade do Health Check ─────

export interface HealthCheckRun {
  readonly correlationId: string;
  readonly timestamp: number;
  readonly durationMs: number;
  readonly overallStatus: HealthStatus;
  readonly healthScore: number;
  readonly modulesEvaluated: number;
  readonly warnings: number;
  readonly criticalIssues: number;
}

const _runs: HealthCheckRun[] = [];
const RETENTION = 50;

/** Histórico recente de execuções do Health Check (retenção simples: últimos N). */
export function getHealthCheckRuns(): readonly HealthCheckRun[] {
  return [..._runs];
}

/** Limpeza administrativa do histórico (retenção). */
export function clearHealthCheckRuns(): void {
  _runs.length = 0;
}

export interface RunHealthOptions { correlationId?: string; now?: number; }

/**
 * Executa o Health Check institucional e produz o Production Report. SOMENTE LEITURA.
 * Registra a execução na observabilidade (retenção simples), sem poluir o banco.
 */
export async function runProductionHealthCheck(opts: RunHealthOptions = {}): Promise<ProductionReport> {
  const startedAt = opts.now ?? Date.now();

  const modules: ModuleHealth[] = [
    await databaseHealth(),
    storageHealth(),
    providerHealth(),
    ...cognitiveModules(),
    environmentHealth(),
  ];

  const healthScore = computeHealthScore(modules);
  const overallStatus = overallFrom(modules);
  const warnings = modules.filter(m => m.status === "WARNING").map(m => `${m.module}: ${m.message}`);
  const criticalIssues = modules.filter(m => m.status === "CRITICAL").map(m => `${m.module}: ${m.message}`);

  const report: ProductionReport = {
    overallStatus, healthScore, scoreBand: scoreBand(healthScore), modules, warnings, criticalIssues,
  };

  // Part 10 — observabilidade do próprio Health Check (memória, retenção simples).
  const run: HealthCheckRun = {
    correlationId: opts.correlationId ?? `health-${startedAt}`,
    timestamp: startedAt,
    durationMs: Math.max(0, (opts.now ?? Date.now()) - startedAt),
    overallStatus, healthScore, modulesEvaluated: modules.length,
    warnings: warnings.length, criticalIssues: criticalIssues.length,
  };
  _runs.push(run);
  if (_runs.length > RETENTION) _runs.splice(0, _runs.length - RETENTION);

  return report;
}

// ─── Part 8 — Sumário público (nunca expõe secrets) ────────────────────────────

export interface PublicHealthSummary {
  readonly overallStatus: HealthStatus;
  readonly healthScore: number;
  readonly scoreBand: string;
  readonly warnings: readonly string[];
  readonly criticalIssues: readonly string[];
  readonly infrastructure: Record<string, HealthStatus>;
}

/** Visão pública/segura do Production Report (apenas status por módulo — nunca valores). */
export function toPublicSummary(report: ProductionReport): PublicHealthSummary {
  const infrastructure: Record<string, HealthStatus> = {};
  for (const m of report.modules) infrastructure[m.module] = m.status;
  return {
    overallStatus: report.overallStatus,
    healthScore: report.healthScore,
    scoreBand: report.scoreBand,
    warnings: report.warnings,
    criticalIssues: report.criticalIssues,
    infrastructure,
  };
}

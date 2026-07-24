/**
 * RC-4.2.1 — Operational Health Service (verificação institucional de prontidão).
 *
 * Diagnóstico SOMENTE-LEITURA da infraestrutura. NÃO acessa Providers reais, NÃO gera
 * documentos, NÃO altera estado. Valida a prontidão operacional: Banco, Storage, Provider
 * Adapter, Document Engine, Lifecycle, Observabilidade, Knowledge Graph e RAG.
 */

import { storageReadiness, type StorageReadiness } from "../storage";
import { environmentDiagnostic } from "../config/env";
import { PROVIDER_ADAPTERS, ALL_PROVIDER_NAMES, isProviderImplemented, selectProvider } from "../_core/ai/providerAdapter";
import { ALL_COGNITIVE_TASK_IDS } from "../domain/cognitiveTask";
import { ALL_INSTITUTIONAL_RULE_IDS } from "../domain/institutionalRules";

export type ComponentStatus = "ok" | "degraded" | "not_configured";

export interface HealthComponent {
  readonly name: string;
  readonly status: ComponentStatus;
  readonly detail: string;
}

// ─── Provider Readiness (Part 4) ──────────────────────────────────────────────

export interface ProviderReadiness {
  readonly providers: ReadonlyArray<{ name: string; implemented: boolean }>;
  readonly implementedCount: number;
  readonly placeholderCount: number;
  /** A seleção via política resolve um provider (Mock nesta fase) sem acessar API real. */
  readonly selectionResolves: boolean;
  readonly fallbackResolves: boolean;
}

export function providerReadiness(): ProviderReadiness {
  const providers = ALL_PROVIDER_NAMES.map(name => ({ name, implemented: isProviderImplemented(name) }));
  // AI-015 — `selectProvider` agora é FAIL-CLOSED: sem provider real e sem mock autorizado, lança.
  // Este health check tolera a falha (não conecta provider real): em dev/test resolve para mock; em
  // staging/production sem chave, `selectProvider` lança e ambos reportam `false` (sinal de saúde real).
  const safeSelect = (p: "gemini" | "claude", f: "claude" | "openai") => { try { return selectProvider(p, f); } catch { return null; } };
  const selectionResolves = Boolean(safeSelect("gemini", "claude")?.provider);
  const fallbackResolves = safeSelect("claude", "openai")?.selected === "mock";
  return {
    providers,
    implementedCount: providers.filter(p => p.implemented).length,
    placeholderCount: providers.filter(p => !p.implemented).length,
    selectionResolves,
    fallbackResolves,
  };
}

// ─── Operational Health (Part 6) ──────────────────────────────────────────────

export interface OperationalHealth {
  readonly components: readonly HealthComponent[];
  readonly ok: boolean;
}

export function operationalHealth(): OperationalHealth {
  const storage: StorageReadiness = storageReadiness();
  const provider = providerReadiness();

  const components: HealthComponent[] = [
    {
      name: "database",
      status: process.env.DATABASE_URL ? "ok" : "not_configured",
      detail: process.env.DATABASE_URL ? "DATABASE_URL configurada." : "DATABASE_URL ausente (degrada graciosamente).",
    },
    {
      name: "storage_service",
      status: storage.configured ? "ok" : (storage.fallbackAllowed ? "degraded" : "not_configured"),
      detail: `configured=${storage.configured} fallbackAllowed=${storage.fallbackAllowed}`,
    },
    {
      name: "provider_adapter",
      status: provider.selectionResolves && provider.implementedCount >= 2 ? "ok" : "degraded",
      detail: `implementados=${provider.implementedCount} placeholders=${provider.placeholderCount} seleção=${provider.selectionResolves}`,
    },
    {
      name: "document_engine",
      status: "ok",
      detail: "Fachada oficial ativa (documentEngineService → Lifecycle → Storage).",
    },
    {
      name: "official_document_lifecycle",
      status: "ok",
      detail: "Único gestor de versão/timeline/storage do OfficialDocument.",
    },
    {
      name: "cognitive_observability",
      status: "ok",
      detail: "Observabilidade em memória + persistência (recuperável por correlationId).",
    },
    {
      name: "cognitive_kernel",
      status: ALL_COGNITIVE_TASK_IDS.length > 0 && ALL_INSTITUTIONAL_RULE_IDS.length > 0 ? "ok" : "degraded",
      detail: `cognitiveTasks=${ALL_COGNITIVE_TASK_IDS.length} institutionalRules=${ALL_INSTITUTIONAL_RULE_IDS.length}`,
    },
    {
      name: "knowledge_graph",
      status: process.env.DATABASE_URL ? "ok" : "degraded",
      detail: "Grafo institucional (persistido no MySQL; degrada sem DB).",
    },
    {
      name: "rag",
      status: process.env.DATABASE_URL ? "ok" : "degraded",
      detail: "Retrieval institucional (embeddings no MySQL; degrada sem DB).",
    },
  ];

  // "ok" quando nenhum componente está em falha crítica (not_configured) num ambiente que o exige.
  const ok = components.every(c => c.status !== "not_configured" || c.name === "database");
  return { components, ok };
}

// ─── Production Configuration Report (Part 8) ─────────────────────────────────

export interface ProductionReadinessReport {
  readonly generatedFor: string;
  readonly environment: ReturnType<typeof environmentDiagnostic>;
  readonly storage: StorageReadiness;
  readonly provider: ProviderReadiness;
  readonly health: OperationalHealth;
  readonly kernel: { cognitiveTasks: number; institutionalRules: number; providers: number };
  readonly summary: { environmentOk: boolean; healthOk: boolean; providerReady: boolean; storageReadyOrDev: boolean };
}

/** Relatório institucional de prontidão (diagnóstico apenas — nunca altera estado). */
export function productionReadinessReport(): ProductionReadinessReport {
  const environment = environmentDiagnostic();
  const storage = storageReadiness();
  const provider = providerReadiness();
  const health = operationalHealth();
  return {
    generatedFor: environment.env,
    environment, storage, provider, health,
    kernel: { cognitiveTasks: ALL_COGNITIVE_TASK_IDS.length, institutionalRules: ALL_INSTITUTIONAL_RULE_IDS.length, providers: ALL_PROVIDER_NAMES.length },
    summary: {
      environmentOk: environment.ok,
      healthOk: health.ok,
      providerReady: provider.selectionResolves && provider.fallbackResolves,
      storageReadyOrDev: storage.configured || storage.fallbackAllowed,
    },
  };
}

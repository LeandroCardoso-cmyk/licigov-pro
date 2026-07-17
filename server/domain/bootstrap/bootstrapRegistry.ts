/**
 * RC-X.2 — Institutional Bootstrap Framework · Service Registry (Part 7 + Part 11).
 *
 * Cada subsistema registra: id, dependencies, initializer, healthCheck, shutdown, metadata.
 * O registro é declarativo e append-only. A EXTENSIBILIDADE (Part 11) ocorre registrando um novo
 * subsistema — nunca alterando o BootstrapKernel. Initializer/healthCheck/shutdown são funções
 * PURAS e determinísticas (sem regra de negócio, sem IA, sem efeito colateral real).
 */

import type { BootstrapHealth } from "./bootstrapHealth";

/** Entrada de inicialização passada ao initializer (contexto estrutural, sem sessão real). */
export interface BootstrapStageInput {
  readonly tenantId: number;
  readonly stageId: string;
  readonly metadata: Record<string, unknown>;
}

/** Resultado declarativo de um initializer (sem side effects). */
export interface BootstrapStageOutcome {
  readonly status: "completed" | "failed" | "skipped";
  readonly health: BootstrapHealth;
  readonly detail: string;
  /** Duração declarativa (ms) — opcional; padrão 0 (determinístico). */
  readonly durationHint?: number;
  readonly metadata?: Record<string, unknown>;
}

export type BootstrapInitializer = (input: BootstrapStageInput) => BootstrapStageOutcome;
export type BootstrapHealthCheck = (input: BootstrapStageInput) => BootstrapHealth;
export type BootstrapShutdown = (input: BootstrapStageInput) => void;

export interface BootstrapSubsystem {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly dependencies: readonly string[];
  readonly initializer: BootstrapInitializer;
  readonly healthCheck: BootstrapHealthCheck;
  readonly shutdown: BootstrapShutdown;
  readonly metadata: Record<string, unknown>;
}

export interface BootstrapRegistry {
  readonly subsystems: readonly BootstrapSubsystem[];
}

/** Initializer padrão — conclui com sucesso, determinístico. */
export const defaultInitializer: BootstrapInitializer = (input) => ({
  status: "completed", health: "READY", detail: `Subsistema "${input.stageId}" inicializado.`, durationHint: 0,
});

export const defaultHealthCheck: BootstrapHealthCheck = () => "READY";
export const defaultShutdown: BootstrapShutdown = () => { /* noop */ };

export function createBootstrapRegistry(subsystems: BootstrapSubsystem[] = []): BootstrapRegistry {
  const sorted = [...subsystems].sort((a, b) => a.id.localeCompare(b.id));
  return { subsystems: sorted };
}

export interface RegisterSubsystemParams {
  id: string;
  name?: string;
  description?: string;
  dependencies?: string[];
  initializer?: BootstrapInitializer;
  healthCheck?: BootstrapHealthCheck;
  shutdown?: BootstrapShutdown;
  metadata?: Record<string, unknown>;
}

/** Registra um subsistema (append-only; idempotente por id). Extensibilidade (Part 11). */
export function registerSubsystem(registry: BootstrapRegistry, params: RegisterSubsystemParams): BootstrapRegistry {
  if (registry.subsystems.some(s => s.id === params.id)) return registry;
  const subsystem: BootstrapSubsystem = {
    id: params.id, name: params.name ?? params.id, description: params.description ?? "",
    dependencies: params.dependencies ?? [], initializer: params.initializer ?? defaultInitializer,
    healthCheck: params.healthCheck ?? defaultHealthCheck, shutdown: params.shutdown ?? defaultShutdown,
    metadata: params.metadata ?? {},
  };
  return createBootstrapRegistry([...registry.subsystems, subsystem]);
}

export function getSubsystem(registry: BootstrapRegistry, id: string): BootstrapSubsystem | null {
  return registry.subsystems.find(s => s.id === id) ?? null;
}

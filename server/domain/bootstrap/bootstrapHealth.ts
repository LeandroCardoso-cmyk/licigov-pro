/**
 * RC-X.2 — Institutional Bootstrap Framework · Health Model (Part 8).
 *
 * Saúde de cada subsistema/etapa e agregação da saúde global. Declarativo, determinístico.
 */

export type BootstrapHealth = "READY" | "DEGRADED" | "FAILED" | "INITIALIZING" | "UNKNOWN";

export const ALL_BOOTSTRAP_HEALTH: BootstrapHealth[] = [
  "READY", "DEGRADED", "FAILED", "INITIALIZING", "UNKNOWN",
];

/** Severidade (maior = pior) — usada para agregar a saúde global (pior prevalece). */
const SEVERITY: Record<BootstrapHealth, number> = {
  READY: 0, INITIALIZING: 1, UNKNOWN: 2, DEGRADED: 3, FAILED: 4,
};

/** Agrega várias saúdes numa saúde global — o pior estado prevalece. Determinístico. */
export function aggregateHealth(healths: readonly BootstrapHealth[]): BootstrapHealth {
  if (healths.length === 0) return "UNKNOWN";
  return [...healths].sort((a, b) => SEVERITY[b] - SEVERITY[a])[0];
}

export function isHealthy(health: BootstrapHealth): boolean {
  return health === "READY";
}

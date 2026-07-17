/**
 * RC-X.2 — Institutional Bootstrap Framework · Platform State (Part 5).
 *
 * Estados permanentes da plataforma institucional e transições válidas. Declarativo,
 * determinístico. Sem regra de negócio, sem IA, sem sessão real.
 */

export type PlatformState =
  | "BOOTING" | "INITIALIZING" | "READY" | "FAILED" | "RELOADING" | "SUSPENDED";

export const ALL_PLATFORM_STATES: PlatformState[] = [
  "BOOTING", "INITIALIZING", "READY", "FAILED", "RELOADING", "SUSPENDED",
];

/** Transições permitidas entre estados. */
export const VALID_PLATFORM_TRANSITIONS: Record<PlatformState, readonly PlatformState[]> = {
  BOOTING: ["INITIALIZING", "FAILED"],
  INITIALIZING: ["READY", "FAILED"],
  READY: ["RELOADING", "SUSPENDED", "FAILED"],
  FAILED: ["BOOTING", "RELOADING"],
  RELOADING: ["READY", "FAILED"],
  SUSPENDED: ["READY", "FAILED"],
};

export function canTransition(from: PlatformState, to: PlatformState): boolean {
  return VALID_PLATFORM_TRANSITIONS[from].includes(to);
}

export function isTerminal(state: PlatformState): boolean {
  return state === "READY" || state === "FAILED";
}

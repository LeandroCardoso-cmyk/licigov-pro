/**
 * Lógica PURA de tema (claro / escuro / sistema) — sem acesso a window/document.
 *
 * Extraída de ThemeContext para ser testável em ambiente node (Vitest) e para
 * que o script anti-flash de index.html e o provider React compartilhem a MESMA
 * regra de resolução. O provider injeta o estado do SO (prefers-color-scheme).
 */

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

/** Um valor é um Theme válido? (guarda de tipo para dados vindos do localStorage). */
export function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

/** Normaliza o valor lido do storage; usa `fallback` quando ausente/ inválido. */
export function normalizeStoredTheme(value: unknown, fallback: Theme): Theme {
  return isTheme(value) ? value : fallback;
}

/**
 * Resolve a preferência para o tema efetivamente aplicado.
 * `systemPrefersDark` é o resultado de matchMedia("(prefers-color-scheme: dark)").
 */
export function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return theme;
}

/** Alterna claro↔escuro a partir do tema JÁ resolvido. */
export function toggledTheme(resolved: ResolvedTheme): ResolvedTheme {
  return resolved === "dark" ? "light" : "dark";
}

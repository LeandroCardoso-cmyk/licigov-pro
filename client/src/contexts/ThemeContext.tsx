import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  THEME_STORAGE_KEY,
  normalizeStoredTheme,
  resolveTheme,
  toggledTheme,
  type ResolvedTheme,
  type Theme,
} from "./themeLogic";

/**
 * ThemeProvider ÚNICO do LiciGov Pro — claro / escuro / sistema.
 *
 * - Preferência persistida em localStorage ("theme"), sobrevive ao reload.
 * - Aplicada ANTES da renderização por um script inline em index.html (sem flash).
 * - No modo "system", segue prefers-color-scheme e reage a mudanças do SO.
 * - Aplica a classe `.dark` no <html> (Tailwind v4: @custom-variant dark) + color-scheme.
 * - A REGRA de resolução vive em ./themeLogic (pura, testável e compartilhada com index.html).
 */

export { THEME_STORAGE_KEY };
export type { Theme, ResolvedTheme };

interface ThemeContextType {
  /** Preferência escolhida (light | dark | system). */
  theme: Theme;
  /** Tema efetivamente aplicado (light | dark) — use para ícones/estado visual. */
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  /** Alterna claro↔escuro (a partir do tema resolvido). */
  toggleTheme: () => void;
  /** Sempre true — mantido por compatibilidade com consumidores existentes. */
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Wrappers com acesso ao ambiente (window/document). A regra pura vive em ./themeLogic.
function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function resolve(theme: Theme): ResolvedTheme {
  return resolveTheme(theme, systemPrefersDark());
}
function apply(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}
function readStored(fallback: Theme): Theme {
  try {
    return normalizeStoredTheme(localStorage.getItem(THEME_STORAGE_KEY), fallback);
  } catch {
    return fallback;
  }
}

interface ThemeProviderProps {
  children: React.ReactNode;
  /** Fallback quando nada está armazenado (default: "system"). */
  defaultTheme?: Theme;
  /** @deprecated mantido por compatibilidade — o tema é sempre alternável. */
  switchable?: boolean;
}

export function ThemeProvider({ children, defaultTheme = "system" }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => readStored(defaultTheme));
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolve(theme));

  // Aplica o tema e persiste sempre que a preferência muda.
  useEffect(() => {
    const r = resolve(theme);
    setResolvedTheme(r);
    apply(r);
    try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* ignore */ }
  }, [theme]);

  // No modo "system", segue mudanças do SO em tempo real.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => { const r = resolve("system"); setResolvedTheme(r); apply(r); };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(
    () => setThemeState((prev) => toggledTheme(resolve(prev))),
    []
  );

  // Atalho de teclado: Ctrl/Cmd + Shift + D (claro↔escuro).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "D" || e.key === "d")) {
        e.preventDefault();
        setThemeState((prev) => toggledTheme(resolve(prev)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme, switchable: true }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}

/**
 * Testes da lógica PURA de tema (claro / escuro / sistema).
 * Esta é exatamente a regra usada pelo ThemeProvider (ThemeContext) e espelhada
 * no script anti-flash de index.html — testável sem DOM.
 */

import { describe, it, expect } from "vitest";
import {
  THEME_STORAGE_KEY,
  isTheme,
  normalizeStoredTheme,
  resolveTheme,
  toggledTheme,
} from "./themeLogic";

describe("themeLogic · chave de persistência", () => {
  it("usa a chave 'theme' (mesma do script anti-flash de index.html)", () => {
    expect(THEME_STORAGE_KEY).toBe("theme");
  });
});

describe("themeLogic · isTheme", () => {
  it("aceita apenas light | dark | system", () => {
    expect(isTheme("light")).toBe(true);
    expect(isTheme("dark")).toBe(true);
    expect(isTheme("system")).toBe(true);
  });

  it("rejeita valores inválidos, nulos e não-strings", () => {
    expect(isTheme("App")).toBe(false);
    expect(isTheme(null)).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isTheme(42)).toBe(false);
  });
});

describe("themeLogic · normalizeStoredTheme", () => {
  it("retorna a preferência armazenada quando válida", () => {
    expect(normalizeStoredTheme("dark", "system")).toBe("dark");
    expect(normalizeStoredTheme("light", "system")).toBe("light");
    expect(normalizeStoredTheme("system", "light")).toBe("system");
  });

  it("cai no fallback quando o valor é ausente/ inválido", () => {
    expect(normalizeStoredTheme(null, "system")).toBe("system");
    expect(normalizeStoredTheme("bogus", "light")).toBe("light");
  });
});

describe("themeLogic · resolveTheme", () => {
  it("light/dark resolvem para si mesmos, ignorando o SO", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("system segue o prefers-color-scheme do SO", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("themeLogic · toggledTheme", () => {
  it("alterna claro↔escuro a partir do tema resolvido", () => {
    expect(toggledTheme("dark")).toBe("light");
    expect(toggledTheme("light")).toBe("dark");
  });
});

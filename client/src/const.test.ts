/**
 * Testes da identidade institucional centralizada.
 * Blindam a causa-raiz do bug "App": sem VITE_APP_TITLE, o fallback DEVE ser
 * "LiciGov Pro" (nunca o genérico "App").
 */

import { describe, it, expect } from "vitest";
import { APP_TITLE, APP_SHORT_NAME, APP_DESCRIPTION, APP_LOGO } from "./const";

describe("Identidade institucional (const.ts)", () => {
  it("APP_TITLE tem fallback 'LiciGov Pro' (sem VITE_APP_TITLE definido)", () => {
    expect(APP_TITLE).toBe("LiciGov Pro");
  });

  it("APP_TITLE nunca é o genérico 'App' (regressão do bug original)", () => {
    expect(APP_TITLE).not.toBe("App");
  });

  it("APP_SHORT_NAME é 'LiciGov' (sidebar recolhido / contextos estreitos)", () => {
    expect(APP_SHORT_NAME).toBe("LiciGov");
  });

  it("APP_DESCRIPTION é o subtítulo institucional", () => {
    expect(APP_DESCRIPTION).toBe("Sistema Operacional Cognitivo para Licitações Públicas");
  });

  it("APP_LOGO aponta para a logo transparente (legível no dark mode)", () => {
    expect(APP_LOGO).toBe("/logo-original-transparent.png");
    expect(APP_LOGO).toMatch(/transparent/);
  });
});

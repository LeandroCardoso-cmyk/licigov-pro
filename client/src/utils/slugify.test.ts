/**
 * PR A.1 — utils/slugify.ts.
 */

import { describe, it, expect } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("minúsculas, espaços viram hífen", () => {
    expect(slugify("Prefeitura de Moreira Sales")).toBe("prefeitura-de-moreira-sales");
  });

  it("remove acentos", () => {
    expect(slugify("Município de São Paulo")).toBe("municipio-de-sao-paulo");
  });

  it("remove caracteres não alfanuméricos", () => {
    expect(slugify("Órgão nº 1 (SP)")).toBe("orgao-n-1-sp");
  });

  it("colapsa hífens repetidos e remove hífen nas pontas", () => {
    expect(slugify("  --Teste---Duplo--  ")).toBe("teste-duplo");
  });

  it("string vazia → string vazia", () => {
    expect(slugify("")).toBe("");
  });
});

import { describe, it, expect } from "vitest";
import { friendlyContractError, isRawValidationLeak } from "./contractErrorPolicy";

/**
 * F7b (homologação V1) — Nenhum corpo técnico/Zod deve vazar ao usuário na criação de contrato.
 * Erros de validação viram mensagem institucional pt-BR; erros já tratados passam intactos.
 */
const ZOD_RAW = '[\n  {\n    "code": "too_small",\n    "minimum": 1,\n    "path": ["processId"],\n    "message": "String must contain at least 1 character(s)"\n  }\n]';

describe("F7b — friendlyContractError (sem vazamento de Zod)", () => {
  it("detecta corpo Zod cru por conteúdo", () => {
    expect(isRawValidationLeak({ message: ZOD_RAW })).toBe(true);
  });

  it("detecta BAD_REQUEST pelo código", () => {
    expect(isRawValidationLeak({ message: "qualquer", data: { code: "BAD_REQUEST" } })).toBe(true);
  });

  it("mapeia erro de validação para mensagem institucional pt-BR (não o JSON cru)", () => {
    const msg = friendlyContractError({ message: ZOD_RAW, data: { code: "BAD_REQUEST" } });
    expect(msg).toBe("Não foi possível criar o contrato: verifique os campos obrigatórios (origem, número e dados do contrato).");
    expect(msg).not.toContain("too_small");
    expect(msg).not.toContain("processId");
  });

  it("preserva mensagens de negócio já tratadas (ex.: CONFLICT)", () => {
    const conflict = { message: "Já existe um contrato avulso com este número (id: abc123).", data: { code: "CONFLICT" } };
    expect(friendlyContractError(conflict)).toBe(conflict.message);
    expect(isRawValidationLeak(conflict)).toBe(false);
  });

  it("retorna null quando não há erro", () => {
    expect(friendlyContractError(null)).toBeNull();
    expect(friendlyContractError(undefined)).toBeNull();
  });
});

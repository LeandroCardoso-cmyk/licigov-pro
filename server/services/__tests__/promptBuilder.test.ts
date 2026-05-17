import { describe, it, expect } from "vitest";
import {
  fmtBrl,
  truncate,
  processBlock,
  documentsBlock,
  outputInstruction,
} from "../ai/promptBuilder";
import type { ProcessContext } from "../ai/promptBuilder";

const baseCtx: ProcessContext = {
  name: "Aquisição de Computadores",
  object: "Computadores tipo desktop para uso administrativo",
  estimatedValue: 5000000, // R$ 50.000,00
  modality: "pregao_eletronico",
  category: "tecnologia",
};

describe("fmtBrl", () => {
  it("formata centavos em reais corretamente", () => {
    expect(fmtBrl(5000000)).toContain("50.000");
    expect(fmtBrl(100)).toContain("1,00");
    expect(fmtBrl(0)).toContain("0,00");
  });
});

describe("truncate", () => {
  it("retorna texto curto sem modificar", () => {
    expect(truncate("texto curto", 100)).toBe("texto curto");
  });

  it("trunca texto longo e adiciona marcador", () => {
    const longo = "a".repeat(2000);
    const resultado = truncate(longo, 1500);
    expect(resultado.length).toBeLessThan(1600);
    expect(resultado).toContain("[truncado]");
  });

  it("retorna '(não disponível)' para null", () => {
    expect(truncate(null)).toBe("(não disponível)");
    expect(truncate(undefined)).toBe("(não disponível)");
  });
});

describe("processBlock", () => {
  it("inclui nome e objeto do processo", () => {
    const bloco = processBlock(baseCtx);
    expect(bloco).toContain("Aquisição de Computadores");
    expect(bloco).toContain("Computadores tipo desktop");
  });

  it("inclui modalidade e categoria", () => {
    const bloco = processBlock(baseCtx);
    expect(bloco).toContain("pregao_eletronico");
    expect(bloco).toContain("tecnologia");
  });

  it("usa '(não definida)' para campos ausentes", () => {
    const bloco = processBlock({ ...baseCtx, modality: null, category: null });
    expect(bloco).toContain("(não definida)");
  });
});

describe("documentsBlock", () => {
  it("retorna mensagem quando nenhum documento existe", () => {
    const bloco = documentsBlock(baseCtx);
    expect(bloco).toContain("nenhum documento elaborado ainda");
  });

  it("inclui DFD quando disponível", () => {
    const bloco = documentsBlock({ ...baseCtx, dfdContent: "Conteúdo do DFD" });
    expect(bloco).toContain("DFD");
    expect(bloco).toContain("Conteúdo do DFD");
  });

  it("inclui múltiplos documentos", () => {
    const bloco = documentsBlock({
      ...baseCtx,
      etpContent: "ETP texto",
      trContent: "TR texto",
    });
    expect(bloco).toContain("ETP");
    expect(bloco).toContain("TR");
  });
});

describe("outputInstruction", () => {
  it("inclui o formato fornecido", () => {
    const instrucao = outputInstruction("Use Markdown. Máx 300 palavras.");
    expect(instrucao).toContain("Use Markdown");
    expect(instrucao).toContain("FORMATO DE SAÍDA");
  });
});

/**
 * A3 — Documentos de Contratação Direta migrados para o Cognitive Kernel.
 *
 * Prova que as gerações de IA (Termo de Dispensa/Inexigibilidade, Minuta de Contrato):
 *   - roteiam pelo Kernel (`executeCognitiveTask`) — nunca invokeLLM;
 *   - solicitam GENERATE_DOCUMENT no domínio contratacao_direta, como texto, com tenant;
 *   - mantêm a validação de citações legais (fail-closed em artigo inexistente);
 *   - são multi-tenant (tenantId = organização do pedido).
 *
 * E que os documentos DETERMINÍSTICOS (planilha de cotação, mapa comparativo)
 * NÃO chamam o Kernel — permanecem puramente determinísticos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeCognitiveTask } = vi.hoisted(() => ({ executeCognitiveTask: vi.fn() }));
vi.mock("../aiExecutionEngine", () => ({ executeCognitiveTask }));

const { getDirectContractById, getLegalArticleById, getDocumentSettingsByUser } = vi.hoisted(() => ({
  getDirectContractById: vi.fn(),
  getLegalArticleById: vi.fn(),
  getDocumentSettingsByUser: vi.fn(),
}));
vi.mock("../../db", () => ({ getDirectContractById, getLegalArticleById, getDocumentSettingsByUser }));

import {
  generateTermoDispensa, generateTermoInexigibilidade, generateMinutaContrato,
  generatePlanilhaCotacao, generateMapaComparativo,
} from "../directContractDocuments";

const META = { userId: 5, organizationId: 9090, correlationId: "corr-doc" };

const CONTRACT_DISPENSA = {
  id: 1, number: "001", year: 2026, type: "dispensa", object: "Material de expediente",
  value: 100000, legalArticleId: 42, justification: "Baixo valor", supplierName: null, supplierCNPJ: null,
  executionDeadline: 30, supplierAddress: null,
};
const ARTICLE = { id: 42, article: "Art. 75", inciso: "I", summary: "Dispensa", description: "..." };
const SETTINGS = { organizationName: "Prefeitura", cnpj: "00.000.000/0001-00", address: "Rua X" };

function executionWith(content: string) {
  return { response: { content } };
}

beforeEach(() => {
  executeCognitiveTask.mockReset();
  getDirectContractById.mockReset();
  getLegalArticleById.mockReset();
  getDocumentSettingsByUser.mockReset();
  getLegalArticleById.mockResolvedValue(ARTICLE);
  getDocumentSettingsByUser.mockResolvedValue(SETTINGS);
  executeCognitiveTask.mockResolvedValue(executionWith(
    "# TERMO\n\nFundamentado no Art. 75 da Lei 14.133/2021."
  ));
});

describe("A3 — geração de documentos de contratação direta via Kernel", () => {
  it("generateTermoDispensa → GENERATE_DOCUMENT / contratacao_direta, texto, tenant", async () => {
    getDirectContractById.mockResolvedValue(CONTRACT_DISPENSA);
    const out = await generateTermoDispensa(Object.assign({ directContractId: 1 }, META));
    const arg = executeCognitiveTask.mock.calls[0][0];
    expect(arg.task).toBe("GENERATE_DOCUMENT");
    expect(arg.businessDomain).toBe("contratacao_direta");
    expect(arg.tenantId).toBe(9090);
    expect(arg.userId).toBe("5");
    expect(arg.correlationId).toBe("corr-doc");
    expect(arg.responseType).toBe("text");
    expect(out).toContain("Art. 75");
  });

  it("generateTermoInexigibilidade → GENERATE_DOCUMENT / contratacao_direta", async () => {
    getDirectContractById.mockResolvedValue({ ...CONTRACT_DISPENSA, type: "inexigibilidade" });
    await generateTermoInexigibilidade(Object.assign({ directContractId: 1 }, META));
    expect(executeCognitiveTask.mock.calls[0][0].task).toBe("GENERATE_DOCUMENT");
    expect(executeCognitiveTask.mock.calls[0][0].businessDomain).toBe("contratacao_direta");
  });

  it("generateMinutaContrato → GENERATE_DOCUMENT / contratacao_direta", async () => {
    getDirectContractById.mockResolvedValue(CONTRACT_DISPENSA);
    await generateMinutaContrato(Object.assign({ directContractId: 1 }, META));
    expect(executeCognitiveTask.mock.calls[0][0].task).toBe("GENERATE_DOCUMENT");
  });

  it("fail-closed: documento com artigo inexistente é rejeitado", async () => {
    getDirectContractById.mockResolvedValue(CONTRACT_DISPENSA);
    executeCognitiveTask.mockResolvedValue(executionWith("Fundamentado no Art. 999 da Lei 14.133/2021."));
    await expect(generateTermoDispensa(Object.assign({ directContractId: 1 }, META))).rejects.toThrow();
  });

  it("multi-tenant: tenantId do pedido flui ao Kernel", async () => {
    getDirectContractById.mockResolvedValue(CONTRACT_DISPENSA);
    await generateTermoDispensa({ directContractId: 1, userId: 1, organizationId: 321, correlationId: "c" });
    expect(executeCognitiveTask.mock.calls[0][0].tenantId).toBe(321);
  });
});

describe("A3 — documentos determinísticos NÃO chamam o Kernel", () => {
  const QUOTATIONS = [
    { supplierName: "Fornecedor A", supplierCNPJ: "11", value: 90000, deliveryDeadline: 10 },
    { supplierName: "Fornecedor B", supplierCNPJ: "22", value: 120000, deliveryDeadline: 15 },
  ];

  it("generatePlanilhaCotacao é determinístico (sem provider)", async () => {
    getDirectContractById.mockResolvedValue(CONTRACT_DISPENSA);
    const md = await generatePlanilhaCotacao({ directContractId: 1, quotations: QUOTATIONS });
    expect(md).toContain("PLANILHA DE COTAÇÃO");
    expect(executeCognitiveTask).not.toHaveBeenCalled();
  });

  it("generateMapaComparativo é determinístico (sem provider)", async () => {
    getDirectContractById.mockResolvedValue(CONTRACT_DISPENSA);
    const md = await generateMapaComparativo({ directContractId: 1, quotations: QUOTATIONS });
    expect(md).toContain("MAPA COMPARATIVO");
    expect(executeCognitiveTask).not.toHaveBeenCalled();
  });
});

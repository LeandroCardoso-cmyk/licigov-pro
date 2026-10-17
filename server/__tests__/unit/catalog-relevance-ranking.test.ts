/**
 * Relevância discriminativa do ranking de candidatos CATMAT/CATSER (`rankRelevant`) — PURO, sem banco e sem rede.
 *
 * CORPUS SINTÉTICO (códigos 9001xx–9005xx): NÃO são códigos oficiais. Só modelam a redação típica de catálogo
 * (com e sem "Serviços de …"/"Prestação de serviços de …") para provar o comportamento do motor. A validação com
 * descrições oficiais reais é a sonda `pnpm catalog:ranking-probe` (somente leitura, API pública).
 *
 * Defeito reproduzido (homologação M8): termos de ENQUADRAMENTO da contratação ("prestação", "serviços") e
 * qualificadores ("administrativos") bastavam para um candidato incompatível empatar com os relevantes.
 */
import { describe, it, expect } from "vitest";
import { rankRelevant } from "../../services/catalogRelevance";
import type { OfficialCatalogEntry } from "../../domain/officialCatalog";

const svc = (code: string, description: string): OfficialCatalogEntry => ({ catalogType: "catser", code, description, active: true, group: null });

const LIMPEZA = ["900101", "900102", "900103", "900104"];
const CORPUS: OfficialCatalogEntry[] = [
  svc("900101", "Limpeza e conservação predial"),
  svc("900102", "Serviços de limpeza e conservação de áreas internas"),
  svc("900103", "Limpeza hospitalar"),
  svc("900104", "Limpeza de vidros e fachadas"),
  svc("900201", "Prestação de serviços de transporte de passageiros"),
  svc("900202", "Transporte rodoviário de cargas"),
  svc("900203", "Locação de veículos com motorista"),
  svc("900301", "Prestação de serviços de vigilância armada"),
  svc("900302", "Vigilância patrimonial desarmada"),
  svc("900303", "Gestão patrimonial de bens móveis"),
  svc("900401", "Serviços administrativos de apoio"),
  svc("900402", "Apoio administrativo e recepção"),
  svc("900501", "Manutenção de ar condicionado"),
  svc("900502", "Serviços de engenharia consultiva"),
];
const codes = (term: string, corpus = CORPUS) => rankRelevant(term, corpus, 5).map((r) => r.entry.code);

describe("ranking CATSER — relevância discriminativa (corpus sintético)", () => {
  it("A) limpeza administrativa: limpeza+conservação primeiro; transporte, vigilância e apoio administrativo NÃO aparecem", () => {
    const res = rankRelevant("Prestação de serviços de limpeza e conservação de ambientes administrativos.", CORPUS, 5);
    expect(res.slice(0, 2).map((r) => r.entry.code).sort()).toEqual(["900101", "900102"]);
    expect(res.every((r) => LIMPEZA.includes(r.entry.code))).toBe(true);
    for (const r of res) {
      // Explicação: só termos do OBJETO justificam o candidato; enquadramento da contratação nunca conta.
      expect(r.matchedTokens.some((t) => t === "limpeza" || t === "conservacao")).toBe(true);
      expect(r.matchedTokens).not.toContain("servicos");
      expect(r.matchedTokens).not.toContain("prestacao");
    }
    // Ordem coerente com o score exibido (o primeiro é o de maior similaridade).
    expect(res.map((r) => r.score)).toEqual([...res.map((r) => r.score)].sort((a, b) => b - a));
  });

  it("B) transporte de passageiros: não enviesado para limpeza; candidatos de transporte, sem vigilância/limpeza", () => {
    for (const term of ["Prestação de serviços de transporte de passageiros", "transporte de passageiros"]) {
      const c = codes(term);
      expect(c[0], term).toBe("900201");
      expect(c.every((x) => x.startsWith("9002")), term).toBe(true);
    }
  });

  it("C) vigilância patrimonial: vigilância primeiro; correspondência só no qualificador ('patrimonial') não entra", () => {
    const c = codes("Serviços de vigilância patrimonial");
    expect(c[0]).toBe("900302");
    expect(c).toContain("900301");
    expect(c).not.toContain("900303");
    expect(c.every((x) => x.startsWith("9003"))).toBe(true);
  });

  it("D) consulta curta 'limpeza': um único termo discriminativo continua encontrando todos os serviços de limpeza", () => {
    expect(codes("limpeza").sort()).toEqual(LIMPEZA);
    expect(codes("Serviço de limpeza").sort()).toEqual(LIMPEZA);
    // Enquadramento INICIAL ("Execução de …", "Fornecimento de …", "Aquisição de …") não rouba o peso do objeto.
    expect(codes("Execução de serviços de limpeza").sort()).toEqual(LIMPEZA);
  });

  it("E) sem correspondência: nenhuma lista artificial (termos genéricos sozinhos não sugerem nada)", () => {
    expect(rankRelevant("Serviços de tradução juramentada", CORPUS, 5)).toEqual([]);
    expect(rankRelevant("Prestação de serviços especializados", CORPUS, 5)).toEqual([]);
    expect(rankRelevant("Contratação de empresa especializada", CORPUS, 5)).toEqual([]);
  });

  it("menos candidatos em vez de incompatíveis: não completa as 5 posições", () => {
    expect(codes("Serviços de vigilância patrimonial").length).toBeLessThan(5);
  });

  it("determinístico: mesma consulta ⇒ mesmo resultado, independente da ordem do corpus", () => {
    const term = "Prestação de serviços de limpeza e conservação de ambientes administrativos.";
    const reversed = [...CORPUS].reverse();
    expect(rankRelevant(term, reversed, 5)).toEqual(rankRelevant(term, CORPUS, 5));
  });

  it("score e origem preservados; score limitado a (0, 1]", () => {
    for (const r of rankRelevant("limpeza e conservação", CORPUS, 5)) {
      expect(r.score).toBeGreaterThan(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(["exact", "alias", "normalized", "token", "semantic", "fuzzy"]).toContain(r.matchSource);
    }
  });

  it("F) regressão CATMAT: a descrição oficial completa (busca textual da API e 'Verificar código') continua relevante", () => {
    const mat: OfficialCatalogEntry = { catalogType: "catmat", code: "206504", description: "CADEIRA ESCRITÓRIO, MATERIAL ESTRUTURA: TUBO AÇO , MATERIAL REVESTIMENTO ASSENTO E ENCOSTO", active: true, group: null };
    const [exact] = rankRelevant(mat.description, [mat], 1);
    expect(exact).toMatchObject({ entry: { code: "206504" } });
    expect(exact.score).toBeGreaterThan(0.8);
    // Item do servidor com redação própria: o código verificado ainda recebe similaridade (não zera por enquadramento).
    const [own] = rankRelevant("Aquisição de cadeira de escritório", [mat], 1);
    expect(own?.matchedTokens).toEqual(expect.arrayContaining(["cadeira", "escritorio"]));
  });
});

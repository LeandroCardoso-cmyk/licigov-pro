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
import { rankRelevant, explainRelevance } from "../../services/catalogRelevance";
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
  svc("900601", "Tradução e versão de textos"),
  svc("900602", "Produção jornalística"),
  svc("900603", "Tração ortopédica transesquelética"),
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

  it("aproximação não sustenta candidato com palavra diferente (real: 'tradução' × PRODUCAO/TRACAO); radical igual e erro de digitação sim", () => {
    // Reproduz o resíduo observado na sonda com o CATSER oficial: só a tradução é candidata.
    expect(codes("Serviços de tradução juramentada")).toEqual(["900601"]);
    // Plural × singular (mesmo radical — real: "passageiros" × "PASSAGEIRO") vale inteiro; erro de digitação ainda
    // encontra, com similaridade menor.
    const one = [svc("900204", "Transporte de passageiro em aeroportos")];
    expect(rankRelevant("transporte de passageiros", one, 1)[0]?.matchedTokens).toEqual(["transporte", "passageiros"]);
    expect(rankRelevant("passageiros", one, 1)[0]?.score).toBeGreaterThan(0.8); // cobertura integral (não aproximada)
    const typo = rankRelevant("limpesa", CORPUS, 5);
    expect(typo.map((r) => r.entry.code).sort()).toEqual(LIMPEZA);
    expect(typo[0].score).toBeLessThan(rankRelevant("limpeza", CORPUS, 1)[0].score);
  });

  it("E) sem correspondência: nenhuma lista artificial (termos genéricos sozinhos não sugerem nada)", () => {
    expect(rankRelevant("Serviços de saneamento hospitalar", CORPUS.filter((e) => !LIMPEZA.includes(e.code)), 5)).toEqual([]);
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

/**
 * Atividade principal × menção (homologação visual M8, staging 19/10/2026: "Serviços de tradução juramentada" trazia a
 * LOCAÇÃO de equipamento de tradução como alternativa). Corpus = descrições OFICIAIS públicas observadas na sonda
 * somente leitura do CATSER (códigos reais, 17/10/2026) + entradas SINTÉTICAS 9007xx (não oficiais, identificadas).
 */
const OFFICIAL_OBSERVED: OfficialCatalogEntry[] = [
  svc("12637", "TRADUCAO / INTERPRETACAO SIMULTANEA / CONSECUTIVA"),
  svc("3891", "TRADUCAO, ADAPTACAO E VERSAO DE TEXTOS"),
  svc("21490", "LOCACAO EQUIPAMENTO - TRADUCAO SIMULTANEA / SONORIZACAO"),
  svc("10200", "PRODUCAO JORNALISTICA"),
  svc("12009", "ORTOPEDIA E TRAUMATOLOGIA - TRACAO - TRANSESQUELETICA, CUTA-NEA, FEMORAL E INSTALACAO DE H"),
  svc("24023", "PRESTACAO DE SERVICO DE LIMPEZA E CONSERVACAO - OUTRAS NECESSIDADES"),
  svc("24104", "PRESTACAO DE SERVICO DE LIMPEZA E CONSERVACAO - AREAS EXTERNAS - OUTRAS NECESSIDADES."),
  svc("24090", "PRESTACAO DE SERVICO DE LIMPEZA E CONSERVACAO - AREAS INTERNAS - OUTRAS NECESSIDADES - OUT"),
  svc("13439", "PRESTACAO DE SERVICOS DE ASCENSORISTA"),
  svc("13447", "PRESTACAO DE SERVICOS DE TELEFONISTA"),
  svc("14672", "LIMPEZA URBANA"),
  svc("14044", "ROÇADA / LIMPEZA DE AREA - MECANIZADA / MANUAL"),
  svc("8656", "TRANSPORTE SUPERFICIE EM AEROPORTOS - PASSAGEIRO / CARGA /AERONAVE / EQUIPAMENTO"),
  svc("24694", "TRANSPORTE DUTOVIARIO"),
  svc("15407", "DOCUMENTO - GUARDA / TRANSPORTE"),
  svc("30136", "PRESTACAO DE SERVICO DE VIGILANCIA PATRIMONIAL"),
  svc("24015", "SERVICO DE VIGILANCIA ARMADA"),
];
const SYNTHETIC_ACTIVITY: OfficialCatalogEntry[] = [
  svc("900701", "INTERPRETACAO SIMULTANEA EM EVENTOS"),
  svc("900702", "LOCACAO DE VEICULOS"),
  svc("900703", "MANUTENCAO DE EQUIPAMENTOS DE TRANSPORTE"),
  svc("900704", "LOCACAO DE EQUIPAMENTOS DE LIMPEZA"),
];
const MIXED = [...OFFICIAL_OBSERVED, ...SYNTHETIC_ACTIVITY];
const rank = (term: string, corpus = MIXED) => rankRelevant(term, corpus, 5);
const ids = (term: string, corpus = MIXED) => rank(term, corpus).map((r) => r.entry.code);

describe("ranking CATSER — atividade principal e termos não comprovados", () => {
  it("A) tradução juramentada: locação de equipamento NÃO é alternativa; 'juramentada' é declarada não comprovada", () => {
    const res = rank("Serviços de tradução juramentada");
    expect(res.map((r) => r.entry.code)).not.toContain("21490");
    expect(res.map((r) => r.entry.code).every((c) => ["12637", "3891"].includes(c))).toBe(true);
    for (const r of res) {
      expect(r.activityMatch).toBe(true);
      expect(r.missingTokens).toEqual(["juramentada"]); // relacionada, nunca equivalência comprovada
    }
  });

  it("B) tradução e interpretação simultânea: interpretação continua localizável; locação de equipamento não", () => {
    const c = ids("Serviços de tradução e interpretação simultânea");
    expect(c).toEqual(expect.arrayContaining(["12637", "900701"]));
    expect(c).not.toContain("21490");
  });

  it("C) locação de equipamentos para tradução: 21490 continua elegível (sem viés contra locação); prestação de tradução não", () => {
    const res = rank("Locação de equipamentos para tradução simultânea e sonorização");
    expect(res[0]).toMatchObject({ entry: { code: "21490" }, activityMatch: true, missingTokens: [] });
    expect(res.map((r) => r.entry.code)).not.toContain("12637");
    expect(res.map((r) => r.entry.code)).not.toContain("900702"); // locação de outra coisa
  });

  it("D) tradução de textos: 3891 primeiro, sem exigir 'juramentada' e sem termo ausente", () => {
    const res = rank("Serviços de tradução, adaptação e versão de textos");
    expect(res[0]).toMatchObject({ entry: { code: "3891" }, missingTokens: [] });
    expect(res.map((r) => r.entry.code)).not.toContain("21490");
  });

  it("E) limpeza administrativa (regressão do #309): só limpeza e conservação; nem ascensorista/telefonista nem locação de equipamento de limpeza", () => {
    const c = ids("Prestação de serviços de limpeza e conservação de ambientes administrativos");
    expect(c.slice(0, 3).sort()).toEqual(["24023", "24090", "24104"]);
    for (const bad of ["13439", "13447", "900704"]) expect(c).not.toContain(bad);
  });

  it("F) transporte e vigilância: atividade principal preservada; guarda de documento e manutenção de equipamento não", () => {
    const t = ids("Prestação de serviços de transporte de passageiros");
    expect(t[0]).toBe("8656");
    expect(t).not.toContain("15407");
    expect(t).not.toContain("900703");
    const v = ids("Serviços de vigilância patrimonial");
    expect(v[0]).toBe("30136");
    expect(v).toContain("24015");
  });

  it("G) consultas curtas continuam válidas", () => {
    expect(ids("tradução").sort()).toEqual(["12637", "3891"]);
    expect(ids("limpeza")).toEqual(expect.arrayContaining(["14672", "24023"]));
    expect(ids("transporte")).toEqual(expect.arrayContaining(["8656", "24694"]));
    expect(ids("transporte")).not.toContain("15407");
  });

  it("H) sem candidato da mesma atividade: menção vem SINALIZADA (atividade diferente + termos ausentes); sem relação ⇒ vazio", () => {
    const res = rank("Sonorização de eventos");
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ entry: { code: "21490" }, activityMatch: false, missingTokens: ["eventos"] });
    expect(rank("Serviços de cartografia digital")).toEqual([]);
  });

  it("I) determinístico e independente da ordem do corpus", () => {
    for (const term of ["Serviços de tradução juramentada", "Locação de equipamentos para tradução simultânea e sonorização", "limpeza"]) {
      expect(rank(term, [...MIXED].reverse())).toEqual(rank(term));
    }
  });
});

/** Achados da revisão independente do PR (casos reproduzidos pelo revisor; códigos 9990xx e CATMAT 99xxxx são SINTÉTICOS). */
describe("ranking — achados da revisão independente", () => {
  const mat = (code: string, description: string): OfficialCatalogEntry => ({ catalogType: "catmat", code, description, active: true, group: null });

  it("1) CATMAT sem regressão: consulta que começa pela categoria continua encontrando o item (sem filtro de atividade)", () => {
    const cases: Array<[string, OfficialCatalogEntry]> = [
      ["Material de limpeza - detergente neutro", mat("990001", "DETERGENTE, COMPOSIÇÃO: TENSOATIVOS ANIÔNICOS, ASPECTO FÍSICO: LÍQUIDO, APLICAÇÃO: LIMPEZA GERAL")],
      ["Gênero alimentício: arroz tipo 1", mat("990002", "ARROZ, TIPO: 1, CLASSE: LONGO FINO, SUBGRUPO: POLIDO")],
      ["Peças para manutenção de veículos - pastilha de freio", mat("990003", "PASTILHA FREIO, APLICAÇÃO: VEÍCULO LEVE")],
    ];
    for (const [term, e] of cases) {
      const [r] = rankRelevant(term, [e], 5);
      expect(r?.entry.code, term).toBe(e.code);
      expect(r.activityMatch, term).toBeNull(); // não avaliada no CATMAT
    }
  });

  it("2) núcleo = termo principal + coordenados: complemento ('de documentos', 'de equipamentos') não alinha atividade", () => {
    const docs = rank("Serviços de tradução de documentos");
    expect(docs.map((r) => r.entry.code)).not.toContain("15407"); // DOCUMENTO - GUARDA / TRANSPORTE
    expect(docs.every((r) => ["12637", "3891"].includes(r.entry.code))).toBe(true);
    const eq = rank("Transporte de equipamentos");
    expect(eq.map((r) => r.entry.code)).not.toContain("900703"); // MANUTENCAO DE EQUIPAMENTOS DE TRANSPORTE
    const alone = rankRelevant("Transporte de equipamentos", [svc("900703", "MANUTENCAO DE EQUIPAMENTOS DE TRANSPORTE")], 5);
    expect(alone[0]).toMatchObject({ activityMatch: false }); // sem candidato da mesma atividade: só sinalizado
  });

  it("3) alinhamento não usa aproximação larga: PRODUCAO ≠ TRADUCAO (sai quando há traduções; sozinho, vem sinalizado)", () => {
    const video = svc("999001", "PRODUCAO DE VIDEO - TRADUCAO / LEGENDAGEM");
    expect(rank("Serviços de tradução juramentada", [...MIXED, video]).map((r) => r.entry.code)).not.toContain("999001");
    expect(rankRelevant("Serviços de tradução juramentada", [video], 5)[0]).toMatchObject({ activityMatch: false });
    // Erro de digitação (distância 1, termo longo) continua alinhando.
    expect(rank("limpesa").every((r) => r.activityMatch === true)).toBe(true);
  });

  it("4) termo casado só por aproximação NÃO consta: 'tradução jornalística' × PRODUCAO JORNALISTICA não é equivalência", () => {
    const [r] = rankRelevant("Serviços de tradução jornalística", [svc("10200", "PRODUCAO JORNALISTICA")], 5);
    expect(r?.matchedTokens ?? []).not.toContain("traducao");
    if (r) {
      expect(r.missingTokens).toContain("traducao");
      expect(r.activityMatch).toBe(false);
    }
  });

  it("5) explicação do 'Verificar código' sem filtros: não afirma ausência do que consta nem atividade diferente indevida", () => {
    const guard = explainRelevance("Serviços de tradução de documentos", svc("15407", "GUARDA / TRANSPORTE - DOCUMENTOS"));
    expect(guard).toEqual({ matchedTokens: ["documentos"], missingTokens: ["traducao"], activityMatch: false });
    const long = "Contratação de empresa especializada para prestação de serviços de tradução juramentada de documentos oficiais, conforme termo de referência";
    const ok = explainRelevance(long, svc("12637", "TRADUCAO / INTERPRETACAO SIMULTANEA / CONSECUTIVA"));
    expect(ok.activityMatch).toBe(true);
    expect(ok.matchedTokens).toContain("traducao");
    expect(ok.missingTokens).toContain("juramentada");
    expect(explainRelevance("Aquisição de cadeira de escritório", mat("206504", "CADEIRA ESCRITÓRIO, MATERIAL ESTRUTURA: TUBO AÇO")).activityMatch).toBeNull();
  });
});

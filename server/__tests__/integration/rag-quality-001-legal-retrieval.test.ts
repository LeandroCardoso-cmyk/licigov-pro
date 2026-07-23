/**
 * RAG-QUALITY-001 — Correção focalizada da recuperação jurídica no "Tirar Dúvidas".
 *
 * Causa raiz medida (ver docs/ai/RAG_QUALITY_001_REPORT.md): para "qual artigo da lei 14133 fala da
 * contratação direta?", o retrieval antigo (Set-membership + IDF puro, sem normalização de
 * comprimento) elegia o Art. 6º (glossário de ~60 incisos, 945 tokens) e o Art. 14º como top-3,
 * IGNORANDO os arts. 72-75 (Capítulo VIII — "Da Contratação Direta", a resposta correta) — que
 * ficavam nas posições #8/#19/#22/#48 de 209. A causa: (a) o título descritivo do capítulo/seção
 * ("DA CONTRATAÇÃO DIRETA") era parseado mas DESCARTADO antes de chegar ao retrieval; (b) blocos
 * grandes venciam por amplitude de vocabulário, não relevância temática; (c) termos interrogativos
 * ("qual", "fala") e o número da norma ("14133", que nunca ocorre no corpo dos artigos) poluíam o
 * score. Este arquivo prova, com o CORPUS REAL (Lei 14.133/2021 completa), que a correção resolve o
 * caso relatado sem hardcodar a pergunta — e cobre os demais mecanismos (BM25-lite, boost de título,
 * vizinhança estrutural, 2ª rodada determinística, selo de suficiência em 3 estados).
 */

import { describe, it, expect, beforeAll } from "vitest";
import { buildOfficialKnowledgeCorpus, type OfficialCorpusBuildResult } from "../../services/officialCorpus/officialCorpusBuilder";
import { resolveInstitutionalContext } from "../../domain/institutionalIntegration/institutionalContextResolver";
import { retrieveKnowledge, expandQueryTerms } from "../../services/institutionalIntegration/knowledgeRetrievalService";
import { parseOfficialText } from "../../services/officialCorpus/officialTextParser";
import { classifyEvidenceSufficiency, buildConsultationAnswer } from "../../domain/institutionalConsultation";
import { createContextPackage, type ContextPackage } from "../../domain/institutionalIntegration/contextPackage";
import { answerConsultation, getOfficialCorpus } from "../../services/institutionalConsultationService";
import { InMemoryConsultationRepository, setConsultationRepository } from "../../services/institutionalConsultationRepository";
import { MOREIRA_SALES_TENANT_ID } from "../../services/officialCorpus/officialCorpusBuilder";

const BUG_QUERY = "qual artigo da lei 14133 fala da contratação direta?";
const CONTRATACAO_DIRETA_ARTICLES = ["Art. 72º", "Art. 73º", "Art. 74º", "Art. 75º"];

let corpus: OfficialCorpusBuildResult;
beforeAll(() => { corpus = buildOfficialKnowledgeCorpus({ correlationId: "rag-quality-001-test" }); });

function retrieveForLei14133(query: string, maxPassagesPerDocument = 3) {
  const ctx = resolveInstitutionalContext(corpus.registry, { tenantId: 1, businessDomain: null, taskType: "LEGAL_ANALYSIS" });
  const result = retrieveKnowledge(corpus, ctx, { query, maxPassagesPerDocument, maxPassageChars: 700 });
  const leiDocId = corpus.ingested.find(d => d.official.normId === "lei-14133-2021")!.official.documentId;
  return { result, leiPassages: result.passages.filter(p => p.documentId === leiDocId) };
}

describe("RAG-QUALITY-001 — Parser: título/seção descritivos preservados (officialTextParser)", () => {
  it("captura o rótulo temático de Capítulo/Seção (ex.: 'DA CONTRATAÇÃO DIRETA'), sem alterar o path", () => {
    const text = [
      "LEI Nº 99.999, DE 1º DE JANEIRO DE 2099",
      "TÍTULO I",
      "DISPOSIÇÕES GERAIS",
      "CAPÍTULO VIII",
      "DA CONTRATAÇÃO DIRETA",
      "Seção I",
      "Do Processo de Contratação Direta",
      "Art. 1º Texto do artigo de teste sobre contratação direta e seus requisitos.",
    ].join("\n");
    const parsed = parseOfficialText(text);
    expect(parsed.articles.length).toBe(1);
    const a = parsed.articles[0];
    expect(a.path).toEqual(["Título I", "Capítulo VIII", "Seção I"]);
    expect(a.headingText.some(h => /contrata[çc][ãa]o direta/i.test(h))).toBe(true);
  });

  it("artigo sem container estrutural (Preâmbulo) não recebe headingText fictício", () => {
    const text = ["LEI Nº 1, DE 2099", "Art. 1º Caput solto, sem título/capítulo/seção antes."].join("\n");
    const parsed = parseOfficialText(text);
    expect(parsed.articles[0].path).toEqual([]);
    expect(parsed.articles[0].headingText).toEqual([]);
  });
});

describe("RAG-QUALITY-001 — expandQueryTerms: ruído interrogativo não polui o score", () => {
  it("descarta pronomes interrogativos e verbos de pergunta (generaliza para qualquer pergunta)", () => {
    const terms = expandQueryTerms(BUG_QUERY);
    expect(terms).not.toContain("qual");
    expect(terms).not.toContain("fala");
    expect(terms).toEqual(expect.arrayContaining(["artigo", "lei", "contratacao", "direta"]));
  });
  it("mantém termos de conteúdo em perguntas com outros verbos interrogativos", () => {
    const terms = expandQueryTerms("quando devo aplicar a dispensa de licitação?");
    expect(terms).not.toContain("quando");
    expect(terms).not.toContain("devo");
    expect(terms).toEqual(expect.arrayContaining(["aplicar", "dispensa", "licitacao"]));
  });
});

describe("RAG-QUALITY-001 — Caso relatado: recuperação correta dos arts. 72-75 (Lei 14.133/2021)", () => {
  it("os arts. 72-75 (Capítulo VIII — Da Contratação Direta) superam o Art. 6º no ranking", () => {
    const { leiPassages } = retrieveForLei14133(BUG_QUERY, 3);
    expect(leiPassages.length).toBeGreaterThan(0);
    // Regressão-chave do bug relatado: ANTES, Art. 6º (glossário genérico) e Art. 14º dominavam o
    // top-3, excluindo os arts. 72-75. Agora, ao menos um dos arts. 72-75 deve aparecer no top-3.
    expect(leiPassages.some(p => CONTRATACAO_DIRETA_ARTICLES.includes(p.identifier))).toBe(true);
    const art6 = leiPassages.find(p => p.identifier === "Art. 6º");
    const bestContratacaoDireta = Math.max(0, ...leiPassages.filter(p => CONTRATACAO_DIRETA_ARTICLES.includes(p.identifier)).map(p => p.score));
    if (art6) expect(bestContratacaoDireta).toBeGreaterThan(art6.score);
  });

  it("com folga de passagens por documento (vizinhança estrutural), o cluster completo do Capítulo VIII emerge", () => {
    const { leiPassages } = retrieveForLei14133(BUG_QUERY, 10);
    const found = CONTRATACAO_DIRETA_ARTICLES.filter(id => leiPassages.some(p => p.identifier === id));
    // Boost de título + vizinhança estrutural: com folga, o cluster inteiro (não só o artigo top)
    // deve aparecer — prova que a vizinhança realmente eleva os siblings, não só o artigo isolado.
    expect(found.length).toBeGreaterThanOrEqual(3);
  });

  it("coverageRatio/maxPassageScore são calculados e searchRounds=1 quando a cobertura já é boa", () => {
    const { result } = retrieveForLei14133(BUG_QUERY, 3);
    expect(result.coverageRatio).toBeGreaterThan(0.5);
    expect(result.maxPassageScore).toBeGreaterThan(0);
    expect(result.searchRounds).toBe(1);
  });
});

describe("RAG-QUALITY-001 — Segunda rodada de busca determinística (escalonamento)", () => {
  it("quando a 1ª rodada não retorna nenhuma passagem (minScore artificialmente alto), tenta uma 2ª rodada mais permissiva", () => {
    const ctx = resolveInstitutionalContext(corpus.registry, { tenantId: 1, businessDomain: null, taskType: "LEGAL_ANALYSIS" });
    const result = retrieveKnowledge(corpus, ctx, { query: BUG_QUERY, maxPassagesPerDocument: 3, minScore: 50 });
    expect(result.searchRounds).toBe(2);
  });
  it("não escalona (permanece na 1ª rodada) quando a cobertura já é alta com os parâmetros padrão", () => {
    const ctx = resolveInstitutionalContext(corpus.registry, { tenantId: 1, businessDomain: null, taskType: "LEGAL_ANALYSIS" });
    const result = retrieveKnowledge(corpus, ctx, { query: BUG_QUERY, maxPassagesPerDocument: 3 });
    expect(result.searchRounds).toBe(1);
  });
});

describe("RAG-QUALITY-001 — Selo de suficiência de evidência (3 estados)", () => {
  const baseParams = {
    correlationId: "c", tenantId: 1, taskType: "LEGAL_ANALYSIS", hierarchy: ["federal"],
    documents: [{ documentId: "d1", normId: "n1", title: "T", authority: "A", jurisdiction: "federal", version: "1.0.0", bindingLevel: "mandatory", status: "vigente" }],
    citations: [], explainability: [],
  };
  function pkgWith(passages: { score: number }[], metadata: Record<string, unknown>): ContextPackage {
    return createContextPackage({
      ...baseParams,
      documents: passages.length > 0 ? baseParams.documents : [],
      retrievedPassages: passages.map((p, i) => ({ documentId: "d1", normId: "n1", blockId: `b${i}`, identifier: `Art. ${i}º`, text: "x", score: p.score })),
      metadata,
    });
  }

  it("'insuficiente': nenhuma passagem recuperada", () => {
    const pkg = pkgWith([], {});
    expect(classifyEvidenceSufficiency(pkg)).toBe("insuficiente");
  });
  it("'fundamentada': cobertura e score altos", () => {
    const pkg = pkgWith([{ score: 0.8 }], { coverageRatio: 0.9, maxPassageScore: 0.8 });
    expect(classifyEvidenceSufficiency(pkg)).toBe("fundamentada");
  });
  it("'parcial': há passagem, mas cobertura/score abaixo do limiar de confiança", () => {
    const pkg = pkgWith([{ score: 0.15 }], { coverageRatio: 0.2, maxPassageScore: 0.15 });
    expect(classifyEvidenceSufficiency(pkg)).toBe("parcial");
  });
  it("hasSufficientBasis é true para 'fundamentada' e 'parcial', false só para 'insuficiente'", () => {
    const fundamentada = buildConsultationAnswer({
      tenantId: 1, userId: 1, question: "q", engineContent: "resposta", contextPackage: pkgWith([{ score: 0.8 }], { coverageRatio: 0.9, maxPassageScore: 0.8 }),
      executionId: "e1", createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(fundamentada.evidenceSufficiency).toBe("fundamentada");
    expect(fundamentada.hasSufficientBasis).toBe(true);

    const parcial = buildConsultationAnswer({
      tenantId: 1, userId: 1, question: "q", engineContent: "resposta", contextPackage: pkgWith([{ score: 0.15 }], { coverageRatio: 0.2, maxPassageScore: 0.15 }),
      executionId: "e2", createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(parcial.evidenceSufficiency).toBe("parcial");
    expect(parcial.hasSufficientBasis).toBe(true);
    expect(parcial.limitations.some(l => /cobertura documental parcial/i.test(l))).toBe(true);

    const insuficiente = buildConsultationAnswer({
      tenantId: 1, userId: 1, question: "q", engineContent: "", contextPackage: pkgWith([], {}),
      executionId: "e3", createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(insuficiente.evidenceSufficiency).toBe("insuficiente");
    expect(insuficiente.hasSufficientBasis).toBe(false);
    expect(insuficiente.status).toBe("limited");
  });
});

describe("RAG-QUALITY-001 — Fluxo completo (answerConsultation) para a pergunta relatada", () => {
  beforeAll(() => { getOfficialCorpus(); setConsultationRepository(new InMemoryConsultationRepository()); });

  it("a pergunta que motivou o bug agora recupera ao menos um dos arts. 72-75 e não é mais 'Fundamentada' às cegas", async () => {
    const a = await answerConsultation({
      organizationId: MOREIRA_SALES_TENANT_ID, userId: 1, question: BUG_QUERY, correlationId: "rag-quality-001-e2e",
    });
    expect(a).toHaveProperty("evidenceSufficiency");
    expect(["fundamentada", "parcial", "insuficiente"]).toContain(a.evidenceSufficiency);
    const leiPassages = a.passages.filter(p => CONTRATACAO_DIRETA_ARTICLES.includes(p.identifier));
    expect(leiPassages.length).toBeGreaterThan(0);
  });
});

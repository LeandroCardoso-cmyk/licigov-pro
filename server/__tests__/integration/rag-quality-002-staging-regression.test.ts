/**
 * RAG-QUALITY-002 — Revisão focalizada pós-validação em staging.
 *
 * O RAG-QUALITY-001 corrigiu o caso original (arts. 72-75 passaram a superar o Art. 6º/14º/92º).
 * Em staging, 3 das 4 perguntas testadas vieram corretas (inexigibilidade→74, dispensa→75,
 * instrução do processo→72), mas a pergunta mais geral — "qual artigo da Lei 14.133 trata da
 * contratação direta?" — retornou o Art. 191 (Disposições Transitórias e Finais) e a resposta veio
 * cortada.
 *
 * Causa raiz medida (não presumida):
 * 1. `data/lei_14133_2021.txt` traz o Art. 191 TRÊS VEZES em sequência (histórico de redações por
 *    Medida Provisória nº 1.167/2023, mantido inline no texto-fonte) — sem dedup, o retrieval tratava
 *    cada ocorrência como um bloco independente e 2 das 3 vagas do top-3 iam para o MESMO artigo
 *    duplicado, expulsando os arts. 72-75.
 * 2. Mesmo sem a duplicação, nada penalizava um artigo em "Disposições Transitórias e Finais" que só
 *    cita os termos da pergunta de passagem, quando um capítulo temático específico ("Da Contratação
 *    Direta") já respondia à pergunta.
 * 3. A troca "fala"→"trata" na nova pergunta mudou o teste: "trata" (verbo comum de remissão jurídica,
 *    "de que trata o...") não era ruído filtrado — inflava artigos que citam a expressão de passagem.
 * 4. O selo de suficiência não distinguia "a evidência sustenta a frase" de "a evidência responde à
 *    intenção jurídica" — por isso classificava "Fundamentada" mesmo com o Art. 191 no topo.
 * 5. `finishReason` do provider (Gemini) era descartado pelo AIExecutionEngine — uma geração cortada
 *    por limite de tokens (MAX_TOKENS) não deixava rastro algum, nem era tratada na resposta.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { buildOfficialKnowledgeCorpus, type OfficialCorpusBuildResult } from "../../services/officialCorpus/officialCorpusBuilder";
import { resolveInstitutionalContext } from "../../domain/institutionalIntegration/institutionalContextResolver";
import { retrieveKnowledge } from "../../services/institutionalIntegration/knowledgeRetrievalService";
import { parseOfficialText } from "../../services/officialCorpus/officialTextParser";
import { allBlocks } from "../../domain/knowledge/knowledgeDocument";
import { classifyEvidenceSufficiency, buildConsultationAnswer } from "../../domain/institutionalConsultation";
import { createContextPackage, type ContextPackage } from "../../domain/institutionalIntegration/contextPackage";
import { answerConsultation, getOfficialCorpus } from "../../services/institutionalConsultationService";
import { InMemoryConsultationRepository, setConsultationRepository } from "../../services/institutionalConsultationRepository";
import { MOREIRA_SALES_TENANT_ID } from "../../services/officialCorpus/officialCorpusBuilder";
import { executeCognitiveTask } from "../../services/aiExecutionEngine";

const REPORTED_QUERY = "Qual artigo da Lei 14.133 trata da contratação direta?";
const CONTRATACAO_DIRETA_ARTICLES = ["Art. 72º", "Art. 73º", "Art. 74º", "Art. 75º"];

let corpus: OfficialCorpusBuildResult;
beforeAll(() => { corpus = buildOfficialKnowledgeCorpus({ correlationId: "rag-quality-002-test" }); });

function retrieveForLei14133(query: string, maxPassagesPerDocument = 3) {
  const ctx = resolveInstitutionalContext(corpus.registry, { tenantId: 1, businessDomain: null, taskType: "LEGAL_ANALYSIS" });
  const result = retrieveKnowledge(corpus, ctx, { query, maxPassagesPerDocument, maxPassageChars: 700 });
  const leiDocId = corpus.ingested.find(d => d.official.normId === "lei-14133-2021")!.official.documentId;
  return { result, leiPassages: result.passages.filter(p => p.documentId === leiDocId) };
}

describe("RAG-QUALITY-002 — Dedup de artigos duplicados no texto-fonte (Art. 191)", () => {
  it("o texto-fonte real contém 'Art. 191' 3 vezes (histórico de redação por MP) — confirma a causa, sem presumir", () => {
    const raw = readFileSync(join(process.cwd(), "data", "lei_14133_2021.txt"), "utf8");
    const occurrences = raw.split(/\n/).filter(l => /^Art\.\s*191\./.test(l.trim()));
    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });

  it("parseOfficialText deduplica identificadores repetidos, mantendo a ÚLTIMA ocorrência (texto vigente)", () => {
    const raw = readFileSync(join(process.cwd(), "data", "lei_14133_2021.txt"), "utf8");
    const parsed = parseOfficialText(raw);
    const art191 = parsed.articles.filter(a => a.identifier === "Art. 191º");
    expect(art191.length).toBe(1);
    // a última ocorrência no texto-fonte não traz marcador de "Vigência encerrada"/MP — é a consolidada.
    expect(art191[0].fullText).not.toMatch(/Medida Provisória|Vigência encerrada/i);
  });

  it("dedup preserva a ORDEM natural do documento (não desloca o artigo para o fim)", () => {
    const text = [
      "LEI Nº 1, DE 2099",
      "Art. 1º Primeiro artigo.",
      "Art. 2º Segundo artigo — versão antiga.",
      "Art. 2º Segundo artigo — versão vigente (redação atual).",
      "Art. 3º Terceiro artigo.",
    ].join("\n");
    const parsed = parseOfficialText(text);
    expect(parsed.articles.map(a => a.identifier)).toEqual(["Art. 1º", "Art. 2º", "Art. 3º"]);
    expect(parsed.articles[1].fullText).toContain("vigente");
  });

  it("no bloco ingerido do corpus real, 'Art. 191º' aparece UMA única vez", () => {
    const lei = corpus.ingested.find(d => d.official.normId === "lei-14133-2021")!;
    const blocks = allBlocks(lei.knowledgeDocument).filter(b => b.kind === "OfficialText" && b.title === "Art. 191º");
    expect(blocks.length).toBe(1);
  });
});

describe("RAG-QUALITY-002 — A pergunta relatada no staging: nunca mais Art. 191 como fundamento principal", () => {
  it("o Art. 191 (Disposições Transitórias e Finais) NÃO é a passagem de maior score para lei-14133-2021", () => {
    const { leiPassages } = retrieveForLei14133(REPORTED_QUERY, 3);
    expect(leiPassages.length).toBeGreaterThan(0);
    const top = [...leiPassages].sort((a, b) => b.score - a.score)[0];
    expect(top.identifier).not.toBe("Art. 191º");
  });

  it("ao menos um dos arts. 72-75 (Da Contratação Direta) está entre as passagens retornadas", () => {
    const { leiPassages } = retrieveForLei14133(REPORTED_QUERY, 3);
    expect(leiPassages.some(p => CONTRATACAO_DIRETA_ARTICLES.includes(p.identifier))).toBe(true);
  });

  it("topPassageGenericContainer é false — a passagem líder não vem de um container genérico", () => {
    const { result } = retrieveForLei14133(REPORTED_QUERY, 3);
    expect(result.topPassageGenericContainer).toBe(false);
  });

  it("Art. 191 nunca aparece no top-3, mesmo com folga (maxPassagesPerDocument=10)", () => {
    const { leiPassages } = retrieveForLei14133(REPORTED_QUERY, 10);
    const rank191 = [...leiPassages].sort((a, b) => b.score - a.score).findIndex(p => p.identifier === "Art. 191º");
    // Pode aparecer (score residual > 0), mas nunca no topo — se aparecer, deve estar bem abaixo dos 72-75.
    if (rank191 >= 0) expect(rank191).toBeGreaterThan(2);
  });
});

describe("RAG-QUALITY-002 — Preserva os 3 cenários que já passaram no staging", () => {
  it("inexigibilidade → Art. 74 é a passagem de maior score", () => {
    const { leiPassages } = retrieveForLei14133("quando é cabível a inexigibilidade de licitação?", 3);
    const top = [...leiPassages].sort((a, b) => b.score - a.score)[0];
    expect(top.identifier).toBe("Art. 74º");
  });

  it("dispensa → Art. 75 é a passagem de maior score (mesmo com o Art. 76 — Alienações — citando 'dispensa' várias vezes)", () => {
    const { leiPassages } = retrieveForLei14133("Quando é cabível a dispensa de licitação?", 3);
    const top = [...leiPassages].sort((a, b) => b.score - a.score)[0];
    expect(top.identifier).toBe("Art. 75º");
  });

  it("instrução do processo de contratação direta → Art. 72 é a passagem de maior score", () => {
    const { leiPassages } = retrieveForLei14133("quais documentos instruem o processo de contratação direta?", 3);
    const top = [...leiPassages].sort((a, b) => b.score - a.score)[0];
    expect(top.identifier).toBe("Art. 72º");
  });
});

describe("RAG-QUALITY-002 — Suficiência de evidência: sustenta a frase ≠ responde à intenção", () => {
  const baseParams = {
    correlationId: "c", tenantId: 1, taskType: "LEGAL_ANALYSIS", hierarchy: ["federal"],
    documents: [{ documentId: "d1", normId: "n1", title: "T", authority: "A", jurisdiction: "federal", version: "1.0.0", bindingLevel: "mandatory", status: "vigente" }],
    citations: [], explainability: [],
  };
  function pkgWith(metadata: Record<string, unknown>): ContextPackage {
    return createContextPackage({
      ...baseParams,
      retrievedPassages: [{ documentId: "d1", normId: "n1", blockId: "b0", identifier: "Art. 1º", text: "x", score: 0.8 }],
      metadata,
    });
  }

  it("NÃO classifica 'fundamentada' quando a passagem líder vem de um container genérico concorrente", () => {
    const pkg = pkgWith({ coverageRatio: 0.9, maxPassageScore: 0.8, topPassageGenericContainer: true });
    expect(classifyEvidenceSufficiency(pkg)).toBe("parcial");
  });

  it("classifica 'fundamentada' quando cobertura/score são altos E a passagem líder é tematicamente relevante", () => {
    const pkg = pkgWith({ coverageRatio: 0.9, maxPassageScore: 0.8, topPassageGenericContainer: false });
    expect(classifyEvidenceSufficiency(pkg)).toBe("fundamentada");
  });

  it("NÃO classifica 'fundamentada' quando a geração foi cortada (generationTruncated), mesmo com boa evidência", () => {
    const pkg = pkgWith({ coverageRatio: 0.9, maxPassageScore: 0.8, topPassageGenericContainer: false });
    expect(classifyEvidenceSufficiency(pkg, { generationTruncated: true })).toBe("parcial");
  });

  it("buildConsultationAnswer registra a limitação específica de container genérico e de truncamento", () => {
    const genericTop = buildConsultationAnswer({
      tenantId: 1, userId: 1, question: "q", engineContent: "resposta",
      contextPackage: pkgWith({ coverageRatio: 0.9, maxPassageScore: 0.8, topPassageGenericContainer: true }),
      executionId: "e1", createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(genericTop.evidenceSufficiency).toBe("parcial");
    expect(genericTop.limitations.some(l => /disposição geral\/transitória/i.test(l))).toBe(true);

    const truncated = buildConsultationAnswer({
      tenantId: 1, userId: 1, question: "q", engineContent: "resposta",
      contextPackage: pkgWith({ coverageRatio: 0.9, maxPassageScore: 0.8, topPassageGenericContainer: false }),
      executionId: "e2", createdAt: "2026-01-01T00:00:00.000Z", generationTruncated: true,
    });
    expect(truncated.evidenceSufficiency).toBe("parcial");
    expect(truncated.limitations.some(l => /limite de tamanho|incompleta/i.test(l))).toBe(true);
  });
});

describe("RAG-QUALITY-002 — finishReason não é mais descartado (geração incompleta é auditável)", () => {
  it("executeCognitiveTask expõe finishReason em context.outcome (mock provider → 'stop')", async () => {
    const execution = await executeCognitiveTask({
      tenantId: 1, userId: "1", task: "LEGAL_ANALYSIS", correlationId: "rag-quality-002-finishreason", query: "teste",
    });
    expect(execution.context.outcome.finishReason).toBe("stop");
  });
});

describe("RAG-QUALITY-002 — Fluxo completo (answerConsultation) para a pergunta relatada", () => {
  beforeAll(() => { getOfficialCorpus(); setConsultationRepository(new InMemoryConsultationRepository()); });

  it("a pergunta relatada nunca retorna o Art. 191 como fundamento principal", async () => {
    const a = await answerConsultation({
      organizationId: MOREIRA_SALES_TENANT_ID, userId: 1, question: REPORTED_QUERY, correlationId: "rag-quality-002-e2e",
    });
    const leiPassages = a.passages.filter(p => /^Art\./.test(p.identifier));
    expect(leiPassages.length).toBeGreaterThan(0);
    const top = [...a.passages].sort((x, y) => y.score - x.score)[0];
    expect(top.identifier).not.toBe("Art. 191º");
    expect(a.passages.some(p => CONTRATACAO_DIRETA_ARTICLES.includes(p.identifier))).toBe(true);
  });
});

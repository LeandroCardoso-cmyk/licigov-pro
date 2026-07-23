/**
 * RAG-QUALITY-003 — Truncamento (MAX_TOKENS), retry único e cobertura dos artigos primários.
 *
 * Staging (após RAG-QUALITY-002): retrieval corrigido, mas 3 respostas vieram cortadas
 * (contratação direta, inexigibilidade, instrução do processo) enquanto Art. 191/transição vieram
 * completas. Não há acesso a logs de staging neste ambiente (mesma limitação das revisões
 * anteriores) — a causa foi inferida via `finishReason` (já instrumentado no RAG-QUALITY-002) e
 * corrigida estruturalmente: orçamento de saída configurável e maior para LEGAL_ANALYSIS, retry
 * único quando MAX_TOKENS ocorrer (reaproveitando o MESMO ContextPackage — a recuperação NUNCA é
 * re-executada), instrução de completude reforçada no prompt, e cobertura garantida dos artigos
 * primários (72/74/75) para a pergunta geral sobre contratação direta (vizinhança por CAPÍTULO, não
 * só por Seção — antes só o Art. 75 entrava no contexto).
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { setActiveProvider } from "../../_core/ai/providerAdapter";
import type { AIProvider, AIGenerateOptions, AIGenerateResult } from "../../_core/ai/types";
import { resolveLegalAnalysisMaxOutputTokens, LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS } from "../../config/ai";
import { answerConsultation, getOfficialCorpus, listTenantHistory, getConsultationSources } from "../../services/institutionalConsultationService";
import { InMemoryConsultationRepository, setConsultationRepository } from "../../services/institutionalConsultationRepository";
import { MOREIRA_SALES_TENANT_ID, buildOfficialKnowledgeCorpus, type OfficialCorpusBuildResult } from "../../services/officialCorpus/officialCorpusBuilder";
import { resolveInstitutionalContext } from "../../domain/institutionalIntegration/institutionalContextResolver";
import { retrieveKnowledge } from "../../services/institutionalIntegration/knowledgeRetrievalService";
import { COGNITIVE_PROMPT_BUILDERS } from "../../services/cognitive/promptBuilders";
import { createContextPackage } from "../../domain/institutionalIntegration/contextPackage";

const REPORTED_QUERY = "Qual artigo da Lei 14.133 trata da contratação direta?";

// ── Provider falso e controlável — simula 1ª tentativa cortada por MAX_TOKENS ──────────────────
function makeControlledProvider(behaviors: Array<"max_tokens" | "stop">): { provider: AIProvider; calls: AIGenerateOptions[] } {
  const calls: AIGenerateOptions[] = [];
  const provider: AIProvider = {
    name: "controlled-test-provider",
    generateText: async () => "",
    generate: async (o: AIGenerateOptions): Promise<AIGenerateResult> => {
      calls.push(o);
      const behavior = behaviors[calls.length - 1] ?? behaviors[behaviors.length - 1];
      if (behavior === "max_tokens") {
        return {
          text: "Esta é uma resposta que foi cortada no meio da fra",
          finishReason: "max_tokens",
          usage: { inputTokens: 500, outputTokens: o.maxTokens ?? 0, totalTokens: 500 + (o.maxTokens ?? 0) },
        };
      }
      return {
        text: "Esta é uma resposta completa, fundamentada no Art. 75 da Lei 14.133/2021, e termina corretamente.",
        finishReason: "stop",
        usage: { inputTokens: 500, outputTokens: 40, totalTokens: 540 },
      };
    },
  };
  return { provider, calls };
}

describe("RAG-QUALITY-003 — Orçamento de saída configurável (server/config/ai.ts)", () => {
  it("default aumentado (3000) quando a env var não está definida", () => {
    expect(resolveLegalAnalysisMaxOutputTokens({})).toBe(3000);
  });
  it("respeita LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS quando definida e válida", () => {
    expect(resolveLegalAnalysisMaxOutputTokens({ LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS: "5000" })).toBe(5000);
  });
  it("cai no default para valores inválidos (não numérico, negativo, zero)", () => {
    expect(resolveLegalAnalysisMaxOutputTokens({ LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS: "abc" })).toBe(3000);
    expect(resolveLegalAnalysisMaxOutputTokens({ LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS: "-100" })).toBe(3000);
    expect(resolveLegalAnalysisMaxOutputTokens({ LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS: "0" })).toBe(3000);
  });
  it("o orçamento em uso é maior que o teto antigo (1500) — o valor que causava o truncamento medido em staging", () => {
    expect(LEGAL_ANALYSIS_MAX_OUTPUT_TOKENS).toBeGreaterThan(1500);
  });
});

describe("RAG-QUALITY-003 — Prompt exige respostas completas (sem frase/lista interrompida)", () => {
  it("o system prompt de LEGAL_ANALYSIS (com ContextPackage) instrui a nunca finalizar no meio de uma frase/lista", () => {
    const pkg = createContextPackage({
      correlationId: "c", tenantId: 1, taskType: "LEGAL_ANALYSIS", hierarchy: ["federal"],
      documents: [], retrievedPassages: [], citations: [], explainability: [],
    });
    const built = COGNITIVE_PROMPT_BUILDERS.LEGAL_ANALYSIS.build({ query: "teste", contextPackage: pkg });
    expect(built.system).toMatch(/nunca finalize no meio/i);
  });
});

describe("RAG-QUALITY-003 — Retry único em MAX_TOKENS, preservando correlationId, sem duplicar persistência", () => {
  beforeEach(() => { getOfficialCorpus(); setConsultationRepository(new InMemoryConsultationRepository()); });
  afterEach(() => setActiveProvider(null));

  it("1ª tentativa MAX_TOKENS → retry ÚNICO com orçamento maior → resposta final completa", async () => {
    const { provider, calls } = makeControlledProvider(["max_tokens", "stop"]);
    setActiveProvider(provider);

    const a = await answerConsultation({
      organizationId: MOREIRA_SALES_TENANT_ID, userId: 1, question: REPORTED_QUERY, correlationId: "rag-quality-003-retry",
    });

    expect(calls.length).toBe(2); // exatamente 1 retry — nunca mais que isso
    expect(calls[1].maxTokens).toBeGreaterThan(calls[0].maxTokens ?? 0); // orçamento maior na 2ª tentativa
    expect(a.answer).toContain("termina corretamente"); // conteúdo da tentativa FINAL (bem-sucedida)
    expect(a.answer).not.toContain("cortada no meio"); // NÃO é o texto truncado da 1ª tentativa
    expect(a.correlationId).toBe("rag-quality-003-retry"); // correlationId preservado (mesmo nas 2 tentativas)
    expect(a.replayId).toBeNull(); // retry interno NUNCA é tratado como replay explícito
  });

  it("finishReason=stop na 1ª tentativa → NENHUM retry (só 1 chamada ao provider)", async () => {
    const { provider, calls } = makeControlledProvider(["stop"]);
    setActiveProvider(provider);
    await answerConsultation({ organizationId: MOREIRA_SALES_TENANT_ID, userId: 1, question: REPORTED_QUERY, correlationId: "rag-quality-003-no-retry" });
    expect(calls.length).toBe(1);
  });

  it("MAX_TOKENS em AMBAS as tentativas → exatamente 2 chamadas (nunca um 3º retry) e a resposta é marcada como possivelmente incompleta", async () => {
    const { provider, calls } = makeControlledProvider(["max_tokens", "max_tokens"]);
    setActiveProvider(provider);
    const a = await answerConsultation({ organizationId: MOREIRA_SALES_TENANT_ID, userId: 1, question: REPORTED_QUERY, correlationId: "rag-quality-003-still-truncated" });
    expect(calls.length).toBe(2);
    expect(a.evidenceSufficiency).not.toBe("fundamentada"); // nunca "Fundamentada às cegas" quando a geração permanece cortada
    expect(a.limitations.some(l => /limite de tamanho|incompleta/i.test(l))).toBe(true);
  });

  it("não duplica histórico/auditoria/consulta persistida — exatamente 1 registro e 1 conjunto de fontes, mesmo com retry", async () => {
    const { provider } = makeControlledProvider(["max_tokens", "stop"]);
    setActiveProvider(provider);
    const a = await answerConsultation({ organizationId: MOREIRA_SALES_TENANT_ID, userId: 1, question: REPORTED_QUERY, correlationId: "rag-quality-003-no-dup" });

    const history = await listTenantHistory(MOREIRA_SALES_TENANT_ID);
    const matches = history.filter(h => h.executionId === a.executionId);
    expect(matches.length).toBe(1); // exatamente UM registro de consulta, não 2
    expect(matches[0].status).toBe("completed");

    const sources = await getConsultationSources(MOREIRA_SALES_TENANT_ID, a.executionId);
    expect(sources.length).toBe(a.passages.length); // fontes não duplicadas (1x por passagem, não 2x)
  });
});

describe("RAG-QUALITY-003 — Cobertura dos artigos primários (72/74/75) na pergunta geral sobre contratação direta", () => {
  let corpus: OfficialCorpusBuildResult;
  beforeAll(() => { corpus = buildOfficialKnowledgeCorpus({ correlationId: "rag-quality-003-coverage" }); });

  it("os trechos PRIMÁRIOS dos arts. 72, 74 e 75 entram no top-3 (não apenas referências indiretas de outro documento)", () => {
    const ctx = resolveInstitutionalContext(corpus.registry, { tenantId: 1, businessDomain: null, taskType: "LEGAL_ANALYSIS" });
    const result = retrieveKnowledge(corpus, ctx, { query: REPORTED_QUERY, maxPassagesPerDocument: 3, maxPassageChars: 700 });
    const leiDocId = corpus.ingested.find(d => d.official.normId === "lei-14133-2021")!.official.documentId;
    const leiPassages = result.passages.filter(p => p.documentId === leiDocId);
    const ids = leiPassages.map(p => p.identifier);
    expect(ids).toEqual(expect.arrayContaining(["Art. 72º", "Art. 74º", "Art. 75º"]));
  });

  it("continua correto para as perguntas específicas já validadas (inexigibilidade→74, dispensa→75, processo→72)", () => {
    const ctx = resolveInstitutionalContext(corpus.registry, { tenantId: 1, businessDomain: null, taskType: "LEGAL_ANALYSIS" });
    const leiDocId = corpus.ingested.find(d => d.official.normId === "lei-14133-2021")!.official.documentId;
    const cases: Array<[string, string]> = [
      ["quando é cabível a inexigibilidade de licitação?", "Art. 74º"],
      ["Quando é cabível a dispensa de licitação?", "Art. 75º"],
      ["quais documentos instruem o processo de contratação direta?", "Art. 72º"],
    ];
    for (const [query, expectedTop] of cases) {
      const result = retrieveKnowledge(corpus, ctx, { query, maxPassagesPerDocument: 3, maxPassageChars: 700 });
      const top = [...result.passages.filter(p => p.documentId === leiDocId)].sort((a, b) => b.score - a.score)[0];
      expect(top.identifier).toBe(expectedTop);
    }
  });

  it("Art. 191/transição continuam corretos (vizinhança por Capítulo não regride o RAG-QUALITY-002)", () => {
    const ctx = resolveInstitutionalContext(corpus.registry, { tenantId: 1, businessDomain: null, taskType: "LEGAL_ANALYSIS" });
    const leiDocId = corpus.ingested.find(d => d.official.normId === "lei-14133-2021")!.official.documentId;
    const result = retrieveKnowledge(corpus, ctx, {
      query: "até quando a administração pode optar por licitar de acordo com a lei 8666 em vez da lei 14133?",
      maxPassagesPerDocument: 3, maxPassageChars: 700,
    });
    const top = [...result.passages.filter(p => p.documentId === leiDocId)].sort((a, b) => b.score - a.score)[0];
    expect(top.identifier).toBe("Art. 191º");
    expect(result.topPassageGenericContainer).toBe(false);
  });
});

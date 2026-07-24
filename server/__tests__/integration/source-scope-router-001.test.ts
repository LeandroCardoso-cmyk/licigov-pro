/**
 * SOURCE-SCOPE-ROUTER-001 — Seleção determinística de fontes no "Tirar Dúvidas".
 *
 * Antes do retrieval, um roteador determinístico decide o escopo documental: quando a pergunta cita
 * um diploma, a 1ª busca fica RESTRITA a ele; fontes complementares (decretos/INs/jurisprudência/
 * normas municipais/outras leis) só entram quando o usuário pede, há remissão normativa, ou a 1ª
 * busca é insuficiente — no máximo UMA ampliação. Tudo é auditado (intenção, diploma, escopo, motivo
 * de expansão, fontes incluídas/descartadas) e replay-safe.
 */

import { describe, it, expect, beforeEach, afterEach, beforeAll } from "vitest";
import { buildOfficialKnowledgeCorpus, MOREIRA_SALES_TENANT_ID, type OfficialCorpusBuildResult } from "../../services/officialCorpus/officialCorpusBuilder";
import { resolveInstitutionalContextPackage } from "../../services/institutionalIntegration/institutionalKnowledgeIntegration";
import { getIntegrationEvents, clearIntegrationEvents } from "../../services/institutionalIntegration/institutionalIntegrationObservabilityService";
import { decideSourceScope, detectIntent, detectRequestedDiplomas, classifyApplicability, isAmbiguousConsultation, questionRelatesToSrp } from "../../domain/institutionalIntegration/sourceScopeRouter";
import { buildConsultationAnswer, classifyEvidenceSufficiency } from "../../domain/institutionalConsultation";
import { createContextPackage, type ContextPackage } from "../../domain/institutionalIntegration/contextPackage";
import {
  answerConsultation, getOfficialCorpus, listTenantHistory, getConsultationForTenant,
  getConsultationSources, replayConsultation,
} from "../../services/institutionalConsultationService";
import { InMemoryConsultationRepository, setConsultationRepository } from "../../services/institutionalConsultationRepository";
import { setActiveProvider } from "../../_core/ai/providerAdapter";
import type { AIProvider, AIGenerateResult } from "../../_core/ai/types";

const MS = MOREIRA_SALES_TENANT_ID;

let corpus: OfficialCorpusBuildResult;
beforeAll(() => { corpus = buildOfficialKnowledgeCorpus({ correlationId: "source-scope-test" }); });

function scoped(question: string, tenantId = MS, maxPer = 3) {
  const pkg = resolveInstitutionalContextPackage(corpus, {
    tenantId, businessDomain: "institutional_consultation", taskType: "LEGAL_ANALYSIS",
    query: question, correlationId: `c-${question}`, maxPassagesPerDocument: maxPer, maxPassageChars: 700,
    enableSourceScopeRouting: true,
  });
  const audit = (pkg.metadata as { sourceScope: { intent: string; requestedDiplomas: string[]; includedNormIds: string[]; discardedNormIds: string[]; expanded: boolean; expansionReason: string | null } }).sourceScope;
  const leiArts = pkg.retrievedPassages.filter(p => p.normId === "lei-14133-2021").map(p => p.identifier);
  const topArt = [...pkg.retrievedPassages].sort((a, b) => b.score - a.score)[0]?.identifier;
  return { pkg, audit, leiArts, topArt };
}

const officialDoc = (normId: string) => corpus.ingested.find(d => d.official.normId === normId)!.official;

describe("SOURCE-SCOPE-ROUTER-001 · roteador (unidade, determinístico)", () => {
  it("classifica as 6 intenções", () => {
    expect(detectIntent("Qual artigo da Lei 14.133 trata da contratação direta?")).toBe("normativa_objetiva");
    expect(detectIntent("Como funciona o sistema de registro de preços?")).toBe("regulamentar");
    expect(detectIntent("Qual o entendimento do TCE-PR sobre dispensa?")).toBe("jurisprudencial");
    expect(detectIntent("Como funciona no meu município?")).toBe("municipal");
    expect(detectIntent("Como faço o passo a passo do processo?")).toBe("operacional");
    expect(detectIntent("Qual a diferença entre a 8.666 e a 14.133?")).toBe("comparativa");
  });

  it("detecta apenas diplomas citados E presentes no contexto (nunca inventa fonte ausente)", () => {
    const all = corpus.ingested.map(d => d.official.normId);
    expect(detectRequestedDiplomas("Lei 14.133 contratação direta", all)).toEqual(["lei-14133-2021"]);
    expect(detectRequestedDiplomas("Decreto 11.462 registro de preços", all)).toEqual(["decreto-11462-2023"]);
    // 8.666 não está no corpus (revogada) → não vira restrição, mesmo citada
    expect(detectRequestedDiplomas("lei 8.666 versus lei 14.133", all)).toEqual(["lei-14133-2021"]);
    expect(detectRequestedDiplomas("quando é cabível a dispensa?", all)).toEqual([]);
  });

  it("decide escopo restrito quando há diploma citado; irrestrito quando não há", () => {
    const all = corpus.ingested.map(d => d.official.normId);
    const withDiploma = decideSourceScope({ question: "Lei 14.133 contratação direta", availableNormIds: all });
    expect(withDiploma.initialScopeNormIds).toEqual(["lei-14133-2021"]);
    expect(withDiploma.allowExpansion).toBe(true);
    const noDiploma = decideSourceScope({ question: "quando é cabível a dispensa?", availableNormIds: all });
    expect(noDiploma.initialScopeNormIds).toBeNull();
  });
});

describe("SOURCE-SCOPE-ROUTER-001 · aplicabilidade institucional (ponto 5/6/7)", () => {
  it("IN SEGES/ME nº 65 é norma do Executivo federal — NUNCA regra municipal universal", () => {
    const info = classifyApplicability(officialDoc("in-seges-65-2021"));
    expect(info.category).toBe("norma_executivo_federal");
    expect(info.category).not.toBe("norma_municipal");
    expect(info.federalOnly).toBe(true);
  });
  it("Decreto 11.462/2023 é regra específica do SRP (não é obrigação geral)", () => {
    const info = classifyApplicability(officialDoc("decreto-11462-2023"));
    expect(info.srpSpecific).toBe(true);
    expect(info.federalOnly).toBe(true);
  });
  it("Lei 14.133 e LC 123 são normas federais gerais; norma municipal é municipal; TCE-PR é jurisprudência", () => {
    expect(classifyApplicability(officialDoc("lei-14133-2021")).category).toBe("norma_federal_geral");
    expect(classifyApplicability(officialDoc("lc-123-2006")).category).toBe("norma_federal_geral");
    expect(classifyApplicability(officialDoc("lei-municipal-769-2021-moreira-sales")).category).toBe("norma_municipal");
    expect(classifyApplicability(officialDoc("prejulgado-27-tce-pr")).category).toBe("jurisprudencia");
    expect(classifyApplicability(officialDoc("manual-tce-pr")).category).toBe("jurisprudencia");
  });
});

describe("SOURCE-SCOPE-ROUTER-001 · escopo aplicado ao retrieval (integração)", () => {
  it("Lei 14.133 explícita → SOMENTE essa lei (decreto/IN/jurisprudência/municipal descartados)", () => {
    const { audit } = scoped("Qual artigo da Lei 14.133 trata da contratação direta?");
    expect(audit.includedNormIds).toEqual(["lei-14133-2021"]);
    expect(audit.discardedNormIds).toEqual(expect.arrayContaining([
      "decreto-11462-2023", "in-seges-65-2021", "manual-tce-pr", "prejulgado-27-tce-pr", "lei-municipal-769-2021-moreira-sales",
    ]));
  });

  it("inexigibilidade com lei explícita → Art. 74 no topo, sem fontes desnecessárias", () => {
    const { audit, topArt } = scoped("Segundo a Lei 14.133, quando é cabível a inexigibilidade de licitação?");
    expect(audit.includedNormIds).toEqual(["lei-14133-2021"]);
    expect(topArt).toBe("Art. 74º");
  });

  it("contratação direta geral → arts. 72 a 75, INCLUINDO o art. 73 (contratação direta indevida)", () => {
    const { audit, leiArts } = scoped("Qual artigo da Lei 14.133 trata da contratação direta?");
    expect(audit.includedNormIds).toEqual(["lei-14133-2021"]);
    expect(leiArts).toEqual(expect.arrayContaining(["Art. 72º", "Art. 73º", "Art. 74º", "Art. 75º"]));
  });

  it("pergunta sobre SRP → permite o Decreto nº 11.462", () => {
    const { audit } = scoped("Como funciona o sistema de registro de preços?");
    expect(audit.intent).toBe("regulamentar");
    expect(audit.includedNormIds).toContain("decreto-11462-2023");
  });

  it("pergunta sobre TCE-PR → inclui o corpus do TCE-PR", () => {
    const { audit } = scoped("Qual o entendimento do TCE-PR sobre dispensa de licitação?");
    expect(audit.intent).toBe("jurisprudencial");
    expect(audit.includedNormIds.some(n => n === "manual-tce-pr" || n === "prejulgado-27-tce-pr")).toBe(true);
  });

  it("pergunta municipal → inclui a norma municipal (tenant de Moreira Sales)", () => {
    const { audit } = scoped("Como funciona o tratamento diferenciado para ME/EPP no meu município?");
    expect(audit.intent).toBe("municipal");
    expect(audit.includedNormIds).toContain("lei-municipal-769-2021-moreira-sales");
  });

  it("ponto 6 — inclui ressalva de aplicabilidade quando SRP/executivo federal integram contexto municipal", () => {
    // Pergunta municipal (tenant MS) que naturalmente inclui o Decreto 11.462 (SRP) e a IN 65 (federal).
    const { pkg, audit } = scoped("Como funciona o registro de preços no meu município?");
    expect(audit.includedNormIds).toContain("decreto-11462-2023");
    const answer = buildConsultationAnswer({
      tenantId: MS, userId: 1, question: "Como funciona o registro de preços no meu município?",
      engineContent: "resposta", contextPackage: pkg, executionId: "e-caveat", createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(answer.observations.some(o => /aplicabilidade/i.test(o) && /município/i.test(o))).toBe(true);
  });
});

describe("SOURCE-SCOPE-ROUTER-001 · ampliação (máx. 1×) e não duplicação de histórico", () => {
  beforeEach(() => { getOfficialCorpus(); setConsultationRepository(new InMemoryConsultationRepository()); clearIntegrationEvents(); });

  it("cita diploma + pede TCE → amplia EXATAMENTE uma vez, sem duplicar retrieval/histórico", async () => {
    const correlationId = "scope-expansion-e2e";
    const a = await answerConsultation({
      organizationId: MS, userId: 1,
      question: "Qual o entendimento do TCE sobre a contratação direta prevista na Lei 14.133?",
      correlationId,
    });

    const events = getIntegrationEvents(correlationId);
    // Ampliação ocorre no máximo uma vez.
    expect(events.filter(e => e.type === "sourceScopeExpansion").length).toBe(1);
    // Auditoria de retrieval emitida UMA vez (a busca interna dupla não duplica os eventos de auditoria).
    expect(events.filter(e => e.type === "knowledgeRetrieval").length).toBe(1);
    expect(events.filter(e => e.type === "sourceScope").length).toBe(1);

    // Histórico: exatamente UM registro persistido para esta execução.
    const history = await listTenantHistory(MS);
    expect(history.filter(h => h.executionId === a.executionId).length).toBe(1);

    // A auditoria persistida (contextSnapshot) registra a expansão e seu motivo.
    const rec = await getConsultationForTenant(MS, a.executionId);
    const snap = JSON.parse(rec!.contextSnapshot!) as { sourceScope: { expanded: boolean; expansionReason: string; requestedDiplomas: string[] } };
    expect(snap.sourceScope.expanded).toBe(true);
    expect(snap.sourceScope.expansionReason).toBe("usuario_solicitou_fontes_complementares");
    expect(snap.sourceScope.requestedDiplomas).toEqual(["lei-14133-2021"]);
  });

  it("diploma citado que responde por si só NÃO amplia (sem fontes complementares automáticas)", async () => {
    const correlationId = "scope-no-expansion-e2e";
    await answerConsultation({
      organizationId: MS, userId: 1,
      question: "Qual artigo da Lei 14.133 trata da contratação direta?",
      correlationId,
    });
    const events = getIntegrationEvents(correlationId);
    expect(events.filter(e => e.type === "sourceScopeExpansion").length).toBe(0);
    const scopeEvent = events.find(e => e.type === "sourceScope");
    expect(scopeEvent?.detail).toContain("incluídas=[lei-14133-2021]");
  });
});

describe("SOURCE-SCOPE-ROUTER-001 · replay reproduz o mesmo escopo e as mesmas fontes", () => {
  beforeEach(() => { getOfficialCorpus(); setConsultationRepository(new InMemoryConsultationRepository()); });

  it("replay preserva contextReplayHash, fontes incluídas e decisão de escopo", async () => {
    const original = await answerConsultation({
      organizationId: MS, userId: 1,
      question: "Qual artigo da Lei 14.133 trata da contratação direta?",
      correlationId: "scope-replay-original",
    });
    const replay = await replayConsultation({
      organizationId: MS, userId: 1, originalExecutionId: original.executionId, correlationId: "scope-replay-new",
    });

    // Mesmo contexto lógico (hash estável) e mesmas fontes recuperadas.
    expect(replay.contextReplayHash).toBe(original.contextReplayHash);

    const origRec = await getConsultationForTenant(MS, original.executionId);
    const replayRec = await getConsultationForTenant(MS, replay.executionId);
    const origScope = (JSON.parse(origRec!.contextSnapshot!) as { sourceScope: { includedNormIds: string[]; intent: string } }).sourceScope;
    const replayScope = (JSON.parse(replayRec!.contextSnapshot!) as { sourceScope: { includedNormIds: string[]; intent: string } }).sourceScope;
    expect(replayScope.includedNormIds).toEqual(origScope.includedNormIds);
    expect(replayScope.intent).toBe(origScope.intent);
    expect(origScope.includedNormIds).toEqual(["lei-14133-2021"]);

    // Fontes persistidas idênticas (mesma quantidade e mesmos documentos).
    const origSources = await getConsultationSources(MS, original.executionId);
    const replaySources = await getConsultationSources(MS, replay.executionId);
    expect(replaySources.map(s => s.documentId).sort()).toEqual(origSources.map(s => s.documentId).sort());
  });

  it("tenant isolation preservado: outro tenant não recupera a norma municipal de Moreira Sales via escopo municipal", () => {
    const { audit } = scoped("tratamento diferenciado ME/EPP no meu município", 888888);
    expect(audit.includedNormIds).not.toContain("lei-municipal-769-2021-moreira-sales");
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// Lacunas finais (validação pós-staging)
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("SOURCE-SCOPE-ROUTER-001 · LACUNA 1 — SRP e normas do Executivo federal", () => {
  it("questionRelatesToSrp detecta relação direta com o SRP", () => {
    expect(questionRelatesToSrp("Como funciona o sistema de registro de preços?")).toBe(true);
    expect(questionRelatesToSrp("O que é a ata de registro de preços?")).toBe(true);
    expect(questionRelatesToSrp("Como funciona o tratamento diferenciado para ME/EPP?")).toBe(false);
  });

  it("pergunta GERAL (sem relação com SRP) NÃO inclui o Decreto 11.462 (SRP)", () => {
    const { audit } = scoped("Como funciona o tratamento diferenciado para ME/EPP no meu município?");
    expect(audit.includedNormIds).not.toContain("decreto-11462-2023");
  });

  it("pergunta SOBRE SRP continua incluindo o Decreto 11.462 (controle — não regride o caso verde)", () => {
    const { audit } = scoped("Como funciona o sistema de registro de preços?");
    expect(audit.includedNormIds).toContain("decreto-11462-2023");
  });

  it("Decreto 11.462 citado explicitamente é incluído mesmo sem relação temática (fonte solicitada)", () => {
    const { audit } = scoped("O que diz o Decreto 11.462?");
    expect(audit.includedNormIds).toContain("decreto-11462-2023");
  });

  it("norma do Executivo federal (IN SEGES 65) integrando contexto municipal → ressalva explícita de aplicabilidade", () => {
    const { pkg, audit } = scoped("Como funciona a pesquisa de preços da IN SEGES 65 no meu município?");
    expect(audit.includedNormIds).toContain("in-seges-65-2021");
    const answer = buildConsultationAnswer({
      tenantId: MS, userId: 1, question: "Como funciona a pesquisa de preços da IN SEGES 65 no meu município?",
      engineContent: "resposta", contextPackage: pkg, executionId: "e-in65", createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(answer.observations.some(o => /aplicabilidade/i.test(o) && /município/i.test(o))).toBe(true);
  });
});

describe("SOURCE-SCOPE-ROUTER-001 · LACUNA 2 — selos: ausência de evidência específica não é 'Fundamentada'", () => {
  function jurisPkg(passageNorms: string[]): ContextPackage {
    return createContextPackage({
      correlationId: "c", tenantId: 1, taskType: "LEGAL_ANALYSIS", hierarchy: ["federal"],
      documents: passageNorms.map((n, i) => ({ documentId: `d${i}`, normId: n, title: n, authority: "A", jurisdiction: "federal", version: "1.0.0", bindingLevel: "referencia", status: "vigente" })),
      retrievedPassages: passageNorms.map((n, i) => ({ documentId: `d${i}`, normId: n, blockId: `b${i}`, identifier: `Art. ${i}º`, text: "x", score: 0.9 })),
      citations: [], explainability: [],
      metadata: {
        coverageRatio: 1, maxPassageScore: 0.9, topPassageGenericContainer: false,
        sourceScope: {
          intent: "jurisprudencial", requestedDiplomas: [], ambiguous: false,
          applicability: { "manual-tce-pr": { category: "jurisprudencia" }, "lei-14133-2021": { category: "norma_federal_geral" } },
        },
      },
    });
  }
  it("consulta jurisprudencial SEM nenhum trecho de jurisprudência → 'Evidência insuficiente'", () => {
    expect(classifyEvidenceSufficiency(jurisPkg(["lei-14133-2021"]))).toBe("insuficiente");
  });
  it("consulta jurisprudencial COM trecho de jurisprudência (TCE) → não é insuficiente", () => {
    expect(classifyEvidenceSufficiency(jurisPkg(["manual-tce-pr", "lei-14133-2021"]))).not.toBe("insuficiente");
  });
  it("diploma citado sem NENHUM trecho desse diploma → 'Evidência insuficiente'", () => {
    const pkg = createContextPackage({
      correlationId: "c", tenantId: 1, taskType: "LEGAL_ANALYSIS", hierarchy: ["federal"],
      documents: [{ documentId: "d0", normId: "lc-123-2006", title: "LC", authority: "A", jurisdiction: "federal", version: "1", bindingLevel: "referencia", status: "vigente" }],
      retrievedPassages: [{ documentId: "d0", normId: "lc-123-2006", blockId: "b", identifier: "Art. 1º", text: "x", score: 0.9 }],
      citations: [], explainability: [],
      metadata: { coverageRatio: 1, maxPassageScore: 0.9, topPassageGenericContainer: false, sourceScope: { intent: "normativa_objetiva", requestedDiplomas: ["lei-14133-2021"], ambiguous: false, applicability: {} } },
    });
    expect(classifyEvidenceSufficiency(pkg)).toBe("insuficiente");
  });
  it("consulta ao TCE-PR com evidência real do corpus → 'fundamentada' (não regride o caso verde)", () => {
    const { pkg } = scoped("Qual o entendimento do TCE-PR sobre dispensa de licitação?");
    expect(classifyEvidenceSufficiency(pkg)).toBe("fundamentada");
  });
});

describe("SOURCE-SCOPE-ROUTER-001 · LACUNA 3 — ambiguidade: solicitar esclarecimento sem retrieval conclusivo", () => {
  beforeEach(() => { getOfficialCorpus(); setConsultationRepository(new InMemoryConsultationRepository()); });
  afterEach(() => setActiveProvider(null));

  it("isAmbiguousConsultation detecta referência sem antecedente; perguntas concretas não são ambíguas", () => {
    expect(isAmbiguousConsultation("o que diz a legislação municipal sobre o tema?")).toBe(true);
    expect(isAmbiguousConsultation("o que diz a lei sobre isso?")).toBe(true);
    expect(isAmbiguousConsultation("Qual artigo da Lei 14.133 trata da contratação direta?")).toBe(false);
    expect(isAmbiguousConsultation("quando é cabível a dispensa de licitação?")).toBe(false);
  });

  it("pergunta ambígua → não executa retrieval (zero passagens) e o escopo marca ambiguidade", () => {
    const { pkg, audit } = scoped("o que diz a legislação municipal sobre o tema?");
    expect(audit.ambiguous).toBe(true);
    expect(pkg.retrievedPassages.length).toBe(0);
    expect(classifyEvidenceSufficiency(pkg)).toBe("insuficiente");
  });

  it("via answerConsultation: NÃO chama o provider e responde pedindo esclarecimento (status 'limited')", async () => {
    let providerCalls = 0;
    const counting: AIProvider = {
      name: "counting", generateText: async () => "",
      generate: async (): Promise<AIGenerateResult> => { providerCalls++; return { text: "NÃO DEVERIA SER USADO", finishReason: "stop", usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } }; },
    };
    setActiveProvider(counting);
    const a = await answerConsultation({ organizationId: MS, userId: 1, question: "o que diz a legislação municipal sobre o tema?", correlationId: "ambig-e2e" });
    expect(providerCalls).toBe(0); // retrieval não conclusivo → provider não é chamado
    expect(a.status).toBe("limited");
    expect(a.evidenceSufficiency).toBe("insuficiente");
    expect(/especificar|assunto|matéria/i.test(a.answer)).toBe(true);
    expect(a.answer).not.toContain("NÃO DEVERIA SER USADO");
  });
});

describe("SOURCE-SCOPE-ROUTER-001 · LACUNA 4 — não afirmar ausência de normas municipais havendo fixture", () => {
  beforeEach(() => { getOfficialCorpus(); setConsultationRepository(new InMemoryConsultationRepository()); });

  it("investigação: o fixture da Lei Municipal 769 existe no corpus (tenant 700001, municipality Moreira Sales)", () => {
    const mun = corpus.ingested.find(d => d.official.normId === "lei-municipal-769-2021-moreira-sales")!;
    expect(mun.official.tenantId).toBe(MOREIRA_SALES_TENANT_ID);
    expect(mun.official.municipality).toBe("Moreira Sales");
    expect(mun.official.jurisdiction).toBe("municipal");
    expect(mun.official.status).toBe("vigente");
  });

  it("org sem vínculo municipal (município não confirmado) → sinaliza fixture existente, NÃO afirma ausência", () => {
    const { pkg, audit } = scoped("o que diz a legislação municipal de Moreira Sales sobre dispensa de licitação?", 5);
    expect(audit.corpusHasMunicipalFixture).toBe(true);
    expect(audit.municipalResolvedForTenant).toBe(false);
    expect(audit.municipalCorpusUnmatched).toBe(true);
    const answer = buildConsultationAnswer({
      tenantId: 5, userId: 1, question: "o que diz a legislação municipal de Moreira Sales sobre dispensa de licitação?",
      engineContent: "resposta", contextPackage: pkg, executionId: "e-mun", createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(answer.limitations.some(l => /normas municipais no acervo/i.test(l) && /município não confirmado/i.test(l))).toBe(true);
    // Nunca AFIRMA a ausência de normas municipais (o disclaimer nega a inexistência, não a afirma).
    const affirmaAusencia = /(n[ãa]o h[áa]|n[ãa]o existem|inexistem|nenhuma)\s+normas?\s+municip/i;
    expect(answer.limitations.some(l => affirmaAusencia.test(l))).toBe(false);
    expect([...answer.observations, answer.answer].some(t => affirmaAusencia.test(t))).toBe(false);
  });

  it("tenant de Moreira Sales (vínculo correto) recupera a norma municipal — sem flag de não-vínculo", () => {
    const { audit } = scoped("tratamento diferenciado para ME/EPP no meu município", MS);
    expect(audit.municipalResolvedForTenant).toBe(true);
    expect(audit.municipalCorpusUnmatched).toBe(false);
    expect(audit.includedNormIds).toContain("lei-municipal-769-2021-moreira-sales");
  });
});

describe("SOURCE-SCOPE-ROUTER-001 · roteamento mono-diploma preservado após as lacunas", () => {
  it("Lei 14.133 explícita continua restrita a essa lei (filtro SRP não afeta)", () => {
    const { audit, leiArts } = scoped("Qual artigo da Lei 14.133 trata da contratação direta?");
    expect(audit.includedNormIds).toEqual(["lei-14133-2021"]);
    expect(leiArts).toEqual(expect.arrayContaining(["Art. 72º", "Art. 73º", "Art. 74º", "Art. 75º"]));
  });
});

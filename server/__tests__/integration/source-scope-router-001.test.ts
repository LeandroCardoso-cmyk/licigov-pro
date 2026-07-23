/**
 * SOURCE-SCOPE-ROUTER-001 — Seleção determinística de fontes no "Tirar Dúvidas".
 *
 * Antes do retrieval, um roteador determinístico decide o escopo documental: quando a pergunta cita
 * um diploma, a 1ª busca fica RESTRITA a ele; fontes complementares (decretos/INs/jurisprudência/
 * normas municipais/outras leis) só entram quando o usuário pede, há remissão normativa, ou a 1ª
 * busca é insuficiente — no máximo UMA ampliação. Tudo é auditado (intenção, diploma, escopo, motivo
 * de expansão, fontes incluídas/descartadas) e replay-safe.
 */

import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { buildOfficialKnowledgeCorpus, MOREIRA_SALES_TENANT_ID, type OfficialCorpusBuildResult } from "../../services/officialCorpus/officialCorpusBuilder";
import { resolveInstitutionalContextPackage } from "../../services/institutionalIntegration/institutionalKnowledgeIntegration";
import { getIntegrationEvents, clearIntegrationEvents } from "../../services/institutionalIntegration/institutionalIntegrationObservabilityService";
import { decideSourceScope, detectIntent, detectRequestedDiplomas, classifyApplicability } from "../../domain/institutionalIntegration/sourceScopeRouter";
import { buildConsultationAnswer } from "../../domain/institutionalConsultation";
import {
  answerConsultation, getOfficialCorpus, listTenantHistory, getConsultationForTenant,
  getConsultationSources, replayConsultation,
} from "../../services/institutionalConsultationService";
import { InMemoryConsultationRepository, setConsultationRepository } from "../../services/institutionalConsultationRepository";

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

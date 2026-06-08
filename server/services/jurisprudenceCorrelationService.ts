import { createHash } from "crypto";
import {
  type JurisprudenceReference,
  type LegalCitation,
  createJurisprudenceReference,
  createLegalCitation,
  findRelevantPrecedents,
  rankPrecedentsByRelevance,
  buildCitationGraph,
  formatCitation,
} from "../domain/jurisprudenceReference";

export interface JurisprudenceCorrelationInput {
  organizationId: number;
  sessionId: string;
  documentContent?: string;
  query?: string;
  legalBasisRefs: string[];
  keywords?: string[];
}

export interface JurisprudenceCorrelationOutput {
  relevantReferences: Array<JurisprudenceReference & { relevanceScore: number }>;
  citations: LegalCitation[];
  citationGraph: Record<string, string[]>;
  formattedCitations: string[];
  correlationScore: number;
  processingMs: number;
  replayKey: string;
}

// Built-in corpus of mock Brazilian public procurement jurisprudence
function getBuiltInReferences(organizationId: number): JurisprudenceReference[] {
  return [
    createJurisprudenceReference({ organizationId, caseNumber: "Acórdão 2089/2021", court: "TCU", courtLevel: "superior", judgmentDate: "2021-09-15", summary: "Licitação dispensável deve ser formalmente justificada com pesquisa de preços e documentação adequada.", holdings: ["Dispensa exige justificativa formal", "Pesquisa de preços é obrigatória"], legalBasis: ["Lei 14133/2021 art. 72", "Lei 14133/2021 art. 74"], keywords: ["dispensa", "licitação", "justificativa", "pesquisa de preços"], precedentStrength: "binding" }),
    createJurisprudenceReference({ organizationId, caseNumber: "Acórdão 1472/2022", court: "TCU", courtLevel: "superior", judgmentDate: "2022-06-08", summary: "Termo de referência deve detalhar especificações técnicas suficientes para caracterizar o objeto.", holdings: ["TR deve ter especificações técnicas detalhadas", "Objeto deve ser claramente definido"], legalBasis: ["Lei 14133/2021 art. 6º inc. XXIII", "Lei 14133/2021 art. 40"], keywords: ["termo de referência", "especificações", "objeto", "detalhamento"], precedentStrength: "binding" }),
    createJurisprudenceReference({ organizationId, caseNumber: "Acórdão 876/2023", court: "TCU", courtLevel: "superior", judgmentDate: "2023-04-20", summary: "Contratos administrativos devem prever critérios objetivos de medição e pagamento.", holdings: ["Critérios de medição devem ser objetivos", "Pagamento vinculado à execução"], legalBasis: ["Lei 14133/2021 art. 92", "Lei 14133/2021 art. 140"], keywords: ["contrato", "medição", "pagamento", "critérios objetivos"], precedentStrength: "persuasive" }),
    createJurisprudenceReference({ organizationId, caseNumber: "Súmula TCU 177", court: "TCU", courtLevel: "superior", judgmentDate: "2006-06-28", summary: "Definição precisa e suficiente do objeto licitatório constitui regra indispensável da competição.", holdings: ["Objeto licitatório deve ser preciso e suficiente"], legalBasis: ["Lei 8666/1993 art. 14", "Lei 14133/2021 art. 22"], keywords: ["objeto", "licitação", "precisão", "definição"], precedentStrength: "binding" }),
  ];
}

const _correlationHistory = new Map<number, JurisprudenceCorrelationOutput[]>();

export function correlateJurisprudence(input: JurisprudenceCorrelationInput): JurisprudenceCorrelationOutput {
  const start = Date.now();
  const { organizationId, sessionId, legalBasisRefs, keywords = [] } = input;
  const documentContent = input.documentContent ?? input.query ?? "";

  const allReferences = getBuiltInReferences(organizationId);
  const contentKeywords = [...keywords, ...documentContent.toLowerCase().split(/\s+/).filter(w => w.length > 5).slice(0, 20)];
  const relevant = findRelevantPrecedents(allReferences, contentKeywords, legalBasisRefs);
  const ranked = rankPrecedentsByRelevance(relevant.length > 0 ? relevant : allReferences, documentContent);

  const sha256 = (x: string) => createHash("sha256").update(x, "utf8").digest("hex");

  const citations: LegalCitation[] = ranked.slice(0, 5).map(ref =>
    createLegalCitation({
      organizationId,
      sourceId: sessionId,
      referenceId: ref.id,
      citationType: ref.precedentStrength === "binding" ? "direct" : "analogical",
      relevanceScore: ref.relevanceScore,
      context: documentContent.slice(0, 150),
    })
  );

  const citationGraph = buildCitationGraph(citations);
  const formattedCitations = ranked.slice(0, 5).map(formatCitation);
  const correlationScore = ranked.length > 0
    ? ranked.slice(0, 5).reduce((sum, r) => sum + r.relevanceScore, 0) / Math.min(5, ranked.length)
    : 0;

  const replayKey = sha256(JSON.stringify({
    organizationId, sessionId,
    contentHash: sha256(documentContent),
    legalBasisRefs: [...legalBasisRefs].sort(),
  }));

  const output: JurisprudenceCorrelationOutput = {
    relevantReferences: ranked.slice(0, 10),
    citations,
    citationGraph,
    formattedCitations,
    correlationScore,
    processingMs: Date.now() - start,
    replayKey,
  };

  const existing = _correlationHistory.get(organizationId) ?? [];
  _correlationHistory.set(organizationId, [...existing, output]);
  return output;
}

export function getCorrelationHistory(organizationId: number): JurisprudenceCorrelationOutput[] {
  return _correlationHistory.get(organizationId) ?? [];
}

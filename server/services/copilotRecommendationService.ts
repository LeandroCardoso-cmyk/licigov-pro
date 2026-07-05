/**
 * Sprint 4.9 — Copilot Recommendation Service
 *
 * Constrói recomendações fundamentadas a partir do contexto (RAG + KG). Caminho
 * determinístico (grounding-only): deriva sugestões, riscos, alternativas e
 * fundamentação diretamente das evidências, sem depender do provider de IA.
 * Quando há inferência do provider, o texto entra como `summary`/`justification`.
 */

import type { CopilotType } from "../domain/institutionalCopilot";
import {
  createCopilotRecommendation,
  type CopilotRecommendation,
  type RecommendationKind,
  type RecommendationRisk,
  type RecommendationAlternative,
} from "../domain/copilotRecommendation";
import type { CopilotContext } from "./copilotContextEngineService";

/** Riscos-base sugeridos por domínio quando não há sinal específico nas evidências. */
const DOMAIN_BASE_RISK: Record<CopilotType, RecommendationRisk> = {
  agente_contratacao: { description: "Conformidade documental incompleta pode comprometer o processo.", severity: "medio", mitigation: "Revisar checklist da Lei 14.133/2021." },
  pregoeiro: { description: "Falhas na condução da sessão podem gerar nulidade.", severity: "alto", mitigation: "Seguir rito e registrar cada ato em ata." },
  planejamento: { description: "Planejamento insuficiente (DFD/ETP) gera contratação frágil.", severity: "alto", mitigation: "Fundamentar necessidade e alternativas no ETP." },
  tr_intelligence: { description: "Especificação restritiva pode direcionar a licitação.", severity: "alto", mitigation: "Usar CATMAT/CATSER e critérios objetivos." },
  juridico: { description: "Fundamentação legal frágil pode ser questionada.", severity: "alto", mitigation: "Ancorar em dispositivos vigentes e jurisprudência." },
  pesquisa_precos: { description: "Amostra de preços insuficiente distorce a estimativa.", severity: "medio", mitigation: "Ampliar fontes e documentar metodologia." },
  contratos: { description: "Aditivo sem justificativa técnica pode ser irregular.", severity: "medio", mitigation: "Motivar tecnicamente e verificar limites legais." },
  controle_interno: { description: "Controles insuficientes elevam o risco de integridade.", severity: "medio", mitigation: "Aplicar matriz de riscos e trilhas de auditoria." },
};

export function buildRecommendation(params: {
  organizationId: number;
  sessionId: string;
  copilotType: CopilotType;
  context: CopilotContext;
  kind?: RecommendationKind;
  reasoningText?: string;
  correlationId: string;
}): CopilotRecommendation {
  const { context, copilotType } = params;

  // Confiança: média das relevâncias das evidências (grounding), limitada a [0,1].
  const relevances = context.evidences.map(e => e.relevance);
  const avg = relevances.length > 0 ? relevances.reduce((a, b) => a + b, 0) / relevances.length : 0;
  const confidence = Math.max(0, Math.min(1, avg));

  // Sugestões derivadas das evidências mais relevantes.
  const suggestions = context.evidences
    .slice(0, 3)
    .map(e => `Considere: ${e.content}`);

  // Fundamentação legal a partir das referências do contexto.
  const legalBasis = context.legalRefs.map(ref => `${ref.lawRef} ${ref.article}`.trim());

  // Riscos: base do domínio + sinal de baixa fundamentação.
  const risks: RecommendationRisk[] = [DOMAIN_BASE_RISK[copilotType]];
  if (context.evidences.length === 0) {
    risks.push({
      description: "Nenhuma evidência institucional recuperada para fundamentar a resposta.",
      severity: "alto",
      mitigation: "Enriquecer a base institucional (RAG/Knowledge Graph) antes de decidir.",
    });
  }

  const alternatives: RecommendationAlternative[] = [
    {
      description: "Solicitar apoio de outro copiloto especializado para segunda perspectiva.",
      rationale: "Coordenação supervisionada aumenta a robustez da recomendação.",
    },
  ];

  const summary = params.reasoningText && params.reasoningText.trim().length > 0
    ? params.reasoningText.trim()
    : `Recomendação estruturada do ${copilotType} com base em ${context.evidences.length} evidência(s) e ${legalBasis.length} referência(s) legal(is).`;

  const justification = context.evidences.length > 0
    ? `Fundamentada em evidências institucionais (${context.evidences.map(e => e.source).slice(0, 3).join(", ")}) e na base legal recuperada.`
    : "Sem evidências institucionais suficientes — recomenda-se enriquecimento da base antes de qualquer decisão.";

  return createCopilotRecommendation({
    organizationId: params.organizationId,
    sessionId: params.sessionId,
    copilotType,
    kind: params.kind ?? "orientacao",
    summary,
    suggestions,
    risks,
    alternatives,
    justification,
    legalBasis,
    evidenceIds: context.evidences.map(e => e.id),
    confidence,
    correlationId: params.correlationId,
  });
}

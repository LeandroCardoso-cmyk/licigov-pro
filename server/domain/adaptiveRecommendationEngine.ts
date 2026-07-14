/**
 * SPRINT 5.X.X — Adaptive Recommendation Engine (Kernel)
 *
 * NOVA FILOSOFIA da camada adaptativa: o sistema NUNCA decide, NUNCA obriga,
 * NUNCA executa atos administrativos. Ele apenas ANALISA o contexto e RECOMENDA
 * o fluxo mais adequado, com fundamentação, base legal, nível de confiança e
 * alternativas. O servidor SEMPRE escolhe — recusar uma recomendação nunca
 * bloqueia o fluxo; apenas permite (opcionalmente) registrar justificativa.
 *
 * Determinístico e replay-safe (regras puras, sem LLM, sem Date.now/Math.random).
 */

import { createHash } from "crypto";

/** Etapas passíveis de recomendação em qualquer Business Domain. */
export type RecommendableStep =
  | "dfd"
  | "etp"
  | "pesquisa_precos"
  | "tr"
  | "edital"
  | "parecer_juridico"
  | "aditivo"
  | "apostilamento"
  | "publicacao"
  | "proposta";

export interface RecommendationContext {
  readonly step: RecommendableStep;
  readonly objeto?: string;
  readonly modalidade?: string;
  readonly valor?: number;
  /** Tipo do instrumento (ex.: aditivo "valor"/"prazo") quando aplicável. */
  readonly variant?: string;
  /** Configuração institucional do órgão (feature flags do cliente). */
  readonly orgConfig?: Record<string, boolean>;
}

export interface RecommendationOption {
  readonly option: string;
  readonly label: string;
}

export interface StepRecommendation {
  readonly step: RecommendableStep;
  /**
   * Análise da contratação/etapa (cabeçalho do fluxo orientador):
   * ANÁLISE → RECOMENDAÇÃO → MOTIVOS → BASE LEGAL → CONFIANÇA → ALTERNATIVAS → DECISÃO DO SERVIDOR.
   */
  readonly analysis: string;
  /** A recomendação (sim/não). NUNCA é uma obrigação. */
  readonly recommended: boolean;
  readonly title: string;
  readonly reasoning: string;
  readonly legalBasis: readonly string[];
  readonly confidence: number;
  readonly options: readonly RecommendationOption[];
  /** O servidor sempre pode recusar (nunca bloqueia). */
  readonly allowDecline: true;
  /** Ao recusar uma etapa recomendada, sugere-se registrar justificativa. */
  readonly requiresJustificationOnDecline: boolean;
  readonly provenance: string;
}

interface Rule {
  readonly title: string;
  readonly legalBasis: readonly string[];
  reasoning(ctx: RecommendationContext): string;
  recommended(ctx: RecommendationContext): boolean;
  confidence(ctx: RecommendationContext): number;
}

const YES_NO = (yes: string, no: string): RecommendationOption[] => [
  { option: "accept", label: yes },
  { option: "decline", label: no },
];

const RULES: Record<RecommendableStep, Rule> = {
  dfd: {
    title: "Documento de Formalização da Demanda (DFD)",
    legalBasis: ["Lei 14.133/2021, art. 12, §1º"],
    reasoning: () => "O DFD formaliza a demanda e dá origem ao planejamento da contratação, aumentando a rastreabilidade e a segurança jurídica.",
    recommended: () => true,
    confidence: () => 0.8,
  },
  etp: {
    title: "Estudo Técnico Preliminar (ETP)",
    legalBasis: ["Lei 14.133/2021, art. 18", "IN SEGES 58/2022"],
    reasoning: (ctx) => `O ETP evidencia a necessidade e a melhor solução para "${ctx.objeto ?? "o objeto"}", reduzindo riscos e fortalecendo a fundamentação. Não é obrigatório em todos os casos — a escolha é do servidor.`,
    recommended: () => true,
    confidence: (ctx) => (ctx.valor && ctx.valor > 0 ? 0.85 : 0.7),
  },
  pesquisa_precos: {
    title: "Pesquisa de Preços",
    legalBasis: ["Lei 14.133/2021, art. 23", "IN SEGES 65/2021"],
    reasoning: () => "A pesquisa de preços fundamenta o valor de referência e a economicidade da contratação.",
    recommended: (ctx) => ctx.variant !== "inexigibilidade",
    confidence: () => 0.82,
  },
  tr: {
    title: "Termo de Referência (TR)",
    legalBasis: ["Lei 14.133/2021, art. 6º, XXIII"],
    reasoning: () => "O TR define o objeto, as condições e as obrigações — peça central da contratação.",
    recommended: () => true,
    confidence: () => 0.9,
  },
  edital: {
    title: "Edital",
    legalBasis: ["Lei 14.133/2021, art. 25"],
    reasoning: (ctx) => `O edital consolida as regras da ${ctx.modalidade ?? "licitação"} e vincula a Administração e os licitantes.`,
    recommended: () => true,
    confidence: () => 0.9,
  },
  parecer_juridico: {
    title: "Parecer Jurídico",
    legalBasis: ["Lei 14.133/2021, art. 53"],
    reasoning: (ctx) => `A análise jurídica prévia ${ctx.variant === "valor" || ctx.variant === "quantitativo" ? "é especialmente recomendada em alterações de valor/quantitativo" : "reforça a segurança jurídica"} do ato.`,
    recommended: () => true,
    confidence: (ctx) => (ctx.variant === "valor" || ctx.variant === "quantitativo" ? 0.88 : 0.75),
  },
  aditivo: {
    title: "Termo Aditivo",
    legalBasis: ["Lei 14.133/2021, art. 124"],
    reasoning: () => "O aditivo formaliza alterações contratuais dentro dos limites legais.",
    recommended: () => true,
    confidence: () => 0.7,
  },
  apostilamento: {
    title: "Apostilamento",
    legalBasis: ["Lei 14.133/2021, art. 136"],
    reasoning: () => "O apostilamento registra alterações que dispensam termo aditivo (ex.: reajustes, alteração de gestor/fiscal).",
    recommended: () => true,
    confidence: () => 0.72,
  },
  publicacao: {
    title: "Publicação",
    legalBasis: ["Lei 14.133/2021, art. 54", "art. 94"],
    reasoning: () => "A publicação dá eficácia e transparência ao ato administrativo.",
    recommended: () => true,
    confidence: () => 0.85,
  },
  proposta: {
    title: "Recebimento de Propostas",
    legalBasis: ["Lei 14.133/2021, art. 75, §3º"],
    reasoning: () => "O recebimento de propostas amplia a competitividade e fundamenta a escolha.",
    recommended: (ctx) => ctx.variant !== "inexigibilidade",
    confidence: () => 0.7,
  },
};

/**
 * Produz uma RECOMENDAÇÃO (nunca uma decisão) para uma etapa, com fundamentação,
 * base legal, confiança e alternativas. O servidor sempre pode aceitar ou recusar.
 */
export function recommendStep(ctx: RecommendationContext): StepRecommendation {
  const rule = RULES[ctx.step];
  const recommended = rule.recommended(ctx);
  const contexto = [ctx.objeto && `objeto "${ctx.objeto}"`, ctx.modalidade && `modalidade ${ctx.modalidade}`, ctx.valor && `valor de referência`, ctx.variant && `tipo ${ctx.variant}`].filter(Boolean).join(", ");
  return {
    step: ctx.step,
    analysis: `Análise da contratação${contexto ? ` (${contexto})` : ""}: com base na legislação e no contexto informado, o sistema apresenta a recomendação a seguir. A decisão é sempre do servidor.`,
    recommended,
    title: rule.title,
    reasoning: rule.reasoning(ctx),
    legalBasis: rule.legalBasis,
    confidence: rule.confidence(ctx),
    options: recommended
      ? YES_NO(`Elaborar ${rule.title}`, `Não elaborar ${rule.title}`)
      : YES_NO(`Elaborar ${rule.title} mesmo assim`, `Seguir sem ${rule.title}`),
    allowDecline: true,
    requiresJustificationOnDecline: recommended,
    provenance: "adaptive_recommendation_engine:rules",
  };
}

export interface StepDecision {
  readonly step: RecommendableStep;
  readonly decision: "accepted" | "declined";
  readonly justification: string;
  readonly recommendationHash: string;
}

function recommendationHash(rec: StepRecommendation): string {
  return createHash("sha256")
    .update(`rec:${rec.step}:${rec.recommended}:${rec.confidence}`)
    .digest("hex").slice(0, 20);
}

/** O servidor aceita a recomendação. */
export function acceptRecommendation(rec: StepRecommendation): StepDecision {
  return { step: rec.step, decision: "accepted", justification: "", recommendationHash: recommendationHash(rec) };
}

/**
 * O servidor recusa a recomendação. NUNCA bloqueia o fluxo; apenas registra a
 * escolha e (quando a etapa era recomendada) a justificativa do servidor.
 */
export function declineRecommendation(rec: StepRecommendation, justification: string): StepDecision {
  return {
    step: rec.step,
    decision: "declined",
    justification: rec.requiresJustificationOnDecline ? (justification ?? "") : "",
    recommendationHash: recommendationHash(rec),
  };
}

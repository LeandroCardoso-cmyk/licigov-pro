/**
 * SPRINT 5.X.X — Business Domains: Filosofia consolidada
 *
 * O LiciGov Pro é uma CAMADA COGNITIVA E OPERACIONAL do departamento de licitações.
 * NÃO é um ERP. NÃO decide. NÃO obriga. NÃO executa atos administrativos. Apenas
 * analisa, recomenda, fundamenta, explica e apresenta alternativas — a decisão é
 * sempre do servidor. Este módulo codifica a Regra de Ouro e a guarda anti-ERP,
 * aplicáveis a TODOS os Business Domains, sem exceção. Determinístico.
 */

/** A "Regra de Ouro": toda funcionalidade deve responder SIM a estas perguntas. */
export const GOLDEN_RULE_QUESTIONS: readonly string[] = [
  "Reduz tempo operacional?",
  "Melhora a qualidade documental?",
  "Aumenta a segurança jurídica?",
  "Produz documentos oficiais ou participa diretamente da produção documental?",
  "Pertence ao departamento de licitações?",
];

/** Preocupações típicas de ERP — PROIBIDAS em qualquer Business Domain. */
export const ERP_FORBIDDEN_CONCERNS: readonly string[] = [
  "pagamentos",
  "financeiro",
  "empenhos",
  "empenho",
  "patrimonio",
  "almoxarifado",
  "folha",
  "execucao_orcamentaria",
  "controle_financeiro",
  "orcamento",
  "tesouraria",
  "contabilidade",
];

/** Remove acentos/diacríticos e normaliza para comparação determinística. */
function normalizeConcern(concern: string): string {
  return concern
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase().replace(/\s+/g, "_");
}

/** Verdadeiro se o termo descreve uma preocupação típica de ERP (proibida). */
export function isErpConcern(concern: string): boolean {
  const normalized = normalizeConcern(concern);
  return ERP_FORBIDDEN_CONCERNS.some(f => normalized === f || normalized.includes(f));
}

/** Lança se uma capacidade declarada for de ERP (barra features fora de escopo). */
export function assertNotErp(capability: string): void {
  if (isErpConcern(capability)) {
    throw new Error(`Capacidade "${capability}" é típica de ERP e está fora do escopo do LiciGov Pro.`);
  }
}

/** O que o sistema FAZ (nunca mais que isto). */
export const SYSTEM_CAPABILITIES: readonly string[] = [
  "analisar",
  "recomendar",
  "fundamentar",
  "explicar",
  "apresentar_alternativas",
];

/** O que o sistema NUNCA faz. */
export const SYSTEM_NON_CAPABILITIES: readonly string[] = [
  "decidir",
  "obrigar",
  "executar_atos_administrativos",
];

/**
 * Avalia uma funcionalidade contra a Regra de Ouro. Retorna se deve permanecer
 * no Production Ready Core ou ser movida para Future Evolution / removida (ERP).
 */
export function evaluateFeature(input: {
  reducesOperationalTime: boolean;
  improvesDocumentQuality: boolean;
  increasesLegalSecurity: boolean;
  producesOfficialDocuments: boolean;
  belongsToProcurement: boolean;
  isErpTypical: boolean;
}): { verdict: "keep" | "future_evolution" | "remove"; reasons: string[] } {
  const reasons: string[] = [];
  if (input.isErpTypical) {
    return { verdict: "remove", reasons: ["Funcionalidade típica de ERP — fora de escopo."] };
  }
  const positives = [
    input.reducesOperationalTime, input.improvesDocumentQuality, input.increasesLegalSecurity,
    input.producesOfficialDocuments, input.belongsToProcurement,
  ];
  const anyNo = positives.some(p => !p);
  if (anyNo) {
    reasons.push("Ao menos uma pergunta da Regra de Ouro foi respondida com NÃO.");
    return { verdict: "future_evolution", reasons };
  }
  return { verdict: "keep", reasons: ["Atende integralmente à Regra de Ouro."] };
}

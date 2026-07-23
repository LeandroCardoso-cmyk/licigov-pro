/**
 * SOURCE-SCOPE-ROUTER-001 — Roteador DETERMINÍSTICO de escopo documental (antes do retrieval).
 *
 * O "Tirar Dúvidas" recuperava, por padrão, TODAS as fontes aplicáveis (federal geral + executivo
 * federal + estadual + jurisprudência + municipal) para qualquer pergunta — mesmo quando o usuário
 * citava um diploma específico ou perguntava algo objetivamente respondível por uma única norma.
 * Isso trazia decretos/INs/jurisprudência/normas municipais como se fossem sempre pertinentes e, pior,
 * apresentava regras EXCLUSIVAS do SRP / restritas ao Executivo federal / condicionadas como se fossem
 * obrigações municipais gerais.
 *
 * Este módulo é PURO/DETERMINÍSTICO (sem IA, sem estado, sem I/O): dada a pergunta e os normIds
 * disponíveis no contexto institucional já resolvido, decide (1) a INTENÇÃO da consulta, (2) o(s)
 * diploma(s) citado(s) explicitamente, (3) o ESCOPO INICIAL de fontes (restrito ou irrestrito) e
 * (4) se a AMPLIAÇÃO para fontes complementares é solicitada pelo usuário. A decisão é serializável e
 * auditável; a mesma pergunta + mesmo conjunto de normas → mesma decisão (replay-safe).
 *
 * A EXPANSÃO efetiva (2ª busca ampliada, no máximo uma vez) e a APLICAÇÃO do filtro ocorrem na camada
 * de integração (institutionalKnowledgeIntegration) — este módulo apenas DECIDE.
 */

import type { OfficialDocument } from "../officialCorpus/officialDocument";

/** Classificação da intenção da consulta (para perguntas com ou sem diploma explícito). */
export type ConsultationIntent =
  | "normativa_objetiva"   // "qual artigo", "o que diz", "quando é cabível" — resposta de norma
  | "regulamentar"         // pede decreto/IN/regulamento/registro de preços (SRP)
  | "jurisprudencial"      // pede TCU/TCE/acórdão/prejulgado/entendimento/súmula
  | "municipal"            // pergunta situada no município ("meu município", prefeitura, Moreira Sales)
  | "operacional"          // "como fazer", passo a passo, modelo, checklist, prazo
  | "comparativa";         // diferença/versus/"em vez de"/8.666 vs 14.133

/** Categoria de aplicabilidade institucional de uma fonte (para não generalizar indevidamente). */
export type SourceApplicabilityCategory =
  | "norma_federal_geral"      // lei/lei complementar federal de aplicação geral (14.133, LC 123)
  | "norma_executivo_federal"  // decreto/IN do Executivo federal (regulamento — não é lei geral)
  | "norma_municipal"          // norma editada pelo próprio município
  | "jurisprudencia";          // manual/entendimento/prejulgado/orientação de Tribunal de Contas

export interface SourceApplicabilityInfo {
  readonly category: SourceApplicabilityCategory;
  /** Regra EXCLUSIVA do Sistema de Registro de Preços (não é obrigação geral). */
  readonly srpSpecific: boolean;
  /** Aplicável apenas à Administração Pública federal / Executivo federal (não vincula município por si só). */
  readonly federalOnly: boolean;
  /** Aplicável apenas sob condição (ex.: transferências da União; adoção municipal não confirmada). */
  readonly conditional: boolean;
}

export interface SourceScopeDecision {
  readonly intent: ConsultationIntent;
  /** normIds citados EXPLICITAMENTE na pergunta E presentes no contexto (nunca inventa fonte ausente). */
  readonly requestedDiplomas: readonly string[];
  /** Escopo da 1ª busca: lista de normIds permitidos, ou null = sem restrição (todas as aplicáveis). */
  readonly initialScopeNormIds: readonly string[] | null;
  /** O usuário pediu explicitamente fontes complementares (regulamentação/jurisprudência/TCE/municipal). */
  readonly expansionRequestedByUser: boolean;
  /** Ampliação é PERMITIDA (por pedido do usuário ou, na camada de integração, por insuficiência). */
  readonly allowExpansion: boolean;
  readonly reasoning: string;
}

// ── Normalização determinística (minúsculas, sem acentos) ─────────────────────────────────────────
function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Padrões de detecção de diploma → normId canônico. Só restringe para diplomas EFETIVAMENTE presentes
 * no contexto (o chamador passa `availableNormIds`). Diplomas citados mas ausentes do corpus (ex.: a
 * revogada Lei 8.666/93) NÃO viram restrição — a intenção cuida do roteamento nesses casos.
 */
interface DiplomaPattern { readonly normId: string; readonly patterns: readonly RegExp[]; }
const DIPLOMA_PATTERNS: readonly DiplomaPattern[] = [
  { normId: "lei-14133-2021", patterns: [/\b14\.?133\b/, /nova lei de licitac/, /lei geral de licitac/] },
  { normId: "lc-123-2006", patterns: [/\blei\s+complementar\s+n?o?\s*123\b/, /\blc\s*123\b/, /estatuto.*(microempresa|pequeno porte)/] },
  { normId: "decreto-11462-2023", patterns: [/\bdecreto\s+n?o?\s*11\.?462\b/, /\bd\s*11\.?462\b/] },
  { normId: "in-seges-65-2021", patterns: [/\binstruc[ãa]o\s+normativa\s+(seges\s*\/?\s*me\s+)?n?o?\s*65\b/, /\bin\s+(seges\s*\/?\s*me\s+)?n?o?\s*65\b/] },
  { normId: "lei-municipal-769-2021-moreira-sales", patterns: [/\blei\s+municipal\s+n?o?\s*769\b/, /\blei\s+n?o?\s*769\b/] },
  { normId: "prejulgado-27-tce-pr", patterns: [/\bprejulgado\s+n?o?\s*27\b/] },
];

/** Detecta os diplomas citados explicitamente que também existem no contexto. Determinístico, ordenado. */
export function detectRequestedDiplomas(question: string, availableNormIds: readonly string[]): string[] {
  const q = norm(question);
  const available = new Set(availableNormIds);
  const found = new Set<string>();
  for (const dp of DIPLOMA_PATTERNS) {
    if (!available.has(dp.normId)) continue;
    if (dp.patterns.some(p => p.test(q))) found.add(dp.normId);
  }
  return [...found].sort();
}

// ── Sinais lexicais de intenção (determinísticos) ────────────────────────────────────────────────
const RE_JURISPRUDENCIAL = /\btce\b|\btcu\b|jurisprud|ac[óo]rd[ãa]o|prejulgado|\bs[úu]mula\b|tribunal de contas|entendimento (do|da|dos|das)?\s*(trib|tce|tcu)/;
const RE_REGULAMENTAR = /decreto|regulament|instruc[ãa]o normativa|\bin\s+seges|registro de prec|\bsrp\b|\barp\b|\birp\b/;
const RE_MUNICIPAL = /municip|prefeitura|moreira sales|meu munic|nosso munic|na minha cidade/;
const RE_COMPARATIVA = /diferenc|\bversus\b|\bvs\b|em vez d|ao inv[ée]s d|\bou a lei\b|compar|8\.?666/;
const RE_OPERACIONAL = /como (fac[ao]|se faz|proceder|elaborar|montar|preencher|instruir)|passo a passo|\bmodelo\b|checklist|procedimento|fluxo/;

/**
 * Classifica a intenção da consulta por precedência determinística (a mais específica vence).
 * A ordem importa: uma pergunta que menciona TCE E cita a Lei 14.133 é primariamente jurisprudencial.
 */
export function detectIntent(question: string): ConsultationIntent {
  const q = norm(question);
  if (RE_JURISPRUDENCIAL.test(q)) return "jurisprudencial";
  if (RE_REGULAMENTAR.test(q)) return "regulamentar";
  if (RE_MUNICIPAL.test(q)) return "municipal";
  if (RE_COMPARATIVA.test(q)) return "comparativa";
  if (RE_OPERACIONAL.test(q)) return "operacional";
  return "normativa_objetiva";
}

/**
 * Classifica a aplicabilidade institucional de um documento oficial — usado para AUDITAR e para NÃO
 * apresentar uma regra federal/executiva/SRP/condicional como obrigação municipal geral. Determinístico,
 * derivado dos metadados oficiais (jurisdição, tipo, autoridade, normId).
 */
export function classifyApplicability(doc: OfficialDocument): SourceApplicabilityInfo {
  const isTribunalContas = /tribunal de contas|tce|tcu/i.test(doc.authority)
    || doc.documentType === "prejulgado" || doc.documentType === "orientacao_tecnica" || doc.documentType === "manual";
  if (isTribunalContas) {
    return { category: "jurisprudencia", srpSpecific: false, federalOnly: doc.jurisdiction === "federal", conditional: false };
  }
  if (doc.jurisdiction === "municipal") {
    return { category: "norma_municipal", srpSpecific: false, federalOnly: false, conditional: false };
  }
  if (doc.documentType === "decreto" || doc.documentType === "instrucao_normativa") {
    // Decreto 11.462/2023 regula o SRP; INs SEGES/ME e decretos federais vinculam a Adm. federal —
    // não constituem, por si sós, obrigação municipal (municípios podem editar regulamento próprio).
    const srpSpecific = doc.normId === "decreto-11462-2023";
    return { category: "norma_executivo_federal", srpSpecific, federalOnly: true, conditional: false };
  }
  // lei / lei_complementar / municipal_law(=municipal já tratado) federais de aplicação geral.
  return { category: "norma_federal_geral", srpSpecific: false, federalOnly: false, conditional: false };
}

export interface DecideSourceScopeInput {
  readonly question: string;
  readonly availableNormIds: readonly string[];
}

/**
 * Decide o escopo documental da 1ª busca. Regra central (SOURCE-SCOPE-ROUTER-001):
 * - Citou diploma presente no contexto → 1ª busca RESTRITA a ele (não puxa decreto/IN/jurisprudência/
 *   municipal/outras leis automaticamente).
 * - Não citou diploma → sem restrição (todas as aplicáveis), mas a intenção é registrada para auditoria.
 * - Ampliação é solicitada pelo usuário quando a intenção pede fontes complementares
 *   (regulamentar/jurisprudencial/municipal) OU quando há remissão normativa (comparativa entre normas).
 */
export function decideSourceScope(input: DecideSourceScopeInput): SourceScopeDecision {
  const intent = detectIntent(input.question);
  const requestedDiplomas = detectRequestedDiplomas(input.question, input.availableNormIds);
  const initialScopeNormIds = requestedDiplomas.length > 0 ? requestedDiplomas : null;

  // Usuário pediu explicitamente fontes complementares? (regulamentação, jurisprudência/TCE, âmbito
  // municipal) ou a pergunta é comparativa entre diplomas (remissão normativa necessária).
  const expansionRequestedByUser =
    intent === "regulamentar" || intent === "jurisprudencial" || intent === "municipal" || intent === "comparativa";

  const restricted = initialScopeNormIds !== null;
  const allowExpansion = restricted; // sem restrição, não há o que "ampliar" — já é escopo cheio

  const reasoning = restricted
    ? `Diploma(s) citado(s) explicitamente: ${requestedDiplomas.join(", ")}. 1ª busca restrita; intenção=${intent}` +
      `${expansionRequestedByUser ? "; ampliação solicitada pelo usuário" : "; ampliação apenas se insuficiente"}.`
    : `Nenhum diploma citado explicitamente. Escopo inicial completo; intenção classificada=${intent}.`;

  return { intent, requestedDiplomas, initialScopeNormIds, expansionRequestedByUser, allowExpansion, reasoning };
}

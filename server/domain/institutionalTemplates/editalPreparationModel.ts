/**
 * Modelo de PREPARAÇÃO do Edital institucional (ZERO_REENTRY) — classificação DETERMINÍSTICA de toda variável do catálogo.
 *
 * Cada variável do catálogo da revisão vinculada cai em exatamente UMA classe, por regra explícita (sem heurística, sem IA, sem
 * "manual por omissão"). A classe diz de onde o valor deve vir e se a pessoa precisa digitar:
 *
 *  CANONICAL         a autoridade já existe no domínio (processo, órgão, itens, orçamento, ciclo de vida): somente leitura + origem.
 *  ORG_PROFILE       POLICY/IDENTITY estáveis do órgão: registrados UMA vez (autoridade ORG existente) e reutilizados por todo processo.
 *  TR_PROJECTION     fonte TR: projetada quando houver dado ESTRUTURADO do TR oficial; senão pendência humana explicitamente identificada.
 *  PROCESS_DECISION  decisão genuína do certame: permanece editável (autoridade PROCESS existente).
 *  CONDITIONAL       `requiredWhen`: oculta enquanto a condição não estiver ativa (o backend segue sendo a autoridade final).
 *  POST_AWARD        `pos.*` / RESULT: nunca na preparação pré-certame ("a preencher").
 *
 * Nada aqui decide pela pessoa: projeção só existe onde há valor persistido numa autoridade; decisão jurídica/normativa nunca é
 * inferida por conveniência.
 */
import { PROJECTION_BY_VARIABLE, type ProjectionKey } from "./canonicalProjectionPolicy";
import { ROLE_VARIABLES, authorityEntryOf, type AuthorityClass, type EntryPoint } from "./editalAuthorityMatrix";
import { AUTHORITY_OWNED_PATHS, ORG_SCOPE_SOURCES, type GovernedScope } from "./governedSources";
import type { VariableCatalog2, VariableDef2 } from "./variableCatalog2";

export type PreparationClass = "CANONICAL" | "ORG_PROFILE" | "TR_PROJECTION" | "PROCESS_DECISION" | "CONDITIONAL" | "POST_AWARD";
export const PREPARATION_CLASSES: readonly PreparationClass[] = ["CANONICAL", "ORG_PROFILE", "TR_PROJECTION", "PROCESS_DECISION", "CONDITIONAL", "POST_AWARD"];

export { PROJECTION_BY_VARIABLE, type ProjectionKey, type ProjectionOrigin } from "./canonicalProjectionPolicy";

export interface VariableClassification {
  readonly name: string;
  readonly source: VariableDef2["source"];
  readonly path: string;
  readonly class: PreparationClass;
  /** Registro governado que guarda a decisão humana (ORG = perfil do órgão; PROCESS = processo); NONE = sem escrita humana. */
  readonly scope: GovernedScope | "NONE";
  /** Projeção determinística disponível (a classe pode exigir pendência humana quando o dado estruturado não existir). */
  readonly projection?: ProjectionKey;
  /** Regra que decidiu (auditável em teste e explicável na UI). */
  readonly rule: "POST_AWARD" | "AUTHORITY_OWNED" | "DOCUMENT_PIN" | "PROJECTION" | "REQUIRED_WHEN" | "ORG_SOURCE" | "TR_SOURCE" | "PROCESS_SOURCE" | "ORG_ROLE" | "TR_PARAM";
  /** Classe operacional da Authority Matrix (12 classes). Modelos fora da matriz derivam da classe de preparação. */
  readonly authority: AuthorityClass;
  /** Onde a pessoa informa o dado quando ele ainda não existe. */
  readonly entry: EntryPoint;
}

const isOwned = (v: VariableDef2): boolean => (AUTHORITY_OWNED_PATHS[v.source] ?? []).includes(v.path);
const isOrgSource = (s: VariableDef2["source"]): boolean => (ORG_SCOPE_SOURCES as readonly string[]).includes(s);

/** Escopo do registro humano de uma variável (por FONTE: o mesmo critério do `GovernedSourceService`). */
export const scopeOfSource = (source: VariableDef2["source"]): GovernedScope => (isOrgSource(source) ? "ORG" : "PROCESS");

export const PREPARATION_CLASSIFICATION_UNSUPPORTED = "PREPARATION_CLASSIFICATION_UNSUPPORTED";

/** Fonte/variável SEM política explícita de preparação: nunca vira decisão humana "por omissão". */
export class PreparationClassificationUnsupportedError extends Error {
  readonly code = PREPARATION_CLASSIFICATION_UNSUPPORTED;
  constructor(readonly variable: string, readonly source: string) {
    super(`${PREPARATION_CLASSIFICATION_UNSUPPORTED}: a variável ${variable} (fonte ${source}) não tem política explícita de preparação; defina-a em editalPreparationModel antes de usá-la`);
    this.name = "PreparationClassificationUnsupportedError";
  }
}

/** Fontes com política EXPLÍCITA. Qualquer outra (DFD/ETP/PARAMS ou uma fonte futura) falha fechado. */
const PROCESS_DECISION_SOURCES: readonly string[] = ["PROCESS", "ITEMS", "CERTAME_CONFIG", "NORMATIVE", "BUDGET", "LIFECYCLE"];

const FALLBACK_AUTHORITY: Readonly<Record<PreparationClass, AuthorityClass>> = {
  CANONICAL: "EXISTING_CANONICAL", ORG_PROFILE: "ORG_POLICY_PROFILE", TR_PROJECTION: "UPSTREAM_TR", PROCESS_DECISION: "TRUE_PROCESS_DECISION",
  CONDITIONAL: "CONDITIONAL", POST_AWARD: "POST_AWARD",
};
const FALLBACK_ENTRY: Readonly<Record<PreparationClass, EntryPoint>> = {
  CANONICAL: "NONE", ORG_PROFILE: "ORG_PROFILE", TR_PROJECTION: "PREPARATION", PROCESS_DECISION: "PREPARATION", CONDITIONAL: "PREPARATION", POST_AWARD: "NONE",
};

export function classifyVariable(v: VariableDef2): VariableClassification {
  const c = classifyBase(v);
  // Authority Matrix (CONTEXT_REUSE 2.0): papéis e parâmetros do TR mudam a CLASSE e a ENTRADA; o resto herda da matriz.
  const entry = authorityEntryOf(v.name);
  if (!entry) return { ...c, authority: FALLBACK_AUTHORITY[c.class], entry: FALLBACK_ENTRY[c.class] };
  if (c.class === "PROCESS_DECISION" || c.class === "ORG_PROFILE" || c.class === "TR_PROJECTION") {
    if (ROLE_VARIABLES[v.name]) return { ...c, class: "ORG_PROFILE", scope: "ORG", rule: "ORG_ROLE", authority: entry.cls, entry: entry.entry };
    if (entry.cls === "UPSTREAM_TR" && !c.projection) return { ...c, class: "TR_PROJECTION", scope: "PROCESS", rule: "TR_PARAM", authority: entry.cls, entry: entry.entry };
  }
  return { ...c, authority: entry.cls, entry: entry.entry };
}

function classifyBase(v: VariableDef2): Omit<VariableClassification, "authority" | "entry"> {
  const base = { name: v.name, source: v.source, path: v.path } as const;
  const projection = PROJECTION_BY_VARIABLE[v.name];
  if (v.name.startsWith("pos.") || v.source === "RESULT") return { ...base, class: "POST_AWARD", scope: "NONE", rule: "POST_AWARD" };
  if (v.type === "document_ref") return { ...base, class: "CANONICAL", scope: "NONE", rule: "DOCUMENT_PIN" };
  // EXAUSTIVO por fonte: nenhuma variável cai em PROCESS_DECISION por catch-all.
  const known = isOrgSource(v.source) || v.source === "TR" || PROCESS_DECISION_SOURCES.includes(v.source);
  if (!known) throw new PreparationClassificationUnsupportedError(v.name, String(v.source));
  if (isOwned(v)) return { ...base, class: "CANONICAL", scope: "NONE", rule: "AUTHORITY_OWNED" };
  if (projection && projection.key !== "TR_OBJECT") return { ...base, class: "CANONICAL", scope: scopeOfSource(v.source), projection: projection.key, rule: "PROJECTION" };
  if (projection) return { ...base, class: "TR_PROJECTION", scope: scopeOfSource(v.source), projection: projection.key, rule: "PROJECTION" };
  if (v.requiredWhen) return { ...base, class: "CONDITIONAL", scope: scopeOfSource(v.source), rule: "REQUIRED_WHEN" };
  if (isOrgSource(v.source)) return { ...base, class: "ORG_PROFILE", scope: "ORG", rule: "ORG_SOURCE" };
  if (v.source === "TR") return { ...base, class: "TR_PROJECTION", scope: "PROCESS", rule: "TR_SOURCE" };
  return { ...base, class: "PROCESS_DECISION", scope: "PROCESS", rule: "PROCESS_SOURCE" };
}

export function classifyCatalog(catalog: VariableCatalog2): readonly VariableClassification[] {
  return catalog.vars.map(classifyVariable);
}

/** UF (sigla) → nome por extenso. Tabela fechada; sigla desconhecida ⇒ sem projeção (nunca inventa). */
export const UF_EXTENSO: Readonly<Record<string, string>> = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba",
  PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
};

/** Texto curto de explicação por regra (UI "Origem"). */
export const RULE_LABEL: Readonly<Record<VariableClassification["rule"], string>> = {
  POST_AWARD: "Pós-homologação (a preencher depois)",
  AUTHORITY_OWNED: "Autoridade canônica do sistema",
  DOCUMENT_PIN: "Documento oficial fixado",
  PROJECTION: "Projeção determinística de dado estruturado",
  REQUIRED_WHEN: "Obrigatório apenas quando a condição estiver ativa",
  ORG_SOURCE: "Perfil institucional do órgão",
  TR_SOURCE: "Dado do TR (sem autoridade estruturada)",
  PROCESS_SOURCE: "Decisão do certame",
  ORG_ROLE: "Papel institucional do Perfil de Licitações",
  TR_PARAM: "Parâmetro estruturado do TR",
};

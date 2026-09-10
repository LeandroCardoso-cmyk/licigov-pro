/**
 * V1 PRE-PILOT CLOSURE — Fase A2 — Schema de AUTORIA ESTRUTURADA (Zod, domínio PURO).
 *
 * Contrato BOUNDED, versionado e validável do rascunho estruturado de ETP/TR. As seções canônicas
 * NÃO são inventadas: derivam das enumerações legais REAIS da Lei nº 14.133/2021 — o ETP das exigências
 * do art. 18, §1º; o TR do conteúdo do art. 6º, inciso XXIII. Cada seção carrega prosa cognitiva
 * (revisável) e referências jurídicas ESTRUTURADAS já validadas contra o corpus ANTES da renderização.
 *
 * A validação Zod é fail-closed: uma estrutura fora do contrato (seção desconhecida, prosa vazia numa
 * seção obrigatória, referência sem locator, tamanho excedido) NÃO é um rascunho válido → a autoria falha
 * e a proveniência A1 registra `failed` (nada é entregue como fundamentação plena).
 */

import { z } from "zod";
import type { GroundingState } from "../cognitiveProvenance";

export const AUTHORING_CONTRACT_VERSION = "authoring/1.0";

/** Limites RÍGIDOS (bounded authoring — custo/tamanho previsíveis, sem prosa ilimitada). */
export const AUTHORING_LIMITS = {
  maxSections: 16,
  maxProseChars: 8000,
  maxReferencesPerSection: 24,
  maxLimitations: 24,
  maxObjectChars: 500,
} as const;

// ─── Enumerações legais REAIS (Lei nº 14.133/2021) ────────────────────────────

/**
 * Seção canônica de autoria — chave estável + título + âncora legal REAL (não inventada).
 *
 * SEMÂNTICA JURÍDICA (art. 18, §2º da Lei 14.133/2021 para o ETP):
 *   - `mustProvide=true` → MÍNIMO LEGAL: a seção deve ser efetivamente PRODUZIDA (conteúdo), nunca
 *     apenas justificada como omitida;
 *   - `mustProvide=false` → seção prevista no modelo que PODE ser produzida OU omitida COM justificativa
 *     (ETP) / não aplicável COM justificativa (TR). Omissão SILENCIOSA (sem justificativa) → fail-closed.
 * TODAS as seções canônicas do tipo são SEMPRE representadas no rascunho (nenhuma omissão silenciosa).
 */
export interface CanonicalAuthoringSection {
  /** Chave estável e legível por máquina (ex.: "necessidade"). */
  readonly key: string;
  /** Título institucional da seção. */
  readonly title: string;
  /** Locator legal canônico da EXIGÊNCIA que fundamenta a seção (verificável no corpus). */
  readonly legalAnchor: string;
  /** Rótulo legível da âncora (ex.: "Art. 18, §1º, III"). */
  readonly legalAnchorLabel: string;
  /** MÍNIMO LEGAL: conteúdo efetivo obrigatório (não admite omissão com justificativa). */
  readonly mustProvide: boolean;
}

/**
 * ETP — TODOS os elementos do art. 18, §1º, da Lei nº 14.133/2021 (incisos I a XIII). Enumeração REAL.
 * Mínimos legais do §2º: I, IV, VI, VIII e XIII (conteúdo obrigatório). Os demais podem ser omitidos
 * com justificativa quando não contemplados.
 */
export const ETP_CANONICAL_SECTIONS: readonly CanonicalAuthoringSection[] = Object.freeze([
  { key: "necessidade", title: "Descrição da necessidade da contratação", legalAnchor: "lei-14133-2021:art-18:par-1:inc-i", legalAnchorLabel: "Art. 18, §1º, I", mustProvide: true },
  { key: "previsao_pca", title: "Demonstração da previsão no plano de contratações anual", legalAnchor: "lei-14133-2021:art-18:par-1:inc-ii", legalAnchorLabel: "Art. 18, §1º, II", mustProvide: false },
  { key: "requisitos", title: "Requisitos da contratação", legalAnchor: "lei-14133-2021:art-18:par-1:inc-iii", legalAnchorLabel: "Art. 18, §1º, III", mustProvide: false },
  { key: "estimativa_quantidades", title: "Estimativas das quantidades", legalAnchor: "lei-14133-2021:art-18:par-1:inc-iv", legalAnchorLabel: "Art. 18, §1º, IV", mustProvide: true },
  { key: "levantamento_mercado", title: "Levantamento de mercado e justificativa da escolha", legalAnchor: "lei-14133-2021:art-18:par-1:inc-v", legalAnchorLabel: "Art. 18, §1º, V", mustProvide: false },
  { key: "estimativa_valor", title: "Estimativa do valor da contratação", legalAnchor: "lei-14133-2021:art-18:par-1:inc-vi", legalAnchorLabel: "Art. 18, §1º, VI", mustProvide: true },
  { key: "descricao_solucao", title: "Descrição da solução como um todo", legalAnchor: "lei-14133-2021:art-18:par-1:inc-vii", legalAnchorLabel: "Art. 18, §1º, VII", mustProvide: false },
  { key: "parcelamento", title: "Justificativas para o parcelamento ou não da contratação", legalAnchor: "lei-14133-2021:art-18:par-1:inc-viii", legalAnchorLabel: "Art. 18, §1º, VIII", mustProvide: true },
  { key: "resultados_pretendidos", title: "Demonstrativo dos resultados pretendidos", legalAnchor: "lei-14133-2021:art-18:par-1:inc-ix", legalAnchorLabel: "Art. 18, §1º, IX", mustProvide: false },
  { key: "providencias_previas", title: "Providências prévias à celebração do contrato", legalAnchor: "lei-14133-2021:art-18:par-1:inc-x", legalAnchorLabel: "Art. 18, §1º, X", mustProvide: false },
  { key: "contratacoes_correlatas", title: "Contratações correlatas e/ou interdependentes", legalAnchor: "lei-14133-2021:art-18:par-1:inc-xi", legalAnchorLabel: "Art. 18, §1º, XI", mustProvide: false },
  { key: "impactos_ambientais", title: "Descrição de possíveis impactos ambientais e medidas mitigadoras", legalAnchor: "lei-14133-2021:art-18:par-1:inc-xii", legalAnchorLabel: "Art. 18, §1º, XII", mustProvide: false },
  { key: "viabilidade", title: "Posicionamento conclusivo sobre a viabilidade e razoabilidade", legalAnchor: "lei-14133-2021:art-18:par-1:inc-xiii", legalAnchorLabel: "Art. 18, §1º, XIII", mustProvide: true },
]);

/**
 * TR — TODAS as alíneas do art. 6º, inciso XXIII, da Lei nº 14.133/2021 (a a j). Enumeração REAL.
 * Todas devem ser REPRESENTADAS; um elemento concretamente não aplicável ao objeto exige justificativa
 * explícita (não aplicável com justificativa), nunca omissão silenciosa.
 */
export const TR_CANONICAL_SECTIONS: readonly CanonicalAuthoringSection[] = Object.freeze([
  { key: "objeto", title: "Definição do objeto", legalAnchor: "lei-14133-2021:art-6:inc-xxiii:al-a", legalAnchorLabel: "Art. 6º, XXIII, a", mustProvide: true },
  { key: "fundamentacao", title: "Fundamentação da contratação", legalAnchor: "lei-14133-2021:art-6:inc-xxiii:al-b", legalAnchorLabel: "Art. 6º, XXIII, b", mustProvide: true },
  { key: "descricao_solucao", title: "Descrição da solução como um todo", legalAnchor: "lei-14133-2021:art-6:inc-xxiii:al-c", legalAnchorLabel: "Art. 6º, XXIII, c", mustProvide: true },
  { key: "requisitos", title: "Requisitos da contratação", legalAnchor: "lei-14133-2021:art-6:inc-xxiii:al-d", legalAnchorLabel: "Art. 6º, XXIII, d", mustProvide: true },
  { key: "modelo_execucao", title: "Modelo de execução do objeto", legalAnchor: "lei-14133-2021:art-6:inc-xxiii:al-e", legalAnchorLabel: "Art. 6º, XXIII, e", mustProvide: true },
  { key: "modelo_gestao", title: "Modelo de gestão do contrato", legalAnchor: "lei-14133-2021:art-6:inc-xxiii:al-f", legalAnchorLabel: "Art. 6º, XXIII, f", mustProvide: false },
  { key: "medicao_pagamento", title: "Critérios de medição e de pagamento", legalAnchor: "lei-14133-2021:art-6:inc-xxiii:al-g", legalAnchorLabel: "Art. 6º, XXIII, g", mustProvide: false },
  { key: "selecao_fornecedor", title: "Forma e critérios de seleção do fornecedor", legalAnchor: "lei-14133-2021:art-6:inc-xxiii:al-h", legalAnchorLabel: "Art. 6º, XXIII, h", mustProvide: true },
  { key: "estimativa_valor", title: "Estimativas do valor da contratação", legalAnchor: "lei-14133-2021:art-6:inc-xxiii:al-i", legalAnchorLabel: "Art. 6º, XXIII, i", mustProvide: true },
  { key: "adequacao_orcamentaria", title: "Adequação orçamentária", legalAnchor: "lei-14133-2021:art-6:inc-xxiii:al-j", legalAnchorLabel: "Art. 6º, XXIII, j", mustProvide: true },
]);

/** Conjunto canônico de seções por tipo de documento (fonte da verdade do contrato). */
export function canonicalSectionsFor(kind: "etp" | "tr"): readonly CanonicalAuthoringSection[] {
  return kind === "tr" ? TR_CANONICAL_SECTIONS : ETP_CANONICAL_SECTIONS;
}

const CANONICAL_KEYS: Record<"etp" | "tr", ReadonlySet<string>> = {
  etp: new Set(ETP_CANONICAL_SECTIONS.map((s) => s.key)),
  tr: new Set(TR_CANONICAL_SECTIONS.map((s) => s.key)),
};

// ─── Schema Zod (bounded) ─────────────────────────────────────────────────────

/** Referência jurídica ESTRUTURADA já validada contra o corpus (existe + status temporal permite). */
export const AuthoredLegalReferenceSchema = z.object({
  /** normId da fonte no corpus (ex.: "lei-14133-2021"). */
  sourceId: z.string().min(1).max(120),
  /** Locator canônico estável (ex.: "lei-14133-2021:art-18"). */
  locatorId: z.string().min(1).max(240),
  /** Rótulo legível (ex.: "Lei nº 14.133/2021 — Art. 18"). */
  display: z.string().min(1).max(240),
  /** Status temporal da fonte no corpus (deve ser vigente/parcialmente_vigente para fundamentar). */
  status: z.string().min(1).max(48),
});
export type AuthoredLegalReference = z.infer<typeof AuthoredLegalReferenceSchema>;

/**
 * Modo de conteúdo da seção (semântica jurídica):
 *   - `provided` → conteúdo efetivo (prosa não-vazia);
 *   - `omitted_with_justification` (ETP) → elemento não mínimo NÃO contemplado, COM justificativa;
 *   - `not_applicable_with_justification` (TR) → elemento concretamente não aplicável, COM justificativa.
 */
export const CONTENT_MODES = ["provided", "omitted_with_justification", "not_applicable_with_justification"] as const;
export type ContentMode = (typeof CONTENT_MODES)[number];

/** Seção autorada (título canônico + modo de conteúdo + prosa/justificativa + referências estruturadas). */
export const AuthoredSectionSchema = z.object({
  key: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  legalAnchorLabel: z.string().min(1).max(120),
  /** Modo de conteúdo (produzido × omitido/não-aplicável com justificativa). */
  contentMode: z.enum(CONTENT_MODES),
  /** Prosa cognitiva (rascunho revisável). Bounded. Vazia quando o modo é omissão/não-aplicabilidade. */
  prose: z.string().max(AUTHORING_LIMITS.maxProseChars),
  /** Justificativa de omissão/não-aplicabilidade (obrigatória quando NÃO é `provided`). */
  omissionJustification: z.string().max(AUTHORING_LIMITS.maxProseChars),
  /** Esta seção está factualmente aterrada em evidência real (só quando `provided`)? */
  grounded: z.boolean(),
  legalReferences: z.array(AuthoredLegalReferenceSchema).max(AUTHORING_LIMITS.maxReferencesPerSection),
});
export type AuthoredSection = z.infer<typeof AuthoredSectionSchema>;

// Estado de fundamentação FACTUAL exposto no rascunho (união real da A1). Os estados degradados de
// EXECUÇÃO (grounding_unavailable/failed) não são um grounding_state — são alimentados à proveniência
// A1 (ExecutionStatus) pelo próprio boundary cognitivo, ou resultam em fail-closed na autoria.
const GROUNDING_STATES = [
  "grounded", "partially_grounded", "ungrounded", "not_applicable",
] as const satisfies readonly GroundingState[];

/** Rascunho estruturado completo (ETP/TR) — contrato bounded e versionado. */
export const StructuredAuthoringSchema = z.object({
  contract: z.literal(AUTHORING_CONTRACT_VERSION),
  kind: z.enum(["etp", "tr"]),
  object: z.string().min(1).max(AUTHORING_LIMITS.maxObjectChars),
  sections: z.array(AuthoredSectionSchema).min(1).max(AUTHORING_LIMITS.maxSections),
  groundingState: z.enum(GROUNDING_STATES),
  evidenceCount: z.number().int().min(0),
  evidenceComplete: z.boolean(),
  usedSourceIds: z.array(z.string().min(1)).max(64),
  /** Fingerprint das evidências REALMENTE usadas (null quando não há evidência). */
  evidenceFingerprint: z.string().min(1).nullable(),
  /** Fingerprint determinístico do corpus (lineage/reprodutibilidade). */
  corpusFingerprint: z.string().min(1),
  /** Limitações honestas (fundamentação parcial/ausente, contradição, citação não verificada removida). */
  limitations: z.array(z.string().min(1)).max(AUTHORING_LIMITS.maxLimitations),
  /** Aviso OBRIGATÓRIO de revisão humana (nunca "juridicamente correto/aprovado"). */
  reviewNotice: z.string().min(1).max(400),
});
export type StructuredAuthoring = z.infer<typeof StructuredAuthoringSchema>;

/** Erro de contrato de autoria — fail-closed (estrutura fora do contrato NÃO é rascunho válido). */
export class AuthoringContractError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Autoria estruturada inválida (fail-closed): ${issues.join("; ")}`);
    this.name = "AuthoringContractError";
    this.issues = issues;
  }
}

/**
 * Valida a estrutura contra o contrato Zod E contra as seções canônicas legais do tipo (nenhuma seção
 * inventada; toda seção OBRIGATÓRIA presente e com prosa não-vazia). Fail-closed. Retorna o objeto
 * congelado quando válido; lança `AuthoringContractError` caso contrário.
 */
export function validateStructuredAuthoring(candidate: unknown): StructuredAuthoring {
  const parsed = StructuredAuthoringSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new AuthoringContractError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const doc = parsed.data;
  const issues: string[] = [];
  const allowed = CANONICAL_KEYS[doc.kind];
  const seen = new Set<string>();
  for (const s of doc.sections) {
    if (!allowed.has(s.key)) issues.push(`seção não-canônica "${s.key}" para ${doc.kind} (seção legal inexistente)`);
    if (seen.has(s.key)) issues.push(`seção duplicada "${s.key}"`);
    seen.add(s.key);
  }
  // TODA seção canônica do tipo deve estar REPRESENTADA (nenhuma omissão silenciosa).
  for (const canon of canonicalSectionsFor(doc.kind)) {
    const found = doc.sections.find((s) => s.key === canon.key);
    if (!found) { issues.push(`seção canônica ausente (não representada): "${canon.key}"`); continue; }
    if (canon.mustProvide) {
      // MÍNIMO LEGAL: conteúdo efetivo obrigatório — nunca omitido com justificativa.
      if (found.contentMode !== "provided") issues.push(`mínimo legal "${canon.key}" (${canon.legalAnchorLabel}) não pode ser omitido/justificado — exige conteúdo`);
      else if (found.prose.trim().length === 0) issues.push(`mínimo legal "${canon.key}" sem conteúdo`);
    } else if (found.contentMode === "provided") {
      if (found.prose.trim().length === 0) issues.push(`seção "${canon.key}" marcada como produzida, mas sem conteúdo`);
    } else {
      // Omitida/não-aplicável → JUSTIFICATIVA obrigatória (não inventar; fail-closed se ausente).
      if (found.omissionJustification.trim().length === 0) issues.push(`seção "${canon.key}" omitida/não-aplicável SEM justificativa`);
    }
  }
  if (issues.length > 0) throw new AuthoringContractError(issues);
  return Object.freeze(doc);
}

// ─── Contrato do OUTPUT ESTRUTURADO do PROVIDER (Gap 1) ───────────────────────

/** Referência jurídica declarada PELO PROVIDER (texto livre) — validada depois contra o corpus. */
export const ProviderLegalRefSchema = z.object({
  /** Rótulo estrutural citado (ex.: "Art. 18, §1º, IX" | "Art. 6º, XXIII, a"). */
  identifier: z.string().min(1).max(160),
  /** Diploma citado em texto (ex.: "Lei nº 14.133/2021"); opcional. */
  diploma: z.string().max(160).optional(),
});

/** Preenchimento de UMA seção produzido pelo provider (key restrita às canônicas; prose bounded). */
export const ProviderSectionFillSchema = z.object({
  key: z.string().min(1).max(80),
  /** Modo declarado pelo provider (default `provided`). Omissão/não-aplicabilidade exige justificativa. */
  contentMode: z.enum(CONTENT_MODES).optional().default("provided"),
  prose: z.string().max(AUTHORING_LIMITS.maxProseChars).optional().default(""),
  omissionJustification: z.string().max(AUTHORING_LIMITS.maxProseChars).optional().default(""),
  legalReferences: z.array(ProviderLegalRefSchema).max(AUTHORING_LIMITS.maxReferencesPerSection).optional().default([]),
  limitations: z.array(z.string().min(1)).max(AUTHORING_LIMITS.maxLimitations).optional().default([]),
});
export type ProviderSectionFill = z.infer<typeof ProviderSectionFillSchema>;

/** Envelope estruturado que o PROVIDER deve retornar (uma chamada por documento). */
export const ProviderAuthoringOutputSchema = z.object({
  sections: z.array(ProviderSectionFillSchema).min(1).max(AUTHORING_LIMITS.maxSections),
});
export type ProviderAuthoringOutput = z.infer<typeof ProviderAuthoringOutputSchema>;

/**
 * Faz o PARSE GOVERNADO do output estruturado do provider (JSON) e valida contra o contrato + a
 * autoridade do servidor (keys canônicas do tipo; sem seção desconhecida; sem duplicata). Fail-closed:
 * JSON inválido, seção desconhecida, duplicada, prose acima do limite ou referência malformada → lança
 * `AuthoringContractError`. NÃO usa regex frágil — usa JSON.parse + Zod (mecanismo estruturado).
 */
export function parseProviderAuthoringOutput(kind: "etp" | "tr", rawText: string): ProviderAuthoringOutput {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new AuthoringContractError(["output do provider não é JSON estruturado válido"]);
  }
  const parsed = ProviderAuthoringOutputSchema.safeParse(json);
  if (!parsed.success) {
    throw new AuthoringContractError(parsed.error.issues.map((i) => `provider.${i.path.join(".")}: ${i.message}`));
  }
  const allowed = CANONICAL_KEYS[kind];
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const s of parsed.data.sections) {
    if (!allowed.has(s.key)) issues.push(`provider retornou seção não-canônica "${s.key}" para ${kind}`);
    if (seen.has(s.key)) issues.push(`provider retornou seção duplicada "${s.key}"`);
    seen.add(s.key);
  }
  // O provider DEVE REPRESENTAR TODAS as seções canônicas (nenhuma omissão silenciosa).
  for (const canon of canonicalSectionsFor(kind)) {
    if (!seen.has(canon.key)) issues.push(`provider não representou a seção canônica "${canon.key}" (${canon.legalAnchorLabel})`);
  }
  if (issues.length > 0) throw new AuthoringContractError(issues);
  return parsed.data;
}

/**
 * Constrói o JSON Schema (responseSchema) que o provider DEVE conformar — restringe `key` ao enum das
 * seções canônicas do tipo (o provider NÃO pode escolher novas seções). Enviado ao adapter/Kernel.
 */
export function buildAuthoringResponseSchema(kind: "etp" | "tr"): { name: string; schema: Record<string, unknown> } {
  const keys = canonicalSectionsFor(kind).map((s) => s.key);
  return {
    name: `authoring_${kind}`,
    schema: {
      type: "object",
      properties: {
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              key: { type: "string", enum: keys },
              contentMode: { type: "string", enum: [...CONTENT_MODES] },
              prose: { type: "string" },
              omissionJustification: { type: "string" },
              legalReferences: {
                type: "array",
                items: {
                  type: "object",
                  properties: { identifier: { type: "string" }, diploma: { type: "string" } },
                  required: ["identifier"],
                },
              },
              limitations: { type: "array", items: { type: "string" } },
            },
            required: ["key", "contentMode"],
          },
        },
      },
      required: ["sections"],
    },
  };
}

/** Lista ordenada de keys canônicas do tipo (autoridade do servidor). */
export function canonicalKeysFor(kind: "etp" | "tr"): string[] {
  return canonicalSectionsFor(kind).map((s) => s.key);
}

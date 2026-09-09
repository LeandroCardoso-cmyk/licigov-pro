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

/** Seção canônica de autoria — chave estável + título + âncora legal REAL (não inventada). */
export interface CanonicalAuthoringSection {
  /** Chave estável e legível por máquina (ex.: "necessidade"). */
  readonly key: string;
  /** Título institucional da seção. */
  readonly title: string;
  /** Locator legal canônico da EXIGÊNCIA que fundamenta a seção (verificável no corpus). */
  readonly legalAnchor: string;
  /** Rótulo legível da âncora (ex.: "Art. 18, §1º, III"). */
  readonly legalAnchorLabel: string;
  /** A seção é obrigatória no contrato (prosa não-vazia exigida)? */
  readonly required: boolean;
}

/**
 * ETP — exigências do art. 18, §1º, da Lei nº 14.133/2021 (incisos I a XIII). Enumeração REAL:
 * cada seção corresponde a um inciso legal existente, não a uma seção fabricada.
 */
export const ETP_CANONICAL_SECTIONS: readonly CanonicalAuthoringSection[] = Object.freeze([
  { key: "necessidade", title: "Descrição da necessidade da contratação", legalAnchor: "lei-14133-2021:art-18", legalAnchorLabel: "Art. 18, §1º, I", required: true },
  { key: "requisitos", title: "Requisitos da contratação", legalAnchor: "lei-14133-2021:art-18", legalAnchorLabel: "Art. 18, §1º, III", required: true },
  { key: "estimativa_quantidades", title: "Estimativa das quantidades", legalAnchor: "lei-14133-2021:art-18", legalAnchorLabel: "Art. 18, §1º, IV", required: true },
  { key: "levantamento_mercado", title: "Levantamento de mercado e justificativa da escolha", legalAnchor: "lei-14133-2021:art-18", legalAnchorLabel: "Art. 18, §1º, V", required: true },
  { key: "estimativa_valor", title: "Estimativa do valor da contratação", legalAnchor: "lei-14133-2021:art-18", legalAnchorLabel: "Art. 18, §1º, VI", required: true },
  { key: "descricao_solucao", title: "Descrição da solução como um todo", legalAnchor: "lei-14133-2021:art-18", legalAnchorLabel: "Art. 18, §1º, VII", required: true },
  { key: "parcelamento", title: "Justificativa do parcelamento ou não", legalAnchor: "lei-14133-2021:art-18", legalAnchorLabel: "Art. 18, §1º, VIII", required: false },
  { key: "resultados_pretendidos", title: "Demonstrativo dos resultados pretendidos", legalAnchor: "lei-14133-2021:art-18", legalAnchorLabel: "Art. 18, §1º, IX", required: false },
  { key: "viabilidade", title: "Posicionamento conclusivo sobre a viabilidade", legalAnchor: "lei-14133-2021:art-18", legalAnchorLabel: "Art. 18, §1º, XIII", required: true },
]);

/**
 * TR — conteúdo do art. 6º, inciso XXIII, da Lei nº 14.133/2021 (alíneas a a j). Enumeração REAL.
 */
export const TR_CANONICAL_SECTIONS: readonly CanonicalAuthoringSection[] = Object.freeze([
  { key: "objeto", title: "Definição do objeto", legalAnchor: "lei-14133-2021:art-6", legalAnchorLabel: "Art. 6º, XXIII, a", required: true },
  { key: "fundamentacao", title: "Fundamentação da contratação", legalAnchor: "lei-14133-2021:art-6", legalAnchorLabel: "Art. 6º, XXIII, b", required: true },
  { key: "descricao_solucao", title: "Descrição da solução como um todo", legalAnchor: "lei-14133-2021:art-6", legalAnchorLabel: "Art. 6º, XXIII, c", required: true },
  { key: "requisitos", title: "Requisitos da contratação", legalAnchor: "lei-14133-2021:art-6", legalAnchorLabel: "Art. 6º, XXIII, d", required: true },
  { key: "modelo_execucao", title: "Modelo de execução do objeto", legalAnchor: "lei-14133-2021:art-6", legalAnchorLabel: "Art. 6º, XXIII, e", required: true },
  { key: "modelo_gestao", title: "Modelo de gestão do contrato", legalAnchor: "lei-14133-2021:art-6", legalAnchorLabel: "Art. 6º, XXIII, f", required: false },
  { key: "medicao_pagamento", title: "Critérios de medição e de pagamento", legalAnchor: "lei-14133-2021:art-6", legalAnchorLabel: "Art. 6º, XXIII, g", required: false },
  { key: "selecao_fornecedor", title: "Forma e critérios de seleção do fornecedor", legalAnchor: "lei-14133-2021:art-6", legalAnchorLabel: "Art. 6º, XXIII, h", required: true },
  { key: "estimativa_valor", title: "Estimativas do valor da contratação", legalAnchor: "lei-14133-2021:art-6", legalAnchorLabel: "Art. 6º, XXIII, i", required: true },
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

/** Seção autorada (título canônico + prosa revisável + referências estruturadas). */
export const AuthoredSectionSchema = z.object({
  key: z.string().min(1).max(80),
  title: z.string().min(1).max(200),
  legalAnchorLabel: z.string().min(1).max(120),
  /** Prosa cognitiva (rascunho revisável). Bounded. Pode ser vazia em seção OPCIONAL. */
  prose: z.string().max(AUTHORING_LIMITS.maxProseChars),
  /** Esta seção está factualmente aterrada em evidência real? */
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
  // Toda seção OBRIGATÓRIA do tipo deve estar presente e com prosa não-vazia.
  for (const canon of canonicalSectionsFor(doc.kind)) {
    if (!canon.required) continue;
    const found = doc.sections.find((s) => s.key === canon.key);
    if (!found) { issues.push(`seção obrigatória ausente: "${canon.key}"`); continue; }
    if (found.prose.trim().length === 0) issues.push(`seção obrigatória sem conteúdo: "${canon.key}"`);
  }
  if (issues.length > 0) throw new AuthoringContractError(issues);
  return Object.freeze(doc);
}

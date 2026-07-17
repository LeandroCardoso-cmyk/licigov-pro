/**
 * RC-4.8 — Institutional Knowledge Pipeline · Quality Gates (Fase 4).
 *
 * Gates OBRIGATÓRIOS: nenhum corpus é publicado se coverage < 100% (blocos recomendados),
 * binding inconsistente, explainability ausente, referências inválidas, relacionamentos quebrados
 * ou versionamento inválido. Determinístico. Sem conteúdo jurídico.
 */

import type { KnowledgeDocument } from "../knowledgeDocument";
import { allBlocks } from "../knowledgeDocument";
import { computeCompleteness } from "../knowledgeQuality";

export type QualityGateId =
  | "coverage" | "binding_consistency" | "explainability" | "references" | "relationships" | "versioning";

export interface GateFailure {
  readonly gate: QualityGateId;
  readonly detail: string;
}
export interface QualityGateResult {
  readonly passed: boolean;
  readonly failures: readonly GateFailure[];
  /** Cobertura calculada (0..1) — 1.0 significa todos os blocos recomendados presentes. */
  readonly coverage: number;
}

/**
 * Perfil de gate. "general" (padrão) = documentos institucionais gerais (exige blocos recomendados).
 * "official_norm" = documento oficial/normativo verbatim (RC-4.9): SEM resumos/interpretações —
 * a cobertura é satisfeita por texto oficial (OfficialText) + Explainability (origem factual).
 */
export type QualityProfile = "general" | "official_norm";

export interface GateInputs {
  readonly document: KnowledgeDocument;
  readonly bindingConsistent?: boolean;
  readonly profile?: QualityProfile;
}

const SEMVER = /^\d+\.\d+\.\d+$/;

/** Avalia todos os gates obrigatórios. Publicação só é permitida se `passed === true`. */
export function evaluateQualityGates(inputs: GateInputs): QualityGateResult {
  const { document } = inputs;
  const failures: GateFailure[] = [];
  const blocks = allBlocks(document);
  const profile: QualityProfile = inputs.profile ?? "general";

  // Coverage: depende do perfil.
  const completeness = computeCompleteness(document);
  let coverageScore = completeness.score;
  if (profile === "official_norm") {
    // Documento oficial verbatim: cobertura = presença de texto oficial + explainability (origem).
    const hasOfficial = blocks.some(b => b.kind === "OfficialText") && blocks.some(b => b.kind === "Explainability");
    coverageScore = hasOfficial ? 1 : 0;
    if (!hasOfficial) failures.push({ gate: "coverage", detail: "Documento oficial requer OfficialTextBlock + ExplainabilityBlock." });
  } else if (completeness.score < 1) {
    failures.push({ gate: "coverage", detail: `Cobertura ${Math.round(completeness.score * 100)}% (<100%): faltam ${completeness.missingRecommended.join(", ")}.` });
  }

  // Binding consistency (sinalizado pelo contexto; padrão consistente).
  if (inputs.bindingConsistent === false) {
    failures.push({ gate: "binding_consistency", detail: "Binding inconsistente." });
  }

  // Explainability: deve existir bloco Explainability.
  if (!blocks.some(b => b.kind === "Explainability")) {
    failures.push({ gate: "explainability", detail: "Bloco Explainability ausente." });
  }

  // Referências válidas: precisam ter tipo e destino.
  for (const r of document.references) {
    if (!r.to || !r.type) failures.push({ gate: "references", detail: `Referência inválida: ${r.id}.` });
  }

  // Relacionamentos: força em [0,1] e explicação presente.
  for (const rel of document.relationships) {
    if (rel.strength < 0 || rel.strength > 1 || !rel.explanation) {
      failures.push({ gate: "relationships", detail: `Relacionamento quebrado: ${rel.id}.` });
    }
  }

  // Versionamento válido: revisão >= 1 e semver bem-formado.
  if (document.revision < 1 || !SEMVER.test(document.semver)) {
    failures.push({ gate: "versioning", detail: `Versionamento inválido (rev ${document.revision}, semver ${document.semver}).` });
  }

  return { passed: failures.length === 0, failures, coverage: coverageScore };
}

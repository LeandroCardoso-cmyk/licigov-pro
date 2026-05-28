/**
 * Sprint 2.95 — Candidate Explainability.
 *
 * Explainability completa para cada candidato semântico.
 * Fornece raciocínio legível por humanos sobre por que um candidato foi sugerido,
 * ranqueado e (se rejeitado) por que perdeu para o vencedor.
 *
 * PRINCÍPIO: todo candidato deve ter uma explicação que um auditor não-técnico
 * possa entender. Conformidade com princípio da transparência (Lei 14.133/2021).
 */

import { nanoid } from "nanoid";
import type { SemanticCandidate } from "./semanticCandidate";
import type { CandidateConsensus } from "./candidateConsensus";
import type { ExtractionEvidence } from "./extractionEvidence";
import { parserCapabilityRegistry } from "./parserCapabilities";
import type { ParserType } from "./importTypes";
import { scoreToLevel } from "./importConfidence";

// ─── Explainability aggregate ─────────────────────────────────────────────────

export interface ParserInfluence {
  parserType:              string;
  confidenceContribution:  number;  // 0–1
  note:                    string;
}

export interface NormalizationInfluence {
  unitMatch:       string | null;
  unitSource:      string | null;
  quantityParsed:  boolean;
  note:            string;
}

export interface SemanticInfluence {
  indexScore:    number;
  matchStrategy: string;
  topTokens:     string[];
}

export interface CandidateExplainability {
  id:                    string;
  candidateId:           string;
  stagingItemId:         string;
  organizationId:        number;

  // Por que foi sugerido
  whySuggested:          string;

  // Por que ficou na posição que ficou
  whyRanked:             string;

  // Por que foi rejeitado (null se não foi rejeitado)
  whyRejected:           string | null;

  // Tokens que influenciaram o match
  influencingTokens:     string[];

  // Aliases utilizados no match
  aliasesUsed:           string[];

  // Influências detalhadas
  parserInfluence:       ParserInfluence;
  normalizationInfluence: NormalizationInfluence;
  semanticInfluence:     SemanticInfluence;

  // Racionais textuais
  rankingRationale:      string;
  consensusRationale:    string | null;
  confidenceRationale:   string;

  generatedAt:           string; // ISO 8601
}

// ─── Build explainability ─────────────────────────────────────────────────────

export function buildExplainability(
  candidate: SemanticCandidate,
  consensus: CandidateConsensus | null,
  evidence:  ExtractionEvidence,
): CandidateExplainability {
  // ── whySuggested ────────────────────────────────────────────────────────────
  const sourceLabels: Record<string, string> = {
    exact_match:   "correspondência exata no índice semântico",
    alias_match:   "match via alias/sinônimo registrado",
    fuzzy_match:   "similaridade por distância de edição (Levenshtein)",
    prefix_match:  "correspondência por prefixo",
    token_match:   "interseção de tokens significativos",
    ngram_match:   "similaridade por n-gramas",
    rule_based:    "regra de negócio explícita",
    catmat_lookup: "consulta ao catálogo CATMAT",
  };
  const sourceLabel = sourceLabels[candidate.source] ?? candidate.source;
  const whySuggested =
    `Candidato sugerido via ${sourceLabel}. ` +
    `Texto original: "${candidate.originalRaw}". ` +
    `Proposta: "${candidate.proposedDescription}". ` +
    (candidate.explanation.reason ? `Motivo: ${candidate.explanation.reason}` : "");

  // ── whyRanked ───────────────────────────────────────────────────────────────
  const level = scoreToLevel(candidate.score);
  const levelLabel = { high: "alta", medium: "média", low: "baixa", uncertain: "incerta" }[level];
  const whyRanked =
    `Candidato na posição #${candidate.rank} com score ${candidate.score.toFixed(4)} ` +
    `(confiança ${levelLabel}). ` +
    `Fonte: "${candidate.source}". ` +
    (candidate.explanation.bonus > 0 ? `Bônus aplicado: +${candidate.explanation.bonus.toFixed(3)}. ` : "") +
    (candidate.explanation.penalty > 0 ? `Penalidade: -${candidate.explanation.penalty.toFixed(3)}.` : "");

  // ── whyRejected ─────────────────────────────────────────────────────────────
  let whyRejected: string | null = null;
  if (candidate.status === "rejected" || (candidate.rank > 1)) {
    whyRejected =
      `Candidato rejeitado/preterido na posição #${candidate.rank}. ` +
      `Score: ${candidate.score.toFixed(4)}. ` +
      `Outros candidatos com score superior foram preferidos.`;
  }

  // ── influencingTokens ───────────────────────────────────────────────────────
  const influencingTokens = [...candidate.explanation.matchedOn];

  // ── aliasesUsed ─────────────────────────────────────────────────────────────
  const aliasesUsed: string[] = [];
  if (candidate.source === "alias_match") {
    // Extrai aliases do reason se disponível
    const aliasMatch = candidate.explanation.reason.match(/"([^"]+)"/g);
    if (aliasMatch) {
      aliasesUsed.push(...aliasMatch.map(a => a.replace(/"/g, "")));
    }
  }

  // ── parserInfluence ─────────────────────────────────────────────────────────
  const provenanceContext = evidence.provenance;
  const parserType = (provenanceContext?.parserType ?? "xlsx") as ParserType;
  const parserCap = parserCapabilityRegistry.get(parserType);
  const parserInfluence: ParserInfluence = {
    parserType:             parserType,
    confidenceContribution: parserCap?.descriptionConfidence ?? 0.5,
    note:                   parserCap
      ? `Parser "${parserType}" v${parserCap.parserVersion} com confiança de descrição ${(parserCap.descriptionConfidence * 100).toFixed(0)}%.`
      : `Parser "${parserType}" sem capacidade registrada; confiança padrão 50%.`,
  };

  // ── normalizationInfluence ──────────────────────────────────────────────────
  const unitEntries = evidence.chain.filter(e => e.type === "unit_normalization");
  const lastUnit = unitEntries[unitEntries.length - 1] ?? null;
  const qtyEntries = evidence.chain.filter(e => e.type === "quantity_parse");
  const normalizationInfluence: NormalizationInfluence = {
    unitMatch:      lastUnit?.resultValue ?? null,
    unitSource:     lastUnit?.ruleCode ?? null,
    quantityParsed: qtyEntries.some(e => e.resultValue != null),
    note: lastUnit
      ? `Unidade "${lastUnit.originalValue}" normalizada para "${lastUnit.resultValue}" (${lastUnit.strength}).`
      : "Nenhuma normalização de unidade encontrada na cadeia de evidências.",
  };

  // ── semanticInfluence ───────────────────────────────────────────────────────
  const strategyMap: Record<string, string> = {
    exact_match:   "exact",
    alias_match:   "alias",
    fuzzy_match:   "fuzzy",
    prefix_match:  "prefix",
    token_match:   "token",
    ngram_match:   "ngram",
    rule_based:    "rule",
    catmat_lookup: "catmat",
  };
  const semanticInfluence: SemanticInfluence = {
    indexScore:    candidate.score,
    matchStrategy: strategyMap[candidate.source] ?? candidate.source,
    topTokens:     influencingTokens.slice(0, 5),
  };

  // ── rankingRationale ────────────────────────────────────────────────────────
  const rankingRationale = candidate.rank === 1
    ? `Candidato ranqueado em 1º lugar — melhor match semântico entre os candidatos gerados para este item.`
    : `Candidato ranqueado em ${candidate.rank}º lugar. Score ${candidate.score.toFixed(4)} é inferior ao candidato principal.`;

  // ── consensusRationale ──────────────────────────────────────────────────────
  let consensusRationale: string | null = null;
  if (consensus) {
    const isWinner = consensus.winningCandidate?.id === candidate.id;
    if (isWinner) {
      consensusRationale =
        `Candidato VENCEDOR no consenso ponderado. ` +
        `Score de consenso: ${consensus.consensusScore.toFixed(4)}. ` +
        `${consensus.consensusReasoning}`;
    } else {
      const rejected = consensus.rejectedCandidates.find(r => r.id === candidate.id);
      if (rejected) {
        consensusRationale =
          `Candidato REJEITADO no consenso. ` +
          `Motivo: ${rejected.rejectionReason}`;
      } else {
        consensusRationale =
          `Candidato alternativo no consenso (score ponderado menor que o vencedor).`;
      }
    }
  }

  // ── confidenceRationale ─────────────────────────────────────────────────────
  const confidenceLabels = {
    high:      "alta (≥ 0.85) — campo claramente estruturado, revisão opcional",
    medium:    "média (0.60–0.84) — campo reconhecível mas ambíguo, revisão recomendada",
    low:       "baixa (0.35–0.59) — campo com incerteza significativa, revisão obrigatória",
    uncertain: "incerta (< 0.35) — campo não confiável, revisão obrigatória",
  };
  const confidenceRationale =
    `Score ${candidate.score.toFixed(4)} — confiança ${confidenceLabels[level]}`;

  return {
    id:                     nanoid(),
    candidateId:            candidate.id,
    stagingItemId:          candidate.stagingItemId,
    organizationId:         candidate.organizationId,
    whySuggested,
    whyRanked,
    whyRejected,
    influencingTokens,
    aliasesUsed,
    parserInfluence,
    normalizationInfluence,
    semanticInfluence,
    rankingRationale,
    consensusRationale,
    confidenceRationale,
    generatedAt:            new Date().toISOString(),
  };
}

// ─── Format for human ─────────────────────────────────────────────────────────

/**
 * Formata a explainability em markdown legível por humanos.
 */
export function formatForHuman(exp: CandidateExplainability): string {
  const sections: string[] = [
    `## Explicabilidade do Candidato`,
    ``,
    `**Candidato ID:** \`${exp.candidateId}\`  `,
    `**Item Staging:** \`${exp.stagingItemId}\``,
    ``,
    `### Por que foi sugerido?`,
    exp.whySuggested,
    ``,
    `### Por que ficou nesta posição?`,
    exp.whyRanked,
  ];

  if (exp.whyRejected) {
    sections.push(``, `### Por que foi rejeitado?`, exp.whyRejected);
  }

  sections.push(
    ``,
    `### Influência do Parser`,
    exp.parserInfluence.note,
    ``,
    `### Influência da Normalização`,
    exp.normalizationInfluence.note,
    ``,
    `### Influência Semântica`,
    `Score: ${exp.semanticInfluence.indexScore.toFixed(4)} via estratégia "${exp.semanticInfluence.matchStrategy}"`,
  );

  if (exp.influencingTokens.length > 0) {
    sections.push(``, `### Tokens influentes`, exp.influencingTokens.map(t => `\`${t}\``).join(", "));
  }

  if (exp.consensusRationale) {
    sections.push(``, `### Consenso`, exp.consensusRationale);
  }

  sections.push(
    ``,
    `### Confiança`,
    exp.confidenceRationale,
    ``,
    `*Gerado em: ${exp.generatedAt}*`,
  );

  return sections.join("\n");
}

// ─── Compare explainabilities ─────────────────────────────────────────────────

/**
 * Retorna um sumário das diferenças entre duas explainabilities.
 */
export function compareExplainabilities(
  a: CandidateExplainability,
  b: CandidateExplainability,
): string {
  const lines: string[] = [
    `## Comparação de Explainability`,
    ``,
    `| Campo | Candidato A | Candidato B |`,
    `|-------|-------------|-------------|`,
    `| candidateId | ${a.candidateId} | ${b.candidateId} |`,
    `| indexScore | ${a.semanticInfluence.indexScore.toFixed(4)} | ${b.semanticInfluence.indexScore.toFixed(4)} |`,
    `| matchStrategy | ${a.semanticInfluence.matchStrategy} | ${b.semanticInfluence.matchStrategy} |`,
    `| parserType | ${a.parserInfluence.parserType} | ${b.parserInfluence.parserType} |`,
    `| parserConfidence | ${a.parserInfluence.confidenceContribution.toFixed(3)} | ${b.parserInfluence.confidenceContribution.toFixed(3)} |`,
    `| unitMatch | ${a.normalizationInfluence.unitMatch ?? "N/A"} | ${b.normalizationInfluence.unitMatch ?? "N/A"} |`,
    `| quantityParsed | ${a.normalizationInfluence.quantityParsed} | ${b.normalizationInfluence.quantityParsed} |`,
    `| tokens | ${a.influencingTokens.join(",")} | ${b.influencingTokens.join(",")} |`,
  ];

  const scoreDiff = a.semanticInfluence.indexScore - b.semanticInfluence.indexScore;
  lines.push(``, `**Diferença de score:** ${scoreDiff >= 0 ? "+" : ""}${scoreDiff.toFixed(4)} (A vs B)`);

  return lines.join("\n");
}

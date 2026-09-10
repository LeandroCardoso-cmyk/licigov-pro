/**
 * V1 PRE-PILOT CLOSURE — Fase A2 (fechamento) — AUTORIA ESTRUTURADA PRODUZIDA PELO PROVIDER.
 *
 * Fluxo obrigatório (UMA chamada cognitiva por documento):
 *   seções canônicas (servidor) → contexto+evidências reais → provider (structured output via
 *   responseSchema) → parse governado (JSON+Zod) → validação legal/evidência → render.
 *
 * Autoridade do SERVIDOR (o provider NÃO escolhe seções): keys permitidas, required/optional, tamanho,
 * quantidade, âncora legal, grounding FACTUAL. O provider apenas PREENCHE campos das seções canônicas.
 *
 * Princípios de grounding (fechamento):
 *   - grounding POR LOCATOR, não por sourceId: evidência de outro artigo não fundamenta a seção; e a
 *     existência do §/inciso/alínea é comprovada no TEXTO verbatim do artigo (corpus particionado por
 *     artigo → sub-locators verificados deterministicamente);
 *   - `evidenceComplete` = cobertura de TODOS os anchors OBRIGATÓRIOS (não confidence, não coverageRatio);
 *   - qualidade da fonte: âncora legal exige fonte NORMATIVA vigente (manual complementa, não substitui);
 *   - citação inexistente/revogada NÃO permanece na prosa (removida + limitação; ou fail-closed);
 *   - structured output inválido → FAIL-CLOSED, proveniência `failed`, nenhum artifact válido.
 */

import { createHash } from "crypto";
import type { OfficialCorpusBuildResult } from "../officialCorpus/officialCorpusBuilder";
import type { ContextPackage } from "../../domain/institutionalIntegration/contextPackage";
import type { EvidenceRef, GroundingState } from "../../domain/cognitiveProvenance";
import { executeCognitiveTask, type CognitiveExecution } from "../aiExecutionEngine";
import { resolveInstitutionalContextPackage } from "../institutionalIntegration/institutionalKnowledgeIntegration";
import { assessGrounding } from "../../domain/institutionalIntegration/evidenceFromContext";
import { captureCognitiveFailure } from "../cognitive/cognitiveProvenanceService";
import {
  canonicalSectionsFor, validateStructuredAuthoring, parseProviderAuthoringOutput, buildAuthoringResponseSchema,
  AUTHORING_CONTRACT_VERSION, AuthoringContractError,
  type StructuredAuthoring, type AuthoredSection, type AuthoredLegalReference, type CanonicalAuthoringSection,
  type ProviderSectionFill,
} from "../../domain/authoring/authoringSchema";
import {
  buildCorpusLegalIndex, validateCitedLegalReferences, locatorExistsAndCurrent, sourceKindOf, articleKeyOf,
  type CorpusLegalIndex,
} from "./legalReferenceValidationService";
import { isNormativeCurrent } from "../../domain/institutionalIntegration/evidenceFromContext";
import { getAuthoringCorpus } from "./authoringCorpus";

const DOMAIN = "processo_licitatorio";
const REVIEW_NOTICE = "Rascunho fundamentado gerado com apoio de IA supervisionada. Revisão OBRIGATÓRIA pelo servidor competente — não constitui documento aprovado nem juízo definitivo de legalidade.";

export interface StructuredAuthoringInput {
  readonly organizationId: number;
  readonly kind: "etp" | "tr";
  readonly object: string;
  readonly correlationId: string;
  readonly actorUserId?: number;
  readonly userContext?: { state?: string | null; municipality?: string | null };
  readonly corpus?: OfficialCorpusBuildResult;
  /** Seam determinístico (testes/legado): fornece o OUTPUT ESTRUTURADO do provider (JSON) sem chamar o Engine. */
  readonly invoke?: (prompt: string) => Promise<string>;
}

export interface StructuredAuthoringResult {
  readonly content: string;
  readonly structured: StructuredAuthoring;
  readonly evidences: readonly EvidenceRef[];
  readonly evidenceComplete: boolean;
  readonly groundingState: GroundingState;
  readonly evidenceFingerprint: string | null;
  readonly corpusFingerprint: string;
  readonly contextPackage: ContextPackage;
  readonly execution?: CognitiveExecution;
  readonly rejectedReferences: readonly { readonly raw: string; readonly reason: string }[];
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Query determinística de recuperação para o tipo de documento (independe de ordem/posição). */
function retrievalQuery(kind: "etp" | "tr", object: string): string {
  return kind === "tr"
    ? `Termo de Referência: definição do objeto, fundamentação, requisitos e seleção do fornecedor para "${object}" (Lei 14.133/2021, art. 6º XXIII e art. 40).`
    : `Estudo Técnico Preliminar: necessidade, requisitos, levantamento de mercado e viabilidade para "${object}" (Lei 14.133/2021, art. 18).`;
}

/** Segmentos de locator (após o sourceId) da âncora de uma seção. */
function anchorParts(anchor: string): { sourceId: string; locatorPath: string; article: string } {
  const segs = anchor.split(":").filter(Boolean);
  const sourceId = segs[0] ?? "";
  const rest = segs.slice(1);
  const artSeg = rest.find((s) => s.startsWith("art-")) ?? "";
  return { sourceId, locatorPath: rest.join(":"), article: articleKeyOf(artSeg.replace(/^art-/, "")) };
}

/**
 * GROUNDING POR LOCATOR + qualidade da fonte. Uma seção está aterrada quando:
 *   - houve evidência REAL recuperada da MESMA fonte e do MESMO artigo da âncora;
 *   - a fonte é NORMATIVA e vigente (manual/jurisprudencial não fundamenta âncora legal);
 *   - o sub-locator (§/inciso/alínea) da âncora EXISTE no texto verbatim do artigo (corpus).
 * Evidência de outro artigo (ex.: art-40) NÃO fundamenta uma âncora em art-18.
 */
function buildRetrievedNormativeArticles(pkg: ContextPackage, index: CorpusLegalIndex): Set<string> {
  const statusByNorm = new Map(pkg.documents.map((d) => [d.normId, d.status]));
  const set = new Set<string>();
  for (const p of pkg.retrievedPassages) {
    const status = statusByNorm.get(p.normId);
    if (!status || !isNormativeCurrent(status)) continue;         // fonte revogada/desconhecida não conta
    if (sourceKindOf(index, p.normId) !== "normative") continue; // Gap 8: âncora legal exige fonte normativa
    set.add(`${p.normId}|${articleKeyOf(p.identifier)}`);
  }
  return set;
}

function sectionGrounded(section: CanonicalAuthoringSection, retrieved: Set<string>, index: CorpusLegalIndex): boolean {
  const { sourceId, locatorPath, article } = anchorParts(section.legalAnchor);
  if (!retrieved.has(`${sourceId}|${article}`)) return false;         // evidência do artigo da âncora?
  return locatorExistsAndCurrent(index, sourceId, locatorPath);       // sub-locator existe no corpus?
}

export interface SectionCoverageAssessment {
  readonly groundedByKey: ReadonlyMap<string, boolean>;
  readonly mandatoryCovered: number;
  readonly mandatoryTotal: number;
  readonly evidenceComplete: boolean;
  readonly groundingState: GroundingState;
}

/**
 * Avalia a cobertura de fundamentação POR LOCATOR (Gaps 2/3/4/8) de forma pura e determinística:
 *   - cada seção é aterrada só se houver evidência normativa vigente do MESMO artigo E o sub-locator
 *     existir no texto verbatim do artigo;
 *   - `evidenceComplete` = TODOS os anchors obrigatórios cobertos;
 *   - groundingState: todos obrigatórios → grounded; algum → partially_grounded; nenhum → ungrounded.
 */
export function assessSectionCoverage(kind: "etp" | "tr", pkg: ContextPackage, index: CorpusLegalIndex): SectionCoverageAssessment {
  const canon = canonicalSectionsFor(kind);
  const retrieved = buildRetrievedNormativeArticles(pkg, index);
  const groundedByKey = new Map<string, boolean>();
  for (const s of canon) groundedByKey.set(s.key, sectionGrounded(s, retrieved, index));
  // Estimativa PRÉ-provider (assume todas as seções produzidas): cobertura dos MÍNIMOS LEGAIS.
  const mandatory = canon.filter((s) => s.mustProvide);
  const mandatoryCovered = mandatory.filter((s) => groundedByKey.get(s.key)).length;
  const anyGrounded = canon.some((s) => groundedByKey.get(s.key));
  const evidenceComplete = mandatory.length > 0 && mandatoryCovered === mandatory.length;
  const groundingState: GroundingState = evidenceComplete ? "grounded" : anyGrounded ? "partially_grounded" : "ungrounded";
  return { groundedByKey, mandatoryCovered, mandatoryTotal: mandatory.length, evidenceComplete, groundingState };
}

/** Grounding de RECUPERAÇÃO por âncora (mapa key→bool), independente do output do provider. */
export function retrievalGroundedByAnchor(kind: "etp" | "tr", pkg: ContextPackage, index: CorpusLegalIndex): Map<string, boolean> {
  const retrieved = buildRetrievedNormativeArticles(pkg, index);
  const m = new Map<string, boolean>();
  for (const s of canonicalSectionsFor(kind)) m.set(s.key, sectionGrounded(s, retrieved, index));
  return m;
}

/**
 * Cobertura FINAL do documento (Gaps 3/4) — pós-provider. Uma seção "precisa de grounding" quando é
 * MÍNIMO LEGAL ou foi efetivamente PRODUZIDA. `evidenceComplete` = todas as que precisam estão FINAL-aterradas
 * (retrieval + produzida + sem citação rejeitada). Seção legitimamente omitida/não-aplicável com justificativa
 * NÃO conta como "faltando". Determinística.
 */
export function assessDocumentCoverage(
  kind: "etp" | "tr",
  sections: readonly { key: string; contentMode: string; grounded: boolean }[],
): { evidenceComplete: boolean; groundingState: GroundingState } {
  const canonByKey = new Map(canonicalSectionsFor(kind).map((s) => [s.key, s]));
  const needs = sections.filter((s) => {
    const canon = canonByKey.get(s.key);
    return (canon?.mustProvide ?? false) || s.contentMode === "provided";
  });
  const needsGroundedCount = needs.filter((s) => s.grounded).length;
  const evidenceComplete = needs.length > 0 && needsGroundedCount === needs.length;
  const groundingState: GroundingState = evidenceComplete ? "grounded" : needsGroundedCount > 0 ? "partially_grounded" : "ungrounded";
  return { evidenceComplete, groundingState };
}

/** Valida uma referência declarada pelo provider (identifier + diploma) contra o corpus. */
function validateProviderRef(index: CorpusLegalIndex, fill: ProviderSectionFill): AuthoredLegalReference[] {
  const out: AuthoredLegalReference[] = [];
  for (const r of fill.legalReferences ?? []) {
    const text = `${r.identifier}${r.diploma ? ` ${r.diploma}` : ""}`;
    const res = validateCitedLegalReferences(index, text);
    out.push(...res.valid);
  }
  return out;
}

/** Categoriza o motivo de rejeição SEM reproduzir números/dispositivos (Gap 6). */
function rejectionCategory(reason: string): string {
  if (/sub-locator/.test(reason)) return "dispositivo (§/inciso/alínea) inexistente";
  if (/artigo inexistente/.test(reason)) return "artigo inexistente";
  return "diploma ausente, revogado ou incompatível";
}

/** Remove citações REJEITADAS da prosa (Gap 6) — a citação falsa não permanece no rascunho. */
function sanitizeProse(prose: string, rejected: readonly { raw: string }[]): string {
  let out = prose;
  for (const r of rejected) {
    if (r.raw && out.includes(r.raw)) out = out.split(r.raw).join("[referência não verificada removida]");
  }
  return out;
}

/** Renderiza o markdown revisável a partir da ESTRUTURA já validada (não do texto livre do LLM). */
function renderMarkdown(doc: StructuredAuthoring): string {
  const heading = doc.kind === "tr" ? "Termo de Referência" : "Estudo Técnico Preliminar";
  const stateLabel: Record<GroundingState, string> = {
    grounded: "Fundamentado", partially_grounded: "Parcialmente fundamentado", ungrounded: "Sem fundamentação recuperada",
    not_applicable: "Não aplicável", legacy_unclassified: "Não classificado",
  };
  const lines: string[] = [`# ${heading} — ${doc.object}`, ""];
  lines.push(`> Estado de fundamentação: **${stateLabel[doc.groundingState]}** — ${doc.evidenceCount} evidência(s) normativa(s) utilizada(s).`, "");
  for (const s of doc.sections) {
    const statusTag = s.contentMode !== "provided"
      ? (s.contentMode === "not_applicable_with_justification" ? "não aplicável (justificada)" : "não contemplada (justificada)")
      : (s.grounded ? "fundamentada" : "fundamentação pendente");
    lines.push(`## ${s.title}`, `_${s.legalAnchorLabel} · ${statusTag}_`, "");
    lines.push(s.contentMode === "provided" ? s.prose : `**Justificativa:** ${s.omissionJustification}`, "");
    if (s.legalReferences.length > 0) {
      lines.push("**Base legal:**");
      for (const r of s.legalReferences) lines.push(`- ${r.display}`);
      lines.push("");
    }
  }
  if (doc.limitations.length > 0) {
    lines.push("## Limitações e ressalvas");
    for (const l of doc.limitations) lines.push(`- ${l}`);
    lines.push("");
  }
  lines.push("---", `> ${doc.reviewNotice}`);
  return lines.join("\n");
}

/** Constrói o prompt/query cognitiva com a instrução de structured output (a estrutura vem do responseSchema). */
function authoringQuery(kind: "etp" | "tr", object: string): string {
  const canon = canonicalSectionsFor(kind).map((s) => `${s.key} (${s.legalAnchorLabel})`).join("; ");
  return `${retrievalQuery(kind, object)}\n\nPreencha, em JSON estruturado, a prosa de cada seção canônica (NÃO invente seções): ${canon}. ` +
    `Cite apenas dispositivos legais REAIS e vigentes; declare as referências jurídicas de forma estruturada.`;
}

/** Registra proveniência FAILED de contrato de autoria (structured output inválido) — best-effort. */
async function recordAuthoringContractFailure(input: StructuredAuthoringInput, err: unknown): Promise<void> {
  const replayHash = createHash("sha256").update(`authoring-contract:${input.organizationId}:${input.correlationId}:${input.kind}`).digest("hex").slice(0, 32);
  const executionId = createHash("sha256").update(`authoring-exec:${input.correlationId}:${replayHash}`).digest("hex").slice(0, 20);
  try {
    await captureCognitiveFailure({
      organizationId: input.organizationId, executionId, correlationId: input.correlationId,
      task: "GENERATE_DOCUMENT", provider: null, model: null, replayHash,
      usesGrounding: true, usesRAG: true, businessDomain: DOMAIN,
      actorUserId: String(input.actorUserId ?? "system"),
      semanticInput: { tenantId: input.organizationId, task: "GENERATE_DOCUMENT", businessDomain: DOMAIN, query: input.object },
      error: { name: "STRUCTURED_OUTPUT_INVALID", message: err instanceof Error ? err.message : String(err) },
    });
  } catch { /* best-effort: não mascara o fail-closed original */ }
}

/**
 * Gera a autoria estruturada com grounding REAL e output produzido pelo PROVIDER. Determinístico dado o
 * mesmo corpus/objeto. Fail-closed: structured output inválido → AuthoringContractError + proveniência failed.
 */
export async function generateStructuredAuthoring(input: StructuredAuthoringInput): Promise<StructuredAuthoringResult> {
  const corpus = input.corpus ?? getAuthoringCorpus();
  const index = buildCorpusLegalIndex(corpus);
  const canon = canonicalSectionsFor(input.kind);

  // 1) Recuperação institucional REAL (governada, determinística) → ContextPackage.
  const contextPackage = resolveInstitutionalContextPackage(corpus, {
    tenantId: input.organizationId, businessDomain: DOMAIN, taskType: input.kind,
    query: retrievalQuery(input.kind, input.object), correlationId: input.correlationId,
    userContext: input.userContext, enableSourceScopeRouting: true,
  });

  // 2) Evidências REAIS (fontes vigentes) → fingerprint/lineage (A1).
  const grounding = assessGrounding(contextPackage, { minEvidences: 1, minCoverage: 0 });

  // 3) GROUNDING POR LOCATOR (retrieval) + estimativa PRÉ-provider dos mínimos legais (hint da cognição).
  const retrievalGrounded = retrievalGroundedByAnchor(input.kind, contextPackage, index);
  const preEstimate = assessSectionCoverage(input.kind, contextPackage, index);
  const evidenceCount = grounding.evidenceCount;
  const evidenceFingerprint = grounding.evidenceFingerprint;

  // 4) UMA chamada cognitiva → OUTPUT ESTRUTURADO do provider. Fail-closed em output inválido.
  const responseSchema = buildAuthoringResponseSchema(input.kind);
  let rawProviderText = "";
  let execution: CognitiveExecution | undefined;
  try {
    if (input.invoke) {
      rawProviderText = await input.invoke(authoringQuery(input.kind, input.object));
    } else {
      execution = await executeCognitiveTask({
        task: "GENERATE_DOCUMENT", tenantId: input.organizationId,
        userId: String(input.actorUserId ?? "system"), correlationId: input.correlationId,
        query: authoringQuery(input.kind, input.object), businessDomain: DOMAIN,
        contextPackage,
        documentRefs: contextPackage.documents.map((d) => d.documentId),
        lawRefs: contextPackage.citations.map((c) => c.reference),
        evidences: grounding.evidences, evidenceComplete: preEstimate.evidenceComplete,
        responseSchema,
      });
      rawProviderText = execution.response.content ?? "";
    }
  } catch (err) {
    if (err instanceof AuthoringContractError) await recordAuthoringContractFailure(input, err);
    throw err;
  }

  // 5) Parse GOVERNADO do structured output (JSON + Zod + autoridade do servidor). Fail-closed.
  let providerOutput;
  try {
    providerOutput = parseProviderAuthoringOutput(input.kind, rawProviderText);
  } catch (err) {
    if (err instanceof AuthoringContractError) await recordAuthoringContractFailure(input, err);
    throw err;
  }
  const fillByKey = new Map<string, ProviderSectionFill>(providerOutput.sections.map((s) => [s.key, s]));

  // 6) Monta seções (autoridade do servidor: key/title/anchor/modo/grounding) + prosa do provider sanitizada.
  const rejectedAll: { raw: string; reason: string }[] = [];
  const limitations: string[] = [];
  const sections: AuthoredSection[] = canon.map((section) => {
    const fill = fillByKey.get(section.key);
    const contentMode = fill?.contentMode ?? "provided";
    const isProvided = contentMode === "provided";
    const rawProse = isProvided ? (fill?.prose ?? "") : "";
    // Gap 6 — citações inexistentes/revogadas na prosa: validar e REMOVER (não permanecem no rascunho).
    const cite = validateCitedLegalReferences(index, rawProse);
    rejectedAll.push(...cite.rejected);
    const prose = isProvided ? sanitizeProse(rawProse, cite.rejected).trim() : "";
    // Gap 4 — a referência rejeitada DEGRADA a seção: só aterrada se produzida, com âncora recuperada E
    // SEM nenhuma citação rejeitada (recalculado APÓS a validação do output do provider).
    const { sourceId, locatorPath } = anchorParts(section.legalAnchor);
    const grounded = isProvided && (retrievalGrounded.get(section.key) ?? false) && cite.rejected.length === 0;
    // Referências estruturadas: citadas validadas + declaradas validadas + âncora canônica quando aterrada.
    const refs = new Map<string, AuthoredLegalReference>();
    for (const r of cite.valid) refs.set(r.locatorId, r);
    if (fill) for (const r of validateProviderRef(index, fill)) refs.set(r.locatorId, r);
    if (grounded && locatorExistsAndCurrent(index, sourceId, locatorPath)) {
      const anchorRef: AuthoredLegalReference = { sourceId, locatorId: section.legalAnchor, display: `Lei nº 14.133/2021 — ${section.legalAnchorLabel}`, status: "vigente" };
      refs.set(anchorRef.locatorId, anchorRef);
    }
    for (const l of fill?.limitations ?? []) limitations.push(`${section.title}: ${l}`);
    return {
      key: section.key, title: section.title, legalAnchorLabel: section.legalAnchorLabel,
      contentMode, prose: truncate(prose, 8000),
      omissionJustification: isProvided ? "" : truncate((fill?.omissionJustification ?? "").trim(), 8000),
      grounded, legalReferences: [...refs.values()].slice(0, 24),
    };
  });

  // 7) Cobertura FINAL do documento (Gaps 3/4) — recalculada APÓS a validação do output do provider.
  const finalCoverage = assessDocumentCoverage(input.kind, sections);
  const groundingState = finalCoverage.groundingState;
  const evidenceComplete = finalCoverage.evidenceComplete;

  // Limitações honestas (fundamentação parcial/ausente, citações rejeitadas, seções não contempladas).
  if (groundingState === "ungrounded") limitations.unshift("Nenhuma evidência normativa vigente foi recuperada — o rascunho não está fundamentado e exige elaboração pelo servidor.");
  else if (groundingState === "partially_grounded") limitations.unshift("Fundamentação parcial: nem todas as seções que exigem grounding contam com evidência normativa compatível.");
  // Gap 6 — a limitação registra a CATEGORIA da rejeição, sem reproduzir a citação falsa (não vira nota de
  // rodapé que ecoa o dispositivo inexistente). O texto exato fica só em `rejectedReferences` (dado, não render).
  const rejectionCategories = new Set(rejectedAll.map((r) => rejectionCategory(r.reason)));
  for (const cat of rejectionCategories) limitations.push(`Uma ou mais referências jurídicas citadas não puderam ser verificadas no corpus e foram removidas da fundamentação (${cat}).`);
  const omittedSections = sections.filter((s) => s.contentMode !== "provided").map((s) => s.title);
  if (omittedSections.length > 0) limitations.push(`Seções não contempladas (com justificativa): ${omittedSections.join("; ")}.`);
  const pendingGrounding = sections.filter((s) => s.contentMode === "provided" && !s.grounded).map((s) => s.title);
  if (pendingGrounding.length > 0 && groundingState !== "ungrounded") limitations.push(`Seções produzidas com fundamentação pendente: ${pendingGrounding.join("; ")}.`);

  // 8) Contrato Zod bounded → fail-closed (mínimos legais, representação de todas as seções, justificativas).
  const contractGroundingState: StructuredAuthoring["groundingState"] =
    groundingState === "grounded" || groundingState === "partially_grounded" || groundingState === "not_applicable" ? groundingState : "ungrounded";
  const candidate: StructuredAuthoring = {
    contract: AUTHORING_CONTRACT_VERSION, kind: input.kind, object: truncate(input.object, 500),
    sections, groundingState: contractGroundingState, evidenceCount,
    evidenceComplete, usedSourceIds: [...grounding.usedSourceIds],
    evidenceFingerprint, corpusFingerprint: grounding.corpusFingerprint,
    limitations: [...new Set(limitations)].slice(0, 24), reviewNotice: REVIEW_NOTICE,
  };
  let structured: StructuredAuthoring;
  try {
    structured = validateStructuredAuthoring(candidate);
  } catch (err) {
    if (err instanceof AuthoringContractError) await recordAuthoringContractFailure(input, err);
    throw err;
  }
  const content = renderMarkdown(structured);

  return {
    content, structured, evidences: grounding.evidences, evidenceComplete,
    groundingState, evidenceFingerprint, corpusFingerprint: grounding.corpusFingerprint,
    contextPackage, execution, rejectedReferences: rejectedAll,
  };
}

/**
 * Helper de teste/seam: constrói um OUTPUT ESTRUTURADO válido do provider (JSON) preenchendo todas as
 * seções canônicas do tipo. `overrides` permite injetar prosa/refs específicas por key (testes A/E/injeção).
 */
export function buildMockProviderAuthoring(
  kind: "etp" | "tr",
  overrides: Record<string, { contentMode?: string; prose?: string; omissionJustification?: string; legalReferences?: { identifier: string; diploma?: string }[] }> = {},
): string {
  return JSON.stringify({
    sections: canonicalSectionsFor(kind).map((s) => {
      const o = overrides[s.key];
      const contentMode = o?.contentMode ?? "provided";
      return {
        key: s.key,
        contentMode,
        prose: contentMode === "provided" ? (o?.prose ?? `Conteúdo determinístico para ${s.title.toLowerCase()} (${s.legalAnchorLabel}).`) : "",
        omissionJustification: contentMode === "provided" ? "" : (o?.omissionJustification ?? `Elemento não aplicável ao objeto: justificativa determinística (${s.legalAnchorLabel}).`),
        legalReferences: o?.legalReferences ?? [],
        limitations: [],
      };
    }),
  });
}

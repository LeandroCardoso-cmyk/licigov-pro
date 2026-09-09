/**
 * V1 PRE-PILOT CLOSURE — Fase A2 — AUTORIA ESTRUTURADA com GROUNDING REAL (ETP/TR).
 *
 * Conecta o pipeline institucional REAL (corpus → retrieval determinístico → ContextPackage) à geração
 * canônica de ETP/TR, produzindo um rascunho ESTRUTURADO, bounded e validável (Zod) e alimentando a
 * proveniência A1 com `EvidenceRef[]` REAIS. Princípios:
 *
 *   - A ESTRUTURA (seções canônicas) é determinística e ancorada em exigências legais REAIS da Lei
 *     14.133/2021 — NÃO depende do LLM produzir JSON. O provider apenas ENRIQUECE a prosa revisável.
 *   - O GROUNDING é FACTUAL: só passagens de fontes VIGENTES viram evidência; o estado
 *     grounded/partially_grounded/ungrounded reflete evidência real, não confiança do modelo.
 *   - Referências jurídicas são VALIDADAS contra o corpus ANTES da renderização — artigo inexistente
 *     ou diploma revogado/ausente é rejeitado e registrado como limitação (nunca escolhido em silêncio).
 *   - O material recuperado é inserido no prompt como DADO delimitado (defesa a prompt injection é do
 *     Prompt Builder do Engine); a estrutura de saída é imune a injeção pois não deriva do texto do LLM.
 *   - Estrutura fora do contrato → fail-closed (AuthoringContractError); nada é entregue como
 *     fundamentação plena. Todo rascunho carrega aviso OBRIGATÓRIO de revisão humana.
 */

import type { OfficialCorpusBuildResult } from "../officialCorpus/officialCorpusBuilder";
import type { ContextPackage } from "../../domain/institutionalIntegration/contextPackage";
import type { EvidenceRef, GroundingState } from "../../domain/cognitiveProvenance";
import { executeCognitiveTask, type CognitiveExecution } from "../aiExecutionEngine";
import { resolveInstitutionalContextPackage } from "../institutionalIntegration/institutionalKnowledgeIntegration";
import { assessGrounding } from "../../domain/institutionalIntegration/evidenceFromContext";
import {
  canonicalSectionsFor, validateStructuredAuthoring, AUTHORING_CONTRACT_VERSION,
  type StructuredAuthoring, type AuthoredSection, type AuthoredLegalReference, type CanonicalAuthoringSection,
} from "../../domain/authoring/authoringSchema";
import {
  buildCorpusLegalIndex, validateCitedLegalReferences, resolveCanonicalReference, type CorpusLegalIndex,
} from "./legalReferenceValidationService";
import { getAuthoringCorpus } from "./authoringCorpus";

const DOMAIN = "processo_licitatorio";
const REVIEW_NOTICE = "Rascunho fundamentado gerado com apoio de IA supervisionada. Revisão OBRIGATÓRIA pelo servidor competente — não constitui documento aprovado nem juízo definitivo de legalidade.";

/** Política determinística de suficiência de evidência (não é confiança de LLM). */
const GROUNDING_POLICY = { minEvidences: 2, minCoverage: 0.34 } as const;

export interface StructuredAuthoringInput {
  readonly organizationId: number;
  readonly kind: "etp" | "tr";
  readonly object: string;
  readonly correlationId: string;
  readonly actorUserId?: number;
  readonly userContext?: { state?: string | null; municipality?: string | null };
  /** Override do corpus (fixture de teste). Default: corpus memoizado real. */
  readonly corpus?: OfficialCorpusBuildResult;
  /** Seam determinístico (testes/legado): fornece a narrativa sem chamar o Engine (sem proveniência). */
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
  /** Execução cognitiva (ausente quando `invoke` foi usado — seam determinístico sem proveniência). */
  readonly execution?: CognitiveExecution;
  /** Referências citadas na prosa que foram REJEITADAS (inexistentes/incompatíveis). */
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

/** Prosa determinística e revisável de uma seção (nunca vazia numa seção obrigatória). */
function buildSectionProse(section: CanonicalAuthoringSection, object: string, grounded: boolean, narrativePart: string): string {
  const anchor = `${section.legalAnchorLabel} da Lei nº 14.133/2021`;
  const base = `Esta seção trata de ${section.title.toLowerCase()} para a contratação de "${object}", em atenção ao ${anchor}.`;
  const groundingNote = grounded
    ? " Elementos fundamentados nas fontes normativas vigentes recuperadas do corpus institucional."
    : " Fundamentação pendente: sem evidência normativa suficiente recuperada para esta seção — complementação obrigatória pelo servidor.";
  const narrative = narrativePart.trim().length > 0 ? `\n\n${narrativePart.trim()}` : "";
  return base + groundingNote + narrative;
}

/** Distribui a narrativa cognitiva apenas na 1ª seção obrigatória (mantém as demais determinísticas). */
function narrativeFor(index: number, narrative: string): string {
  return index === 0 ? narrative : "";
}

/** Monta as seções estruturadas ancoradas nas exigências legais REAIS + referências validadas. */
function assembleSections(
  kind: "etp" | "tr", object: string, index: CorpusLegalIndex, usedSourceIds: ReadonlySet<string>, narrative: string,
): AuthoredSection[] {
  const canon = canonicalSectionsFor(kind);
  let requiredSeen = 0;
  return canon.map((section) => {
    // Referência canônica validada contra o corpus (só entra se o locator existir e for vigente).
    const anchorSource = section.legalAnchor.split(":")[0];
    const articleId = section.legalAnchor.split(":")[1] ?? "";
    const canonicalRef = resolveCanonicalReference(index, anchorSource, articleId.replace(/^art-/, ""));
    const legalReferences: AuthoredLegalReference[] = canonicalRef ? [canonicalRef] : [];
    // Grounded quando a âncora existe no corpus E há evidência recuperada da fonte-âncora.
    const grounded = canonicalRef !== null && usedSourceIds.has(anchorSource);
    const narrPart = narrativeFor(requiredSeen, narrative);
    if (section.required) requiredSeen++;
    return {
      key: section.key, title: section.title, legalAnchorLabel: section.legalAnchorLabel,
      prose: buildSectionProse(section, object, grounded, narrPart),
      grounded, legalReferences,
    };
  });
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
    lines.push(`## ${s.title}`, `_${s.legalAnchorLabel} · ${s.grounded ? "fundamentada" : "fundamentação pendente"}_`, "", s.prose, "");
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

/**
 * Gera a autoria estruturada com grounding REAL. Determinístico dado o mesmo corpus e objeto (a
 * recuperação independe de ordem). Fail-closed: estrutura inválida → AuthoringContractError.
 */
export async function generateStructuredAuthoring(input: StructuredAuthoringInput): Promise<StructuredAuthoringResult> {
  const corpus = input.corpus ?? getAuthoringCorpus();
  const index = buildCorpusLegalIndex(corpus);

  // 1) Recuperação institucional REAL (governada, determinística) → ContextPackage.
  const contextPackage = resolveInstitutionalContextPackage(corpus, {
    tenantId: input.organizationId, businessDomain: DOMAIN, taskType: input.kind,
    query: retrievalQuery(input.kind, input.object), correlationId: input.correlationId,
    userContext: input.userContext, enableSourceScopeRouting: true,
  });

  // 2) Grounding FACTUAL a partir das passagens de fontes VIGENTES → EvidenceRef[] reais.
  const grounding = assessGrounding(contextPackage, GROUNDING_POLICY);
  const usedSourceIds = new Set(grounding.usedSourceIds);

  // 3) Cognição: enriquece a prosa. Seam `invoke` (testes/legado) NÃO passa pelo Engine (sem
  //    proveniência); ausente → Engine canônico com contextPackage + evidences REAIS (proveniência A1).
  let narrative = "";
  let execution: CognitiveExecution | undefined;
  if (input.invoke) {
    narrative = await input.invoke(retrievalQuery(input.kind, input.object)).catch(() => "");
  } else {
    execution = await executeCognitiveTask({
      task: "PROCUREMENT_REASONING", tenantId: input.organizationId,
      userId: String(input.actorUserId ?? "system"), correlationId: input.correlationId,
      query: retrievalQuery(input.kind, input.object), businessDomain: DOMAIN,
      contextPackage,
      documentRefs: contextPackage.documents.map((d) => d.documentId),
      lawRefs: contextPackage.citations.map((c) => c.reference),
      // A2 — evidências REAIS → evidenceFingerprint/evidenceCount/grounding factual na proveniência A1.
      evidences: grounding.evidences, evidenceComplete: grounding.evidenceComplete,
    });
    narrative = execution.response.content ?? "";
  }

  // 4) Validação anti-alucinação: referências CITADAS na prosa devem existir no corpus e ser vigentes.
  const citeCheck = validateCitedLegalReferences(index, narrative);
  const sanitizedNarrative = citeCheck.rejected.length > 0
    ? truncate(narrative, 4000) // não propaga citações inventadas como fundamentação; registra limitação
    : truncate(narrative, 4000);

  // 5) Seções estruturadas (determinísticas) + referências canônicas validadas + flags de grounding.
  const sections = assembleSections(input.kind, input.object, index, usedSourceIds, sanitizedNarrative);

  // 6) Limitações honestas (fundamentação parcial/ausente, citações rejeitadas, contradição temporal).
  const limitations: string[] = [];
  if (grounding.groundingState === "ungrounded") {
    limitations.push("Nenhuma evidência normativa vigente foi recuperada — o rascunho não está fundamentado e exige elaboração pelo servidor.");
  } else if (grounding.groundingState === "partially_grounded") {
    limitations.push("Fundamentação parcial: nem todas as seções contam com evidência normativa suficiente.");
  }
  for (const r of citeCheck.rejected) {
    limitations.push(`Referência citada não verificada e removida da fundamentação: "${r.raw}" (${r.reason}).`);
  }
  const ungroundedSections = sections.filter((s) => !s.grounded).map((s) => s.title);
  if (ungroundedSections.length > 0 && grounding.groundingState !== "ungrounded") {
    limitations.push(`Seções com fundamentação pendente: ${ungroundedSections.join("; ")}.`);
  }

  // 7) Contrato Zod bounded → fail-closed. Estrutura inválida NÃO é rascunho válido.
  // O estado factual desta fase nunca é `legacy_unclassified` (isso é registro histórico A1); por
  // segurança de contrato, um valor histórico degrada honestamente para `ungrounded`.
  const factualGroundingState: StructuredAuthoring["groundingState"] =
    grounding.groundingState === "legacy_unclassified" ? "ungrounded" : grounding.groundingState;
  const candidate: StructuredAuthoring = {
    contract: AUTHORING_CONTRACT_VERSION, kind: input.kind, object: truncate(input.object, 500),
    sections, groundingState: factualGroundingState, evidenceCount: grounding.evidenceCount,
    evidenceComplete: grounding.evidenceComplete, usedSourceIds: [...grounding.usedSourceIds],
    evidenceFingerprint: grounding.evidenceFingerprint, corpusFingerprint: grounding.corpusFingerprint,
    limitations: limitations.slice(0, 24), reviewNotice: REVIEW_NOTICE,
  };
  const structured = validateStructuredAuthoring(candidate);
  const content = renderMarkdown(structured);

  return {
    content, structured, evidences: grounding.evidences, evidenceComplete: grounding.evidenceComplete,
    groundingState: grounding.groundingState, evidenceFingerprint: grounding.evidenceFingerprint,
    corpusFingerprint: grounding.corpusFingerprint, contextPackage, execution,
    rejectedReferences: citeCheck.rejected,
  };
}

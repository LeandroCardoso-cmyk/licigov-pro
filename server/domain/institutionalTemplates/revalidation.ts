/**
 * Institutional Templates — REVALIDAÇÃO CANÔNICA antes da emissão + derivação do Issuance Manifest M2 (Lane B).
 *
 * A revalidação é PURA: quem chama relê as fontes canônicas ATUAIS (fora da transação), recompõe com a MESMA
 * revisão e as MESMAS narrativas de IA e entrega aqui o M1 persistido, a recomposição e o conteúdo a emitir.
 * Bloqueia (nunca corrige):
 *  - SOURCE_CHANGED: fonte canônica, documento oficial referenciado ou identidade institucional mudou desde o M1 —
 *    a emissão é BLOQUEADA, nada é regenerado automaticamente e nenhum documento emitido é mutado;
 *  - COMPOSITION_DRIFT: mesmas fontes, mas a recomposição não reproduz o `composedOutputHash` do M1;
 *  - HUMAN_EDIT_LINEAGE_INVALID: o conteúdo emitido difere do composto sem cadeia de edições humanas que o explique;
 *  - PROTECTED_NODE_MISSING: valor canônico ou referência oficial do texto composto foi removido/alterado na edição;
 *  - STRUCTURAL_DEVIATION_UNACKNOWLEDGED: bloco condicional incluído removido (ou excluído inserido) sem reconhecimento;
 *  - AI_NARRATIVE_NOT_ACCEPTED: narrativa de IA do M1 sem aceite humano exato (slot + execução + hash do texto);
 *  - AI_SLOT_UNRESOLVED / AI_SLOT_RESOLUTION_STALE (E2): slot pendente do texto composto sem resolução humana registrada, ou com
 *    resolução que não corresponde mais ao trecho emitido (apagar `[REVISAR]` nunca equivale a revisão).
 * O M2 é DERIVADO do M1 (INSERT-only; o M1 nunca é reescrito) com `documentContentHash`, `humanEditRefs` e o registro
 * da revalidação (`checkedAt` fora de qualquer hash). Id do M2 determinístico ⇒ retry da transação não duplica efeito.
 */
import { sha256Hex } from "../canonicalJson";
import type { ComposedDocument, ComposeIssue } from "./composer";
import {
  computeRevalidationResultHash, deriveIssuanceManifest, validateManifest,
  type AiNarrativeRef, type CanonicalRevalidationRecord, type GenerationManifest, type HumanEditRef, type IssuanceManifest,
} from "./manifest";
import { lateBoundTamperIssues, type LifecycleBinding } from "./lifecycleLateBound";
import { evaluateSlotResolutions, pendingSlotMark, slotResolutionRefs, type SlotResolutionRecord, type SlotResolutionRef } from "./slotResolution";
import { templateHash } from "./semanticHash";
import { isSha256, type OrgId, type Sha256, type TemplateIssueCode } from "./types";

export const TEMPLATE_REVALIDATOR_VERSION = "tpl-revalidation/1";

export type RevalidationIssueCode =
  | TemplateIssueCode
  | ComposeIssue["code"]
  | "SOURCE_CHANGED"
  | "COMPOSITION_DRIFT"
  | "HUMAN_EDIT_LINEAGE_INVALID"
  | "PROTECTED_NODE_MISSING"
  | "STRUCTURAL_DEVIATION_UNACKNOWLEDGED"
  | "AI_NARRATIVE_NOT_ACCEPTED"
  | "LATE_BOUND_TAMPERED"
  | "AI_SLOT_UNRESOLVED"
  | "AI_SLOT_RESOLUTION_STALE";

export interface RevalidationIssue {
  readonly code: RevalidationIssueCode;
  readonly path: string;
  readonly message: string;
}

/** Elo da cadeia de edições humanas governadas do rascunho (ledger de edição; forma persistida: Lane A). */
export interface HumanEditLink {
  readonly editRef: string;
  readonly previousContentHash: Sha256;
  readonly resultingContentHash: Sha256;
  readonly editorUserId: number;
}

/** Aceite humano EXATO de uma narrativa de IA (slot + execução + hash do texto gerado). */
export interface AiNarrativeAcceptance {
  readonly organizationId: OrgId;
  readonly manifestId: string;
  readonly slotKey: string;
  readonly executionId: string;
  readonly outputHash: Sha256;
  readonly acceptedByUserId: number;
}

/** Ocorrências não sobrepostas de `needle` em `hay` (0 para needle vazio). */
function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
}

export type StructuralDeviationKind = "INCLUDED_BLOCK_REMOVED" | "EXCLUDED_BLOCK_INSERTED";

/** Reconhecimento humano registrado de um desvio estrutural (decisão revisável). */
export interface StructuralDeviationAcknowledgment {
  readonly blockId: string;
  readonly kind: StructuralDeviationKind;
  readonly acknowledgmentRef: string;
}

export interface RevalidationInput {
  readonly organizationId: OrgId;
  /** M1 persistido (imutável). */
  readonly generation: GenerationManifest;
  /** Recomposição com as fontes canônicas ATUAIS, a mesma revisão e as mesmas narrativas — ou o motivo da falha. */
  readonly recomposition: { readonly ok: true; readonly value: ComposedDocument } | { readonly ok: false; readonly issues: readonly ComposeIssue[] };
  /** Conteúdo exato que será emitido. */
  readonly issuedContent: string;
  readonly humanEdits: readonly HumanEditLink[];
  readonly aiAcceptances: readonly AiNarrativeAcceptance[];
  readonly acknowledgments: readonly StructuralDeviationAcknowledgment[];
  /**
   * E2 — resoluções humanas registradas dos slots pendentes (ledger). Ausente = nenhuma: todo slot pendente do texto composto bloqueia
   * (fail-closed).
   */
  readonly slotResolutions?: readonly SlotResolutionRecord[];
  /** Metadado operacional (fora dos hashes). */
  readonly checkedAt: string;
}

export interface RevalidationPassed {
  readonly record: CanonicalRevalidationRecord;
  readonly documentContentHash: Sha256;
  readonly humanEditRefs: readonly HumanEditRef[];
  /** Narrativas do M1 com o aceite humano conferido (`humanAccepted = true`). */
  readonly acceptedNarratives: readonly AiNarrativeRef[];
  /** E2 — slots pendentes resolvidos por pessoa, conferidos contra o conteúdo emitido (registrados no M2; vazio ⇒ campo ausente). */
  readonly slotResolutions: readonly SlotResolutionRef[];
}

export type RevalidationOutcome =
  | { readonly ok: true; readonly value: RevalidationPassed }
  | { readonly ok: false; readonly issues: readonly RevalidationIssue[] };

const RECOMPOSITION_SOURCE_CODES = new Set<string>(["MISSING_REQUIRED", "VALUE_TYPE_INVALID", "REFERENCE_NOT_PINNED", "CROSS_TENANT_REFERENCE"]);

function refKey(r: { role: string; documentId: string; lineageId: string; version: number; contentHash: string }): string {
  return `${r.role}|${r.documentId}|${r.lineageId}|${r.version}|${r.contentHash}`;
}

/** Fontes/autoridades que mudaram entre o M1 e a recomposição atual (lista estável). */
export function changedAuthorities(m1: GenerationManifest, current: GenerationManifest): string[] {
  const out: string[] = [];
  const keys = new Set([...m1.sources.map((s) => s.key), ...current.sources.map((s) => s.key)]);
  for (const k of [...keys].sort()) {
    const a = m1.sources.find((s) => s.key === k)?.digest ?? null;
    const b = current.sources.find((s) => s.key === k)?.digest ?? null;
    if (a !== b) out.push(`source:${k}`);
  }
  const roles = new Set([...m1.officialDocRefs.map((r) => r.role), ...current.officialDocRefs.map((r) => r.role)]);
  for (const role of [...roles].sort()) {
    const a = m1.officialDocRefs.find((r) => r.role === role);
    const b = current.officialDocRefs.find((r) => r.role === role);
    if (!a || !b || refKey(a) !== refKey(b)) out.push(`official:${role}`);
  }
  if (m1.identityFingerprint !== current.identityFingerprint) out.push("identity");
  return out;
}

/**
 * R3 (gate do PR #342) — RECOMPOSIÇÃO POR ATUALIZAÇÃO DAS FONTES. Para revisões SEM a capability de dados de publicação diferidos (ex.: Revisão 1),
 * a recomposição governada do rascunho só é permitida quando a minuta ficou DESATUALIZADA pelas fontes do próprio processo — exatamente a
 * condição que a revalidação da emissão recusa como `SOURCE_CHANGED`:
 *  - existe M1 anterior do rascunho, do MESMO órgão, da MESMA revisão exata do modelo (id + hash semântico) — troca de revisão não entra aqui;
 *  - alguma fonte/autoridade mudou entre o M1 anterior e a composição atual (`changedAuthorities`, a mesma regra da revalidação).
 * Sem mudança de fonte o comportamento legado permanece (rascunho diferente ⇒ CONFLICT). As demais garantias são as da recomposição existente
 * (origem modelo, nada emitido/aprovado, CAS do conteúdo visto, confirmação de edição humana, histórico append-only). Pura e determinística.
 */
export function sourceRefreshRecompositionAllowed(previous: GenerationManifest | null | undefined, next: GenerationManifest): boolean {
  if (!previous || previous.stage !== "GENERATION") return false;
  if (previous.organizationId !== next.organizationId) return false;
  if (previous.templateRevisionId !== next.templateRevisionId || previous.templateSemanticHash !== next.templateSemanticHash) return false;
  return changedAuthorities(previous, next).length > 0;
}

/** Cadeia de edições: começa no texto composto, é contígua e termina exatamente no conteúdo emitido. */
export function humanEditLineageIssues(composedOutputHash: Sha256, documentContentHash: Sha256, edits: readonly HumanEditLink[]): RevalidationIssue[] {
  if (edits.length === 0) {
    return documentContentHash === composedOutputHash
      ? []
      : [{ code: "HUMAN_EDIT_LINEAGE_INVALID", path: "humanEdits", message: "conteúdo a emitir difere do composto sem edição humana registrada" }];
  }
  const out: RevalidationIssue[] = [];
  let expected = composedOutputHash;
  edits.forEach((e, i) => {
    if (!e.editRef || !isSha256(e.previousContentHash) || !isSha256(e.resultingContentHash) || !Number.isSafeInteger(e.editorUserId) || e.editorUserId <= 0) {
      out.push({ code: "HUMAN_EDIT_LINEAGE_INVALID", path: `humanEdits[${i}]`, message: "edição exige editRef, hashes e editor humano" });
    } else if (e.previousContentHash !== expected) {
      out.push({ code: "HUMAN_EDIT_LINEAGE_INVALID", path: `humanEdits[${i}]`, message: "cadeia de edições não é contígua a partir do texto composto" });
    }
    expected = e.resultingContentHash;
  });
  if (expected !== documentContentHash) {
    out.push({ code: "HUMAN_EDIT_LINEAGE_INVALID", path: "humanEdits", message: "a última edição registrada não produz o conteúdo a emitir" });
  }
  return out;
}

export interface StructuralDeviationStatus {
  readonly blockId: string;
  readonly kind: StructuralDeviationKind;
  /** Referência do reconhecimento humano registrado; `null` = ainda sem reconhecimento. */
  readonly acknowledgmentRef: string | null;
}

/**
 * Desvios estruturais de blocos condicionais entre o texto COMPOSTO e o conteúdo a emitir, com o estado do reconhecimento humano.
 * Fonte ÚNICA da regra: a emissão (`revalidateForIssuance`) e a inspeção de revisão da UI usam exatamente esta função.
 * E2: a âncora é cortada no primeiro marcador `[REVISAR` (`deviationAnchor`) — preencher o marcador não é desvio estrutural.
 * Âncoras podem se repetir em OUTROS trechos (ex.: título de tabela igual em ramos diferentes): a comparação é por OCORRÊNCIAS contra
 * a própria composição — remoção = menos ocorrências que o composto; inserção = mais ocorrências que o composto.
 */
/**
 * Âncora efetiva para detectar desvio: o primeiro trecho LITERAL da âncora fora de marcadores `[REVISAR…]` (marcador é texto destinado a ser
 * substituído pela pessoa — redigir o trecho pendente ou informar o dado nunca é "remover o bloco"). Âncora que começa no marcador usa o
 * texto depois dele (fail-closed: o bloco continua detectável); âncora só de marcador ⇒ sem âncora.
 */
export function deviationAnchor(anchor: string | null): string | null {
  if (!anchor) return null;
  for (const piece of anchor.split(/\[REVISAR[^\]]*\]?/)) {
    const t = piece.trim();
    if (t.length >= 3) return t;
  }
  return null;
}

export function structuralDeviationStatus(
  blocks: readonly { readonly blockId: string; readonly includedAnchor: string | null; readonly excludedAnchor: string | null }[],
  composedText: string, issuedContent: string, acknowledgments: readonly StructuralDeviationAcknowledgment[],
): StructuralDeviationStatus[] {
  const out: StructuralDeviationStatus[] = [];
  for (const raw of blocks) {
    const b = { blockId: raw.blockId, includedAnchor: deviationAnchor(raw.includedAnchor), excludedAnchor: deviationAnchor(raw.excludedAnchor) };
    const found: StructuralDeviationKind[] = [];
    if (b.includedAnchor && countOccurrences(issuedContent, b.includedAnchor) < countOccurrences(composedText, b.includedAnchor)) found.push("INCLUDED_BLOCK_REMOVED");
    if (b.excludedAnchor && b.excludedAnchor !== b.includedAnchor && countOccurrences(issuedContent, b.excludedAnchor) > countOccurrences(composedText, b.excludedAnchor)) found.push("EXCLUDED_BLOCK_INSERTED");
    for (const kind of found) {
      const ack = acknowledgments.find((a) => a.blockId === b.blockId && a.kind === kind && a.acknowledgmentRef);
      out.push({ blockId: b.blockId, kind, acknowledgmentRef: ack ? ack.acknowledgmentRef : null });
    }
  }
  return out;
}

/** Revalidação canônica completa. Nunca devolve "corrigido": ou passa, ou bloqueia com os motivos. */
export function revalidateForIssuance(input: RevalidationInput): RevalidationOutcome {
  const m1 = input.generation;
  const issues: RevalidationIssue[] = [];

  // 0. M1 íntegro e do mesmo tenant.
  const m1Check = validateManifest(m1);
  if (!m1Check.ok) return { ok: false, issues: m1Check.issues };
  if (m1.stage !== "GENERATION") return { ok: false, issues: [{ code: "MANIFEST_INVALID", path: "generation.stage", message: "revalidação parte do M1 (GENERATION)" }] };
  if (m1.organizationId !== input.organizationId) return { ok: false, issues: [{ code: "CROSS_TENANT_REFERENCE", path: "generation.organizationId", message: "manifest de outra organização" }] };

  // 1. Recomposição com as fontes atuais. Falha por fonte ausente/divergente = fonte mudou (bloqueia; não regenera).
  if (!input.recomposition.ok) {
    const sourceRelated = input.recomposition.issues.some((i) => RECOMPOSITION_SOURCE_CODES.has(i.code));
    return {
      ok: false,
      issues: [
        { code: sourceRelated ? "SOURCE_CHANGED" : "COMPOSITION_DRIFT", path: "recomposition", message: "as fontes canônicas atuais não recompõem o documento" },
        ...input.recomposition.issues,
      ],
    };
  }
  const re = input.recomposition.value;
  const cur = re.manifest;
  if (cur.organizationId !== m1.organizationId) return { ok: false, issues: [{ code: "CROSS_TENANT_REFERENCE", path: "recomposition", message: "recomposição de outra organização" }] };
  if (cur.templateRevisionId !== m1.templateRevisionId || cur.templateIdentityId !== m1.templateIdentityId || cur.templateSemanticHash !== m1.templateSemanticHash
      || cur.catalogVersion !== m1.catalogVersion || cur.generatedDocumentId !== m1.generatedDocumentId) {
    return { ok: false, issues: [{ code: "REFERENCE_NOT_PINNED", path: "recomposition", message: "a recomposição não usa a mesma revisão/catálogo/rascunho do M1" }] };
  }

  // 2. SOURCE_CHANGED — fontes, documentos oficiais referenciados e identidade.
  const changed = changedAuthorities(m1, cur);
  if (changed.length) {
    return { ok: false, issues: [{ code: "SOURCE_CHANGED", path: "sources", message: `fontes canônicas mudaram desde a composição: ${changed.join(", ")} — emissão bloqueada; recomponha e revise antes de emitir` }] };
  }
  // 3. Mesmas fontes ⇒ mesma composição (determinismo do composer, decisões condicionais e narrativas).
  if (re.composedOutputHash !== m1.composedOutputHash || templateHash(cur.conditionalDecisions) !== templateHash(m1.conditionalDecisions)
      || templateHash(cur.aiNarratives) !== templateHash(m1.aiNarratives)) {
    return { ok: false, issues: [{ code: "COMPOSITION_DRIFT", path: "composedOutputHash", message: "a composição atual não reproduz o texto registrado no M1 (dados, narrativas ou apresentação do modelo mudaram desde a composição) — recomponha a minuta pelo modelo e revise antes de emitir" }] };
  }

  // 4. Edição humana: cadeia explícita até o conteúdo emitido.
  const documentContentHash = sha256Hex(input.issuedContent);
  issues.push(...humanEditLineageIssues(m1.composedOutputHash, documentContentHash, input.humanEdits));

  // 4b. Campos de sistema late-bound: marcadores íntegros (nem removidos, nem duplicados, nem forjados). Só o ato de emissão os resolve.
  for (const why of lateBoundTamperIssues(m1.lateBound ?? [], re.content.text, input.issuedContent)) {
    issues.push({ code: "LATE_BOUND_TAMPERED", path: "lateBound", message: `campo de sistema do ciclo de vida violado — ${why}` });
  }

  // 5. Nós canônicos protegidos presentes no conteúdo emitido.
  const protectedNodes = re.protectedFragments.map((f) => ({ nodeId: f.nodeId, expectedFragmentHash: f.fragmentHash, found: input.issuedContent.includes(f.text) }));
  protectedNodes.filter((n) => !n.found).forEach((n) => {
    issues.push({ code: "PROTECTED_NODE_MISSING", path: n.nodeId, message: "valor canônico/referência oficial do texto composto ausente no conteúdo a emitir" });
  });

  // 6. Desvios estruturais de blocos condicionais (só com reconhecimento humano registrado). Fonte ÚNICA: `structuralDeviationStatus`.
  const deviations: { blockId: string; kind: StructuralDeviationKind; acknowledgmentRef: string }[] = [];
  for (const d of structuralDeviationStatus(re.structuralBlocks, re.content.text, input.issuedContent, input.acknowledgments)) {
    if (d.acknowledgmentRef) deviations.push({ blockId: d.blockId, kind: d.kind, acknowledgmentRef: d.acknowledgmentRef });
    else issues.push({ code: "STRUCTURAL_DEVIATION_UNACKNOWLEDGED", path: d.blockId, message: `${d.kind} em ${d.blockId} sem reconhecimento humano registrado` });
  }

  // 7. IA: todo trecho de IA do M1 exige aceite humano EXATO.
  const acceptedNarratives: AiNarrativeRef[] = m1.aiNarratives.map((n) => {
    const acc = input.aiAcceptances.find((a) => a.organizationId === input.organizationId && a.manifestId === m1.id && a.slotKey === n.slotKey
      && a.executionId === n.executionId && a.outputHash === n.outputHash && Number.isSafeInteger(a.acceptedByUserId) && a.acceptedByUserId > 0);
    if (!acc) issues.push({ code: "AI_NARRATIVE_NOT_ACCEPTED", path: `aiNarratives.${n.slotKey}`, message: "narrativa de IA sem aceite humano registrado — emissão bloqueada" });
    return { ...n, humanAccepted: !!acc };
  });

  // 8. E2 — slots pendentes do texto composto: cada um exige resolução HUMANA registrada e coerente com o trecho emitido.
  const slotChecks = evaluateSlotResolutions({
    organizationId: input.organizationId, manifestId: m1.id, composedText: re.content.text, issuedContent: input.issuedContent,
    resolutions: input.slotResolutions ?? [],
  });
  for (const c of slotChecks) {
    // Marcador AINDA no texto: a trava de marcadores pendentes da emissão (UNRESOLVED_MARKERS / EMISSION_REVIEW_MARKERS) já recusa e a tela
    // lista o trecho como pendente; aqui a regra acusa o que só ela vê — marcador REMOVIDO sem resolução e resolução desatualizada.
    if (c.state === "PENDING" && input.issuedContent.includes(pendingSlotMark(c.slotKey))) continue;
    if (c.state === "PENDING") issues.push({ code: "AI_SLOT_UNRESOLVED", path: `aiSlots.${c.slotKey}`, message: `trecho "${c.label}" sem resolução humana registrada (${c.reason}) — emissão bloqueada` });
    else if (c.state === "STALE") issues.push({ code: "AI_SLOT_RESOLUTION_STALE", path: `aiSlots.${c.slotKey}`, message: `trecho "${c.label}": ${c.reason} — emissão bloqueada` });
  }

  if (issues.length) return { ok: false, issues };

  const checkedAuthorities = [
    { authority: "template", sourceVersion: m1.templateRevisionId, sourceHash: m1.templateSemanticHash },
    { authority: "identity", sourceVersion: m1.identityFingerprint, sourceHash: templateHash(m1.identityFingerprint) },
    ...m1.sources.map((s) => ({ authority: `source:${s.key}`, sourceVersion: s.digest, sourceHash: templateHash(s.digest) })),
    ...m1.officialDocRefs.map((r) => ({ authority: `official:${r.role}`, sourceVersion: `${r.lineageId}@v${r.version}`, sourceHash: r.contentHash })),
  ].sort((a, b) => (a.authority < b.authority ? -1 : a.authority > b.authority ? 1 : 0));
  const base = {
    status: (deviations.length ? "PASSED_WITH_ACKNOWLEDGED_STRUCTURAL_DEVIATIONS" : "PASSED") as CanonicalRevalidationRecord["status"],
    validatorVersion: TEMPLATE_REVALIDATOR_VERSION,
    checkedAuthorities,
    protectedNodes: protectedNodes.map((n) => ({ nodeId: n.nodeId, expectedFragmentHash: n.expectedFragmentHash, found: true as const })),
    structuralDeviations: deviations,
    checkedAt: input.checkedAt,
  };
  const record: CanonicalRevalidationRecord = { ...base, resultHash: computeRevalidationResultHash({ ...base, resultHash: "" }) };
  return {
    ok: true,
    value: {
      record,
      documentContentHash,
      humanEditRefs: input.humanEdits.map((e) => ({ editRef: e.editRef, resultingContentHash: e.resultingContentHash })),
      acceptedNarratives,
      slotResolutions: slotResolutionRefs(slotChecks),
    },
  };
}

/** Id determinístico do M2: o mesmo M1 emitido com o mesmo conteúdo ⇒ o mesmo id (retry não duplica). */
export function issuanceManifestId(generationManifestId: string, documentContentHash: Sha256): string {
  return `tplm2_${sha256Hex(`m2:${generationManifestId}:${documentContentHash}`).slice(0, 18)}`;
}

/**
 * Deriva o M2 do M1 (o M1 NÃO é alterado: o objeto de entrada fica intacto e o M2 é um registro novo). As narrativas
 * entram com o aceite conferido na revalidação; `derivedFromManifestId` aponta para o M1.
 */
export function buildIssuanceManifest(
  generation: GenerationManifest, passed: RevalidationPassed, createdAt: string, lifecycleBindings: readonly LifecycleBinding[] = [],
): ReturnType<typeof deriveIssuanceManifest> {
  // Com binding de lifecycle o conteúdo OFICIAL é o do último binding; a cadeia humana termina no conteúdo ANTES do binding.
  const officialHash = lifecycleBindings.length > 0 ? lifecycleBindings[lifecycleBindings.length - 1].afterContentHash : passed.documentContentHash;
  return deriveIssuanceManifest(
    { ...generation, aiNarratives: passed.acceptedNarratives },
    {
      id: issuanceManifestId(generation.id, officialHash),
      createdAt,
      documentContentHash: officialHash,
      lifecycleBindings,
      humanEditRefs: passed.humanEditRefs,
      canonicalRevalidation: passed.record,
      slotResolutions: passed.slotResolutions,
    },
  );
}

export type { IssuanceManifest };

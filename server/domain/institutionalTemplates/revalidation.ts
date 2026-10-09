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
 *  - AI_NARRATIVE_NOT_ACCEPTED: narrativa de IA do M1 sem aceite humano exato (slot + execução + hash do texto).
 * O M2 é DERIVADO do M1 (INSERT-only; o M1 nunca é reescrito) com `documentContentHash`, `humanEditRefs` e o registro
 * da revalidação (`checkedAt` fora de qualquer hash). Id do M2 determinístico ⇒ retry da transação não duplica efeito.
 */
import { sha256Hex } from "../canonicalJson";
import type { ComposedDocument, ComposeIssue } from "./composer";
import {
  computeRevalidationResultHash, deriveIssuanceManifest, validateManifest,
  type AiNarrativeRef, type CanonicalRevalidationRecord, type GenerationManifest, type HumanEditRef, type IssuanceManifest,
} from "./manifest";
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
  | "AI_NARRATIVE_NOT_ACCEPTED";

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
  /** Metadado operacional (fora dos hashes). */
  readonly checkedAt: string;
}

export interface RevalidationPassed {
  readonly record: CanonicalRevalidationRecord;
  readonly documentContentHash: Sha256;
  readonly humanEditRefs: readonly HumanEditRef[];
  /** Narrativas do M1 com o aceite humano conferido (`humanAccepted = true`). */
  readonly acceptedNarratives: readonly AiNarrativeRef[];
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
 * Âncoras podem se repetir em OUTROS trechos (ex.: título de tabela igual em ramos diferentes): a comparação é por OCORRÊNCIAS contra
 * a própria composição — remoção = menos ocorrências que o composto; inserção = mais ocorrências que o composto.
 */
export function structuralDeviationStatus(
  blocks: readonly { readonly blockId: string; readonly includedAnchor: string | null; readonly excludedAnchor: string | null }[],
  composedText: string, issuedContent: string, acknowledgments: readonly StructuralDeviationAcknowledgment[],
): StructuralDeviationStatus[] {
  const out: StructuralDeviationStatus[] = [];
  for (const b of blocks) {
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
    return { ok: false, issues: [{ code: "COMPOSITION_DRIFT", path: "composedOutputHash", message: "as mesmas fontes não reproduzem o texto composto do M1" }] };
  }

  // 4. Edição humana: cadeia explícita até o conteúdo emitido.
  const documentContentHash = sha256Hex(input.issuedContent);
  issues.push(...humanEditLineageIssues(m1.composedOutputHash, documentContentHash, input.humanEdits));

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
export function buildIssuanceManifest(generation: GenerationManifest, passed: RevalidationPassed, createdAt: string): ReturnType<typeof deriveIssuanceManifest> {
  return deriveIssuanceManifest(
    { ...generation, aiNarratives: passed.acceptedNarratives },
    {
      id: issuanceManifestId(generation.id, passed.documentContentHash),
      createdAt,
      documentContentHash: passed.documentContentHash,
      humanEditRefs: passed.humanEditRefs,
      canonicalRevalidation: passed.record,
    },
  );
}

export type { IssuanceManifest };

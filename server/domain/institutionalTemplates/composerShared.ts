/**
 * Institutional Templates — peças do composer COMPARTILHADAS entre o contrato v1 (`tpl-ast/1`) e v2 (`tpl-ast/2`).
 *
 * Extraídas de `composer.ts` sem alterar o comportamento (os corpos são os mesmos; `composer.ts` as reexporta, então
 * nenhum import existente muda). O replay do v1 é protegido por testes dourados (hash semântico, saída composta e
 * manifest de uma composição v1 de referência). Nada aqui conhece versão de AST: pin exato, tenant, validação de pins
 * oficiais e narrativas de IA, formatação determinística, selagem do M1.
 */
import { sha256Hex } from "../canonicalJson";
import { SOURCE_DIGEST_PREFIX } from "../sourceDigests";
import type {
  AiNarrativeOutput, CanonicalSourceSnapshot, ComposeIssue, ComposeResult, OfficialDocumentPin, TemplateComposeRequest,
} from "./composer";
import {
  MANIFEST_SOURCE_KEYS, manifestRevisionIssues, sealGenerationManifest,
  type AiNarrativeRef, type AnnexRef, type ConditionalDecisionRef, type GenerationManifest, type ManifestSourceKey,
  type ManifestSourceRef, type OfficialDocumentReference,
} from "./manifest";
import { TEMPLATE_ID_RE } from "./revision";
import { templateHash } from "./semanticHash";
import { TEMPLATE_HASH_VERSION, isSha256, type OrgId, type Sha256 } from "./types";
import type { VariableSource2 } from "./variableCatalog2";

/** Fonte do catálogo → chave de fonte do manifest. IDENTITY é coberta pelo `identityFingerprint`. */
export const CATALOG_SOURCE_TO_MANIFEST_KEY: Readonly<Record<VariableSource2, ManifestSourceKey | null>> = {
  PROCESS: "processo", DFD: "dfd", ETP: "etp", TR: "tr", ITEMS: "itens", PARAMS: "parametros", IDENTITY: null,
  BUDGET: "orcamento", CERTAME_CONFIG: "certame", POLICY: "politica", NORMATIVE: "normativo", RESULT: "resultado", LIFECYCLE: "ciclo",
};

const FORBIDDEN_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);
const PATH_SEGMENT_RE = /^[A-Za-z0-9_]{1,64}$/;

/** Leitura por caminho pontuado, só em propriedades PRÓPRIAS de objetos simples (sem protótipo, sem expressão). */
export function readCatalogPath(data: unknown, path: string): unknown {
  let cur: unknown = data;
  for (const seg of path.split(".")) {
    if (!PATH_SEGMENT_RE.test(seg) || FORBIDDEN_PATH_SEGMENTS.has(seg)) return undefined;
    if (typeof cur !== "object" || cur === null || Array.isArray(cur)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

export function isAbsent(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

/** Pin de fonte do manifest: `srcd:<chave>=<sha256 do snapshot canônico integral>` (tpl-hash/1). */
export function canonicalSourceDigest(key: ManifestSourceKey, snapshot: CanonicalSourceSnapshot): string {
  return `${SOURCE_DIGEST_PREFIX}${key}=${templateHash(snapshot.data ?? null)}`;
}

export function manifestSourceRefs(
  usedSources: readonly VariableSource2[],
  sources: Partial<Readonly<Record<VariableSource2, CanonicalSourceSnapshot>>>,
): ManifestSourceRef[] {
  const byKey = new Map<ManifestSourceKey, string>();
  for (const src of usedSources) {
    const key = CATALOG_SOURCE_TO_MANIFEST_KEY[src];
    const snap = sources[src];
    if (key && snap) byKey.set(key, canonicalSourceDigest(key, snap));
  }
  return MANIFEST_SOURCE_KEYS.filter((k) => byKey.has(k)).map((k) => ({ key: k, digest: byKey.get(k)! }));
}

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** pt-BR determinístico: "1.234,5". */
export function formatNumberPtBr(n: number): string {
  const [intPart, frac] = String(Math.abs(n)).split(".");
  return `${n < 0 ? "-" : ""}${groupThousands(intPart)}${frac ? `,${frac}` : ""}`;
}

/** Texto inline: quebras de linha viram espaço (um valor nunca cria estrutura no documento). */
export function inlineText(s: string): string {
  return s.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/** Célula de tabela: `|` escapado e sem quebra de linha. */
export function cell(s: string): string {
  return inlineText(s).replace(/\|/g, "\\|");
}

export const MISSING_VALUE_MARK = (name: string): string => `[REVISAR: ${name} não informado]`;
export const PENDING_AI_SLOT_MARK = (slotKey: string): string => `[REVISAR: narrativa "${slotKey}" pendente de redação supervisionada]`;

/** Neutraliza estrutura Markdown no início de cada linha da narrativa de IA (a IA não cria título, lista, tabela…). */
export function neutralizeNarrative(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/^(\s*)([#>|*+-]|\d+[.)]|```|---)/, "$1\\$2"))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Limite de tamanho da narrativa por slot: nº de palavras ≤ `maxTokens` (contagem determinística, sem tokenizer). */
export function narrativeWordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function firstLine(blocks: readonly string[]): string | null {
  for (const b of blocks) {
    const line = b.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
    if (line) return line;
  }
  return null;
}

/** Id determinístico do M1: mesmo rascunho + mesmo conteúdo semântico ⇒ mesmo id (replay sem efeito duplicado). */
export function generationManifestId(organizationId: OrgId, generatedDocumentId: string, manifestHash: Sha256): string {
  return `tplm1_${sha256Hex(`m1:${organizationId}:${generatedDocumentId}:${manifestHash}`).slice(0, 18)}`;
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

/** Pin EXATO da revisão: ausente/vazio/`latest` ⇒ BINDING_REVISION_NOT_PINNED; divergência ⇒ recusa. */
export function pinIssues(req: TemplateComposeRequest): ComposeIssue[] {
  const pin = req.pin;
  if (!pin || typeof pin.revisionId !== "string" || !pin.revisionId || pin.revisionId.toLowerCase() === "latest" || !TEMPLATE_ID_RE.test(pin.revisionId)) {
    return [{ code: "BINDING_REVISION_NOT_PINNED", path: "pin.revisionId", message: "composição exige a revisão EXATA (resolução por 'última' é proibida)" }];
  }
  const out: ComposeIssue[] = [];
  if (pin.revisionId !== req.revision.id) out.push({ code: "REFERENCE_NOT_PINNED", path: "pin.revisionId", message: "revisão informada difere da revisão fixada" });
  if (pin.identityId !== req.revision.identityId || pin.identityId !== req.identity.id) out.push({ code: "REFERENCE_NOT_PINNED", path: "pin.identityId", message: "identidade do template difere do pin" });
  if (!isSha256(pin.semanticHash) || pin.semanticHash !== req.revision.semanticHash) out.push({ code: "MANIFEST_HASH_MISMATCH", path: "pin.semanticHash", message: "hash semântico difere do pin" });
  return out;
}

/** Referências oficiais e narrativas de IA: mesmo tenant, pins completos, slots existentes no AST. */
export function pinsAndNarrativesCheck(
  req: TemplateComposeRequest, aiSlots: readonly string[],
): { readonly issues: ComposeIssue[]; readonly narratives: Map<string, AiNarrativeOutput> } {
  const issues: ComposeIssue[] = [];
  for (const [kind, pin] of Object.entries(req.officialDocuments) as [string, OfficialDocumentPin | undefined][]) {
    if (!pin) continue;
    if (pin.organizationId !== req.organizationId) issues.push({ code: "CROSS_TENANT_REFERENCE", path: `officialDocuments.${kind}`, message: "documento oficial de outra organização" });
    if (!pin.documentId || !pin.lineageId || !Number.isSafeInteger(pin.version) || pin.version < 1 || !isSha256(pin.contentHash) || !pin.title) {
      issues.push({ code: "REFERENCE_NOT_PINNED", path: `officialDocuments.${kind}`, message: "pin oficial exige documentId + lineageId + version + contentHash + title" });
    }
  }
  const narratives = new Map<string, AiNarrativeOutput>();
  req.aiNarratives.forEach((a, i) => {
    const p = `aiNarratives[${i}]`;
    if (a.organizationId !== req.organizationId) issues.push({ code: "CROSS_TENANT_REFERENCE", path: p, message: "narrativa de IA de outra organização" });
    if (!aiSlots.includes(a.slotKey)) issues.push({ code: "AI_SLOT_UNKNOWN", path: p, message: `slot de IA inexistente na revisão: ${String(a.slotKey)}` });
    if (!a.executionId || typeof a.text !== "string" || !a.text.trim()) issues.push({ code: "AI_OUTPUT_INVALID", path: p, message: "narrativa exige executionId e texto" });
    if (narratives.has(a.slotKey)) issues.push({ code: "AI_OUTPUT_INVALID", path: p, message: `mais de uma narrativa para o slot ${a.slotKey}` });
    narratives.set(a.slotKey, a);
  });
  return { issues, narratives };
}

export interface ManifestParts {
  readonly composedOutputHash: Sha256;
  readonly sources: readonly ManifestSourceRef[];
  readonly officialDocRefs: readonly OfficialDocumentReference[];
  readonly conditionalDecisions: readonly ConditionalDecisionRef[];
  readonly aiNarratives: readonly AiNarrativeRef[];
  readonly annexes: readonly AnnexRef[];
}

/** M1 selado (id derivado do conteúdo semântico; `createdAt` fora do hash) + consistência manifest × revisão. */
export function sealComposedManifest(
  req: TemplateComposeRequest, parts: ManifestParts, purpose: "GENERATION" | "REVALIDATION" | "PREVIEW",
): ComposeResult<GenerationManifest> {
  const draft: Omit<GenerationManifest, "manifestHash"> = {
    stage: "GENERATION",
    id: "tplm1_pending",
    organizationId: req.organizationId,
    generatedDocumentId: req.generatedDocumentId,
    templateIdentityId: req.revision.identityId,
    templateRevisionId: req.revision.id,
    templateSemanticHash: req.revision.semanticHash,
    hashVersion: TEMPLATE_HASH_VERSION,
    catalogVersion: req.catalog.version,
    sources: parts.sources,
    officialDocRefs: parts.officialDocRefs,
    conditionalDecisions: parts.conditionalDecisions,
    aiNarratives: parts.aiNarratives,
    annexes: parts.annexes,
    identityFingerprint: req.identityFingerprint,
    composedOutputHash: parts.composedOutputHash,
    createdAt: req.createdAt,
  };
  const provisional = sealGenerationManifest(draft);
  if (!provisional.ok) return { ok: false, issues: provisional.issues };
  const sealed = sealGenerationManifest({ ...draft, id: generationManifestId(req.organizationId, req.generatedDocumentId, provisional.value.manifestHash) });
  if (!sealed.ok) return { ok: false, issues: sealed.issues };
  // PREVIEW: o manifest é descartável e a revisão pode estar em qualquer estado ⇒ só o estado deixa de ser exigido.
  const consistency = manifestRevisionIssues(sealed.value, req.revision)
    .filter((i) => purpose !== "PREVIEW" || i.code !== "BINDING_REVISION_NOT_PUBLISHED");
  if (consistency.length) return { ok: false, issues: consistency };
  return { ok: true, value: sealed.value };
}

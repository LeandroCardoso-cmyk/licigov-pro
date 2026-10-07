/**
 * Institutional Templates — COMPOSER determinístico (Lane B; implementa o contrato `composerContract.ts` do T1).
 *
 * TEMPLATE = FORMA · DOMÍNIO = VERDADE. O template só define estrutura e apresentação lógica; todo valor vem das
 * FONTES CANÔNICAS que quem chama já resolveu no domínio institucional (snapshots por fonte do catálogo). O composer:
 *  - exige a revisão EXATA (pin `identityId + revisionId + semanticHash`); "latest"/ausente ⇒ BINDING_REVISION_NOT_PINNED;
 *  - resolve variáveis só pelo catálogo versionado (fonte + caminho pertencem ao catálogo, nunca ao template);
 *  - avalia condições só com a DSL fechada do T1 sobre os valores canônicos (sem eval, JS, SQL, rede, regex livre,
 *    IA ou include recursivo) e registra trilha + hash de cada decisão;
 *  - usa IA SOMENTE em `aiSlot`: a narrativa chega pronta (executionId auditável), não escolhe template, revisão,
 *    condição, fato, número, regra, aprovação ou emissão; valor monetário que a IA escreva fora do quadro canônico é
 *    marcado `[REVISAR…]` (que bloqueia a emissão) e a narrativa NUNCA nasce aceita (`humanAccepted = false`);
 *  - referencia documentos oficiais só por pin exato (documento + linhagem + versão + hash) do MESMO tenant;
 *  - produz o Composition Manifest M1 selado. Mesma entrada canônica ⇒ mesmo texto, mesmo `composedOutputHash`,
 *    mesmo `manifestHash`. `createdAt` é metadado operacional (fora do hash).
 * Puro: sem I/O, relógio, aleatoriedade ou IA. Erro ⇒ falha fechada (nunca fallback para outro caminho).
 */
import { formatBRL } from "../money";
import { flagUnverifiedAmounts } from "../aiNumericAuthority";
import { sha256Hex } from "../canonicalJson";
import { SOURCE_DIGEST_PREFIX } from "../sourceDigests";
import { referencedVariables, type DocRefKind, type Inline, type TemplateNode } from "./ast";
import type { ComposedContent, ComposeInput } from "./composerContract";
import { evaluateCondition } from "./conditionalDsl";
import {
  manifestRevisionIssues, sealGenerationManifest, MANIFEST_SOURCE_KEYS,
  type AiNarrativeRef, type AnnexRef, type ConditionalDecisionRef, type GenerationManifest, type ManifestSourceKey,
  type ManifestSourceRef, type OfficialDocumentReference,
} from "./manifest";
import { validateTemplateRevision, TEMPLATE_ID_RE, type TemplateIdentity } from "./revision";
import { templateHash } from "./semanticHash";
import { organizationIssues, sameOrganizationIssues } from "./tenant";
import { TEMPLATE_HASH_VERSION, isOrgId, isSha256, type OrgId, type Sha256, type TemplateIssueCode } from "./types";
import { findVariable, type VariableCatalog, type VariableDef, type VariableSource } from "./variableCatalog";

// ─── Contrato de entrada/saída ──────────────────────────────────────────────────────────────────────────────────────

/** Códigos do composer: os do T1 + os específicos da composição (sem alterar o contrato congelado do T1). */
export type ComposeIssueCode =
  | TemplateIssueCode
  | "MISSING_REQUIRED"
  | "VALUE_TYPE_INVALID"
  | "AI_SLOT_UNKNOWN"
  | "AI_OUTPUT_INVALID";

export interface ComposeIssue {
  readonly code: ComposeIssueCode;
  readonly path: string;
  readonly message: string;
}

export type ComposeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ComposeIssue[] };

/** Pin EXATO da revisão. Não existe "latest": quem chama informa o id e o hash semântico da revisão publicada. */
export interface RevisionPin {
  readonly identityId: string;
  readonly revisionId: string;
  readonly semanticHash: Sha256;
}

/** Snapshot de uma fonte canônica (domínio institucional), com o tenant de onde foi lido. */
export interface CanonicalSourceSnapshot {
  readonly organizationId: OrgId;
  readonly data: unknown;
}

/** Pin exato de documento oficial (o que o `docRef` do AST referencia), com o tenant de onde foi lido. */
export interface OfficialDocumentPin {
  readonly organizationId: OrgId;
  readonly documentId: string;
  readonly lineageId: string;
  readonly version: number;
  readonly contentHash: Sha256;
  readonly title: string;
}

/** Saída de IA JÁ produzida (fora do composer) para um `aiSlot`, com referência auditável da execução. */
export interface AiNarrativeOutput {
  readonly organizationId: OrgId;
  readonly slotKey: string;
  readonly executionId: string;
  readonly text: string;
}

/**
 * Entrada do composer. Estende o `ComposeInput` do T1 (revisão + catálogo) com o que o T1 deixou para esta fase:
 * organização, identidade, pin exato, fontes canônicas, referências oficiais, narrativas de IA e dados do M1.
 * O CONTEXTO CONDICIONAL são os próprios valores canônicos resolvidos pelo catálogo (a DSL só lê variáveis do catálogo).
 */
export interface TemplateComposeRequest extends Omit<ComposeInput, "values" | "aiNarratives"> {
  readonly organizationId: OrgId;
  readonly identity: TemplateIdentity;
  readonly pin: RevisionPin | null | undefined;
  readonly sources: Partial<Readonly<Record<VariableSource, CanonicalSourceSnapshot>>>;
  readonly officialDocuments: Partial<Readonly<Record<DocRefKind, OfficialDocumentPin>>>;
  readonly aiNarratives: readonly AiNarrativeOutput[];
  /** Fingerprint da identidade institucional vigente (= `official_document_artifacts.identity_fingerprint`). */
  readonly identityFingerprint: string;
  /** `generated_documents.id` do rascunho que receberá o conteúdo composto. */
  readonly generatedDocumentId: string;
  /** Metadado operacional (fora do hash). */
  readonly createdAt: string;
  /**
   * GENERATION (padrão): só revisão PUBLISHED compõe documento novo. REVALIDATION: recomposição de um documento já
   * composto — revisão DEPRECATED continua válida para quem já a referencia (DEPRECATED ≠ INVALID).
   * PREVIEW: pré-visualização de QUALQUER estado (nada é persistido, o manifest resultante é descartável).
   */
  readonly purpose?: "GENERATION" | "REVALIDATION" | "PREVIEW";
}

/** Fragmento canônico do texto composto (valor resolvido ou referência oficial) que a revalidação exige presente. */
export interface ProtectedFragment {
  readonly nodeId: string;
  readonly text: string;
  readonly fragmentHash: Sha256;
}

/** Bloco condicional: âncora (1ª linha renderizada) do ramo incluído e do excluído, para detectar desvio estrutural. */
export interface StructuralBlock {
  readonly blockId: string;
  readonly includedAnchor: string | null;
  readonly excludedAnchor: string | null;
}

export interface ComposedDocument {
  readonly content: ComposedContent;
  readonly composedOutputHash: Sha256;
  readonly manifest: GenerationManifest;
  readonly protectedFragments: readonly ProtectedFragment[];
  readonly structuralBlocks: readonly StructuralBlock[];
  /** Valores canônicos efetivamente usados (variáveis referenciadas pelo AST). */
  readonly values: Readonly<Record<string, unknown>>;
}

// ─── Fontes canônicas → variáveis ───────────────────────────────────────────────────────────────────────────────────

/** Fonte do catálogo → chave de fonte do manifest. IDENTITY é coberta pelo `identityFingerprint`. */
export const CATALOG_SOURCE_TO_MANIFEST_KEY: Readonly<Record<VariableSource, ManifestSourceKey | null>> = {
  PROCESS: "processo", DFD: "dfd", ETP: "etp", TR: "tr", ITEMS: "itens", PARAMS: "parametros", IDENTITY: null,
  CERTAME_CONFIG: "certame", POLICY: "politica", BUDGET: "orcamento", NORMATIVE: "normativo", LIFECYCLE: "ciclo", RESULT: "resultado",
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

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Teto de magnitude para `number`: evita notação exponencial na renderização. */
const MAX_PLAIN_NUMBER = 1e15;

function isAbsent(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function valueTypeIssue(def: VariableDef, v: unknown): string | null {
  switch (def.type) {
    case "string":
    case "enum":
      return typeof v === "string" ? null : "esperado texto";
    case "number":
      return typeof v === "number" && Number.isFinite(v) && Math.abs(v) < MAX_PLAIN_NUMBER ? null : "esperado número finito";
    case "money":
      return typeof v === "number" && Number.isSafeInteger(v) ? null : "esperado valor em centavos (inteiro)";
    case "date":
      return typeof v === "string" && ISO_DATE_RE.test(v) ? null : "esperada data AAAA-MM-DD";
    case "list":
      return Array.isArray(v) && v.every((x) => typeof x === "string" || (typeof x === "number" && Number.isFinite(x)))
        ? null : "esperada lista de textos/números";
  }
}

export interface ResolvedVariables {
  readonly values: Readonly<Record<string, unknown>>;
  /** Fontes do catálogo efetivamente consultadas pelas variáveis referenciadas (ordenadas). */
  readonly usedSources: readonly VariableSource[];
}

/**
 * Resolve as variáveis referenciadas pelo AST a partir dos snapshots canônicos, pelo catálogo. Valor obrigatório
 * ausente ⇒ MISSING_REQUIRED; tipo divergente do catálogo ⇒ VALUE_TYPE_INVALID; snapshot de outro tenant ⇒
 * CROSS_TENANT_REFERENCE. O template nunca injeta valor: só nomes do catálogo chegam aqui.
 */
export function resolveTemplateVariables(
  organizationId: OrgId,
  catalog: VariableCatalog,
  names: readonly string[],
  sources: Partial<Readonly<Record<VariableSource, CanonicalSourceSnapshot>>>,
): ComposeResult<ResolvedVariables> {
  const issues: ComposeIssue[] = [];
  for (const [key, snap] of Object.entries(sources) as [VariableSource, CanonicalSourceSnapshot | undefined][]) {
    if (!snap) continue;
    if (!isOrgId(snap.organizationId)) issues.push({ code: "ORGANIZATION_REQUIRED", path: `sources.${key}`, message: "snapshot sem organizationId" });
    else if (snap.organizationId !== organizationId) issues.push({ code: "CROSS_TENANT_REFERENCE", path: `sources.${key}`, message: "fonte canônica de outra organização" });
  }
  if (issues.length) return { ok: false, issues };

  const values: Record<string, unknown> = {};
  const used = new Set<VariableSource>();
  for (const name of names) {
    const def = findVariable(catalog, name);
    if (!def) { issues.push({ code: "UNKNOWN_VARIABLE", path: `vars.${name}`, message: `variável fora do catálogo ${catalog.version}` }); continue; }
    used.add(def.source);
    const snap = sources[def.source];
    const raw = snap ? readCatalogPath(snap.data, def.path) : undefined;
    if (isAbsent(raw)) {
      if (def.required) issues.push({ code: "MISSING_REQUIRED", path: `vars.${name}`, message: `valor canônico obrigatório ausente (${def.source}.${def.path})` });
      continue;
    }
    const typeProblem = valueTypeIssue(def, raw);
    if (typeProblem) { issues.push({ code: "VALUE_TYPE_INVALID", path: `vars.${name}`, message: `${typeProblem} (catálogo: ${def.type})` }); continue; }
    values[name] = Array.isArray(raw) ? [...raw] : raw; // cópia: o snapshot do chamador nunca é congelado/mutado
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { values, usedSources: [...used].sort() } };
}

/** Pin de fonte do manifest: `srcd:<chave>=<sha256 do snapshot canônico integral>` (tpl-hash/1). */
export function canonicalSourceDigest(key: ManifestSourceKey, snapshot: CanonicalSourceSnapshot): string {
  return `${SOURCE_DIGEST_PREFIX}${key}=${templateHash(snapshot.data ?? null)}`;
}

export function manifestSourceRefs(
  usedSources: readonly VariableSource[],
  sources: Partial<Readonly<Record<VariableSource, CanonicalSourceSnapshot>>>,
): ManifestSourceRef[] {
  const byKey = new Map<ManifestSourceKey, string>();
  for (const src of usedSources) {
    const key = CATALOG_SOURCE_TO_MANIFEST_KEY[src];
    const snap = sources[src];
    if (key && snap) byKey.set(key, canonicalSourceDigest(key, snap));
  }
  return MANIFEST_SOURCE_KEYS.filter((k) => byKey.has(k)).map((k) => ({ key: k, digest: byKey.get(k)! }));
}

// ─── Formatação determinística (independente de locale) ───────────────────────────────────────────────────────────

function groupThousands(intDigits: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** pt-BR determinístico: "1.234,5". */
export function formatNumberPtBr(n: number): string {
  const [intPart, frac] = String(Math.abs(n)).split(".");
  return `${n < 0 ? "-" : ""}${groupThousands(intPart)}${frac ? `,${frac}` : ""}`;
}

/** Texto inline: quebras de linha viram espaço (um valor nunca cria estrutura no documento). */
function inlineText(s: string): string {
  return s.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

export function formatCanonicalValue(def: VariableDef, v: unknown): string {
  switch (def.type) {
    case "money": return formatBRL(v as number);
    case "number": return formatNumberPtBr(v as number);
    case "date": {
      const m = ISO_DATE_RE.exec(v as string)!;
      return `${m[3]}/${m[2]}/${m[1]}`;
    }
    case "list": return (v as (string | number)[]).map((x) => (typeof x === "number" ? formatNumberPtBr(x) : inlineText(x))).join("; ");
    case "string":
    case "enum":
      return inlineText(v as string);
  }
}

export const MISSING_VALUE_MARK = (name: string): string => `[REVISAR: ${name} não informado]`;
export const PENDING_AI_SLOT_MARK = (slotKey: string): string => `[REVISAR: narrativa "${slotKey}" pendente de redação supervisionada]`;

// ─── Renderização ──────────────────────────────────────────────────────────────────────────────────────────────────

interface RenderCtx {
  readonly organizationId: OrgId;
  readonly catalog: VariableCatalog;
  readonly values: Readonly<Record<string, unknown>>;
  readonly allowedCents: ReadonlySet<number>;
  readonly docPins: Partial<Readonly<Record<DocRefKind, OfficialDocumentPin>>>;
  readonly narratives: ReadonlyMap<string, AiNarrativeOutput>;
  /** false ⇒ render "de rascunho" (ramo excluído): não registra decisões, referências, fragmentos nem narrativas. */
  readonly record: boolean;
  readonly issues: ComposeIssue[];
  readonly decisions: ConditionalDecisionRef[];
  readonly refs: Map<DocRefKind, OfficialDocumentReference>;
  readonly annexes: AnnexRef[];
  readonly ai: AiNarrativeRef[];
  readonly fragments: ProtectedFragment[];
  readonly blocks: StructuralBlock[];
}

function scratch(ctx: RenderCtx): RenderCtx {
  return { ...ctx, record: false, issues: [], decisions: [], refs: new Map(ctx.refs), annexes: [], ai: [], fragments: [], blocks: [] };
}

function protect(ctx: RenderCtx, nodeId: string, text: string): void {
  if (ctx.record && text.trim()) ctx.fragments.push({ nodeId, text, fragmentHash: sha256Hex(text) });
}

function renderInline(i: Inline, path: string, ctx: RenderCtx): string {
  switch (i.t) {
    case "text": return i.v;
    case "strong": return `**${i.v.map((x, k) => renderInline(x, `${path}.v[${k}]`, ctx)).join("")}**`;
    case "em": return `_${i.v.map((x, k) => renderInline(x, `${path}.v[${k}]`, ctx)).join("")}_`;
    case "var": {
      const def = findVariable(ctx.catalog, i.name);
      const v = ctx.values[i.name];
      if (!def || isAbsent(v)) return MISSING_VALUE_MARK(i.name);
      const text = formatCanonicalValue(def, v);
      protect(ctx, path, text);
      return text;
    }
  }
}

function renderInlines(xs: readonly Inline[], path: string, ctx: RenderCtx): string {
  return xs.map((x, k) => renderInline(x, `${path}[${k}]`, ctx)).join("");
}

/** Célula de tabela: `|` escapado e sem quebra de linha. */
function cell(s: string): string {
  return inlineText(s).replace(/\|/g, "\\|");
}

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

function renderNodes(nodes: readonly TemplateNode[], path: string, ctx: RenderCtx): string[] {
  return nodes.flatMap((n, k) => renderNode(n, `${path}[${k}]`, ctx));
}

function renderNode(n: TemplateNode, path: string, ctx: RenderCtx): string[] {
  switch (n.t) {
    case "heading":
      return [`${"#".repeat(n.level)} ${inlineText(renderInlines(n.text, `${path}.text`, ctx))}`];
    case "paragraph": {
      const text = renderInlines(n.inline, `${path}.inline`, ctx).trim();
      return text ? [text] : [];
    }
    case "list": {
      const lines = n.items.map((item, k) => {
        const body = renderNodes(item, `${path}.items[${k}]`, ctx).join("\n").split("\n");
        const bullet = n.ordered ? `${k + 1}. ` : "- ";
        const pad = " ".repeat(bullet.length);
        return body.map((l, j) => (j === 0 ? `${bullet}${l}` : l ? `${pad}${l}` : "")).join("\n");
      });
      return lines.length ? [lines.join("\n")] : [];
    }
    case "table": {
      const header = n.header.map((h, k) => cell(renderInlines(h, `${path}.header[${k}]`, ctx)));
      const rows = n.rows.map((r, ri) => r.map((c, ci) => cell(renderInlines(c, `${path}.rows[${ri}][${ci}]`, ctx))));
      const line = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
      return [[line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n")];
    }
    case "section":
      return renderNodes(n.children, `${path}.children`, ctx);
    case "conditional": {
      const ev = evaluateCondition(n.when, ctx.values, `${path}.when`);
      const chosen = ev.result ? n.then : (n.else ?? []);
      const other = ev.result ? (n.else ?? []) : n.then;
      const chosenPath = `${path}.${ev.result ? "then" : "else"}`;
      const otherPath = `${path}.${ev.result ? "else" : "then"}`;
      const included = renderNodes(chosen, chosenPath, ctx);
      if (ctx.record) {
        ctx.decisions.push({ nodePath: path, result: ev.result, traceHash: templateHash(ev.trace) });
        const excluded = renderNodes(other, otherPath, scratch(ctx));
        ctx.blocks.push({ blockId: path, includedAnchor: firstLine(included), excludedAnchor: firstLine(excluded) });
      }
      return included;
    }
    case "docRef": {
      const pin = ctx.docPins[n.kind];
      if (!pin) {
        if (ctx.record) ctx.issues.push({ code: "REFERENCE_NOT_PINNED", path, message: `referência oficial ${n.kind} sem pin exato` });
        return [];
      }
      const line = `> Documento de referência: ${inlineText(pin.title)} — ${n.kind}, versão ${pin.version} (${pin.documentId}, hash ${pin.contentHash.slice(0, 12)})`;
      if (ctx.record && !ctx.refs.has(n.kind)) {
        ctx.refs.set(n.kind, {
          role: n.kind.toLowerCase(), order: ctx.refs.size + 1, documentId: pin.documentId, lineageId: pin.lineageId,
          version: pin.version, contentHash: pin.contentHash, title: inlineText(pin.title),
        });
      }
      protect(ctx, path, line);
      return [line];
    }
    case "annex": {
      const title = inlineText(renderInlines(n.title, `${path}.title`, ctx));
      const body = [`## ${title}`, ...renderNodes(n.children, `${path}.children`, ctx)];
      if (ctx.record) ctx.annexes.push({ id: n.id, contentHash: sha256Hex(body.join("\n\n")) });
      return body;
    }
    case "aiSlot": {
      const out = ctx.narratives.get(n.slotKey);
      if (!out) return [PENDING_AI_SLOT_MARK(n.slotKey)];
      if (narrativeWordCount(out.text) > n.maxTokens) {
        if (ctx.record) ctx.issues.push({ code: "AI_OUTPUT_INVALID", path, message: `narrativa do slot "${n.slotKey}" excede ${n.maxTokens} palavras` });
        return [];
      }
      // A IA não cria autoridade numérica: valor monetário fora do quadro canônico recebe [REVISAR…].
      const { prose } = flagUnverifiedAmounts(neutralizeNarrative(out.text), ctx.allowedCents);
      if (ctx.record) ctx.ai.push({ slotKey: n.slotKey, executionId: out.executionId, outputHash: sha256Hex(out.text), humanAccepted: false });
      return prose ? [prose] : [];
    }
  }
}

function firstLine(blocks: readonly string[]): string | null {
  for (const b of blocks) {
    const line = b.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
    if (line) return line;
  }
  return null;
}

/** Valores monetários canônicos (centavos) que a IA pode citar sem marca. */
function canonicalCents(catalog: VariableCatalog, values: Readonly<Record<string, unknown>>): Set<number> {
  const out = new Set<number>();
  for (const [name, v] of Object.entries(values)) {
    const def = findVariable(catalog, name);
    if (def?.type === "money" && typeof v === "number" && v > 0) out.add(v);
  }
  return out;
}

/** AST: nós `docRef` e chaves de `aiSlot` (em ordem), sem renderizar. */
export function templateRequirements(nodes: readonly TemplateNode[]): { docRefKinds: DocRefKind[]; aiSlots: string[] } {
  const kinds = new Set<DocRefKind>();
  const slots: string[] = [];
  const walk = (ns: readonly TemplateNode[]): void => ns.forEach((n) => {
    switch (n.t) {
      case "list": n.items.forEach(walk); break;
      case "section": walk(n.children); break;
      case "conditional": walk(n.then); if (n.else) walk(n.else); break;
      case "annex": walk(n.children); break;
      case "docRef": kinds.add(n.kind); break;
      case "aiSlot": slots.push(n.slotKey); break;
      default: break;
    }
  });
  walk(nodes);
  return { docRefKinds: [...kinds].sort(), aiSlots: slots };
}

/** Id determinístico do M1: mesmo rascunho + mesmo conteúdo semântico ⇒ mesmo id (replay sem efeito duplicado). */
export function generationManifestId(organizationId: OrgId, generatedDocumentId: string, manifestHash: Sha256): string {
  return `tplm1_${sha256Hex(`m1:${organizationId}:${generatedDocumentId}:${manifestHash}`).slice(0, 18)}`;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}

// ─── Composição ────────────────────────────────────────────────────────────────────────────────────────────────────

function pinIssues(req: TemplateComposeRequest): ComposeIssue[] {
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

/**
 * Compõe o documento a partir da revisão exata e das fontes canônicas e sela o M1. Falha fechada com a lista de
 * problemas; nunca devolve conteúdo parcial.
 */
export function composeTemplate(req: TemplateComposeRequest): ComposeResult<ComposedDocument> {
  // 1. Tenant e pin exato — antes de qualquer leitura de conteúdo.
  const early: ComposeIssue[] = [...organizationIssues(req, "organizationId"), ...pinIssues(req)];
  if (isOrgId(req.organizationId)) {
    early.push(...sameOrganizationIssues(req, req.identity, "identity"), ...sameOrganizationIssues(req, req.revision, "revision"));
  }
  if (early.length) return { ok: false, issues: early };

  // 2. Revisão: estado + validação completa (AST, catálogo, hash recalculado).
  const purpose = req.purpose ?? "GENERATION";
  const composable = purpose === "PREVIEW" ? true
    : purpose === "GENERATION" ? req.revision.status === "PUBLISHED" : (req.revision.status === "PUBLISHED" || req.revision.status === "DEPRECATED");
  if (!composable) {
    return { ok: false, issues: [{ code: "BINDING_REVISION_NOT_PUBLISHED", path: "revision.status", message: `revisão ${req.revision.status} não compõe documento (${purpose})` }] };
  }
  const checked = validateTemplateRevision(req.revision, req.identity, req.catalog);
  if (!checked.ok) return { ok: false, issues: checked.issues };
  for (const k of ["identityFingerprint", "generatedDocumentId", "createdAt"] as const) {
    if (typeof req[k] !== "string" || !req[k]) return { ok: false, issues: [{ code: "MANIFEST_INVALID", path: k, message: `${k} obrigatório` }] };
  }

  // 3. Valores canônicos (só pelo catálogo).
  const resolved = resolveTemplateVariables(req.organizationId, req.catalog, referencedVariables(req.revision.ast), req.sources);
  if (!resolved.ok) return resolved;

  // 4. Referências oficiais e narrativas de IA: mesmo tenant, pins completos, slots existentes no AST.
  const issues: ComposeIssue[] = [];
  const reqs = templateRequirements(req.revision.ast.root);
  for (const [kind, pin] of Object.entries(req.officialDocuments) as [DocRefKind, OfficialDocumentPin | undefined][]) {
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
    if (!reqs.aiSlots.includes(a.slotKey)) issues.push({ code: "AI_SLOT_UNKNOWN", path: p, message: `slot de IA inexistente na revisão: ${String(a.slotKey)}` });
    if (!a.executionId || typeof a.text !== "string" || !a.text.trim()) issues.push({ code: "AI_OUTPUT_INVALID", path: p, message: "narrativa exige executionId e texto" });
    if (narratives.has(a.slotKey)) issues.push({ code: "AI_OUTPUT_INVALID", path: p, message: `mais de uma narrativa para o slot ${a.slotKey}` });
    narratives.set(a.slotKey, a);
  });
  if (issues.length) return { ok: false, issues };

  // 5. Renderização determinística.
  const ctx: RenderCtx = {
    organizationId: req.organizationId, catalog: req.catalog, values: resolved.value.values,
    allowedCents: canonicalCents(req.catalog, resolved.value.values), docPins: req.officialDocuments, narratives,
    record: true, issues: [], decisions: [], refs: new Map(), annexes: [], ai: [], fragments: [], blocks: [],
  };
  const blocks = renderNodes(req.revision.ast.root, "root", ctx);
  if (ctx.issues.length) return { ok: false, issues: ctx.issues };
  const text = `${blocks.join("\n\n")}\n`;
  const composedOutputHash = sha256Hex(text);

  // 6. M1 selado (id derivado do conteúdo semântico; `createdAt` fora do hash).
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
    sources: manifestSourceRefs(resolved.value.usedSources, req.sources),
    officialDocRefs: [...ctx.refs.values()].sort((a, b) => a.order - b.order),
    conditionalDecisions: ctx.decisions,
    aiNarratives: ctx.ai,
    annexes: ctx.annexes,
    identityFingerprint: req.identityFingerprint,
    composedOutputHash,
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

  return {
    ok: true,
    value: deepFreeze({
      content: { text },
      composedOutputHash,
      manifest: sealed.value,
      protectedFragments: ctx.fragments,
      structuralBlocks: ctx.blocks,
      values: resolved.value.values,
    }),
  };
}

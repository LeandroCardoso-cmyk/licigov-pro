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
import { referencedVariables, type DocRefKind, type Inline, type TemplateNode, type TemplateAST } from "./ast";
import { templateRequirements } from "./composerRequirements";
import { isAstV2, isCatalogV2, type AnyVariableCatalog } from "./astVersions";
import type { DocRefKind2 } from "./ast2";
import { composeTemplateV2 } from "./composer2";
import type { ModelRules } from "./modelRules";
import {
  CATALOG_SOURCE_TO_MANIFEST_KEY, canonicalSourceDigest, cell, deepFreeze, firstLine, formatNumberPtBr, generationManifestId,
  inlineText, isAbsent, manifestSourceRefs, MISSING_VALUE_MARK, narrativeWordCount, neutralizeNarrative, PENDING_AI_SLOT_MARK,
  pinIssues, pinsAndNarrativesCheck, readCatalogPath, sealComposedManifest,
} from "./composerShared";
import type { ComposedContent, ComposeInput } from "./composerContract";
import { evaluateCondition } from "./conditionalDsl";
import type {
  AiNarrativeRef, AnnexRef, ConditionalDecisionRef, GenerationManifest, OfficialDocumentReference,
} from "./manifest";
import { validateTemplateRevision, type TemplateIdentity } from "./revision";
import { templateHash } from "./semanticHash";
import { organizationIssues, sameOrganizationIssues } from "./tenant";
import { isOrgId, type OrgId, type Sha256, type TemplateIssueCode } from "./types";
import { findVariable, type VariableCatalog, type VariableDef, type VariableSource } from "./variableCatalog";
import type { VariableSource2 } from "./variableCatalog2";

export { templateRequirements } from "./composerRequirements";

// Reexportados: ficam em `composerShared.ts` (compartilhados com o composer v2), mas a API pública deste módulo não muda.
export {
  CATALOG_SOURCE_TO_MANIFEST_KEY, canonicalSourceDigest, formatNumberPtBr, generationManifestId, manifestSourceRefs,
  MISSING_VALUE_MARK, narrativeWordCount, neutralizeNarrative, PENDING_AI_SLOT_MARK, readCatalogPath,
};

// ─── Contrato de entrada/saída ──────────────────────────────────────────────────────────────────────────────────────

/** Códigos do composer: os do T1 + os específicos da composição (sem alterar o contrato congelado do T1). */
export type ComposeIssueCode =
  | TemplateIssueCode
  | "MISSING_REQUIRED"
  | "VALUE_TYPE_INVALID"
  | "AI_SLOT_UNKNOWN"
  | "AI_OUTPUT_INVALID"
  // tpl-ast/2
  | "XREF_TARGET_NOT_RENDERED"
  | "CHOICE_NOT_EXACTLY_ONE"
  | "TABLE_ROWS_INVALID"
  // regras governadas do modelo (`modelRules.ts`)
  | "MODEL_RULE_VIOLATED"
  | "RULE_VALIDATION_UNAVAILABLE";

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
export interface TemplateComposeRequest extends Omit<ComposeInput, "values" | "aiNarratives" | "catalog"> {
  /** Catálogo da MESMA versão do AST da revisão (v1 com `tpl-ast/1`; v2 com `tpl-ast/2`). */
  readonly catalog: AnyVariableCatalog;
  readonly organizationId: OrgId;
  readonly identity: TemplateIdentity;
  readonly pin: RevisionPin | null | undefined;
  readonly sources: Partial<Readonly<Record<VariableSource2, CanonicalSourceSnapshot>>>;
  readonly officialDocuments: Partial<Readonly<Record<DocRefKind2, OfficialDocumentPin>>>;
  readonly aiNarratives: readonly AiNarrativeOutput[];
  /**
   * Regras GOVERNADAS do modelo (dado do pacote; só catálogo v2). Violação ⇒ `MODEL_RULE_VIOLATED`; regra cuja autoridade está
   * indisponível e cujo cenário está ativo ⇒ `RULE_VALIDATION_UNAVAILABLE` (falha fechada). Vale em geração E na revalidação.
   */
  readonly modelRules?: ModelRules;
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

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Teto de magnitude para `number`: evita notação exponencial na renderização. */
const MAX_PLAIN_NUMBER = 1e15;

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

// ─── Formatação determinística (independente de locale) ───────────────────────────────────────────────────────────

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

/** Valores monetários canônicos (centavos) que a IA pode citar sem marca. */
function canonicalCents(catalog: VariableCatalog, values: Readonly<Record<string, unknown>>): Set<number> {
  const out = new Set<number>();
  for (const [name, v] of Object.entries(values)) {
    const def = findVariable(catalog, name);
    if (def?.type === "money" && typeof v === "number" && v > 0) out.add(v);
  }
  return out;
}

/**
 * Compõe o documento a partir da revisão exata e das fontes canônicas e sela o M1. Falha fechada com a lista de
 * problemas; nunca devolve conteúdo parcial.
 *
 * Despacha pela VERSÃO do AST da revisão: `tpl-ast/2` → `composeTemplateV2`; `tpl-ast/1` → o caminho v1 abaixo, com o
 * comportamento de sempre (mesmo texto, mesmos hashes). AST e catálogo andam juntos (v1 com v1, v2 com v2).
 */
export function composeTemplate(req: TemplateComposeRequest): ComposeResult<ComposedDocument> {
  if (isAstV2(req.revision.ast)) return composeTemplateV2(req);
  if (isCatalogV2(req.catalog)) {
    return { ok: false, issues: [{ code: "CATALOG_FORMAT_MISMATCH", path: "catalog", message: "AST tpl-ast/1 exige catálogo v1; o informado é tpl-catalog/2" }] };
  }
  return composeTemplateV1(req, req.catalog, req.revision.ast);
}

function composeTemplateV1(req: TemplateComposeRequest, catalog: VariableCatalog, ast: TemplateAST): ComposeResult<ComposedDocument> {
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
  const checked = validateTemplateRevision(req.revision, req.identity, catalog);
  if (!checked.ok) return { ok: false, issues: checked.issues };
  for (const k of ["identityFingerprint", "generatedDocumentId", "createdAt"] as const) {
    if (typeof req[k] !== "string" || !req[k]) return { ok: false, issues: [{ code: "MANIFEST_INVALID", path: k, message: `${k} obrigatório` }] };
  }

  // 3. Valores canônicos (só pelo catálogo).
  const resolved = resolveTemplateVariables(req.organizationId, catalog, referencedVariables(ast), req.sources);
  if (!resolved.ok) return resolved;

  // 4. Referências oficiais e narrativas de IA: mesmo tenant, pins completos, slots existentes no AST.
  const reqs = templateRequirements(ast.root);
  const checkedPins = pinsAndNarrativesCheck(req, reqs.aiSlots);
  if (checkedPins.issues.length) return { ok: false, issues: checkedPins.issues };

  // 5. Renderização determinística.
  const ctx: RenderCtx = {
    organizationId: req.organizationId, catalog, values: resolved.value.values,
    allowedCents: canonicalCents(catalog, resolved.value.values), docPins: req.officialDocuments, narratives: checkedPins.narratives,
    record: true, issues: [], decisions: [], refs: new Map(), annexes: [], ai: [], fragments: [], blocks: [],
  };
  const blocks = renderNodes(ast.root, "root", ctx);
  if (ctx.issues.length) return { ok: false, issues: ctx.issues };
  const text = `${blocks.join("\n\n")}\n`;
  const composedOutputHash = sha256Hex(text);

  // 6. M1 selado (id derivado do conteúdo semântico; `createdAt` fora do hash).
  const sealed = sealComposedManifest(req, {
    composedOutputHash,
    sources: manifestSourceRefs(resolved.value.usedSources, req.sources),
    officialDocRefs: [...ctx.refs.values()].sort((a, b) => a.order - b.order),
    conditionalDecisions: ctx.decisions,
    aiNarratives: ctx.ai,
    annexes: ctx.annexes,
  }, purpose);
  if (!sealed.ok) return sealed;

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

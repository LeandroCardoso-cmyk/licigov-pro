/**
 * Institutional Templates — COMPOSER para `tpl-ast/2` + `tpl-catalog/2`.
 *
 * Mesmo contrato do composer v1 (pin exato, tenant, valores só pelo catálogo, DSL fechada, IA só em `aiSlot`, M1 selado,
 * puro e determinístico); acrescenta o que o AST v2 exige, SEM nenhum conhecimento de modalidade/plataforma/modelo:
 *
 *   1. EXPANSÃO: avalia condicionais (`conditional`) e grupos excludentes (`choice`), resolve valores e tabelas dinâmicas,
 *      e produz uma árvore já "achatada" — só o que será renderizado. Remissões (`xref`) ficam simbólicas.
 *   2. NUMERAÇÃO: seções `auto` e parágrafos `numbered` recebem número hierárquico (`1`, `1.1`, `1.2`, `2`…) contando só
 *      o que SOBROU depois das condicionais; anexos recebem numeral romano pela posição entre os anexos renderizados,
 *      ordenados por `order` (independe de onde aparecem no AST).
 *   3. SERIALIZAÇÃO: resolve cada `xref` pelo número final. Remissão para âncora que NÃO foi renderizada ⇒ falha fechada
 *      (`XREF_TARGET_NOT_RENDERED`): o autor protege a remissão com a mesma condição do alvo. Nunca sobra "item 15.4" literal.
 *
 * Valores de CONTROLE (`renderable=false`) participam de condições e validações (`requiredWhen`) e nunca viram texto.
 * Mesma entrada canônica ⇒ mesmo texto, mesmo `composedOutputHash`, mesmo `manifestHash`.
 */
import { flagUnverifiedAmounts } from "../aiNumericAuthority";
import { sha256Hex } from "../canonicalJson";
import {
  referencedVariables2, templateRequirements2, type DocRefKind2, type Inline2, type TemplateAST2, type TemplateNode2,
} from "./ast2";
import { isAstV2, isCatalogV2 } from "./astVersions";
import type {
  AiNarrativeOutput, CanonicalSourceSnapshot, ComposedDocument, ComposeIssue, ComposeResult, OfficialDocumentPin,
  ProtectedFragment, StructuralBlock, TemplateComposeRequest,
} from "./composer";
import {
  cell, deepFreeze, inlineText, isAbsent, manifestSourceRefs, MISSING_VALUE_MARK, narrativeWordCount, neutralizeNarrative,
  PENDING_AI_SLOT_MARK, pinIssues, pinsAndNarrativesCheck, readCatalogPath, sealComposedManifest,
} from "./composerShared";
import { conditionVariables, evaluateCondition2 } from "./conditionalDsl2";
import type { AiNarrativeRef, AnnexRef, ConditionalDecisionRef, OfficialDocumentReference } from "./manifest";
import { validateTemplateRevision } from "./revision";
import { templateHash } from "./semanticHash";
import { organizationIssues, sameOrganizationIssues } from "./tenant";
import { isOrgId, type OrgId } from "./types";
import { formatScalar, formatValue2, normalizeValue2 } from "./valueTypes2";
import { findVariable2, type VariableCatalog2, type VariableDef2, type VariableSource2 } from "./variableCatalog2";

// ─── Resolução de variáveis (catálogo v2) ───────────────────────────────────────────────────────────────────────────

export interface ResolvedVariables2 {
  readonly values: Readonly<Record<string, unknown>>;
  /** Fontes do catálogo efetivamente consultadas (ordenadas). */
  readonly usedSources: readonly VariableSource2[];
}

/**
 * Resolve as variáveis referenciadas pelo AST (e as exigidas por `requiredWhen`) a partir dos snapshots canônicos.
 * Ausente + obrigatória ⇒ MISSING_REQUIRED; ausente + `requiredWhen` verdadeira ⇒ MISSING_REQUIRED; valor fora do
 * contrato do tipo ⇒ VALUE_TYPE_INVALID (linhas de tabela: TABLE_ROWS_INVALID); snapshot de outro tenant ⇒ CROSS_TENANT_REFERENCE.
 */
export function resolveTemplateVariables2(
  organizationId: OrgId,
  catalog: VariableCatalog2,
  names: readonly string[],
  sources: Partial<Readonly<Record<VariableSource2, CanonicalSourceSnapshot>>>,
): ComposeResult<ResolvedVariables2> {
  const issues: ComposeIssue[] = [];
  for (const [key, snap] of Object.entries(sources) as [VariableSource2, CanonicalSourceSnapshot | undefined][]) {
    if (!snap) continue;
    if (!isOrgId(snap.organizationId)) issues.push({ code: "ORGANIZATION_REQUIRED", path: `sources.${key}`, message: "snapshot sem organizationId" });
    else if (snap.organizationId !== organizationId) issues.push({ code: "CROSS_TENANT_REFERENCE", path: `sources.${key}`, message: "fonte canônica de outra organização" });
  }
  if (issues.length) return { ok: false, issues };

  // Fecho transitivo: variáveis das condições `requiredWhen` das variáveis resolvidas também entram.
  const defs = new Map<string, VariableDef2>();
  const work = [...names];
  while (work.length) {
    const name = work.pop()!;
    if (defs.has(name)) continue;
    const def = findVariable2(catalog, name);
    if (!def) { issues.push({ code: "UNKNOWN_VARIABLE", path: `vars.${name}`, message: `variável fora do catálogo ${catalog.version}` }); continue; }
    defs.set(name, def);
    if (def.requiredWhen) work.push(...conditionVariables(def.requiredWhen));
  }
  const ordered = [...defs.keys()].sort().map((n) => defs.get(n)!);

  const values: Record<string, unknown> = {};
  const absent = new Set<string>();
  const used = new Set<VariableSource2>();
  for (const def of ordered) {
    used.add(def.source);
    const snap = sources[def.source];
    const raw = snap ? readCatalogPath(snap.data, def.path) : undefined;
    if (isAbsent(raw)) { absent.add(def.name); continue; }
    const n = normalizeValue2(def, raw);
    if (!n.ok) {
      issues.push({ code: def.type === "table" ? "TABLE_ROWS_INVALID" : "VALUE_TYPE_INVALID", path: `vars.${def.name}`, message: `${n.reason} (catálogo: ${def.type})` });
      continue;
    }
    values[def.name] = n.value;
  }
  if (issues.length) return { ok: false, issues };

  // Validação: obrigatória sempre, ou obrigatória quando a condição (sobre valores canônicos) é verdadeira.
  for (const def of ordered) {
    if (!absent.has(def.name)) continue;
    if (def.required) {
      issues.push({ code: "MISSING_REQUIRED", path: `vars.${def.name}`, message: `valor canônico obrigatório ausente (${def.source}.${def.path})` });
    } else if (def.requiredWhen && evaluateCondition2(def.requiredWhen, values, `vars.${def.name}.requiredWhen`).result) {
      issues.push({ code: "MISSING_REQUIRED", path: `vars.${def.name}`, message: `valor canônico obrigatório nesta configuração (requiredWhen) ausente (${def.source}.${def.path})` });
    }
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { values, usedSources: [...used].sort() } };
}

// ─── Árvore renderizável (já sem condicionais) ──────────────────────────────────────────────────────────────────────

/** Segmento de texto: literal ou remissão simbólica (resolvida só depois da numeração). */
type RInline = string | { readonly xref: string };

/** Numeração pedida pelo parágrafo (decimal hierárquica, alínea automática ou sequência simples). */
interface PNum { readonly kind: "decimal" | "alpha" | "seq"; readonly level: number }

type RNode =
  | { k: "heading"; level: number; text: RInline[] }
  | { k: "paragraph"; text: RInline[]; num: PNum | null; anchor?: string; protectId?: string; printed?: string }
  | { k: "list"; ordered: boolean; items: RNode[][] }
  | { k: "table"; header: RInline[][]; rows: RInline[][][]; protectId?: string }
  | { k: "section"; key: string; numbered: boolean; style: "decimal" | "ordinal"; prefix: string | null; title: RInline[] | null; children: RNode[]; number?: string; seq?: number };

interface RAnnex { readonly id: string; readonly role: string; readonly order: number; readonly title: RInline[]; readonly children: RNode[] }

interface ECtx {
  readonly catalog: VariableCatalog2;
  readonly values: Readonly<Record<string, unknown>>;
  readonly allowedCents: ReadonlySet<number>;
  readonly docPins: Partial<Readonly<Record<DocRefKind2, OfficialDocumentPin>>>;
  readonly narratives: ReadonlyMap<string, AiNarrativeOutput>;
  /** false ⇒ expansão "de rascunho" (ramo excluído): não registra decisões, referências, fragmentos nem narrativas. */
  readonly record: boolean;
  readonly issues: ComposeIssue[];
  readonly decisions: ConditionalDecisionRef[];
  readonly refs: Map<string, OfficialDocumentReference>;
  readonly ai: AiNarrativeRef[];
  readonly fragments: ProtectedFragment[];
  readonly blocks: StructuralBlock[];
  readonly annexes: RAnnex[];
}

function scratch(ctx: ECtx): ECtx {
  return { ...ctx, record: false, issues: [], decisions: [], refs: new Map(ctx.refs), ai: [], fragments: [], blocks: [], annexes: [] };
}

function pushStr(out: RInline[], s: string): void {
  if (s === "") return;
  const last = out[out.length - 1];
  if (typeof last === "string") out[out.length - 1] = last + s; else out.push(s);
}

function expandInlines(xs: readonly Inline2[], path: string, ctx: ECtx, out: RInline[] = []): RInline[] {
  xs.forEach((x, i) => {
    const p = `${path}[${i}]`;
    switch (x.t) {
      case "text": pushStr(out, x.v); break;
      case "strong": pushStr(out, "**"); expandInlines(x.v, `${p}.v`, ctx, out); pushStr(out, "**"); break;
      case "em": pushStr(out, "_"); expandInlines(x.v, `${p}.v`, ctx, out); pushStr(out, "_"); break;
      case "xref": out.push({ xref: x.target }); break;
      case "when": {
        const ev = evaluateCondition2(x.when, ctx.values, `${p}.when`);
        if (ctx.record) ctx.decisions.push({ nodePath: p, result: ev.result, traceHash: templateHash(ev.trace) });
        if (ev.result) expandInlines(x.then, `${p}.then`, ctx, out);
        break;
      }
      case "aiSlot": {
        const text = aiNarrativeText(x, p, ctx);
        if (text) pushStr(out, text.replace(/\s*[\r\n]+\s*/g, " ").trim());
        break;
      }
      case "var": {
        const def = findVariable2(ctx.catalog, x.name);
        if (!def || !def.renderable) {
          if (ctx.record) ctx.issues.push({ code: "CONTROL_ONLY_VARIABLE_RENDERED", path: p, message: `${x.name} não é renderizável como texto` });
          break;
        }
        const v = ctx.values[x.name];
        if (v === undefined) { pushStr(out, def.absentText ?? MISSING_VALUE_MARK(x.name)); break; }
        const text = formatValue2(def, v);
        if (ctx.record && text.trim()) ctx.fragments.push({ nodeId: p, text, fragmentHash: sha256Hex(text) });
        pushStr(out, text);
        break;
      }
    }
  });
  return out;
}

/** Texto de uma narrativa de IA para um slot (bloco ou inline): limite de palavras, sem autoridade numérica, registrada no M1. */
function aiNarrativeText(slot: { readonly slotKey: string; readonly maxTokens: number }, path: string, ctx: ECtx): string | null {
  const out = ctx.narratives.get(slot.slotKey);
  if (!out) return PENDING_AI_SLOT_MARK(slot.slotKey);
  if (narrativeWordCount(out.text) > slot.maxTokens) {
    if (ctx.record) ctx.issues.push({ code: "AI_OUTPUT_INVALID", path, message: `narrativa do slot "${slot.slotKey}" excede ${slot.maxTokens} palavras` });
    return null;
  }
  // A IA não cria autoridade numérica: valor monetário fora do quadro canônico recebe [REVISAR…].
  const { prose } = flagUnverifiedAmounts(neutralizeNarrative(out.text), ctx.allowedCents);
  if (ctx.record) ctx.ai.push({ slotKey: slot.slotKey, executionId: out.executionId, outputHash: sha256Hex(out.text), humanAccepted: false });
  return prose || null;
}

/** Âncora estrutural de um conjunto de nós: texto inicial (sem número e sem remissão) do primeiro nó com texto. */
function anchorOf(nodes: readonly RNode[]): string | null {
  const lead = (segs: readonly RInline[] | null): string | null => {
    if (!segs) return null;
    let acc = "";
    for (const s of segs) { if (typeof s !== "string") break; acc += s; }
    const t = acc.trim();
    return t ? t : null;
  };
  for (const n of nodes) {
    let a: string | null = null;
    if (n.k === "heading" || n.k === "paragraph") a = lead(n.text);
    else if (n.k === "section") a = lead(n.title) ?? anchorOf(n.children);
    else if (n.k === "list") a = n.items.length ? anchorOf(n.items[0]) : null;
    else if (n.k === "table") a = lead(n.header[0] ?? null);
    if (a) return a;
  }
  return null;
}

function expandNodes(nodes: readonly TemplateNode2[], path: string, ctx: ECtx): RNode[] {
  return nodes.flatMap((n, k) => expandNode(n, `${path}[${k}]`, ctx));
}

function expandNode(n: TemplateNode2, path: string, ctx: ECtx): RNode[] {
  switch (n.t) {
    case "heading":
      return [{ k: "heading", level: n.level, text: expandInlines(n.text, `${path}.text`, ctx) }];
    case "paragraph": {
      const text = expandInlines(n.inline, `${path}.inline`, ctx);
      const kind = n.numbered === true ? "decimal" : n.numbered === "alpha" ? "alpha" : n.numbered === "seq" ? "seq" : null;
      return [{ k: "paragraph", text, num: kind ? { kind, level: n.level ?? 1 } : null, ...(n.anchor ? { anchor: n.anchor } : {}) }];
    }
    case "list":
      return [{ k: "list", ordered: n.ordered, items: n.items.map((item, i) => expandNodes(item, `${path}.items[${i}]`, ctx)) }];
    case "table":
      return [{
        k: "table",
        header: n.header.map((h, i) => expandInlines(h, `${path}.header[${i}]`, ctx)),
        rows: n.rows.map((r, ri) => r.map((c, ci) => expandInlines(c, `${path}.rows[${ri}][${ci}]`, ctx))),
      }];
    case "dataTable": {
      const def = findVariable2(ctx.catalog, n.source);
      const rows = ctx.values[n.source] as readonly Record<string, unknown>[] | undefined;
      if (!def || rows === undefined) return [{ k: "paragraph", text: [def?.absentText ?? MISSING_VALUE_MARK(n.tableKey)], num: null }];
      // Colunas condicionais (ex.: valores estimados só com orçamento público): a condição é avaliada UMA vez por tabela.
      const visible = n.columns
        .map((c, i) => ({ c, i, def: (def.columns ?? []).find((x) => x.key === c.key)! }))
        .filter(({ c, i }) => {
          if (!c.when) return true;
          const ev = evaluateCondition2(c.when, ctx.values, `${path}.columns[${i}].when`);
          if (ctx.record) ctx.decisions.push({ nodePath: `${path}.columns[${i}]`, result: ev.result, traceHash: templateHash(ev.trace) });
          return ev.result;
        });
      return [{
        k: "table",
        header: visible.map(({ c, i }) => expandInlines(c.header, `${path}.columns[${i}].header`, ctx)),
        rows: rows.map((row) => visible.map(({ c, def: cd }) => (row[c.key] === undefined ? [] : [formatScalar(cd.type, row[c.key])] as RInline[]))),
        protectId: path,
      }];
    }
    case "section": {
      const children = expandNodes(n.children, `${path}.children`, ctx);
      if (children.length === 0) return []; // seção sem nada renderizado some inteira (e não consome número)
      return [{
        k: "section", key: n.key, numbered: n.numbering === "auto", style: n.style ?? "decimal", prefix: n.labelPrefix ?? null,
        title: n.title ? expandInlines(n.title, `${path}.title`, ctx) : null, children,
      }];
    }
    case "conditional": {
      const ev = evaluateCondition2(n.when, ctx.values, `${path}.when`);
      const chosen = ev.result ? n.then : (n.else ?? []);
      const other = ev.result ? (n.else ?? []) : n.then;
      const included = expandNodes(chosen, `${path}.${ev.result ? "then" : "else"}`, ctx);
      if (ctx.record) {
        ctx.decisions.push({ nodePath: path, result: ev.result, traceHash: templateHash(ev.trace) });
        const excluded = expandNodes(other, `${path}.${ev.result ? "else" : "then"}`, scratch(ctx));
        ctx.blocks.push({ blockId: path, includedAnchor: anchorOf(included), excludedAnchor: anchorOf(excluded) });
      }
      return included;
    }
    case "choice": {
      const evals = n.branches.map((b, i) => evaluateCondition2(b.when, ctx.values, `${path}.branches[${i}].when`));
      const hits = evals.map((e, i) => (e.result ? i : -1)).filter((i) => i >= 0);
      if (ctx.record) {
        n.branches.forEach((b, i) => ctx.decisions.push({ nodePath: `${path}.branches[${i}]`, result: evals[i].result, traceHash: templateHash(evals[i].trace) }));
        const bad = n.mode === "exactly-one" ? hits.length !== 1 : hits.length > 1;
        if (bad) {
          ctx.issues.push({
            code: "CHOICE_NOT_EXACTLY_ONE", path,
            message: `grupo excludente ${n.groupKey} (${n.mode}): ${hits.length} ramo(s) verdadeiro(s)${hits.length ? ` [${hits.map((i) => n.branches[i].key).join(", ")}]` : ""}`,
          });
        }
      }
      const chosenIdx = hits.length === 1 ? hits[0] : -1;
      const included = chosenIdx >= 0 ? expandNodes(n.branches[chosenIdx].children, `${path}.branches[${chosenIdx}].children`, ctx) : [];
      if (ctx.record) {
        n.branches.forEach((b, i) => {
          if (i === chosenIdx) ctx.blocks.push({ blockId: `${path}.branches[${i}]`, includedAnchor: anchorOf(included), excludedAnchor: null });
          else ctx.blocks.push({ blockId: `${path}.branches[${i}]`, includedAnchor: null, excludedAnchor: anchorOf(expandNodes(b.children, `${path}.branches[${i}].children`, scratch(ctx))) });
        });
      }
      return included;
    }
    case "docRef": {
      const pin = ctx.docPins[n.kind];
      if (!pin) {
        if (ctx.record) ctx.issues.push({ code: "REFERENCE_NOT_PINNED", path, message: `referência oficial ${n.kind} (${n.role}) sem pin exato` });
        return [];
      }
      const label: RInline[] = n.label ? expandInlines(n.label, `${path}.label`, ctx) : [inlineText(pin.title)];
      const text: RInline[] = ["> Documento de referência: ", ...label, ` — ${n.kind}, versão ${pin.version} (${pin.documentId}, hash ${pin.contentHash.slice(0, 12)})`];
      if (ctx.record && !ctx.refs.has(n.role)) {
        ctx.refs.set(n.role, {
          role: n.role, order: n.order, documentId: pin.documentId, lineageId: pin.lineageId,
          version: pin.version, contentHash: pin.contentHash, title: inlineText(pin.title),
        });
      }
      return [{ k: "paragraph", text, num: null, protectId: path }];
    }
    case "annex": {
      const children = expandNodes(n.children, `${path}.children`, ctx);
      ctx.annexes.push({ id: n.id, role: n.role, order: n.order, title: expandInlines(n.title, `${path}.title`, ctx), children });
      return [];
    }
    case "aiSlot": {
      const prose = aiNarrativeText(n, path, ctx);
      return prose ? [{ k: "paragraph", text: [prose], num: null }] : [];
    }
    case "controlRef":
      return []; // dependência declarada: já resolvida/validada em resolveTemplateVariables2; nunca vira texto
  }
}

// ─── Numeração (só do que foi renderizado) ──────────────────────────────────────────────────────────────────────────

interface Scope {
  readonly prefix: string | null;
  /** contadores decimais por nível (1.4 / 1.4.1 / 1.4.1.1) */
  d: [number, number, number];
  /** alíneas: nível 1 (`a`) e nível 2 (`b.1`) */
  a1: number;
  a2: number;
  seq: number;
}

const newScope = (prefix: string | null): Scope => ({ prefix, d: [0, 0, 0], a1: 0, a2: 0, seq: 0 });

/** a, b, … z, aa, ab, … */
export function alphaLabel(n: number): string {
  let x = n; let out = "";
  while (x > 0) { x -= 1; out = String.fromCharCode(97 + (x % 26)) + out; x = Math.floor(x / 26); }
  return out || "a";
}

const ORD_UNITS = ["", "PRIMEIRA", "SEGUNDA", "TERCEIRA", "QUARTA", "QUINTA", "SEXTA", "SÉTIMA", "OITAVA", "NONA"];
const ORD_TENS = ["", "DÉCIMA", "VIGÉSIMA", "TRIGÉSIMA", "QUADRAGÉSIMA", "QUINQUAGÉSIMA", "SEXAGÉSIMA", "SEPTUAGÉSIMA", "OCTOGÉSIMA", "NONAGÉSIMA"];
/** Ordinal feminino por extenso (1–99): PRIMEIRA … DÉCIMA PRIMEIRA … VIGÉSIMA TERCEIRA. Fora disso: `Nª`. */
export function ordinalFeminine(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return `${n}ª`;
  const t = Math.floor(n / 10); const u = n % 10;
  return [ORD_TENS[t], ORD_UNITS[u]].filter(Boolean).join(" ");
}
const titleCaseWords = (s: string): string => s.toLowerCase().split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

function assignNumbers(nodes: readonly RNode[], scope: Scope, labels: Map<string, string>): void {
  for (const n of nodes) {
    if (n.k === "section") {
      if (n.numbered) {
        // Seções e parágrafos decimais de nível 1 compartilham o contador do escopo (evita "2.1" seção × "2.1." parágrafo).
        scope.d[0] += 1; scope.d[1] = 0; scope.d[2] = 0;
        const seq = scope.d[0];
        const num = scope.prefix ? `${scope.prefix}.${seq}` : `${seq}`;
        n.number = num;
        n.seq = seq;
        labels.set(n.key, n.style === "ordinal" ? titleCaseWords(ordinalFeminine(seq)) : num);
        scope.a1 = 0; scope.a2 = 0;
        assignNumbers(n.children, newScope(num), labels);
      } else {
        assignNumbers(n.children, scope, labels); // seção sem numeração é transparente: continua a contagem do pai
      }
    } else if (n.k === "paragraph" && n.num) {
      const { kind, level } = n.num;
      let label: string; let printed: string;
      if (kind === "decimal") {
        scope.d[level - 1] += 1;
        for (let i = level; i < 3; i++) scope.d[i] = 0;
        scope.a1 = 0; scope.a2 = 0;
        label = [...(scope.prefix ? [scope.prefix] : []), ...scope.d.slice(0, level)].join(".");
        printed = `${label}.`;
      } else if (kind === "alpha") {
        if (level === 1) { scope.a1 += 1; scope.a2 = 0; label = alphaLabel(scope.a1); }
        else { scope.a2 += 1; label = `${alphaLabel(Math.max(scope.a1, 1))}.${scope.a2}`; }
        printed = `${label})`;
      } else {
        scope.seq += 1;
        label = String(scope.seq);
        printed = `${label}\\.`; // "1\." evita que o Markdown trate a linha como item de lista (perderia o número no DOCX/PDF)
      }
      n.printed = printed;
      if (n.anchor) labels.set(n.anchor, label);
    }
    // list/table/heading: não participam da numeração hierárquica
  }
}

export function toRoman(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 3999) return String(n);
  const t: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = ""; let x = n;
  for (const [v, s] of t) while (x >= v) { out += s; x -= v; }
  return out;
}

// ─── Serialização ──────────────────────────────────────────────────────────────────────────────────────────────────

interface SCtx {
  readonly labels: ReadonlyMap<string, string>;
  readonly record: boolean;
  readonly fragments: ProtectedFragment[];
  readonly missingXrefs: Set<string>;
}

function resolveInlines(xs: readonly RInline[], ctx: SCtx): string {
  return xs.map((x) => {
    if (typeof x === "string") return x;
    const label = ctx.labels.get(x.xref);
    if (label === undefined) { ctx.missingXrefs.add(x.xref); return `[REF?:${x.xref}]`; }
    return label;
  }).join("");
}

/** `level` = nível de título (Markdown) das seções numeradas deste escopo: 2 no corpo, 3 dentro de anexos. */
function serializeNodes(nodes: readonly RNode[], ctx: SCtx, level = 2): string[] {
  return nodes.flatMap((n) => serializeNode(n, ctx, level));
}

function protectFinal(ctx: SCtx, id: string | undefined, text: string): void {
  if (id && ctx.record && text.trim()) ctx.fragments.push({ nodeId: id, text, fragmentHash: sha256Hex(text) });
}

function serializeNode(n: RNode, ctx: SCtx, level: number): string[] {
  switch (n.k) {
    case "heading":
      return [`${"#".repeat(n.level)} ${inlineText(resolveInlines(n.text, ctx))}`];
    case "paragraph": {
      const body = resolveInlines(n.text, ctx).trim();
      if (!body) return [];
      const text = n.printed ? `${n.printed} ${body}` : body;
      protectFinal(ctx, n.protectId, text);
      return [text];
    }
    case "list": {
      const lines = n.items.map((item, k) => {
        const body = serializeNodes(item, ctx, level).join("\n").split("\n");
        const bullet = n.ordered ? `${k + 1}. ` : "- ";
        const pad = " ".repeat(bullet.length);
        return body.map((l, j) => (j === 0 ? `${bullet}${l}` : l ? `${pad}${l}` : "")).join("\n");
      });
      return lines.length ? [lines.join("\n")] : [];
    }
    case "table": {
      const header = n.header.map((h) => cell(resolveInlines(h, ctx)));
      const rows = n.rows.map((r) => r.map((c) => cell(resolveInlines(c, ctx))));
      const line = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;
      const text = [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
      protectFinal(ctx, n.protectId, text);
      return [text];
    }
    case "section": {
      const out: string[] = [];
      const title = n.title ? inlineText(resolveInlines(n.title, ctx)) : "";
      const hashes = "#".repeat(Math.min(level, 6));
      if (n.number && n.seq !== undefined) {
        if (n.style === "ordinal") {
          const head = `${n.prefix ? `${n.prefix} ` : ""}${ordinalFeminine(n.seq)}`;
          out.push(`${hashes} ${head}${title ? ` — ${title}` : ""}`);
        } else {
          out.push(`${hashes} ${n.number}. ${title}`);
        }
      } else if (title) {
        out.push(`${hashes} ${title}`);
      }
      out.push(...serializeNodes(n.children, ctx, n.number ? level + 1 : level));
      return out;
    }
  }
}

/** Valores monetários canônicos (centavos) que a IA pode citar sem marca: variáveis `money` e células `money` de tabelas. */
function canonicalCents2(catalog: VariableCatalog2, values: Readonly<Record<string, unknown>>): Set<number> {
  const out = new Set<number>();
  for (const [name, v] of Object.entries(values)) {
    const def = findVariable2(catalog, name);
    if (!def) continue;
    if (def.type === "money" && typeof v === "number" && v > 0) out.add(v);
    if (def.type === "table" && Array.isArray(v)) {
      const moneyCols = (def.columns ?? []).filter((c) => c.type === "money").map((c) => c.key);
      for (const row of v as Record<string, unknown>[]) for (const k of moneyCols) { const c = row[k]; if (typeof c === "number" && c > 0) out.add(c); }
    }
  }
  return out;
}

// ─── Composição ────────────────────────────────────────────────────────────────────────────────────────────────────

export function composeTemplateV2(req: TemplateComposeRequest): ComposeResult<ComposedDocument> {
  const ast: unknown = req.revision.ast;
  const catalog: unknown = req.catalog;
  if (!isAstV2(ast)) return { ok: false, issues: [{ code: "AST_INVALID", path: "revision.ast", message: "composeTemplateV2 exige tpl-ast/2" }] };
  if (!isCatalogV2(catalog)) return { ok: false, issues: [{ code: "CATALOG_FORMAT_MISMATCH", path: "catalog", message: "AST tpl-ast/2 exige catálogo tpl-catalog/2" }] };
  return compose2(req, ast, catalog);
}

function compose2(req: TemplateComposeRequest, ast: TemplateAST2, catalog: VariableCatalog2): ComposeResult<ComposedDocument> {
  // 1. Tenant e pin exato — antes de qualquer leitura de conteúdo.
  const early: ComposeIssue[] = [...organizationIssues(req, "organizationId"), ...pinIssues(req)];
  if (isOrgId(req.organizationId)) {
    early.push(...sameOrganizationIssues(req, req.identity, "identity"), ...sameOrganizationIssues(req, req.revision, "revision"));
  }
  if (early.length) return { ok: false, issues: early };

  // 2. Revisão: estado + validação completa (AST v2, catálogo v2, hash recalculado).
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

  // 3. Valores canônicos (só pelo catálogo; controles incluídos, pois alimentam condições e validações).
  const resolved = resolveTemplateVariables2(req.organizationId, catalog, referencedVariables2(ast), req.sources);
  if (!resolved.ok) return resolved;

  // 4. Referências oficiais e narrativas de IA: mesmo tenant, pins completos, slots existentes no AST.
  const reqs = templateRequirements2(ast.root);
  const pins = pinsAndNarrativesCheck(req, reqs.aiSlots);
  if (pins.issues.length) return { ok: false, issues: pins.issues };

  // 5. Expansão → numeração → serialização.
  const ectx: ECtx = {
    catalog, values: resolved.value.values, allowedCents: canonicalCents2(catalog, resolved.value.values),
    docPins: req.officialDocuments, narratives: pins.narratives, record: true,
    issues: [], decisions: [], refs: new Map(), ai: [], fragments: [], blocks: [], annexes: [],
  };
  const tree = expandNodes(ast.root, "root", ectx);
  if (ectx.issues.length) return { ok: false, issues: ectx.issues };

  const labels = new Map<string, string>();
  assignNumbers(tree, newScope(null), labels);
  const annexes = [...ectx.annexes].sort((a, b) => a.order - b.order);
  annexes.forEach((a, i) => labels.set(a.id, toRoman(i + 1)));
  annexes.forEach((a) => assignNumbers(a.children, newScope(null), labels)); // cada anexo reinicia a numeração

  const sctx: SCtx = { labels, record: true, fragments: ectx.fragments, missingXrefs: new Set() };
  const body = serializeNodes(tree, sctx);
  const annexRefs: AnnexRef[] = [];
  const annexBlocks = annexes.flatMap((a, i) => {
    const title = inlineText(resolveInlines(a.title, sctx));
    const blocks = [`## ANEXO ${toRoman(i + 1)}${title ? ` — ${title}` : ""}`, ...serializeNodes(a.children, sctx, 3)];
    annexRefs.push({ id: a.id, contentHash: sha256Hex(blocks.join("\n\n")) });
    return blocks;
  });
  if (sctx.missingXrefs.size) {
    return {
      ok: false,
      issues: [...sctx.missingXrefs].sort().map((t) => ({
        code: "XREF_TARGET_NOT_RENDERED" as const, path: `xref.${t}`,
        message: `a remissão aponta para ${t}, que não foi renderizado (excluído por condição); proteja a remissão com a mesma condição do alvo`,
      })),
    };
  }
  const text = `${[...body, ...annexBlocks].join("\n\n")}\n`;
  const composedOutputHash = sha256Hex(text);

  // 6. M1 selado.
  const sealed = sealComposedManifest(req, {
    composedOutputHash,
    sources: manifestSourceRefs(resolved.value.usedSources, req.sources),
    officialDocRefs: [...ectx.refs.values()].sort((a, b) => a.order - b.order),
    conditionalDecisions: ectx.decisions,
    aiNarratives: ectx.ai,
    annexes: annexRefs,
  }, purpose);
  if (!sealed.ok) return sealed;

  return {
    ok: true,
    value: deepFreeze({
      content: { text },
      composedOutputHash,
      manifest: sealed.value,
      protectedFragments: sctx.fragments,
      structuralBlocks: ectx.blocks,
      values: resolved.value.values,
    }),
  };
}

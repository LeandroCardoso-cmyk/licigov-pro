/**
 * Compilador DETERMINÍSTICO do Modelo-Mestre aprovado → `TemplateAST2` canônica (domínio puro: sem DB, rede, relógio ou IA).
 *
 *   Markdown-mestre aprovado (snapshot imutável, sha256 conferido) + mapeamento governado + Catálogo v2  ⇒  AST v2 + relatório de paridade
 *
 * Princípios:
 *  - O compilador NÃO conhece nenhum modelo: modalidade, plataforma, vocabulário e dialeto Markdown são DADO do mapeamento
 *    (`tpl-master-mapping/1`). Um modelo novo = novo mapeamento + nova AST + novo catálogo — nunca um compilador novo.
 *  - Mesma entrada (md + mapeamento + catálogo) ⇒ mesma AST e mesmo hash semântico. Nada de relógio/aleatório/LLM.
 *  - NOTAS DO SISTEMA são só documentação/evidência: nunca executáveis, nunca renderizadas, nunca interpretadas.
 *  - Falha FECHADA: placeholder desconhecido, condição sem mapeamento, bloco desbalanceado, remissão literal sem xref
 *    e hash de origem divergente interrompem a compilação (nada de AST parcial).
 *  - A origem (hash do snapshot, versão lógica, hash do mapeamento) é proveniência; o conteúdo jurídico aprovado não é alterado.
 */
import { sha256Hex } from "../canonicalJson";
import { validateAnyTemplateAst } from "./astVersions";
import type { ChoiceBranch, DocRefKind2, Inline2, TemplateAST2, TemplateNode2 } from "./ast2";
import { DOC_REF_KINDS_2 } from "./ast2";
import type { Cond2 } from "./conditionalDsl2";
import { revisionSemanticHash, templateHash } from "./semanticHash";
import type { VariableCatalog2 } from "./variableCatalog2";
import { findVariable2 } from "./variableCatalog2";

export const MASTER_MAPPING_FORMAT = "tpl-master-mapping/1" as const;
export const MASTER_COMPILER_VERSION = "tpl-master-compiler/1" as const;
export const MAX_MASTER_BYTES = 2_000_000;
const MAX_LINE_CHARS = 20_000;

// ─── Mapeamento governado (dado) ───────────────────────────────────────────────────────────────────────────────────

export type InputDisposition =
  | { readonly kind: "variable"; readonly var: string; readonly allowAbsent?: boolean }
  | { readonly kind: "control"; readonly var: string; readonly allowAbsent?: boolean }
  | { readonly kind: "aiSlot"; readonly slotKey: string; readonly maxTokens: number; readonly instructionsKey: string; readonly allowAbsent?: boolean }
  | { readonly kind: "dataTable"; readonly tableKey: string; readonly source: string; readonly columns: readonly { readonly key: string; readonly header: string }[]; readonly allowAbsent?: boolean }
  | { readonly kind: "docRef"; readonly docKind: DocRefKind2; readonly role: string; readonly order: number; readonly label?: string; readonly allowAbsent?: boolean };

export interface MasterDialect {
  /** Regex (grupo nomeado `name`) de um placeholder INLINE. */
  readonly placeholder: string;
  /** Regex de LINHA que abre um bloco condicional (grupo nomeado `type`). */
  readonly conditionOpen: string;
  /** Regex de LINHA do ramo alternativo (opcional). */
  readonly conditionElse?: string;
  /** Regex de LINHA que fecha o bloco (grupo `type` opcional — se presente, é conferido). */
  readonly conditionClose: string;
  /** Regex de LINHA que inicia uma NOTA DO SISTEMA (documentação; nunca renderizada nem interpretada). */
  readonly systemNote: string;
  /** true ⇒ a nota continua até a próxima linha em branco. */
  readonly systemNoteBlock: boolean;
  /** Regex de título numerado literal (grupos `num` e `title`) ⇒ seção com numeração automática. */
  readonly numberedHeading: string;
  /** Regex de parágrafo numerado literal (grupos `num` e `text`). */
  readonly numberedParagraph: string;
  /** Regex de item de lista (grupos `text` e opcional `ordered`). */
  readonly listItem: string;
}

export interface AnnexMapping { readonly id: string; readonly role: string; readonly order: number; readonly title: string; readonly headingMatch: string }
export interface CrossReferenceMapping { readonly literal: string; readonly target: string; readonly occurrences: number }
export interface ConditionMapping { readonly when: Cond2; readonly group?: string }
export interface ExclusiveGroupMapping { readonly mode: "exactly-one" | "at-most-one"; readonly branches: readonly string[] }

export interface MasterMapping {
  readonly format: typeof MASTER_MAPPING_FORMAT;
  readonly modelKey: string;
  readonly sourceLogicalVersion: string;
  readonly catalogVersion: string;
  readonly dialect: MasterDialect;
  readonly inputs: Readonly<Record<string, InputDisposition>>;
  readonly conditions: Readonly<Record<string, ConditionMapping>>;
  readonly exclusiveGroups: Readonly<Record<string, ExclusiveGroupMapping>>;
  /** Número literal do texto-fonte (ex.: "15.4") → âncora estável (chave da seção / âncora do parágrafo). */
  readonly anchors: Readonly<Record<string, string>>;
  readonly annexes: readonly AnnexMapping[];
  readonly crossReferences: readonly CrossReferenceMapping[];
  /** Detector de remissão literal (regex global) — remissão não mapeada em `crossReferences` falha a compilação. */
  readonly remissionScan?: { readonly pattern: string; readonly allowed?: readonly string[] };
  /** Coluna `money` de tabela dinâmica deve declarar a moeda no cabeçalho (achado de fidelidade do DOCX). */
  readonly requireCurrencyInMoneyHeaders?: boolean;
  readonly expectations: { readonly inputs: number; readonly renderCapable: number; readonly controls: number; readonly conditionTypes: number };
  /** Achados de linhagem (ex.: defeito editorial do DOCX congelado) — vão para o relatório, nunca para a AST. */
  readonly findings?: readonly { readonly id: string; readonly description: string }[];
}

// ─── Resultado ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface CompileIssue { readonly code: string; readonly message: string; readonly line?: number }

export interface ParityReport {
  readonly mappedInputs: number;
  readonly renderCapableInputs: number;
  readonly controlInputs: number;
  readonly unknownPlaceholders: readonly string[];
  readonly unmappedInputs: readonly string[];
  readonly placeholderOccurrences: { readonly text: number; readonly systemNote: number; readonly condition: number };
  readonly conditionTypesMapped: number;
  readonly conditionTypesUsed: readonly string[];
  readonly conditionTypesUnused: readonly string[];
  readonly conditionBlocks: number;
  readonly balancedConditions: boolean;
  readonly exclusiveGroups: number;
  readonly systemNotes: number;
  readonly systemNotesRendered: number;
  readonly crossReferences: { readonly mapped: number; readonly replaced: number; readonly unmappedRemissions: number };
  readonly annexes: number;
  readonly catalogRenderableVarsNotInMapping: readonly string[];
}

export interface CompileProvenance {
  readonly compiler: typeof MASTER_COMPILER_VERSION;
  readonly modelKey: string;
  readonly sourceLogicalVersion: string;
  readonly sourceSha256: string;
  readonly sourceBytes: number;
  readonly mappingSha256: string;
  readonly catalogVersion: string;
}

export interface CompiledMaster {
  readonly ast: TemplateAST2;
  readonly astSemanticHash: string;
  readonly report: ParityReport;
  readonly provenance: CompileProvenance;
  readonly findings: readonly { readonly id: string; readonly description: string }[];
  readonly systemNoteEvidence: readonly { readonly line: number; readonly sha256: string }[];
}

export type CompileResult =
  | { readonly ok: true; readonly value: CompiledMaster }
  | { readonly ok: false; readonly issues: readonly CompileIssue[] };

const err = (code: string, message: string, line?: number): CompileIssue => (line === undefined ? { code, message } : { code, message, line });

// ─── Validação do mapeamento ───────────────────────────────────────────────────────────────────────────────────────

const DIALECT_GROUPS: readonly (readonly [keyof MasterDialect, readonly string[]])[] = [
  ["placeholder", ["name"]], ["conditionOpen", ["type"]], ["numberedHeading", ["num", "title"]], ["numberedParagraph", ["num", "text"]], ["listItem", ["text"]],
];
const DIALECT_REGEX_KEYS: readonly (keyof MasterDialect)[] = ["placeholder", "conditionOpen", "conditionElse", "conditionClose", "systemNote", "numberedHeading", "numberedParagraph", "listItem"];

function tryRegex(src: string, flags: string): RegExp | null {
  try { return new RegExp(src, flags); } catch { return null; }
}

export function validateMasterMapping(mapping: MasterMapping, catalog: VariableCatalog2): CompileIssue[] {
  const issues: CompileIssue[] = [];
  const bad = (code: string, msg: string): void => { issues.push(err(code, msg)); };
  if (mapping.format !== MASTER_MAPPING_FORMAT) bad("MAPPING_FORMAT_UNSUPPORTED", `formato ${String(mapping.format)} ≠ ${MASTER_MAPPING_FORMAT}`);
  if (!mapping.modelKey || !mapping.sourceLogicalVersion) bad("MAPPING_INVALID", "modelKey e sourceLogicalVersion são obrigatórios");
  if (mapping.catalogVersion !== catalog.version) bad("MAPPING_CATALOG_MISMATCH", `mapeamento exige catálogo ${mapping.catalogVersion}; informado ${catalog.version}`);

  for (const k of DIALECT_REGEX_KEYS) {
    const src = mapping.dialect?.[k];
    if (typeof src !== "string") { if (k !== "conditionElse") bad("MAPPING_DIALECT_INVALID", `dialect.${k} ausente`); continue; }
    if (!tryRegex(src, "u")) bad("MAPPING_DIALECT_INVALID", `dialect.${k} não é uma regex válida`);
  }
  for (const [k, groups] of DIALECT_GROUPS) {
    const src = mapping.dialect?.[k];
    if (typeof src === "string") for (const g of groups) if (!src.includes(`(?<${g}>`)) bad("MAPPING_DIALECT_INVALID", `dialect.${k} exige o grupo nomeado "${g}"`);
  }

  const orders = new Set<string>();
  for (const [name, d] of Object.entries(mapping.inputs ?? {})) {
    switch (d.kind) {
      case "variable": case "control": {
        const v = findVariable2(catalog, d.var);
        if (!v) bad("MAPPING_INPUT_UNKNOWN_VARIABLE", `${name}: variável ${d.var} fora do catálogo`);
        else if (d.kind === "control" && v.renderable) bad("MAPPING_INPUT_KIND_MISMATCH", `${name}: controle aponta para variável renderizável ${d.var}`);
        else if (d.kind === "variable" && !v.renderable) bad("MAPPING_INPUT_KIND_MISMATCH", `${name}: variável de texto aponta para controle ${d.var} (renderable=false)`);
        break;
      }
      case "dataTable": {
        const v = findVariable2(catalog, d.source);
        if (!v || v.type !== "table") bad("MAPPING_INPUT_UNKNOWN_VARIABLE", `${name}: dataTable exige variável table; ${d.source} não é`);
        else {
          const cols = new Map((v.columns ?? []).map((c) => [c.key, c]));
          for (const c of d.columns) {
            const def = cols.get(c.key);
            if (!def) bad("MAPPING_INPUT_UNKNOWN_COLUMN", `${name}: coluna ${c.key} fora do esquema de ${d.source}`);
            else if (mapping.requireCurrencyInMoneyHeaders && def.type === "money" && !c.header.includes("R$")) {
              bad("DATATABLE_MONEY_HEADER_MISSING_CURRENCY", `${name}: coluna monetária ${c.key} deve declarar a moeda (R$) no cabeçalho — não replicar o defeito editorial do DOCX`);
            }
          }
        }
        break;
      }
      case "docRef": {
        if (!(DOC_REF_KINDS_2 as readonly string[]).includes(d.docKind)) bad("MAPPING_INPUT_INVALID", `${name}: docKind ${String(d.docKind)} inválido`);
        const key = `${d.role}#${d.order}`;
        if (orders.has(`r:${d.role}`) || orders.has(`o:${d.order}`)) bad("MAPPING_INPUT_INVALID", `${name}: role/order de docRef repetidos`);
        orders.add(`r:${d.role}`); orders.add(`o:${d.order}`); void key;
        break;
      }
      case "aiSlot":
        if (!Number.isSafeInteger(d.maxTokens) || d.maxTokens < 1 || !d.slotKey || !d.instructionsKey) bad("MAPPING_INPUT_INVALID", `${name}: aiSlot exige slotKey, instructionsKey e maxTokens > 0`);
        break;
      default:
        bad("MAPPING_INPUT_INVALID", `${name}: kind desconhecido`);
    }
  }

  for (const [type, c] of Object.entries(mapping.conditions ?? {})) {
    if (c.group !== undefined && !mapping.exclusiveGroups?.[c.group]) bad("MAPPING_CONDITION_INVALID", `${type}: grupo ${c.group} inexistente`);
  }
  for (const [g, def] of Object.entries(mapping.exclusiveGroups ?? {})) {
    if (def.branches.length < 2) bad("MAPPING_GROUP_INVALID", `${g}: grupo exclusivo exige ≥ 2 ramos`);
    for (const t of def.branches) if (mapping.conditions?.[t]?.group !== g) bad("MAPPING_GROUP_INVALID", `${g}: ramo ${t} não declara o grupo`);
  }
  const lits = new Set<string>();
  for (const x of mapping.crossReferences ?? []) {
    if (!x.literal || !x.target || !Number.isSafeInteger(x.occurrences) || x.occurrences < 1) bad("MAPPING_XREF_INVALID", `xref ${x.literal}: literal, target e occurrences ≥ 1 obrigatórios`);
    if (lits.has(x.literal)) bad("MAPPING_XREF_INVALID", `xref literal duplicado: ${x.literal}`);
    lits.add(x.literal);
  }
  for (const a of mapping.annexes ?? []) if (!tryRegex(a.headingMatch, "u")) bad("MAPPING_ANNEX_INVALID", `anexo ${a.id}: headingMatch inválido`);
  if (mapping.remissionScan && !tryRegex(mapping.remissionScan.pattern, "gu")) bad("MAPPING_DIALECT_INVALID", "remissionScan.pattern inválida");
  return issues;
}

// ─── Compilação ────────────────────────────────────────────────────────────────────────────────────────────────────

interface Frame {
  readonly kind: "root" | "section" | "annex" | "block";
  readonly level: number;
  children: TemplateNode2[];
  readonly line: number;
  // section
  readonly key?: string;
  readonly title?: Inline2[];
  // annex
  readonly annex?: AnnexMapping;
  // block
  readonly typeId?: string;
  readonly when?: Cond2;
  thenChildren?: TemplateNode2[];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function compileApprovedMaster(input: {
  readonly markdown: string;
  readonly expectedSha256: string;
  readonly mapping: MasterMapping;
  readonly catalog: VariableCatalog2;
}): CompileResult {
  const { markdown, mapping, catalog } = input;
  const issues: CompileIssue[] = [];

  // 1. Proveniência: o texto compilado é EXATAMENTE o snapshot aprovado.
  const bytes = Buffer.byteLength(markdown, "utf8");
  if (bytes > MAX_MASTER_BYTES) return { ok: false, issues: [err("SOURCE_TOO_LARGE", `fonte excede ${MAX_MASTER_BYTES} bytes`)] };
  const sourceSha256 = sha256Hex(markdown);
  if (sourceSha256 !== input.expectedSha256) {
    return { ok: false, issues: [err("SOURCE_HASH_MISMATCH", `sha256 da fonte (${sourceSha256}) ≠ sha256 aprovado (${input.expectedSha256}) — compilação recusada`)] };
  }
  const mappingIssues = validateMasterMapping(mapping, catalog);
  if (mappingIssues.length) return { ok: false, issues: mappingIssues };

  const d = mapping.dialect;
  const reOpen = new RegExp(d.conditionOpen, "u");
  const reElse = d.conditionElse ? new RegExp(d.conditionElse, "u") : null;
  const reClose = new RegExp(d.conditionClose, "u");
  const reNote = new RegExp(d.systemNote, "u");
  const reNumHeading = new RegExp(d.numberedHeading, "u");
  const reNumPara = new RegExp(d.numberedParagraph, "u");
  const reList = new RegExp(d.listItem, "u");
  const rePlaceholderG = new RegExp(d.placeholder, "gu");
  const reRemission = mapping.remissionScan ? new RegExp(mapping.remissionScan.pattern, "gu") : null;
  const annexMatchers = mapping.annexes.map((a) => ({ a, re: new RegExp(a.headingMatch, "u") }));
  const xrefRegexes = mapping.crossReferences.map((x) => ({ x, re: new RegExp(`(?<![\\w.])${escapeRe(x.literal)}(?![\\w]|\\.\\d)`, "gu") }));

  const seen = new Map<string, { text: number; systemNote: number; condition: number }>();
  const unknown = new Set<string>();
  const bump = (name: string, where: "text" | "systemNote" | "condition"): void => {
    const cur = seen.get(name) ?? { text: 0, systemNote: 0, condition: 0 };
    cur[where] += 1;
    seen.set(name, cur);
  };
  const occ = { text: 0, systemNote: 0, condition: 0 };
  const xrefReplaced = new Map<string, number>();
  const usedTypes = new Set<string>();
  let blocks = 0;
  let unmappedRemissions = 0;
  const noteEvidence: { line: number; sha256: string }[] = [];
  const nodeType = new WeakMap<object, string>();
  const usedAnchors = new Set<string>();
  let sectionSeq = 0;

  const scanPlaceholders = (text: string, where: "systemNote" | "condition", line: number): void => {
    for (const m of text.matchAll(rePlaceholderG)) {
      const name = m.groups?.name ?? "";
      occ[where] += 1;
      if (mapping.inputs[name]) bump(name, where);
      else if (where === "condition") { unknown.add(name); issues.push(err("PLACEHOLDER_UNKNOWN", `placeholder desconhecido em linha de condição: ${name}`, line)); }
      else unknown.add(name); // nota: contabiliza como desconhecido, mas não aborta por conteúdo de documentação
    }
  };

  // Inline: placeholders → var; literais de remissão → xref; **negrito** / *itálico*.
  const plain = (text: string, line: number): Inline2[] => {
    const out: Inline2[] = [];
    const pushText = (frag: string): void => {
      if (!frag) return;
      type Hit = { index: number; length: number; target: string; literal: string };
      const hits: Hit[] = [];
      for (const { x, re } of xrefRegexes) {
        re.lastIndex = 0;
        for (const m of frag.matchAll(re)) hits.push({ index: m.index ?? 0, length: m[0].length, target: x.target, literal: x.literal });
      }
      hits.sort((a, b) => a.index - b.index || b.length - a.length);
      let pos = 0;
      const remaining: string[] = [];
      for (const h of hits) {
        if (h.index < pos) continue;
        if (h.index > pos) { const t = frag.slice(pos, h.index); out.push({ t: "text", v: t }); remaining.push(t); }
        out.push({ t: "xref", target: h.target });
        xrefReplaced.set(h.literal, (xrefReplaced.get(h.literal) ?? 0) + 1);
        pos = h.index + h.length;
      }
      if (pos < frag.length) { const t = frag.slice(pos); out.push({ t: "text", v: t }); remaining.push(t); }
      if (reRemission) {
        const allowed = new Set(mapping.remissionScan?.allowed ?? []);
        for (const t of remaining) {
          reRemission.lastIndex = 0;
          for (const m of t.matchAll(reRemission)) {
            if (allowed.has(m[0])) continue;
            unmappedRemissions += 1;
            issues.push(err("UNMAPPED_REMISSION", `remissão literal sem xref governada: "${m[0]}"`, line));
          }
        }
      }
    };
    let last = 0;
    for (const m of text.matchAll(rePlaceholderG)) {
      const name = m.groups?.name ?? "";
      const idx = m.index ?? 0;
      pushText(text.slice(last, idx));
      last = idx + m[0].length;
      occ.text += 1;
      const disp = mapping.inputs[name];
      if (!disp) { unknown.add(name); issues.push(err("PLACEHOLDER_UNKNOWN", `placeholder desconhecido: ${name}`, line)); continue; }
      bump(name, "text");
      if (disp.kind === "variable") out.push({ t: "var", name: disp.var });
      else if (disp.kind === "control") issues.push(err("CONTROL_ONLY_PLACEHOLDER_IN_TEXT", `controle ${name} não pode ser texto`, line));
      else issues.push(err("PLACEHOLDER_POSITION_INVALID", `${name} (${disp.kind}) só pode ocupar um parágrafo inteiro`, line));
    }
    pushText(text.slice(last));
    return out;
  };

  const emphasis = (text: string, line: number): Inline2[] => {
    const strong = /\*\*(.+?)\*\*/su.exec(text);
    if (strong) {
      const i = strong.index ?? 0;
      return [...emphasis(text.slice(0, i), line), { t: "strong", v: plain(strong[1], line) }, ...emphasis(text.slice(i + strong[0].length), line)];
    }
    const em = /(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])/su.exec(text);
    if (em) {
      const i = em.index ?? 0;
      return [...emphasis(text.slice(0, i), line), { t: "em", v: plain(em[1], line) }, ...emphasis(text.slice(i + em[0].length), line)];
    }
    return plain(text, line);
  };
  const inline = (text: string, line: number): Inline2[] => emphasis(text.trim(), line);

  const root: Frame = { kind: "root", level: 0, children: [], line: 0 };
  const stack: Frame[] = [root];
  const top = (): Frame => stack[stack.length - 1];

  const mergeChoices = (children: TemplateNode2[], line: number): TemplateNode2[] => {
    const out: TemplateNode2[] = [];
    for (let i = 0; i < children.length; i++) {
      const n = children[i];
      const type = nodeType.get(n);
      const group = type ? mapping.conditions[type]?.group : undefined;
      if (!type || !group || n.t !== "conditional") { out.push(n); continue; }
      const def = mapping.exclusiveGroups[group];
      const run: { node: Extract<TemplateNode2, { t: "conditional" }>; type: string }[] = [];
      let j = i;
      while (j < children.length) {
        const c = children[j];
        const ct = nodeType.get(c);
        if (c.t !== "conditional" || !ct || mapping.conditions[ct]?.group !== group) break;
        run.push({ node: c, type: ct });
        j++;
      }
      const types = run.map((r) => r.type);
      const complete = def.branches.every((b) => types.includes(b)) && new Set(types).size === types.length && types.length === def.branches.length;
      if (!complete) { issues.push(err("EXCLUSIVE_GROUP_INCOMPLETE", `grupo exclusivo ${group}: ramos adjacentes encontrados [${types.join(", ")}] ≠ declarados [${def.branches.join(", ")}]`, line)); out.push(...run.map((r) => r.node)); }
      else {
        const branches: ChoiceBranch[] = run.map((r) => ({ key: r.type, when: r.node.when, children: r.node.then }));
        out.push({ t: "choice", groupKey: group, mode: def.mode, branches });
      }
      i = j - 1;
    }
    return out;
  };

  const closeFrame = (): void => {
    const f = stack.pop()!;
    const kids = mergeChoices(f.children, f.line);
    let node: TemplateNode2;
    if (f.kind === "section") node = { t: "section", key: f.key!, numbering: "auto", title: f.title, children: kids };
    else if (f.kind === "annex") node = { t: "annex", id: f.annex!.id, role: f.annex!.role, order: f.annex!.order, title: [{ t: "text", v: f.annex!.title }], children: kids };
    else if (f.kind === "block") {
      const then = f.thenChildren ? mergeChoices(f.thenChildren, f.line) : kids;
      const cond: TemplateNode2 = f.thenChildren ? { t: "conditional", when: f.when!, then, else: kids } : { t: "conditional", when: f.when!, then };
      nodeType.set(cond, f.typeId!);
      node = cond;
    } else throw new Error("frame raiz não fecha");
    top().children.push(node);
  };

  const closeSectionsUntilBlock = (): boolean => {
    while (top().kind === "section" || top().kind === "annex") closeFrame();
    return top().kind === "block";
  };

  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  interface ParaState { text: string; line: number; numbered?: { num: string } }
  let para = null as ParaState | null;
  let tableRows: { text: string; line: number }[] = [];
  let listItems: { text: string; ordered: boolean }[] = [];
  let inNote = false;

  const flushPara = (): void => {
    if (!para) return;
    const p = para; para = null;
    const trimmed = p.text.trim();
    // Parágrafo composto só de UM placeholder estrutural (aiSlot/dataTable/docRef/…).
    const single = new RegExp(`^${d.placeholder.startsWith("^") ? d.placeholder.slice(1) : d.placeholder}$`, "u").exec(trimmed);
    const sName = single?.groups?.name;
    const disp = sName ? mapping.inputs[sName] : undefined;
    if (!p.numbered && sName && disp && (disp.kind === "aiSlot" || disp.kind === "dataTable" || disp.kind === "docRef")) {
      occ.text += 1; bump(sName, "text");
      if (disp.kind === "aiSlot") top().children.push({ t: "aiSlot", slotKey: disp.slotKey, maxTokens: disp.maxTokens, instructionsKey: disp.instructionsKey });
      else if (disp.kind === "dataTable") top().children.push({ t: "dataTable", tableKey: disp.tableKey, source: disp.source, columns: disp.columns.map((c) => ({ key: c.key, header: [{ t: "text", v: c.header }] })) });
      else top().children.push({ t: "docRef", kind: disp.docKind, mode: "EXACT_PINNED", role: disp.role, order: disp.order, ...(disp.label ? { label: [{ t: "text" as const, v: disp.label }] } : {}) });
      return;
    }
    if (p.numbered) {
      const anchor = mapping.anchors[p.numbered.num];
      if (anchor !== undefined) usedAnchors.add(anchor);
      top().children.push({ t: "paragraph", numbered: true, ...(anchor !== undefined ? { anchor } : {}), inline: inline(trimmed, p.line) });
    } else top().children.push({ t: "paragraph", inline: inline(trimmed, p.line) });
  };
  const flushTable = (): void => {
    if (!tableRows.length) return;
    const rows = tableRows; tableRows = [];
    const cells = (r: { text: string; line: number }): Inline2[][] => {
      const body = r.text.trim().replace(/^\|/, "").replace(/\|$/, "");
      return body.split(/(?<!\\)\|/u).map((c) => inline(c.replace(/\\\|/g, "|"), r.line));
    };
    const isSep = (t: string): boolean => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/u.test(t.trim());
    if (rows.length < 2 || !isSep(rows[1].text)) { issues.push(err("TABLE_MALFORMED", "tabela Markdown sem linha separadora", rows[0].line)); return; }
    top().children.push({ t: "table", header: cells(rows[0]), rows: rows.slice(2).map(cells) });
  };
  const flushList = (): void => {
    if (!listItems.length) return;
    const items = listItems; listItems = [];
    top().children.push({ t: "list", ordered: items[0].ordered, items: items.map((it) => [{ t: "paragraph" as const, inline: inline(it.text, 0) }]) });
  };
  const flushAll = (): void => { flushPara(); flushTable(); flushList(); };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const ln = i + 1;
    if (raw.length > MAX_LINE_CHARS) { issues.push(err("LINE_TOO_LONG", `linha excede ${MAX_LINE_CHARS} caracteres`, ln)); continue; }

    // Notas do sistema: evidência, nunca conteúdo. Nada do que está dentro da nota é interpretado.
    if (inNote) {
      if (!raw.trim()) inNote = false;
      else { noteEvidence.push({ line: ln, sha256: sha256Hex(raw) }); scanPlaceholders(raw, "systemNote", ln); continue; }
    }
    if (reNote.test(raw)) {
      flushAll();
      noteEvidence.push({ line: ln, sha256: sha256Hex(raw) });
      scanPlaceholders(raw, "systemNote", ln);
      if (d.systemNoteBlock) inNote = true;
      continue;
    }

    const open = reOpen.exec(raw);
    if (open) {
      flushAll();
      const type = open.groups?.type ?? "";
      const cm = mapping.conditions[type];
      scanPlaceholders(raw, "condition", ln);
      if (!cm) { issues.push(err("CONDITION_TYPE_UNMAPPED", `tipo de bloco condicional sem mapeamento: ${type}`, ln)); continue; }
      usedTypes.add(type); blocks += 1;
      stack.push({ kind: "block", level: top().level, children: [], line: ln, typeId: type, when: cm.when });
      continue;
    }
    if (reElse && reElse.test(raw)) {
      flushAll();
      const f = top();
      if (f.kind !== "block" && !stack.some((s) => s.kind === "block")) { issues.push(err("CONDITION_UNBALANCED", "ramo alternativo fora de bloco", ln)); continue; }
      closeSectionsUntilBlock();
      const b = top();
      if (mapping.conditions[b.typeId!]?.group) issues.push(err("EXCLUSIVE_GROUP_ELSE", `bloco ${b.typeId} de grupo exclusivo não admite ramo alternativo`, ln));
      if (b.thenChildren) issues.push(err("CONDITION_UNBALANCED", "bloco com mais de um ramo alternativo", ln));
      b.thenChildren = b.children;
      b.children = [];
      continue;
    }
    const close = reClose.exec(raw);
    if (close) {
      flushAll();
      if (!stack.some((s) => s.kind === "block")) { issues.push(err("CONDITION_UNBALANCED", "fechamento de bloco sem abertura", ln)); continue; }
      closeSectionsUntilBlock();
      const b = top();
      const closeType = close.groups?.type;
      if (closeType !== undefined && closeType !== b.typeId) issues.push(err("CONDITION_CLOSE_MISMATCH", `fechamento ${closeType} ≠ abertura ${b.typeId}`, ln));
      closeFrame();
      continue;
    }

    const headingM = /^(#{1,6})\s+(.*)$/u.exec(raw);
    if (headingM) {
      flushAll();
      const level = headingM[1].length;
      const text = headingM[2].trim();
      const annex = annexMatchers.find(({ re }) => re.test(text));
      while ((top().kind === "section" || top().kind === "annex") && top().level >= level) closeFrame();
      if (annex) {
        if (top().kind === "block" && stack.length > 1 && stack.slice(1).some((s) => s.kind !== "block")) issues.push(err("ANNEX_POSITION_INVALID", "anexo só na raiz ou dentro de condicionais da raiz", ln));
        stack.push({ kind: "annex", level, children: [], line: ln, annex: annex.a });
        continue;
      }
      const nh = reNumHeading.exec(text);
      if (nh) {
        const num = nh.groups?.num ?? "";
        const mapped = mapping.anchors[num];
        const key = mapped ?? `sec-${String(++sectionSeq).padStart(4, "0")}`;
        if (mapped !== undefined) usedAnchors.add(mapped);
        stack.push({ kind: "section", level, children: [], line: ln, key, title: inline(nh.groups?.title ?? text, ln) });
      } else {
        top().children.push({ t: "heading", level: level as 1 | 2 | 3 | 4 | 5 | 6, text: inline(text, ln) });
      }
      continue;
    }

    if (!raw.trim()) { flushAll(); continue; }

    if (/^\s*\|/u.test(raw)) { flushPara(); flushList(); tableRows.push({ text: raw, line: ln }); continue; }
    flushTable();

    const np = reNumPara.exec(raw);
    if (np) {
      flushPara(); flushList();
      para = { text: np.groups?.text ?? raw, line: ln, numbered: { num: np.groups?.num ?? "" } };
      continue;
    }
    const li = reList.exec(raw);
    if (li) {
      flushPara();
      listItems.push({ text: li.groups?.text ?? raw, ordered: !!li.groups?.ordered });
      continue;
    }
    flushList();
    para = para ? { ...para, text: `${para.text} ${raw.trim()}` } : { text: raw.trim(), line: ln };
  }
  flushAll();

  // Balanceamento: todo bloco aberto precisa ter sido fechado.
  let balanced = true;
  while (stack.length > 1) {
    if (top().kind === "block") { balanced = false; issues.push(err("CONDITION_UNBALANCED", `bloco ${top().typeId} aberto sem fechamento`, top().line)); stack.pop(); }
    else closeFrame();
  }
  if (issues.some((x) => x.code === "CONDITION_UNBALANCED" || x.code === "CONDITION_CLOSE_MISMATCH")) balanced = false;

  // xref: contagem de substituições == contagem governada; alvo precisa existir (validação do AST confere).
  let xrefReplacedTotal = 0;
  for (const x of mapping.crossReferences) {
    const n = xrefReplaced.get(x.literal) ?? 0;
    xrefReplacedTotal += n;
    if (n !== x.occurrences) issues.push(err("XREF_COUNT_MISMATCH", `remissão "${x.literal}" → ${x.target}: ${n} ocorrência(s) no texto, ${x.occurrences} esperada(s)`));
  }
  // Âncoras mapeadas precisam existir no texto.
  for (const [lit, a] of Object.entries(mapping.anchors)) if (!usedAnchors.has(a)) issues.push(err("ANCHOR_NOT_FOUND", `âncora ${a} (literal ${lit}) não encontrada no texto-fonte`));

  // Paridade de entradas.
  const names = Object.keys(mapping.inputs).sort();
  const unmapped = names.filter((n) => !seen.has(n) && !mapping.inputs[n].allowAbsent);
  const controls = names.filter((n) => mapping.inputs[n].kind === "control");
  const usedSorted = [...usedTypes].sort();
  const unusedTypes = Object.keys(mapping.conditions).sort().filter((t) => !usedTypes.has(t));
  const mappedVars = new Set(Object.values(mapping.inputs).flatMap((x) => (x.kind === "variable" || x.kind === "control" ? [x.var] : x.kind === "dataTable" ? [x.source] : [])));
  const report: ParityReport = {
    mappedInputs: names.length,
    renderCapableInputs: names.length - controls.length,
    controlInputs: controls.length,
    unknownPlaceholders: [...unknown].sort(),
    unmappedInputs: unmapped,
    placeholderOccurrences: occ,
    conditionTypesMapped: Object.keys(mapping.conditions).length,
    conditionTypesUsed: usedSorted,
    conditionTypesUnused: unusedTypes,
    conditionBlocks: blocks,
    balancedConditions: balanced,
    exclusiveGroups: Object.keys(mapping.exclusiveGroups).length,
    systemNotes: noteEvidence.length,
    systemNotesRendered: 0,
    crossReferences: { mapped: mapping.crossReferences.length, replaced: xrefReplacedTotal, unmappedRemissions },
    annexes: mapping.annexes.length,
    catalogRenderableVarsNotInMapping: catalog.vars.filter((v) => v.renderable && v.type !== "table" && !mappedVars.has(v.name)).map((v) => v.name).sort(),
  };

  if (issues.length) return { ok: false, issues };

  // AST canônica + validação completa (mesmas regras do runtime): nada que o composer recusaria sai do compilador.
  const ast: TemplateAST2 = { schema: "tpl-ast/2", root: mergeChoices(root.children, 0) };
  const v = validateAnyTemplateAst(ast, catalog);
  if (!v.ok) return { ok: false, issues: v.issues.map((i) => err(`AST_${i.code}`, `${i.path}: ${i.message}`)) };

  return {
    ok: true,
    value: {
      ast, report, findings: mapping.findings ?? [], systemNoteEvidence: noteEvidence,
      astSemanticHash: revisionSemanticHash({ ast, variableCatalogVersion: catalog.version }),
      provenance: {
        compiler: MASTER_COMPILER_VERSION, modelKey: mapping.modelKey, sourceLogicalVersion: mapping.sourceLogicalVersion, sourceSha256,
        sourceBytes: bytes, mappingSha256: templateHash(mapping), catalogVersion: catalog.version,
      },
    },
  };
}

// ─── Gate de paridade estrutural ───────────────────────────────────────────────────────────────────────────────────

export interface ParityGateResult { readonly pass: boolean; readonly failures: readonly string[] }

/** Gate PARAMETRIZADO pelas contagens esperadas (dado do mapeamento): nenhum número é fixo no código. */
export function evaluateParityGate(report: ParityReport, mapping: MasterMapping): ParityGateResult {
  const e = mapping.expectations;
  const f: string[] = [];
  if (report.mappedInputs !== e.inputs) f.push(`entradas mapeadas ${report.mappedInputs} ≠ ${e.inputs}`);
  if (report.renderCapableInputs !== e.renderCapable) f.push(`entradas renderizáveis ${report.renderCapableInputs} ≠ ${e.renderCapable}`);
  if (report.controlInputs !== e.controls) f.push(`controles ${report.controlInputs} ≠ ${e.controls}`);
  if (report.unknownPlaceholders.length) f.push(`placeholders desconhecidos: ${report.unknownPlaceholders.join(", ")}`);
  if (report.unmappedInputs.length) f.push(`entradas sem ocorrência no texto: ${report.unmappedInputs.join(", ")}`);
  if (report.conditionTypesMapped !== e.conditionTypes) f.push(`tipos de condição mapeados ${report.conditionTypesMapped} ≠ ${e.conditionTypes}`);
  if (report.conditionTypesUsed.length !== e.conditionTypes) f.push(`tipos de condição usados ${report.conditionTypesUsed.length} ≠ ${e.conditionTypes}`);
  if (report.conditionTypesUnused.length) f.push(`tipos de condição sem uso: ${report.conditionTypesUnused.join(", ")}`);
  if (!report.balancedConditions) f.push("condições desbalanceadas");
  if (report.systemNotesRendered !== 0) f.push("notas do sistema renderizadas");
  if (report.crossReferences.unmappedRemissions !== 0) f.push("remissões literais sem xref");
  return { pass: f.length === 0, failures: f };
}

/** Atalho: compila e aplica o gate. Falha fechada se qualquer um falhar. */
export function compileAndVerifyMaster(input: Parameters<typeof compileApprovedMaster>[0]): CompileResult & { readonly gate?: ParityGateResult } {
  const r = compileApprovedMaster(input);
  if (!r.ok) return r;
  const gate = evaluateParityGate(r.value.report, input.mapping);
  if (!gate.pass) return { ok: false, issues: gate.failures.map((m) => err("PARITY_GATE_FAILED", m)), gate };
  return { ...r, gate };
}

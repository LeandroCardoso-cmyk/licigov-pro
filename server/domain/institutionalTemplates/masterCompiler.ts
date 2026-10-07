/**
 * Compilador DETERMINÍSTICO do Modelo-Mestre aprovado → `TemplateAST2` canônica (domínio puro: sem DB, rede, relógio ou IA).
 *
 *   Markdown-mestre aprovado (snapshot imutável, sha256 conferido) + mapeamento governado + Catálogo v2  ⇒  AST v2 + relatório de paridade
 *
 * Princípios:
 *  - O compilador NÃO conhece nenhum modelo: modalidade, plataforma, vocabulário e dialeto Markdown são DADO do mapeamento
 *    (`tpl-master-mapping/2`). Um modelo novo = novo mapeamento + nova AST + novo catálogo — nunca um compilador novo.
 *  - Mesma entrada (md + mapeamento + catálogo) ⇒ mesma AST e mesmo hash semântico. Nada de relógio/aleatório/LLM.
 *  - NOTAS DO SISTEMA são só documentação/evidência: nunca executáveis, nunca renderizadas, nunca interpretadas. O que uma nota
 *    descreve e deve virar comportamento entra por MAPEAMENTO governado (ex.: `guards`), com a justificativa registrada nos dados.
 *  - Falha FECHADA: placeholder desconhecido/residual, condição sem mapeamento, bloco desbalanceado, remissão literal sem xref
 *    e hash de origem divergente interrompem a compilação (nada de AST parcial).
 *  - A origem (hash do snapshot, versão lógica, hash do mapeamento) é proveniência; o conteúdo jurídico aprovado não é alterado.
 *  - Numeração literal do texto-fonte (1.4., a), CLÁUSULA DÉCIMA) NÃO é copiada: vira numeração automática do composer, e as
 *    remissões viram `xref` por âncora. O modo `auditLiterals` embute o rótulo literal para provar a fidelidade da numeração.
 */
import { sha256Hex } from "../canonicalJson";
import { validateAnyTemplateAst } from "./astVersions";
import type { ChoiceBranch, DataTableColumn, DocRefKind2, Inline2, TemplateAST2, TemplateNode2 } from "./ast2";
import { DOC_REF_KINDS_2 } from "./ast2";
import type { Cond2 } from "./conditionalDsl2";
import { revisionSemanticHash, templateHash } from "./semanticHash";
import type { VariableCatalog2 } from "./variableCatalog2";
import { findVariable2 } from "./variableCatalog2";

export const MASTER_MAPPING_FORMAT = "tpl-master-mapping/2" as const;
export const MASTER_COMPILER_VERSION = "tpl-master-compiler/2" as const;
export const MAX_MASTER_BYTES = 2_000_000;
const MAX_LINE_CHARS = 20_000;
const MARK_OPEN = "⟦";
const MARK_CLOSE = "⟧";

// ─── Mapeamento governado (dado) ───────────────────────────────────────────────────────────────────────────────────

export type InputDisposition =
  | { readonly kind: "variable"; readonly var: string; readonly allowAbsent?: boolean }
  | { readonly kind: "control"; readonly var: string; readonly allowAbsent?: boolean }
  | { readonly kind: "aiSlot"; readonly slotKey: string; readonly maxTokens: number; readonly instructionsKey: string; readonly allowAbsent?: boolean }
  | { readonly kind: "dataTable"; readonly tableKey: string; readonly source: string; readonly columns: readonly { readonly key: string; readonly header: string; readonly when?: Cond2 }[]; readonly allowAbsent?: boolean }
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
  /** Regexes (globais, grupo `type`) de abertura/fechamento de condição DENTRO de um parágrafo. */
  readonly inlineConditionOpen?: string;
  readonly inlineConditionClose?: string;
  /** Regex de LINHA que inicia uma NOTA DO SISTEMA (documentação; nunca renderizada nem interpretada). */
  readonly systemNote: string;
  /** Regex da linha que ENCERRA a nota (inclusive). Ausente: a nota vai até a próxima linha em branco (se `systemNoteBlock`). */
  readonly systemNoteEnd?: string;
  readonly systemNoteBlock: boolean;
  /** Linhas ignoradas e contabilizadas (separadores/estrutura do arquivo-mestre, ex.: `---`). */
  readonly ignoreLine?: string;
  /** Títulos de ESTRUTURA do arquivo-mestre (não integram o texto oficial): excluídos e contabilizados. */
  readonly scaffoldingHeadings?: string;
  /** Regex de título numerado literal (grupos `num` e `title`) ⇒ seção com numeração automática decimal. */
  readonly numberedHeading: string;
  /** Regex de título ordinal (grupos `prefix`, `ordinal`, `title`) ⇒ seção ordinal (CLÁUSULA PRIMEIRA — …). */
  readonly ordinalHeading?: string;
  /** Regex de LINHA em negrito numerada (`**3. Condições**`; grupos `num`, `title`) ⇒ seção numerada dentro do anexo (título em negrito). */
  readonly boldNumberedHeading?: string;
  /** Formas de parágrafo numerado literal. */
  readonly decimalParagraph: string; // grupos num, text   (1.4.  /  15.5.1.)
  readonly alphaParagraph?: string; // grupos letter, text (a)
  readonly alphaSubParagraph?: string; // grupos letter, sub, text (b.1))
  readonly seqParagraph?: string; // grupos num, text   (1.)
  /** Item de lista Markdown (opcional). */
  readonly listItem?: string;
  /** `paragraph`: cada linha é um parágrafo (o mestre é uma linha por parágrafo); `join`: linhas contínuas se unem. */
  readonly lineBreaks: "join" | "paragraph";
}

export interface AnnexMapping { readonly id: string; readonly role: string; readonly order: number; readonly title: string; readonly headingMatch: string }
export interface ConditionMapping { readonly when: Cond2; readonly group?: string }
export interface ExclusiveGroupMapping { readonly mode: "exactly-one" | "at-most-one"; readonly branches: readonly string[] }
/** Âncora (alvo de remissão). `scope`: `main` ou o id do anexo. `literal`: número/letra/ordinal LITERAL do texto-fonte. */
export interface AnchorMapping { readonly key: string; readonly scope: string; readonly kind: "section" | "paragraph" | "alpha" | "seq"; readonly literal: string; readonly parent?: string }
/** Remissão: `context` é o texto-fonte EXATO; as partes entre ⟦ ⟧ viram `xref` para `targets` (na ordem). `scope`: onde o texto ocorre (`*` = qualquer). */
export interface CrossReferenceMapping { readonly scope: string; readonly context: string; readonly targets: readonly string[]; readonly occurrences: number }
/** Parágrafo que contém o placeholder só é renderizado quando a variável está presente (regra governada; a nota do mestre é a justificativa documental). */
export interface GuardMapping { readonly placeholder: string; readonly rationale: string }

export interface MasterMapping {
  readonly format: typeof MASTER_MAPPING_FORMAT;
  readonly modelKey: string;
  readonly sourceLogicalVersion: string;
  readonly catalogVersion: string;
  readonly dialect: MasterDialect;
  readonly inputs: Readonly<Record<string, InputDisposition>>;
  readonly conditions: Readonly<Record<string, ConditionMapping>>;
  readonly exclusiveGroups: Readonly<Record<string, ExclusiveGroupMapping>>;
  readonly anchors: readonly AnchorMapping[];
  readonly annexes: readonly AnnexMapping[];
  readonly crossReferences: readonly CrossReferenceMapping[];
  /** Citações EXTERNAS (norma/lei) que se parecem com remissão interna e não viram xref. Texto exato; cada uma precisa ocorrer. */
  readonly externalCitations?: readonly string[];
  /** Detector de remissão literal (regex global) — remissão não coberta por `crossReferences`/`externalCitations` falha a compilação. */
  readonly remissionScan?: { readonly pattern: string };
  readonly guards?: readonly GuardMapping[];
  /** Coluna `money` de tabela dinâmica deve declarar a moeda no cabeçalho (achado de fidelidade do DOCX). */
  readonly requireCurrencyInMoneyHeaders?: boolean;
  readonly expectations: { readonly inputs: number; readonly renderCapable: number; readonly controls: number; readonly conditionTypes: number; readonly conditionBlocks?: number };
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
  readonly residualPlaceholders: number;
  readonly placeholderOccurrences: { readonly text: number; readonly systemNote: number; readonly condition: number };
  readonly noteOnlyInputs: readonly string[];
  readonly noteNonNameForms: readonly string[];
  readonly conditionTypesMapped: number;
  readonly conditionTypesUsed: readonly string[];
  readonly conditionTypesUnused: readonly string[];
  readonly conditionBlocks: number;
  readonly inlineConditionBlocks: number;
  readonly balancedConditions: boolean;
  readonly exclusiveGroups: number;
  readonly choicesBuilt: number;
  readonly systemNotes: number;
  readonly systemNotesRendered: number;
  readonly ignoredLines: number;
  readonly scaffoldingLines: number;
  readonly crossReferences: { readonly entries: number; readonly replaced: number; readonly externalCitations: number; readonly unmappedRemissions: number };
  readonly anchors: { readonly defined: number; readonly attached: number };
  readonly annexes: number;
  readonly aiSlots: number;
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

const REQUIRED_DIALECT_REGEX: readonly (keyof MasterDialect)[] = ["placeholder", "conditionOpen", "conditionClose", "systemNote", "numberedHeading", "decimalParagraph"];
const OPTIONAL_DIALECT_REGEX: readonly (keyof MasterDialect)[] = [
  "conditionElse", "inlineConditionOpen", "inlineConditionClose", "systemNoteEnd", "ignoreLine", "scaffoldingHeadings", "ordinalHeading", "boldNumberedHeading",
  "alphaParagraph", "alphaSubParagraph", "seqParagraph", "listItem",
];
const DIALECT_GROUPS: readonly (readonly [keyof MasterDialect, readonly string[]])[] = [
  ["placeholder", ["name"]], ["conditionOpen", ["type"]], ["inlineConditionOpen", ["type"]], ["numberedHeading", ["num", "title"]],
  ["ordinalHeading", ["prefix", "ordinal", "title"]], ["boldNumberedHeading", ["num", "title"]], ["decimalParagraph", ["num", "text"]], ["alphaParagraph", ["letter", "text"]],
  ["alphaSubParagraph", ["letter", "sub", "text"]], ["seqParagraph", ["num", "text"]], ["listItem", ["text"]],
];

function tryRegex(src: string, flags: string): RegExp | null {
  try { return new RegExp(src, flags); } catch { return null; }
}

export function validateMasterMapping(mapping: MasterMapping, catalog: VariableCatalog2): CompileIssue[] {
  const issues: CompileIssue[] = [];
  const bad = (code: string, msg: string): void => { issues.push(err(code, msg)); };
  if (mapping.format !== MASTER_MAPPING_FORMAT) bad("MAPPING_FORMAT_UNSUPPORTED", `formato ${String(mapping.format)} ≠ ${MASTER_MAPPING_FORMAT}`);
  if (!mapping.modelKey || !mapping.sourceLogicalVersion) bad("MAPPING_INVALID", "modelKey e sourceLogicalVersion são obrigatórios");
  if (mapping.catalogVersion !== catalog.version) bad("MAPPING_CATALOG_MISMATCH", `mapeamento exige catálogo ${mapping.catalogVersion}; informado ${catalog.version}`);
  if (mapping.dialect?.lineBreaks !== "join" && mapping.dialect?.lineBreaks !== "paragraph") bad("MAPPING_DIALECT_INVALID", "dialect.lineBreaks deve ser join ou paragraph");

  for (const k of REQUIRED_DIALECT_REGEX) if (typeof mapping.dialect?.[k] !== "string") bad("MAPPING_DIALECT_INVALID", `dialect.${k} ausente`);
  for (const k of [...REQUIRED_DIALECT_REGEX, ...OPTIONAL_DIALECT_REGEX]) {
    const src = mapping.dialect?.[k];
    if (typeof src === "string" && !tryRegex(src, "u")) bad("MAPPING_DIALECT_INVALID", `dialect.${k} não é uma regex válida`);
  }
  for (const [k, groups] of DIALECT_GROUPS) {
    const src = mapping.dialect?.[k];
    if (typeof src === "string") for (const g of groups) if (!src.includes(`(?<${g}>`)) bad("MAPPING_DIALECT_INVALID", `dialect.${k} exige o grupo nomeado "${g}"`);
  }
  if ((mapping.dialect?.inlineConditionOpen === undefined) !== (mapping.dialect?.inlineConditionClose === undefined)) bad("MAPPING_DIALECT_INVALID", "inlineConditionOpen e inlineConditionClose andam juntos");

  const docRoles = new Set<string>(); const docOrders = new Set<number>();
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
        if (docRoles.has(d.role) || docOrders.has(d.order)) bad("MAPPING_INPUT_INVALID", `${name}: role/order de docRef repetidos`);
        docRoles.add(d.role); docOrders.add(d.order);
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

  const anchorLookups = new Set<string>(); const anchorKeys = new Set<string>();
  for (const a of mapping.anchors ?? []) {
    const lk = anchorLookup(a);
    if (anchorLookups.has(lk)) bad("MAPPING_ANCHOR_INVALID", `âncora duplicada para ${lk}`);
    anchorLookups.add(lk); anchorKeys.add(a.key);
    if (a.kind === "alpha" && !a.parent) bad("MAPPING_ANCHOR_INVALID", `âncora alpha ${a.key} exige parent`);
  }
  const ctxs = new Set<string>();
  for (const x of mapping.crossReferences ?? []) {
    const markers = (x.context.match(/⟦/g) ?? []).length;
    if (!x.context || markers < 1 || markers !== (x.context.match(/⟧/g) ?? []).length || markers !== x.targets.length) bad("MAPPING_XREF_INVALID", `remissão "${x.context}": marcadores ⟦ ⟧ e targets devem coincidir`);
    if (!Number.isSafeInteger(x.occurrences) || x.occurrences < 1) bad("MAPPING_XREF_INVALID", `remissão "${x.context}": occurrences ≥ 1`);
    const id = `${x.scope}|${x.context}`;
    if (ctxs.has(id)) bad("MAPPING_XREF_INVALID", `remissão duplicada: ${id}`);
    ctxs.add(id);
    for (const t of x.targets) if (!anchorKeys.has(t) && !(mapping.annexes ?? []).some((a) => a.id === t)) bad("MAPPING_XREF_INVALID", `remissão "${x.context}": alvo ${t} sem âncora definida`);
  }
  for (const a of mapping.annexes ?? []) if (!tryRegex(a.headingMatch, "u")) bad("MAPPING_ANNEX_INVALID", `anexo ${a.id}: headingMatch inválido`);
  if (mapping.remissionScan && !tryRegex(mapping.remissionScan.pattern, "gu")) bad("MAPPING_DIALECT_INVALID", "remissionScan.pattern inválida");
  for (const g of mapping.guards ?? []) {
    const d = mapping.inputs?.[g.placeholder];
    if (!d || d.kind !== "variable") bad("MAPPING_GUARD_INVALID", `guard ${g.placeholder}: exige entrada do tipo variable`);
    if (!g.rationale?.trim()) bad("MAPPING_GUARD_INVALID", `guard ${g.placeholder}: justificativa obrigatória`);
  }
  return issues;
}

function anchorLookup(a: Pick<AnchorMapping, "scope" | "kind" | "literal" | "parent">): string {
  return `${a.kind}|${a.scope}|${a.parent ?? ""}|${a.literal}`;
}

// ─── Compilação ────────────────────────────────────────────────────────────────────────────────────────────────────

interface Frame {
  readonly kind: "root" | "section" | "annex" | "block";
  readonly level: number;
  children: TemplateNode2[];
  readonly line: number;
  readonly key?: string;
  readonly title?: Inline2[];
  readonly style?: "decimal" | "ordinal";
  readonly prefix?: string;
  /** nº de componentes do número literal do título (7 → 1; 2.2 → 2): base para o nível dos parágrafos decimais */
  readonly depth?: number;
  readonly annex?: AnnexMapping;
  readonly typeId?: string;
  readonly when?: Cond2;
  thenChildren?: TemplateNode2[];
}

interface ParaState {
  text: string;
  line: number;
  form: "plain" | "decimal" | "alpha" | "alphaSub" | "seq";
  literal?: string;
  level?: number;
}

const LETTER = /[\p{L}\p{N}]/u;

export function compileApprovedMaster(input: {
  readonly markdown: string;
  readonly expectedSha256: string;
  readonly mapping: MasterMapping;
  readonly catalog: VariableCatalog2;
  /** Embute o rótulo literal do texto-fonte em cada parágrafo/seção numerado (só para auditoria de numeração; NÃO publicar). */
  readonly auditLiterals?: boolean;
}): CompileResult {
  const { markdown, mapping, catalog } = input;
  const audit = input.auditLiterals === true;
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
  const rx = (src: string | undefined): RegExp | null => (src === undefined ? null : new RegExp(src, "u"));
  const reOpen = new RegExp(d.conditionOpen, "u");
  const reElse = rx(d.conditionElse);
  const reClose = new RegExp(d.conditionClose, "u");
  const reNote = new RegExp(d.systemNote, "u");
  const reNoteEnd = rx(d.systemNoteEnd);
  const reIgnore = rx(d.ignoreLine);
  const reScaffold = rx(d.scaffoldingHeadings);
  const reNumHeading = new RegExp(d.numberedHeading, "u");
  const reOrdHeading = rx(d.ordinalHeading);
  const reBoldHeading = rx(d.boldNumberedHeading);
  const reDecimal = new RegExp(d.decimalParagraph, "u");
  const reAlpha = rx(d.alphaParagraph);
  const reAlphaSub = rx(d.alphaSubParagraph);
  const reSeq = rx(d.seqParagraph);
  const reList = rx(d.listItem);
  const rePlaceholderG = new RegExp(d.placeholder, "gu");
  const reInlineOpen = d.inlineConditionOpen ? new RegExp(d.inlineConditionOpen, "gu") : null;
  const reInlineClose = d.inlineConditionClose ? new RegExp(d.inlineConditionClose, "gu") : null;
  const reRemission = mapping.remissionScan ? new RegExp(mapping.remissionScan.pattern, "gu") : null;
  const annexMatchers = mapping.annexes.map((a) => ({ a, re: new RegExp(a.headingMatch, "u") }));
  const anchorMap = new Map(mapping.anchors.map((a) => [anchorLookup(a), a.key]));
  const anchorAttached = new Set<string>();
  const annexById = new Map(mapping.annexes.map((a) => [a.id, a]));
  const guardByPlaceholder = new Map((mapping.guards ?? []).map((g) => [g.placeholder, g]));

  // Remissões: contexto exato → spans. Estado de contagem por entrada.
  const xrefEntries = mapping.crossReferences.map((x) => ({
    x, plain: x.context.split(MARK_OPEN).join("").split(MARK_CLOSE).join(""),
    parts: (() => {
      // posições (relativas ao texto sem marcadores) de cada literal marcado
      const out: { start: number; end: number }[] = [];
      let plainIdx = 0; let i = 0;
      while (i < x.context.length) {
        const ch = x.context[i];
        if (ch === MARK_OPEN) { const start = plainIdx; const close = x.context.indexOf(MARK_CLOSE, i); const inner = x.context.slice(i + 1, close); plainIdx += inner.length; out.push({ start, end: plainIdx }); i = close + 1; } else { plainIdx += 1; i += 1; }
      }
      return out;
    })(),
    count: 0,
  }));
  const externalCounts = new Map((mapping.externalCitations ?? []).map((c) => [c, 0]));
  let externalTotal = 0;
  let xrefReplacedTotal = 0;
  let unmappedRemissions = 0;
  let residualPlaceholders = 0;

  const seen = new Map<string, { text: number; systemNote: number; condition: number }>();
  const unknown = new Set<string>();
  const bump = (name: string, where: "text" | "systemNote" | "condition"): void => {
    const cur = seen.get(name) ?? { text: 0, systemNote: 0, condition: 0 };
    cur[where] += 1;
    seen.set(name, cur);
  };
  const occ = { text: 0, systemNote: 0, condition: 0 };
  const usedTypes = new Set<string>();
  let blocks = 0; let inlineBlocks = 0; let choicesBuilt = 0; let aiSlots = 0;
  let ignoredLines = 0; let scaffoldingLines = 0;
  const noteEvidence: { line: number; sha256: string }[] = [];
  const noteForms = new Set<string>();
  const nodeType = new WeakMap<object, string>();
  const tableKeyCount = new Map<string, number>();
  const groupKeyCount = new Map<string, number>();
  const slotKeyCount = new Map<string, number>();
  let sectionSeq = 0;

  const root: Frame = { kind: "root", level: 0, children: [], line: 0 };
  const stack: Frame[] = [root];
  const top = (): Frame => stack[stack.length - 1];
  const scopeName = (): string => { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === "annex") return stack[i].annex!.id; return "main"; };
  let lastDecimalLiteral = "";

  const scanNote = (text: string, line: number): void => {
    for (const m of text.matchAll(/\{\{[^{}]*\}\}/gu)) {
      const whole = new RegExp(`^(?:${d.placeholder})$`, "u").exec(m[0]);
      const name = whole?.groups?.name;
      if (name === undefined) { if (!/^\{\{[#/]/u.test(m[0])) noteForms.add(m[0]); continue; }
      occ.systemNote += 1;
      if (mapping.inputs[name]) bump(name, "systemNote"); else unknown.add(name);
    }
    void line;
  };
  const scanConditionLine = (text: string, line: number): void => {
    for (const m of text.matchAll(rePlaceholderG)) {
      const name = m.groups?.name ?? "";
      occ.condition += 1;
      if (mapping.inputs[name]) bump(name, "condition"); else { unknown.add(name); issues.push(err("PLACEHOLDER_UNKNOWN", `placeholder desconhecido em linha de condição: ${name}`, line)); }
    }
  };

  const uniq = (counts: Map<string, number>, base: string): string => {
    const n = (counts.get(base) ?? 0) + 1;
    counts.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  // Inline ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const aiInline = (name: string, disp: Extract<InputDisposition, { kind: "aiSlot" }>): Inline2 => {
    aiSlots += 1;
    return { t: "aiSlot", slotKey: uniq(slotKeyCount, disp.slotKey), maxTokens: disp.maxTokens, instructionsKey: disp.instructionsKey };
  };

  const pushFragment = (frag: string, line: number, out: Inline2[]): void => {
    if (!frag) return;
    if (/\{\{|\}\}/u.test(frag)) { residualPlaceholders += 1; issues.push(err("PLACEHOLDER_RESIDUAL", `marcação {{ }} não reconhecida no texto: "${frag.slice(0, 80)}"`, line)); }
    const scope = scopeName();
    type Hit = { start: number; end: number; target: string; ctxStart: number; ctxEnd: number; entry: number };
    const hits: Hit[] = [];
    xrefEntries.forEach((e, ei) => {
      if (e.x.scope !== "*" && e.x.scope !== scope) return;
      let from = 0;
      for (;;) {
        const at = frag.indexOf(e.plain, from);
        if (at < 0) break;
        from = at + 1;
        const before = at > 0 ? frag[at - 1] : "";
        const after = frag[at + e.plain.length] ?? "";
        const after2 = frag[at + e.plain.length + 1] ?? "";
        if (before && (LETTER.test(before) || before === ".")) continue;
        if (after && (LETTER.test(after) || (after === "." && /\d/u.test(after2)))) continue;
        e.parts.forEach((p, pi) => hits.push({ start: at + p.start, end: at + p.end, target: e.x.targets[pi], ctxStart: at, ctxEnd: at + e.plain.length, entry: ei }));
      }
    });
    hits.sort((a, b) => a.start - b.start || b.end - a.end);
    // Resolve sobreposição de CONTEXTOS (o mais longo vence); conta uma vez por contexto aplicado.
    const accepted: Hit[] = []; const appliedCtx = new Set<string>();
    let lastEnd = -1;
    for (const h of hits) {
      if (h.start < lastEnd) continue;
      accepted.push(h); lastEnd = h.end;
      const id = `${h.entry}:${h.ctxStart}`;
      if (!appliedCtx.has(id)) { appliedCtx.add(id); xrefEntries[h.entry].count += 1; }
    }
    const covered: [number, number][] = accepted.map((h) => [h.ctxStart, h.ctxEnd]);
    // Citações externas (texto exato) ficam como texto e cobrem o trecho.
    for (const c of externalCounts.keys()) {
      let from = 0;
      for (;;) {
        const at = frag.indexOf(c, from);
        if (at < 0) break;
        from = at + c.length;
        externalCounts.set(c, (externalCounts.get(c) ?? 0) + 1);
        externalTotal += 1;
        covered.push([at, at + c.length]);
      }
    }
    if (reRemission) {
      reRemission.lastIndex = 0;
      for (const m of frag.matchAll(reRemission)) {
        const s = m.index ?? 0; const e = s + m[0].replace(/[.,;:]+$/u, "").length; // pontuação final não é parte da remissão
        if (covered.some(([cs, ce]) => s >= cs && e <= ce)) continue;
        unmappedRemissions += 1;
        issues.push(err("UNMAPPED_REMISSION", `remissão literal sem xref governada: "${m[0]}"`, line));
      }
    }
    let pos = 0;
    for (const h of accepted) {
      if (h.start > pos) out.push({ t: "text", v: frag.slice(pos, h.start) });
      out.push({ t: "xref", target: h.target });
      // auditoria: o rótulo resolvido pelo composer deve ser IGUAL ao literal do texto-fonte (cenário com os mesmos blocos ativos)
      if (audit) out.push({ t: "text", v: `${MARK_OPEN}=${frag.slice(h.start, h.end)}${MARK_CLOSE}` });
      xrefReplacedTotal += 1;
      pos = h.end;
    }
    if (pos < frag.length) out.push({ t: "text", v: frag.slice(pos) });
  };

  const plain = (text: string, line: number): Inline2[] => {
    const out: Inline2[] = [];
    let last = 0;
    for (const m of text.matchAll(rePlaceholderG)) {
      const name = m.groups?.name ?? "";
      const idx = m.index ?? 0;
      pushFragment(text.slice(last, idx), line, out);
      last = idx + m[0].length;
      occ.text += 1;
      const disp = mapping.inputs[name];
      if (!disp) { unknown.add(name); issues.push(err("PLACEHOLDER_UNKNOWN", `placeholder desconhecido: ${name}`, line)); continue; }
      bump(name, "text");
      if (disp.kind === "variable") out.push({ t: "var", name: disp.var });
      else if (disp.kind === "aiSlot") out.push(aiInline(name, disp));
      else if (disp.kind === "control") issues.push(err("CONTROL_ONLY_PLACEHOLDER_IN_TEXT", `controle ${name} não pode ser texto`, line));
      else issues.push(err("PLACEHOLDER_POSITION_INVALID", `${name} (${disp.kind}) só pode ocupar um parágrafo inteiro`, line));
    }
    pushFragment(text.slice(last), line, out);
    return out;
  };

  const emphasis = (text: string, line: number): Inline2[] => {
    const strong = /\*\*(.+?)\*\*/su.exec(text);
    if (strong) {
      const i = strong.index ?? 0;
      return [...emphasis(text.slice(0, i), line), { t: "strong", v: emphasis(strong[1], line) }, ...emphasis(text.slice(i + strong[0].length), line)];
    }
    const em = /(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?![*\w])/su.exec(text);
    if (em) {
      const i = em.index ?? 0;
      return [...emphasis(text.slice(0, i), line), { t: "em", v: plain(em[1], line) }, ...emphasis(text.slice(i + em[0].length), line)];
    }
    return plain(text, line);
  };

  /** Texto → inlines, resolvendo condicionais INLINE ({{#X}}…{{/X}} no meio do parágrafo). */
  const inline = (raw: string, line: number): Inline2[] => {
    const text = raw;
    if (!reInlineOpen || !reInlineClose) return emphasis(text.trim(), line);
    const tags: { index: number; length: number; open: boolean; type: string }[] = [];
    for (const m of text.matchAll(reInlineOpen)) tags.push({ index: m.index ?? 0, length: m[0].length, open: true, type: m.groups?.type ?? "" });
    for (const m of text.matchAll(reInlineClose)) tags.push({ index: m.index ?? 0, length: m[0].length, open: false, type: m.groups?.type ?? "" });
    if (tags.length === 0) return emphasis(text.trim(), line);
    tags.sort((a, b) => a.index - b.index);
    type InFrame = { type: string | null; when?: Cond2; items: Inline2[] };
    const frames: InFrame[] = [{ type: null, items: [] }];
    let pos = 0;
    const lead = text.length - text.trimStart().length;
    const emit = (seg: string, isFirst: boolean, isLast: boolean): void => {
      let s = seg;
      if (isFirst) s = s.trimStart();
      if (isLast) s = s.trimEnd();
      if (s) frames[frames.length - 1].items.push(...emphasis(s, line));
    };
    void lead;
    tags.forEach((t, ti) => {
      emit(text.slice(pos, t.index), pos === 0, false);
      pos = t.index + t.length;
      if (t.open) {
        const cm = mapping.conditions[t.type];
        if (!cm) { issues.push(err("CONDITION_TYPE_UNMAPPED", `tipo de condição inline sem mapeamento: ${t.type}`, line)); frames.push({ type: t.type, items: [] }); return; }
        usedTypes.add(t.type); blocks += 1; inlineBlocks += 1;
        frames.push({ type: t.type, when: cm.when, items: [] });
      } else {
        const f = frames.length > 1 ? frames.pop()! : null;
        if (!f || f.type !== t.type) { issues.push(err("CONDITION_UNBALANCED", `fechamento inline ${t.type} sem abertura correspondente`, line)); return; }
        if (f.when) frames[frames.length - 1].items.push({ t: "when", when: f.when, then: f.items });
      }
      void ti;
    });
    emit(text.slice(pos), false, true);
    if (frames.length > 1) issues.push(err("CONDITION_UNBALANCED", `condição inline ${frames[frames.length - 1].type} aberta sem fechamento`, line));
    return frames[0].items;
  };

  // Estrutura ───────────────────────────────────────────────────────────────────────────────────────────────────────
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
      const distinct = new Set(types).size === types.length;
      const complete = distinct && def.branches.every((b) => types.includes(b)) && types.length === def.branches.length;
      if (types.length === 1 && distinct) out.push(run[0].node); // membro isolado do grupo: condicional simples
      else if (!complete) { issues.push(err("EXCLUSIVE_GROUP_INCOMPLETE", `grupo exclusivo ${group}: ramos adjacentes encontrados [${types.join(", ")}] ≠ declarados [${def.branches.join(", ")}]`, line)); out.push(...run.map((r) => r.node)); }
      else if (run.some((r) => r.node.else)) { issues.push(err("EXCLUSIVE_GROUP_ELSE", `bloco de grupo exclusivo ${group} não admite ramo alternativo`, line)); out.push(...run.map((r) => r.node)); }
      else {
        const branches: ChoiceBranch[] = run.map((r) => ({ key: r.type, when: r.node.when, children: r.node.then }));
        out.push({ t: "choice", groupKey: uniq(groupKeyCount, group), mode: def.mode, branches });
        choicesBuilt += 1;
      }
      i = j - 1;
    }
    return out;
  };

  const closeFrame = (): void => {
    const f = stack.pop()!;
    const kids = mergeChoices(f.children, f.line);
    let node: TemplateNode2;
    if (f.kind === "section") {
      node = { t: "section", key: f.key!, numbering: "auto", ...(f.style === "ordinal" ? { style: "ordinal" as const, ...(f.prefix ? { labelPrefix: f.prefix } : {}) } : {}), title: f.title, children: kids };
    } else if (f.kind === "annex") {
      node = { t: "annex", id: f.annex!.id, role: f.annex!.role, order: f.annex!.order, title: [{ t: "text", v: f.annex!.title }], children: kids };
    } else if (f.kind === "block") {
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
  let para = null as ParaState | null;
  let tableRows: { text: string; line: number }[] = [];
  let listItems: { text: string; ordered: boolean }[] = [];
  let noteOpen = false;

  const attachAnchor = (kind: AnchorMapping["kind"], literal: string, parent?: string): string | undefined => {
    const lk = anchorLookup({ scope: scopeName(), kind, literal, parent });
    const key = anchorMap.get(lk);
    if (key !== undefined) anchorAttached.add(lk);
    return key;
  };

  const flushPara = (): void => {
    if (!para) return;
    const p = para; para = null;
    const trimmed = p.text.trim();
    const single = new RegExp(`^(?:${d.placeholder})$`, "u").exec(trimmed);
    const sName = single?.groups?.name;
    const disp = sName ? mapping.inputs[sName] : undefined;
    if (p.form === "plain" && sName && disp && (disp.kind === "aiSlot" || disp.kind === "dataTable" || disp.kind === "docRef")) {
      occ.text += 1; bump(sName, "text");
      if (disp.kind === "aiSlot") { aiSlots += 1; top().children.push({ t: "aiSlot", slotKey: uniq(slotKeyCount, disp.slotKey), maxTokens: disp.maxTokens, instructionsKey: disp.instructionsKey }); }
      else if (disp.kind === "dataTable") {
        const columns: DataTableColumn[] = disp.columns.map((c) => ({ key: c.key, header: [{ t: "text", v: c.header }], ...(c.when ? { when: c.when } : {}) }));
        top().children.push({ t: "dataTable", tableKey: uniq(tableKeyCount, disp.tableKey), source: disp.source, columns });
      } else top().children.push({ t: "docRef", kind: disp.docKind, mode: "EXACT_PINNED", role: disp.role, order: disp.order, ...(disp.label ? { label: [{ t: "text" as const, v: disp.label }] } : {}) });
      return;
    }
    let body = inline(trimmed, p.line);
    let node: TemplateNode2;
    if (p.form === "plain") node = { t: "paragraph", inline: body };
    else {
      const numbered = p.form === "decimal" ? (true as const) : p.form === "seq" ? ("seq" as const) : ("alpha" as const);
      const level = p.level ?? 1;
      const anchor = p.form === "decimal" ? attachAnchor("paragraph", p.literal!)
        : p.form === "seq" ? attachAnchor("seq", p.literal!)
        : p.form === "alpha" ? attachAnchor("alpha", p.literal!, lastDecimalLiteral) : undefined;
      if (audit) body = [{ t: "text", v: `${MARK_OPEN}${p.literal}${MARK_CLOSE} ` }, ...body];
      node = { t: "paragraph", numbered, ...(level > 1 ? { level: level as 2 | 3 } : {}), ...(anchor !== undefined ? { anchor } : {}), inline: body };
      if (p.form === "decimal") lastDecimalLiteral = p.literal!;
    }
    // Guard governado: o parágrafo só existe quando a variável do placeholder está presente.
    for (const m of trimmed.matchAll(rePlaceholderG)) {
      const g = guardByPlaceholder.get(m.groups?.name ?? "");
      if (g) {
        const v = (mapping.inputs[g.placeholder] as Extract<InputDisposition, { kind: "variable" }>).var;
        node = { t: "conditional", when: { op: "present", var: v }, then: [node] };
        break;
      }
    }
    top().children.push(node);
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

  /** Próxima linha relevante (não em branco, não nota, não ignorada) — para decidir onde um bloco condicional começa. */
  const peekHeadingLevel = (from: number): number | null => {
    let inNote = false;
    for (let j = from; j < lines.length; j++) {
      const l = lines[j];
      if (inNote) { if (reNoteEnd ? reNoteEnd.test(l) : !l.trim()) inNote = false; continue; }
      if (reNote.test(l)) { if (!(reNoteEnd ? reNoteEnd.test(l) : false)) inNote = d.systemNoteBlock || !!reNoteEnd; continue; }
      if (!l.trim() || (reIgnore && reIgnore.test(l))) continue;
      const h = /^(#{1,6})\s+(.*)$/u.exec(l);
      if (h && reScaffold && reScaffold.test(h[2].trim())) continue;
      return h ? h[1].length : null;
    }
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const ln = i + 1;
    if (raw.length > MAX_LINE_CHARS) { issues.push(err("LINE_TOO_LONG", `linha excede ${MAX_LINE_CHARS} caracteres`, ln)); continue; }

    // Notas do sistema: evidência, nunca conteúdo. Nada do que está dentro da nota é interpretado.
    if (noteOpen) {
      if (!reNoteEnd && !raw.trim()) { noteOpen = false; continue; } // linha em branco que ENCERRA a nota não é conteúdo dela
      noteEvidence.push({ line: ln, sha256: sha256Hex(raw) });
      scanNote(raw, ln);
      if (reNoteEnd ? reNoteEnd.test(raw) : !raw.trim()) noteOpen = false;
      continue;
    }
    if (reNote.test(raw)) {
      flushAll();
      noteEvidence.push({ line: ln, sha256: sha256Hex(raw) });
      scanNote(raw, ln);
      if (reNoteEnd) noteOpen = !reNoteEnd.test(raw);
      else noteOpen = d.systemNoteBlock;
      continue;
    }
    if (reIgnore && reIgnore.test(raw)) { flushAll(); ignoredLines += 1; continue; }

    const open = reOpen.exec(raw);
    if (open) {
      flushAll();
      const type = open.groups?.type ?? "";
      const cm = mapping.conditions[type];
      scanConditionLine(raw, ln);
      if (!cm) { issues.push(err("CONDITION_TYPE_UNMAPPED", `tipo de bloco condicional sem mapeamento: ${type}`, ln)); continue; }
      // Bloco que ABRE com um título: os títulos de nível ≥ ao dele encerram as seções abertas ANTES do bloco (irmãs, não filhas).
      const nextLevel = peekHeadingLevel(i + 1);
      if (nextLevel !== null) while ((top().kind === "section" || top().kind === "annex") && top().level >= nextLevel) closeFrame();
      usedTypes.add(type); blocks += 1;
      stack.push({ kind: "block", level: top().level, children: [], line: ln, typeId: type, when: cm.when });
      continue;
    }
    if (reElse && reElse.test(raw)) {
      flushAll();
      if (!stack.some((s) => s.kind === "block")) { issues.push(err("CONDITION_UNBALANCED", "ramo alternativo fora de bloco", ln)); continue; }
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
      if (reScaffold && reScaffold.test(text)) { scaffoldingLines += 1; continue; }
      const annex = annexMatchers.find(({ re }) => re.test(text));
      while ((top().kind === "section" || top().kind === "annex") && top().level >= level) closeFrame();
      if (annex) {
        if (stack.slice(1).some((s) => s.kind !== "block")) issues.push(err("ANNEX_POSITION_INVALID", "anexo só na raiz ou dentro de condicionais da raiz", ln));
        lastDecimalLiteral = "";
        stack.push({ kind: "annex", level, children: [], line: ln, annex: annex.a });
        continue;
      }
      const oh = reOrdHeading ? reOrdHeading.exec(text) : null;
      if (oh) {
        const ordinal = oh.groups?.ordinal ?? "";
        const key = attachAnchor("section", ordinal) ?? `sec.${scopeName()}.${String(++sectionSeq).padStart(4, "0")}`;
        const title = inline(oh.groups?.title ?? "", ln);
        stack.push({ kind: "section", level, children: [], line: ln, key, depth: 1, style: "ordinal", prefix: oh.groups?.prefix ?? "", title: audit ? [{ t: "text", v: `${MARK_OPEN}${ordinal}${MARK_CLOSE} ` }, ...title] : title });
        lastDecimalLiteral = "";
        continue;
      }
      const nh = reNumHeading.exec(text);
      if (nh) {
        const num = nh.groups?.num ?? "";
        const key = attachAnchor("section", num) ?? `sec.${scopeName()}.${String(++sectionSeq).padStart(4, "0")}`;
        const title = inline(nh.groups?.title ?? text, ln);
        stack.push({ kind: "section", level, children: [], line: ln, key, depth: num.split(".").length, style: "decimal", title: audit ? [{ t: "text", v: `${MARK_OPEN}${num}${MARK_CLOSE} ` }, ...title] : title });
        lastDecimalLiteral = "";
      } else {
        top().children.push({ t: "heading", level: level as 1 | 2 | 3 | 4 | 5 | 6, text: inline(text, ln) });
      }
      continue;
    }

    if (!raw.trim()) { flushAll(); continue; }

    if (/^\s*\|/u.test(raw)) { flushPara(); flushList(); tableRows.push({ text: raw, line: ln }); continue; }
    flushTable();

    // Título em negrito numerado (ex.: "**3. Condições da proposta**" no modelo de proposta) ⇒ seção numerada do anexo.
    const bh = reBoldHeading ? reBoldHeading.exec(raw.trim()) : null;
    if (bh) {
      flushAll();
      const level = ([...stack].reverse().find((f) => f.kind === "annex")?.level ?? 1) + 1;
      while (top().kind === "section" && top().level >= level) closeFrame();
      const num = bh.groups?.num ?? "";
      const key = attachAnchor("section", num) ?? `sec.${scopeName()}.${String(++sectionSeq).padStart(4, "0")}`;
      const strong = inline(bh.groups?.title ?? "", ln);
      const title: Inline2[] = [{ t: "strong", v: strong }];
      stack.push({ kind: "section", level, children: [], line: ln, key, depth: 1, style: "decimal", title: audit ? [{ t: "text", v: `${MARK_OPEN}${num}${MARK_CLOSE} ` }, ...title] : title });
      lastDecimalLiteral = "";
      continue;
    }

    // Formas numeradas literais: o número NÃO é copiado — vira numeração automática; o literal só serve a âncoras e à auditoria.
    const asub = reAlphaSub ? reAlphaSub.exec(raw) : null;
    const al = !asub && reAlpha ? reAlpha.exec(raw) : null;
    const dec = !asub && !al ? reDecimal.exec(raw) : null;
    const sq = !asub && !al && !dec && reSeq ? reSeq.exec(raw) : null;
    if (asub || al || dec || sq) {
      flushPara(); flushList();
      if (asub) para = { text: asub.groups?.text ?? raw, line: ln, form: "alphaSub", literal: `${asub.groups?.letter}.${asub.groups?.sub}`, level: 2 };
      else if (al) para = { text: al.groups?.text ?? raw, line: ln, form: "alpha", literal: al.groups?.letter ?? "", level: 1 };
      else if (dec) {
        const num = dec.groups?.num ?? "";
        const base = [...stack].reverse().find((f) => f.kind === "section")?.depth ?? 0;
        para = { text: dec.groups?.text ?? raw, line: ln, form: "decimal", literal: num, level: Math.min(Math.max(num.split(".").length - base, 1), 3) };
      }
      else if (sq) para = { text: sq.groups?.text ?? raw, line: ln, form: "seq", literal: sq.groups?.num ?? "", level: 1 };
      if (d.lineBreaks === "paragraph") flushPara();
      continue;
    }
    const li = reList ? reList.exec(raw) : null;
    if (li) {
      flushPara();
      listItems.push({ text: li.groups?.text ?? raw, ordered: !!li.groups?.ordered });
      continue;
    }
    flushList();
    if (d.lineBreaks === "paragraph") { flushPara(); para = { text: raw.trim(), line: ln, form: "plain" }; flushPara(); }
    else para = para && para.form === "plain" ? { ...para, text: `${para.text} ${raw.trim()}` } : { text: raw.trim(), line: ln, form: "plain" };
  }
  flushAll();

  // Balanceamento: todo bloco aberto precisa ter sido fechado.
  let balanced = true;
  while (stack.length > 1) {
    if (top().kind === "block") { balanced = false; issues.push(err("CONDITION_UNBALANCED", `bloco ${top().typeId} aberto sem fechamento`, top().line)); stack.pop(); }
    else closeFrame();
  }
  if (issues.some((x) => x.code === "CONDITION_UNBALANCED" || x.code === "CONDITION_CLOSE_MISMATCH")) balanced = false;

  // Remissões: contagem de ocorrências == contagem governada; citações externas precisam ocorrer.
  for (const e of xrefEntries) {
    if (e.count !== e.x.occurrences) issues.push(err("XREF_COUNT_MISMATCH", `remissão [${e.x.scope}] "${e.x.context}": ${e.count} ocorrência(s) no texto, ${e.x.occurrences} esperada(s)`));
  }
  for (const [c, n] of externalCounts) if (n === 0) issues.push(err("EXTERNAL_CITATION_NOT_FOUND", `citação externa governada não encontrada no texto: "${c}"`));
  for (const a of mapping.anchors) if (!anchorAttached.has(anchorLookup(a)) && !annexById.has(a.key)) issues.push(err("ANCHOR_NOT_FOUND", `âncora ${a.key} (${a.scope} ${a.kind} ${a.parent ? `${a.parent}/` : ""}${a.literal}) não encontrada no texto-fonte`));

  // Paridade de entradas.
  const names = Object.keys(mapping.inputs).sort();
  const unmapped = names.filter((n) => !seen.has(n) && !mapping.inputs[n].allowAbsent);
  const controls = names.filter((n) => mapping.inputs[n].kind === "control");
  const noteOnly = names.filter((n) => { const s = seen.get(n); return !!s && s.text === 0; });
  const usedSorted = [...usedTypes].sort();
  const unusedTypes = Object.keys(mapping.conditions).sort().filter((t) => !usedTypes.has(t));
  const mappedVars = new Set(Object.values(mapping.inputs).flatMap((x) => (x.kind === "variable" || x.kind === "control" ? [x.var] : x.kind === "dataTable" ? [x.source] : [])));
  const report: ParityReport = {
    mappedInputs: names.length,
    renderCapableInputs: names.length - controls.length,
    controlInputs: controls.length,
    unknownPlaceholders: [...unknown].sort(),
    unmappedInputs: unmapped,
    residualPlaceholders,
    placeholderOccurrences: occ,
    noteOnlyInputs: noteOnly,
    noteNonNameForms: [...noteForms].sort(),
    conditionTypesMapped: Object.keys(mapping.conditions).length,
    conditionTypesUsed: usedSorted,
    conditionTypesUnused: unusedTypes,
    conditionBlocks: blocks,
    inlineConditionBlocks: inlineBlocks,
    balancedConditions: balanced,
    exclusiveGroups: Object.keys(mapping.exclusiveGroups).length,
    choicesBuilt,
    systemNotes: new Set(noteEvidence.map((e) => e.line)).size,
    systemNotesRendered: 0,
    ignoredLines,
    scaffoldingLines,
    crossReferences: { entries: mapping.crossReferences.length, replaced: xrefReplacedTotal, externalCitations: externalTotal, unmappedRemissions },
    anchors: { defined: mapping.anchors.length, attached: anchorAttached.size },
    annexes: mapping.annexes.length,
    aiSlots,
    catalogRenderableVarsNotInMapping: catalog.vars.filter((v) => v.renderable && v.type !== "table" && !mappedVars.has(v.name)).map((v) => v.name).sort(),
  };

  if (issues.length) return { ok: false, issues };

  // AST canônica + validação completa (mesmas regras do runtime): nada que o composer recusaria sai do compilador.
  // Controles (renderable=false) são declarados no início: resolvidos, validados e registrados no manifest, nunca renderizados.
  const controlRefs: TemplateNode2[] = controls.map((n) => ({ t: "controlRef" as const, var: (mapping.inputs[n] as Extract<InputDisposition, { kind: "control" }>).var }));
  const ast: TemplateAST2 = { schema: "tpl-ast/2", root: [...controlRefs, ...mergeChoices(root.children, 0)] };
  const v = validateAnyTemplateAst(ast, catalog);
  if (!v.ok) return { ok: false, issues: v.issues.map((i) => err(`AST_${i.code}`, `${i.path}: ${i.message}`)) };

  // Notas do sistema: contagem de LINHAS-INÍCIO (cada nota tem exatamente uma).
  const noteStarts = lines.filter((l) => reNote.test(l)).length;
  return {
    ok: true,
    value: {
      ast, report: { ...report, systemNotes: noteStarts }, findings: mapping.findings ?? [], systemNoteEvidence: noteEvidence,
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
  if (report.residualPlaceholders) f.push(`marcações {{ }} residuais: ${report.residualPlaceholders}`);
  if (report.conditionTypesMapped !== e.conditionTypes) f.push(`tipos de condição mapeados ${report.conditionTypesMapped} ≠ ${e.conditionTypes}`);
  if (report.conditionTypesUsed.length !== e.conditionTypes) f.push(`tipos de condição usados ${report.conditionTypesUsed.length} ≠ ${e.conditionTypes}`);
  if (e.conditionBlocks !== undefined && report.conditionBlocks !== e.conditionBlocks) f.push(`blocos condicionais ${report.conditionBlocks} ≠ ${e.conditionBlocks}`);
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

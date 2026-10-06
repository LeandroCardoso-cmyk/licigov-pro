/**
 * Modelos Institucionais — IMPORTAÇÃO SEGURA (Lane C).
 *
 *   Markdown/DOCX → representação CANDIDATA → validação → AST canônico candidato → (somente) DRAFT.
 *
 * Nunca executa conteúdo: texto é literal; não há eval, macro, JS embutido, SQL, fetch de rede nem include arbitrário.
 * Rejeita HTML cru, imagens, URLs perigosas (javascript:/data:/file:), sintaxe de macro/template ({% %}, ${ }, {{#..}}),
 * placeholders que não sejam `{{variável}}` simples, DOCX com macros (.docm/vbaProject), objetos OLE/ActiveX/embeddings e
 * entradas acima dos limites. A whitelist do AST T1 (`validateTemplateAst`) continua sendo a autoridade final:
 * variável fora do catálogo, nó/propriedade fora da whitelist ⇒ recusa. Importar NUNCA publica (T1: `createDraftRevision`).
 */
import * as mammoth from "mammoth";
import { Lexer, type Token, type Tokens } from "marked";
import {
  VARIABLE_NAME_RE, validateTemplateAst, type TemplateAST, type VariableCatalog,
} from "../../domain/institutionalTemplates";
import { summarizeAst, type AstSummary } from "./astSummary";
import type { TemplateWorkflowIssue } from "./errors";

export const IMPORT_LIMITS = Object.freeze({
  maxMarkdownChars: 512 * 1024,
  maxDocxBytes: 5 * 1024 * 1024,
  maxHtmlChars: 2 * 1024 * 1024,
  maxNodes: 5000,
});

export type ImportFormat = "markdown" | "docx";

/** Representação candidata (intermediária): estrutura de blocos já normalizada, ainda NÃO validada como AST. */
export type CandidateInline =
  | { t: "text"; v: string }
  | { t: "var"; name: string }
  | { t: "strong" | "em"; v: CandidateInline[] };
export type CandidateBlock =
  | { t: "heading"; level: 1 | 2 | 3 | 4; text: CandidateInline[] }
  | { t: "paragraph"; inline: CandidateInline[] }
  | { t: "list"; ordered: boolean; items: CandidateBlock[][] }
  | { t: "table"; header: CandidateInline[][]; rows: CandidateInline[][][] };

export type ImportResult =
  | {
      readonly ok: true;
      readonly format: ImportFormat;
      readonly sourceFormat: "MARKDOWN_IMPORT" | "DOCX_IMPORT";
      readonly ast: TemplateAST;
      readonly summary: AstSummary;
      readonly warnings: readonly string[];
    }
  | { readonly ok: false; readonly format: ImportFormat; readonly stage: "intake" | "parse" | "validation"; readonly issues: readonly TemplateWorkflowIssue[] };

type ImportIssueCode =
  | "IMPORT_TOO_LARGE" | "IMPORT_EMPTY" | "IMPORT_HTML_NOT_ALLOWED" | "IMPORT_IMAGE_NOT_ALLOWED" | "IMPORT_UNSAFE_URL"
  | "IMPORT_MACRO_REJECTED" | "IMPORT_DOCX_INVALID" | "IMPORT_DOCX_ACTIVE_CONTENT" | "IMPORT_TOO_MANY_NODES" | "IMPORT_UNSUPPORTED";

const issue = (code: ImportIssueCode, path: string, message: string): TemplateWorkflowIssue => ({ code, path, message });

class ImportRejected extends Error {
  constructor(readonly issues: TemplateWorkflowIssue[], readonly stage: "intake" | "parse") { super("import rejected"); }
}

// ─── texto literal + placeholders ─────────────────────────────────────────────

/** Sintaxes de template/macro que NUNCA são aceitas (mesmo como texto): a regra é rejeitar, não "escapar". */
const MACRO_SYNTAX = /\{%|%\}|<%|%>|\$\{|\{\{\s*[#/>!{^&@]|\}\}\}|\{\{\{/;

function textToInlines(text: string, path: string, warnings: string[]): CandidateInline[] {
  if (MACRO_SYNTAX.test(text)) throw new ImportRejected([issue("IMPORT_MACRO_REJECTED", path, "sintaxe de macro/template não é aceita na importação")], "parse");
  const out: CandidateInline[] = [];
  let rest = text;
  while (rest.length) {
    const open = rest.indexOf("{{");
    if (open === -1) { out.push({ t: "text", v: rest }); break; }
    if (open > 0) out.push({ t: "text", v: rest.slice(0, open) });
    const close = rest.indexOf("}}", open + 2);
    if (close === -1) throw new ImportRejected([issue("IMPORT_MACRO_REJECTED", path, "placeholder '{{' sem fechamento")], "parse");
    const name = rest.slice(open + 2, close).trim();
    if (!VARIABLE_NAME_RE.test(name)) throw new ImportRejected([issue("IMPORT_MACRO_REJECTED", path, `placeholder inválido (somente {{variavel}} simples do catálogo): ${name.slice(0, 40)}`)], "parse");
    out.push({ t: "var", name });
    rest = rest.slice(close + 2);
  }
  void warnings;
  return out;
}

const SAFE_URL = /^(https?:|mailto:)/i;
function checkUrl(url: string, path: string): void {
  const u = url.trim();
  if (u === "" || u.startsWith("#")) return;
  if (!SAFE_URL.test(u)) throw new ImportRejected([issue("IMPORT_UNSAFE_URL", path, "somente links http(s) ou mailto são aceitos (nunca javascript:, data:, file:)")], "parse");
}

// ─── Markdown → candidato ──────────────────────────────────────────────────────

function mdInlines(tokens: readonly Token[] | undefined, path: string, w: string[]): CandidateInline[] {
  const out: CandidateInline[] = [];
  for (const [i, tk] of (tokens ?? []).entries()) {
    const p = `${path}[${i}]`;
    switch (tk.type) {
      case "text": case "escape": {
        const t = tk as Tokens.Text;
        if (t.tokens && t.tokens.length) out.push(...mdInlines(t.tokens, p, w)); else out.push(...textToInlines(t.text, p, w));
        break;
      }
      case "codespan": out.push(...textToInlines((tk as Tokens.Codespan).text, p, w)); break;
      case "strong": out.push({ t: "strong", v: mdInlines((tk as Tokens.Strong).tokens, p, w) }); break;
      case "em": out.push({ t: "em", v: mdInlines((tk as Tokens.Em).tokens, p, w) }); break;
      case "del": out.push(...mdInlines((tk as Tokens.Del).tokens, p, w)); break;
      case "br": out.push({ t: "text", v: "\n" }); break;
      case "link": {
        const l = tk as Tokens.Link;
        checkUrl(l.href, p);
        out.push(...mdInlines(l.tokens, p, w));
        if (l.href && !l.href.startsWith("#")) out.push({ t: "text", v: ` (${l.href})` });
        break;
      }
      case "image": throw new ImportRejected([issue("IMPORT_IMAGE_NOT_ALLOWED", p, "imagens não são aceitas na importação")], "parse");
      case "html": case "tag": throw new ImportRejected([issue("IMPORT_HTML_NOT_ALLOWED", p, "HTML cru não é aceito na importação")], "parse");
      default: w.push(`inline ignorado (${tk.type}) em ${p}`);
    }
  }
  return out;
}

function mdBlocks(tokens: readonly Token[], path: string, w: string[]): CandidateBlock[] {
  const out: CandidateBlock[] = [];
  for (const [i, tk] of tokens.entries()) {
    const p = `${path}[${i}]`;
    switch (tk.type) {
      case "space": case "def": break;
      case "hr": w.push(`linha horizontal ignorada em ${p}`); break;
      case "heading": {
        const h = tk as Tokens.Heading;
        if (h.depth > 4) w.push(`título nível ${h.depth} reduzido para 4 em ${p}`);
        out.push({ t: "heading", level: Math.min(h.depth, 4) as 1 | 2 | 3 | 4, text: mdInlines(h.tokens, `${p}.text`, w) });
        break;
      }
      case "paragraph": out.push({ t: "paragraph", inline: mdInlines((tk as Tokens.Paragraph).tokens, `${p}.inline`, w) }); break;
      case "text": out.push({ t: "paragraph", inline: mdInlines((tk as Tokens.Text).tokens ?? [{ type: "text", raw: (tk as Tokens.Text).text, text: (tk as Tokens.Text).text } as Token], `${p}.inline`, w) }); break;
      case "code": out.push({ t: "paragraph", inline: textToInlines((tk as Tokens.Code).text, `${p}.code`, w) }); w.push(`bloco de código convertido em texto literal em ${p}`); break;
      case "blockquote": out.push(...mdBlocks((tk as Tokens.Blockquote).tokens, `${p}.quote`, w)); break;
      case "list": {
        const l = tk as Tokens.List;
        out.push({ t: "list", ordered: l.ordered, items: l.items.map((it, n) => mdBlocks(it.tokens, `${p}.items[${n}]`, w)) });
        break;
      }
      case "table": {
        const t = tk as Tokens.Table;
        out.push({
          t: "table",
          header: t.header.map((c, n) => mdInlines(c.tokens, `${p}.header[${n}]`, w)),
          rows: t.rows.map((r, ri) => r.map((c, n) => mdInlines(c.tokens, `${p}.rows[${ri}][${n}]`, w))),
        });
        break;
      }
      case "html": throw new ImportRejected([issue("IMPORT_HTML_NOT_ALLOWED", p, "HTML cru não é aceito na importação")], "parse");
      default: throw new ImportRejected([issue("IMPORT_UNSUPPORTED", p, `bloco não suportado: ${tk.type}`)], "parse");
    }
  }
  return out;
}

export function markdownToCandidate(markdown: string, warnings: string[]): CandidateBlock[] {
  if (markdown.length > IMPORT_LIMITS.maxMarkdownChars) throw new ImportRejected([issue("IMPORT_TOO_LARGE", "", `Markdown acima do limite de ${IMPORT_LIMITS.maxMarkdownChars} caracteres`)], "intake");
  if (markdown.trim() === "") throw new ImportRejected([issue("IMPORT_EMPTY", "", "conteúdo vazio")], "intake");
  return mdBlocks(new Lexer({ gfm: true }).lex(markdown), "blocks", warnings);
}

// ─── HTML (saída do mammoth) → candidato ───────────────────────────────────────

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g: string) => {
    if (g[0] === "#") {
      const code = g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[g.toLowerCase()] ?? m;
  });
}

type HtmlTok = { kind: "open" | "close"; tag: string; attrs: string } | { kind: "text"; text: string };
const FORBIDDEN_TAGS = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "link", "meta", "svg", "math", "base", "frame", "frameset", "applet"]);
const TRANSPARENT_TAGS = new Set(["span", "u", "sup", "sub", "s", "strike", "div", "section", "article", "body", "html", "tbody", "thead", "tfoot", "colgroup", "col", "caption", "small"]);

function tokenizeHtml(html: string): HtmlTok[] {
  const toks: HtmlTok[] = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|([^<]+)/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (m[0].startsWith("<!--")) continue;
    if (m[4] !== undefined) toks.push({ kind: "text", text: m[4] });
    else toks.push({ kind: m[1] ? "close" : "open", tag: m[2].toLowerCase(), attrs: m[3] ?? "" });
  }
  return toks;
}

class HtmlCursor {
  i = 0;
  constructor(readonly toks: HtmlTok[]) {}
  peek(): HtmlTok | undefined { return this.toks[this.i]; }
  next(): HtmlTok | undefined { return this.toks[this.i++]; }
}

function htmlInlines(c: HtmlCursor, stop: ReadonlySet<string>, path: string, w: string[]): CandidateInline[] {
  const out: CandidateInline[] = [];
  for (let t = c.peek(); t; t = c.peek()) {
    if (t.kind === "close" && stop.has(t.tag)) break;
    if (t.kind === "open" && (stop.has(`+${t.tag}`) || ["ul", "ol", "table", "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "td", "th"].includes(t.tag))) break;
    c.next();
    if (t.kind === "text") { const txt = decodeEntities(t.text).replace(/\s+/g, " "); if (txt !== "") out.push(...textToInlines(txt, path, w)); continue; }
    if (FORBIDDEN_TAGS.has(t.tag)) throw new ImportRejected([issue("IMPORT_HTML_NOT_ALLOWED", path, `elemento não permitido no documento: <${t.tag}>`)], "parse");
    if (t.tag === "img") throw new ImportRejected([issue("IMPORT_IMAGE_NOT_ALLOWED", path, "imagens não são aceitas na importação")], "parse");
    if (t.kind === "close") continue;
    if (t.tag === "br") { out.push({ t: "text", v: "\n" }); continue; }
    if (t.tag === "strong" || t.tag === "b" || t.tag === "em" || t.tag === "i") {
      const inner = htmlInlines(c, new Set([t.tag, ...stop]), path, w);
      if (c.peek()?.kind === "close" && (c.peek() as { tag: string }).tag === t.tag) c.next();
      out.push({ t: t.tag === "strong" || t.tag === "b" ? "strong" : "em", v: inner });
      continue;
    }
    if (t.tag === "a") {
      const href = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(t.attrs);
      const url = decodeEntities(href?.[1] ?? href?.[2] ?? "");
      checkUrl(url, path);
      const inner = htmlInlines(c, new Set(["a", ...stop]), path, w);
      if (c.peek()?.kind === "close" && (c.peek() as { tag: string }).tag === "a") c.next();
      out.push(...inner);
      if (url && !url.startsWith("#")) out.push({ t: "text", v: ` (${url})` });
      continue;
    }
    if (!TRANSPARENT_TAGS.has(t.tag)) w.push(`elemento <${t.tag}> convertido em texto em ${path}`);
  }
  return out;
}

function htmlList(c: HtmlCursor, ordered: boolean, path: string, w: string[]): CandidateBlock {
  const items: CandidateBlock[][] = [];
  for (let t = c.peek(); t; t = c.peek()) {
    if (t.kind === "close" && (t.tag === "ul" || t.tag === "ol")) { c.next(); break; }
    c.next();
    if (t.kind === "open" && t.tag === "li") {
      const blocks: CandidateBlock[] = [];
      const lead = htmlInlines(c, new Set(["li"]), `${path}.items[${items.length}]`, w);
      if (lead.length) blocks.push({ t: "paragraph", inline: lead });
      for (let u = c.peek(); u; u = c.peek()) {
        if (u.kind === "close" && u.tag === "li") { c.next(); break; }
        if (u.kind === "open" && (u.tag === "ul" || u.tag === "ol")) { c.next(); blocks.push(htmlList(c, u.tag === "ol", `${path}.items[${items.length}]`, w)); continue; }
        if (u.kind === "open" && u.tag === "p") { c.next(); const inl = htmlInlines(c, new Set(["p"]), path, w); if (c.peek()?.kind === "close") c.next(); if (inl.length) blocks.push({ t: "paragraph", inline: inl }); continue; }
        const more = htmlInlines(c, new Set(["li"]), path, w);
        if (more.length) blocks.push({ t: "paragraph", inline: more }); else c.next();
      }
      items.push(blocks);
    }
  }
  return { t: "list", ordered, items };
}

function htmlTable(c: HtmlCursor, path: string, w: string[]): CandidateBlock {
  const rows: { cells: CandidateInline[][]; header: boolean }[] = [];
  for (let t = c.peek(); t; t = c.peek()) {
    if (t.kind === "close" && t.tag === "table") { c.next(); break; }
    c.next();
    if (t.kind === "open" && t.tag === "tr") {
      const cells: CandidateInline[][] = [];
      let header = false;
      for (let u = c.peek(); u; u = c.peek()) {
        if (u.kind === "close" && u.tag === "tr") { c.next(); break; }
        c.next();
        if (u.kind === "open" && (u.tag === "td" || u.tag === "th")) {
          header = header || u.tag === "th";
          const inl: CandidateInline[] = [];
          for (let v = c.peek(); v; v = c.peek()) {
            if (v.kind === "close" && (v.tag === "td" || v.tag === "th")) { c.next(); break; }
            if (v.kind === "open" && v.tag === "p") { c.next(); if (inl.length) inl.push({ t: "text", v: " " }); inl.push(...htmlInlines(c, new Set(["p"]), path, w)); if (c.peek()?.kind === "close") c.next(); continue; }
            const more = htmlInlines(c, new Set(["td", "th"]), path, w);
            if (more.length) inl.push(...more); else c.next();
          }
          cells.push(inl);
        }
      }
      rows.push({ cells, header });
    }
  }
  if (rows.length === 0) throw new ImportRejected([issue("IMPORT_UNSUPPORTED", path, "tabela vazia")], "parse");
  const headerRow = rows[0].header ? rows.shift() : null;
  const width = Math.max(headerRow?.cells.length ?? 0, ...rows.map((r) => r.cells.length));
  const pad = (cells: CandidateInline[][]): CandidateInline[][] => Array.from({ length: width }, (_, i) => cells[i] ?? []);
  return { t: "table", header: headerRow ? pad(headerRow.cells) : Array.from({ length: width }, () => []), rows: rows.map((r) => pad(r.cells)) };
}

export function htmlToCandidate(html: string, warnings: string[]): CandidateBlock[] {
  if (html.length > IMPORT_LIMITS.maxHtmlChars) throw new ImportRejected([issue("IMPORT_TOO_LARGE", "", "conteúdo convertido acima do limite")], "intake");
  const c = new HtmlCursor(tokenizeHtml(html));
  const out: CandidateBlock[] = [];
  for (let t = c.peek(); t; t = c.peek()) {
    const path = `blocks[${out.length}]`;
    if (t.kind === "text") { c.next(); const txt = decodeEntities(t.text).trim(); if (txt) out.push({ t: "paragraph", inline: textToInlines(txt, path, warnings) }); continue; }
    if (t.kind === "close") { c.next(); continue; }
    if (FORBIDDEN_TAGS.has(t.tag)) throw new ImportRejected([issue("IMPORT_HTML_NOT_ALLOWED", path, `elemento não permitido no documento: <${t.tag}>`)], "parse");
    if (t.tag === "img") throw new ImportRejected([issue("IMPORT_IMAGE_NOT_ALLOWED", path, "imagens não são aceitas na importação")], "parse");
    if (/^h[1-6]$/.test(t.tag)) {
      c.next();
      const depth = Number(t.tag[1]);
      if (depth > 4) warnings.push(`título nível ${depth} reduzido para 4 em ${path}`);
      const text = htmlInlines(c, new Set([t.tag]), path, warnings);
      if (c.peek()?.kind === "close") c.next();
      out.push({ t: "heading", level: Math.min(depth, 4) as 1 | 2 | 3 | 4, text });
    } else if (t.tag === "p") {
      c.next();
      const inline = htmlInlines(c, new Set(["p"]), path, warnings);
      if (c.peek()?.kind === "close") c.next();
      if (inline.length) out.push({ t: "paragraph", inline });
    } else if (t.tag === "ul" || t.tag === "ol") { c.next(); out.push(htmlList(c, t.tag === "ol", path, warnings)); }
    else if (t.tag === "table") { c.next(); out.push(htmlTable(c, path, warnings)); }
    else if (TRANSPARENT_TAGS.has(t.tag)) { c.next(); }
    else { c.next(); warnings.push(`elemento <${t.tag}> ignorado em ${path}`); }
  }
  return out;
}

// ─── DOCX → HTML (mammoth) ─────────────────────────────────────────────────────

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const ACTIVE_CONTENT_MARKERS = ["vbaProject", "word/embeddings/", "activeX", "oleObject", "macroEnabled"];

export function docxIntakeIssues(buffer: Buffer, filename?: string): TemplateWorkflowIssue[] {
  const issues: TemplateWorkflowIssue[] = [];
  if (buffer.length === 0) return [issue("IMPORT_EMPTY", "", "arquivo vazio")];
  if (buffer.length > IMPORT_LIMITS.maxDocxBytes) return [issue("IMPORT_TOO_LARGE", "", `DOCX acima do limite de ${IMPORT_LIMITS.maxDocxBytes} bytes`)];
  if (!ZIP_MAGIC.every((b, i) => buffer[i] === b)) return [issue("IMPORT_DOCX_INVALID", "", "o arquivo não é um DOCX válido (assinatura ZIP ausente)")];
  if (filename && /\.(docm|dotm|dotx|xlsm|pptm)$/i.test(filename)) issues.push(issue("IMPORT_DOCX_ACTIVE_CONTENT", "filename", "formato com macros/modelo não é aceito; envie um .docx comum"));
  const probe = buffer.toString("latin1");
  for (const m of ACTIVE_CONTENT_MARKERS) {
    if (probe.includes(m)) issues.push(issue("IMPORT_DOCX_ACTIVE_CONTENT", "", `conteúdo ativo/embutido não é aceito (${m})`));
  }
  return issues;
}

async function docxToHtml(buffer: Buffer): Promise<{ html: string; messages: string[] }> {
  // Imagens viram <img src=""> (sem bytes) e são rejeitadas adiante; nenhuma rede é acessada.
  const result = await mammoth.convertToHtml({ buffer }, { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) });
  return { html: result.value, messages: result.messages.map((m) => m.message) };
}

// ─── candidato → AST canônico → validação ───────────────────────────────────────

function countNodes(blocks: readonly CandidateBlock[]): number {
  let n = 0;
  for (const b of blocks) { n++; if (b.t === "list") b.items.forEach((it) => { n += countNodes(it); }); }
  return n;
}

function finalize(format: ImportFormat, blocks: CandidateBlock[], catalog: VariableCatalog, warnings: string[]): ImportResult {
  if (blocks.length === 0) return { ok: false, format, stage: "parse", issues: [issue("IMPORT_EMPTY", "", "o documento não contém conteúdo importável")] };
  if (countNodes(blocks) > IMPORT_LIMITS.maxNodes) return { ok: false, format, stage: "parse", issues: [issue("IMPORT_TOO_MANY_NODES", "", `mais de ${IMPORT_LIMITS.maxNodes} blocos`)] };
  const ast = { schema: "tpl-ast/1" as const, root: blocks };
  const valid = validateTemplateAst(ast, catalog);
  if (!valid.ok) return { ok: false, format, stage: "validation", issues: valid.issues.map((i) => ({ code: i.code, path: i.path, message: i.message })) };
  return { ok: true, format, sourceFormat: format === "markdown" ? "MARKDOWN_IMPORT" : "DOCX_IMPORT", ast: valid.value, summary: summarizeAst(valid.value), warnings };
}

export interface ImportInput {
  readonly format: ImportFormat;
  readonly markdown?: string;
  readonly docx?: Buffer;
  readonly filename?: string;
}

/** Pipeline completo SEM persistência. O resultado `ok` é um AST CANDIDATO: só vira revisão como DRAFT (nunca PUBLISHED). */
export async function runImportPipeline(input: ImportInput, catalog: VariableCatalog): Promise<ImportResult> {
  const warnings: string[] = [];
  try {
    if (input.format === "markdown") {
      return finalize("markdown", markdownToCandidate(input.markdown ?? "", warnings), catalog, warnings);
    }
    const buffer = input.docx ?? Buffer.alloc(0);
    const intake = docxIntakeIssues(buffer, input.filename);
    if (intake.length) return { ok: false, format: "docx", stage: "intake", issues: intake };
    let converted: { html: string; messages: string[] };
    try { converted = await docxToHtml(buffer); }
    catch { return { ok: false, format: "docx", stage: "parse", issues: [issue("IMPORT_DOCX_INVALID", "", "não foi possível ler o DOCX")] }; }
    converted.messages.slice(0, 20).forEach((m) => warnings.push(`conversão: ${m}`));
    return finalize("docx", htmlToCandidate(converted.html, warnings), catalog, warnings);
  } catch (err) {
    if (err instanceof ImportRejected) return { ok: false, format: input.format, stage: err.stage, issues: err.issues };
    throw err;
  }
}

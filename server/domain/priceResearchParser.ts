/**
 * M8-PRICE-IMPORT-001 — Leitura ESTRUTURADA do texto da Pesquisa de Preços (colar/CSV/texto extraído).
 *
 * Defeito de homologação: o leitor anterior tratava CADA LINHA como um item ("uma linha = uma cotação"), de modo
 * que cabeçalho, metadados (processo, objeto, data), "Quantidade: 10", nomes de fornecedores e avisos viravam
 * itens/cotações (1 item com 3 cotações virou 36 itens e 46 cotações, com CATMAT sugerido para lixo).
 *
 * Este leitor é PURO e determinístico. Classifica cada linha (cabeçalho, metadado, item, descrição, quantidade,
 * unidade, cotação, fornecedor, data, resumo, observação/aviso, não reconhecida) e AGRUPA as cotações sob o item
 * corrente. Dois formatos convivem:
 *  - DELIMITADO (legado preservado): "descrição;quantidade;unidade;valor[;fornecedor]" (";" ou TAB), com
 *    cabeçalho opcional que reordena as colunas pelo nome — uma linha = uma cotação do item da linha;
 *  - DOCUMENTAL: blocos "Item 1 — …", "Quantidade: 10", "Unidade: UN", "Fornecedor A — R$ 3.900,00 — 05/10/2026".
 *
 * Nada é inventado: quantidade/preço ausentes ficam ausentes (`null`), e o que não é item nunca vira item.
 * Ambiguidades que poderiam gerar itens errados BLOQUEIAM a importação (`blocking`) — o servidor revisa a
 * prévia e corrige o texto; avisos (`warnings`) não bloqueiam. Fontes fictícias/sintéticas são SINALIZADAS.
 */

import { parseBRL } from "./money";
import { normalizeDecimal } from "./importCorrectionFields";
import { declaresFictitious, suggestsDemonstrative, isPartialDeclarationScope } from "./quoteProvenance";

export const PRICE_RESEARCH_PARSER_VERSION = "price-research-parser/2";

export type PriceLineKind =
  | "header" | "metadata" | "item" | "description" | "quantity" | "unit" | "quote" | "supplier"
  | "date" | "summary" | "note" | "unrecognized";

export interface PriceParseLine {
  /** Posição entre as linhas NÃO vazias (base 0) — a mesma do leitor anterior (identidade estável). */
  readonly index: number;
  readonly kind: PriceLineKind;
  readonly text: string;
}

export interface ParsedQuote {
  readonly index: number;
  readonly supplier: string;
  /** Valor UNITÁRIO em centavos; `null` quando ausente/ambíguo (não entra na média). */
  readonly valueCents: number | null;
  readonly date: string;
  readonly notes: string;
  /**
   * Fonte DECLARADA fictícia/demonstrativa (declaração explícita: "Fornecedor Fictício A", "dados fictícios",
   * "valores demonstrativos") — nunca fundamenta referência institucional. Ver `server/domain/quoteProvenance.ts`.
   */
  readonly fictitious: boolean;
  /** Suspeita heurística (termos genéricos: "teste", "exemplo", "homologação"…) — só aviso de revisão, nunca fictícia. */
  readonly suspected: boolean;
}

export interface ParsedPriceItem {
  readonly description: string;
  readonly specification: string;
  /** `null` = quantidade NÃO informada (nunca presumida). */
  readonly quantity: number | null;
  readonly unit: string;
  readonly quotes: readonly ParsedQuote[];
  /** Média HALF-UP das cotações com preço (centavos); `null` sem preço. */
  readonly averageCents: number | null;
  /** Média × quantidade (centavos); `null` sem quantidade ou sem preço. */
  readonly totalCents: number | null;
}

export type PriceParseIssueCode =
  | "EMPTY" | "QUOTE_WITHOUT_ITEM" | "ITEM_WITHOUT_DESCRIPTION" | "ITEM_WITHOUT_PRICE" | "MULTIPLE_PRICES"
  | "QUANTITY_MISSING" | "QUANTITY_CONFLICT" | "UNIT_CONFLICT" | "DECLARED_SUMMARY_MISMATCH" | "FICTITIOUS_SOURCE" | "SUSPECTED_DEMONSTRATIVE"
  | "FEW_QUOTES" | "UNRECOGNIZED_LINES";

export interface PriceParseIssue {
  readonly code: PriceParseIssueCode;
  readonly message: string;
  readonly lineIndex?: number;
}

export interface PriceResearchParse {
  readonly version: typeof PRICE_RESEARCH_PARSER_VERSION;
  readonly format: "delimited" | "documental" | "empty";
  readonly items: readonly ParsedPriceItem[];
  readonly lines: readonly PriceParseLine[];
  readonly quoteCount: number;
  /** Texto declara dados sintéticos/fictícios (homologação) — sinalizado no registro, nunca ocultado. */
  /** Declaração EXPLÍCITA de dados fictícios/demonstrativos (documento ou alguma cotação). */
  readonly synthetic: boolean;
  /** Só suspeita heurística (termos genéricos) — revisar a fonte; nada é gravado como fictício. */
  readonly suspected: boolean;
  /** Impedem a importação (zero gravação): o servidor corrige o texto a partir da prévia. */
  readonly blocking: readonly PriceParseIssue[];
  readonly warnings: readonly PriceParseIssue[];
}

// ─── Reconhecedores ───────────────────────────────────────────────────────────

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const BULLET = /^\s*(?:[-–—•*·▪>]+\s+)/;
const ITEM_START = /^(?:item|lote)\s*(?:n[º°o.]*\s*)?(\d{1,4})\s*(?:[—–:\-.)]\s*(.*))?$/i;
const LABEL = (labels: string) => new RegExp(`^(?:${labels})\\s*(?:[:\\-—–]\\s*|\\s+)(.+)$`, "i");
const DESCRIPTION = LABEL("descri[çc][ãa]o(?: do item)?|especifica[çc][ãa]o(?: t[ée]cnica)?|produto|material|servi[çc]o");
const QUANTITY = LABEL("quantidade(?: estimada| prevista| total)?|qtde?\\.?|quant\\.?");
const UNIT = LABEL("unidade(?: de (?:medida|fornecimento))?|unid\\.?|und\\.?|un\\.");
const SUPPLIER = LABEL("fornecedor|empresa|raz[ãa]o social|loja|site|fonte|proponente");
/** Rótulo removido do nome do fornecedor ("Cotação 1 — ", "Fornecedor: "); "Fornecedor A" (nome) é preservado. */
const QUOTE_LABEL = /^(?:(?:cota[çc][ãa]o|or[çc]amento|proposta)\s*(?:n[º°o.]*\s*)?\d{0,3}\s*[:—–\-.)]*\s*|(?:fornecedor|fonte|empresa|pre[çc]o)\s*[:—–\-]\s*)/i;
const QUOTE_HINT = /^(?:cota[çc][ãa]o|or[çc]amento|proposta|pre[çc]o|fornecedor|fonte|empresa)\b/i;
const UNIT_WORD = /\b(unidades?|un\.?|und\.?|pe[çc]as?|caixas?|resmas?|kits?|pacotes?|litros?|kg|metros?|m[2²])(?![\p{L}])/iu;
const QUOTE_HEADER_ONLY = /^(?:cota[çc][ãa]o|or[çc]amento|proposta)\s*(?:n[º°o.]*\s*)?\d{1,3}\s*[:—–\-.)]?\s*$/i;
const DATE_LINE = LABEL("data(?: da (?:cota[çc][ãa]o|proposta|consulta|pesquisa))?|consultado em|validade");
const DATE = /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/;
/** Valores com "R$" (qualquer formato pt-BR) — ou sem "R$" quando a linha é explicitamente de cotação/valor. */
const MONEY_RS = /R\$\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)/gi;
const MONEY_BARE = /(?<![\d/.,])(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})(?![\d/])/g;
const SUMMARY = /^(?:valor\s+(?:total|global|estimado|m[ée]dio|de refer[êe]ncia)|total(?:\s+(?:geral|estimado|do item))?|pre[çc]o\s+(?:m[ée]dio|de refer[êe]ncia|estimado)|m[ée]dia(?:\s+(?:aritm[ée]tica|simples))?|mediana|menor\s+pre[çc]o)\b/i;
const METADATA = /^(?:processo|objeto|data(?: da pesquisa)?|respons[aá]vel|elaborad[oa]|[óo]rg[ãa]o|entidade|munic[ií]pio|prefeitura|secretaria|unidade requisitante|setor|exerc[ií]cio|modalidade|refer[êe]ncia|metodologia|par[âa]metros?|crit[ée]rio|forma de pesquisa|pesquisa de pre[çc]os|mapa de pre[çc]os|cnpj|telefone|e-?mail|endere[çc]o)\b/i;
const NOTE = /^(?:obs(?:erva[çc][ãa]o|\.)?|nota|aviso|aten[çc][ãa]o|importante|ressalva|advert[êe]ncia)\b/i;
/**
 * Classificação ESTRUTURAL de linha-aviso (inalterada): linhas com estes termos são notas, não itens/cotações. A
 * PROVENIÊNCIA não vem desta regex ampla — só de `declaresFictitious` (explícita) / `suggestsDemonstrative` (suspeita).
 */
const FICTITIOUS = /fict[íi]ci|sint[ée]tic|homologa[çc][ãa]o|dados? de teste|\bteste\b|exemplo|inexistente|simulad/i;
const HEADER_DELIMITED = /descri|produto|item|quant|qtd|unid|valor|pre[çc]o|fornecedor/i;
const UNIT_PER_PRICE = /unit[áa]ri|p\/\s*un|por unidade|\/un\b|cada/i;

type Col = "description" | "quantity" | "unit" | "value" | "supplier" | "date";
const DEFAULT_COLUMNS: readonly Col[] = ["description", "quantity", "unit", "value", "supplier"];

function columnOf(h: string): Col | null {
  const s = strip(h);
  if (/descri|produto|especifica|material|objeto/.test(s)) return "description";
  if (/quant|qtd/.test(s)) return "quantity";
  if (/^un|unid|medida/.test(s)) return "unit";
  if (/valor|preco|r\$/.test(s)) return "value";
  if (/fornecedor|empresa|fonte|proponente/.test(s)) return "supplier";
  if (/data/.test(s)) return "date";
  return null;
}

function isHeaderRow(parts: readonly string[]): boolean {
  return parts.length >= 2 && parts.filter((p) => HEADER_DELIMITED.test(p)).length >= 2
    && parts.map(columnOf).filter(Boolean).length >= 2 && !parts.some((p) => /\d/.test(p));
}

function moneyIn(text: string, allowBare: boolean): string[] {
  const rs = [...text.matchAll(MONEY_RS)].map((m) => m[1]);
  if (rs.length > 0 || !allowBare) return rs;
  return [...text.replace(DATE, " ").matchAll(MONEY_BARE)].map((m) => m[1]);
}

function quantityOf(raw: string): { quantity: number | null; unitHint: string } {
  const m = raw.trim().match(/^([\d.,]+)\s*(.*)$/);
  if (!m) return { quantity: null, unitHint: "" };
  const n = normalizeDecimal(m[1]);
  const q = n !== null ? Number(n) : NaN;
  const u = m[2].match(UNIT_WORD)?.[1] ?? "";
  return { quantity: Number.isFinite(q) && q > 0 ? q : null, unitHint: /^un|^und/i.test(u) ? "UN" : u.replace(/\.$/, "") };
}

const halfUpAverage = (cents: readonly number[]): number | null => {
  if (cents.length === 0) return null;
  const sum = cents.reduce((a, b) => a + b, 0);
  return Math.floor((2 * sum + cents.length) / (2 * cents.length));
};

// ─── Leitor ───────────────────────────────────────────────────────────────────

interface Draft {
  startIndex: number;
  delimited: boolean;
  description: string;
  specification: string[];
  quantity: number | null;
  unit: string;
  quotes: ParsedQuote[];
}

export function parsePriceResearchText(text: string): PriceResearchParse {
  const raw = (text ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const lines: PriceParseLine[] = [];
  const blocking: PriceParseIssue[] = [];
  const warnings: PriceParseIssue[] = [];
  const drafts: Draft[] = [];
  const delimitedDrafts = new Map<string, Draft>();
  let current: Draft | null = null;
  let pending: { supplier: string; date: string; notes: string[]; fictitious: boolean; suspected: boolean } | null = null;
  let columns: readonly Col[] = DEFAULT_COLUMNS;
  let delimitedRows = 0;
  let documentalSignals = 0;
  const declared: { index: number; cents: number; label: string; item: Draft | null }[] = [];
  const mark = (index: number, kind: PriceLineKind, t: string) => lines.push({ index, kind, text: t });

  const startItem = (index: number, description: string): Draft => {
    const d: Draft = { startIndex: index, delimited: false, description: description.trim(), specification: [], quantity: null, unit: "", quotes: [] };
    drafts.push(d);
    current = d;
    pending = null;
    return d;
  };

  const pushQuote = (index: number, line: string, allowBare: boolean): boolean => {
    const amounts = moneyIn(line, allowBare);
    if (amounts.length === 0) return false;
    let chosen = amounts[0];
    if (amounts.length > 1) {
      // Mais de um valor na linha: só é seguro com rótulo de unitário; senão a linha é AMBÍGUA (nunca adivinhar).
      const unitM = line.match(new RegExp(`(?:${UNIT_PER_PRICE.source})[^R\\d]*R?\\$?\\s*([\\d.,]+)|R\\$\\s*([\\d.,]+)\\s*\\(?\\s*(?:${UNIT_PER_PRICE.source})`, "i"));
      const picked = unitM ? (unitM[1] ?? unitM[2]) : null;
      if (picked) chosen = picked;
      else blocking.push({ code: "MULTIPLE_PRICES", lineIndex: index, message: `Linha ${index + 1}: mais de um valor sem indicação de qual é o preço unitário — "${line.slice(0, 120)}".` });
    }
    const cents = parseBRL(chosen);
    const firstMoney = line.search(/R\$|\d{1,3}(?:\.\d{3})*,\d{2}/);
    const before = (firstMoney >= 0 ? line.slice(0, firstMoney) : line).replace(QUOTE_LABEL, "").replace(DATE, " ").replace(/\(\s*\)/g, "").replace(/[\s:—–\-|,;]+$/g, "").trim();
    const after = line.slice(Math.max(0, firstMoney)).replace(MONEY_RS, " ").replace(DATE, " ").replace(/\(?\s*(?:unit[áa]rio|cada|por unidade)\s*\)?/gi, " ").replace(/^[\s—–\-|,;:]+|[\s—–\-|,;:]+$/g, "").replace(/\s{2,}/g, " ").trim();
    const p = pending as { supplier: string; date: string; notes: string[]; fictitious: boolean; suspected: boolean } | null;
    // "Valor unitário: R$ …" — rótulo do preço, não nome de fornecedor.
    const named = before.replace(/(?:^|\s*[—–\-|]\s*)(?:valor|pre[çc]o)(?:\s+(?:unit[áa]rio|cotado|ofertado))?\s*:?\s*$/i, "").trim();
    const supplier = named || p?.supplier || "";
    const date = line.match(DATE)?.[1] ?? p?.date ?? "";
    const notes = [...(p?.notes ?? []), ...(after ? [after] : [])].join(" — ");
    const fictitious = declaresFictitious(`${supplier} ${notes}`) || (p?.fictitious ?? false);
    const suspected = !fictitious && (suggestsDemonstrative(`${supplier} ${notes}`) || (p?.suspected ?? false));
    (current as Draft).quotes.push({ index, supplier, valueCents: cents !== null && cents > 0 ? cents : null, date, notes, fictitious, suspected });
    pending = null;
    return true;
  };

  raw.forEach((original, index) => {
    const line = original.replace(BULLET, "").trim();
    if (!line) return;

    // 1) DELIMITADO (";" ou TAB) — cabeçalho reordena colunas; cada linha = uma cotação do item da linha.
    const parts = line.split(/[;\t]/).map((p) => p.trim());
    // Sem cabeçalho, a 2ª coluna precisa ser uma QUANTIDADE (número simples): "Fornecedor A; R$ 3.900,00; 05/10" não é linha delimitada.
    const plainQty = parts.length >= 2 && !/R\$|\//.test(parts[1]) && quantityOf(parts[1]).quantity !== null;
    const headerSeen = columns !== DEFAULT_COLUMNS;
    if (parts.length >= 2 && (plainQty || headerSeen || isHeaderRow(parts))) {
      if (isHeaderRow(parts)) {
        columns = parts.map((p, i) => columnOf(p) ?? (`ignored${i}` as Col));
        mark(index, "header", original);
        return;
      }
      const at = (c: Col) => { const i = columns.indexOf(c); return i >= 0 ? (parts[i] ?? "") : ""; };
      const description = at("description");
      if (!description) { mark(index, "unrecognized", original); return; }
      const q = at("quantity") ? quantityOf(at("quantity")) : { quantity: null, unitHint: "" };
      const unit = at("unit") || q.unitHint;
      const cents = at("value") ? parseBRL(at("value")) : null;
      const supplier = at("supplier");
      const key = `${strip(description).replace(/\s+/g, " ")}|${strip(unit)}|${q.quantity ?? ""}`;
      let d = delimitedDrafts.get(key);
      if (!d) {
        d = { startIndex: index, delimited: true, description, specification: [], quantity: q.quantity, unit, quotes: [] };
        delimitedDrafts.set(key, d);
        drafts.push(d);
      }
      d.quotes.push({ index, supplier, valueCents: cents !== null && cents > 0 ? cents : null, date: at("date"), notes: "", fictitious: declaresFictitious(supplier), suspected: suggestsDemonstrative(supplier) });
      delimitedRows++;
      current = null;
      mark(index, "quote", original);
      return;
    }

    // 2) DOCUMENTAL.
    const item = line.match(ITEM_START);
    if (item) {
      documentalSignals++;
      // "Item 1 — Computador … — 10 unidades" ⇒ a quantidade explícita no título também é lida.
      const title = (item[2] ?? "").trim();
      const d = startItem(index, title.replace(/\s*[—–\-|]\s*(\d[\d.,]*)\s*(unidades?|un\.?|und\.?|pe[çc]as?|caixas?|resmas?|kits?)\s*$/i, "").trim());
      const tq = title.match(/(\d[\d.,]*)\s*(unidades?|un\.?|und\.?|pe[çc]as?|caixas?|resmas?|kits?)\s*$/i);
      if (tq) { d.quantity = quantityOf(tq[1]).quantity; d.unit = d.unit || (/^un/i.test(tq[2]) ? "UN" : tq[2]); }
      mark(index, "item", original);
      return;
    }
    if (SUMMARY.test(line)) {
      const amounts = moneyIn(line, true);
      if (amounts.length > 0) {
        const cents = parseBRL(amounts[0]);
        if (cents !== null) declared.push({ index, cents, label: strip(line), item: current });
      }
      mark(index, "summary", original);
      return;
    }
    if (METADATA.test(line)) {
      // "Data: 05/10/2026" dentro do bloco de uma cotação é a data DA COTAÇÃO, não metadado do documento.
      const cur = current as Draft | null;
      if (DATE_LINE.test(line) && DATE.test(line) && (pending || (cur && cur.quotes.length > 0))) {
        const date = line.match(DATE)![1];
        const last = cur?.quotes[cur.quotes.length - 1];
        if (pending) pending.date = date;
        else if (cur && last && !last.date) cur.quotes[cur.quotes.length - 1] = { ...last, date };
        mark(index, "date", original);
        return;
      }
      mark(index, "metadata", original);
      return;
    }
    if (QUOTE_HEADER_ONLY.test(line)) {
      pending = { supplier: "", date: "", notes: [], fictitious: false, suspected: false };
      mark(index, "quote", original);
      return;
    }
    const qty = line.match(QUANTITY);
    if (qty && !/R\$/.test(line)) {
      documentalSignals++;
      const d = current ?? startItem(index, "");
      const q = quantityOf(qty[1]);
      if (d.quantity !== null && q.quantity !== null && d.quantity !== q.quantity) {
        blocking.push({ code: "QUANTITY_CONFLICT", lineIndex: index, message: `Linha ${index + 1}: quantidade ${q.quantity} diverge da já informada (${d.quantity}) para o mesmo item.` });
      }
      d.quantity = d.quantity ?? q.quantity;
      if (q.unitHint && !d.unit) d.unit = q.unitHint;
      mark(index, "quantity", original);
      return;
    }
    const unit = line.match(UNIT);
    if (unit && !/R\$/.test(line) && unit[1].length <= 30) {
      documentalSignals++;
      const d = current ?? startItem(index, "");
      const u = unit[1].trim().replace(/[.;]+$/, "");
      if (d.unit && strip(d.unit) !== strip(u) && !(strip(d.unit) === "un" && /^unid/.test(strip(u)))) {
        warnings.push({ code: "UNIT_CONFLICT", lineIndex: index, message: `Linha ${index + 1}: unidade "${u}" difere da já informada ("${d.unit}"); prevalece a primeira.` });
      } else d.unit = d.unit || u;
      mark(index, "unit", original);
      return;
    }
    const desc = line.match(DESCRIPTION);
    if (desc && !/R\$/.test(line)) {
      documentalSignals++;
      const d = current && current.quotes.length === 0 ? current : startItem(index, "");
      if (!d.description) d.description = desc[1].trim();
      else d.specification.push(desc[1].trim());
      mark(index, "description", original);
      return;
    }
    // Cotação: linha com valor monetário (com "R$", ou valor pt-BR numa linha rotulada como cotação/fornecedor).
    const labeledQuote = QUOTE_HINT.test(line) || pending !== null;
    if (/R\$/.test(line) || (labeledQuote && moneyIn(line, true).length > 0)) {
      if (!current) {
        blocking.push({ code: "QUOTE_WITHOUT_ITEM", lineIndex: index, message: `Linha ${index + 1}: valor encontrado antes de qualquer item identificado — "${line.slice(0, 120)}". Indique o item (ex.: "Item 1 — descrição").` });
        mark(index, "unrecognized", original);
        return;
      }
      documentalSignals++;
      pushQuote(index, line, true);
      mark(index, "quote", original);
      return;
    }
    const sup = line.match(SUPPLIER);
    if (sup) {
      pending = { ...(pending ?? { date: "", notes: [], fictitious: false, suspected: false }), supplier: sup[1].trim() };
      pending.fictitious = pending.fictitious || declaresFictitious(sup[1]);
      pending.suspected = pending.suspected || suggestsDemonstrative(sup[1]);
      mark(index, "supplier", original);
      return;
    }
    const dateL = line.match(DATE_LINE);
    if (dateL && DATE.test(line)) {
      const date = line.match(DATE)![1];
      const cur = current as Draft | null;
      const last = cur?.quotes[cur.quotes.length - 1];
      if (pending) pending.date = date;
      else if (cur && last && !last.date) cur.quotes[cur.quotes.length - 1] = { ...last, date };
      mark(index, cur ? "date" : "metadata", original);
      return;
    }
    if (NOTE.test(line) || FICTITIOUS.test(line)) {
      // Nota vizinha: declaração explícita marca a cotação; termo genérico só levanta suspeita (nunca fictícia).
      const explicit = declaresFictitious(line);
      if (explicit || suggestsDemonstrative(line)) {
        const cur = current as Draft | null;
        const last = cur?.quotes[cur.quotes.length - 1];
        const flag = explicit ? { fictitious: true, suspected: false } : { suspected: true };
        if (pending) Object.assign(pending, flag);
        else if (cur && last && last.index === index - 1) cur.quotes[cur.quotes.length - 1] = { ...last, ...(explicit ? flag : { suspected: !last.fictitious }) };
      }
      mark(index, "note", original);
      return;
    }
    // Título em caixa alta / cabeçalho de documento antes de qualquer item.
    if (drafts.length === 0 && (line === line.toUpperCase() || index === 0)) { mark(index, "header", original); return; }
    // Texto livre logo após o título do item, antes de cotações: complemento da especificação.
    const cur = current as Draft | null;
    if (cur && cur.quotes.length === 0 && !pending) {
      if (!cur.description) cur.description = line; else cur.specification.push(line);
      mark(index, "description", original);
      return;
    }
    mark(index, "unrecognized", original);
  });

  // Declaração explícita do DOCUMENTO (nota/cabeçalho/metadado/resumo — não linha de cotação), ex.: "Observação: dados
  // fictícios, exclusivamente para homologação." ⇒ TODAS as cotações do documento são fictícias. Linha NÃO reconhecida
  // não declara nada (só suspeita), e negação ("não foram aceitas cotações fictícias") não é declaração.
  const NON_QUOTE: ReadonlySet<PriceLineKind> = new Set(["header", "metadata", "note", "summary"]);
  // Colagem: a linha já foi classificada estruturalmente como NÃO-cotação ⇒ declaração explícita vale para o conjunto, salvo
  // escopo restrito ("itens 3 e 4…", "algumas…") ⇒ só suspeita (revisão).
  const documentDeclaresFictitious = lines.some((l) => NON_QUOTE.has(l.kind) && declaresFictitious(l.text) && !isPartialDeclarationScope(l.text));
  const documentPartial = lines.some((l) => NON_QUOTE.has(l.kind) && declaresFictitious(l.text) && isPartialDeclarationScope(l.text));
  if (documentDeclaresFictitious) {
    for (const d of drafts) d.quotes = d.quotes.map((q) => ({ ...q, fictitious: true, suspected: false }));
  }
  const synthetic = documentDeclaresFictitious || drafts.some((d) => d.quotes.some((q) => q.fictitious));
  const suspected = !synthetic && (documentPartial || drafts.some((d) => d.quotes.some((q) => q.suspected)) || lines.some((l) => suggestsDemonstrative(l.text)));
  const items: ParsedPriceItem[] = [];
  for (const d of drafts) {
    if (!d.description) {
      blocking.push({ code: "ITEM_WITHOUT_DESCRIPTION", lineIndex: d.startIndex, message: `Linha ${d.startIndex + 1}: item sem descrição — informe "Item N — descrição" ou "Descrição: …".` });
      continue;
    }
    const priced = d.quotes.map((q) => q.valueCents).filter((v): v is number => v !== null);
    const averageCents = halfUpAverage(priced);
    const documental = !d.delimited;
    if (priced.length === 0) {
      (documental ? blocking : warnings).push({ code: "ITEM_WITHOUT_PRICE", lineIndex: d.startIndex, message: `Item "${d.description.slice(0, 80)}": nenhuma cotação com preço identificada.` });
    } else if (priced.length < 3) {
      warnings.push({ code: "FEW_QUOTES", lineIndex: d.startIndex, message: `Item "${d.description.slice(0, 80)}": ${priced.length} cotação(ões) com preço (amostra pequena).` });
    }
    if (documental && d.quantity === null) {
      warnings.push({ code: "QUANTITY_MISSING", lineIndex: d.startIndex, message: `Item "${d.description.slice(0, 80)}": quantidade não informada (fica pendente — nunca presumida).` });
    }
    const fict = d.quotes.filter((q) => q.fictitious).length;
    if (fict > 0) {
      warnings.push({ code: "FICTITIOUS_SOURCE", lineIndex: d.startIndex, message: `Item "${d.description.slice(0, 80)}": ${fict} cotação(ões) de fonte fictícia/sintética — servem só para homologação, não como pesquisa de preços válida.` });
    }
    const susp = d.quotes.filter((q) => q.suspected && !q.fictitious).length;
    if (susp > 0) {
      warnings.push({ code: "SUSPECTED_DEMONSTRATIVE", lineIndex: d.startIndex, message: `Item "${d.description.slice(0, 80)}": ${susp} cotação(ões) com termos como "teste", "exemplo" ou "homologação" — confira se a fonte é real (registradas como declaradas, sem verificação).` });
    }
    items.push({
      description: d.description, specification: d.specification.join(" "), quantity: d.quantity, unit: d.unit || "UN",
      quotes: d.quotes, averageCents, totalCents: averageCents !== null && d.quantity !== null ? Math.round(averageCents * d.quantity) : null,
    });
  }

  // Resumos declarados (média/total) conferidos com o cálculo — divergência é sinalizada, nunca "corrigida".
  for (const s of declared) {
    const target = s.item ? items.find((i) => i.description === s.item!.description) : items.length === 1 ? items[0] : undefined;
    if (!target) continue;
    const expected = /total|global/.test(s.label) ? target.totalCents : /medi|referencia|estimado/.test(s.label) ? target.averageCents : null;
    if (expected !== null && expected !== s.cents) {
      warnings.push({ code: "DECLARED_SUMMARY_MISMATCH", lineIndex: s.index, message: `Linha ${s.index + 1}: valor declarado difere do calculado a partir das cotações; prevalece o cálculo (confira a fonte).` });
    }
  }

  const unrecognized = lines.filter((l) => l.kind === "unrecognized").length;
  if (unrecognized > 0) warnings.push({ code: "UNRECOGNIZED_LINES", message: `${unrecognized} linha(s) não reconhecida(s) foram ignoradas — confira na prévia.` });
  if (items.length === 0 && blocking.length === 0) blocking.push({ code: "EMPTY", message: "Nenhum item com cotação foi identificado no texto." });

  return {
    version: PRICE_RESEARCH_PARSER_VERSION,
    format: raw.length === 0 ? "empty" : documentalSignals > 0 && documentalSignals >= delimitedRows ? "documental" : delimitedRows > 0 ? "delimited" : "documental",
    items, lines, quoteCount: items.reduce((n, i) => n + i.quotes.length, 0), synthetic, suspected, blocking, warnings,
  };
}

/**
 * Guarda do CATMAT/CATSER: sugestão de catálogo só para ITEM REAL — descrição de bem/serviço (não metadado,
 * rótulo, aviso, valor ou fragmento administrativo) e com ao menos uma cotação com preço. Itens legados gerados
 * pelo leitor antigo (uma linha = um item) deixam de receber sugestão de catálogo indevida.
 */
export function isCatalogItemCandidate(p: { description: string; pricedQuotes: number }): boolean {
  const d = (p.description ?? "").trim();
  if (p.pricedQuotes <= 0 || d.length < 3) return false;
  if (/R\$|^\d[\d.,/\s-]*$/.test(d)) return false;
  if (METADATA.test(d) || NOTE.test(d) || SUMMARY.test(d) || QUANTITY.test(d) || UNIT.test(d) || DATE_LINE.test(d)) return false;
  if (QUOTE_HEADER_ONLY.test(d) || /^(?:cota[çc][ãa]o|or[çc]amento|proposta|fornecedor|fonte)\b/i.test(d)) return false;
  return /\p{L}{3,}/u.test(d);
}

/** Prévia (sem gravação) apresentada ao servidor ANTES de importar: itens, cotações, linhas ignoradas e pendências. */
export interface PriceResearchPreview {
  readonly parserVersion: string;
  readonly format: PriceResearchParse["format"];
  readonly synthetic: boolean;
  /** Termos genéricos sugerem dado de teste sem declarar — revisar a fonte (nada é classificado como fictício). */
  readonly suspected: boolean;
  readonly quoteCount: number;
  readonly items: ReadonlyArray<{
    description: string; specification: string; quantity: number | null; unit: string;
    averageCents: number | null; totalCents: number | null;
    quotes: ReadonlyArray<{ line: number; supplier: string; valueCents: number | null; date: string; fictitious: boolean; suspected: boolean; notes: string }>;
  }>;
  /** Linhas que NÃO viraram item nem cotação (cabeçalho, metadado, resumo, aviso, não reconhecida). */
  readonly ignored: ReadonlyArray<{ line: number; kind: PriceLineKind; text: string }>;
  readonly blocking: readonly PriceParseIssue[];
  readonly warnings: readonly PriceParseIssue[];
  readonly canImport: boolean;
}

const STRUCTURAL: ReadonlySet<PriceLineKind> = new Set(["item", "description", "quantity", "unit", "quote", "supplier", "date"]);

export function previewOfParse(p: PriceResearchParse): PriceResearchPreview {
  return {
    parserVersion: p.version, format: p.format, synthetic: p.synthetic, suspected: p.suspected, quoteCount: p.quoteCount,
    items: p.items.map((i) => ({
      description: i.description, specification: i.specification, quantity: i.quantity, unit: i.unit,
      averageCents: i.averageCents, totalCents: i.totalCents,
      quotes: i.quotes.map((q) => ({ line: q.index + 1, supplier: q.supplier, valueCents: q.valueCents, date: q.date, fictitious: q.fictitious, suspected: q.suspected, notes: q.notes })),
    })),
    ignored: p.lines.filter((l) => !STRUCTURAL.has(l.kind)).map((l) => ({ line: l.index + 1, kind: l.kind, text: l.text.slice(0, 200) })),
    blocking: p.blocking, warnings: p.warnings, canImport: p.blocking.length === 0,
  };
}

/** Recusa de importação ambígua: NADA é gravado; a prévia indica o que corrigir. */
export class PriceResearchAmbiguousError extends Error {
  readonly code = "PRICE_RESEARCH_AMBIGUOUS";
  constructor(readonly issues: readonly PriceParseIssue[]) {
    super(`Pesquisa de preços ambígua — nada foi importado. ${issues.slice(0, 5).map((i) => i.message).join(" ")}`.slice(0, 900));
    this.name = "PriceResearchAmbiguousError";
  }
}

/**
 * Reconstrução TABULAR por GEOMETRIA (layout-aware) — camada NEUTRA, compartilhada pelo texto nativo do PDF e
 * pelas palavras do OCR (ambos chegam como `PositionedTextToken`). Converte uma página em uma MATRIZ
 * normalizada (cabeçalho + linhas de item) que segue para o MESMO extrator canônico (`tableToRawItems`).
 *
 * Não conhece documento, órgão, fornecedor, sistema emissor ou coordenada específica: só reconhece padrões
 * ESTRUTURAIS genéricos (alinhamento, proximidade, repetição, densidade e tipo de célula). Nada de LLM; nada é
 * corrigido ou inventado — o texto de cada célula é o texto do documento.
 *
 * Algoritmo (n = tokens da página; c = colunas):
 *   1. LINHAS FÍSICAS: tokens horizontais ordenados pelo centro vertical e agrupados com tolerância RELATIVA
 *      à altura da fonte (não usa `split("\n")` nem a ordem do array do PDF).                 O(n log n)
 *   2. FRAGMENTOS: tokens vizinhos na mesma linha, com espaço ≤ PHRASE_GAP em, formam um fragmento (célula
 *      física); dois VALORES nunca se fundem. Cada fragmento recebe um tipo (dinheiro, número, %, marcador
 *      de ausência "/////", moeda "R$", texto).                                               O(n log n)
 *   3. LINHAS ESTRUTURAIS e REGIÃO TABULAR: linhas com ≥ 2 valores são candidatas; as mais densas (≥ 60% do
 *      máximo de fragmentos) definem a estrutura. Agrupamentos de linhas densas separados por cabeçalho (texto
 *      vertical) ou por mudança de fonte são distintos; a tabela é o maior (empate ⇒ o último). Tudo antes do
 *      bloco da 1ª linha estrutural (caixas de ID/data/valor, título, objeto) é PREÂMBULO.
 *   4. COLUNAS: bandas = união dos intervalos X dos fragmentos das linhas COM VALORES dos blocos da tabela
 *      (inclui linhas empilhadas); linhas só de texto abrem bandas em regiões vazias; banda só de "R$" funde à
 *      direita. Partições = pontos médios entre bandas. Número de colunas de preço NÃO é fixo.   O(n log n)
 *   5. LOGICAL ITEM BLOCK: blocos de linhas físicas por espaço vertical (> BLOCK_GAP em). Bloco com UMA linha
 *      estrutural = UM item com todas as suas linhas (descrição multilinha, unidade acima/quantidade abaixo,
 *      média/total empilhados, preço centralizado). Linha que disputa com a âncora a mesma coluna de valor, ou
 *      traz texto em coluna monetária, não pertence ao item. Dois itens no mesmo bloco só com ≥ 2 linhas
 *      estruturais (limite pelo alinhamento, com aviso). Blocos sem item: resumo (com valor) / órfão / rodapé.
 *   6. CABEÇALHO: acima do corpo, alinhado às partições, incluindo texto VERTICAL em ordem de leitura (linhas da
 *      esquerda para a direita; de baixo para cima quando gira −90°); título/agrupador nunca é rótulo.
 *   7. CÉLULAS EMPILHADAS: coluna cujas células ocupam k ≥ 2 linhas de forma consistente entre itens, com k níveis
 *      no cabeçalho ("/" ou k linhas) ou níveis de tipos diferentes (texto × número) ⇒ k SUBCOLUNAS VIRTUAIS por
 *      ordem vertical. Níveis todos textuais = texto livre quebrado (descrição), nunca empilhado. Pilha de
 *      identificação à esquerda dos valores (anexo/lote/item) é preservada como identificador hierárquico.
 *   8. MATRIZ: células = fragmentos por (sub)coluna (ordem y, x); marcador de ausência vira célula VAZIA (nunca 0)
 *      e é registrado; confiança por célula = mínimo dos tokens (OCR).
 * Complexidade total ≈ O(n log n + r·c) — sem comparação par-a-par entre todos os tokens.
 */
import type { PositionedTextToken } from "./positionedText";
import { isMoneyLike } from "../tabularExtraction";

/** Versão do algoritmo de reconstrução (entra no fingerprint de replay). Mudou o algoritmo ⇒ nova versão. */
/**
 * 2 — reconstrução geométrica (linhas × bandas × blocos).
 * 3 — região tabular por estrutura (preâmbulo fora), LogicalItemBlock (item = bloco de várias linhas físicas) e
 *     células EMPILHADAS em subcolunas virtuais (ex.: unidade/quantidade, média/total, anexo/lote/item).
 */
export const PDF_LAYOUT_VERSION = "3";

// ─── Tolerâncias (relativas ao "em" = tamanho da fonte) ─────────────────────────────
/** |Δ centro vertical| ≤ ROW_TOLERANCE em ⇒ mesma linha física. */
const ROW_TOLERANCE = 0.45;
/** Espaço horizontal ≤ PHRASE_GAP em ⇒ mesmo fragmento (palavras de uma célula). */
const PHRASE_GAP = 0.8;
/** Dois valores só se fundem com espaço de até VALUE_JOIN_GAP em (ex.: "R$" + "1.234,56" no OCR). */
const VALUE_JOIN_GAP = 0.35;
/** Espaço vertical > BLOCK_GAP em entre linhas físicas ⇒ fronteira de célula (novo bloco). */
const BLOCK_GAP = 0.5;
/** Espaço vertical > HEADER_MAX_GAP em ⇒ fim da região de cabeçalho. */
const HEADER_MAX_GAP = 2.5;
const HEADER_MAX_ROWS = 8;
/** Linha estrutural: ≥ CORE_ROW_RATIO do máximo de fragmentos entre as candidatas. */
const CORE_ROW_RATIO = 0.6;
/** Coluna de identificação: preenchida em ≥ IDENTITY_FILL das linhas estruturais. */
const IDENTITY_FILL = 0.6;
/** Banda de moeda: ≥ CURRENCY_BAND das células são "R$"/"$" ⇒ funde com a banda à direita. */
const CURRENCY_BAND = 0.8;
/** Fragmento cobre ≥ PARTITION_COVER da largura de ≥ 2 partições ⇒ atravessa colunas (título/agrupador). */
const PARTITION_COVER = 0.3;
/** Rótulo textual SECUNDÁRIO de linha de resumo (a decisão primária é estrutural). */
const SUMMARY_LABEL_RE = /^(?:VALOR\s+)?(?:SUB)?TOTAL\b|^SOMA\b|^TOTAL\s+GERAL\b|^VALOR\s+GLOBAL\b/i;

// ─── Tipos ─────────────────────────────────────────────────────────────────────────
export interface Box { x0: number; y0: number; x1: number; y1: number }

export type FragmentKind = "money" | "number" | "percent" | "placeholder" | "currency" | "text";
export type ColumnKind = "integer" | "money" | "percent" | "text" | "mixed" | "empty";
export type RowRole = "preamble" | "header" | "item" | "continuation" | "summary" | "orphan" | "footer";

interface Fragment { text: string; box: Box; em: number; confidence: number | null; kind: FragmentKind; seq: number }
interface PhysicalRow { box: Box; em: number; fragments: Fragment[]; text: string }

export interface LayoutRowMeta {
  /** Texto bruto das linhas físicas que compõem a linha lógica (uma por linha). */
  lineText:           string;
  /** Confiança mínima (0–100) por coluna; null = célula vazia ou texto nativo. */
  confidence:         Array<number | null>;
  /** Célula(s) montada(s) a partir de mais de uma linha física (descrição multilinha). */
  mergedContinuation: boolean;
  /** Algum fragmento da linha atravessa colunas (estrutura ambígua). */
  spansColumns:       boolean;
  bbox:               Box;
  physicalRows:       number;
  /**
   * Células descartadas — nunca viram valor: marcador de ausência ("/////", "-", "N/A") ou texto SEM dígito em
   * coluna predominantemente monetária (ex.: marcador ilegível no OCR).
   */
  discarded:          Array<{ column: number; raw: string; reason: "placeholder" | "non_numeric" }>;
  /** Identificador hierárquico empilhado (ex.: "I / 001 / 003" = anexo / lote / item), quando existir. */
  identifier?:        string | null;
}

export interface LayoutSummaryRow { label: string; cells: string[]; bbox: Box }

export interface NormalizedTableMatrix {
  page:              number;
  /** Rótulos por coluna; null ⇒ nenhum cabeçalho reconhecível (o extrator usa ordem posicional). */
  header:            string[] | null;
  /** Coluna sem rótulo legível (ex.: cabeçalho vertical não lido) — rótulo sintético "Coluna N". */
  headerSynthesized: boolean[];
  headerCarriedOver: boolean;
  /** Cabeçalhos que agrupam várias colunas (ex.: "FONTES DE PESQUISA") — informativos, nunca rótulo. */
  columnGroups:      Array<{ label: string; columns: number[] }>;
  columnKinds:       ColumnKind[];
  rows:              string[][];
  rowMeta:           LayoutRowMeta[];
  summaryRows:       LayoutSummaryRow[];
  bbox:              Box;
}

export interface LayoutWarning { code: string; message: string; severity: "info" | "warning" }

export interface PageLayoutResult {
  page:              number;
  layoutVersion:     string;
  tokenCount:        number;
  rowCount:          number;
  columnCount:       number;
  /** Linhas com ≥ 2 valores (candidatas a item). */
  candidateRowCount: number;
  /** Linhas lógicas de item materializadas na matriz. */
  itemRowCount:      number;
  table:             NormalizedTableMatrix | null;
  /** Página sem tabela de itens (identificação, assinatura, rodapé…): nenhum item é gerado dela. */
  pageHasNoItemTable: boolean;
  /**
   * Há linhas com valores, mas as colunas NÃO são alinhadas geometricamente (ex.: texto com espaços em fonte
   * proporcional): dois valores caem na mesma banda. A geometria não decide — o chamador usa as linhas de texto.
   */
  columnsUnresolved: boolean;
  roles:             Record<RowRole, number>;
  warnings:          LayoutWarning[];
}

/** Cabeçalho herdado da página anterior (tabela que continua sem repetir o cabeçalho). */
export interface CarriedHeader { header: string[]; headerSynthesized: boolean[]; columnGroups: NormalizedTableMatrix["columnGroups"] }

// ─── Utilitários ───────────────────────────────────────────────────────────────────
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
const tokenBox = (t: PositionedTextToken): Box => ({ x0: t.x, y0: t.y, x1: t.x + t.width, y1: t.y + t.height });
const cy = (b: Box) => (b.y0 + b.y1) / 2;
const cx = (b: Box) => (b.x0 + b.x1) / 2;
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

const CURRENCY_RE = /^(?:R\$|US\$|\$|€)$/i;
/** Marcadores visuais de ausência/descarte (sem dígito): "/////", "-", "—", "***", "N/A", "S/C". */
const PLACEHOLDER_RE = /^(?:[/\\\-–—_*.]+|N\/?A|S\/?C|N\/?C)$/i;
const TRAILING_CURRENCY_RE = /^(.*?)[\s|/]*(?:R\$|US\$|€)$/i;
const PERCENT_RE = /^[-+]?\d{1,3}(?:\.\d{3})*(?:[.,]\d+)?\s?%$/;
const NUMBER_RE = /^[-+]?\d+(?:[.,]\d+)?$/;

export function classifyFragmentText(text: string): FragmentKind {
  const t = text.trim();
  const compact = t.replace(/\s+/g, "");
  if (CURRENCY_RE.test(compact)) return "currency";
  if (PLACEHOLDER_RE.test(compact)) return "placeholder";
  if (PERCENT_RE.test(t)) return "percent";
  if (/^\d+$/.test(compact)) return "number";
  if (isMoneyLike(t)) return "money";
  if (NUMBER_RE.test(compact)) return "number";
  return "text";
}
export function isPlaceholderText(text: string): boolean {
  return PLACEHOLDER_RE.test(text.replace(/\s+/g, ""));
}
const isValueKind = (k: FragmentKind) => k === "money" || k === "number" || k === "percent" || k === "placeholder";
const isAmountKind = (k: FragmentKind) => k === "money" || k === "number" || k === "percent";

// ─── 1–2. Linhas físicas e fragmentos ────────────────────────────────────────────────
function buildPhysicalRows(tokens: PositionedTextToken[]): PhysicalRow[] {
  const sorted = [...tokens].sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2) || a.x - b.x || a.seq - b.seq);
  const groups: Array<{ yc: number; em: number; tokens: PositionedTextToken[] }> = [];
  for (const t of sorted) {
    const tc = t.y + t.height / 2;
    let target: (typeof groups)[number] | undefined;
    // Ordenado pelo centro: só as últimas linhas podem conter o token (varredura curta, não O(n²)).
    for (let i = groups.length - 1; i >= 0 && i >= groups.length - 3; i--) {
      const g = groups[i];
      if (Math.abs(g.yc - tc) <= ROW_TOLERANCE * Math.min(g.em, t.fontSize)) { target = g; break; }
    }
    if (target) {
      target.tokens.push(t);
      target.yc = target.tokens.reduce((s, x) => s + x.y + x.height / 2, 0) / target.tokens.length;
    } else {
      groups.push({ yc: tc, em: t.fontSize, tokens: [t] });
    }
  }
  return groups.map((g) => {
    const toks = g.tokens.sort((a, b) => a.x - b.x || a.seq - b.seq);
    const fragments: Fragment[] = [];
    let cur: { toks: PositionedTextToken[]; box: Box } | null = null;
    const flush = () => {
      if (!cur) return;
      const text = clean(cur.toks.map((t) => t.text).join(" "));
      const confs = cur.toks.map((t) => t.confidence).filter((c): c is number => c !== null);
      fragments.push({
        text, box: cur.box, em: median(cur.toks.map((t) => t.fontSize)),
        confidence: confs.length ? Math.min(...confs) : null, kind: classifyFragmentText(text), seq: cur.toks[0].seq,
      });
      cur = null;
    };
    for (const t of toks) {
      const b = tokenBox(t);
      if (cur) {
        const gap = b.x0 - cur.box.x1;
        const em = Math.min(t.fontSize, median(cur.toks.map((x) => x.fontSize)));
        const lastKind = classifyFragmentText(cur.toks[cur.toks.length - 1].text);
        const kind = classifyFragmentText(t.text);
        // Símbolo de moeda é PREFIXO: liga-se ao valor seguinte ("R$ 950,31"), nunca ao valor anterior.
        const currencyAfterValue = kind === "currency" && lastKind !== "text";
        const bothValues = isValueKind(lastKind) && isValueKind(kind);
        if (!currencyAfterValue && gap <= (bothValues ? VALUE_JOIN_GAP : PHRASE_GAP) * em) { cur.toks.push(t); cur.box = union(cur.box, b); continue; }
        flush();
      }
      cur = { toks: [t], box: b };
    }
    flush();
    const box = fragments.reduce((acc, f) => union(acc, f.box), fragments[0].box);
    return { box, em: median(g.tokens.map((t) => t.fontSize)), fragments, text: fragments.map((f) => f.text).join("  ") };
  });
}

// ─── 4. Bandas de coluna e partições ─────────────────────────────────────────────────
interface Partitions { bands: Box[]; bounds: number[]; left: number; right: number }

function mergeIntervals(intervals: Array<[number, number]>, eps: number): Array<[number, number]> {
  const s = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + eps) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function colIndex(p: Partitions, x: number): number {
  let lo = 0, hi = p.bounds.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (x > p.bounds[mid]) lo = mid + 1; else hi = mid; }
  return lo;
}
function partitionRange(p: Partitions, c: number): [number, number] {
  return [c === 0 ? p.left : p.bounds[c - 1], c === p.bands.length - 1 ? p.right : p.bounds[c]];
}
/** Quantas partições o fragmento cobre em ≥ PARTITION_COVER da largura (≥ 2 ⇒ atravessa colunas). */
function coveredPartitions(p: Partitions, b: Box): number[] {
  const out: number[] = [];
  const first = colIndex(p, b.x0), last = colIndex(p, b.x1);
  for (let c = first; c <= last; c++) {
    const [l, r] = partitionRange(p, c);
    const w = Math.max(1e-6, r - l);
    if ((Math.min(r, b.x1) - Math.max(l, b.x0)) / w >= PARTITION_COVER) out.push(c);
  }
  return out;
}
const insideTable = (p: Partitions, b: Box) => cx(b) >= p.left && cx(b) <= p.right;

// ─── API ───────────────────────────────────────────────────────────────────────────
function emptyRoles(): Record<RowRole, number> {
  return { preamble: 0, header: 0, item: 0, continuation: 0, summary: 0, orphan: 0, footer: 0 };
}

function noTable(page: number, tokenCount: number, rowCount: number, candidateRowCount: number, rows: number): PageLayoutResult {
  const roles = emptyRoles();
  roles.preamble = rows;
  return {
    page, layoutVersion: PDF_LAYOUT_VERSION, tokenCount, rowCount, columnCount: 0, candidateRowCount, itemRowCount: 0,
    table: null, pageHasNoItemTable: true, columnsUnresolved: false, roles, warnings: [],
  };
}

/** Separa um rótulo empilhado em níveis ("UNIDADE / QTDE." → ["UNIDADE", "QTDE."]). */
function splitLabelLevels(label: string): string[] {
  return label.split("/").map(clean).filter((x) => x !== "");
}

export function reconstructPageTable(tokensIn: readonly PositionedTextToken[], opts: { page?: number; carriedHeader?: CarriedHeader | null } = {}): PageLayoutResult {
  const tokens = tokensIn.filter((t) => t.text.trim() !== "" && t.width > 0 && t.height > 0);
  const page = opts.page ?? tokens[0]?.page ?? 1;
  const horizontal = tokens.filter((t) => t.orientation === "horizontal");
  const vertical = tokens.filter((t) => t.orientation === "vertical");
  const rows = buildPhysicalRows(horizontal);
  const em = median(horizontal.map((t) => t.fontSize)) || 10;

  const valueCount = (r: PhysicalRow) => r.fragments.filter((f) => isValueKind(f.kind)).length;
  const candidates = rows.filter((r) => valueCount(r) >= 2);
  if (candidates.length === 0) return noTable(page, tokens.length, rows.length, 0, rows.length);

  // 3. Linhas estruturais: as mais densas definem as colunas (totais/rodapés/caixas de metadados esparsos não).
  const maxFragments = Math.max(...candidates.map((r) => r.fragments.length));
  let core = candidates.filter((r) => r.fragments.length >= Math.max(3, Math.ceil(CORE_ROW_RATIO * maxFragments)));
  if (core.length === 0) return noTable(page, tokens.length, rows.length, candidates.length, rows.length);
  const rowIdx = new Map(rows.map((r, k) => [r, k]));
  // REGIÃO TABULAR (estrutural): linhas densas separadas por um CABEÇALHO entre elas (texto vertical) ou por
  // mudança de tamanho de fonte pertencem a agrupamentos distintos. A tabela é o agrupamento com mais linhas
  // estruturais (empate ⇒ o último: a tabela vem depois do preâmbulo); os anteriores — ex.: caixa de ID/data/
  // valor total, mesmo densa quando a tabela tem poucos itens — são PREÂMBULO.
  {
    const native = horizontal.every((t) => t.source === "native");
    const sorted = [...core].sort((a, b) => a.box.y0 - b.box.y0);
    const clusters: PhysicalRow[][] = [[sorted[0]]];
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1], b = sorted[i];
      const headerBetween = vertical.some((v) => v.y + v.height / 2 > a.box.y1 && v.y + v.height / 2 < b.box.y0);
      // Tamanho de fonte só é sinal confiável no texto NATIVO (declarado no PDF); no OCR a altura da caixa varia
      // com as letras da palavra (ascendentes/descendentes).
      const fontChange = native && Math.abs(a.em - b.em) / Math.max(1e-6, Math.min(a.em, b.em)) > 0.15;
      if (headerBetween || fontChange) clusters.push([b]); else clusters[clusters.length - 1].push(b);
    }
    const best = clusters.reduce((acc, c, i) => (c.length >= clusters[acc].length ? i : acc), 0);
    core = clusters.slice(best).flat();
  }
  const coreSet = new Set(core.map((r) => rowIdx.get(r)!));

  // 5a. BLOCOS de linhas físicas (espaço vertical > BLOCK_GAP em ⇒ novo bloco). A REGIÃO TABULAR começa no bloco
  //     da primeira linha estrutural (densa): o que vem antes — caixas de ID/data/valor, título, objeto — é
  //     preâmbulo ou cabeçalho, mesmo contendo números, datas ou "R$".
  const blockGap = BLOCK_GAP * em;
  const gapBetween = (a: PhysicalRow, b: PhysicalRow) => b.box.y0 - a.box.y1;
  const blocks: number[][] = [];
  const blockOf: number[] = [];
  rows.forEach((r, k) => {
    if (k > 0 && gapBetween(rows[k - 1], r) <= blockGap) blocks[blocks.length - 1].push(k);
    else blocks.push([k]);
    blockOf[k] = blocks.length - 1;
  });
  const firstBlock = blockOf[Math.min(...coreSet)];
  const tableBlocks = blocks.map((_, i) => i).filter((i) => i >= firstBlock && blocks[i].some((k) => coreSet.has(k)));
  const tableRows = tableBlocks.flatMap((i) => blocks[i]);

  // 4. Bandas por alinhamento repetido: fragmentos das linhas COM VALORES dos blocos da tabela (inclui as linhas
  //    empilhadas — unidade acima, quantidade abaixo); linhas só de texto só abrem bandas em regiões vazias.
  const valueRows = tableRows.filter((k) => valueCount(rows[k]) > 0);
  let bands: Array<Box & { satellite?: boolean }> = mergeIntervals(valueRows.flatMap((k) => rows[k].fragments.map((f): [number, number] => [f.box.x0, f.box.x1])), 0.05 * em)
    .map(([x0, x1]) => ({ x0, x1, y0: 0, y1: 0 }));
  const inBand = (b: Box, f: Fragment) => cx(f.box) >= b.x0 && cx(f.box) <= b.x1;
  {
    const extra = tableRows.filter((k) => valueCount(rows[k]) === 0).flatMap((k) => rows[k].fragments)
      .filter((f) => f.kind === "text" && !bands.some((b) => f.box.x1 >= b.x0 && f.box.x0 <= b.x1))
      .map((f): [number, number] => [f.box.x0, f.box.x1]);
    if (extra.length > 0) {
      bands = [...bands, ...mergeIntervals(extra, 0.05 * em).map(([x0, x1]) => ({ x0, x1, y0: 0, y1: 0, satellite: true }))].sort((a, b) => a.x0 - b.x0);
    }
  }
  const profileRows = valueRows.map((k) => rows[k]);
  // Banda SÓ de marcadores de ausência (ex.: "-" alinhado de outro jeito) funde com a vizinha com a qual nunca
  // divide a mesma linha — é a mesma coluna.
  const cooccurs = (a: Box, b: Box) => profileRows.some((r) => r.fragments.some((f) => inBand(a, f)) && r.fragments.some((f) => inBand(b, f)));
  for (let i = 0; i < bands.length; i++) {
    const cells = profileRows.flatMap((r) => r.fragments.filter((f) => inBand(bands[i], f)));
    if (cells.length === 0 || !cells.every((f) => f.kind === "placeholder")) continue;
    const j = [i + 1, i - 1].find((n) => n >= 0 && n < bands.length && !cooccurs(bands[i], bands[n]));
    if (j === undefined) continue;
    bands[j] = { ...bands[j], x0: Math.min(bands[i].x0, bands[j].x0), x1: Math.max(bands[i].x1, bands[j].x1) };
    bands = bands.filter((_, k) => k !== i);
    i--;
  }
  for (let i = 0; i < bands.length - 1; i++) {
    const cells = profileRows.flatMap((r) => r.fragments.filter((f) => inBand(bands[i], f)));
    if (cells.length > 0 && cells.filter((f) => f.kind === "currency").length / cells.length >= CURRENCY_BAND) {
      bands[i + 1] = { ...bands[i + 1], x0: bands[i].x0 };
      bands = bands.filter((_, k) => k !== i);
      i--;
    }
  }
  if (bands.length < 3) return noTable(page, tokens.length, rows.length, candidates.length, rows.length);
  // Dois VALORES da mesma linha estrutural na mesma banda ⇒ colunas não alinhadas (não é grade geométrica).
  const unresolved = core.some((r) => {
    const seen = new Set<number>();
    for (const f of r.fragments) {
      if (!isAmountKind(f.kind)) continue;
      const b = bands.findIndex((x) => inBand(x, f));
      if (seen.has(b)) return true;
      seen.add(b);
    }
    return false;
  });
  if (unresolved) {
    return {
      ...noTable(page, tokens.length, rows.length, candidates.length, rows.length), pageHasNoItemTable: false, columnsUnresolved: true,
      warnings: [{ code: "LAYOUT_COLUMNS_UNRESOLVED", severity: "info", message: `Página ${page}: colunas não alinhadas geometricamente; extração pelas linhas de texto.` }],
    };
  }
  const gaps = bands.slice(1).map((b, i) => b.x0 - bands[i].x1);
  const pad = Math.max(em, median(gaps) / 2);
  const parts: Partitions = {
    bands, bounds: bands.slice(1).map((b, i) => (bands[i].x1 + b.x0) / 2),
    left: bands[0].x0 - pad, right: bands[bands.length - 1].x1 + pad,
  };
  const C = bands.length;
  const colOf = (f: Fragment) => colIndex(parts, cx(f.box));
  const spans = (f: Fragment) => coveredPartitions(parts, f.box).length >= 2;
  const rowInside = (r: PhysicalRow) => r.fragments.filter((f) => insideTable(parts, f.box)).length >= Math.ceil(r.fragments.length * 0.8);

  // Perfil das colunas por BLOCO da tabela: preenchimento e tipo dominante.
  const fill = Array<number>(C).fill(0);
  const textCount = Array<number>(C).fill(0);
  const valueCnt = Array<number>(C).fill(0);
  const priceLike = Array<number>(C).fill(0);
  for (const b of tableBlocks) {
    const seen = new Set<number>();
    for (const k of blocks[b]) {
      for (const f of rows[k].fragments) {
        const c = colOf(f);
        seen.add(c);
        if (f.kind === "text") textCount[c]++;
        else if (isValueKind(f.kind)) valueCnt[c]++;
        if (f.kind === "money" || f.kind === "percent" || f.kind === "placeholder") priceLike[c]++;
      }
    }
    seen.forEach((c) => { fill[c]++; });
  }
  const nBlocks = Math.max(1, tableBlocks.length);
  // Colunas MONETÁRIAS (preço/percentual/marcador dominam): texto nelas não é continuação de item.
  const moneyCols = new Set([...Array(C).keys()].filter((c) => priceLike[c] > 0 && priceLike[c] / Math.max(1, priceLike[c] + textCount[c]) >= 0.6));
  const firstValueCol = [...Array(C).keys()].find((c) => moneyCols.has(c) && fill[c] / nBlocks >= IDENTITY_FILL) ?? -1;
  const identityCols = [...Array(C).keys()].filter((c) => (firstValueCol < 0 || c < firstValueCol) && fill[c] / nBlocks >= IDENTITY_FILL);
  // Identificação do item = colunas à esquerda dos valores + a 1ª coluna de valores (quantidade, em geral).
  const identitySet = firstValueCol >= 0 ? [...identityCols, firstValueCol] : identityCols;
  const textCols = new Set([...Array(C).keys()].filter((c) => (textCount[c] > 0 && textCount[c] >= valueCnt[c]) || bands[c].satellite));

  const isAnchor = (r: PhysicalRow): boolean => {
    if (valueCount(r) < 2 || !rowInside(r)) return false;
    // Sinal textual SECUNDÁRIO: rótulo de total sem numeração de item ("TOTAL GERAL", "SUBTOTAL", "SOMA").
    const label = r.fragments.filter((f) => f.kind === "text").map((f) => f.text).join(" ");
    if (SUMMARY_LABEL_RE.test(label.trim()) && !r.fragments.some((f) => /^\d{1,4}$/.test(f.text))) return false;
    if (identitySet.length === 0) return true;
    // Estrutural (primário): a linha preenche a MAIORIA das colunas de identificação (total/resumo não preenche).
    const cols = new Set(r.fragments.filter((f) => !spans(f)).map(colOf));
    return identitySet.filter((c) => cols.has(c)).length / identitySet.length > 0.5;
  };
  const hasAmount = (r: PhysicalRow) => r.fragments.some((f) => isAmountKind(f.kind));

  // 5b/6. LOGICAL ITEM BLOCKS: um bloco com UMA linha estrutural é UM item, com todas as suas linhas físicas
  //       (descrição multilinha, unidade acima e quantidade abaixo, média e total empilhados, preço centralizado).
  //       Uma linha só NÃO pertence ao item se disputa com a âncora a mesma coluna de valor, ou traz TEXTO em
  //       coluna monetária (ex.: cabeçalho colado). Dois itens no mesmo bloco só com ≥ 2 linhas estruturais.
  const roleOf: RowRole[] = rows.map(() => "preamble");
  const items: Array<{ anchor: number; members: number[] }> = [];
  let boundaryInferred = false;
  let bodyStart = -1;
  for (let bi = firstBlock; bi < blocks.length; bi++) {
    const blk = blocks[bi];
    let anchors = blk.filter((k) => coreSet.has(k));
    if (anchors.length === 0) anchors = blk.filter((k) => isAnchor(rows[k]));
    if (anchors.length === 0) {
      for (const k of blk) roleOf[k] = rowInside(rows[k]) && hasAmount(rows[k]) ? "summary" : "orphan";
      continue;
    }
    const anchorCols = new Set(anchors.flatMap((a) => rows[a].fragments.filter((f) => isValueKind(f.kind)).map(colOf)));
    const isMember = (k: number) => {
      if (anchors.includes(k)) return true;
      const r = rows[k];
      if (!rowInside(r)) return false;
      return r.fragments.every((f) => {
        if (spans(f)) return false;
        const c = colOf(f);
        if (f.kind === "text" || f.kind === "currency") return !moneyCols.has(c) || identityCols.includes(c);
        return identityCols.includes(c) || !anchorCols.has(c);
      });
    };
    const members = blk.filter(isMember);
    for (const k of blk) {
      if (members.includes(k)) continue;
      // Fora do item: acima da 1ª âncora do 1º bloco ⇒ cabeçalho/preâmbulo; senão resumo (com valor) ou órfã.
      if (bi === firstBlock && k < anchors[0]) roleOf[k] = "preamble";
      else roleOf[k] = rowInside(rows[k]) && hasAmount(rows[k]) ? "summary" : "orphan";
    }
    if (bodyStart < 0) bodyStart = members[0];
    if (anchors.length === 1) {
      items.push({ anchor: anchors[0], members });
    } else {
      // Várias linhas estruturais independentes (mesmas colunas de preço) no mesmo bloco: itens distintos;
      // as demais linhas vão para a âncora pelo alinhamento do próprio bloco (topo/centro/base).
      const others = members.filter((k) => !anchors.includes(k));
      const mode = members[0] === anchors[0] ? "top" : members[members.length - 1] === anchors[anchors.length - 1] ? "bottom" : "center";
      const attach = new Map<number, number[]>(anchors.map((a) => [a, [a]]));
      for (const k of others) {
        let target: number;
        if (mode === "top") target = [...anchors].reverse().find((a) => a < k) ?? anchors[0];
        else if (mode === "bottom") target = anchors.find((a) => a > k) ?? anchors[anchors.length - 1];
        else target = anchors.reduce((best, a) => (Math.abs(cy(rows[a].box) - cy(rows[k].box)) < Math.abs(cy(rows[best].box) - cy(rows[k].box)) ? a : best), anchors[0]);
        attach.get(target)!.push(k);
      }
      if (others.length > 0) boundaryInferred = true;
      for (const a of anchors) items.push({ anchor: a, members: attach.get(a)!.sort((x, y) => x - y) });
    }
    for (const it of items.slice(-anchors.length)) for (const k of it.members) roleOf[k] = k === it.anchor ? "item" : "continuation";
  }
  if (items.length === 0 || bodyStart < 0) return noTable(page, tokens.length, rows.length, candidates.length, rows.length);
  const lastItemRow = Math.max(...items.flatMap((i) => i.members));
  // Texto solto só é "órfão" ENTRE itens; depois do último item é rodapé (ex.: rótulos de linhas de total).
  for (let k = bodyStart; k < rows.length; k++) if (roleOf[k] === "orphan" && k > lastItemRow) roleOf[k] = "footer";

  // Cabeçalho: sobe a partir do corpo enquanto as linhas estiverem alinhadas às partições (texto vertical
  // incluído); para em linha que atravessa colunas (título/agrupador/preâmbulo), com valores, ou após espaço.
  const bodyTop = rows[bodyStart].box.y0;
  const maxGap = HEADER_MAX_GAP * em;
  const verticalIn = vertical.filter((t) => insideTable(parts, tokenBox(t)) && t.y + t.height <= bodyTop + 0.5 * em);
  const usedVertical = new Set<PositionedTextToken>();
  const headerRows: number[] = [];
  const columnGroups: NormalizedTableMatrix["columnGroups"] = [];
  let regionTop = bodyTop;
  for (let k = bodyStart - 1, n = 0; ; k--, n++) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const v of verticalIn) {
        if (usedVertical.has(v) || v.y + v.height < regionTop - maxGap) continue;
        usedVertical.add(v); regionTop = Math.min(regionTop, v.y); changed = true;
      }
    }
    if (k < 0 || n >= HEADER_MAX_ROWS) break;
    const r = rows[k];
    if (r.box.y1 < regionTop - maxGap || !rowInside(r) || r.fragments.some((f) => isAmountKind(f.kind))) break;
    const spanning = r.fragments.filter(spans);
    if (spanning.length > 0) {
      // Título/agrupador: informativo, nunca rótulo de coluna (e encerra a região de cabeçalho).
      for (const f of spanning) columnGroups.push({ label: f.text, columns: coveredPartitions(parts, f.box) });
      roleOf[k] = "header";
      break;
    }
    headerRows.unshift(k);
    roleOf[k] = "header";
    regionTop = Math.min(regionTop, r.box.y0);
  }

  // Rótulos por coluna, em ORDEM DE LEITURA: linhas horizontais de cima para baixo; texto vertical em linhas da
  // esquerda para a direita e, dentro da linha, no sentido da rotação (de baixo para cima quando gira −90°).
  const labelParts: Array<Array<{ key: number; x: number; text: string }>> = Array.from({ length: C }, () => []);
  const headerRowLevels: string[][][] = Array.from({ length: C }, () => []);
  for (const k of headerRows) {
    // Linha de cabeçalho com EXATAMENTE um rótulo por coluna ⇒ atribuição ordinal (rótulo alinhado à esquerda
    // sobre números alinhados à direita não "escorrega" para a coluna anterior).
    const frs = rows[k].fragments;
    const ordinal = frs.length === C;
    const perCol = new Map<number, string[]>();
    frs.forEach((f, i) => {
      const c = ordinal ? i : colOf(f);
      labelParts[c].push({ key: f.box.y0, x: f.box.x0, text: f.text });
      perCol.set(c, [...(perCol.get(c) ?? []), f.text]);
    });
    perCol.forEach((texts, c) => headerRowLevels[c].push(texts));
  }
  const verticalByCol = new Map<number, PositionedTextToken[]>();
  for (const v of usedVertical) {
    const c = colIndex(parts, cx(tokenBox(v)));
    verticalByCol.set(c, [...(verticalByCol.get(c) ?? []), v]);
  }
  verticalByCol.forEach((vs, c) => {
    const top = Math.min(...vs.map((v) => v.y));
    const lines: PositionedTextToken[][] = [];
    for (const v of [...vs].sort((a, b) => cx(tokenBox(a)) - cx(tokenBox(b)))) {
      const line = lines.find((l) => Math.abs(cx(tokenBox(l[0])) - cx(tokenBox(v))) <= 0.5 * v.fontSize);
      if (line) line.push(v); else lines.push([v]);
    }
    let order = 0;
    for (const line of lines) {
      const up = (line[0].direction ?? "up") === "up";
      for (const v of line.sort((a, b) => (up ? b.y - a.y : a.y - b.y))) labelParts[c].push({ key: top, x: order++, text: v.text });
    }
  });
  let header: string[] | null = labelParts.some((p) => p.length > 0)
    ? labelParts.map((p) => clean(p.sort((a, b) => a.key - b.key || a.x - b.x).map((x) => x.text).join(" ")))
    : null;
  let headerSynthesized = header ? header.map((h) => h === "") : Array<boolean>(C).fill(false);
  let headerCarriedOver = false;
  if (!header && opts.carriedHeader && opts.carriedHeader.header.length === C) {
    header = [...opts.carriedHeader.header];
    headerSynthesized = [...opts.carriedHeader.headerSynthesized];
    columnGroups.push(...opts.carriedHeader.columnGroups);
    headerCarriedOver = true;
  }
  if (header) header = header.map((h, c) => h || `Coluna ${c + 1}`);

  // 7a. CÉLULAS EMPILHADAS: coluna cujas células ocupam k ≥ 2 linhas físicas de forma CONSISTENTE entre os itens e
  //     cujo cabeçalho tem k níveis (separador "/" ou k linhas de cabeçalho) — ou cujos níveis têm tipos diferentes
  //     (texto × número) — vira k SUBCOLUNAS VIRTUAIS, na ordem vertical. Descrição de tamanho variável não empilha.
  const fragmentsByItemCol = items.map((it) => {
    const byCol: Array<Array<{ row: number; f: Fragment }>> = Array.from({ length: C }, () => []);
    for (const k of it.members) for (const f of rows[k].fragments) byCol[colOf(f)].push({ row: k, f });
    return byCol;
  });
  const levelsOf = (list: Array<{ row: number; f: Fragment }>) => [...new Set(list.map((x) => x.row))].sort((a, b) => a - b);
  const stackK: number[] = Array<number>(C).fill(1);
  const stackLabels: Array<string[] | null> = Array<string[] | null>(C).fill(null);
  for (let c = 0; c < C; c++) {
    const counts = fragmentsByItemCol.map((bc) => levelsOf(bc[c]).length).filter((n) => n > 0);
    if (counts.length === 0 || counts.length < Math.ceil(items.length * 0.6)) continue;
    const freq = new Map<number, number>();
    counts.forEach((n) => freq.set(n, (freq.get(n) ?? 0) + 1));
    const [k, hits] = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (k < 2 || hits / counts.length < 0.8) continue;
    const label = header?.[c] ?? "";
    const byRow = headerRowLevels[c].map((t) => clean(t.join(" "))).filter((t) => t !== "" && t !== "/");
    const levels = label.includes("/") ? splitLabelLevels(label) : byRow.length === k ? byRow : null;
    const signatures = fragmentsByItemCol.map((bc) => {
      const lv = levelsOf(bc[c]);
      return lv.length === k ? lv.map((row) => (bc[c].filter((x) => x.row === row).some((x) => x.f.kind === "text") ? "t" : "v")).join("") : null;
    }).filter((x): x is string => x !== null);
    const consistent = signatures.length > 0 && signatures.every((sgn) => sgn === signatures[0]);
    const kindsDiffer = consistent && new Set(signatures[0]).size > 1;
    // Todos os níveis TEXTUAIS = texto livre quebrado em linhas (descrição), nunca campos empilhados.
    const allText = signatures.length > 0 && signatures.every((sgn) => /^t+$/.test(sgn));
    if (!allText && ((levels && levels.length === k) || kindsDiffer)) {
      stackK[c] = k;
      stackLabels[c] = levels && levels.length === k ? levels : null;
    }
  }

  // Colunas virtuais: (coluna geométrica, nível). Nível null = coluna simples.
  const vcols: Array<{ c: number; level: number | null }> = [];
  for (let c = 0; c < C; c++) {
    if (stackK[c] > 1) for (let l = 0; l < stackK[c]; l++) vcols.push({ c, level: l });
    else vcols.push({ c, level: null });
  }
  const V = vcols.length;
  const vIndex = (c: number, level: number | null) => vcols.findIndex((v) => v.c === c && v.level === (stackK[c] > 1 ? Math.min(level ?? 0, stackK[c] - 1) : null));
  const stackedCount = stackK.filter((k) => k > 1).length;
  let vHeader: string[] | null = null;
  let vSynth: boolean[] = Array<boolean>(V).fill(false);
  if (header) {
    vHeader = vcols.map(({ c, level }) => (level === null ? header![c] : stackLabels[c]?.[level] ?? `${header![c]} ${level + 1}`));
    vSynth = vcols.map(({ c, level }) => headerSynthesized[c] || (level !== null && !stackLabels[c]));
  }

  // 7b. Matriz: células por coluna virtual (ordem y, x) a partir de TODAS as linhas físicas do item.
  const matrixRows: string[][] = [];
  const rowMeta: LayoutRowMeta[] = [];
  let spanning = false;
  let stackIncomplete = 0;
  items.sort((a, b) => a.members[0] - b.members[0]);
  for (const it of items) {
    const members = it.members;
    const byCol: Array<Array<{ row: number; f: Fragment }>> = Array.from({ length: C }, () => []);
    let rowSpans = false;
    for (const m of members) for (const f of rows[m].fragments) { if (spans(f)) rowSpans = true; byCol[colOf(f)].push({ row: m, f }); }
    const vparts: Array<Array<{ y: number; x: number; f: Fragment }>> = Array.from({ length: V }, () => []);
    for (let c = 0; c < C; c++) {
      if (stackK[c] > 1) {
        const lv = levelsOf(byCol[c]);
        if (lv.length !== stackK[c] && lv.length > 0) stackIncomplete++;
        for (const x of byCol[c]) vparts[vIndex(c, lv.indexOf(x.row))].push({ y: x.f.box.y0, x: x.f.box.x0, f: x.f });
      } else {
        for (const x of byCol[c]) vparts[vIndex(c, null)].push({ y: x.f.box.y0, x: x.f.box.x0, f: x.f });
      }
    }
    const cells = vparts.map((p) => clean(p.sort((a, b) => a.y - b.y || a.x - b.x).map((x) => x.f.text).join(" ")));
    const confidence = vparts.map((p) => {
      const cs = p.map((x) => x.f.confidence).filter((c): c is number => c !== null);
      return cs.length ? Math.min(...cs) : null;
    });
    const discarded: LayoutRowMeta["discarded"] = [];
    cells.forEach((v, c) => { if (v && isPlaceholderText(v)) { discarded.push({ column: c, raw: v, reason: "placeholder" }); cells[c] = ""; } });
    // Identificador hierárquico empilhado (ex.: anexo / lote / item) à esquerda dos valores: preservado inteiro.
    const idStack = identityCols.find((c) => stackK[c] > 1 && !moneyCols.has(c));
    const identifier = idStack === undefined ? null : vcols.map((v, i) => (v.c === idStack ? cells[i] : null)).filter((x): x is string => !!x).join(" / ") || null;
    if (rowSpans) spanning = true;
    matrixRows.push(cells);
    rowMeta.push({
      lineText: members.map((m) => rows[m].text).join("\n"),
      confidence, mergedContinuation: members.length > 1, spansColumns: rowSpans,
      bbox: members.map((m) => rows[m].box).reduce(union), physicalRows: members.length, discarded, identifier,
    });
  }

  const summaryRows: LayoutSummaryRow[] = [];
  for (let k = bodyStart; k < rows.length; k++) {
    if (roleOf[k] !== "summary") continue;
    const cells = Array<string>(V).fill("");
    const label: string[] = [];
    for (const f of rows[k].fragments) {
      if (f.kind === "text") label.push(f.text);
      else if (isAmountKind(f.kind)) {
        const c = colOf(f);
        const v = vIndex(c, stackK[c] > 1 ? stackK[c] - 1 : null); // total empilhado: último nível
        cells[v] = cells[v] ? `${cells[v]} ${f.text}` : f.text;
      }
    }
    summaryRows.push({ label: clean(label.join(" ")), cells, bbox: rows[k].box });
  }

  // Coluna predominantemente MONETÁRIA: célula sem nenhum dígito não é preço (marcador ilegível, ruído) —
  // descartada e registrada (nunca vira 0); célula com dígito é preservada bruta (o contrato monetário decide).
  // Símbolo de moeda é PREFIXO: um "R$" no FIM de célula de valor veio da coluna seguinte (fusão de palavras
  // no OCR, ex.: "953,00 R$" / "1.140,00/R$") — é removido; o número é preservado como está.
  const vText = (v: number) => textCols.has(vcols[v].c) && vcols[v].level === null;
  for (let v = 0; v < V; v++) {
    if (vText(v)) continue;
    for (const r of matrixRows) {
      const m = TRAILING_CURRENCY_RE.exec(r[v]);
      if (m && /\d/.test(m[1])) r[v] = m[1].trim();
    }
  }
  for (let v = 0; v < V; v++) {
    const values = matrixRows.map((r) => r[v]).filter((x) => x !== "");
    const money = values.filter((x) => { const k = classifyFragmentText(x); return k === "money" || k === "number"; }).length;
    if (vText(v) || values.length === 0 || money / values.length < 0.6) continue;
    matrixRows.forEach((r, k) => {
      if (r[v] !== "" && !/\d/.test(r[v])) { rowMeta[k].discarded.push({ column: v, raw: r[v], reason: "non_numeric" }); r[v] = ""; }
    });
  }

  const columnKinds: ColumnKind[] = [...Array(V).keys()].map((c) => {
    const values = matrixRows.map((r) => r[c]).filter((v) => v !== "");
    if (values.length === 0) return "empty";
    const kinds = values.map(classifyFragmentText);
    const share = (pred: (k: FragmentKind) => boolean) => kinds.filter(pred).length / kinds.length;
    if (values.every((v) => /^\d{1,4}$/.test(v))) return "integer";
    if (share((k) => k === "percent") >= 0.8) return "percent";
    if (share((k) => k === "money" || k === "number") >= 0.8) return "money";
    if (share((k) => k === "text") >= 0.8) return "text";
    return "mixed";
  });

  const roles = emptyRoles();
  roleOf.forEach((r) => { roles[r]++; });
  const warnings: LayoutWarning[] = [];
  const orphans = roleOf.filter((r) => r === "orphan").length;
  if (orphans > 0) warnings.push({ code: "LAYOUT_ORPHAN_TEXT", severity: "warning", message: `Página ${page}: ${orphans} linha(s) de texto dentro da tabela sem item associado — não foram anexadas a nenhum item; confira no documento.` });
  if (boundaryInferred) warnings.push({ code: "LAYOUT_ROW_BOUNDARY_INFERRED", severity: "warning", message: `Página ${page}: limites entre itens inferidos pelo alinhamento (tabela sem espaçamento entre linhas) — confira as descrições.` });
  if (spanning) warnings.push({ code: "MERGED_CELL", severity: "warning", message: `Página ${page}: há texto que ocupa mais de uma coluna em linhas de item — confira a atribuição das colunas.` });
  if (!header) warnings.push({ code: "HEADER_INFERENCE", severity: "warning", message: `Página ${page}: cabeçalho da tabela não identificado; colunas por ordem posicional.` });
  if (headerCarriedOver) warnings.push({ code: "LAYOUT_HEADER_CARRIED_OVER", severity: "info", message: `Página ${page}: tabela continua da página anterior; cabeçalho herdado.` });
  if (stackedCount > 0) warnings.push({ code: "LAYOUT_STACKED_CELLS", severity: "info", message: `Página ${page}: ${stackedCount} coluna(s) com campos empilhados separada(s) em subcolunas pela posição vertical.` });
  if (stackIncomplete > 0) warnings.push({ code: "LAYOUT_STACKED_CELL_INCOMPLETE", severity: "warning", message: `Página ${page}: ${stackIncomplete} célula(s) empilhada(s) com níveis faltando — confira unidade/quantidade e média/total.` });
  const discardedTotal = rowMeta.reduce((a, m) => a + m.discarded.filter((d) => d.reason === "placeholder").length, 0);
  const unreadable = rowMeta.reduce((a, m) => a + m.discarded.filter((d) => d.reason === "non_numeric").length, 0);
  if (discardedTotal > 0) warnings.push({ code: "LAYOUT_PLACEHOLDER_DISCARDED", severity: "info", message: `Página ${page}: ${discardedTotal} célula(s) com marcador de ausência (ex.: "/////") desconsiderada(s) — não são preço.` });
  if (unreadable > 0) warnings.push({ code: "LAYOUT_NON_NUMERIC_VALUE_DISCARDED", severity: "warning", message: `Página ${page}: ${unreadable} célula(s) sem número em coluna de valores desconsiderada(s) — confira no documento original.` });
  if (usedVertical.size > 0) warnings.push({ code: "LAYOUT_VERTICAL_HEADERS", severity: "info", message: `Página ${page}: ${usedVertical.size} rótulo(s) de coluna em texto vertical reconhecido(s) pela geometria.` });

  const bodyRows = [...Array(rows.length).keys()].filter((k) => roleOf[k] === "item" || roleOf[k] === "summary" || roleOf[k] === "continuation");
  const tableBox = [...bodyRows, ...headerRows].map((k) => rows[k].box).reduce(union, rows[bodyStart].box);
  const vGroups = columnGroups.map((g) => ({ label: g.label, columns: g.columns.map((c) => vIndex(c, stackK[c] > 1 ? 0 : null)).filter((v) => v >= 0) }));

  return {
    page, layoutVersion: PDF_LAYOUT_VERSION, tokenCount: tokens.length, rowCount: rows.length, columnCount: V,
    candidateRowCount: candidates.length, itemRowCount: matrixRows.length,
    table: matrixRows.length === 0 ? null : {
      page, header: vHeader, headerSynthesized: vSynth, headerCarriedOver, columnGroups: vGroups, columnKinds,
      rows: matrixRows, rowMeta, summaryRows, bbox: tableBox,
    },
    pageHasNoItemTable: matrixRows.length === 0, columnsUnresolved: false, roles, warnings,
  };
}

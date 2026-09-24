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
 *   3. LINHAS-ÂNCORA: linhas com ≥ 2 valores são candidatas; as de maior densidade (≥ 60% do máximo de
 *      fragmentos) definem a ESTRUTURA — linhas de total/rodapé, mais esparsas, não distorcem as colunas.
 *   4. COLUNAS: bandas = união dos intervalos X dos fragmentos das linhas estruturais (clusters de alinhamento
 *      repetido); banda só de símbolo de moeda funde com a vizinha à direita ("R$ | 950,31"). Partições =
 *      pontos médios entre bandas. Número de colunas de preço NÃO é fixo.                     O(n log n)
 *   5. PAPÉIS DE LINHA (estruturais, não por lista de palavras): item (âncora com colunas de identificação
 *      preenchidas), resumo/total (tem valor, mas não tem identificação), continuação (só texto em colunas
 *      textuais), cabeçalho (acima do corpo, alinhado às partições, incluindo texto VERTICAL), título/preâmbulo
 *      (texto que atravessa colunas), rodapé (após a última linha do corpo).
 *   6. CÉLULAS MULTILINHA: linhas do corpo agrupadas em BLOCOS por espaço vertical (> BLOCK_GAP em ⇒ nova
 *      célula); continuações anexadas à âncora do bloco (topo/centro/base detectados pelo próprio bloco).
 *   7. MATRIZ: células = fragmentos por partição (ordem y, x); marcador de ausência vira célula VAZIA (nunca 0)
 *      e é registrado; confiança por célula = mínimo dos tokens (OCR).
 * Complexidade total ≈ O(n log n + r·c) — sem comparação par-a-par entre todos os tokens.
 */
import type { PositionedTextToken } from "./positionedText";
import { isMoneyLike } from "../tabularExtraction";

/** Versão do algoritmo de reconstrução (entra no fingerprint de replay). Mudou o algoritmo ⇒ nova versão. */
export const PDF_LAYOUT_VERSION = "2";

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
/** Fragmento cobre ≥ PARTITION_COVER da largura de ≥ 2 partições ⇒ atravessa colunas. */
const PARTITION_COVER = 0.5;

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

  // 3. Linhas estruturais: as mais densas definem as colunas (totais/rodapés esparsos não distorcem).
  const maxFragments = Math.max(...candidates.map((r) => r.fragments.length));
  const core = candidates.filter((r) => r.fragments.length >= Math.max(3, Math.ceil(CORE_ROW_RATIO * maxFragments)));
  if (core.length === 0) return noTable(page, tokens.length, rows.length, candidates.length, rows.length);

  // 4. Bandas por alinhamento repetido; banda de símbolo de moeda funde com a vizinha à direita.
  let bands = mergeIntervals(core.flatMap((r) => r.fragments.map((f): [number, number] => [f.box.x0, f.box.x1])), 0.05 * em)
    .map(([x0, x1]) => ({ x0, x1, y0: 0, y1: 0 }));
  const inBand = (b: Box, f: Fragment) => cx(f.box) >= b.x0 && cx(f.box) <= b.x1;
  for (let i = 0; i < bands.length - 1; i++) {
    const cells = core.flatMap((r) => r.fragments.filter((f) => inBand(bands[i], f)));
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

  // Perfil das colunas nas linhas estruturais: preenchimento e tipo dominante.
  const fill = Array<number>(C).fill(0);
  const textCount = Array<number>(C).fill(0);
  const valueCnt = Array<number>(C).fill(0);
  const intOnly = Array<boolean>(C).fill(true);
  for (const r of core) {
    const seen = new Set<number>();
    for (const f of r.fragments) {
      const c = colOf(f);
      if (!seen.has(c)) { seen.add(c); fill[c]++; }
      if (f.kind === "text") textCount[c]++; else if (isValueKind(f.kind)) valueCnt[c]++;
      if (!/^\d{1,4}$/.test(f.text)) intOnly[c] = false;
    }
  }
  // Coluna só de inteiros curtos (numeração 1, 2, 3…) é IDENTIFICAÇÃO, não valor.
  const firstValueCol = valueCnt.findIndex((v, c) => v > 0 && !intOnly[c] && v >= textCount[c] && fill[c] / core.length >= IDENTITY_FILL && valueCnt[c] / Math.max(1, fill[c]) >= 0.6);
  const identityCols = [...Array(C).keys()].filter((c) => (firstValueCol < 0 || c < firstValueCol) && fill[c] / core.length >= IDENTITY_FILL);
  const textCols = new Set([...Array(C).keys()].filter((c) => textCount[c] > 0 && textCount[c] >= valueCnt[c]));

  const spans = (f: Fragment) => coveredPartitions(parts, f.box).length >= 2;
  const rowInside = (r: PhysicalRow) => r.fragments.filter((f) => insideTable(parts, f.box)).length >= Math.ceil(r.fragments.length * 0.8);
  const isAnchor = (r: PhysicalRow): boolean => {
    if (valueCount(r) < 2 || !rowInside(r)) return false;
    if (identityCols.length === 0) return true;
    const cols = new Set(r.fragments.filter((f) => !spans(f)).map(colOf));
    return identityCols.filter((c) => cols.has(c)).length / identityCols.length >= 0.5;
  };
  const isSummary = (r: PhysicalRow) => rowInside(r) && r.fragments.some((f) => isAmountKind(f.kind));
  // Continuação: só fragmentos em colunas TEXTUAIS (ex.: "200 LITROS" na descrição), sem atravessar colunas.
  const isContinuation = (r: PhysicalRow) =>
    rowInside(r) && r.fragments.every((f) => f.kind !== "placeholder" && !spans(f) && textCols.has(colOf(f)));

  const roleOf: RowRole[] = rows.map(() => "preamble");
  const firstAnchor = rows.findIndex(isAnchor);
  if (firstAnchor < 0) return noTable(page, tokens.length, rows.length, candidates.length, rows.length);
  const gapBetween = (a: PhysicalRow, b: PhysicalRow) => b.box.y0 - a.box.y1;
  const blockGap = BLOCK_GAP * em;

  // Continuações ACIMA da primeira âncora (célula centralizada/alinhada à base): mesma célula, não cabeçalho.
  let bodyStart = firstAnchor;
  while (bodyStart > 0 && isContinuation(rows[bodyStart - 1]) && gapBetween(rows[bodyStart - 1], rows[bodyStart]) <= blockGap) bodyStart--;

  // 5. Corpo: papéis estruturais linha a linha.
  let lastBody = -1;
  for (let i = bodyStart; i < rows.length; i++) {
    const r = rows[i];
    if (isAnchor(r)) { roleOf[i] = "item"; lastBody = i; }
    else if (isContinuation(r)) roleOf[i] = "continuation";
    else if (isSummary(r)) { roleOf[i] = "summary"; lastBody = i; }
    else roleOf[i] = "orphan";
  }

  // 6. Blocos (células multilinha) — espaço vertical > BLOCK_GAP em, ou linha de resumo/órfã, separa blocos.
  const attach = new Map<number, number[]>(); // âncora → continuações
  let boundaryInferred = false;
  let i = bodyStart;
  while (i < rows.length) {
    if (roleOf[i] !== "item" && roleOf[i] !== "continuation") { i++; continue; }
    const block: number[] = [i];
    let j = i + 1;
    while (j < rows.length && (roleOf[j] === "item" || roleOf[j] === "continuation") && gapBetween(rows[j - 1], rows[j]) <= blockGap) block.push(j++);
    const anchors = block.filter((k) => roleOf[k] === "item");
    const conts = block.filter((k) => roleOf[k] === "continuation");
    if (anchors.length === 0) {
      // Texto solto sem âncora: nunca vira item nem é colado em descrição alheia.
      for (const k of conts) roleOf[k] = k > lastBody ? "footer" : "orphan";
    } else if (anchors.length === 1) {
      attach.set(anchors[0], conts);
    } else {
      // Várias âncoras no mesmo bloco (tabela densa): alinhamento inferido pelo próprio bloco.
      const mode = block[0] === anchors[0] ? "top" : block[block.length - 1] === anchors[anchors.length - 1] ? "bottom" : "center";
      for (const a of anchors) attach.set(a, []);
      for (const k of conts) {
        let target: number;
        if (mode === "top") target = [...anchors].reverse().find((a) => a < k) ?? anchors[0];
        else if (mode === "bottom") target = anchors.find((a) => a > k) ?? anchors[anchors.length - 1];
        else target = anchors.reduce((best, a) => (Math.abs(cy(rows[a].box) - cy(rows[k].box)) < Math.abs(cy(rows[best].box) - cy(rows[k].box)) ? a : best), anchors[0]);
        attach.get(target)!.push(k);
      }
      if (conts.length > 0) boundaryInferred = true;
    }
    i = j;
  }
  const attached = new Set([...attach.values()].flat());
  const lastBodyExt = Math.max(lastBody, ...attached);
  for (let k = bodyStart; k < rows.length; k++) {
    if (roleOf[k] === "continuation" && !attached.has(k)) roleOf[k] = k > lastBodyExt ? "footer" : "orphan";
    else if (roleOf[k] === "orphan" && k > lastBodyExt) roleOf[k] = "footer";
  }

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

  const labelParts: Array<Array<{ key: number; x: number; text: string }>> = Array.from({ length: C }, () => []);
  for (const k of headerRows) for (const f of rows[k].fragments) labelParts[colOf(f)].push({ key: f.box.y0, x: f.box.x0, text: f.text });
  const verticalTop = new Map<number, number>();
  for (const v of usedVertical) {
    const c = colIndex(parts, cx(tokenBox(v)));
    verticalTop.set(c, Math.min(verticalTop.get(c) ?? Infinity, v.y));
  }
  for (const v of usedVertical) {
    const c = colIndex(parts, cx(tokenBox(v)));
    labelParts[c].push({ key: verticalTop.get(c)!, x: v.x, text: v.text });
  }
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

  // 7. Matriz: células por partição (ordem y, x) a partir da âncora + continuações anexadas.
  const matrixRows: string[][] = [];
  const rowMeta: LayoutRowMeta[] = [];
  let spanning = false;
  for (let k = bodyStart; k < rows.length; k++) {
    if (roleOf[k] !== "item") continue;
    const members = [k, ...(attach.get(k) ?? [])].sort((a, b) => a - b);
    const parts2: Array<Array<{ y: number; x: number; f: Fragment }>> = Array.from({ length: C }, () => []);
    let rowSpans = false;
    for (const m of members) {
      for (const f of rows[m].fragments) {
        if (spans(f)) rowSpans = true;
        parts2[colOf(f)].push({ y: f.box.y0, x: f.box.x0, f });
      }
    }
    const cells = parts2.map((p) => clean(p.sort((a, b) => a.y - b.y || a.x - b.x).map((x) => x.f.text).join(" ")));
    const confidence = parts2.map((p) => {
      const cs = p.map((x) => x.f.confidence).filter((c): c is number => c !== null);
      return cs.length ? Math.min(...cs) : null;
    });
    const discarded: LayoutRowMeta["discarded"] = [];
    cells.forEach((v, c) => { if (v && isPlaceholderText(v)) { discarded.push({ column: c, raw: v, reason: "placeholder" }); cells[c] = ""; } });
    if (rowSpans) spanning = true;
    matrixRows.push(cells);
    rowMeta.push({
      lineText: members.map((m) => rows[m].text).join("\n"),
      confidence, mergedContinuation: members.length > 1, spansColumns: rowSpans,
      bbox: members.map((m) => rows[m].box).reduce(union), physicalRows: members.length, discarded,
    });
  }

  const summaryRows: LayoutSummaryRow[] = [];
  for (let k = bodyStart; k < rows.length; k++) {
    if (roleOf[k] !== "summary") continue;
    const cells = Array<string>(C).fill("");
    const label: string[] = [];
    for (const f of rows[k].fragments) {
      if (f.kind === "text") label.push(f.text);
      else if (isAmountKind(f.kind)) { const c = colOf(f); cells[c] = cells[c] ? `${cells[c]} ${f.text}` : f.text; }
    }
    summaryRows.push({ label: clean(label.join(" ")), cells, bbox: rows[k].box });
  }

  // Coluna predominantemente MONETÁRIA: célula sem nenhum dígito não é preço (marcador ilegível, ruído) —
  // descartada e registrada (nunca vira 0); célula com dígito é preservada bruta (o contrato monetário decide).
  // Símbolo de moeda é PREFIXO: um "R$" no FIM de célula de valor veio da coluna seguinte (fusão de palavras
  // no OCR, ex.: "953,00 R$" / "1.140,00/R$") — é removido; o número é preservado como está.
  for (let c = 0; c < C; c++) {
    if (textCols.has(c)) continue;
    for (const r of matrixRows) {
      const m = TRAILING_CURRENCY_RE.exec(r[c]);
      if (m && /\d/.test(m[1])) r[c] = m[1].trim();
    }
  }
  for (let c = 0; c < C; c++) {
    const values = matrixRows.map((r) => r[c]).filter((v) => v !== "");
    const money = values.filter((v) => { const k = classifyFragmentText(v); return k === "money" || k === "number"; }).length;
    if (textCols.has(c) || values.length === 0 || money / values.length < 0.6) continue;
    matrixRows.forEach((r, k) => {
      if (r[c] !== "" && !/\d/.test(r[c])) { rowMeta[k].discarded.push({ column: c, raw: r[c], reason: "non_numeric" }); r[c] = ""; }
    });
  }

  const columnKinds: ColumnKind[] = [...Array(C).keys()].map((c) => {
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
  const discardedTotal = rowMeta.reduce((a, m) => a + m.discarded.filter((d) => d.reason === "placeholder").length, 0);
  const unreadable = rowMeta.reduce((a, m) => a + m.discarded.filter((d) => d.reason === "non_numeric").length, 0);
  if (discardedTotal > 0) warnings.push({ code: "LAYOUT_PLACEHOLDER_DISCARDED", severity: "info", message: `Página ${page}: ${discardedTotal} célula(s) com marcador de ausência (ex.: "/////") desconsiderada(s) — não são preço.` });
  if (unreadable > 0) warnings.push({ code: "LAYOUT_NON_NUMERIC_VALUE_DISCARDED", severity: "warning", message: `Página ${page}: ${unreadable} célula(s) sem número em coluna de valores desconsiderada(s) — confira no documento original.` });
  if (usedVertical.size > 0) warnings.push({ code: "LAYOUT_VERTICAL_HEADERS", severity: "info", message: `Página ${page}: ${usedVertical.size} rótulo(s) de coluna em texto vertical reconhecido(s) pela geometria.` });

  const bodyRows = [...Array(rows.length).keys()].filter((k) => roleOf[k] === "item" || roleOf[k] === "summary" || roleOf[k] === "continuation");
  const tableBox = [...bodyRows, ...headerRows].map((k) => rows[k].box).reduce(union, rows[firstAnchor].box);

  return {
    page, layoutVersion: PDF_LAYOUT_VERSION, tokenCount: tokens.length, rowCount: rows.length, columnCount: C,
    candidateRowCount: candidates.length, itemRowCount: matrixRows.length,
    table: matrixRows.length === 0 ? null : {
      page, header, headerSynthesized, headerCarriedOver, columnGroups, columnKinds,
      rows: matrixRows, rowMeta, summaryRows, bbox: tableBox,
    },
    pageHasNoItemTable: matrixRows.length === 0, columnsUnresolved: false, roles, warnings,
  };
}

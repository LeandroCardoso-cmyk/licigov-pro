/**
 * Representação NEUTRA de texto posicionado — ponto de convergência entre o texto NATIVO do PDF (pdfjs
 * `getTextContent`) e as palavras do OCR (caixa delimitadora). A partir daqui, a reconstrução tabular
 * (`tableLayoutReconstructor.ts`) é UMA só, independente da origem do texto.
 *
 *   PDF digital  → text items (transform/width/height) → PositionedTextToken(source: "native")
 *   PDF digitalizado → OCR words (bbox + confiança)     → PositionedTextToken(source: "ocr")
 *
 * Coordenadas: espaço da página com origem no canto SUPERIOR esquerdo e y crescendo para baixo (o mesmo do
 * viewport do pdfjs e das caixas do OCR). A geometria é preservada desde o primeiro estágio: nada é
 * linearizado aqui. Puro (sem I/O).
 */
import type { OcrPageResult } from "../../domain/ocr";

export type PositionedTextSource = "native" | "ocr";
export type TextOrientation = "horizontal" | "vertical";

export interface PositionedTextToken {
  text:        string;
  /** Canto superior esquerdo (unidades da página). */
  x:           number;
  y:           number;
  width:       number;
  height:      number;
  page:        number;
  /** Tamanho da fonte (altura do "em") — base das tolerâncias relativas. */
  fontSize:    number;
  orientation: TextOrientation;
  /** 0–100 (OCR); null no texto nativo. */
  confidence:  number | null;
  source:      PositionedTextSource;
  /** Ordem original na página (desempate determinístico). */
  seq:         number;
  /** Texto vertical: "up" lê de baixo para cima (rotação −90°), "down" de cima para baixo. */
  direction?:  "up" | "down";
}

/** Subconjunto do item de texto do pdfjs usado aqui (TextItem de `getTextContent`). */
export interface PdfTextItemLike {
  str:        string;
  transform:  number[];
  width:      number;
  height:     number;
}

/** Transforma um ponto do espaço do PDF para o espaço do viewport (y para baixo). */
export type ViewportPointFn = (x: number, y: number) => [number, number];

/** Frações da altura da fonte acima/abaixo da linha de base (ascendente/descendente típicos). */
const ASCENT = 0.8;
const DESCENT = 0.2;

/**
 * Converte os itens de texto do pdfjs em tokens posicionados. A caixa é calculada a partir da MATRIZ de
 * transformação (suporta texto rotacionado — cabeçalhos verticais — e páginas com /Rotate, pois cada canto
 * passa pelo viewport). Itens só com espaço são descartados (não carregam geometria útil).
 */
export function tokensFromPdfTextItems(items: readonly PdfTextItemLike[], page: number, toViewport: ViewportPointFn): PositionedTextToken[] {
  const out: PositionedTextToken[] = [];
  items.forEach((it, seq) => {
    const text = (it.str ?? "").replace(/\s+/g, " ").trim();
    if (!text || !Array.isArray(it.transform) || it.transform.length < 6) return;
    const [a, b, c, d, e, f] = it.transform;
    const baseLen = Math.hypot(a, b);
    const upLen = Math.hypot(c, d);
    if (baseLen === 0 || upLen === 0) return;
    const ux = a / baseLen, uy = b / baseLen;       // direção da linha de base
    const vx = c / upLen, vy = d / upLen;           // direção "para cima" do glifo
    const fontSize = it.height > 0 ? it.height : upLen;
    const width = it.width > 0 ? it.width : fontSize * 0.5 * text.length;
    const corners: Array<[number, number]> = [];
    for (const along of [0, width]) {
      for (const up of [-DESCENT * fontSize, ASCENT * fontSize]) {
        corners.push(toViewport(e + ux * along + vx * up, f + uy * along + vy * up));
      }
    }
    const xs = corners.map((p) => p[0]);
    const ys = corners.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    // Orientação no espaço do viewport (independe da rotação da página).
    const [bx0, by0] = toViewport(e, f);
    const [bx1, by1] = toViewport(e + ux, f + uy);
    const orientation: TextOrientation = Math.abs(bx1 - bx0) >= Math.abs(by1 - by0) ? "horizontal" : "vertical";
    out.push({
      text, x: x0, y: y0, width: x1 - x0, height: y1 - y0, page, fontSize, orientation,
      confidence: null, source: "native", seq,
      ...(orientation === "vertical" ? { direction: by1 < by0 ? "up" as const : "down" as const } : {}),
    });
  });
  return out;
}

/**
 * Traços de régua/borda de tabela lidos pelo OCR como caractere nas PONTAS de uma palavra ("|[15W40,", "953,00|").
 * Não carregam conteúdo em tabela de preços; o texto bruto integral continua no artefato do OCR.
 */
const OCR_RULE_EDGES = /^[|[\]{}]+|[|[\]{}]+$/g;

/** Converte as palavras do OCR (caixa + confiança) em tokens posicionados — mesma representação do nativo. */
export function tokensFromOcrPage(page: OcrPageResult): PositionedTextToken[] {
  const out: PositionedTextToken[] = [];
  let seq = 0;
  for (const line of page.lines) {
    for (const w of line.words) {
      const text = (w.text ?? "").replace(/\s+/g, " ").trim().replace(OCR_RULE_EDGES, "").trim();
      if (!text) continue;
      const width = Math.max(1, w.bbox.x1 - w.bbox.x0);
      const height = Math.max(1, w.bbox.y1 - w.bbox.y0);
      // Palavra lida em texto ROTACIONADO (cabeçalho vertical): caixa alta e estreita com várias letras.
      const vertical = [...text].length >= 3 && height > 1.8 * width;
      out.push({
        text, x: w.bbox.x0, y: w.bbox.y0, width, height, page: page.pageNumber, fontSize: vertical ? width : height,
        orientation: vertical ? "vertical" : "horizontal", confidence: w.confidence, source: "ocr", seq: seq++,
        // O OCR não informa o sentido da rotação: cabeçalhos verticais de tabela costumam ler de baixo para cima.
        ...(vertical ? { direction: "up" as const } : {}),
      });
    }
  }
  return out;
}

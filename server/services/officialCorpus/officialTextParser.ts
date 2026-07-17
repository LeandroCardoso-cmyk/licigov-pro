/**
 * RC-4.9 — Official Knowledge Corpus · Parser de texto oficial (determinístico).
 *
 * Lê o TEXTO OFICIAL (arquivos em `data/`, extraídos de fontes oficiais — planalto.gov.br, in.gov.br,
 * TCE-PR, TCU) e o converte em uma estrutura hierárquica VERBATIM: sem resumos, sem interpretações,
 * sem IA. Puro/determinístico: mesma entrada → mesma saída. Nenhum conteúdo é gerado.
 */

export type SegmentType =
  | "titulo" | "capitulo" | "secao" | "subsecao" | "artigo" | "paragrafo" | "inciso" | "alinea" | "item" | "other";

export interface ParsedSegment {
  readonly type: SegmentType;
  readonly identifier: string;
  readonly text: string;
}

export interface ParsedParagraph { readonly identifier: string; readonly text: string; }
export interface ParsedArticle {
  readonly identifier: string;
  readonly number: string;
  /** Caminho estrutural (títulos/capítulos que contêm o artigo). */
  readonly path: readonly string[];
  /** Texto VERBATIM completo do artigo (caput + parágrafos + incisos + alíneas). */
  readonly fullText: string;
  readonly paragraphs: readonly ParsedParagraph[];
}

export interface ParsedNorm {
  readonly title: string;
  readonly url: string;
  readonly segments: readonly ParsedSegment[];
  readonly articles: readonly ParsedArticle[];
}

const RE_TITULO = /^T[ÍI]TULO\s+([IVXLC]+|[ÚU]NICO)\b/i;
const RE_CAPITULO = /^CAP[ÍI]TULO\s+([IVXLC]+|[ÚU]NICO)\b/i;
const RE_SECAO = /^Se[çc][ãa]o\s+([IVXLC]+|[úu]nica)\b/i;
const RE_SUBSECAO = /^Subse[çc][ãa]o\s+([IVXLC]+|[úu]nica)\b/i;
const RE_ARTIGO = /^Art\.\s*(\d+)(?:º|o|\.)?(-[A-Z])?/;
const RE_PARAGRAFO = /^§\s*(\d+)(?:º|o)?/;
const RE_PAR_UNICO = /^Par[áa]grafo [úu]nico/i;
const RE_INCISO = /^([IVXLC]+)\s*[-–]\s/;
const RE_ALINEA = /^([a-z])\)\s/;
const RE_ITEM = /^(\d+)\.\s/;

function classify(line: string): { type: SegmentType; identifier: string } | null {
  const l = line.trim();
  if (!l) return null;
  let m: RegExpExecArray | null;
  if ((m = RE_TITULO.exec(l))) return { type: "titulo", identifier: `Título ${m[1].toUpperCase()}` };
  if ((m = RE_CAPITULO.exec(l))) return { type: "capitulo", identifier: `Capítulo ${m[1].toUpperCase()}` };
  if ((m = RE_SECAO.exec(l))) return { type: "secao", identifier: `Seção ${m[1]}` };
  if ((m = RE_SUBSECAO.exec(l))) return { type: "subsecao", identifier: `Subseção ${m[1]}` };
  if ((m = RE_ARTIGO.exec(l))) return { type: "artigo", identifier: `Art. ${m[1]}º${m[2] ?? ""}` };
  if (RE_PAR_UNICO.test(l)) return { type: "paragrafo", identifier: "Parágrafo único" };
  if ((m = RE_PARAGRAFO.exec(l))) return { type: "paragrafo", identifier: `§ ${m[1]}º` };
  if ((m = RE_INCISO.exec(l))) return { type: "inciso", identifier: `Inciso ${m[1]}` };
  if ((m = RE_ALINEA.exec(l))) return { type: "alinea", identifier: `Alínea ${m[1]}` };
  if ((m = RE_ITEM.exec(l))) return { type: "item", identifier: `Item ${m[1]}` };
  return null;
}

/** Extrai título e URL do cabeçalho (formato dos arquivos em `data/`). */
function extractHeader(raw: string): { title: string; url: string } {
  const lines = raw.split(/\r?\n/);
  const titleLine = lines.find(l => /^LEI N|^INSTRUÇÃO NORMATIVA|^DECRETO N|^LEI COMPLEMENTAR/i.test(l.trim()));
  const urlLine = lines.find(l => /^\*\*URL:\*\*/.test(l.trim()));
  const hLine = lines.find(l => /^#\s+/.test(l.trim()));
  return {
    title: (titleLine ?? hLine ?? "Documento oficial").replace(/^#\s+/, "").trim(),
    url: urlLine ? urlLine.replace(/^\*\*URL:\*\*/, "").trim() : "",
  };
}

/**
 * Parseia o texto oficial em segmentos e artigos VERBATIM. Determinístico.
 * Ruído de navegação/rodapé (linhas sem marcador antes do 1º Título/Artigo) é descartado.
 */
export function parseOfficialText(raw: string): ParsedNorm {
  const { title, url } = extractHeader(raw);
  const lines = raw.split(/\r?\n/);
  const segments: ParsedSegment[] = [];

  let current: { type: SegmentType; identifier: string; buffer: string[] } | null = null;
  const flush = () => { if (current) { segments.push({ type: current.type, identifier: current.identifier, text: current.buffer.join(" ").replace(/\s+/g, " ").trim() }); current = null; } };

  let started = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const c = classify(line);
    if (c) {
      started = true;
      flush();
      current = { type: c.type, identifier: c.identifier, buffer: [line] };
    } else if (current && line) {
      current.buffer.push(line);
    } else if (!started) {
      // ruído de cabeçalho/navegação antes do primeiro marcador — ignora.
    }
  }
  flush();

  // Monta artigos com caminho estrutural + parágrafos, texto verbatim completo.
  const articles: ParsedArticle[] = [];
  const path: string[] = []; // pilha de contêineres estruturais
  const setPath = (type: SegmentType, identifier: string) => {
    const depthOf: Partial<Record<SegmentType, number>> = { titulo: 0, capitulo: 1, secao: 2, subsecao: 3 };
    const d = depthOf[type];
    if (d === undefined) return;
    path.length = d;
    path[d] = identifier;
  };

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.type === "titulo" || s.type === "capitulo" || s.type === "secao" || s.type === "subsecao") { setPath(s.type, s.identifier); continue; }
    if (s.type !== "artigo") continue;
    // acumula tudo até o próximo artigo ou contêiner estrutural (texto verbatim).
    const parts: string[] = [s.text];
    const paragraphs: ParsedParagraph[] = [];
    for (let j = i + 1; j < segments.length; j++) {
      const n = segments[j];
      if (n.type === "artigo" || n.type === "titulo" || n.type === "capitulo" || n.type === "secao" || n.type === "subsecao") break;
      parts.push(n.text);
      if (n.type === "paragrafo") paragraphs.push({ identifier: n.identifier, text: n.text });
    }
    articles.push({
      identifier: s.identifier,
      number: s.identifier.replace(/^Art\.\s*/, "").replace(/[º.]/g, "").trim(),
      path: [...path].filter(Boolean),
      fullText: parts.join("\n").trim(),
      paragraphs,
    });
  }

  return { title, url, segments, articles };
}

/** Divide um texto longo (manuais) em blocos de tamanho fixo — determinístico, verbatim. */
export function chunkText(raw: string, size = 8000): string[] {
  const cleaned = raw.replace(/^#[^\n]*\n/, "").trim();
  const chunks: string[] = [];
  for (let i = 0; i < cleaned.length; i += size) chunks.push(cleaned.slice(i, i + size));
  return chunks.length ? chunks : [""];
}

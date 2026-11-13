/**
 * F2 — EXPORTAÇÃO CONSOLIDADA do Edital: o Anexo I recebe o conteúdo INTEGRAL da versão oficial do TR fixada na emissão do Edital.
 *
 * Pura e determinística. Não altera o Edital nem o TR oficiais (o resultado é só o conteúdo de um ARTEFATO DERIVADO de exportação):
 *  - localiza no Edital emitido o parágrafo de referência ao TR (formato atual do motor — "Documento de referência: … (Termo de
 *    Referência — versão oficial emitida no processo)." — ou o formato anterior ao M8 P2.1, que citava o id do documento);
 *  - substitui SOMENTE esse parágrafo por um bloco de identificação da versão incorporada + o TR integral, com os títulos do TR
 *    aninhados abaixo do título do Anexo I (o conteúdo e a ordem do TR são preservados; só o nível dos títulos muda);
 *  - fail-closed: referência ausente ou ambígua ⇒ recusa (nunca anexa o TR "em algum lugar").
 */

/** Marca do parágrafo de referência ao TR no formato atual do motor documental (composer2, docRef). */
export const TR_DOC_REF_MARK = "(Termo de Referência — versão oficial emitida no processo)";
const DOC_REF_PREFIX = /^(?:>\s*)?Documento de referência:/;

export interface ConsolidationTr {
  /** `official_documents.id` da versão oficial do TR fixada (pin do M2). */
  readonly documentId: string;
  /** Revisão técnica na linhagem. */
  readonly version: number;
  /** Ordinal da emissão na linhagem (1ª, 2ª…); 0 = desconhecido. */
  readonly emissionNumber: number;
  /** Data/hora da emissão já formatada (pt-BR). */
  readonly emittedAtLabel: string;
  /** sha256 do conteúdo oficial do TR (o mesmo do pin). */
  readonly contentHash: string;
  readonly content: string;
}

export type ConsolidationResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly code: "EDITAL_TR_REFERENCE_NOT_FOUND" | "EDITAL_TR_REFERENCE_AMBIGUOUS" | "EDITAL_TR_EMPTY"; readonly message: string };

/** Parágrafos (blocos separados por linha em branco) com a posição exata no texto. */
function paragraphs(text: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  const re = /\n[ \t]*\n/g;
  let start = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ start, end: m.index, text: text.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  out.push({ start, end: text.length, text: text.slice(start) });
  return out;
}

/** O parágrafo cita o TR fixado: formato atual (marca do docRef) ou anterior ao P2.1 (cita o id do documento). */
function isTrReference(paragraph: string, trDocumentId: string): boolean {
  const t = paragraph.trim();
  if (!DOC_REF_PREFIX.test(t)) return false;
  return t.includes(TR_DOC_REF_MARK) || t.includes(`(${trDocumentId},`);
}

/** Título de nível 1 que abre o TR ("# Termo de Referência — <objeto>"). Só ele é candidato a virar a linha de identificação. */
const TR_TITLE = /^#[ \t]+(Termo de Refer[eê]ncia\b.*?)[ \t]*#*[ \t]*$/i;

export interface EmbeddedTr {
  /** Texto do título do TR (verbatim), quando a abertura do TR é o título "Termo de Referência…"; senão `null`. */
  readonly title: string | null;
  /** Corpo do TR com os títulos aninhados abaixo do "## ANEXO I". */
  readonly body: string;
}

/**
 * Conteúdo do TR para o Anexo I. Marcadores de cabeçalho Markdown são o único ponto alterado; tabelas, listas, ênfases e texto ficam
 * intactos.
 *  - F3-E: o título que abre o TR ("# Termo de Referência — <objeto>", único título de nível 1) repetiria o título do Anexo; ele sai do
 *    corpo e o seu texto, sem nenhuma alteração, abre a linha de identificação (`trIdentificationBlock`). Nada do TR se perde.
 *  - F3-D: a hierarquia RELATIVA do TR é preservada: o nível mais alto restante vira "###" (abaixo do "## ANEXO I") e os demais
 *    descem na mesma proporção ("## 2." → "###", "### 2.1." → "####"), limitado a "######". Antes, todos viravam "###".
 */
export function embedTrContent(trContent: string): EmbeddedTr {
  let lines = trContent.replace(/\r\n?/g, "\n").trim().split("\n");
  let title: string | null = null;
  const h1Count = lines.filter((l) => /^#[ \t]+/.test(l)).length;
  const m = TR_TITLE.exec(lines[0] ?? "");
  if (m && h1Count === 1) {
    title = m[1].trim();
    lines = lines.slice(1);
  }
  const depths = lines.map((l) => /^(#{1,6})[ \t]+/.exec(l)?.[1].length ?? 0).filter((d) => d > 0);
  const shift = depths.length ? 3 - Math.min(...depths) : 0;
  const body = lines.map((l) => l.replace(/^(#{1,6})[ \t]+/, (_x, h: string) => `${"#".repeat(Math.min(Math.max(h.length + shift, 3), 6))} `))
    .join("\n").trim();
  return { title, body };
}

const ordinal = (n: number): string => (n > 0 ? `${n}ª emissão oficial` : "versão oficial emitida");

/**
 * F3-E — identificação SIMPLES da versão incorporada (abre o Anexo I): título do TR + emissão, revisão técnica e data.
 * O SHA-256 completo não sai da exportação: vai, discreto, ao FIM do TR incorporado (`trIntegrityLine`) e continua no ledger do
 * artefato e na auditoria (`bundleNote`/`trContentHash`).
 */
export function trIdentificationBlock(tr: ConsolidationTr, title: string | null = null): string {
  return `**${title ?? "Termo de Referência"}**\n\n`
    + `Versão incorporada integralmente a este Edital: ${ordinal(tr.emissionNumber)}, revisão técnica v${tr.version}, emitida em ${tr.emittedAtLabel}.`;
}

/** Linha de controle de integridade (SHA-256 completo do conteúdo oficial do TR), em itálico, ao fim do TR incorporado. */
export function trIntegrityLine(tr: ConsolidationTr): string {
  return `_Controle de integridade da versão oficial do Termo de Referência incorporada (SHA-256): ${tr.contentHash}_`;
}

/** Edital consolidado: o parágrafo de referência ao TR é substituído pelo TR oficial integral. O restante do Edital fica idêntico. */
export function consolidateEditalWithTr(editalContent: string, tr: ConsolidationTr): ConsolidationResult {
  const { title, body } = embedTrContent(tr.content);
  if (!body) return { ok: false, code: "EDITAL_TR_EMPTY", message: "a versão oficial do TR vinculada está vazia" };
  const hits = paragraphs(editalContent).filter((p) => isTrReference(p.text, tr.documentId));
  if (hits.length === 0) {
    return { ok: false, code: "EDITAL_TR_REFERENCE_NOT_FOUND", message: "o Edital emitido não contém a referência ao Termo de Referência no Anexo I" };
  }
  if (hits.length > 1) {
    return { ok: false, code: "EDITAL_TR_REFERENCE_AMBIGUOUS", message: "o Edital emitido referencia o Termo de Referência em mais de um ponto" };
  }
  const [hit] = hits;
  const block = `${trIdentificationBlock(tr, title)}\n\n${body}\n\n${trIntegrityLine(tr)}`;
  return { ok: true, content: editalContent.slice(0, hit.start) + block + editalContent.slice(hit.end) };
}

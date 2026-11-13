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

/**
 * Conteúdo do TR para o Anexo I: títulos do TR passam ao nível 3 (abaixo do "## ANEXO I"), o resto é preservado como está.
 * Marcadores de cabeçalho Markdown são o único ponto alterado; tabelas, listas, ênfases e texto ficam intactos.
 */
export function embedTrContent(trContent: string): string {
  return trContent.replace(/\r\n?/g, "\n").trim().replace(/^#{1,6}[ \t]+/gm, "### ");
}

const ordinal = (n: number): string => (n > 0 ? `${n}ª emissão` : "versão emitida");

/** Bloco de identificação da versão incorporada (rastreável: emissão, revisão técnica, data e sha256 do conteúdo oficial). */
export function trIdentificationBlock(tr: ConsolidationTr): string {
  return `**Termo de Referência — versão oficial incorporada integralmente a este Edital:** ${ordinal(tr.emissionNumber)} (revisão técnica v${tr.version}), `
    + `emitida em ${tr.emittedAtLabel}. Integridade do conteúdo (SHA-256): ${tr.contentHash}.`;
}

/** Edital consolidado: o parágrafo de referência ao TR é substituído pelo TR oficial integral. O restante do Edital fica idêntico. */
export function consolidateEditalWithTr(editalContent: string, tr: ConsolidationTr): ConsolidationResult {
  const body = embedTrContent(tr.content);
  if (!body) return { ok: false, code: "EDITAL_TR_EMPTY", message: "a versão oficial do TR vinculada está vazia" };
  const hits = paragraphs(editalContent).filter((p) => isTrReference(p.text, tr.documentId));
  if (hits.length === 0) {
    return { ok: false, code: "EDITAL_TR_REFERENCE_NOT_FOUND", message: "o Edital emitido não contém a referência ao Termo de Referência no Anexo I" };
  }
  if (hits.length > 1) {
    return { ok: false, code: "EDITAL_TR_REFERENCE_AMBIGUOUS", message: "o Edital emitido referencia o Termo de Referência em mais de um ponto" };
  }
  const [hit] = hits;
  const block = `${trIdentificationBlock(tr)}\n\n${body}`;
  return { ok: true, content: editalContent.slice(0, hit.start) + block + editalContent.slice(hit.end) };
}

/**
 * M8 (homologação visual) — marcadores INTERNOS do motor documental que nunca são conteúdo para o leitor humano.
 *
 * O conteúdo persistido (rascunho/versão oficial) continua íntegro — inclusive os marcadores, que delimitam o quadro
 * autoritativo de itens (`server/domain/authoritativeItems.ts`). Esta função atua só na APRESENTAÇÃO: a exportação
 * DOCX/PDF (`documentConverter`) já descarta blocos HTML; a visualização formatada faz o mesmo de forma explícita.
 */
const INTERNAL_COMMENT = /<!--\s*licigov:[^>]*?-->[ \t]*\r?\n?/g;

export function stripInternalMarkers(content: string): string {
  return content.replace(INTERNAL_COMMENT, "");
}

/** Há marcador interno no texto? (para avisar no editor técnico que o trecho é gerido pelo sistema). */
export function hasInternalMarkers(content: string): boolean {
  return /<!--\s*licigov:/.test(content);
}

/**
 * Há trecho que a visualização formatada NÃO mostra (HTML bruto, comentário comum ou imagem)? Os marcadores internos
 * `licigov:` não contam — são do sistema. Quando houver, a tela oferece o texto integral: quem revisa/emite precisa poder
 * ver tudo o que será persistido, inclusive o que a apresentação segura descarta.
 */
export function hasHiddenContent(content: string): boolean {
  const text = stripInternalMarkers(content);
  return /<!--|<\/?[A-Za-z][^>]*>/.test(text) || /!\[[^\]]*\]\(/.test(text);
}

/**
 * Decisão do Owner (PR #334) — identificação de TODO documento do Processo Licitatório que não é a versão emitida
 * oficialmente (fonte de verdade: ledger de emissões), qualquer que seja o status interno do rascunho. Aplicada na 1ª
 * página e no rodapé de todas as páginas do DOCX/PDF; a barra LICIGOV-FAST usa o mesmo texto.
 */
export const UNISSUED_DRAFT_MARKING = "MINUTA — NÃO EMITIDA OFICIALMENTE";

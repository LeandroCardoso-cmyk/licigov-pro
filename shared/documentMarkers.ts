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

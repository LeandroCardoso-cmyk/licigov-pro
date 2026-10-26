/**
 * SEC-AUD-07 (xlsx) — formato de planilha legado `.xls` SUSPENSO por decisão do Owner (26/10/2026).
 *
 * O único leitor de BIFF/OLE disponível no npm (SheetJS 0.18.5) tem as advisories GHSA-4r6h-8v6p-xvw6 e
 * GHSA-5pgg-2g8v-p4x9 sem versão corrigida publicada no npm; o `.xls` fica indisponível até nova decisão e o
 * usuário recebe a orientação de conversão abaixo — mensagem ÚNICA para servidor (erro do parser, recusa na
 * criação da sessão, capacidade) e cliente (validação antes do envio).
 */
export const XLS_SUSPENDED_MESSAGE =
  "O formato .xls está temporariamente indisponível. Abra o arquivo no Excel ou LibreOffice, salve como .xlsx e envie novamente.";

export const XLS_MIME_TYPE = "application/vnd.ms-excel";

/** Arquivo DECLARADO como `.xls` (extensão ou MIME). O conteúdo real é conferido à parte no servidor. */
export function isDeclaredLegacyXls(fileName: string | null | undefined, mimeType: string | null | undefined): boolean {
  const name = (fileName ?? "").trim().toLowerCase();
  return name.endsWith(".xls") || (mimeType ?? "").trim().toLowerCase() === XLS_MIME_TYPE;
}

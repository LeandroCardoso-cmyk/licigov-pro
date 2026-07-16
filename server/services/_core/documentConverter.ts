/**
 * RC-3.5.2 — Classificação: **LEGACY** (wrapper interno).
 *
 * Adaptador fino que delega ao Internal Renderer (`../documentConverter`) para o
 * caminho legado de relatórios (`processReportService`). Fora do pipeline oficial.
 * Registrado na allowlist central (`DOCUMENT_CONVERTER_ALLOWLIST`). Não remover.
 */
import { convertToPDF } from "../documentConverter";

export const documentConverter = {
  async convertMarkdownToPDF(markdown: string): Promise<Buffer> {
    return convertToPDF(markdown, "relatorio.pdf");
  },
};

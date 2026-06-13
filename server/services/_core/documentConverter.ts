import { convertToPDF } from "../documentConverter";

export const documentConverter = {
  async convertMarkdownToPDF(markdown: string): Promise<Buffer> {
    return convertToPDF(markdown, "relatorio.pdf");
  },
};

import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { randomBytes } from "crypto";

const execAsync = promisify(exec);

/**
 * Serviço de conversão de documentos
 * Converte Markdown para PDF usando manus-md-to-pdf
 */
export const documentConverter = {
  /**
   * Converte Markdown para PDF
   * @param markdown Conteúdo em Markdown
   * @returns Buffer do PDF gerado
   */
  async convertMarkdownToPDF(markdown: string): Promise<Buffer> {
    const tempId = randomBytes(16).toString("hex");
    const inputPath = `/tmp/doc-${tempId}.md`;
    const outputPath = `/tmp/doc-${tempId}.pdf`;

    try {
      // Escrever Markdown em arquivo temporário
      await writeFile(inputPath, markdown, "utf-8");

      // Converter usando manus-md-to-pdf
      await execAsync(`manus-md-to-pdf ${inputPath} ${outputPath}`);

      // Ler PDF gerado
      const { readFile } = await import("fs/promises");
      const pdfBuffer = await readFile(outputPath);

      // Limpar arquivos temporários
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});

      return pdfBuffer;
    } catch (error) {
      // Limpar arquivos temporários em caso de erro
      await unlink(inputPath).catch(() => {});
      await unlink(outputPath).catch(() => {});

      throw new Error(`Erro ao converter Markdown para PDF: ${error}`);
    }
  },
};

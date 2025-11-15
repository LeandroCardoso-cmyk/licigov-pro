/**
 * Serviço de geração de arquivos ZIP
 * Cria pacote completo com todos os documentos para publicação
 */

import archiver from "archiver";
import { Readable } from "stream";
import * as db from "../db";
import { convertToPDF } from "./documentConverter";
import { generateItemsSpreadsheet, getSpreadsheetFileName } from "./excelService";

interface ZipGenerationResult {
  buffer: Buffer;
  filename: string;
}

/**
 * Gerar arquivo ZIP com todos os documentos do processo
 */
export async function generatePublicationZip(
  processId: number,
  platformId: number | null
): Promise<ZipGenerationResult> {
  // Buscar processo
  const process = await db.getProcessById(processId);
  if (!process) {
    throw new Error("Processo não encontrado");
  }

  // Buscar plataforma
  const platform = platformId ? await db.getPlatformById(platformId) : null;

  // Buscar documentos do processo
  const documents = await db.getDocumentsByProcess(processId);

  // Criar archive
  const archive = archiver("zip", {
    zlib: { level: 9 }, // Máxima compressão
  });

  // Array para coletar chunks do ZIP
  const chunks: Buffer[] = [];

  // Criar promise para aguardar finalização
  const zipPromise = new Promise<Buffer>((resolve, reject) => {
    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });

  // Adicionar documentos ao ZIP
  for (const doc of documents) {
    try {
      // Converter documento para PDF
      const pdfBuffer = await convertToPDF(doc.content);

      // Determinar nome do arquivo
      let filename = "";
      if (doc.type === "etp") {
        filename = "01_ESTUDO_TECNICO_PRELIMINAR.pdf";
      } else if (doc.type === "tr") {
        filename = "02_TERMO_REFERENCIA.pdf";
      } else if (doc.type === "dfd") {
        filename = "03_DOCUMENTO_FORMALIZADOR_DEMANDA.pdf";
      } else if (doc.type === "edital") {
        filename = "04_EDITAL.pdf";
      }

      // Adicionar ao ZIP
      archive.append(pdfBuffer, { name: filename });
    } catch (error) {
      console.error(`Erro ao adicionar documento ${doc.type} ao ZIP:`, error);
      // Continuar mesmo se um documento falhar
    }
  }

  // Adicionar planilha de itens (se houver itens)
  const items = await db.getProcessItems(processId);
  if (items.length > 0) {
    try {
      const spreadsheetBuffer = await generateItemsSpreadsheet(processId, platformId);
      const spreadsheetFilename = getSpreadsheetFileName(
        process.name,
        platform?.slug || null
      );

      archive.append(spreadsheetBuffer, { name: `05_${spreadsheetFilename}` });
    } catch (error) {
      console.error("Erro ao adicionar planilha ao ZIP:", error);
    }
  }

  // Adicionar arquivo README com instruções
  const readmeContent = generateReadmeContent(process, platform);
  archive.append(readmeContent, { name: "00_LEIA_ME.txt" });

  // Finalizar archive
  archive.finalize();

  // Aguardar conclusão
  const zipBuffer = await zipPromise;

  // Gerar nome do arquivo ZIP
  const sanitizedName = process.name
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 50);

  const zipFilename = platform
    ? `PACOTE_PUBLICACAO_${platform.slug.toUpperCase()}_${sanitizedName}.zip`
    : `PACOTE_PUBLICACAO_${sanitizedName}.zip`;

  return {
    buffer: zipBuffer,
    filename: zipFilename,
  };
}

/**
 * Gerar conteúdo do arquivo README
 */
function generateReadmeContent(
  process: any,
  platform: any | null
): string {
  const date = new Date().toLocaleDateString("pt-BR");

  let content = `═══════════════════════════════════════════════════════════════
  PACOTE DE PUBLICAÇÃO - LICITAÇÃO
═══════════════════════════════════════════════════════════════

Processo: ${process.name}
Data de Geração: ${date}
`;

  if (platform) {
    content += `Plataforma: ${platform.name}
Website: ${platform.websiteUrl || "N/A"}

`;
  }

  content += `
═══════════════════════════════════════════════════════════════
  CONTEÚDO DO PACOTE
═══════════════════════════════════════════════════════════════

Este pacote contém todos os documentos necessários para publicação
do processo licitatório:

1. Estudo Técnico Preliminar (ETP)
2. Termo de Referência (TR)
3. Documento Formalizador de Demanda (DFD)
4. Edital de Licitação
5. Planilha de Itens CATMAT/CATSER (se aplicável)

═══════════════════════════════════════════════════════════════
  INSTRUÇÕES DE PUBLICAÇÃO
═══════════════════════════════════════════════════════════════
`;

  if (platform) {
    content += `
Este pacote foi preparado especificamente para a plataforma:
${platform.name}

Os documentos foram adaptados automaticamente para atender aos
requisitos específicos desta plataforma.

Para publicar:
1. Acesse ${platform.websiteUrl || "a plataforma"}
2. Faça login com suas credenciais
3. Siga o checklist disponível no sistema LiciGov Pro
4. Anexe os documentos deste pacote conforme solicitado
`;
  } else {
    content += `
Este pacote foi gerado em formato padrão.

Para publicar:
1. Acesse a plataforma de licitação escolhida
2. Siga as instruções específicas da plataforma
3. Anexe os documentos conforme necessário
`;
  }

  content += `
═══════════════════════════════════════════════════════════════
  OBSERVAÇÕES IMPORTANTES
═══════════════════════════════════════════════════════════════

- Todos os documentos estão em formato PDF
- A planilha de itens está em formato XLSX (Excel)
- Revise todos os documentos antes de publicar
- Verifique se os valores e quantidades estão corretos
- Consulte o checklist no sistema para não esquecer nenhum passo

═══════════════════════════════════════════════════════════════
  SUPORTE
═══════════════════════════════════════════════════════════════

Em caso de dúvidas, consulte o sistema LiciGov Pro ou entre em
contato com o suporte técnico.

Gerado automaticamente por LiciGov Pro
`;

  return content;
}

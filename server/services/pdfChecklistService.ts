/**
 * Serviço de geração de checklist em PDF
 * Gera PDF formatado do checklist de publicação
 */

import { convertToPDF } from "./documentConverter";
import * as db from "../db";

interface ChecklistItem {
  stepNumber: number;
  title: string;
  description: string;
  category: string;
  fields: Array<{ label: string; value: string }>;
  requiredDocuments: Array<{ type: string; filename: string }>;
  isOptional: boolean;
}

/**
 * Gerar checklist em formato Markdown
 */
async function generateChecklistMarkdown(
  processId: number,
  platformId: number
): Promise<string> {
  // Buscar processo e plataforma
  const process = await db.getProcessById(processId);
  if (!process) {
    throw new Error("Processo não encontrado");
  }

  const platform = await db.getPlatformById(platformId);
  if (!platform) {
    throw new Error("Plataforma não encontrada");
  }

  // Buscar checklist
  const checklistItems = await db.getPlatformChecklist(platformId);

  // Agrupar por categoria
  const itemsByCategory = checklistItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, typeof checklistItems>);

  // Construir Markdown
  let markdown = `# Checklist de Publicação\n\n`;
  markdown += `**Processo:** ${process.name}\n\n`;
  markdown += `**Plataforma:** ${platform.name}\n\n`;
  markdown += `**Website:** ${platform.websiteUrl || "N/A"}\n\n`;
  markdown += `**Data de Geração:** ${new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  })}\n\n`;
  markdown += `---\n\n`;

  // Total de passos
  const totalSteps = checklistItems.length;
  const optionalSteps = checklistItems.filter((item) => item.isOptional).length;
  const requiredSteps = totalSteps - optionalSteps;

  markdown += `## Resumo\n\n`;
  markdown += `- **Total de Passos:** ${totalSteps}\n`;
  markdown += `- **Passos Obrigatórios:** ${requiredSteps}\n`;
  markdown += `- **Passos Opcionais:** ${optionalSteps}\n\n`;
  markdown += `---\n\n`;

  // Adicionar instruções gerais
  markdown += `## Instruções Gerais\n\n`;
  markdown += `Este checklist foi gerado automaticamente pelo sistema LiciGov Pro para auxiliar na publicação do processo licitatório na plataforma **${platform.name}**.\n\n`;
  markdown += `**Como usar este checklist:**\n\n`;
  markdown += `1. Siga os passos na ordem apresentada\n`;
  markdown += `2. Marque cada passo como concluído após realizá-lo\n`;
  markdown += `3. Passos marcados como "OPCIONAL" podem ser pulados se não aplicáveis\n`;
  markdown += `4. Campos com valores pré-preenchidos podem ser copiados diretamente\n`;
  markdown += `5. Documentos necessários estão listados em cada passo\n\n`;
  markdown += `---\n\n`;

  // Adicionar passos por categoria
  const categories = Object.keys(itemsByCategory);
  
  categories.forEach((category) => {
    markdown += `## ${category}\n\n`;

    const items = itemsByCategory[category];
    items.forEach((item) => {
      // Título do passo
      markdown += `### Passo ${item.stepNumber}: ${item.title}`;
      if (item.isOptional) {
        markdown += ` *(OPCIONAL)*`;
      }
      markdown += `\n\n`;

      // Descrição
      if (item.description) {
        markdown += `${item.description}\n\n`;
      }

      // Campos
      if (item.fields && item.fields.length > 0) {
        markdown += `**Campos:**\n\n`;
        item.fields.forEach((field) => {
          markdown += `- **${field.label}:** ${field.value}\n`;
        });
        markdown += `\n`;
      }

      // Documentos necessários
      if (item.requiredDocuments && item.requiredDocuments.length > 0) {
        markdown += `**Documentos Necessários:**\n\n`;
        item.requiredDocuments.forEach((doc) => {
          markdown += `- ${doc.filename}\n`;
        });
        markdown += `\n`;
      }

      // Checkbox para marcar como concluído
      markdown += `☐ **Passo concluído**\n\n`;
      markdown += `---\n\n`;
    });
  });

  // Rodapé
  markdown += `## Observações Finais\n\n`;
  markdown += `- Revise todos os documentos antes de publicar\n`;
  markdown += `- Verifique se os valores e quantidades estão corretos\n`;
  markdown += `- Confirme que todos os anexos foram carregados\n`;
  markdown += `- Em caso de dúvidas, consulte o suporte da plataforma\n\n`;
  markdown += `---\n\n`;
  markdown += `*Gerado automaticamente por LiciGov Pro*\n`;

  return markdown;
}

/**
 * Gerar checklist em PDF
 */
export async function generateChecklistPDF(
  processId: number,
  platformId: number
): Promise<Buffer> {
  // Gerar Markdown
  const markdown = await generateChecklistMarkdown(processId, platformId);

  // Converter para PDF
  const pdfBuffer = await convertToPDF(markdown);

  return pdfBuffer;
}

/**
 * Gerar nome do arquivo de checklist
 */
export function getChecklistFileName(
  processName: string,
  platformName: string
): string {
  // Sanitizar nomes
  const sanitizedProcess = processName
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 50);

  const sanitizedPlatform = platformName
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 30);

  return `CHECKLIST_${sanitizedPlatform}_${sanitizedProcess}.pdf`;
}

/**
 * Serviço de geração de planilhas XLSX
 * Gera planilhas de itens CATMAT/CATSER formatadas por plataforma
 */

import * as XLSX from "xlsx";
import * as db from "../db";

interface ProcessItem {
  id: number;
  itemType: "material" | "service";
  code: string | null;
  description: string;
  unit: string;
  quantity: number;
  estimatedUnitPrice: number | null;
}

/**
 * Gerar planilha de itens CATMAT/CATSER
 * Formato adaptado por plataforma
 */
export async function generateItemsSpreadsheet(
  processId: number,
  platformId: number | null
): Promise<Buffer> {
  // Buscar processo e plataforma
  const process = await db.getProcessById(processId);
  if (!process) {
    throw new Error("Processo não encontrado");
  }

  const platform = platformId ? await db.getPlatformById(platformId) : null;

  // Buscar itens do processo
  const items = await db.getProcessItems(processId);

  // Montar dados da planilha
  const worksheetData: any[] = [];

  // Cabeçalho adaptado por plataforma
  if (platform?.slug === "compras-gov-br") {
    // Formato Compras.gov.br
    worksheetData.push([
      "Item",
      "Código CATMAT/CATSER",
      "Descrição Detalhada",
      "Unidade de Medida",
      "Quantidade",
      "Valor Unitário Estimado (R$)",
      "Valor Total Estimado (R$)",
      "Tipo",
    ]);

    items.forEach((item, index) => {
      const unitPrice = item.estimatedPrice ? item.estimatedPrice / 100 : 0;
      const totalPrice = unitPrice * (item.quantity ?? 0);

      worksheetData.push([
        index + 1,
        (item.catmatCode || item.catserCode || "N/A"),
        item.description,
        item.unit,
        (item.quantity ?? 0),
        unitPrice.toFixed(2),
        totalPrice.toFixed(2),
        item.itemType === "material" ? "Material (CATMAT)" : "Serviço (CATSER)",
      ]);
    });
  } else if (platform?.slug === "bll-compras") {
    // Formato BLL Compras
    worksheetData.push([
      "Lote",
      "Item",
      "Código",
      "Descrição",
      "Unidade",
      "Qtd",
      "Valor Unit. (R$)",
      "Valor Total (R$)",
    ]);

    items.forEach((item, index) => {
      const unitPrice = item.estimatedPrice ? item.estimatedPrice / 100 : 0;
      const totalPrice = unitPrice * (item.quantity ?? 0);

      worksheetData.push([
        1, // Lote único por padrão
        index + 1,
        (item.catmatCode || item.catserCode || ""),
        item.description,
        item.unit,
        (item.quantity ?? 0),
        unitPrice.toFixed(2),
        totalPrice.toFixed(2),
      ]);
    });
  } else {
    // Formato genérico (padrão)
    worksheetData.push([
      "Item",
      "Tipo",
      "Código CATMAT/CATSER",
      "Descrição",
      "Unidade",
      "Quantidade",
      "Valor Unitário (R$)",
      "Valor Total (R$)",
    ]);

    items.forEach((item, index) => {
      const unitPrice = item.estimatedPrice ? item.estimatedPrice / 100 : 0;
      const totalPrice = unitPrice * (item.quantity ?? 0);

      worksheetData.push([
        index + 1,
        item.itemType === "material" ? "Material" : "Serviço",
        (item.catmatCode || item.catserCode || "N/A"),
        item.description,
        item.unit,
        (item.quantity ?? 0),
        unitPrice.toFixed(2),
        totalPrice.toFixed(2),
      ]);
    });
  }

  // Adicionar linha de total
  const totalValue = items.reduce((sum, item) => {
    const unitPrice = item.estimatedPrice ? item.estimatedPrice / 100 : 0;
    return sum + unitPrice * (item.quantity ?? 0);
  }, 0);

  worksheetData.push([]);
  worksheetData.push(["", "", "", "", "", "VALOR TOTAL:", totalValue.toFixed(2)]);

  // Criar workbook
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // Ajustar largura das colunas
  const columnWidths = [
    { wch: 6 },  // Item
    { wch: 20 }, // Código/Tipo
    { wch: 50 }, // Descrição
    { wch: 12 }, // Unidade
    { wch: 10 }, // Quantidade
    { wch: 18 }, // Valor Unitário
    { wch: 18 }, // Valor Total
    { wch: 20 }, // Tipo (se houver)
  ];
  worksheet["!cols"] = columnWidths;

  // Adicionar worksheet ao workbook
  XLSX.utils.book_append_sheet(workbook, worksheet, "Itens");

  // Gerar buffer
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });

  return buffer;
}

/**
 * Gerar nome do arquivo de planilha por plataforma
 */
export function getSpreadsheetFileName(
  processName: string,
  platformSlug: string | null
): string {
  // Sanitizar nome do processo
  const sanitizedName = processName
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_")
    .substring(0, 50);

  if (platformSlug === "compras-gov-br") {
    return `PLANILHA_ITENS_CATMAT_${sanitizedName}.xlsx`;
  } else if (platformSlug === "bll-compras") {
    return `PLANILHA_LOTES_${sanitizedName}.xlsx`;
  } else {
    return `PLANILHA_ITENS_${sanitizedName}.xlsx`;
  }
}

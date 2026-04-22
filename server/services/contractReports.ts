import { differenceInDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getDb } from "../db";
import { contracts, contractAuditLogs } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import ExcelJS from "exceljs";

/**
 * Gera relatório de alertas de vencimento em Excel
 */
export async function generateAlertsExcelReport() {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // Buscar contratos ativos
  const activeContracts = await db
    .select()
    .from(contracts)
    .where(eq(contracts.status, "active"));

  // Criar workbook
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Alertas de Vencimento");

  // Definir colunas
  worksheet.columns = [
    { header: "Número", key: "number", width: 15 },
    { header: "Ano", key: "year", width: 10 },
    { header: "Objeto", key: "object", width: 40 },
    { header: "Contratado", key: "contractor", width: 30 },
    { header: "Valor Atual", key: "value", width: 15 },
    { header: "Data de Término", key: "endDate", width: 15 },
    { header: "Dias até Vencimento", key: "daysUntilExpiry", width: 20 },
    { header: "Status", key: "status", width: 20 },
  ];

  // Estilizar cabeçalho
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };

  // Adicionar dados
  const today = new Date();
  const rows: any[] = [];

  for (const contract of activeContracts) {
    const endDate = new Date(contract.endDate);
    const daysUntilExpiry = differenceInDays(endDate, today);

    let statusText = "";
    if (daysUntilExpiry < 0) {
      statusText = `Vencido há ${Math.abs(daysUntilExpiry)} dias`;
    } else if (daysUntilExpiry === 0) {
      statusText = "Vence hoje";
    } else if (daysUntilExpiry <= 30) {
      statusText = `Vence em ${daysUntilExpiry} dias (URGENTE)`;
    } else if (daysUntilExpiry <= 60) {
      statusText = `Vence em ${daysUntilExpiry} dias (ATENÇÃO)`;
    } else if (daysUntilExpiry <= 90) {
      statusText = `Vence em ${daysUntilExpiry} dias`;
    } else {
      continue; // Não incluir contratos com mais de 90 dias
    }

    rows.push({
      number: contract.number,
      year: contract.year,
      object: contract.object,
      contractor: contract.contractorName,
      value: contract.currentValue,
      endDate: format(endDate, "dd/MM/yyyy", { locale: ptBR }),
      daysUntilExpiry,
      status: statusText,
    });
  }

  // Ordenar por dias até vencimento (mais urgente primeiro)
  rows.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  // Adicionar linhas
  rows.forEach((row) => {
    const excelRow = worksheet.addRow(row);

    // Colorir linha baseado na urgência
    if (row.daysUntilExpiry < 0) {
      excelRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFE0E0" }, // Vermelho claro
      };
    } else if (row.daysUntilExpiry <= 30) {
      excelRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFD0D0" }, // Vermelho muito claro
      };
    } else if (row.daysUntilExpiry <= 60) {
      excelRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFE0C0" }, // Laranja claro
      };
    } else if (row.daysUntilExpiry <= 90) {
      excelRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFFF00" }, // Amarelo claro
      };
    }

    // Formatar valor como moeda
    excelRow.getCell("value").numFmt = 'R$ #,##0.00';
  });

  // Gerar buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Gera relatório de histórico de auditoria em Excel
 */
export async function generateAuditExcelReport(contractId: number) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // Buscar contrato
  const contract = await db.select().from(contracts).where(eq(contracts.id, contractId)).limit(1);
  if (!contract || contract.length === 0) {
    throw new Error("Contract not found");
  }

  // Buscar logs de auditoria
  const logs = await db
    .select()
    .from(contractAuditLogs)
    .where(eq(contractAuditLogs.contractId, contractId))
    .orderBy(contractAuditLogs.createdAt);

  // Criar workbook
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Histórico de Auditoria");

  // Definir colunas
  worksheet.columns = [
    { header: "Data/Hora", key: "createdAt", width: 20 },
    { header: "Ação", key: "action", width: 25 },
    { header: "Usuário", key: "userName", width: 25 },
    { header: "Detalhes", key: "details", width: 50 },
  ];

  // Estilizar cabeçalho
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };

  // Adicionar informações do contrato
  worksheet.addRow([]);
  worksheet.addRow(["Contrato:", `${contract[0].number}/${contract[0].year}`]);
  worksheet.addRow(["Objeto:", contract[0].object]);
  worksheet.addRow(["Contratado:", contract[0].contractorName]);
  worksheet.addRow([]);

  // Adicionar dados de auditoria
  logs.forEach((log) => {
    const actionLabels: Record<string, string> = {
      created: "Criado",
      updated: "Atualizado",
      amendment_added: "Aditivo Adicionado",
      apostille_added: "Apostilamento Adicionado",
      document_generated: "Documento Gerado",
      status_changed: "Status Alterado",
    };

    worksheet.addRow({
      createdAt: format(new Date(log.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR }),
      action: actionLabels[log.action] || log.action,
      userName: log.userName || "Sistema",
      details: log.details ? JSON.stringify(log.details, null, 2) : "-",
    });
  });

  // Gerar buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Gera relatório de alertas em formato de texto para PDF
 */
export function generateAlertsPDFContent() {
  // Retornar markdown que será convertido para PDF
  return `
# Relatório de Alertas de Vencimento de Contratos

**Data de Geração:** ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}

---

Este relatório lista todos os contratos ativos que estão próximos ao vencimento ou já vencidos.

## Critérios de Alerta

- **Vencidos:** Contratos com data de término anterior à data atual
- **30 dias:** Contratos que vencem nos próximos 30 dias
- **60 dias:** Contratos que vencem entre 31 e 60 dias
- **90 dias:** Contratos que vencem entre 61 e 90 dias

---

*Para visualizar os dados detalhados, acesse a página de Alertas no sistema ou exporte o relatório em Excel.*
  `.trim();
}

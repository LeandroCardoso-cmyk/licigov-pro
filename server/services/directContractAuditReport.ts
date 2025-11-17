import PDFDocument from "pdfkit";
import { getDirectContractById, getDirectContractAuditLogs } from "../db";

interface AuditReportOptions {
  contractId: number;
  filterAction?: string;
}

/**
 * Gera relatório PDF de auditoria de uma contratação direta
 */
export async function generateAuditReport(options: AuditReportOptions): Promise<Buffer> {
  const { contractId, filterAction } = options;

  // Buscar contratação
  const contract = await getDirectContractById(contractId);
  if (!contract) {
    throw new Error("Contratação direta não encontrada");
  }

  // Buscar logs de auditoria
  const logs = await getDirectContractAuditLogs(contractId);
  
  // Filtrar por ação se especificado
  const filteredLogs = filterAction
    ? logs.filter((log) => log.action === filterAction)
    : logs;

  // Criar documento PDF
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  const chunks: Buffer[] = [];

  doc.on("data", (chunk) => chunks.push(chunk));

  // Cabeçalho
  doc
    .fontSize(20)
    .font("Helvetica-Bold")
    .text("Relatório de Auditoria", { align: "center" })
    .moveDown(0.5);

  doc
    .fontSize(16)
    .text(`Contratação Direta Nº ${contract.number}/${contract.year}`, { align: "center" })
    .moveDown(1);

  // Informações da Contratação
  doc.fontSize(14).font("Helvetica-Bold").text("Informações da Contratação", { underline: true });
  doc.moveDown(0.5);

  doc.fontSize(11).font("Helvetica");
  doc.text(`Tipo: ${contract.type === "dispensa" ? "Dispensa" : "Inexigibilidade"}`);
  doc.text(`Objeto: ${contract.object}`);
  doc.text(`Valor: R$ ${contract.value.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
  doc.text(`Status: ${getStatusLabel(contract.status)}`);
  doc.text(`Modo: ${contract.mode === "presencial" ? "Presencial" : "Eletrônico"}`);
  doc.moveDown(1);

  // Estatísticas
  doc.fontSize(14).font("Helvetica-Bold").text("Estatísticas de Auditoria", { underline: true });
  doc.moveDown(0.5);

  const stats = calculateStatistics(filteredLogs);
  doc.fontSize(11).font("Helvetica");
  doc.text(`Total de Ações: ${filteredLogs.length}`);
  doc.text(`Período: ${stats.firstAction} até ${stats.lastAction}`);
  doc.moveDown(0.5);

  // Ações por tipo
  doc.fontSize(12).font("Helvetica-Bold").text("Ações por Tipo:");
  doc.fontSize(11).font("Helvetica");
  Object.entries(stats.byAction).forEach(([action, count]) => {
    doc.text(`  • ${getActionLabel(action)}: ${count}`);
  });
  doc.moveDown(0.5);

  // Ações por usuário
  doc.fontSize(12).font("Helvetica-Bold").text("Ações por Usuário:");
  doc.fontSize(11).font("Helvetica");
  Object.entries(stats.byUser).forEach(([user, count]) => {
    doc.text(`  • ${user || "Usuário desconhecido"}: ${count}`);
  });
  doc.moveDown(1);

  // Timeline de Ações
  doc.fontSize(14).font("Helvetica-Bold").text("Timeline de Ações", { underline: true });
  doc.moveDown(0.5);

  if (filteredLogs.length === 0) {
    doc.fontSize(11).font("Helvetica").text("Nenhuma ação registrada.");
  } else {
    filteredLogs.forEach((log, index) => {
      // Verificar se precisa de nova página
      if (doc.y > 700) {
        doc.addPage();
      }

      doc.fontSize(11).font("Helvetica-Bold");
      doc.text(`${index + 1}. ${getActionLabel(log.action)}`, { continued: false });

      doc.fontSize(10).font("Helvetica");
      doc.text(`   Data: ${formatDate(log.createdAt)}`);
      doc.text(`   Usuário: ${log.userName || "Usuário desconhecido"}`);

      if (log.details) {
        doc.text(`   Detalhes: ${formatDetails(log.details)}`);
      }

      doc.moveDown(0.5);
    });
  }

  // Rodapé
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(9)
      .font("Helvetica")
      .text(
        `Página ${i + 1} de ${pages.count} - Gerado em ${formatDate(new Date())}`,
        50,
        doc.page.height - 50,
        { align: "center" }
      );
  }

  doc.end();

  return new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

/**
 * Calcula estatísticas dos logs de auditoria
 */
function calculateStatistics(logs: any[]) {
  const byAction: Record<string, number> = {};
  const byUser: Record<string, number> = {};
  let firstAction = "";
  let lastAction = "";

  if (logs.length > 0) {
    firstAction = formatDate(logs[logs.length - 1].createdAt);
    lastAction = formatDate(logs[0].createdAt);

    logs.forEach((log) => {
      // Por ação
      byAction[log.action] = (byAction[log.action] || 0) + 1;

      // Por usuário
      const userName = log.userName || "Usuário desconhecido";
      byUser[userName] = (byUser[userName] || 0) + 1;
    });
  }

  return { byAction, byUser, firstAction, lastAction };
}

/**
 * Formata data para exibição
 */
function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Retorna label amigável para ação
 */
function getActionLabel(action: string): string {
  const labels: Record<string, string> = {
    created: "Contratação Criada",
    updated: "Contratação Atualizada",
    status_changed: "Status Alterado",
    document_generated: "Documento Gerado",
    document_downloaded: "Documento Baixado",
    quotation_added: "Cotação Adicionada",
    quotation_updated: "Cotação Atualizada",
    quotation_deleted: "Cotação Removida",
    package_generated: "Pacote Presencial Gerado",
    package_downloaded: "Pacote Presencial Baixado",
    checklist_updated: "Checklist Atualizado",
    published: "Publicado",
    cancelled: "Cancelado",
  };
  return labels[action] || action;
}

/**
 * Retorna label amigável para status
 */
function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Rascunho",
    pending_approval: "Aguardando Aprovação",
    approved: "Aprovado",
    published: "Publicado",
    in_execution: "Em Execução",
    completed: "Concluído",
    cancelled: "Cancelado",
  };
  return labels[status] || status;
}

/**
 * Formata detalhes do log
 */
function formatDetails(details: any): string {
  if (typeof details === "string") {
    return details;
  }

  if (typeof details === "object") {
    const entries = Object.entries(details);
    if (entries.length === 0) return "-";

    return entries
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
      .join(", ");
  }

  return JSON.stringify(details);
}

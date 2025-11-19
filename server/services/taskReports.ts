import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { getDb } from "../db";
import { tasks } from "../../drizzle/schema";
import ExcelJS from "exceljs";

/**
 * Gera relatório completo de tarefas em Excel
 */
export async function generateTasksExcelReport(filters?: {
  status?: string[];
  priority?: string[];
  assignedTo?: number;
  startDate?: Date;
  endDate?: Date;
  tags?: string[];
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // Buscar tarefas e aplicar filtros
  let allTasks = await db.select().from(tasks);
  
  // Aplicar filtros
  if (filters) {
    allTasks = allTasks.filter((task) => {
      // Filtro por status
      if (filters.status && filters.status.length > 0) {
        if (!filters.status.includes(task.status)) return false;
      }
      
      // Filtro por prioridade
      if (filters.priority && filters.priority.length > 0) {
        if (!filters.priority.includes(task.priority)) return false;
      }
      
      // Filtro por responsável
      if (filters.assignedTo) {
        if (task.assignedTo !== filters.assignedTo) return false;
      }
      
      // Filtro por período (data de criação)
      if (filters.startDate) {
        if (new Date(task.createdAt) < filters.startDate) return false;
      }
      if (filters.endDate) {
        if (new Date(task.createdAt) > filters.endDate) return false;
      }
      
      // Filtro por tags
      if (filters.tags && filters.tags.length > 0) {
        const taskTags = task.tags ? JSON.parse(task.tags) : [];
        const hasMatchingTag = filters.tags.some(tag => taskTags.includes(tag));
        if (!hasMatchingTag) return false;
      }
      
      return true;
    });
  }

  // Criar workbook
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Tarefas");

  // Definir colunas
  worksheet.columns = [
    { header: "ID", key: "id", width: 8 },
    { header: "Título", key: "title", width: 40 },
    { header: "Descrição", key: "description", width: 50 },
    { header: "Tipo", key: "type", width: 25 },
    { header: "Status", key: "status", width: 20 },
    { header: "Prioridade", key: "priority", width: 15 },
    { header: "Responsável (ID)", key: "assignedTo", width: 15 },
    { header: "Prazo", key: "deadline", width: 15 },
    { header: "Criado em", key: "createdAt", width: 15 },
    { header: "Atualizado em", key: "updatedAt", width: 15 },
  ];

  // Estilizar cabeçalho
  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFE0E0E0" },
  };

  // Mapear labels
  const statusLabels: Record<string, string> = {
    pendente: "Pendente",
    em_andamento: "Em Andamento",
    pausada: "Pausada",
    atrasada: "Atrasada",
    aguardando_informacao: "Aguardando Informação",
    concluida: "Concluída",
    cancelada: "Cancelada",
  };

  const priorityLabels: Record<string, string> = {
    baixa: "Baixa",
    media: "Média",
    alta: "Alta",
    urgente: "Urgente",
  };

  // Adicionar dados
  allTasks.forEach((task) => {
    const row = worksheet.addRow({
      id: task.id,
      title: task.title,
      description: task.description || "-",
      type: task.type,
      status: statusLabels[task.status] || task.status,
      priority: priorityLabels[task.priority] || task.priority,
      assignedTo: task.assignedTo,
      deadline: task.deadline ? format(new Date(task.deadline), "dd/MM/yyyy", { locale: ptBR }) : "-",
      createdAt: format(new Date(task.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR }),
      updatedAt: format(new Date(task.updatedAt), "dd/MM/yyyy HH:mm", { locale: ptBR }),
    });

    // Colorir linha baseado no status
    if (task.status === "concluida") {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0FFE0" }, // Verde claro
      };
    } else if (task.status === "atrasada") {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFFE0E0" }, // Vermelho claro
      };
    } else if (task.status === "cancelada") {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF0F0F0" }, // Cinza claro
      };
    }
  });

  // Gerar buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Gera relatório resumido de tarefas em formato Markdown (para PDF)
 */
export async function generateTasksPDFContent(filters?: {
  status?: string[];
  priority?: string[];
  assignedTo?: number;
  startDate?: Date;
  endDate?: Date;
  tags?: string[];
}) {
  const db = await getDb();
  if (!db) {
    throw new Error("Database not available");
  }

  // Buscar tarefas e aplicar filtros
  let allTasks = await db.select().from(tasks);
  
  // Aplicar filtros (mesma lógica do Excel)
  if (filters) {
    allTasks = allTasks.filter((task) => {
      if (filters.status && filters.status.length > 0 && !filters.status.includes(task.status)) return false;
      if (filters.priority && filters.priority.length > 0 && !filters.priority.includes(task.priority)) return false;
      if (filters.assignedTo && task.assignedTo !== filters.assignedTo) return false;
      if (filters.startDate && new Date(task.createdAt) < filters.startDate) return false;
      if (filters.endDate && new Date(task.createdAt) > filters.endDate) return false;
      if (filters.tags && filters.tags.length > 0) {
        const taskTags = task.tags ? JSON.parse(task.tags) : [];
        if (!filters.tags.some(tag => taskTags.includes(tag))) return false;
      }
      return true;
    });
  }

  // Mapear labels
  const statusLabels: Record<string, string> = {
    pendente: "Pendente",
    em_andamento: "Em Andamento",
    pausada: "Pausada",
    atrasada: "Atrasada",
    aguardando_informacao: "Aguardando Informação",
    concluida: "Concluída",
    cancelada: "Cancelada",
  };

  const priorityLabels: Record<string, string> = {
    baixa: "Baixa",
    media: "Média",
    alta: "Alta",
    urgente: "Urgente",
  };

  // Gerar Markdown
  let markdown = `
# Relatório de Tarefas do Departamento

**Data de Geração:** ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}

---

## Resumo Geral

- **Total de Tarefas:** ${allTasks.length}
- **Concluídas:** ${allTasks.filter(t => t.status === "concluida").length}
- **Em Andamento:** ${allTasks.filter(t => t.status === "em_andamento").length}
- **Atrasadas:** ${allTasks.filter(t => t.status === "atrasada").length}
- **Pendentes:** ${allTasks.filter(t => t.status === "pendente").length}

---

## Lista de Tarefas

| Título | Status | Prioridade | Prazo |
|--------|--------|------------|-------|
`;

  allTasks.forEach((task) => {
    const deadline = task.deadline 
      ? format(new Date(task.deadline), "dd/MM/yyyy", { locale: ptBR })
      : "-";
    
    markdown += `| ${task.title} | ${statusLabels[task.status]} | ${priorityLabels[task.priority]} | ${deadline} |\n`;
  });

  markdown += `\n---\n\n*Relatório gerado automaticamente pelo sistema LiciGov Pro*\n`;

  return markdown;
}

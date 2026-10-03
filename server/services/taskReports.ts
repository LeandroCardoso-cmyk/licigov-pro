import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { listTasksForOrganization } from "../db";
import ExcelJS from "exceljs";
import type { Task } from "../../drizzle/schema";
import {
  isTaskOverdue, taskDeadlineBucket, TASK_DEADLINE_BUCKET_LABELS, type TaskDeadlineBucket,
} from "@shared/taskDeadline";

export interface TaskReportFilters {
  status?: string[];
  priority?: string[];
  assignedTo?: number;
  startDate?: Date;
  endDate?: Date;
  tags?: string[];
}

/** Opções de geração (o relógio é injetável para testes determinísticos). */
export interface TaskReportOptions {
  now?: Date;
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/** Filtros do relatório (únicos para Excel e PDF — antes duplicados). */
export function filterTasksForReport<T extends Pick<Task, "status" | "priority" | "assignedTo" | "createdAt" | "tags">>(
  allTasks: T[], filters?: TaskReportFilters,
): T[] {
  if (!filters) return allTasks;
  return allTasks.filter((task) => {
    if (filters.status && filters.status.length > 0 && !filters.status.includes(task.status)) return false;
    if (filters.priority && filters.priority.length > 0 && !filters.priority.includes(task.priority)) return false;
    if (filters.assignedTo && task.assignedTo !== filters.assignedTo) return false;
    if (filters.startDate && new Date(task.createdAt) < filters.startDate) return false;
    if (filters.endDate && new Date(task.createdAt) > filters.endDate) return false;
    if (filters.tags && filters.tags.length > 0) {
      const taskTags = parseTags(task.tags);
      if (!filters.tags.some(tag => taskTags.includes(tag))) return false;
    }
    return true;
  });
}

/**
 * R9 / SEM-071 — resumo do relatório com a regra ÚNICA de "Atrasada" (`isTaskOverdue`): antes o PDF contava
 * só o status manual `atrasada` e o KPI contava o prazo vencido — números diferentes para a mesma pergunta.
 */
export function summarizeTasksForReport(allTasks: ReadonlyArray<Pick<Task, "status" | "deadline">>, now: Date) {
  return {
    total: allTasks.length,
    concluded: allTasks.filter(t => t.status === "concluida").length,
    inProgress: allTasks.filter(t => t.status === "em_andamento").length,
    overdue: allTasks.filter(t => isTaskOverdue(t, now)).length,
    pending: allTasks.filter(t => t.status === "pendente").length,
  };
}

/** R9 / SEM-071 — cor (ARGB) da célula "Situação do prazo" por faixa da regra documentada. */
export const DEADLINE_BUCKET_ARGB: Record<TaskDeadlineBucket, string | null> = {
  vermelho: "FFFFC7CE",
  laranja: "FFFFE0B2",
  amarelo: "FFFFF2CC",
  verde: "FFE2F0D9",
  sem_prazo: null,
  encerrada: null,
};

/**
 * Gera relatório completo de tarefas em Excel
 */
export async function generateTasksExcelReport(organizationId: number, filters?: TaskReportFilters, options: TaskReportOptions = {}) {
  const now = options.now ?? new Date();
  // Buscar tarefas da organização e aplicar filtros
  const allTasks = filterTasksForReport(await listTasksForOrganization(organizationId), filters);

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
    { header: "Situação do prazo", key: "deadlineSituation", width: 22 },
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
      deadlineSituation: TASK_DEADLINE_BUCKET_LABELS[taskDeadlineBucket(task, now)],
      createdAt: format(new Date(task.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR }),
      updatedAt: format(new Date(task.updatedAt), "dd/MM/yyyy HH:mm", { locale: ptBR }),
    });

    // R9 / SEM-071 — linha vermelha pela regra ÚNICA de "Atrasada" (antes: só o status manual `atrasada`).
    if (task.status === "concluida") {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0FFE0" }, // Verde claro
      };
    } else if (isTaskOverdue(task, now)) {
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
    const bucketColor = DEADLINE_BUCKET_ARGB[taskDeadlineBucket(task, now)];
    if (bucketColor) {
      row.getCell("deadlineSituation").fill = { type: "pattern", pattern: "solid", fgColor: { argb: bucketColor } };
    }
  });

  // Gerar buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Gera relatório resumido de tarefas em formato Markdown (para PDF)
 */
export async function generateTasksPDFContent(organizationId: number, filters?: TaskReportFilters, options: TaskReportOptions = {}) {
  const now = options.now ?? new Date();
  // Buscar tarefas da organização e aplicar filtros (mesma lógica do Excel)
  const allTasks = filterTasksForReport(await listTasksForOrganization(organizationId), filters);
  const summary = summarizeTasksForReport(allTasks, now);

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

**Data de Geração:** ${format(now, "dd/MM/yyyy HH:mm", { locale: ptBR })}

---

## Resumo Geral

- **Total de Tarefas:** ${summary.total}
- **Concluídas:** ${summary.concluded}
- **Em Andamento:** ${summary.inProgress}
- **Atrasadas:** ${summary.overdue} (prazo vencido ou marcadas como atrasadas; exclui concluídas e canceladas)
- **Pendentes:** ${summary.pending}

---

## Lista de Tarefas

| Título | Status | Prioridade | Prazo | Situação do prazo |
|--------|--------|------------|-------|-------------------|
`;

  allTasks.forEach((task) => {
    const deadline = task.deadline 
      ? format(new Date(task.deadline), "dd/MM/yyyy", { locale: ptBR })
      : "-";
    
    const situation = TASK_DEADLINE_BUCKET_LABELS[taskDeadlineBucket(task, now)];
    markdown += `| ${task.title} | ${statusLabels[task.status]} | ${priorityLabels[task.priority]} | ${deadline} | ${situation} |\n`;
  });

  markdown += `\n---\n\n*Relatório gerado automaticamente pelo sistema LiciGov Pro*\n`;

  return markdown;
}

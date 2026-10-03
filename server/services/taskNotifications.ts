import { getDb } from "../db";
import { tasks } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { and, lte, gte, eq, notInArray } from "drizzle-orm";
import { taskOverdueCondition } from "../db/tasks";
import { TASK_TERMINAL_STATUSES } from "@shared/taskDeadline";

/**
 * Verifica tarefas próximas do prazo e envia notificações
 * Alertas: 3 dias antes do prazo
 */
export async function checkTaskDeadlines(organizationId: number) {
  const db = await getDb();
  if (!db) {
    console.warn("[TaskNotifications] Database not available");
    return { success: false, notificationsSent: 0 };
  }

  const now = new Date();
  const threeDaysFromNow = new Date(now);
  threeDaysFromNow.setDate(now.getDate() + 3);
  threeDaysFromNow.setHours(23, 59, 59, 999);

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  try {
    // Buscar tarefas que vencem em 3 dias e ainda não estão concluídas
    const upcomingTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          gte(tasks.deadline, tomorrow),
          lte(tasks.deadline, threeDaysFromNow),
          notInArray(tasks.status, [...TASK_TERMINAL_STATUSES])
        )
      );

    let notificationsSent = 0;

    if (upcomingTasks.length > 0) {
      // Agrupar por dias restantes
      const tasksByDays: Record<number, typeof upcomingTasks> = {};

      upcomingTasks.forEach((task) => {
        if (!task.deadline) return;
        
        const daysUntilDeadline = Math.ceil(
          (new Date(task.deadline).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (!tasksByDays[daysUntilDeadline]) {
          tasksByDays[daysUntilDeadline] = [];
        }
        tasksByDays[daysUntilDeadline].push(task);
      });

      // Enviar notificação para cada grupo
      for (const [days, tasksGroup] of Object.entries(tasksByDays)) {
        const daysNum = parseInt(days);
        const title = daysNum === 1
          ? "⚠️ Tarefas vencem amanhã!"
          : `⏰ Tarefas vencem em ${daysNum} dias`;

        const taskList = tasksGroup
          .map((t) => `• ${t.title} (${t.priority})`)
          .join("\n");

        const content = `${tasksGroup.length} tarefa(s) do departamento de licitações:\n\n${taskList}`;

        const success = await notifyOwner({ title, content });
        if (success) {
          notificationsSent++;
        }
      }
    }

    // Buscar tarefas atrasadas (prazo já passou ou marcadas manualmente como atrasadas)
    const overdueTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          // R9 / SEM-071 — regra ÚNICA de "Atrasada" (shared/taskDeadline.ts), espelhada no banco.
          taskOverdueCondition(now)
        )
      );

    if (overdueTasks.length > 0) {
      const title = "🚨 Tarefas atrasadas!";
      const taskList = overdueTasks
        .map((t) => `• ${t.title} (${t.priority})`)
        .join("\n");

      const content = `${overdueTasks.length} tarefa(s) atrasada(s):\n\n${taskList}`;

      const success = await notifyOwner({ title, content });
      if (success) {
        notificationsSent++;
      }
    }

    return {
      success: true,
      notificationsSent,
      upcomingCount: upcomingTasks.length,
      overdueCount: overdueTasks.length,
    };
  } catch (error) {
    console.error("[TaskNotifications] Error checking deadlines:", error);
    return { success: false, notificationsSent: 0 };
  }
}

/**
 * Retorna resumo de tarefas por prazo
 */
export async function getTaskDeadlineSummary(organizationId: number) {
  const db = await getDb();
  if (!db) {
    return {
      upcoming3Days: 0,
      overdue: 0,
    };
  }

  const now = new Date();
  const threeDaysFromNow = new Date(now);
  threeDaysFromNow.setDate(now.getDate() + 3);
  threeDaysFromNow.setHours(23, 59, 59, 999);

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  try {
    const upcoming = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          gte(tasks.deadline, tomorrow),
          lte(tasks.deadline, threeDaysFromNow),
          notInArray(tasks.status, [...TASK_TERMINAL_STATUSES])
        )
      );

    const overdue = await db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.organizationId, organizationId),
          // R9 / SEM-071 — regra ÚNICA de "Atrasada" (shared/taskDeadline.ts), espelhada no banco.
          taskOverdueCondition(now)
        )
      );

    return {
      upcoming3Days: upcoming.length,
      overdue: overdue.length,
    };
  } catch (error) {
    console.error("[TaskNotifications] Error getting summary:", error);
    return {
      upcoming3Days: 0,
      overdue: 0,
    };
  }
}

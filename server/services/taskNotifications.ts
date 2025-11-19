import { getDb } from "../db";
import { tasks } from "../../drizzle/schema";
import { notifyOwner } from "../_core/notification";
import { and, lte, gte, eq, sql } from "drizzle-orm";

/**
 * Verifica tarefas próximas do prazo e envia notificações
 * Alertas: 3 dias antes do prazo
 */
export async function checkTaskDeadlines() {
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
          gte(tasks.deadline, tomorrow),
          lte(tasks.deadline, threeDaysFromNow),
          sql`${tasks.status} NOT IN ('concluida', 'cancelada')`
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

    // Buscar tarefas atrasadas (prazo já passou)
    const overdueTasks = await db
      .select()
      .from(tasks)
      .where(
        and(
          lte(tasks.deadline, now),
          sql`${tasks.status} NOT IN ('concluida', 'cancelada')`
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
export async function getTaskDeadlineSummary() {
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
          gte(tasks.deadline, tomorrow),
          lte(tasks.deadline, threeDaysFromNow),
          sql`${tasks.status} NOT IN ('concluida', 'cancelada')`
        )
      );

    const overdue = await db
      .select()
      .from(tasks)
      .where(
        and(
          lte(tasks.deadline, now),
          sql`${tasks.status} NOT IN ('concluida', 'cancelada')`
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

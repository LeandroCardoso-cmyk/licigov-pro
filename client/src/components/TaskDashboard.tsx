import { useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { TaskKPIGrid } from "@/components/task-dashboard/TaskKPIGrid";
import { TaskChartsSection, PRIORITY_COLORS, STATUS_COLORS } from "@/components/task-dashboard/TaskChartsSection";

export default function TaskDashboard() {
  const { data: tasks = [], isLoading } = trpc.departmentTasks.list.useQuery();

  const kpis = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter(t => t.status === "concluida").length;
    const inProgress = tasks.filter(t => t.status === "em_andamento").length;
    const delayed = tasks.filter(t => {
      if (t.status === "concluida" || t.status === "cancelada") return false;
      if (!t.deadline) return false;
      return new Date(t.deadline) < new Date();
    }).length;
    return { total, completed, inProgress, delayed };
  }, [tasks]);

  const statusData = useMemo(() => {
    const statusCount: Record<string, number> = {};
    tasks.forEach(task => {
      statusCount[task.status] = (statusCount[task.status] || 0) + 1;
    });
    const statusLabels: Record<string, string> = {
      pending: "Pendente", in_progress: "Em Andamento", paused: "Pausada",
      delayed: "Atrasada", awaiting_info: "Aguardando Info", completed: "Concluída", cancelled: "Cancelada",
    };
    return Object.entries(statusCount).map(([status, count]) => ({
      name: statusLabels[status] || status,
      value: count,
      color: STATUS_COLORS[status as keyof typeof STATUS_COLORS] || "#94a3b8",
    }));
  }, [tasks]);

  const priorityData = useMemo(() => {
    const priorityCount: Record<string, number> = {};
    tasks.forEach(task => {
      priorityCount[task.priority] = (priorityCount[task.priority] || 0) + 1;
    });
    const priorityLabels: Record<string, string> = {
      low: "Baixa", medium: "Média", high: "Alta", urgent: "Urgente",
    };
    return Object.entries(priorityCount).map(([priority, count]) => ({
      name: priorityLabels[priority] || priority,
      value: count,
      color: PRIORITY_COLORS[priority as keyof typeof PRIORITY_COLORS] || "#94a3b8",
    }));
  }, [tasks]);

  const typeData = useMemo(() => {
    const typeCount: Record<string, number> = {};
    tasks.forEach(task => {
      if (task.type) typeCount[task.type] = (typeCount[task.type] || 0) + 1;
    });
    return Object.entries(typeCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => ({
        name: type.length > 25 ? type.substring(0, 25) + "..." : type,
        count,
      }));
  }, [tasks]);

  const monthlyData = useMemo(() => {
    const months: Record<string, { created: number; completed: number }> = {};
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      months[key] = { created: 0, completed: 0 };
    }
    tasks.forEach(task => {
      const createdDate = new Date(task.createdAt);
      const createdKey = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, "0")}`;
      if (months[createdKey] !== undefined) months[createdKey].created++;
      if (task.status === "concluida" && task.updatedAt) {
        const completedDate = new Date(task.updatedAt);
        const completedKey = `${completedDate.getFullYear()}-${String(completedDate.getMonth() + 1).padStart(2, "0")}`;
        if (months[completedKey] !== undefined) months[completedKey].completed++;
      }
    });
    const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    return Object.entries(months).map(([key, data]) => {
      const monthIndex = parseInt(key.split("-")[1]) - 1;
      return { month: monthNames[monthIndex], criadas: data.created, "concluídas": data.completed };
    });
  }, [tasks]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Carregando dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <TaskKPIGrid
        total={kpis.total}
        completed={kpis.completed}
        inProgress={kpis.inProgress}
        delayed={kpis.delayed}
      />
      <TaskChartsSection
        statusData={statusData}
        priorityData={priorityData}
        typeData={typeData}
        monthlyData={monthlyData}
      />
    </div>
  );
}

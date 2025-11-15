import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { 
  BarChart, Bar, PieChart, Pie, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
} from "recharts";
import { 
  CheckCircle2, Clock, AlertCircle, ListTodo,
  TrendingUp, Calendar
} from "lucide-react";

const PRIORITY_COLORS = {
  low: "#94a3b8",      // slate-400
  medium: "#3b82f6",   // blue-500
  high: "#f97316",     // orange-500
  urgent: "#ef4444",   // red-500
};

const STATUS_COLORS = {
  pending: "#94a3b8",
  in_progress: "#3b82f6",
  paused: "#eab308",
  delayed: "#ef4444",
  awaiting_info: "#8b5cf6",
  completed: "#22c55e",
  cancelled: "#64748b",
};

export default function TaskDashboard() {
  const { data: tasks = [], isLoading } = trpc.departmentTasks.list.useQuery();

  // Calcular KPIs
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

  // Dados para gráfico de pizza - Status
  const statusData = useMemo(() => {
    const statusCount: Record<string, number> = {};
    tasks.forEach(task => {
      statusCount[task.status] = (statusCount[task.status] || 0) + 1;
    });

    const statusLabels: Record<string, string> = {
      pending: "Pendente",
      in_progress: "Em Andamento",
      paused: "Pausada",
      delayed: "Atrasada",
      awaiting_info: "Aguardando Info",
      completed: "Concluída",
      cancelled: "Cancelada",
    };

    return Object.entries(statusCount).map(([status, count]) => ({
      name: statusLabels[status] || status,
      value: count,
      color: STATUS_COLORS[status as keyof typeof STATUS_COLORS] || "#94a3b8",
    }));
  }, [tasks]);

  // Dados para gráfico de pizza - Prioridade
  const priorityData = useMemo(() => {
    const priorityCount: Record<string, number> = {};
    tasks.forEach(task => {
      priorityCount[task.priority] = (priorityCount[task.priority] || 0) + 1;
    });

    const priorityLabels: Record<string, string> = {
      low: "Baixa",
      medium: "Média",
      high: "Alta",
      urgent: "Urgente",
    };

    return Object.entries(priorityCount).map(([priority, count]) => ({
      name: priorityLabels[priority] || priority,
      value: count,
      color: PRIORITY_COLORS[priority as keyof typeof PRIORITY_COLORS] || "#94a3b8",
    }));
  }, [tasks]);

  // Dados para gráfico de barras - Top 5 tipos
  const typeData = useMemo(() => {
    const typeCount: Record<string, number> = {};
    tasks.forEach(task => {
      if (task.type) {
        typeCount[task.type] = (typeCount[task.type] || 0) + 1;
      }
    });

    return Object.entries(typeCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => ({
        name: type.length > 25 ? type.substring(0, 25) + "..." : type,
        count,
      }));
  }, [tasks]);

  // Dados para gráfico de linha - Evolução mensal (últimos 6 meses)
  const monthlyData = useMemo(() => {
    const months: Record<string, { created: number; completed: number }> = {};
    const now = new Date();

    // Inicializar últimos 6 meses
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      months[key] = { created: 0, completed: 0 };
    }

    // Contar tarefas criadas e concluídas por mês
    tasks.forEach(task => {
      const createdDate = new Date(task.createdAt);
      const createdKey = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, "0")}`;
      if (months[createdKey] !== undefined) {
        months[createdKey].created++;
      }

      if (task.status === "concluida" && task.updatedAt) {
        const completedDate = new Date(task.updatedAt);
        const completedKey = `${completedDate.getFullYear()}-${String(completedDate.getMonth() + 1).padStart(2, "0")}`;
        if (months[completedKey] !== undefined) {
          months[completedKey].completed++;
        }
      }
    });

    const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

    return Object.entries(months).map(([key, data]) => {
      const [year, month] = key.split("-");
      const monthIndex = parseInt(month) - 1;
      return {
        month: monthNames[monthIndex],
        criadas: data.created,
        concluídas: data.completed,
      };
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
      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Tarefas</CardTitle>
            <ListTodo className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">{kpis.total}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Todas as tarefas cadastradas
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Concluídas</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{kpis.completed}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {kpis.total > 0 ? Math.round((kpis.completed / kpis.total) * 100) : 0}% do total
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Em Andamento</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{kpis.inProgress}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Tarefas em execução
            </p>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow cursor-pointer">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Atrasadas</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{kpis.delayed}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Prazo vencido
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos - Linha 1 */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Gráfico de Pizza - Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribuição por Status</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Gráfico de Pizza - Prioridade */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribuição por Prioridade</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={priorityData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {priorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos - Linha 2 */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Gráfico de Barras - Top 5 Tipos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top 5 Tipos de Tarefas</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={typeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Gráfico de Linha - Evolução Mensal */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Evolução Mensal (Últimos 6 Meses)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="criadas" stroke="#3b82f6" strokeWidth={2} />
                <Line type="monotone" dataKey="concluídas" stroke="#22c55e" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, DollarSign, TrendingUp, Activity } from "lucide-react";
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface DashboardMetricsProps {
  totalProcesses: number;
  totalValue: number;
  processesByStatus: Record<string, number>;
  processesByModality: Record<string, number>;
}

const statusLabels: Record<string, string> = {
  em_etp: "Em ETP",
  em_tr: "Em TR",
  em_dfd: "Em DFD",
  em_edital: "Em Edital",
  concluido: "Concluído",
};

const COLORS = ["#3b82f6", "#eab308", "#f97316", "#a855f7", "#22c55e"];

export function DashboardMetrics({
  totalProcesses,
  totalValue,
  processesByStatus,
  processesByModality,
}: DashboardMetricsProps) {
  // Preparar dados para gráfico de status
  const statusData = Object.entries(processesByStatus).map(([status, count]) => ({
    name: statusLabels[status] || status,
    value: count,
  }));

  // Preparar dados para gráfico de modalidade
  const modalityData = Object.entries(processesByModality).map(([modality, count]) => ({
    name: modality,
    count,
  }));

  return (
    <div className="space-y-6">
      {/* Cards de Estatísticas */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Processos</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProcesses}</div>
            <p className="text-xs text-muted-foreground">
              Processos cadastrados
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor Total</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
                minimumFractionDigits: 0,
              }).format(totalValue / 100)}
            </div>
            <p className="text-xs text-muted-foreground">
              Valor estimado total
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Em Andamento</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {(processesByStatus.em_etp || 0) +
                (processesByStatus.em_tr || 0) +
                (processesByStatus.em_dfd || 0) +
                (processesByStatus.em_edital || 0)}
            </div>
            <p className="text-xs text-muted-foreground">
              Processos ativos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Concluídos</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {processesByStatus.concluido || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {totalProcesses > 0
                ? `${Math.round(((processesByStatus.concluido || 0) / totalProcesses) * 100)}% do total`
                : "0% do total"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Gráfico de Pizza - Status */}
        <Card>
          <CardHeader>
            <CardTitle>Distribuição por Status</CardTitle>
          </CardHeader>
          <CardContent>
            {statusData.length > 0 ? (
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
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                Nenhum dado disponível
              </div>
            )}
          </CardContent>
        </Card>

        {/* Gráfico de Barras - Modalidade */}
        <Card>
          <CardHeader>
            <CardTitle>Processos por Modalidade</CardTitle>
          </CardHeader>
          <CardContent>
            {modalityData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={modalityData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                Nenhum dado disponível
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

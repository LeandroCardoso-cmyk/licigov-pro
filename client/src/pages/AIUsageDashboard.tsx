import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Download, TrendingUp, DollarSign, Activity, Sparkles } from "lucide-react";
import { BackToDashboard } from "@/components/BackToDashboard";
import { toast } from "sonner";

const OPERATION_LABELS = {
  embedding: "Embeddings",
  rag_query: "Consultas RAG",
  catmat_matching: "Matching CATMAT",
  document_generation: "Geração de Documentos",
};

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

export default function AIUsageDashboard() {
  const [period, setPeriod] = useState<"today" | "week" | "month" | "all">("month");
  const [operationFilter, setOperationFilter] = useState<string>("all");

  // Calcular datas baseado no período
  const { startDate, endDate } = useMemo(() => {
    const end = new Date();
    let start = new Date();

    switch (period) {
      case "today":
        start.setHours(0, 0, 0, 0);
        break;
      case "week":
        start.setDate(start.getDate() - 7);
        break;
      case "month":
        start.setDate(start.getDate() - 30);
        break;
      case "all":
        start = new Date(2024, 0, 1); // 1º de janeiro de 2024
        break;
    }

    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    };
  }, [period]);

  // Buscar estatísticas
  const { data: stats, isLoading: statsLoading } = trpc.aiUsage.getStats.useQuery({
    startDate,
    endDate,
    operationType: operationFilter !== "all" ? (operationFilter as any) : undefined,
  });

  // Buscar histórico
  const { data: history, isLoading: historyLoading } = trpc.aiUsage.getHistory.useQuery({
    startDate,
    endDate,
    operationType: operationFilter !== "all" ? (operationFilter as any) : undefined,
    limit: 50,
  });

  // Exportar CSV
  const exportCSVMutation = trpc.aiUsage.exportCSV.useQuery(
    {
      startDate,
      endDate,
      operationType: operationFilter !== "all" ? (operationFilter as any) : undefined,
    },
    { enabled: false }
  );

  const handleExportCSV = async () => {
    try {
      const result = await exportCSVMutation.refetch();
      if (result.data) {
        const blob = new Blob([result.data.content], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.data.filename;
        a.click();
        URL.revokeObjectURL(url);
        toast.success("CSV exportado com sucesso!");
      }
    } catch (error) {
      toast.error("Erro ao exportar CSV");
    }
  };

  // Preparar dados para gráfico de linha (evolução)
  const lineChartData = useMemo(() => {
    if (!stats?.byDay) return [];
    return stats.byDay.map((day) => ({
      date: new Date(day.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
      custo: parseFloat(day.cost.toFixed(4)),
      operacoes: day.operations,
    }));
  }, [stats]);

  // Preparar dados para gráfico de pizza (distribuição)
  const pieChartData = useMemo(() => {
    if (!stats?.byOperationType) return [];
    return Object.entries(stats.byOperationType).map(([type, data]) => ({
      name: OPERATION_LABELS[type as keyof typeof OPERATION_LABELS] || type,
      value: data.cost,
      count: data.count,
    }));
  }, [stats]);

  // Calcular custo hoje
  const todayCost = useMemo(() => {
    if (!stats?.byDay || stats.byDay.length === 0) return 0;
    const today = new Date().toISOString().split("T")[0];
    const todayData = stats.byDay.find((d) => d.date === today);
    return todayData?.cost || 0;
  }, [stats]);

  // Calcular custo estimado mensal
  const estimatedMonthlyCost = useMemo(() => {
    if (!stats?.byDay || stats.byDay.length === 0 || period !== "month") return 0;
    const avgDailyCost = stats.totalCost / stats.byDay.length;
    return avgDailyCost * 30;
  }, [stats, period]);

  if (statsLoading) {
    return (
      <div className="container py-8">
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <Activity className="h-12 w-12 animate-spin mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Carregando dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard de Custos de IA</h1>
          <p className="text-muted-foreground mt-1">
            Monitore os custos operacionais de Inteligência Artificial do LiciGov Pro
          </p>
        </div>
        <Button onClick={handleExportCSV} className="gap-2">
          <Download className="h-4 w-4" />
          Exportar CSV
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex gap-4">
        <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="week">Últimos 7 dias</SelectItem>
            <SelectItem value="month">Últimos 30 dias</SelectItem>
            <SelectItem value="all">Todo o período</SelectItem>
          </SelectContent>
        </Select>

        <Select value={operationFilter} onValueChange={setOperationFilter}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as operações</SelectItem>
            <SelectItem value="embedding">Embeddings</SelectItem>
            <SelectItem value="rag_query">Consultas RAG</SelectItem>
            <SelectItem value="catmat_matching">Matching CATMAT</SelectItem>
            <SelectItem value="document_generation">Geração de Documentos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Cards de Métricas */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Custo Hoje</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              US$ {todayCost.toFixed(4)}
            </div>
            <p className="text-xs text-muted-foreground">
              ~R$ {(todayCost * 5.5).toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Custo no Período</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              US$ {stats?.totalCost.toFixed(4) || "0.0000"}
            </div>
            <p className="text-xs text-muted-foreground">
              ~R$ {((stats?.totalCost || 0) * 5.5).toFixed(2)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Operações</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats?.totalOperations || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats?.totalInputTokens.toLocaleString() || 0} tokens entrada
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Estimativa Mensal</CardTitle>
            <Sparkles className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              US$ {estimatedMonthlyCost.toFixed(2)}
            </div>
            <p className="text-xs text-muted-foreground">
              ~R$ {(estimatedMonthlyCost * 5.5).toFixed(2)}/mês
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Gráfico de Evolução */}
        <Card>
          <CardHeader>
            <CardTitle>Evolução de Custos</CardTitle>
            <CardDescription>Custo diário em USD</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={lineChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip
                  formatter={(value: any, name: string) => {
                    if (name === "custo") return [`US$ ${value}`, "Custo"];
                    return [value, "Operações"];
                  }}
                />
                <Legend />
                <Line type="monotone" dataKey="custo" stroke="#3b82f6" strokeWidth={2} name="Custo (USD)" />
                <Line type="monotone" dataKey="operacoes" stroke="#10b981" strokeWidth={2} name="Operações" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Gráfico de Distribuição */}
        <Card>
          <CardHeader>
            <CardTitle>Distribuição por Tipo</CardTitle>
            <CardDescription>Custo por tipo de operação</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={pieChartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: US$ ${entry.value.toFixed(4)}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {pieChartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: any) => `US$ ${value.toFixed(4)}`}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tabela de Histórico */}
      <Card>
        <CardHeader>
          <CardTitle>Histórico de Operações</CardTitle>
          <CardDescription>Últimas 50 operações de IA</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data/Hora</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead className="text-right">Tokens Entrada</TableHead>
                  <TableHead className="text-right">Tokens Saída</TableHead>
                  <TableHead className="text-right">Custo (USD)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Carregando histórico...
                    </TableCell>
                  </TableRow>
                ) : history && history.length > 0 ? (
                  history.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-mono text-sm">
                        {new Date(record.createdAt).toLocaleString("pt-BR")}
                      </TableCell>
                      <TableCell>
                        {OPERATION_LABELS[record.operationType as keyof typeof OPERATION_LABELS] || record.operationType}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{record.model}</TableCell>
                      <TableCell className="text-right">{record.inputTokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{record.outputTokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">
                        US$ {parseFloat(record.estimatedCostUSD as string).toFixed(6)}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Nenhuma operação registrada no período
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

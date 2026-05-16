import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Download, Activity } from "lucide-react";
import { BackToDashboard } from "@/components/BackToDashboard";
import { toast } from "sonner";
import { AIMetricsGrid } from "@/components/ai-usage/AIMetricsGrid";
import { AIChartsSection } from "@/components/ai-usage/AIChartsSection";
import { AIHistoryTable } from "@/components/ai-usage/AIHistoryTable";

const OPERATION_LABELS: Record<string, string> = {
  embedding: "Embeddings",
  rag_query: "Consultas RAG",
  catmat_matching: "Matching CATMAT",
  document_generation: "Geração de Documentos",
};

export default function AIUsageDashboard() {
  const [period, setPeriod] = useState<"today" | "week" | "month" | "all">("month");
  const [operationFilter, setOperationFilter] = useState("all");

  const { startDate, endDate } = useMemo(() => {
    const end = new Date();
    let start = new Date();
    switch (period) {
      case "today": start.setHours(0, 0, 0, 0); break;
      case "week": start.setDate(start.getDate() - 7); break;
      case "month": start.setDate(start.getDate() - 30); break;
      case "all": start = new Date(2024, 0, 1); break;
    }
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }, [period]);

  const queryParams = {
    startDate,
    endDate,
    operationType: operationFilter !== "all" ? (operationFilter as any) : undefined,
  };

  const { data: stats, isLoading: statsLoading } = trpc.aiUsage.getStats.useQuery(queryParams);
  const { data: history, isLoading: historyLoading } = trpc.aiUsage.getHistory.useQuery({ ...queryParams, limit: 50 });
  const exportCSVQuery = trpc.aiUsage.exportCSV.useQuery(queryParams, { enabled: false });

  const handleExportCSV = async () => {
    try {
      const result = await exportCSVQuery.refetch();
      if (result.data) {
        const blob = new Blob([result.data.content], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), { href: url, download: result.data.filename });
        a.click();
        URL.revokeObjectURL(url);
        toast.success("CSV exportado com sucesso!");
      }
    } catch {
      toast.error("Erro ao exportar CSV");
    }
  };

  const lineChartData = useMemo(() => {
    if (!stats?.byDay) return [];
    return stats.byDay.map((day) => ({
      date: new Date(day.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }),
      custo: parseFloat(day.cost.toFixed(4)),
      operacoes: day.operations,
    }));
  }, [stats]);

  const pieChartData = useMemo(() => {
    if (!stats?.byOperationType) return [];
    return Object.entries(stats.byOperationType).map(([type, data]) => ({
      name: OPERATION_LABELS[type] ?? type,
      value: data.cost,
      count: data.count,
    }));
  }, [stats]);

  const todayCost = useMemo(() => {
    if (!stats?.byDay?.length) return 0;
    const today = new Date().toISOString().split("T")[0];
    return stats.byDay.find((d) => d.date === today)?.cost ?? 0;
  }, [stats]);

  const estimatedMonthlyCost = useMemo(() => {
    if (!stats?.byDay?.length || period !== "month") return 0;
    return (stats.totalCost / stats.byDay.length) * 30;
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard de Custos de IA</h1>
          <p className="text-muted-foreground mt-1">Monitore os custos operacionais de Inteligência Artificial do LiciGov Pro</p>
        </div>
        <Button onClick={handleExportCSV} className="gap-2">
          <Download className="h-4 w-4" />Exportar CSV
        </Button>
      </div>

      <div className="flex gap-4">
        <Select value={period} onValueChange={(v) => setPeriod(v as any)}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Hoje</SelectItem>
            <SelectItem value="week">Últimos 7 dias</SelectItem>
            <SelectItem value="month">Últimos 30 dias</SelectItem>
            <SelectItem value="all">Todo o período</SelectItem>
          </SelectContent>
        </Select>

        <Select value={operationFilter} onValueChange={setOperationFilter}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as operações</SelectItem>
            <SelectItem value="embedding">Embeddings</SelectItem>
            <SelectItem value="rag_query">Consultas RAG</SelectItem>
            <SelectItem value="catmat_matching">Matching CATMAT</SelectItem>
            <SelectItem value="document_generation">Geração de Documentos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <AIMetricsGrid
        todayCost={todayCost}
        totalCost={stats?.totalCost ?? 0}
        totalOperations={stats?.totalOperations ?? 0}
        totalInputTokens={stats?.totalInputTokens ?? 0}
        estimatedMonthlyCost={estimatedMonthlyCost}
      />

      <AIChartsSection lineChartData={lineChartData} pieChartData={pieChartData} />

      <AIHistoryTable history={history} isLoading={historyLoading} />
    </div>
  );
}

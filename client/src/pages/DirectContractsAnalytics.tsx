import { trpc } from "@/lib/trpc";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { MetricsGrid } from "@/components/direct-contracts-analytics/MetricsGrid";
import { ChartsSection } from "@/components/direct-contracts-analytics/ChartsSection";
import { RankingTables } from "@/components/direct-contracts-analytics/RankingTables";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  pending_approval: "Aguardando Aprovação",
  approved: "Aprovado",
  published: "Publicado",
  in_execution: "Em Execução",
  completed: "Concluído",
  cancelled: "Cancelado",
};

export default function DirectContractsAnalytics() {
  const { data: overview, isLoading: loadingOverview } = trpc.directContracts.analytics.getOverview.useQuery();
  const { data: charts, isLoading: loadingCharts } = trpc.directContracts.analytics.getCharts.useQuery();
  const { data: topSuppliers, isLoading: loadingSuppliers } = trpc.directContracts.analytics.getTopSuppliers.useQuery();
  const { data: topArticles, isLoading: loadingArticles } = trpc.directContracts.analytics.getTopArticles.useQuery();

  const monthlyData = charts?.monthly || [];
  const monthlyGrouped: Record<string, any> = {};
  monthlyData.forEach((item) => {
    if (!monthlyGrouped[item.month]) monthlyGrouped[item.month] = { month: item.month, dispensa: 0, inexigibilidade: 0 };
    if (item.type === "dispensa") monthlyGrouped[item.month].dispensa = item.count;
    else monthlyGrouped[item.month].inexigibilidade = item.count;
  });

  const monthlyChartData = Object.values(monthlyGrouped).map((item: any) => ({
    ...item,
    monthLabel: format(new Date(item.month + "-01"), "MMM/yy", { locale: ptBR }),
  }));

  const platformData = (charts?.byPlatform || []).map((item) => ({
    name: item.platformName || "Sem plataforma",
    value: Number(item.totalValue),
    count: item.count,
  }));

  const statusData = (charts?.byStatus || []).map((item) => ({
    name: STATUS_LABELS[item.status] || item.status,
    value: item.count,
  }));

  if (loadingOverview || loadingCharts) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-600">Carregando estatísticas...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Analytics - Contratações Diretas</h1>
        <p className="text-gray-600 mt-2">Visão geral e estatísticas detalhadas das contratações diretas</p>
      </div>

      <MetricsGrid overview={overview} />
      <ChartsSection monthlyChartData={monthlyChartData} platformData={platformData} statusData={statusData} />
      <RankingTables
        topSuppliers={topSuppliers}
        topArticles={topArticles}
        loadingSuppliers={loadingSuppliers}
        loadingArticles={loadingArticles}
      />
    </div>
  );
}

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  DollarSign,
  Clock,
  CheckCircle,
  FileText,
  Users,
  Scale,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Página de Analytics e Estatísticas de Contratações Diretas
 */
export default function DirectContractsAnalytics() {
  // Queries
  const { data: overview, isLoading: loadingOverview } = trpc.directContracts.analytics.getOverview.useQuery();
  const { data: charts, isLoading: loadingCharts } = trpc.directContracts.analytics.getCharts.useQuery();
  const { data: topSuppliers, isLoading: loadingSuppliers } = trpc.directContracts.analytics.getTopSuppliers.useQuery();
  const { data: topArticles, isLoading: loadingArticles } = trpc.directContracts.analytics.getTopArticles.useQuery();

  // Cores para gráficos
  const COLORS = {
    dispensa: "#3b82f6", // blue
    inexigibilidade: "#8b5cf6", // purple
    draft: "#94a3b8", // gray
    approved: "#10b981", // green
    published: "#06b6d4", // cyan
    completed: "#22c55e", // green
    cancelled: "#ef4444", // red
  };

  const PIE_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ef4444", "#06b6d4"];

  // Preparar dados mensais para gráfico de linhas
  const monthlyData = charts?.monthly || [];
  const monthlyGrouped: Record<string, any> = {};
  
  monthlyData.forEach((item) => {
    if (!monthlyGrouped[item.month]) {
      monthlyGrouped[item.month] = { month: item.month, dispensa: 0, inexigibilidade: 0 };
    }
    if (item.type === "dispensa") {
      monthlyGrouped[item.month].dispensa = item.count;
    } else {
      monthlyGrouped[item.month].inexigibilidade = item.count;
    }
  });

  const monthlyChartData = Object.values(monthlyGrouped).map((item: any) => ({
    ...item,
    monthLabel: format(new Date(item.month + "-01"), "MMM/yy", { locale: ptBR }),
  }));

  // Preparar dados de plataforma para gráfico de barras
  const platformData = (charts?.byPlatform || []).map((item) => ({
    name: item.platformName || "Sem plataforma",
    value: Number(item.totalValue),
    count: item.count,
  }));

  // Preparar dados de status para gráfico de pizza
  const statusData = (charts?.byStatus || []).map((item) => ({
    name: getStatusLabel(item.status),
    value: item.count,
  }));

  // Loading state
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
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Analytics - Contratações Diretas</h1>
        <p className="text-gray-600 mt-2">
          Visão geral e estatísticas detalhadas das contratações diretas
        </p>
      </div>

      {/* Cards de Métricas Principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Total de Contratações */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total de Contratações</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overview?.total || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {overview?.byType?.find((t) => t.type === "dispensa")?.count || 0} dispensas,{" "}
              {overview?.byType?.find((t) => t.type === "inexigibilidade")?.count || 0} inexigibilidades
            </p>
          </CardContent>
        </Card>

        {/* Valor Total */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Valor Total Contratado</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
              }).format(overview?.totalValue || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Soma de todas as contratações
            </p>
          </CardContent>
        </Card>

        {/* Tempo Médio */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tempo Médio de Conclusão</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overview?.avgCompletionTime || 0} dias</div>
            <p className="text-xs text-muted-foreground mt-1">
              Média das contratações concluídas
            </p>
          </CardContent>
        </Card>

        {/* Taxa de Aprovação */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Taxa de Aprovação</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{overview?.approvalRate || 0}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              Contratações aprovadas / total
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Gráfico de Linhas - Dispensas vs Inexigibilidades */}
        <Card>
          <CardHeader>
            <CardTitle>Dispensas vs Inexigibilidades</CardTitle>
            <CardDescription>Evolução mensal nos últimos 12 meses</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="monthLabel" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="dispensa"
                  name="Dispensas"
                  stroke={COLORS.dispensa}
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="inexigibilidade"
                  name="Inexigibilidades"
                  stroke={COLORS.inexigibilidade}
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Gráfico de Barras - Valor por Plataforma */}
        <Card>
          <CardHeader>
            <CardTitle>Valor Total por Plataforma</CardTitle>
            <CardDescription>Distribuição de valores contratados</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={platformData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip
                  formatter={(value: number) =>
                    new Intl.NumberFormat("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                    }).format(value)
                  }
                />
                <Legend />
                <Bar dataKey="value" name="Valor Total" fill={COLORS.dispensa} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Gráfico de Pizza - Status */}
        <Card>
          <CardHeader>
            <CardTitle>Distribuição por Status</CardTitle>
            <CardDescription>Status atual das contratações</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(entry) => `${entry.name}: ${entry.value}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Gráfico de Área - Evolução Mensal */}
        <Card>
          <CardHeader>
            <CardTitle>Evolução Mensal</CardTitle>
            <CardDescription>Total de contratações por mês</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart
                data={monthlyChartData.map((item) => ({
                  ...item,
                  total: item.dispensa + item.inexigibilidade,
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="monthLabel" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Total"
                  stroke={COLORS.dispensa}
                  fill={COLORS.dispensa}
                  fillOpacity={0.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Tabelas de Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top 5 Fornecedores */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              <CardTitle>Top 5 Fornecedores</CardTitle>
            </div>
            <CardDescription>Fornecedores mais contratados</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingSuppliers ? (
              <p className="text-center text-gray-600">Carregando...</p>
            ) : topSuppliers && topSuppliers.length > 0 ? (
              <div className="space-y-4">
                {topSuppliers.map((supplier, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="font-medium">{supplier.supplierName}</p>
                      <p className="text-sm text-gray-600">{supplier.supplierCNPJ || "CNPJ não informado"}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">
                        {new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(Number(supplier.totalValue))}
                      </p>
                      <p className="text-sm text-gray-600">{supplier.count} contratações</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-gray-600">Nenhum fornecedor encontrado</p>
            )}
          </CardContent>
        </Card>

        {/* Top 5 Artigos Legais */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              <CardTitle>Top 5 Artigos Legais</CardTitle>
            </div>
            <CardDescription>Artigos mais utilizados</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingArticles ? (
              <p className="text-center text-gray-600">Carregando...</p>
            ) : topArticles && topArticles.length > 0 ? (
              <div className="space-y-4">
                {topArticles.map((article, index) => (
                  <div key={index} className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-medium">{article.articleNumber}</p>
                      <p className="text-sm text-gray-600 line-clamp-2">
                        {article.articleDescription}
                      </p>
                    </div>
                    <div className="text-right ml-4">
                      <p className="font-semibold">{article.count}</p>
                      <p className="text-sm text-gray-600">usos</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-gray-600">Nenhum artigo encontrado</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/**
 * Retorna label amigável para status
 */
function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Rascunho",
    pending_approval: "Aguardando Aprovação",
    approved: "Aprovado",
    published: "Publicado",
    in_execution: "Em Execução",
    completed: "Concluído",
    cancelled: "Cancelado",
  };
  return labels[status] || status;
}

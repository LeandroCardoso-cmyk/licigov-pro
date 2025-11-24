import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, FileText, TrendingUp, Activity } from "lucide-react";
import { BackToDashboard } from "@/components/BackToDashboard";
import { Badge } from "@/components/ui/badge";

const statusLabels: Record<string, string> = {
  em_etp: "Em ETP",
  em_tr: "Em TR",
  em_dfd: "Em DFD",
  em_edital: "Em Edital",
  concluido: "Concluído",
};

const statusColors: Record<string, string> = {
  em_etp: "bg-blue-500/10 text-blue-500",
  em_tr: "bg-purple-500/10 text-purple-500",
  em_dfd: "bg-orange-500/10 text-orange-500",
  em_edital: "bg-green-500/10 text-green-500",
  concluido: "bg-gray-500/10 text-gray-500",
};

export default function Analytics() {
  const { data: analytics, isLoading } = trpc.analytics.getOverview.useQuery();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Erro ao carregar analytics</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Analytics</h1>
          <p className="text-muted-foreground">
            Visualize métricas de produtividade e atividade do sistema
          </p>
        </div>

        {/* Cards de Resumo */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Usuários</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.totalUsers}</div>
              <p className="text-xs text-muted-foreground">Usuários cadastrados no sistema</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total de Processos</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analytics.totalProcesses}</div>
              <p className="text-xs text-muted-foreground">Processos licitatórios criados</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Documentos Gerados</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {analytics.documentsByMonth.reduce((sum, item) => sum + item.count, 0)}
              </div>
              <p className="text-xs text-muted-foreground">Últimos 6 meses</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Processos por Status */}
          <Card>
            <CardHeader>
              <CardTitle>Processos por Status</CardTitle>
              <CardDescription>Distribuição dos processos por estágio</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analytics.processesByStatus.map((item) => (
                  <div key={item.status} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Badge className={statusColors[item.status] || "bg-gray-500/10 text-gray-500"}>
                        {statusLabels[item.status] || item.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium">{item.count}</div>
                      <div className="text-xs text-muted-foreground">
                        ({((item.count / analytics.totalProcesses) * 100).toFixed(1)}%)
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Documentos por Mês */}
          <Card>
            <CardHeader>
              <CardTitle>Documentos por Mês</CardTitle>
              <CardDescription>Últimos 6 meses</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analytics.documentsByMonth.map((item) => {
                  const [year, month] = item.month.split('-');
                  const monthName = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
                  const maxCount = Math.max(...analytics.documentsByMonth.map(d => d.count));
                  const percentage = (item.count / maxCount) * 100;

                  return (
                    <div key={item.month} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="capitalize">{monthName}</span>
                        <span className="font-medium">{item.count}</span>
                      </div>
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Membros Mais Ativos */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Membros Mais Ativos</CardTitle>
              <CardDescription>Top 10 usuários por número de atividades</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {analytics.mostActiveMembers.map((member, index) => (
                  <div key={member.userId} className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-semibold text-sm">
                        #{index + 1}
                      </div>
                      <div>
                        <div className="font-medium">{member.userName}</div>
                        <div className="text-sm text-muted-foreground">{member.userEmail}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{member.activityCount}</span>
                      <span className="text-sm text-muted-foreground">atividades</span>
                    </div>
                  </div>
                ))}
                {analytics.mostActiveMembers.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    Nenhuma atividade registrada ainda
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

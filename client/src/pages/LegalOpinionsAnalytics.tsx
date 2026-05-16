import { useAuth } from "@/_core/hooks/useAuth";
import { BackToDashboard } from "@/components/BackToDashboard";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, Loader2 } from "lucide-react";
import { LegalOpinionMetricsGrid } from "@/components/legal-opinions-analytics/LegalOpinionMetricsGrid";
import { LegalOpinionChartsSection } from "@/components/legal-opinions-analytics/LegalOpinionChartsSection";

type PeriodFilter = "all" | "7days" | "30days" | "90days" | "year";

export default function LegalOpinionsAnalytics() {
  const { user, loading: authLoading } = useAuth();
  const [period, setPeriod] = useState<PeriodFilter>("30days");

  const { data: analytics, isLoading } = trpc.legalOpinions.getAnalytics.useQuery(
    { period },
    { enabled: !!user }
  );

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const overview = analytics?.overview;
  const pieData = [
    { name: "Favorável", value: overview?.favorable ?? 0, color: "#22c55e" },
    { name: "Desfavorável", value: overview?.unfavorable ?? 0, color: "#ef4444" },
    { name: "Com Ressalvas", value: overview?.withReservations ?? 0, color: "#f59e0b" },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <BackToDashboard />
              <div>
                <Breadcrumbs
                  items={[{ label: "Parecer Jurídico", href: "/parecer-juridico" }, { label: "Analytics" }]}
                  className="mb-1"
                />
                <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
                  <BarChart3 className="h-6 w-6 text-primary" />
                  Analytics - Parecer Jurídico
                </h1>
                <p className="text-sm text-muted-foreground">
                  Estatísticas e métricas do módulo de Parecer Jurídico
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Período:</span>
              <Select value={period} onValueChange={(v) => setPeriod(v as PeriodFilter)}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="7days">Últimos 7 dias</SelectItem>
                  <SelectItem value="30days">Últimos 30 dias</SelectItem>
                  <SelectItem value="90days">Últimos 90 dias</SelectItem>
                  <SelectItem value="year">Último ano</SelectItem>
                  <SelectItem value="all">Todos os períodos</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">
        <LegalOpinionMetricsGrid overview={overview} />
        <LegalOpinionChartsSection
          byMonth={analytics?.byMonth ?? []}
          pieData={pieData}
          topArticles={analytics?.topArticles ?? []}
        />
      </div>
    </div>
  );
}

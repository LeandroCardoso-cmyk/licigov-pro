import { BarChart2, CheckCircle, XCircle, TrendingUp, Loader2, Package } from "lucide-react";
import { KPIWidget } from "./KPIWidget";
import { ConfidenceDriftChart } from "./ConfidenceDriftChart";
import { ReviewProductivityWidget } from "./ReviewProductivityWidget";
import { trpc } from "@/lib/trpc";

interface OperationalDashboardPageProps {
  organizationId: number;
  processId?:     number;
}

export function OperationalDashboardPage({ organizationId, processId }: OperationalDashboardPageProps) {
  const dashboardQuery = trpc.itemAnalytics.getDashboard.useQuery(
    { organizationId, processId },
    { enabled: organizationId > 0 },
  );

  const summaryQuery = trpc.reviewWorkspace.getSummary.useQuery(
    { organizationId, processId },
    { enabled: organizationId > 0 },
  );

  if (dashboardQuery.isLoading || summaryQuery.isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const kpis      = dashboardQuery.data?.kpis.byKey ?? {};
  const trends    = dashboardQuery.data?.trends ?? [];
  const summary   = summaryQuery.data;

  const acceptanceRate = kpis["candidateAcceptanceRate"]?.value ?? 0;
  const overrideR      = kpis["overrideRate"]?.value ?? 0;
  const catalogAcc     = kpis["catalogAccuracy"]?.value ?? 0;
  const reviewLat      = kpis["reviewLatency"]?.value ?? 0;
  const clauseUsage    = kpis["clauseUsageRate"]?.value ?? 0;

  const driftData = trends.map((t: { week: string; avgConfidence: number }) => ({
    label:         t.week,
    avgConfidence: t.avgConfidence,
  }));

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">Dashboard Operacional</h1>
        <p className="text-sm text-muted-foreground mt-0.5">KPIs de revisão e matching semântico de ItemTR</p>
      </div>

      {/* KPI grid 2x2 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPIWidget
          label="Itens Pendentes"
          value={summary?.pendingCount ?? 0}
          icon={Package}
          iconColor="text-blue-600"
          trend={summary?.pendingCount ?? 0 > 5 ? "degrading" : "stable"}
        />
        <KPIWidget
          label="Aprovados Hoje"
          value={summary?.approvedToday ?? 0}
          icon={CheckCircle}
          iconColor="text-green-600"
          trend="improving"
        />
        <KPIWidget
          label="Aceitação de Candidatos"
          value={`${acceptanceRate.toFixed(1)}%`}
          icon={TrendingUp}
          iconColor="text-purple-600"
          trend={acceptanceRate >= 70 ? "improving" : "degrading"}
        />
        <KPIWidget
          label="Taxa de Override"
          value={`${overrideR.toFixed(1)}%`}
          icon={XCircle}
          iconColor="text-yellow-600"
          trend={overrideR <= 15 ? "stable" : "degrading"}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <KPIWidget
          label="Acurácia do Catálogo"
          value={`${catalogAcc.toFixed(1)}%`}
          icon={BarChart2}
          iconColor="text-indigo-600"
          trend={catalogAcc >= 80 ? "improving" : "stable"}
        />
        <KPIWidget
          label="Uso de Cláusulas"
          value={`${clauseUsage.toFixed(1)}%`}
          icon={BarChart2}
          iconColor="text-orange-600"
          trend="stable"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4">
        <ConfidenceDriftChart data={driftData} />
        <ReviewProductivityWidget
          itemsReviewedToday={summary?.approvedToday ?? 0}
          avgReviewTimeMs={reviewLat}
          approvalRate={acceptanceRate / 100}
        />
      </div>
    </div>
  );
}

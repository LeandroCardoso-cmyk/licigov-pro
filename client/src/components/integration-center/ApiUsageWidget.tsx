import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, TrendingUp, AlertTriangle } from "lucide-react";

interface ApiUsageStats {
  totalRequests: number;
  avgLatency: number;
  p95Latency?: number;
  errorRate: number;
  topEndpoints?: string[];
}

interface ApiUsageWidgetProps {
  stats: ApiUsageStats;
  period?: string;
}

export function ApiUsageWidget({
  stats,
  period = "Últimas 24h",
}: ApiUsageWidgetProps) {
  const errorPct = Math.round(stats.errorRate * 100);
  const healthStatus =
    errorPct < 1 ? "healthy" : errorPct < 5 ? "warning" : "critical";

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Uso da API
          </CardTitle>
          <Badge
            variant={
              healthStatus === "healthy"
                ? "default"
                : healthStatus === "warning"
                  ? "secondary"
                  : "destructive"
            }
            className="text-xs"
          >
            {healthStatus === "healthy"
              ? "Saudável"
              : healthStatus === "warning"
                ? "Atenção"
                : "Crítico"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">{period}</p>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs text-muted-foreground">Requisições</span>
            </div>
            <span className="text-2xl font-bold">
              {stats.totalRequests.toLocaleString("pt-BR")}
            </span>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-xs text-muted-foreground">Latência média</span>
            </div>
            <span className="text-2xl font-bold">
              {Math.round(stats.avgLatency)}
              <span className="text-sm font-normal text-muted-foreground ml-1">
                ms
              </span>
            </span>
          </div>
        </div>

        {stats.p95Latency !== undefined && (
          <div className="text-xs text-muted-foreground">
            P95: {Math.round(stats.p95Latency)}ms
          </div>
        )}

        <div className="space-y-1">
          <div className="flex justify-between text-xs">
            <div className="flex items-center gap-1">
              {errorPct > 0 && (
                <AlertTriangle className="w-3 h-3 text-orange-500" />
              )}
              <span className="text-muted-foreground">Taxa de erros</span>
            </div>
            <span
              className={
                errorPct < 1
                  ? "text-green-600"
                  : errorPct < 5
                    ? "text-yellow-600"
                    : "text-red-600"
              }
            >
              {errorPct}%
            </span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${
                errorPct < 1
                  ? "bg-green-500"
                  : errorPct < 5
                    ? "bg-yellow-500"
                    : "bg-red-500"
              }`}
              style={{ width: `${Math.min(errorPct, 100)}%` }}
            />
          </div>
        </div>

        {stats.topEndpoints && stats.topEndpoints.length > 0 && (
          <div className="space-y-1">
            <span className="text-xs font-medium">Top endpoints</span>
            <div className="space-y-0.5">
              {stats.topEndpoints.slice(0, 3).map((ep, i) => (
                <div key={i} className="text-xs text-muted-foreground font-mono truncate">
                  {i + 1}. {ep}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

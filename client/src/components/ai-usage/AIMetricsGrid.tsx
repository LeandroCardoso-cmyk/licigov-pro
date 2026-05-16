import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DollarSign, TrendingUp, Activity, Sparkles } from "lucide-react";

interface Props {
  todayCost: number;
  totalCost: number;
  totalOperations: number;
  totalInputTokens: number;
  estimatedMonthlyCost: number;
}

function fmtUSD(v: number, digits = 4) {
  return `US$ ${v.toFixed(digits)}`;
}

function fmtBRL(usd: number) {
  return `~R$ ${(usd * 5.5).toFixed(2)}`;
}

export function AIMetricsGrid({ todayCost, totalCost, totalOperations, totalInputTokens, estimatedMonthlyCost }: Props) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Custo Hoje</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{fmtUSD(todayCost)}</div>
          <p className="text-xs text-muted-foreground">{fmtBRL(todayCost)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Custo no Período</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{fmtUSD(totalCost)}</div>
          <p className="text-xs text-muted-foreground">{fmtBRL(totalCost)}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total de Operações</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{totalOperations}</div>
          <p className="text-xs text-muted-foreground">{totalInputTokens.toLocaleString()} tokens entrada</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Estimativa Mensal</CardTitle>
          <Sparkles className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{fmtUSD(estimatedMonthlyCost, 2)}</div>
          <p className="text-xs text-muted-foreground">{fmtBRL(estimatedMonthlyCost)}/mês</p>
        </CardContent>
      </Card>
    </div>
  );
}

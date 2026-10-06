import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, DollarSign, Clock, CheckCircle } from "lucide-react";
import { formatCentsBRL, MONEY_MEANING } from "@/lib/money";

interface Overview {
  total?: number;
  totalValue?: number;
  /** R6 / PR-14 — valor ESTIMADO (centavos) das contratações em curso/concluídas (sem rascunho/cancelada). */
  estimatedValueActiveCents?: number;
  avgCompletionTime?: number;
  approvalRate?: number;
  byType?: { type: string; count: number }[];
}

interface Props {
  overview: Overview | null | undefined;
}

export function MetricsGrid({ overview }: Props) {
  const dispensas = overview?.byType?.find((t) => t.type === "dispensa")?.count ?? 0;
  const inexigibilidades = overview?.byType?.find((t) => t.type === "inexigibilidade")?.count ?? 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total de Contratações</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{overview?.total ?? 0}</div>
          <p className="text-xs text-muted-foreground mt-1">
            {dispensas} dispensas, {inexigibilidades} inexigibilidades
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{MONEY_MEANING.estimated} (em curso e concluídas)</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatCentsBRL(overview?.estimatedValueActiveCents ?? 0)}
          </div>
          <p className="text-xs text-muted-foreground mt-1">Soma dos valores estimados; exclui rascunhos e canceladas (não é valor contratado)</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Tempo Médio de Conclusão</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{overview?.avgCompletionTime ?? 0} dias</div>
          <p className="text-xs text-muted-foreground mt-1">Média das contratações concluídas</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Taxa de Aprovação</CardTitle>
          <CheckCircle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{overview?.approvalRate ?? 0}%</div>
          <p className="text-xs text-muted-foreground mt-1">Contratações aprovadas / total</p>
        </CardContent>
      </Card>
    </div>
  );
}

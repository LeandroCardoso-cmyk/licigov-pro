import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, CheckCircle2, XCircle, Clock } from "lucide-react";

interface Overview {
  total: number;
  favorable: number;
  unfavorable: number;
  withReservations: number;
  avgGenerationTime: number;
}

interface Props {
  overview: Overview | null | undefined;
}

export function LegalOpinionMetricsGrid({ overview }: Props) {
  const total = overview?.total ?? 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Total de Pareceres</CardTitle>
          <FileText className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{total}</div>
          <p className="text-xs text-muted-foreground">Pareceres gerados</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Favoráveis</CardTitle>
          <CheckCircle2 className="h-4 w-4 text-green-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-600">{overview?.favorable ?? 0}</div>
          <p className="text-xs text-muted-foreground">
            {total ? (((overview?.favorable ?? 0) / total) * 100).toFixed(1) : 0}% do total
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Desfavoráveis</CardTitle>
          <XCircle className="h-4 w-4 text-red-600" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-red-600">{overview?.unfavorable ?? 0}</div>
          <p className="text-xs text-muted-foreground">
            {total ? (((overview?.unfavorable ?? 0) / total) * 100).toFixed(1) : 0}% do total
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Tempo Médio</CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{overview?.avgGenerationTime ?? 0} min</div>
          <p className="text-xs text-muted-foreground">Geração com IA</p>
        </CardContent>
      </Card>
    </div>
  );
}

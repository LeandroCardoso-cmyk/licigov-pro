import { CheckCircle, Clock, BarChart2 } from "lucide-react";

interface ReviewProductivityWidgetProps {
  itemsReviewedToday: number;
  avgReviewTimeMs:    number;
  approvalRate:       number;
}

function msToReadable(ms: number): string {
  if (ms < 1000)  return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60000)}min`;
}

export function ReviewProductivityWidget({
  itemsReviewedToday,
  avgReviewTimeMs,
  approvalRate,
}: ReviewProductivityWidgetProps) {
  return (
    <div className="border rounded-lg p-4 space-y-4">
      <h3 className="text-sm font-semibold">Produtividade de Revisão</h3>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-blue-50 text-blue-600">
            <CheckCircle className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Itens revisados hoje</p>
            <p className="text-lg font-semibold">{itemsReviewedToday}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-purple-50 text-purple-600">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tempo médio de revisão</p>
            <p className="text-lg font-semibold">{msToReadable(avgReviewTimeMs)}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="p-2 rounded-md bg-green-50 text-green-600">
            <BarChart2 className="h-4 w-4" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Taxa de aprovação</p>
            <p className="text-lg font-semibold">{Math.round(approvalRate * 100)}%</p>
          </div>
        </div>
      </div>
    </div>
  );
}

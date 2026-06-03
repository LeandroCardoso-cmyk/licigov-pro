import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Minus, Edit, AlertTriangle } from "lucide-react";

interface ChangeSummary {
  addedCount: number;
  removedCount: number;
  modifiedCount: number;
  highImpactChanges: string[];
}

interface ChangeSummaryPanelProps {
  summary: ChangeSummary;
}

export function ChangeSummaryPanel({ summary }: ChangeSummaryPanelProps) {
  const total = summary.addedCount + summary.removedCount + summary.modifiedCount;

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          Resumo das alterações
          <Badge variant="outline" className="text-xs">
            {total} total
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <div className="flex flex-col items-center p-2 rounded bg-green-50 border border-green-100">
            <Plus className="w-4 h-4 text-green-600 mb-1" />
            <span className="text-lg font-bold text-green-700">
              {summary.addedCount}
            </span>
            <span className="text-xs text-green-600">Adicionados</span>
          </div>
          <div className="flex flex-col items-center p-2 rounded bg-yellow-50 border border-yellow-100">
            <Edit className="w-4 h-4 text-yellow-600 mb-1" />
            <span className="text-lg font-bold text-yellow-700">
              {summary.modifiedCount}
            </span>
            <span className="text-xs text-yellow-600">Modificados</span>
          </div>
          <div className="flex flex-col items-center p-2 rounded bg-red-50 border border-red-100">
            <Minus className="w-4 h-4 text-red-600 mb-1" />
            <span className="text-lg font-bold text-red-700">
              {summary.removedCount}
            </span>
            <span className="text-xs text-red-600">Removidos</span>
          </div>
        </div>

        {summary.highImpactChanges.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-medium text-orange-600">
              <AlertTriangle className="w-3.5 h-3.5" />
              Alterações de alto impacto
            </div>
            <div className="flex flex-wrap gap-1">
              {summary.highImpactChanges.map((field) => (
                <Badge
                  key={field}
                  variant="outline"
                  className="text-xs border-orange-200 text-orange-700"
                >
                  {field}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {total === 0 && (
          <p className="text-sm text-muted-foreground text-center py-2">
            Nenhuma alteração detectada.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

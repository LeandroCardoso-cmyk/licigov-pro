import { CheckCircle, Clock, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export interface SemanticStep {
  label:       string;
  result:      string;
  durationMs?: number;
  status:      "ok" | "warning" | "error";
}

interface SemanticTraceViewProps {
  steps: SemanticStep[];
}

const statusConfig = {
  ok:      { icon: CheckCircle, color: "text-green-600" },
  warning: { icon: AlertCircle, color: "text-yellow-600" },
  error:   { icon: AlertCircle, color: "text-red-600" },
};

export function SemanticTraceView({ steps }: SemanticTraceViewProps) {
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground italic">Nenhuma etapa de rastreamento disponível</p>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Trace do Pipeline Semântico</h3>
      <div className="space-y-1">
        {steps.map((step, idx) => {
          const { icon: Icon, color } = statusConfig[step.status];
          return (
            <div key={idx} className="flex items-start gap-2 p-2 rounded border text-sm">
              <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${color}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{step.label}</span>
                  {step.durationMs != null && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {step.durationMs}ms
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{step.result}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

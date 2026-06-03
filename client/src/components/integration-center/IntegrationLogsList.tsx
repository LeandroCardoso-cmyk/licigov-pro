import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, XCircle, Clock, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type LogType = "webhook" | "api" | "export" | "collaboration" | "workflow" | "all";

interface IntegrationLogEntry {
  id: string;
  type: Exclude<LogType, "all">;
  status: "success" | "failure" | "pending" | "warning";
  message: string;
  entityId?: string;
  createdAt: string;
}

interface IntegrationLogsListProps {
  logs: IntegrationLogEntry[];
  maxItems?: number;
}

function StatusIcon({ status }: { status: IntegrationLogEntry["status"] }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
    case "failure":
      return <XCircle className="w-3.5 h-3.5 text-red-500" />;
    case "pending":
      return <Clock className="w-3.5 h-3.5 text-yellow-500" />;
    case "warning":
      return <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />;
  }
}

const TYPE_LABELS: Record<Exclude<LogType, "all">, string> = {
  webhook: "Webhook",
  api: "API",
  export: "Exportação",
  collaboration: "Colaboração",
  workflow: "Workflow",
};

export function IntegrationLogsList({
  logs,
  maxItems = 50,
}: IntegrationLogsListProps) {
  const [filter, setFilter] = useState<LogType>("all");

  const filtered =
    filter === "all" ? logs : logs.filter((l) => l.type === filter);
  const displayed = filtered.slice(-maxItems).reverse();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Filtrar por tipo:</span>
        <Select value={filter} onValueChange={(v) => setFilter(v as LogType)}>
          <SelectTrigger className="h-7 w-40 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="webhook">Webhooks</SelectItem>
            <SelectItem value="api">API</SelectItem>
            <SelectItem value="export">Exportações</SelectItem>
            <SelectItem value="collaboration">Colaboração</SelectItem>
            <SelectItem value="workflow">Workflows</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground ml-auto">
          {displayed.length} evento{displayed.length !== 1 ? "s" : ""}
        </span>
      </div>

      {displayed.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          Nenhum evento de integração registrado.
        </div>
      ) : (
        <div className="space-y-1">
          {displayed.map((log) => (
            <div
              key={log.id}
              className="flex items-center gap-2 py-2 px-3 rounded border text-xs hover:bg-muted/50"
            >
              <StatusIcon status={log.status} />
              <Badge variant="outline" className="text-xs py-0 flex-shrink-0">
                {TYPE_LABELS[log.type]}
              </Badge>
              <span className="flex-1 truncate text-foreground">
                {log.message}
              </span>
              {log.entityId && (
                <span className="text-muted-foreground font-mono flex-shrink-0">
                  {log.entityId.slice(0, 8)}
                </span>
              )}
              <span className="text-muted-foreground flex-shrink-0">
                {format(new Date(log.createdAt), "HH:mm:ss", { locale: ptBR })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Webhook, CheckCircle2, XCircle, Clock } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
}

interface WebhookStats {
  delivered: number;
  failed: number;
  pending: number;
  successRate: number;
}

interface WebhookStatusCardProps {
  endpoint: WebhookEndpoint;
  stats?: WebhookStats;
  lastDelivery?: string | null;
}

export function WebhookStatusCard({
  endpoint,
  stats,
  lastDelivery,
}: WebhookStatusCardProps) {
  const truncatedUrl =
    endpoint.url.length > 45
      ? endpoint.url.slice(0, 42) + "..."
      : endpoint.url;

  const successPct = stats
    ? Math.round(stats.successRate * 100)
    : null;

  return (
    <Card className={!endpoint.active ? "opacity-60" : ""}>
      <CardHeader className="py-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Webhook className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <CardTitle className="text-sm font-mono truncate" title={endpoint.url}>
              {truncatedUrl}
            </CardTitle>
          </div>
          <Badge
            variant={endpoint.active ? "default" : "secondary"}
            className="text-xs flex-shrink-0"
          >
            {endpoint.active ? "Ativo" : "Inativo"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        <div className="flex flex-wrap gap-1">
          {endpoint.events.map((event) => (
            <Badge key={event} variant="outline" className="text-xs py-0">
              {event}
            </Badge>
          ))}
        </div>

        {stats && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="space-y-0.5">
              <div className="flex items-center justify-center gap-1">
                <CheckCircle2 className="w-3 h-3 text-green-500" />
                <span className="text-sm font-medium text-green-600">
                  {stats.delivered}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">Entregues</div>
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center justify-center gap-1">
                <XCircle className="w-3 h-3 text-red-500" />
                <span className="text-sm font-medium text-red-600">
                  {stats.failed}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">Falhas</div>
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center justify-center gap-1">
                <Clock className="w-3 h-3 text-yellow-500" />
                <span className="text-sm font-medium text-yellow-600">
                  {stats.pending}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">Pendentes</div>
            </div>
          </div>
        )}

        {successPct !== null && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Taxa de sucesso</span>
              <span
                className={
                  successPct >= 90
                    ? "text-green-600"
                    : successPct >= 70
                      ? "text-yellow-600"
                      : "text-red-600"
                }
              >
                {successPct}%
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${
                  successPct >= 90
                    ? "bg-green-500"
                    : successPct >= 70
                      ? "bg-yellow-500"
                      : "bg-red-500"
                }`}
                style={{ width: `${successPct}%` }}
              />
            </div>
          </div>
        )}

        {lastDelivery && (
          <div className="text-xs text-muted-foreground">
            Última entrega:{" "}
            {format(new Date(lastDelivery), "dd/MM/yyyy HH:mm", {
              locale: ptBR,
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

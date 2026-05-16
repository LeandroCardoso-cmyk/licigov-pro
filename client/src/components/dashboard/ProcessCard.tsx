import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { FileText, Clock } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  em_etp: "Em ETP",
  em_tr: "Em TR",
  em_dfd: "Em DFD",
  em_edital: "Em Edital",
  concluido: "Concluído",
};

const STATUS_COLORS: Record<string, string> = {
  em_etp: "bg-blue-500",
  em_tr: "bg-yellow-500",
  em_dfd: "bg-orange-500",
  em_edital: "bg-purple-500",
  concluido: "bg-green-500",
};

interface Process {
  id: number;
  name: string;
  description?: string | null;
  object?: string | null;
  status: string;
  updatedAt: Date;
  platformId?: number | null;
  platform?: {
    name: string;
    description?: string | null;
    websiteUrl?: string | null;
  } | null;
}

interface Props {
  process: Process;
  onClick: () => void;
}

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProcessCard({ process, onClick }: Props) {
  return (
    <Card
      className="hover:shadow-lg transition-shadow cursor-pointer"
      onClick={onClick}
    >
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">{process.name}</CardTitle>
            <CardDescription className="mt-1 line-clamp-2">
              {process.description || process.object}
            </CardDescription>
          </div>
          <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0 ml-2" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={`h-2 w-2 rounded-full ${STATUS_COLORS[process.status]}`} />
              <span className="text-sm font-medium text-foreground">
                {STATUS_LABELS[process.status]}
              </span>
            </div>
            {process.platformId && process.platform && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-xs cursor-help">
                    {process.platform.name}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <div className="space-y-1">
                    <p className="font-semibold">{process.platform.name}</p>
                    {process.platform.description && (
                      <p className="text-xs text-muted-foreground">
                        {process.platform.description}
                      </p>
                    )}
                    {process.platform.websiteUrl && (
                      <p className="text-xs">🌐 {process.platform.websiteUrl}</p>
                    )}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            <span>Atualizado em {formatDate(process.updatedAt)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

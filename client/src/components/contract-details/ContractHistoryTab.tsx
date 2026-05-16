import { History, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { AuditLog } from "./types";

interface Props {
  auditLogs: AuditLog[] | undefined;
  exportIsPending: boolean;
  onExport: () => void;
}

export function ContractHistoryTab({ auditLogs, exportIsPending, onExport }: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold mb-1">Histórico de Atividades</h3>
          <p className="text-sm text-muted-foreground">
            Timeline completa de todas as ações realizadas neste contrato
          </p>
        </div>
        {auditLogs && auditLogs.length > 0 && (
          <Button variant="outline" size="sm" onClick={onExport} disabled={exportIsPending}>
            <Download className="h-4 w-4 mr-2" />
            {exportIsPending ? "Exportando..." : "Exportar Excel"}
          </Button>
        )}
      </div>

      {auditLogs && auditLogs.length > 0 ? (
        <div className="space-y-4">
          {auditLogs.map((log) => (
            <Card key={log.id}>
              <CardContent className="pt-6">
                <div className="flex items-start gap-3">
                  <History className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium capitalize">{log.action.replace("_", " ")}</p>
                    <p className="text-sm text-muted-foreground">
                      {log.userName} •{" "}
                      {formatDistanceToNow(new Date(log.createdAt), {
                        addSuffix: true,
                        locale: ptBR,
                      })}
                    </p>
                    {!!log.details && (
                      <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto">
                        {JSON.stringify(log.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Nenhuma atividade registrada</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * PR B.2.2 — Estado de erro acionável da ingestão.
 *
 * Mensagem SANITIZADA (sem stack, sem conteúdo do documento). Expõe o correlationId para suporte
 * (sem dados sensíveis) e permite retry idempotente quando aplicável.
 */
import { XCircle, RotateCcw } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface IngestionErrorStateProps {
  message: string;
  correlationId?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}

export function IngestionErrorState({ message, correlationId, onRetry, retrying }: IngestionErrorStateProps) {
  return (
    <Alert
      role="alert"
      className="border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
    >
      <XCircle className="size-4" aria-hidden="true" />
      <AlertTitle>Não foi possível concluir</AlertTitle>
      <AlertDescription className="space-y-2">
        <p className="text-sm">{message}</p>
        {correlationId && (
          <p className="text-xs text-muted-foreground">
            Código de suporte: <code className="font-mono">{correlationId}</code>
          </p>
        )}
        {onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {retrying ? "Reprocessando..." : "Tentar novamente"}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * PR B.2.2 — Estado de erro acionável da ingestão.
 *
 * Mensagem SANITIZADA (sem stack, sem conteúdo do documento). Expõe o correlationId para suporte
 * (sem dados sensíveis) e permite retry idempotente quando aplicável.
 */
import { XCircle, RotateCcw, Upload } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface IngestionErrorStateProps {
  /** U2A — título do desfecho (ex.: "Nenhum item de preço reconhecido"). */
  title?: string;
  message: string;
  correlationId?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
  /** U2A — o caminho útil é enviar outro arquivo (volta à entrada, sem apagar a sessão persistida). */
  onNewFile?: () => void;
}

export function IngestionErrorState({ title, message, correlationId, onRetry, retrying, onNewFile }: IngestionErrorStateProps) {
  return (
    <Alert
      role="alert"
      className="border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100"
    >
      <XCircle className="size-4" aria-hidden="true" />
      <AlertTitle>{title ?? "Não foi possível concluir"}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p className="text-sm">{message}</p>
        {correlationId && (
          <p className="text-xs text-muted-foreground">
            Código de suporte: <code className="font-mono">{correlationId}</code>
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {onRetry && (
            <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying}>
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {retrying ? "Reprocessando..." : "Tentar novamente"}
            </Button>
          )}
          {onNewFile && (
            <Button size="sm" variant="outline" onClick={onNewFile}>
              <Upload className="size-3.5" aria-hidden="true" />
              Enviar outro arquivo
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}

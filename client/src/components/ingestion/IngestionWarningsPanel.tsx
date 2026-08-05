/**
 * PR B.2.2 — Painel de advertências da extração (não-fatais).
 *
 * As advertências vêm do parser/serviço (code + message controlados; sem PII/conteúdo).
 */
import { AlertTriangle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { INSTITUTIONAL_COPY } from "@/lib/ingestion/status";

export interface IngestionWarning { code?: string; message?: string; severity?: string }

export function IngestionWarningsPanel({ warnings }: { warnings: IngestionWarning[] }) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <AlertTriangle className="size-4" aria-hidden="true" />
      <AlertTitle>{INSTITUTIONAL_COPY.warnings} ({warnings.length})</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-1 pl-4">
          {warnings.map((w, i) => (
            <li key={`${w.code ?? "warn"}-${i}`} className="text-sm">
              {w.message ?? w.code ?? "Advertência"}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

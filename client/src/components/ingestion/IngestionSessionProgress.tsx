/**
 * PR B.2.2 — Progresso da sessão de ingestão.
 *
 * Reflete o estado PERSISTIDO (nunca simula progresso inexistente): usa o `progress` real da
 * sessão quando disponível; nas fases de trabalho sem porcentagem, mostra indeterminado.
 */
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { IngestionStatusBadge } from "./IngestionStatusBadge";
import { PHASE_META, type IngestionPhase } from "@/lib/ingestion/status";

export function IngestionSessionProgress({
  phase,
  progress,
}: {
  phase: IngestionPhase;
  progress?: number | null;
}) {
  const meta = PHASE_META[phase];
  const showBar = typeof progress === "number" && progress > 0 && progress < 100 && !meta.terminal;

  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        {meta.busy && <Spinner className="size-4 text-muted-foreground" aria-hidden="true" />}
        <IngestionStatusBadge phase={phase} />
        <span className="text-sm text-muted-foreground">{meta.description}</span>
      </div>
      {showBar && <Progress value={progress ?? 0} aria-label={`Progresso: ${progress}%`} />}
      {meta.busy && !showBar && (
        <Progress className="animate-pulse" aria-label="Processando" />
      )}
    </div>
  );
}

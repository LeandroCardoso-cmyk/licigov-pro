/**
 * PR B.2.2 — Selo de estado da sessão de ingestão (institucional, tema-aware).
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PHASE_META, TONE_BADGE_CLASS, type IngestionPhase } from "@/lib/ingestion/status";

export function IngestionStatusBadge({ phase, className }: { phase: IngestionPhase; className?: string }) {
  const meta = PHASE_META[phase];
  return (
    <Badge
      className={cn("border font-medium", TONE_BADGE_CLASS[meta.tone], className)}
      aria-label={`Estado: ${meta.label}`}
      title={meta.description}
    >
      {meta.label}
    </Badge>
  );
}

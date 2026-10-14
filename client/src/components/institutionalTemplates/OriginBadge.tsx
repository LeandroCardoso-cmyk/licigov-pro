import { StatusBadge } from "@/components/ui/StatusBadge";
import { originBadge, type OriginStateKey, type OriginView } from "@/lib/institutionalTemplatesView";

/** Selo de origem do modelo (plataforma · própria · derivada). Estados sem origem registrada são ditos como são. */
export function OriginBadge({ origin, originState }: { origin?: OriginView | null; originState?: OriginStateKey }) {
  const b = originBadge({ origin, originState });
  return (
    <div className="space-y-0.5" data-testid="origin-badge">
      <StatusBadge label={b.label} tone={b.tone} />
      <p className="text-xs text-muted-foreground">{b.detail}</p>
    </div>
  );
}

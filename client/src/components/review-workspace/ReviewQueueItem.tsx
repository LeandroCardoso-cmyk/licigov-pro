import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBadge, scoreToLevel } from "@/components/ui/ConfidenceBadge";
import { cn } from "@/lib/utils";

export type ItemReviewState =
  | "pending_match"
  | "candidate_generated"
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "overridden"
  | "manual_entry"
  | "finalized";

export interface ReviewItemShape {
  id: string;
  itemNumber: number;
  description: string;
  quantity: number;
  unit: string;
  canonicalUnit: string | null;
  confidenceScore: number;
  reviewState: ItemReviewState;
  estimatedUnitPrice: number | null;
  estimatedTotalPrice: number | null;
}

interface ReviewQueueItemProps {
  item: ReviewItemShape;
  selected: boolean;
  checked: boolean;
  onSelect: (id: string) => void;
  onCheckboxChange: (id: string, checked: boolean) => void;
}

const stateLabels: Record<ItemReviewState, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending_match:       { label: "Aguardando Match",     variant: "secondary" },
  candidate_generated: { label: "Candidatos Gerados",   variant: "secondary" },
  awaiting_review:     { label: "Aguardando Revisão",   variant: "default" },
  approved:            { label: "Aprovado",             variant: "default" },
  rejected:            { label: "Rejeitado",            variant: "destructive" },
  overridden:          { label: "Sobrescrito",          variant: "outline" },
  manual_entry:        { label: "Entrada Manual",       variant: "outline" },
  finalized:           { label: "Finalizado",           variant: "default" },
};

export function ReviewQueueItem({
  item,
  selected,
  checked,
  onSelect,
  onCheckboxChange,
}: ReviewQueueItemProps) {
  const stateConfig = stateLabels[item.reviewState];
  const level       = scoreToLevel(item.confidenceScore);

  return (
    <div
      className={cn(
        "flex items-start gap-3 p-3 border-b last:border-b-0 cursor-pointer hover:bg-muted/50 transition-colors",
        selected && "bg-primary/5 border-l-2 border-l-primary",
      )}
      onClick={() => onSelect(item.id)}
      role="button"
      tabIndex={0}
      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") onSelect(item.id); }}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={v => onCheckboxChange(item.id, Boolean(v))}
        onClick={e => e.stopPropagation()}
        aria-label={`Selecionar item ${item.itemNumber}`}
      />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium text-muted-foreground">#{item.itemNumber}</span>
          <Badge variant={stateConfig.variant} className="text-xs shrink-0">
            {stateConfig.label}
          </Badge>
        </div>
        <p className="text-sm font-medium line-clamp-2">{item.description}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <ConfidenceBadge level={level} score={item.confidenceScore} showScore />
          <span className="text-xs text-muted-foreground">
            {item.quantity} {item.canonicalUnit ?? item.unit}
          </span>
          {item.estimatedTotalPrice != null && (
            <span className="text-xs text-muted-foreground">
              R$ {item.estimatedTotalPrice.toFixed(2)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

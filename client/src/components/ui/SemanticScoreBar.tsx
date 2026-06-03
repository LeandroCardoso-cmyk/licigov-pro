import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface SemanticScoreBarProps {
  score: number;
  label: string;
  showValue?: boolean;
  className?: string;
}

function scoreColor(score: number): string {
  if (score >= 0.85) return "[&>div]:bg-green-500";
  if (score >= 0.65) return "[&>div]:bg-yellow-500";
  if (score >= 0.40) return "[&>div]:bg-orange-500";
  return "[&>div]:bg-red-500";
}

export function SemanticScoreBar({ score, label, showValue = true, className }: SemanticScoreBarProps) {
  const pct = Math.round(Math.min(1, Math.max(0, score)) * 100);
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        {showValue && <span className="font-medium">{pct}%</span>}
      </div>
      <Progress
        value={pct}
        className={cn("h-1.5", scoreColor(score))}
      />
    </div>
  );
}

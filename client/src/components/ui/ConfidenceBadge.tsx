import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ConfidenceLevel = "high" | "medium" | "low" | "uncertain";

interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
  score?: number;
  showScore?: boolean;
  className?: string;
}

const levelConfig: Record<ConfidenceLevel, { label: string; className: string }> = {
  high:      { label: "Alta",      className: "bg-green-100 text-green-800 border-green-200" },
  medium:    { label: "Média",     className: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  low:       { label: "Baixa",     className: "bg-orange-100 text-orange-800 border-orange-200" },
  uncertain: { label: "Incerta",   className: "bg-red-100 text-red-800 border-red-200" },
};

export function scoreToLevel(score: number): ConfidenceLevel {
  if (score >= 0.85) return "high";
  if (score >= 0.65) return "medium";
  if (score >= 0.40) return "low";
  return "uncertain";
}

export function ConfidenceBadge({ level, score, showScore = false, className }: ConfidenceBadgeProps) {
  const config = levelConfig[level];
  return (
    <Badge className={cn(config.className, className)}>
      {config.label}
      {showScore && score != null && ` (${Math.round(score * 100)}%)`}
    </Badge>
  );
}

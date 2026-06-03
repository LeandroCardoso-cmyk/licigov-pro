import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type DriftTrend = "improving" | "stable" | "degrading";

interface DriftIndicatorProps {
  trend: DriftTrend;
  delta?: number;
  className?: string;
}

const trendConfig: Record<DriftTrend, {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  className: string;
}> = {
  improving: { icon: TrendingUp,   label: "Melhorando", className: "bg-green-100 text-green-800 border-green-200" },
  stable:    { icon: Minus,        label: "Estável",    className: "bg-gray-100 text-gray-700 border-gray-200" },
  degrading: { icon: TrendingDown, label: "Piorando",   className: "bg-red-100 text-red-800 border-red-200" },
};

export function DriftIndicator({ trend, delta, className }: DriftIndicatorProps) {
  const config = trendConfig[trend];
  const Icon   = config.icon;
  return (
    <Badge className={cn(config.className, "gap-1", className)}>
      <Icon className="h-3 w-3" />
      {config.label}
      {delta != null && ` ${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}%`}
    </Badge>
  );
}

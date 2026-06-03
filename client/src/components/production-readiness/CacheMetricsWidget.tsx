import { cn } from "@/lib/utils";
import { Layers } from "lucide-react";

interface CacheMetricsWidgetProps {
  hits:      number;
  misses:    number;
  evictions: number;
  size:      number;
  hitRatio:  number;
}

export function CacheMetricsWidget({
  hits,
  misses,
  evictions,
  size,
  hitRatio,
}: CacheMetricsWidgetProps) {
  const ratioPercent = Math.round(hitRatio * 100);
  const ratioColor = ratioPercent >= 80 ? "text-green-600" : ratioPercent >= 50 ? "text-yellow-600" : "text-red-600";

  return (
    <div className="border rounded-lg p-4 bg-card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Cache Metrics</span>
        <div className="p-2 rounded-md bg-muted">
          <Layers className="h-4 w-4" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn("text-2xl font-bold", ratioColor)}>
          {ratioPercent}%
        </span>
        <span className="text-sm text-muted-foreground">hit ratio</span>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div>Hits: <span className="font-medium text-foreground">{hits}</span></div>
        <div>Misses: <span className="font-medium text-foreground">{misses}</span></div>
        <div>Evictions: <span className="font-medium text-foreground">{evictions}</span></div>
        <div>Size: <span className="font-medium text-foreground">{size}</span></div>
      </div>
    </div>
  );
}

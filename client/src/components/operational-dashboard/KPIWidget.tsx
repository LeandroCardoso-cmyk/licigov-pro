import type { LucideIcon } from "lucide-react";
import { DriftIndicator, type DriftTrend } from "@/components/ui/DriftIndicator";
import { cn } from "@/lib/utils";

interface KPIWidgetProps {
  label:       string;
  value:       string | number;
  unit?:       string;
  trend?:      DriftTrend;
  delta?:      number;
  icon?:       LucideIcon;
  iconColor?:  string;
  className?:  string;
}

export function KPIWidget({
  label,
  value,
  unit,
  trend,
  delta,
  icon: Icon,
  iconColor,
  className,
}: KPIWidgetProps) {
  return (
    <div className={cn("border rounded-lg p-4 space-y-3 bg-card", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        {Icon && (
          <div className={cn("p-2 rounded-md bg-muted", iconColor)}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <div className="flex items-end gap-1">
          <span className="text-2xl font-bold">{value}</span>
          {unit && <span className="text-sm text-muted-foreground pb-0.5">{unit}</span>}
        </div>
        {trend && (
          <DriftIndicator trend={trend} delta={delta} />
        )}
      </div>
    </div>
  );
}

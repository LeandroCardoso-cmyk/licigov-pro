import { cn } from "@/lib/utils";
import { Activity } from "lucide-react";

interface HealthCheck {
  name:    string;
  status:  "healthy" | "warning" | "critical";
  details: string;
}

interface SystemHealthCardProps {
  healthy: boolean;
  checks:  HealthCheck[];
}

const statusColors: Record<string, string> = {
  healthy:  "text-green-600 bg-green-100",
  warning:  "text-yellow-600 bg-yellow-100",
  critical: "text-red-600 bg-red-100",
};

export function SystemHealthCard({ healthy, checks }: SystemHealthCardProps) {
  return (
    <div className="border rounded-lg p-4 bg-card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">System Health</span>
        <div className={cn("p-2 rounded-md", healthy ? "bg-green-100" : "bg-red-100")}>
          <Activity className={cn("h-4 w-4", healthy ? "text-green-600" : "text-red-600")} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn(
          "text-sm font-bold px-2 py-0.5 rounded",
          healthy ? "text-green-700 bg-green-100" : "text-red-700 bg-red-100",
        )}>
          {healthy ? "Healthy" : "Degraded"}
        </span>
      </div>
      <div className="space-y-1.5">
        {checks.map(check => (
          <div key={check.name} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{check.name}</span>
            <span className={cn("px-1.5 py-0.5 rounded", statusColors[check.status])}>
              {check.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

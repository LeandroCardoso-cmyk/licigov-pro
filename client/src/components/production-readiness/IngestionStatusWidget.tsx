import { cn } from "@/lib/utils";
import { Database } from "lucide-react";

interface IngestionStatusWidgetProps {
  totalEntries:     number;
  processedEntries: number;
  failedEntries:    number;
  status:           string;
}

const statusBadge: Record<string, string> = {
  pending:    "bg-gray-100 text-gray-700",
  processing: "bg-blue-100 text-blue-700",
  completed:  "bg-green-100 text-green-700",
  failed:     "bg-red-100 text-red-700",
  partial:    "bg-yellow-100 text-yellow-700",
};

export function IngestionStatusWidget({
  totalEntries,
  processedEntries,
  failedEntries,
  status,
}: IngestionStatusWidgetProps) {
  const progress = totalEntries > 0 ? Math.round((processedEntries / totalEntries) * 100) : 0;

  return (
    <div className="border rounded-lg p-4 bg-card space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Ingestion Status</span>
        <div className="p-2 rounded-md bg-muted">
          <Database className="h-4 w-4" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={cn("text-xs font-medium px-2 py-0.5 rounded", statusBadge[status] ?? statusBadge.pending)}>
          {status}
        </span>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Total: {totalEntries}</span>
          <span>Processed: {processedEntries}</span>
        </div>
        <div className="w-full bg-muted rounded h-2">
          <div
            className="bg-primary rounded h-2 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        {failedEntries > 0 && (
          <span className="text-xs text-red-600">Failed: {failedEntries}</span>
        )}
      </div>
    </div>
  );
}

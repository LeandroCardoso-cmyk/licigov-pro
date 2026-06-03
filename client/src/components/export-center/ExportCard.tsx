import { cn } from "@/lib/utils";
import { FileText, Download } from "lucide-react";

interface ExportCardProps {
  format:       "docx" | "pdf";
  filename:     string;
  contentHash:  string;
  generatedAt:  string;
  onDownload?:  () => void;
}

const formatBadge: Record<string, string> = {
  docx: "bg-blue-100 text-blue-700",
  pdf:  "bg-red-100 text-red-700",
};

export function ExportCard({
  format,
  filename,
  contentHash,
  generatedAt,
  onDownload,
}: ExportCardProps) {
  return (
    <div className="border rounded-lg p-4 bg-card flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-md bg-muted">
          <FileText className="h-4 w-4" />
        </div>
        <div>
          <div className="text-sm font-medium">{filename}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className={cn("px-1.5 py-0.5 rounded", formatBadge[format])}>
              {format.toUpperCase()}
            </span>
            <span title={contentHash}>Hash: {contentHash.slice(0, 12)}...</span>
            <span>{new Date(generatedAt).toLocaleDateString("pt-BR")}</span>
          </div>
        </div>
      </div>
      {onDownload && (
        <button
          onClick={onDownload}
          className="p-2 rounded-md hover:bg-muted transition-colors"
          aria-label="Download"
        >
          <Download className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

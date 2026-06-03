import { ExportCard } from "./ExportCard";

interface ExportEntry {
  exportId:      string;
  format:        "docx" | "pdf";
  contentHash:   string;
  generatedAt:   string;
  processId:     number;
}

interface ExportHistoryListProps {
  entries:        ExportEntry[];
  filterFormat?:  "docx" | "pdf" | null;
}

export function ExportHistoryList({ entries, filterFormat }: ExportHistoryListProps) {
  const filtered = filterFormat
    ? entries.filter(e => e.format === filterFormat)
    : entries;

  if (filtered.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        Nenhum export encontrado.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {filtered
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
        .map(entry => (
          <ExportCard
            key={entry.exportId}
            format={entry.format}
            filename={`TR_${entry.processId}.${entry.format}`}
            contentHash={entry.contentHash}
            generatedAt={entry.generatedAt}
          />
        ))}
    </div>
  );
}

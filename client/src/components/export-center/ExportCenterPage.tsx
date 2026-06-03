import { useState } from "react";
import { ExportHistoryList } from "./ExportHistoryList";
import { ExportPreviewPanel } from "./ExportPreviewPanel";
import { FileText } from "lucide-react";

interface ExportCenterPageProps {
  organizationId: number;
  processId?:     number;
}

export function ExportCenterPage({ organizationId, processId }: ExportCenterPageProps) {
  const [activeTab, setActiveTab] = useState<"history" | "preview">("history");
  const [filterFormat, setFilterFormat] = useState<"docx" | "pdf" | null>(null);

  // In full implementation, these would come from tRPC hooks
  const exportEntries: Array<{
    exportId: string;
    format: "docx" | "pdf";
    contentHash: string;
    generatedAt: string;
    processId: number;
  }> = [];

  const previewSections = [
    {
      id: "s1",
      title: "Objeto",
      order: 1,
      clauses: [
        { id: "c1", content: "Contratacao de servicos conforme especificacoes." },
      ],
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Export Center
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Generate and manage DOCX/PDF exports
          </p>
        </div>
        <div className="flex gap-2">
          <button
            className="px-4 py-2 text-sm font-medium border rounded-md hover:bg-muted transition-colors"
            onClick={() => {/* trigger DOCX generation */}}
          >
            Gerar DOCX
          </button>
          <button
            className="px-4 py-2 text-sm font-medium border rounded-md hover:bg-muted transition-colors"
            onClick={() => {/* trigger PDF generation */}}
          >
            Gerar PDF
          </button>
        </div>
      </div>

      <div className="flex gap-2 border-b">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "history" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
          }`}
          onClick={() => setActiveTab("history")}
        >
          History
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "preview" ? "border-primary text-primary" : "border-transparent text-muted-foreground"
          }`}
          onClick={() => setActiveTab("preview")}
        >
          Preview
        </button>
      </div>

      {activeTab === "history" && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <button
              className={`px-3 py-1 text-xs rounded ${!filterFormat ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              onClick={() => setFilterFormat(null)}
            >
              All
            </button>
            <button
              className={`px-3 py-1 text-xs rounded ${filterFormat === "docx" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              onClick={() => setFilterFormat("docx")}
            >
              DOCX
            </button>
            <button
              className={`px-3 py-1 text-xs rounded ${filterFormat === "pdf" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
              onClick={() => setFilterFormat("pdf")}
            >
              PDF
            </button>
          </div>
          <ExportHistoryList entries={exportEntries} filterFormat={filterFormat} />
        </div>
      )}

      {activeTab === "preview" && (
        <ExportPreviewPanel sections={previewSections} />
      )}
    </div>
  );
}

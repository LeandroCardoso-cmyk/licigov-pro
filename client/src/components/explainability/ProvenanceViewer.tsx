import { FileText, Rows, Columns } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ProvenanceViewerProps {
  sourceFileName: string;
  parserType:     string;
  parserVersion?: string;
  row?:           number;
  column?:        string | number;
  sheet?:         string;
  cell?:          string;
  extractedAt?:   string;
}

export function ProvenanceViewer({
  sourceFileName,
  parserType,
  parserVersion,
  row,
  column,
  sheet,
  cell,
  extractedAt,
}: ProvenanceViewerProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">Proveniência da Extração</h3>
      <div className="border rounded-lg divide-y text-sm">
        <div className="flex items-center gap-2 px-3 py-2">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-muted-foreground w-24 shrink-0">Arquivo</span>
          <span className="font-mono truncate">{sourceFileName}</span>
        </div>
        <div className="flex items-center gap-2 px-3 py-2">
          <Badge variant="outline" className="text-xs shrink-0">Parser</Badge>
          <span className="text-muted-foreground w-20 shrink-0">Tipo</span>
          <span className="font-mono">{parserType}{parserVersion ? ` v${parserVersion}` : ""}</span>
        </div>
        {sheet && (
          <div className="flex items-center gap-2 px-3 py-2">
            <Columns className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground w-24 shrink-0">Planilha</span>
            <span>{sheet}</span>
          </div>
        )}
        {row != null && (
          <div className="flex items-center gap-2 px-3 py-2">
            <Rows className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground w-24 shrink-0">Linha</span>
            <span className="font-mono">{row}</span>
          </div>
        )}
        {column != null && (
          <div className="flex items-center gap-2 px-3 py-2">
            <Columns className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground w-24 shrink-0">Coluna</span>
            <span className="font-mono">{column}</span>
          </div>
        )}
        {cell && (
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-muted-foreground w-24 shrink-0">Célula</span>
            <span className="font-mono">{cell}</span>
          </div>
        )}
        {extractedAt && (
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-muted-foreground w-24 shrink-0">Extraído em</span>
            <span className="text-xs">{new Date(extractedAt).toLocaleString("pt-BR")}</span>
          </div>
        )}
      </div>
    </div>
  );
}

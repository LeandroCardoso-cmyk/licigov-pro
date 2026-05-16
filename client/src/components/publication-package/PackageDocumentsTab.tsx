import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, FileText, Loader2 } from "lucide-react";

interface Doc {
  id: number;
  type: string;
  version: number;
  createdAt: Date | string;
}

interface Item {
  id: number;
}

interface Props {
  documents: Doc[];
  items: Item[];
  platformName?: string | null;
  downloadPending: boolean;
  onDownloadAll: () => void;
}

export function PackageDocumentsTab({ documents, items, platformName, downloadPending, onDownloadAll }: Props) {
  const DOC_LABELS: Record<string, string> = {
    etp: "Estudo Técnico Preliminar (ETP)",
    tr: "Termo de Referência (TR)",
    dfd: "Documento Formalizador de Demanda (DFD)",
    edital: "Edital",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documentos Gerados</CardTitle>
        <CardDescription>Baixe os documentos individualmente ou todos de uma vez</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={onDownloadAll} className="w-full" size="lg" disabled={downloadPending}>
          {downloadPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          {downloadPending ? "Gerando pacote..." : "Baixar Todos os Documentos (.ZIP)"}
        </Button>

        <div className="space-y-2">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">{DOC_LABELS[doc.type] ?? doc.type}</p>
                  <p className="text-xs text-muted-foreground">
                    Versão {doc.version} • {new Date(doc.createdAt).toLocaleDateString("pt-BR")}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline"><Download className="h-4 w-4 mr-1" />PDF</Button>
                <Button size="sm" variant="outline"><Download className="h-4 w-4 mr-1" />DOCX</Button>
              </div>
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <div className="pt-4 border-t">
            <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium">Planilha de Itens CATMAT/CATSER</p>
                  <p className="text-xs text-muted-foreground">
                    {items.length} {items.length === 1 ? "item" : "itens"} • Formato {platformName || "padrão"}
                  </p>
                </div>
              </div>
              <Button size="sm" variant="outline"><Download className="h-4 w-4 mr-1" />XLSX</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

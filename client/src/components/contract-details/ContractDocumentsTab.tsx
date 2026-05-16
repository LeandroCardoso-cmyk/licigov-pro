import { FileText, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { ContractDocument } from "./types";

interface Props {
  documents: ContractDocument[] | undefined;
  generateMinutaIsPending: boolean;
  onGenerateMinuta: () => void;
  onOpenRescission: () => void;
  onDownloadDocument: (doc: ContractDocument) => void;
}

export function ContractDocumentsTab({
  documents,
  generateMinutaIsPending,
  onGenerateMinuta,
  onOpenRescission,
  onDownloadDocument,
}: Props) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Documentos do Contrato</h3>
        <p className="text-sm text-muted-foreground">
          Gere e gerencie documentos relacionados ao contrato
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Button
          variant="outline"
          className="h-auto py-4"
          onClick={onGenerateMinuta}
          disabled={generateMinutaIsPending}
        >
          <div className="flex flex-col items-start w-full">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-5 w-5" />
              <span className="font-semibold">
                {generateMinutaIsPending ? "Gerando..." : "Minuta de Contrato"}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              Gerar minuta baseada na Lei 14.133/2021
            </span>
          </div>
        </Button>

        <Button variant="outline" className="h-auto py-4" onClick={onOpenRescission}>
          <div className="flex flex-col items-start w-full">
            <div className="flex items-center gap-2 mb-1">
              <FileText className="h-5 w-5" />
              <span className="font-semibold">Termo de Rescisão</span>
            </div>
            <span className="text-xs text-muted-foreground">
              Gerar termo de rescisão contratual
            </span>
          </div>
        </Button>
      </div>

      {documents && documents.length > 0 ? (
        <div className="space-y-4">
          <h4 className="font-semibold">Documentos Gerados</h4>
          {documents.map((doc) => (
            <Card key={doc.id}>
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="font-medium capitalize">{doc.type.replace("_", " ")}</p>
                      <p className="text-sm text-muted-foreground">
                        Gerado{" "}
                        {formatDistanceToNow(new Date(doc.createdAt), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => onDownloadDocument(doc)}>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">Nenhum documento gerado ainda</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

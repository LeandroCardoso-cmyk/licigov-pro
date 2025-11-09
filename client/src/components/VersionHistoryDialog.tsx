import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { History, RotateCcw, Eye, Clock } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Streamdown } from "streamdown";

interface VersionHistoryDialogProps {
  documentId: number;
  documentType: string;
}

export function VersionHistoryDialog({ documentId, documentType }: VersionHistoryDialogProps) {
  const [open, setOpen] = useState(false);
  const [versionToRestore, setVersionToRestore] = useState<number | null>(null);
  const [previewVersion, setPreviewVersion] = useState<any | null>(null);

  const utils = trpc.useUtils();

  const { data: versions = [], isLoading } = trpc.documents.getVersionHistory.useQuery(
    { documentId },
    { enabled: open }
  );

  const restoreVersionMutation = trpc.documents.restoreVersion.useMutation({
    onSuccess: () => {
      toast.success("Versão restaurada com sucesso!");
      setVersionToRestore(null);
      setOpen(false);
      utils.documents.listByProcess.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao restaurar versão");
    },
  });

  const handleRestoreVersion = (versionId: number) => {
    restoreVersionMutation.mutate({
      documentId,
      versionId,
    });
  };

  const documentTypeLabels: Record<string, string> = {
    etp: "ETP",
    tr: "TR",
    dfd: "DFD",
    edital: "Edital",
  };

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <History className="mr-2 h-4 w-4" />
            Ver Histórico
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Histórico de Versões - {documentTypeLabels[documentType]}</DialogTitle>
            <DialogDescription>
              Visualize e restaure versões anteriores do documento
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-4 flex-1 overflow-hidden">
            {/* Lista de versões */}
            <div className="w-1/3 border-r pr-4">
              <ScrollArea className="h-[500px]">
                {isLoading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Carregando versões...
                  </div>
                ) : versions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <History className="mx-auto h-12 w-12 mb-2 opacity-50" />
                    <p>Nenhuma versão anterior</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {versions.map((version, index) => (
                      <div
                        key={version.id}
                        className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                          previewVersion?.id === version.id
                            ? "bg-accent border-primary"
                            : "hover:bg-accent/50"
                        }`}
                        onClick={() => setPreviewVersion(version)}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Badge variant={index === 0 ? "default" : "secondary"}>
                            Versão {version.version}
                          </Badge>
                          {index === 0 && (
                            <Badge variant="outline" className="text-xs">
                              Atual
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(new Date(version.createdAt), {
                            addSuffix: true,
                            locale: ptBR,
                          })}
                        </div>
                        {index !== 0 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="w-full mt-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              setVersionToRestore(version.id);
                            }}
                            disabled={restoreVersionMutation.isPending}
                          >
                            <RotateCcw className="mr-2 h-3 w-3" />
                            Restaurar
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Preview da versão */}
            <div className="flex-1 overflow-hidden">
              {previewVersion ? (
                <div className="h-full flex flex-col">
                  <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                    <Eye className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      Preview - Versão {previewVersion.version}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(previewVersion.createdAt).toLocaleString("pt-BR")}
                    </span>
                  </div>
                  <ScrollArea className="flex-1">
                    <div className="prose prose-sm dark:prose-invert max-w-none pr-4">
                      <Streamdown>{previewVersion.content || ""}</Streamdown>
                    </div>
                  </ScrollArea>
                </div>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  <div className="text-center">
                    <Eye className="mx-auto h-12 w-12 mb-2 opacity-50" />
                    <p>Selecione uma versão para visualizar</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={versionToRestore !== null}
        onOpenChange={() => setVersionToRestore(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restaurar Versão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja restaurar esta versão? Uma nova versão será criada com o
              conteúdo restaurado, preservando o histórico.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => versionToRestore && handleRestoreVersion(versionToRestore)}
            >
              Restaurar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

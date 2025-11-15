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
import { History, RotateCcw, Eye, Clock, GitCompare } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import DiffMatchPatch from "diff-match-patch";

interface VersionHistoryDialogProps {
  documentId: number;
  documentType: string;
}

export function VersionHistoryDialog({ documentId, documentType }: VersionHistoryDialogProps) {
  const [open, setOpen] = useState(false);
  const [versionToRestore, setVersionToRestore] = useState<number | null>(null);
  const [previewVersion, setPreviewVersion] = useState<any | null>(null);
  const [compareVersion, setCompareVersion] = useState<any | null>(null);

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

  // Função para gerar diff HTML
  const generateDiffHtml = (oldText: string, newText: string) => {
    const dmp = new DiffMatchPatch();
    const diffs = dmp.diff_main(oldText, newText);
    dmp.diff_cleanupSemantic(diffs);
    
    return diffs.map(([type, text], index) => {
      if (type === 0) {
        // Sem mudança
        return <span key={index}>{text}</span>;
      } else if (type === -1) {
        // Removido
        return (
          <span key={index} className="bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200 line-through">
            {text}
          </span>
        );
      } else {
        // Adicionado
        return (
          <span key={index} className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
            {text}
          </span>
        );
      }
    });
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
        <DialogContent className="max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Histórico de Versões - {documentTypeLabels[documentType]}</DialogTitle>
            <DialogDescription>
              Visualize, compare e restaure versões anteriores do documento
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-4 flex-1 overflow-hidden">
            {/* Timeline de versões */}
            <div className="w-1/4 border-r pr-4">
              <ScrollArea className="h-[550px]">
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
                  <div className="relative">
                    {/* Linha vertical da timeline */}
                    <div className="absolute left-[18px] top-4 bottom-4 w-0.5 bg-border" />
                    
                    <div className="space-y-3">
                      {versions.map((version, index) => (
                        <div
                          key={version.id}
                          className="relative pl-10"
                        >
                          {/* Ponto da timeline */}
                          <div className={`absolute left-0 top-3 w-9 h-9 rounded-full border-2 flex items-center justify-center ${
                            index === 0 
                              ? "bg-primary border-primary text-primary-foreground" 
                              : previewVersion?.id === version.id
                              ? "bg-accent border-primary"
                              : "bg-background border-border"
                          }`}>
                            <span className="text-xs font-bold">{version.version}</span>
                          </div>

                          <div
                            className={`p-3 border rounded-lg cursor-pointer transition-all ${
                              previewVersion?.id === version.id
                                ? "bg-accent border-primary shadow-sm"
                                : "hover:bg-accent/50"
                            }`}
                            onClick={() => setPreviewVersion(version)}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <Badge variant={index === 0 ? "default" : "secondary"} className="text-xs">
                                v{version.version}
                              </Badge>
                              {index === 0 && (
                                <Badge variant="outline" className="text-xs">
                                  Atual
                                </Badge>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
                              <Clock className="h-3 w-3" />
                              {formatDistanceToNow(new Date(version.createdAt), {
                                addSuffix: true,
                                locale: ptBR,
                              })}
                            </div>
                            <div className="flex gap-1">
                              {index !== 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs flex-1"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setVersionToRestore(version.id);
                                  }}
                                  disabled={restoreVersionMutation.isPending}
                                >
                                  <RotateCcw className="mr-1 h-3 w-3" />
                                  Restaurar
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs flex-1"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCompareVersion(version);
                                }}
                              >
                                <GitCompare className="mr-1 h-3 w-3" />
                                Comparar
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </ScrollArea>
            </div>

            {/* Preview e Comparação */}
            <div className="flex-1 overflow-hidden">
              {previewVersion ? (
                <Tabs defaultValue="preview" className="h-full flex flex-col">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="preview">
                      <Eye className="mr-2 h-4 w-4" />
                      Preview
                    </TabsTrigger>
                    <TabsTrigger value="compare" disabled={!compareVersion}>
                      <GitCompare className="mr-2 h-4 w-4" />
                      Comparar
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="preview" className="flex-1 overflow-hidden mt-4">
                    <div className="h-full flex flex-col">
                      <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                        <Eye className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">
                          Versão {previewVersion.version}
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
                  </TabsContent>

                  <TabsContent value="compare" className="flex-1 overflow-hidden mt-4">
                    {compareVersion && (
                      <div className="h-full flex flex-col">
                        <div className="flex items-center gap-2 mb-3 pb-3 border-b">
                          <GitCompare className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">
                            Comparando v{compareVersion.version} → v{previewVersion.version}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCompareVersion(null)}
                          >
                            Limpar
                          </Button>
                        </div>
                        <ScrollArea className="flex-1">
                          <div className="prose prose-sm dark:prose-invert max-w-none pr-4">
                            <div className="font-mono text-sm whitespace-pre-wrap">
                              {generateDiffHtml(
                                compareVersion.content || "",
                                previewVersion.content || ""
                              )}
                            </div>
                          </div>
                        </ScrollArea>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
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

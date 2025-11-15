import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, Loader2, AlertCircle, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

interface CatmatSuggestionsModalProps {
  open: boolean;
  onClose: () => void;
  processItemId: number;
  itemDescription: string;
  itemType: "material" | "service";
  onApproved?: () => void;
}

export default function CatmatSuggestionsModal({
  open,
  onClose,
  processItemId,
  itemDescription,
  itemType,
  onApproved,
}: CatmatSuggestionsModalProps) {
  const [generatingSuggestions, setGeneratingSuggestions] = useState(false);
  const [suggestionsGenerated, setSuggestionsGenerated] = useState(false);

  const utils = trpc.useUtils();

  // Query para buscar sugestões existentes
  const { data: suggestions, isLoading: loadingSuggestions } = trpc.processes.getCatmatSuggestions.useQuery(
    { processItemId },
    { enabled: open && suggestionsGenerated }
  );

  // Mutation para gerar sugestões
  const generateSuggestions = trpc.processes.generateCatmatSuggestions.useMutation({
    onSuccess: () => {
      setSuggestionsGenerated(true);
      toast.success("Sugestões geradas com sucesso!");
    },
    onError: (error) => {
      toast.error(`Erro ao gerar sugestões: ${error.message}`);
      setGeneratingSuggestions(false);
    },
  });

  // Mutation para aprovar sugestão
  const approveSuggestion = trpc.processes.approveCatmatSuggestion.useMutation({
    onSuccess: () => {
      toast.success("Código CATMAT aplicado com sucesso!");
      utils.processes.getProcessItems.invalidate();
      onApproved?.();
      onClose();
    },
    onError: (error) => {
      toast.error(`Erro ao aprovar sugestão: ${error.message}`);
    },
  });

  // Mutation para rejeitar sugestão
  const rejectSuggestion = trpc.processes.rejectCatmatSuggestion.useMutation({
    onSuccess: () => {
      toast.info("Sugestão rejeitada");
      utils.processes.getCatmatSuggestions.invalidate({ processItemId });
    },
    onError: (error) => {
      toast.error(`Erro ao rejeitar sugestão: ${error.message}`);
    },
  });

  const handleGenerateSuggestions = async () => {
    setGeneratingSuggestions(true);
    await generateSuggestions.mutateAsync({
      processItemId,
      description: itemDescription,
      itemType,
    });
    setGeneratingSuggestions(false);
  };

  const handleApprove = (suggestionId: number) => {
    approveSuggestion.mutate({ suggestionId, processItemId });
  };

  const handleReject = (suggestionId: number) => {
    rejectSuggestion.mutate({ suggestionId });
  };

  const getConfidenceColor = (score: number) => {
    if (score >= 80) return "bg-green-500";
    if (score >= 60) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getConfidenceLabel = (score: number) => {
    if (score >= 80) return "Alta Confiança";
    if (score >= 60) return "Média Confiança";
    return "Baixa Confiança";
  };

  const catalogType = itemType === "material" ? "CATMAT" : "CATSER";
  const pendingSuggestions = suggestions?.filter((s) => s.status === "pending") || [];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Sugestões Inteligentes de Código {catalogType}
          </DialogTitle>
          <DialogDescription>
            A IA analisou o item e sugere os códigos mais adequados do catálogo oficial
          </DialogDescription>
        </DialogHeader>

        {/* Informações do Item */}
        <Card className="bg-muted/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Item a ser catalogado</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{itemDescription}</p>
            <Badge variant="outline" className="mt-2">
              {itemType === "material" ? "Material" : "Serviço"}
            </Badge>
          </CardContent>
        </Card>

        {/* Botão para gerar sugestões */}
        {!suggestionsGenerated && !loadingSuggestions && (
          <div className="flex flex-col items-center gap-4 py-8">
            <AlertCircle className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground text-center">
              Clique no botão abaixo para gerar sugestões de códigos {catalogType} usando Inteligência Artificial
            </p>
            <Button
              onClick={handleGenerateSuggestions}
              disabled={generatingSuggestions}
              size="lg"
              className="gap-2"
            >
              {generatingSuggestions ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Gerando sugestões...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Gerar Sugestões com IA
                </>
              )}
            </Button>
          </div>
        )}

        {/* Loading state */}
        {loadingSuggestions && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Carregando sugestões...</p>
          </div>
        )}

        {/* Lista de sugestões */}
        {suggestionsGenerated && !loadingSuggestions && (
          <div className="space-y-4">
            {pendingSuggestions.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center gap-2 py-8">
                  <AlertCircle className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    Nenhuma sugestão pendente. Todas foram aprovadas ou rejeitadas.
                  </p>
                </CardContent>
              </Card>
            ) : (
              pendingSuggestions.map((suggestion, index) => (
                <Card key={suggestion.id} className="border-2">
                  <CardHeader>
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Badge variant="secondary">#{index + 1}</Badge>
                          Código {catalogType}: {suggestion.catmatCode}
                        </CardTitle>
                        <CardDescription className="mt-2">{suggestion.description}</CardDescription>
                      </div>
                      <Badge className={`${getConfidenceColor(suggestion.confidenceScore)} text-white`}>
                        {suggestion.confidenceScore}% - {getConfidenceLabel(suggestion.confidenceScore)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Justificativa */}
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-sm font-medium mb-2">💡 Justificativa Técnica:</p>
                      <p className="text-sm text-muted-foreground">{suggestion.reasoning}</p>
                    </div>

                    {/* Botões de ação */}
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleApprove(suggestion.id)}
                        disabled={approveSuggestion.isPending}
                        className="flex-1 gap-2"
                        variant="default"
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Aprovar e Aplicar
                      </Button>
                      <Button
                        onClick={() => handleReject(suggestion.id)}
                        disabled={rejectSuggestion.isPending}
                        className="flex-1 gap-2"
                        variant="outline"
                      >
                        <XCircle className="h-4 w-4" />
                        Rejeitar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        )}

        {/* Botão de fechar */}
        <div className="flex justify-end pt-4">
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

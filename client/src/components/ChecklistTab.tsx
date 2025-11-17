import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, Circle, FileText, Upload, Settings, Archive, Info } from "lucide-react";

interface ChecklistTabProps {
  contractId: number;
  platformId: number;
}

/**
 * Componente de Checklist da Plataforma
 * Exibe passos específicos da plataforma selecionada
 */
export function ChecklistTab({ contractId, platformId }: ChecklistTabProps) {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  // Queries
  const { data: platform, isLoading: loadingPlatform } = trpc.directContracts.platforms.getById.useQuery({
    id: platformId,
  });

  const { data: checklists, isLoading: loadingChecklists } = trpc.directContracts.platforms.getChecklists.useQuery({
    platformId,
  });

  // Buscar progresso salvo
  const { data: progress } = trpc.directContracts.checklist.getProgress.useQuery({
    contractId,
  });

  // Mutation para salvar progresso
  const saveProgressMutation = trpc.directContracts.checklist.saveProgress.useMutation();

  // Carregar progresso salvo ao montar o componente
  useEffect(() => {
    if (progress && progress.length > 0) {
      const completed = new Set(progress.filter((p) => p.isCompleted).map((p) => p.stepNumber));
      setCompletedSteps(completed);
    }
  }, [progress]);

  const toggleStep = async (stepNumber: number) => {
    const isCurrentlyCompleted = completedSteps.has(stepNumber);
    const newIsCompleted = !isCurrentlyCompleted;

    // Atualizar estado local imediatamente (otimista)
    setCompletedSteps((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(stepNumber)) {
        newSet.delete(stepNumber);
      } else {
        newSet.add(stepNumber);
      }
      return newSet;
    });

    // Salvar no banco de dados
    try {
      await saveProgressMutation.mutateAsync({
        contractId,
        stepNumber,
        isCompleted: newIsCompleted,
      });
    } catch (error) {
      // Reverter em caso de erro
      setCompletedSteps((prev) => {
        const newSet = new Set(prev);
        if (isCurrentlyCompleted) {
          newSet.add(stepNumber);
        } else {
          newSet.delete(stepNumber);
        }
        return newSet;
      });
      console.error("Erro ao salvar progresso:", error);
    }
  };

  const getCategoryIcon = (category: string | null) => {
    switch (category) {
      case "Cadastro":
        return <Settings className="w-5 h-5 text-blue-600" />;
      case "Dados Básicos":
        return <FileText className="w-5 h-5 text-purple-600" />;
      case "Upload de Documentos":
        return <Upload className="w-5 h-5 text-orange-600" />;
      case "Publicação":
        return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case "Arquivamento":
        return <Archive className="w-5 h-5 text-gray-600" />;
      default:
        return <Circle className="w-5 h-5 text-gray-400" />;
    }
  };

  if (loadingPlatform || loadingChecklists) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-gray-600 dark:text-gray-400">Carregando checklist...</p>
        </CardContent>
      </Card>
    );
  }

  if (!platform || !checklists || checklists.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-center text-gray-600 dark:text-gray-400">
            Nenhum checklist disponível para esta plataforma
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalSteps = checklists.length;
  const completedCount = completedSteps.size;
  const progressPercentage = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Header com progresso */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>Checklist: {platform.name}</CardTitle>
              <CardDescription>{platform.description}</CardDescription>
            </div>
            <Badge variant={completedCount === totalSteps ? "default" : "secondary"} className="text-lg px-4 py-2">
              {completedCount} / {totalSteps}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600 dark:text-gray-400">Progresso</span>
              <span className="font-medium">{Math.round(progressPercentage)}%</span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* Alerta informativo */}
      <Alert>
        <Info className="w-4 h-4" />
        <AlertDescription>
          Este checklist é um guia para auxiliar na publicação da contratação direta na plataforma{" "}
          <strong>{platform.name}</strong>. Marque os passos conforme forem concluídos.
        </AlertDescription>
      </Alert>

      {/* Lista de passos */}
      <div className="space-y-4">
        {checklists.map((item) => {
          const isCompleted = completedSteps.has(item.stepNumber);
          const fields = item.fields ? JSON.parse(item.fields as string) : [];
          const requiredDocs = item.requiredDocuments ? JSON.parse(item.requiredDocuments as string) : [];

          return (
            <Card key={item.id} className={isCompleted ? "border-green-500 bg-green-50 dark:bg-green-950" : ""}>
              <CardHeader>
                <div className="flex items-start gap-4">
                  <Checkbox
                    checked={isCompleted}
                    onCheckedChange={() => toggleStep(item.stepNumber)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      {getCategoryIcon(item.category)}
                      <div>
                        <CardTitle className="text-lg">
                          Passo {item.stepNumber}: {item.title}
                        </CardTitle>
                        {item.category && (
                          <Badge variant="outline" className="mt-1">
                            {item.category}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <CardDescription className="text-base">{item.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>

              {(fields.length > 0 || requiredDocs.length > 0) && (
                <CardContent className="pt-0">
                  {/* Campos a preencher */}
                  {fields.length > 0 && (
                    <div className="mb-4">
                      <h4 className="font-medium text-sm mb-2 text-gray-700 dark:text-gray-300">
                        Campos a preencher:
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 dark:text-gray-400">
                        {fields.map((field: any, idx: number) => (
                          <li key={idx}>
                            <strong>{field.label}</strong>
                            {field.copyFrom && (
                              <span className="text-xs text-gray-500"> (copiar de: {field.copyFrom})</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Documentos necessários */}
                  {requiredDocs.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2 text-gray-700 dark:text-gray-300">
                        Documentos necessários:
                      </h4>
                      <ul className="list-disc list-inside space-y-1 text-sm text-gray-600 dark:text-gray-400">
                        {requiredDocs.map((doc: any, idx: number) => (
                          <li key={idx}>
                            <strong>{doc.filename}</strong>
                            {doc.type && <span className="text-xs text-gray-500"> ({doc.type})</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* Resumo final */}
      {completedCount === totalSteps && (
        <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <AlertDescription className="text-green-800 dark:text-green-200">
            <strong>Parabéns!</strong> Todos os passos do checklist foram concluídos. A contratação direta está pronta
            para publicação na plataforma {platform.name}.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Circle } from "lucide-react";

/**
 * Dialog de preview de instruções de templates
 */
export function TemplatePreviewDialog({
  open,
  onOpenChange,
  platformName,
  instructions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platformName: string;
  instructions: {
    general?: string;
    etp?: string;
    tr?: string;
    dfd?: string;
    edital?: string;
  };
}) {
  const hasInstructions =
    instructions.general ||
    instructions.etp ||
    instructions.tr ||
    instructions.dfd ||
    instructions.edital;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview de Instruções - {platformName}</DialogTitle>
          <DialogDescription>
            Visualize como as instruções serão aplicadas na geração de documentos
          </DialogDescription>
        </DialogHeader>

        {!hasInstructions ? (
          <div className="py-12 text-center text-muted-foreground">
            <p>Nenhuma instrução personalizada definida.</p>
            <p className="text-sm mt-2">
              O sistema usará as instruções padrão (fallback).
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Instruções Gerais */}
            {instructions.general && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    Instruções Gerais
                  </CardTitle>
                  <CardDescription>
                    Aplicadas em todos os tipos de documentos
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded-md">
                    {instructions.general}
                  </pre>
                </CardContent>
              </Card>
            )}

            {/* Instruções Específicas */}
            <div className="grid grid-cols-2 gap-4">
              {instructions.etp && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-xs flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                      ETP
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-2">
                    <pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded-md max-h-32 overflow-y-auto">
                      {instructions.etp}
                    </pre>
                  </CardContent>
                </Card>
              )}

              {instructions.tr && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-xs flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                      TR
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-2">
                    <pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded-md max-h-32 overflow-y-auto">
                      {instructions.tr}
                    </pre>
                  </CardContent>
                </Card>
              )}

              {instructions.dfd && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-xs flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                      DFD
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-2">
                    <pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded-md max-h-32 overflow-y-auto">
                      {instructions.dfd}
                    </pre>
                  </CardContent>
                </Card>
              )}

              {instructions.edital && (
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-xs flex items-center gap-2">
                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                      Edital
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-2">
                    <pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded-md max-h-32 overflow-y-auto">
                      {instructions.edital}
                    </pre>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Resumo */}
            <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Como será aplicado</CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <p className="text-xs text-muted-foreground">
                  Quando você gerar um documento (ex: ETP) para um processo com esta
                  plataforma selecionada, a IA receberá:
                </p>
                <ol className="text-xs text-muted-foreground mt-2 space-y-1 list-decimal list-inside">
                  <li>As instruções gerais (se definidas)</li>
                  <li>As instruções específicas do tipo de documento (ex: ETP)</li>
                  <li>
                    O documento será adaptado automaticamente conforme essas instruções
                  </li>
                </ol>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Dialog de preview de checklist
 */
export function ChecklistPreviewDialog({
  open,
  onOpenChange,
  platformName,
  checklist,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platformName: string;
  checklist: any[];
}) {
  // Agrupar por categoria
  const groupedByCategory = checklist.reduce((acc, step) => {
    const category = step.category || "Sem Categoria";
    if (!acc[category]) acc[category] = [];
    acc[category].push(step);
    return {};
  }, {} as Record<string, any[]>);

  const totalSteps = checklist.length;
  const optionalSteps = checklist.filter((s) => s.isOptional).length;
  const requiredSteps = totalSteps - optionalSteps;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Preview de Checklist - {platformName}</DialogTitle>
          <DialogDescription>
            Visualize como o checklist aparecerá para os usuários
          </DialogDescription>
        </DialogHeader>

        {checklist.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground">
            <p>Nenhum passo cadastrado neste checklist.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Resumo */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Resumo</CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <div className="flex gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground">Total:</span>{" "}
                    <span className="font-semibold">{totalSteps} passos</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Obrigatórios:</span>{" "}
                    <span className="font-semibold">{requiredSteps}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Opcionais:</span>{" "}
                    <span className="font-semibold">{optionalSteps}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Passos */}
            <div className="space-y-3">
              {Object.entries(groupedByCategory).map(([category, steps]) => (
                <div key={category}>
                  <h3 className="text-sm font-semibold mb-2 text-primary">
                    {category}
                  </h3>
                  <div className="space-y-2">
                    {(steps as any[]).map((step) => (
                      <Card key={step.id} className="border-l-4 border-l-primary">
                        <CardHeader className="py-3">
                          <div className="flex items-start gap-3">
                            <Circle className="h-5 w-5 mt-0.5 text-muted-foreground" />
                            <div className="flex-1">
                              <CardTitle className="text-sm flex items-center gap-2">
                                Passo {step.stepNumber}: {step.title}
                                {step.isOptional && (
                                  <Badge variant="outline" className="text-xs">
                                    Opcional
                                  </Badge>
                                )}
                              </CardTitle>
                              {step.description && (
                                <CardDescription className="text-xs mt-1">
                                  {step.description}
                                </CardDescription>
                              )}
                            </div>
                          </div>
                        </CardHeader>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Nota */}
            <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Como será exibido</CardTitle>
              </CardHeader>
              <CardContent className="py-2">
                <p className="text-xs text-muted-foreground">
                  Este checklist aparecerá no modal "Preparar para Publicação" quando o
                  usuário selecionar esta plataforma em um processo. Os usuários poderão
                  marcar cada passo como concluído conforme avançam.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, Loader2, ClipboardCheck, Copy, ExternalLink } from "lucide-react";

interface ChecklistStep {
  stepNumber: number;
  title: string;
  description?: string | null;
  category?: string | null;
  isOptional?: boolean;
  fields?: unknown;
  requiredDocuments?: unknown;
}

interface Platform {
  id: number;
  name: string;
  websiteUrl?: string | null;
}

interface Props {
  platform: Platform | null | undefined;
  checklist: ChecklistStep[];
  checklistByCategory: Record<string, ChecklistStep[]>;
  completedSteps: number[];
  downloadChecklistPDFPending: boolean;
  onToggleStep: (stepNumber: number) => void;
  onExportPDF: () => void;
  onCopyField: (text: string, fieldName: string) => void;
}

export function PackageChecklistTab({
  platform, checklist, checklistByCategory, completedSteps,
  downloadChecklistPDFPending, onToggleStep, onExportPDF, onCopyField,
}: Props) {
  if (!platform) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <ClipboardCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Nenhuma plataforma selecionada</p>
          <p className="text-sm mt-2">Selecione uma plataforma no processo para ver o checklist de publicação</p>
        </CardContent>
      </Card>
    );
  }

  if (checklist.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <ClipboardCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Checklist ainda não disponível para esta plataforma</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold">Checklist de Publicação - {platform.name}</h3>
          <p className="text-sm text-muted-foreground">{completedSteps.length} de {checklist.length} passos concluídos</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onExportPDF} disabled={downloadChecklistPDFPending}>
            {downloadChecklistPDFPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            {downloadChecklistPDFPending ? "Gerando..." : "Exportar PDF"}
          </Button>
          <Badge variant={completedSteps.length === checklist.length ? "default" : "secondary"}>
            {Math.round((completedSteps.length / checklist.length) * 100)}% completo
          </Badge>
        </div>
      </div>

      {Object.entries(checklistByCategory).map(([category, steps]) => (
        <Card key={category}>
          <CardHeader><CardTitle className="text-base">{category}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {steps.map((step) => (
              <div
                key={step.stepNumber}
                className={`border rounded-lg p-4 transition-all ${
                  completedSteps.includes(step.stepNumber) ? "bg-primary/5 border-primary/20" : "hover:bg-accent/50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={completedSteps.includes(step.stepNumber)}
                    onCheckedChange={() => onToggleStep(step.stepNumber)}
                    className="mt-1"
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-medium">{step.stepNumber}. {step.title}</span>
                      {step.isOptional && <Badge variant="outline" className="text-xs">Opcional</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">{step.description}</p>
                    {Array.isArray(step.fields) && (step.fields as any[]).length > 0 && (
                      <div className="space-y-2 mb-3">
                        {(step.fields as any[]).map((field: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between bg-background p-2 rounded border">
                            <span className="text-sm font-medium">{field.label}:</span>
                            <Button size="sm" variant="ghost" onClick={() => onCopyField(field.value || "", field.label)}>
                              <Copy className="h-3 w-3 mr-1" />Copiar
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                    {Array.isArray(step.requiredDocuments) && (step.requiredDocuments as any[]).length > 0 && (
                      <div className="text-sm">
                        <p className="font-medium mb-1">Documentos necessários:</p>
                        <ul className="list-disc list-inside text-muted-foreground">
                          {(step.requiredDocuments as any[]).map((doc: any, idx: number) => (
                            <li key={idx}>{doc.type}: {doc.filename}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      {platform.websiteUrl && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Acessar plataforma</p>
                <p className="text-sm text-muted-foreground">{platform.websiteUrl}</p>
              </div>
              <Button onClick={() => window.open(platform.websiteUrl!, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="h-4 w-4 mr-2" />Abrir
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

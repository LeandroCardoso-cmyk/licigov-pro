import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { 
  Download, 
  FileText, 
  CheckCircle2, 
  Copy, 
  ExternalLink,
  Package,
  ClipboardCheck,
  Loader2
} from "lucide-react";

interface PublicationPackageModalProps {
  processId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PublicationPackageModal({ processId, open, onOpenChange }: PublicationPackageModalProps) {
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  // Buscar pacote de publicação
  const { data: packageData, isLoading } = trpc.platforms.generatePublicationPackage.useQuery(
    { processId },
    { enabled: open }
  );

  const handleCopyField = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${fieldName} copiado!`);
  };

  const toggleStep = (stepNumber: number) => {
    setCompletedSteps(prev => 
      prev.includes(stepNumber) 
        ? prev.filter(s => s !== stepNumber)
        : [...prev, stepNumber]
    );
  };

  // Mutation para baixar pacote ZIP
  const downloadPackageMutation = trpc.downloads.publicationPackage.useMutation({
    onSuccess: (data) => {
      // Converter base64 para blob e fazer download
      const byteCharacters = atob(data.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: data.mimeType });
      
      // Criar link de download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success("Pacote baixado com sucesso!");
    },
    onError: () => {
      toast.error("Erro ao gerar pacote. Tente novamente.");
    },
  });

  const handleDownloadAll = () => {
    downloadPackageMutation.mutate({ processId });
  };

  // Mutation para baixar checklist PDF
  const downloadChecklistPDFMutation = trpc.downloads.checklistPDF.useMutation({
    onSuccess: (data) => {
      // Converter base64 para blob e fazer download
      const byteCharacters = atob(data.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: data.mimeType });
      
      // Criar link de download
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success("Checklist exportado com sucesso!");
    },
    onError: () => {
      toast.error("Erro ao exportar checklist. Tente novamente.");
    },
  });

  const handleExportChecklistPDF = () => {
    if (!platform?.id) {
      toast.error("Nenhuma plataforma selecionada");
      return;
    }
    downloadChecklistPDFMutation.mutate({ processId, platformId: platform.id });
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!packageData) {
    return null;
  }

  const { process, platform, documents, items, checklist, settings } = packageData;

  // Agrupar checklist por categoria
  const checklistByCategory = checklist.reduce((acc, step) => {
    const category = step.category || "Outros";
    if (!acc[category]) acc[category] = [];
    acc[category].push(step);
    return acc;
  }, {} as Record<string, typeof checklist>);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Pacote de Publicação
          </DialogTitle>
          <DialogDescription>
            {platform 
              ? `Documentos e checklist para publicação na plataforma ${platform.name}`
              : "Documentos prontos para publicação"}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="documents" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="documents">
              <FileText className="h-4 w-4 mr-2" />
              Documentos
            </TabsTrigger>
            <TabsTrigger value="checklist">
              <ClipboardCheck className="h-4 w-4 mr-2" />
              Checklist
            </TabsTrigger>
            <TabsTrigger value="data">
              <Copy className="h-4 w-4 mr-2" />
              Dados
            </TabsTrigger>
          </TabsList>

          {/* Aba de Documentos */}
          <TabsContent value="documents" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Documentos Gerados</CardTitle>
                <CardDescription>
                  Baixe os documentos individualmente ou todos de uma vez
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  onClick={handleDownloadAll} 
                  className="w-full" 
                  size="lg"
                  disabled={downloadPackageMutation.isPending}
                >
                  {downloadPackageMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 mr-2" />
                  )}
                  {downloadPackageMutation.isPending ? "Gerando pacote..." : "Baixar Todos os Documentos (.ZIP)"}
                </Button>

                <div className="space-y-2">
                  {documents.map((doc) => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium">
                            {doc.type === "etp" && "Estudo Técnico Preliminar (ETP)"}
                            {doc.type === "tr" && "Termo de Referência (TR)"}
                            {doc.type === "dfd" && "Documento Formalizador de Demanda (DFD)"}
                            {doc.type === "edital" && "Edital"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Versão {doc.version} • {new Date(doc.createdAt).toLocaleDateString("pt-BR")}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline">
                          <Download className="h-4 w-4 mr-1" />
                          PDF
                        </Button>
                        <Button size="sm" variant="outline">
                          <Download className="h-4 w-4 mr-1" />
                          DOCX
                        </Button>
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
                            {items.length} {items.length === 1 ? "item" : "itens"} • Formato {platform?.name || "padrão"}
                          </p>
                        </div>
                      </div>
                      <Button size="sm" variant="outline">
                        <Download className="h-4 w-4 mr-1" />
                        XLSX
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Aba de Checklist */}
          <TabsContent value="checklist" className="space-y-4">
            {!platform ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <ClipboardCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Nenhuma plataforma selecionada</p>
                  <p className="text-sm mt-2">
                    Selecione uma plataforma no processo para ver o checklist de publicação
                  </p>
                </CardContent>
              </Card>
            ) : checklist.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  <ClipboardCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Checklist ainda não disponível para esta plataforma</p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold">Checklist de Publicação - {platform.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {completedSteps.length} de {checklist.length} passos concluídos
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleExportChecklistPDF}
                      disabled={downloadChecklistPDFMutation.isPending}
                    >
                      {downloadChecklistPDFMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4 mr-1" />
                      )}
                      {downloadChecklistPDFMutation.isPending ? "Gerando..." : "Exportar PDF"}
                    </Button>
                    <Badge variant={completedSteps.length === checklist.length ? "default" : "secondary"}>
                      {Math.round((completedSteps.length / checklist.length) * 100)}% completo
                    </Badge>
                  </div>
                </div>

                {Object.entries(checklistByCategory).map(([category, steps]) => (
                  <Card key={category}>
                    <CardHeader>
                      <CardTitle className="text-base">{category}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {steps.map((step) => (
                        <div
                          key={step.stepNumber}
                          className={`border rounded-lg p-4 transition-all ${
                            completedSteps.includes(step.stepNumber)
                              ? "bg-primary/5 border-primary/20"
                              : "hover:bg-accent/50"
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <Checkbox
                              checked={completedSteps.includes(step.stepNumber)}
                              onCheckedChange={() => toggleStep(step.stepNumber)}
                              className="mt-1"
                            />
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <span className="font-medium">
                                  {step.stepNumber}. {step.title}
                                </span>
                                {step.isOptional && (
                                  <Badge variant="outline" className="text-xs">
                                    Opcional
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground mb-3">
                                {step.description}
                              </p>

                              {Array.isArray(step.fields) && (step.fields as any[]).length > 0 && (
                                <div className="space-y-2 mb-3">
                                  {(step.fields as any[]).map((field: any, idx: number) => (
                                    <div
                                      key={idx}
                                      className="flex items-center justify-between bg-background p-2 rounded border"
                                    >
                                      <span className="text-sm font-medium">{field.label}:</span>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => handleCopyField(field.value || "", field.label)}
                                      >
                                        <Copy className="h-3 w-3 mr-1" />
                                        Copiar
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
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Abrir
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            )}
          </TabsContent>

          {/* Aba de Dados */}
          <TabsContent value="data" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Dados do Processo</CardTitle>
                <CardDescription>
                  Copie os dados para preencher campos na plataforma
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  { label: "Nome do Processo", value: process.name },
                  { label: "Objeto", value: process.object },
                  { label: "Valor Estimado", value: process.estimatedValue ? `R$ ${(process.estimatedValue / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` : "Não informado" },
                  { label: "Modalidade", value: process.modality },
                  { label: "Categoria", value: process.category },
                ].map((field, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium">{field.label}</p>
                      <p className="text-sm text-muted-foreground">{field.value}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleCopyField(field.value || "", field.label)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            {settings.organizationName && (
              <Card>
                <CardHeader>
                  <CardTitle>Dados da Organização</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Nome da Organização", value: settings.organizationName },
                    { label: "CNPJ", value: settings.cnpj },
                    { label: "Endereço", value: settings.address },
                    { label: "Telefone", value: settings.phone },
                    { label: "E-mail", value: settings.email },
                    { label: "Website", value: settings.website },
                  ]
                    .filter(f => f.value)
                    .map((field, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                      >
                        <div>
                          <p className="text-sm font-medium">{field.label}</p>
                          <p className="text-sm text-muted-foreground">{field.value}</p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCopyField(field.value || "", field.label)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

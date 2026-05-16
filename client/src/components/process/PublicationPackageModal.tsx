import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Package, FileText, ClipboardCheck, Copy, Loader2 } from "lucide-react";
import { PackageDocumentsTab } from "@/components/publication-package/PackageDocumentsTab";
import { PackageChecklistTab } from "@/components/publication-package/PackageChecklistTab";
import { PackageDataTab } from "@/components/publication-package/PackageDataTab";

interface Props {
  processId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PublicationPackageModal({ processId, open, onOpenChange }: Props) {
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);

  const { data: packageData, isLoading } = trpc.platforms.generatePublicationPackage.useQuery(
    { processId },
    { enabled: open }
  );

  const downloadPackageMutation = trpc.downloads.publicationPackage.useMutation({
    onSuccess: (data) => {
      const bytes = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0));
      const url = window.URL.createObjectURL(new Blob([bytes], { type: data.mimeType }));
      const a = Object.assign(document.createElement("a"), { href: url, download: data.filename });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success("Pacote baixado com sucesso!");
    },
    onError: () => toast.error("Erro ao gerar pacote. Tente novamente."),
  });

  const downloadChecklistPDFMutation = trpc.downloads.checklistPDF.useMutation({
    onSuccess: (data) => {
      const bytes = Uint8Array.from(atob(data.data), (c) => c.charCodeAt(0));
      const url = window.URL.createObjectURL(new Blob([bytes], { type: data.mimeType }));
      const a = Object.assign(document.createElement("a"), { href: url, download: data.filename });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success("Checklist exportado com sucesso!");
    },
    onError: () => toast.error("Erro ao exportar checklist. Tente novamente."),
  });

  const handleCopyField = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${fieldName} copiado!`);
  };

  const toggleStep = (stepNumber: number) =>
    setCompletedSteps((prev) =>
      prev.includes(stepNumber) ? prev.filter((s) => s !== stepNumber) : [...prev, stepNumber]
    );

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

  if (!packageData) return null;

  const { process, platform, documents, items, checklist, settings } = packageData;

  const checklistByCategory = checklist.reduce((acc, step) => {
    const cat = step.category || "Outros";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(step);
    return acc;
  }, {} as Record<string, typeof checklist>);

  const handleExportPDF = () => {
    if (!platform?.id) { toast.error("Nenhuma plataforma selecionada"); return; }
    downloadChecklistPDFMutation.mutate({ processId, platformId: platform.id });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Pacote de Publicação
          </DialogTitle>
          <DialogDescription>
            {platform ? `Documentos e checklist para publicação na plataforma ${platform.name}` : "Documentos prontos para publicação"}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="documents" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="documents"><FileText className="h-4 w-4 mr-2" />Documentos</TabsTrigger>
            <TabsTrigger value="checklist"><ClipboardCheck className="h-4 w-4 mr-2" />Checklist</TabsTrigger>
            <TabsTrigger value="data"><Copy className="h-4 w-4 mr-2" />Dados</TabsTrigger>
          </TabsList>

          <TabsContent value="documents" className="space-y-4">
            <PackageDocumentsTab
              documents={documents} items={items} platformName={platform?.name}
              downloadPending={downloadPackageMutation.isPending}
              onDownloadAll={() => downloadPackageMutation.mutate({ processId })}
            />
          </TabsContent>

          <TabsContent value="checklist" className="space-y-4">
            <PackageChecklistTab
              platform={platform} checklist={checklist} checklistByCategory={checklistByCategory}
              completedSteps={completedSteps} downloadChecklistPDFPending={downloadChecklistPDFMutation.isPending}
              onToggleStep={toggleStep} onExportPDF={handleExportPDF} onCopyField={handleCopyField}
            />
          </TabsContent>

          <TabsContent value="data" className="space-y-4">
            <PackageDataTab process={process} settings={settings} onCopyField={handleCopyField} />
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

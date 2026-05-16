import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { UploadStep } from "@/components/import-items/UploadStep";
import { MappingStep, ColumnMapping } from "@/components/import-items/MappingStep";
import { ReviewStep } from "@/components/import-items/ReviewStep";

interface ImportItemsModalProps {
  open: boolean;
  onClose: () => void;
  processId: number;
  onSuccess: () => void;
}

export default function ImportItemsModal({ open, onClose, processId, onSuccess }: ImportItemsModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [previewData, setPreviewData] = useState<any[][]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    description: 0,
    quantity: undefined,
    unit: undefined,
    unitPrice: undefined,
    totalPrice: undefined,
  });
  const [parsedItems, setParsedItems] = useState<any[]>([]);
  const [step, setStep] = useState<"upload" | "mapping" | "review">("upload");

  const parseFileMutation = trpc.processes.parseItemsFile.useMutation();
  const addItemsMutation = trpc.processes.addItemsToTR.useMutation();

  const handleFileSelect = async (selectedFile: File) => {
    if (selectedFile.size > 5 * 1024 * 1024) { toast.error("Arquivo muito grande (máximo 5MB)"); return; }
    const ext = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error("Formato inválido. Use Excel (.xlsx, .xls) ou CSV (.csv)");
      return;
    }
    setFile(selectedFile);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64Content = (e.target?.result as string).split(",")[1];
      setFileContent(base64Content);
      try {
        const result = await parseFileMutation.mutateAsync({
          fileContent: base64Content,
          fileName: selectedFile.name,
          columnMapping: { description: 0 },
          previewOnly: true,
        });
        if (result.preview) { setPreviewData(result.preview); setStep("mapping"); }
      } catch (error: any) {
        toast.error(error.message || "Erro ao ler arquivo");
        setFile(null); setFileContent("");
      }
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  };

  const handleParse = async () => {
    if (!file || !fileContent) return;
    try {
      const result = await parseFileMutation.mutateAsync({ fileContent, fileName: file.name, columnMapping, previewOnly: false });
      setParsedItems(result.items);
      setStep("review");
      toast.success(`${result.count} itens parseados com sucesso`);
    } catch (error: any) {
      toast.error(error.message || "Erro ao parsear arquivo");
    }
  };

  const handleImport = async () => {
    try {
      const items = parsedItems.map((item) => ({
        itemType: "material" as const,
        description: item.description,
        unit: item.unit || "UN",
        quantity: item.quantity || 1,
        estimatedPrice: item.unitPrice || 0,
      }));
      await addItemsMutation.mutateAsync({ processId, items });
      toast.success(`${items.length} itens importados com sucesso`);
      onSuccess();
      onClose();
      resetState();
    } catch (error: any) {
      toast.error(error.message || "Erro ao importar itens");
    }
  };

  const resetState = () => {
    setFile(null); setFileContent(""); setPreviewData([]);
    setColumnMapping({ description: 0, quantity: undefined, unit: undefined, unitPrice: undefined, totalPrice: undefined });
    setParsedItems([]); setStep("upload");
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Importar Itens de Planilha</DialogTitle>
          <DialogDescription>
            Importe itens de arquivo Excel (.xlsx, .xls) ou CSV (.csv). Máximo 500 itens por importação.
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <UploadStep isPending={parseFileMutation.isPending} onFileSelect={handleFileSelect} onDrop={handleDrop} />
        )}
        {step === "mapping" && (
          <MappingStep
            file={file}
            previewData={previewData}
            columnMapping={columnMapping}
            onColumnMappingChange={setColumnMapping}
            isParsePending={parseFileMutation.isPending}
            onParse={handleParse}
            onBack={() => setStep("upload")}
          />
        )}
        {step === "review" && (
          <ReviewStep
            parsedItems={parsedItems}
            isAddPending={addItemsMutation.isPending}
            onImport={handleImport}
            onBack={() => setStep("mapping")}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

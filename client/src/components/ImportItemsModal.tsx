import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Upload, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

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
  const [columnMapping, setColumnMapping] = useState({
    description: 0,
    quantity: undefined as number | undefined,
    unit: undefined as number | undefined,
    unitPrice: undefined as number | undefined,
    totalPrice: undefined as number | undefined,
  });
  const [parsedItems, setParsedItems] = useState<any[]>([]);
  const [step, setStep] = useState<"upload" | "mapping" | "review">("upload");

  const parseFileMutation = trpc.processes.parseItemsFile.useMutation();
  const addItemsMutation = trpc.processes.addItemsToTR.useMutation();

  const handleFileSelect = async (selectedFile: File) => {
    if (!selectedFile) return;

    // Validar tamanho (5MB)
    if (selectedFile.size > 5 * 1024 * 1024) {
      toast.error("Arquivo muito grande (máximo 5MB)");
      return;
    }

    // Validar extensão
    const ext = selectedFile.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(ext || "")) {
      toast.error("Formato inválido. Use Excel (.xlsx, .xls) ou CSV (.csv)");
      return;
    }

    setFile(selectedFile);

    // Ler arquivo como base64
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target?.result as string;
      const base64Content = base64.split(",")[1]; // Remover prefixo data:...;base64,
      setFileContent(base64Content);

      // Enviar para backend obter preview
      try {
        const result = await parseFileMutation.mutateAsync({
          fileContent: base64Content,
          fileName: selectedFile.name,
          columnMapping: { description: 0 }, // Mapeamento padrão inicial
          previewOnly: true, // Flag para retornar apenas preview
        });

        if (result.preview) {
          setPreviewData(result.preview);
          setStep("mapping");
        }
      } catch (error: any) {
        toast.error(error.message || "Erro ao ler arquivo");
        setFile(null);
        setFileContent("");
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
      const result = await parseFileMutation.mutateAsync({
        fileContent,
        fileName: file.name,
        columnMapping,
        previewOnly: false,
      });

      setParsedItems(result.items);
      setStep("review");
      toast.success(`${result.count} itens parseados com sucesso`);
    } catch (error: any) {
      toast.error(error.message || "Erro ao parsear arquivo");
    }
  };

  const handleImport = async () => {
    try {
      // Converter itens parseados para formato do addItemsToTR
      const items = parsedItems.map((item) => ({
        itemType: "material" as const, // Usuário pode ajustar depois
        description: item.description,
        unit: item.unit || "UN",
        quantity: item.quantity || 1,
        estimatedPrice: item.unitPrice || 0,
      }));

      await addItemsMutation.mutateAsync({
        processId,
        items,
      });

      toast.success(`${items.length} itens importados com sucesso`);
      onSuccess();
      onClose();
      resetState();
    } catch (error: any) {
      toast.error(error.message || "Erro ao importar itens");
    }
  };

  const resetState = () => {
    setFile(null);
    setFileContent("");
    setPreviewData([]);
    setColumnMapping({ description: 0, quantity: undefined, unit: undefined, unitPrice: undefined, totalPrice: undefined });
    setParsedItems([]);
    setStep("upload");
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

        {/* Passo 1: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <div
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-primary transition-colors cursor-pointer"
              onClick={() => document.getElementById("file-input")?.click()}
            >
              <Upload className="mx-auto h-12 w-12 text-gray-400 mb-4" />
              <p className="text-sm text-gray-600 mb-2">
                Arraste e solte o arquivo aqui ou clique para selecionar
              </p>
              <p className="text-xs text-gray-500">
                Formatos: Excel (.xlsx, .xls) ou CSV (.csv) | Máximo: 5MB
              </p>
              <input
                id="file-input"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                className="hidden"
              />
            </div>

            {parseFileMutation.isPending && (
              <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processando arquivo...</span>
              </div>
            )}
          </div>
        )}

        {/* Passo 2: Mapeamento de Colunas */}
        {step === "mapping" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
              <FileSpreadsheet className="h-4 w-4" />
              <span>{file?.name}</span>
              <span className="text-gray-400">•</span>
              <span>{previewData.length - 1} linhas detectadas</span>
            </div>

            <div className="space-y-3">
              <Label>Mapeamento de Colunas</Label>
              <p className="text-sm text-gray-600">
                Indique qual coluna corresponde a cada informação:
              </p>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="col-description">Descrição do Item *</Label>
                  <Select
                    value={columnMapping.description.toString()}
                    onValueChange={(value) => setColumnMapping({ ...columnMapping, description: parseInt(value) })}
                  >
                    <SelectTrigger id="col-description">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {previewData[0]?.map((header, index) => (
                        <SelectItem key={index} value={index.toString()}>
                          Coluna {String.fromCharCode(65 + index)} - {header || "(vazia)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="col-quantity">Quantidade (opcional)</Label>
                  <Select
                    value={columnMapping.quantity?.toString() || "none"}
                    onValueChange={(value) =>
                      setColumnMapping({ ...columnMapping, quantity: value === "none" ? undefined : parseInt(value) })
                    }
                  >
                    <SelectTrigger id="col-quantity">
                      <SelectValue placeholder="Nenhuma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      {previewData[0]?.map((header, index) => (
                        <SelectItem key={index} value={index.toString()}>
                          Coluna {String.fromCharCode(65 + index)} - {header || "(vazia)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="col-unit">Unidade (opcional)</Label>
                  <Select
                    value={columnMapping.unit?.toString() || "none"}
                    onValueChange={(value) =>
                      setColumnMapping({ ...columnMapping, unit: value === "none" ? undefined : parseInt(value) })
                    }
                  >
                    <SelectTrigger id="col-unit">
                      <SelectValue placeholder="Nenhuma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      {previewData[0]?.map((header, index) => (
                        <SelectItem key={index} value={index.toString()}>
                          Coluna {String.fromCharCode(65 + index)} - {header || "(vazia)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="col-unitPrice">Valor Unitário (opcional)</Label>
                  <Select
                    value={columnMapping.unitPrice?.toString() || "none"}
                    onValueChange={(value) =>
                      setColumnMapping({ ...columnMapping, unitPrice: value === "none" ? undefined : parseInt(value) })
                    }
                  >
                    <SelectTrigger id="col-unitPrice">
                      <SelectValue placeholder="Nenhuma" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhuma</SelectItem>
                      {previewData[0]?.map((header, index) => (
                        <SelectItem key={index} value={index.toString()}>
                          Coluna {String.fromCharCode(65 + index)} - {header || "(vazia)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b">
                <p className="text-sm font-medium">Preview (primeiras 5 linhas)</p>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {previewData[0]?.map((header, index) => (
                        <TableHead key={index}>
                          {String.fromCharCode(65 + index)} - {header || "(vazia)"}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewData.slice(1).map((row, rowIndex) => (
                      <TableRow key={rowIndex}>
                        {row.map((cell, cellIndex) => (
                          <TableCell key={cellIndex}>{cell}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("upload")}>
                Voltar
              </Button>
              <Button onClick={handleParse} disabled={parseFileMutation.isPending}>
                {parseFileMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Analisar Itens
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Passo 3: Revisão */}
        {step === "review" && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <div>
                <p className="font-medium text-green-900">{parsedItems.length} itens prontos para importar</p>
                <p className="text-sm text-green-700">Revise os itens abaixo antes de importar</p>
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="w-24">Qtd</TableHead>
                    <TableHead className="w-24">Unidade</TableHead>
                    <TableHead className="w-32">Valor Unit.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedItems.map((item, index) => (
                    <TableRow key={index}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="font-medium">{item.description}</TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>{item.unit}</TableCell>
                      <TableCell>
                        {item.unitPrice > 0 ? `R$ ${item.unitPrice.toFixed(2)}` : "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex items-start gap-2 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-900">
                <p className="font-medium mb-1">Atenção:</p>
                <p>
                  Os itens serão importados como "Material". Você poderá ajustar o tipo e buscar códigos
                  CATMAT/CATSER correspondentes após a importação.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("mapping")}>
                Voltar
              </Button>
              <Button onClick={handleImport} disabled={addItemsMutation.isPending}>
                {addItemsMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Importar {parsedItems.length} Itens
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Upload, Loader2, FileText } from "lucide-react";
import { storagePut } from "@/lib/storage";

interface UploadContractDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposalId: number;
  type: "empenho" | "contrato";
  onSuccess: () => void;
}

export function UploadContractDialog({
  open,
  onOpenChange,
  proposalId,
  type,
  onSuccess,
}: UploadContractDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [contractData, setContractData] = useState({
    dataAssinatura: "",
    dataInicioVigencia: "",
    dataFimVigencia: "",
  });

  const uploadEmpenhoMutation = trpc.proposals.uploadEmpenho.useMutation();
  const uploadContratoMutation = trpc.proposals.uploadContrato.useMutation();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    // Validar tipo de arquivo
    if (selectedFile.type !== "application/pdf") {
      toast.error("Apenas arquivos PDF são permitidos");
      return;
    }

    // Validar tamanho (10MB)
    if (selectedFile.size > 10 * 1024 * 1024) {
      toast.error("Arquivo muito grande. Máximo 10MB");
      return;
    }

    setFile(selectedFile);
  };

  const handleUpload = async () => {
    if (!file) {
      toast.error("Selecione um arquivo");
      return;
    }

    if (type === "contrato") {
      if (!contractData.dataAssinatura || !contractData.dataInicioVigencia || !contractData.dataFimVigencia) {
        toast.error("Preencha todas as datas");
        return;
      }
    }

    setUploading(true);

    try {
      // Upload para S3
      const fileKey = `contracts/${proposalId}/${type}-${Date.now()}.pdf`;
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);
      
      const { url } = await storagePut(fileKey, uint8Array, "application/pdf");

      // Salvar no banco
      if (type === "empenho") {
        await uploadEmpenhoMutation.mutateAsync({
          proposalId,
          fileUrl: url,
          fileKey,
        });
        toast.success("Nota de empenho anexada com sucesso!");
      } else {
        await uploadContratoMutation.mutateAsync({
          proposalId,
          fileUrl: url,
          fileKey,
          dataAssinatura: new Date(contractData.dataAssinatura),
          dataInicioVigencia: new Date(contractData.dataInicioVigencia),
          dataFimVigencia: new Date(contractData.dataFimVigencia),
        });
        toast.success("Contrato assinado anexado com sucesso!");
      }

      onSuccess();
      onOpenChange(false);
      setFile(null);
      setContractData({ dataAssinatura: "", dataInicioVigencia: "", dataFimVigencia: "" });
    } catch (error: any) {
      toast.error(error.message || "Erro ao fazer upload");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {type === "empenho" ? "Anexar Nota de Empenho" : "Anexar Contrato Assinado"}
          </DialogTitle>
          <DialogDescription>
            {type === "empenho"
              ? "Faça upload da nota de empenho em PDF (máximo 10MB)"
              : "Faça upload do contrato assinado em PDF e informe as datas de vigência"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="file">Arquivo PDF *</Label>
            <div className="flex items-center gap-2">
              <Input
                id="file"
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                disabled={uploading}
              />
              {file && (
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <FileText className="h-4 w-4" />
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </div>
              )}
            </div>
          </div>

          {type === "contrato" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="dataAssinatura">Data de Assinatura *</Label>
                <Input
                  id="dataAssinatura"
                  type="date"
                  value={contractData.dataAssinatura}
                  onChange={(e) =>
                    setContractData({ ...contractData, dataAssinatura: e.target.value })
                  }
                  disabled={uploading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dataInicioVigencia">Data de Início da Vigência *</Label>
                <Input
                  id="dataInicioVigencia"
                  type="date"
                  value={contractData.dataInicioVigencia}
                  onChange={(e) =>
                    setContractData({ ...contractData, dataInicioVigencia: e.target.value })
                  }
                  disabled={uploading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="dataFimVigencia">Data de Término da Vigência *</Label>
                <Input
                  id="dataFimVigencia"
                  type="date"
                  value={contractData.dataFimVigencia}
                  onChange={(e) =>
                    setContractData({ ...contractData, dataFimVigencia: e.target.value })
                  }
                  disabled={uploading}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uploading}>
            Cancelar
          </Button>
          <Button onClick={handleUpload} disabled={uploading || !file}>
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Enviando...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Fazer Upload
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

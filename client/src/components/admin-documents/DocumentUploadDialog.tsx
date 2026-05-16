import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, Loader2 } from "lucide-react";

export const DOCUMENT_TYPES = [
  { value: "contrato_social", label: "Contrato Social" },
  { value: "cartao_cnpj", label: "Cartão CNPJ" },
  { value: "certidao_federal", label: "Certidão Federal" },
  { value: "certidao_estadual", label: "Certidão Estadual" },
  { value: "certidao_municipal", label: "Certidão Municipal" },
  { value: "certidao_fgts", label: "Certidão FGTS" },
  { value: "certidao_trabalhista", label: "Certidão Trabalhista" },
  { value: "alvara_funcionamento", label: "Alvará de Funcionamento" },
];

export interface UploadData {
  documentType: string;
  expiresAt: string;
  file: File | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uploadData: UploadData;
  onUploadDataChange: (data: UploadData) => void;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onUpload: () => void;
  isPending: boolean;
}

export function DocumentUploadDialog({
  open, onOpenChange, uploadData, onUploadDataChange, onFileChange, onUpload, isPending,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enviar Documento</DialogTitle>
          <DialogDescription>Faça upload do documento da empresa</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div>
            <Label htmlFor="documentType">Tipo de Documento *</Label>
            <Select
              value={uploadData.documentType}
              onValueChange={(value) => onUploadDataChange({ ...uploadData, documentType: value })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o tipo" />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="file">Arquivo (PDF) *</Label>
            <Input id="file" type="file" accept=".pdf" onChange={onFileChange} />
          </div>
          <div>
            <Label htmlFor="expiresAt">Data de Validade (opcional)</Label>
            <Input
              id="expiresAt"
              type="date"
              value={uploadData.expiresAt}
              onChange={(e) => onUploadDataChange({ ...uploadData, expiresAt: e.target.value })}
            />
            <p className="text-sm text-muted-foreground mt-1">
              Deixe em branco para documentos sem validade (ex: Contrato Social)
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onUpload} disabled={!uploadData.file || !uploadData.documentType || isPending}>
            {isPending ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Enviando...</>
            ) : (
              <><Upload className="w-4 h-4 mr-2" />Enviar</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

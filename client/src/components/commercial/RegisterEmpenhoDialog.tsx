import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

export interface EmpenhoData {
  numeroEmpenho: string;
  dataEmpenho: string;
  valorEmpenho: string;
  observacoes: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  empenhoData: EmpenhoData;
  onEmpenhoDataChange: (data: EmpenhoData) => void;
  onSubmit: () => void;
  isPending: boolean;
}

export function RegisterEmpenhoDialog({
  open, onOpenChange, empenhoData, onEmpenhoDataChange, onSubmit, isPending,
}: Props) {
  const isValid = empenhoData.numeroEmpenho && empenhoData.dataEmpenho && empenhoData.valorEmpenho;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Registrar Empenho</DialogTitle>
          <DialogDescription>
            Preencha os dados do empenho recebido para ativar a assinatura
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="numeroEmpenho">Número do Empenho *</Label>
              <Input
                id="numeroEmpenho"
                value={empenhoData.numeroEmpenho}
                onChange={(e) => onEmpenhoDataChange({ ...empenhoData, numeroEmpenho: e.target.value })}
                placeholder="Ex: 2025NE000123"
              />
            </div>
            <div>
              <Label htmlFor="dataEmpenho">Data do Empenho *</Label>
              <Input
                id="dataEmpenho"
                type="date"
                value={empenhoData.dataEmpenho}
                onChange={(e) => onEmpenhoDataChange({ ...empenhoData, dataEmpenho: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="valorEmpenho">Valor do Empenho (R$) *</Label>
            <Input
              id="valorEmpenho"
              type="number"
              step="0.01"
              value={empenhoData.valorEmpenho}
              onChange={(e) => onEmpenhoDataChange({ ...empenhoData, valorEmpenho: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <div>
            <Label htmlFor="observacoes">Observações</Label>
            <Textarea
              id="observacoes"
              value={empenhoData.observacoes}
              onChange={(e) => onEmpenhoDataChange({ ...empenhoData, observacoes: e.target.value })}
              placeholder="Informações adicionais sobre o empenho..."
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={onSubmit} disabled={!isValid || isPending}>
            {isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Registrando...</> : "Registrar Empenho"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

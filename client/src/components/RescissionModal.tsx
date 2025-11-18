import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";

interface RescissionModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (data: {
    type: "unilateral" | "bilateral" | "judicial";
    reason: string;
    effectiveDate: string;
    penaltyAmount?: string;
    notes?: string;
  }) => void;
  isLoading?: boolean;
}

export function RescissionModal({ open, onClose, onConfirm, isLoading }: RescissionModalProps) {
  const [formData, setFormData] = useState({
    type: "unilateral" as "unilateral" | "bilateral" | "judicial",
    reason: "",
    effectiveDate: new Date().toISOString().split('T')[0],
    penaltyAmount: "",
    notes: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(formData);
  };

  const handleClose = () => {
    setFormData({
      type: "unilateral",
      reason: "",
      effectiveDate: new Date().toISOString().split('T')[0],
      penaltyAmount: "",
      notes: ""
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Gerar Termo de Rescisão
          </DialogTitle>
          <DialogDescription>
            Preencha os dados para gerar o termo de rescisão contratual. Esta ação atualizará o status do contrato para "Rescindido".
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tipo de Rescisão */}
          <div className="space-y-2">
            <Label htmlFor="type">Tipo de Rescisão *</Label>
            <Select
              value={formData.type}
              onValueChange={(value: "unilateral" | "bilateral" | "judicial") =>
                setFormData({ ...formData, type: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unilateral">Unilateral (pelo órgão)</SelectItem>
                <SelectItem value="bilateral">Bilateral (acordo mútuo)</SelectItem>
                <SelectItem value="judicial">Judicial</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {formData.type === "unilateral" && "Rescisão por decisão do órgão público"}
              {formData.type === "bilateral" && "Rescisão por acordo entre as partes"}
              {formData.type === "judicial" && "Rescisão determinada judicialmente"}
            </p>
          </div>

          {/* Motivo da Rescisão */}
          <div className="space-y-2">
            <Label htmlFor="reason">Motivo da Rescisão *</Label>
            <Textarea
              id="reason"
              value={formData.reason}
              onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
              placeholder="Descreva o motivo da rescisão contratual..."
              rows={4}
              required
            />
            <p className="text-xs text-muted-foreground">
              Fundamente o motivo da rescisão (ex: descumprimento de cláusulas, interesse público, acordo mútuo)
            </p>
          </div>

          {/* Data de Vigência */}
          <div className="space-y-2">
            <Label htmlFor="effectiveDate">Data de Vigência da Rescisão *</Label>
            <Input
              id="effectiveDate"
              type="date"
              value={formData.effectiveDate}
              onChange={(e) => setFormData({ ...formData, effectiveDate: e.target.value })}
              required
            />
            <p className="text-xs text-muted-foreground">
              Data a partir da qual a rescisão produzirá efeitos
            </p>
          </div>

          {/* Valor de Multa/Penalidade (opcional) */}
          <div className="space-y-2">
            <Label htmlFor="penaltyAmount">Valor de Multa/Penalidade (opcional)</Label>
            <Input
              id="penaltyAmount"
              type="number"
              step="0.01"
              min="0"
              value={formData.penaltyAmount}
              onChange={(e) => setFormData({ ...formData, penaltyAmount: e.target.value })}
              placeholder="0,00"
            />
            <p className="text-xs text-muted-foreground">
              Valor de multa ou penalidade aplicada, se houver
            </p>
          </div>

          {/* Observações Adicionais */}
          <div className="space-y-2">
            <Label htmlFor="notes">Observações Adicionais (opcional)</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Informações complementares sobre a rescisão..."
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={isLoading}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={isLoading}>
              {isLoading ? "Gerando..." : "Gerar Termo de Rescisão"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

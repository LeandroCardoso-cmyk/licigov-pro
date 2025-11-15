import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";

interface EditItemDialogProps {
  open: boolean;
  onClose: () => void;
  item: {
    id: number;
    description: string;
    quantity?: number | null;
    unit?: string | null;
    unitPrice?: number | null;
    catmatCode?: string | null;
    catserCode?: string | null;
    itemType: string;
  };
  onSuccess?: () => void;
}

export default function EditItemDialog({ open, onClose, item, onSuccess }: EditItemDialogProps) {
  const [description, setDescription] = useState(item.description);
  const [quantity, setQuantity] = useState(item.quantity?.toString() || "1");
  const [unit, setUnit] = useState(item.unit || "UN");
  const [unitPrice, setUnitPrice] = useState(item.unitPrice?.toString() || "0");
  const [catmatCode, setCatmatCode] = useState(item.catmatCode || "");
  const [catserCode, setCatserCode] = useState(item.catserCode || "");

  // Atualizar estados quando o item mudar
  useEffect(() => {
    setDescription(item.description);
    setQuantity(item.quantity?.toString() || "1");
    setUnit(item.unit || "UN");
    setUnitPrice(item.unitPrice?.toString() || "0");
    setCatmatCode(item.catmatCode || "");
    setCatserCode(item.catserCode || "");
  }, [item]);

  const updateItemMutation = trpc.processes.updateProcessItem.useMutation({
    onSuccess: () => {
      toast.success("Item atualizado com sucesso!");
      onSuccess?.();
      onClose();
    },
    onError: (error) => {
      toast.error(`Erro ao atualizar item: ${error.message}`);
    },
  });

  const handleSave = () => {
    // Validações
    if (!description || description.trim().length < 10) {
      toast.error("Descrição deve ter no mínimo 10 caracteres");
      return;
    }

    const parsedQuantity = parseFloat(quantity);
    if (isNaN(parsedQuantity) || parsedQuantity <= 0) {
      toast.error("Quantidade deve ser maior que zero");
      return;
    }

    const parsedUnitPrice = parseFloat(unitPrice);
    if (isNaN(parsedUnitPrice) || parsedUnitPrice < 0) {
      toast.error("Preço unitário inválido");
      return;
    }

    updateItemMutation.mutate({
      itemId: item.id,
      description: description.trim(),
      quantity: parsedQuantity,
      unit: unit.trim(),
      unitPrice: parsedUnitPrice,
      catmatCode: catmatCode.trim() || undefined,
      catserCode: catserCode.trim() || undefined,
    });
  };

  const commonUnits = [
    "UN", "KG", "M", "M2", "M3", "L", "CX", "PC", "PAR", "CONJ",
    "KIT", "JG", "RL", "GL", "LT", "ML", "G", "MG", "TON", "DZ"
  ];

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editar Item</DialogTitle>
          <DialogDescription>
            Atualize as informações do item. Campos com * são obrigatórios.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Descrição */}
          <div className="space-y-2">
            <Label htmlFor="description">Descrição *</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrição detalhada do item (mínimo 10 caracteres)"
              rows={3}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              {description.length} caracteres (mínimo 10)
            </p>
          </div>

          {/* Quantidade e Unidade */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantidade *</Label>
              <Input
                id="quantity"
                type="number"
                min="0.01"
                step="0.01"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="unit">Unidade *</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger id="unit">
                  <SelectValue placeholder="Selecione a unidade" />
                </SelectTrigger>
                <SelectContent>
                  {commonUnits.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Preço Unitário */}
          <div className="space-y-2">
            <Label htmlFor="unitPrice">Preço Unitário Estimado (R$)</Label>
            <Input
              id="unitPrice"
              type="number"
              min="0"
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="0.00"
            />
            <p className="text-xs text-muted-foreground">
              Valor estimado para referência (opcional)
            </p>
          </div>

          {/* Códigos CATMAT/CATSER */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="catmatCode">Código CATMAT</Label>
              <Input
                id="catmatCode"
                value={catmatCode}
                onChange={(e) => setCatmatCode(e.target.value)}
                placeholder="Ex: 123456"
                disabled={item.itemType === "service"}
              />
              {item.itemType === "service" && (
                <p className="text-xs text-muted-foreground">
                  Não aplicável para serviços
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="catserCode">Código CATSER</Label>
              <Input
                id="catserCode"
                value={catserCode}
                onChange={(e) => setCatserCode(e.target.value)}
                placeholder="Ex: 654321"
                disabled={item.itemType === "material"}
              />
              {item.itemType === "material" && (
                <p className="text-xs text-muted-foreground">
                  Não aplicável para materiais
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={updateItemMutation.isPending}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={updateItemMutation.isPending} className="gap-2">
            {updateItemMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Salvando...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Salvar Alterações
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

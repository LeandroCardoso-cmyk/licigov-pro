import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface NewApostilleModalProps {
  open: boolean;
  onClose: () => void;
  contractId: number;
  currentValue: string;
}

export function NewApostilleModal({
  open,
  onClose,
  contractId,
  currentValue,
}: NewApostilleModalProps) {
  const [type, setType] = useState<"reajuste" | "correcao" | "designacao" | "outro">("reajuste");
  const [description, setDescription] = useState("");
  const [indexType, setIndexType] = useState("IPCA");
  const [indexValue, setIndexValue] = useState("");
  const [newValue, setNewValue] = useState("");

  const utils = trpc.useUtils();

  const createApostille = trpc.contracts.apostilles.create.useMutation({
    onSuccess: () => {
      toast.success("Apostilamento criado com sucesso!");
      utils.contracts.getById.invalidate({ id: contractId });
      utils.contracts.apostilles.list.invalidate({ contractId });
      utils.contracts.audit.getLogs.invalidate({ contractId });
      handleClose();
    },
    onError: (error) => {
      toast.error(`Erro ao criar apostilamento: ${error.message}`);
    },
  });

  const handleClose = () => {
    setType("reajuste");
    setDescription("");
    setIndexType("IPCA");
    setIndexValue("");
    setNewValue("");
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!description.trim()) {
      toast.error("A descrição é obrigatória");
      return;
    }

    if (type === "reajuste" && (!indexValue || !newValue)) {
      toast.error("Para reajuste, informe o índice e o novo valor");
      return;
    }

    createApostille.mutate({
      contractId,
      type,
      description,
      indexType: type === "reajuste" ? indexType : undefined,
      indexValue: indexValue || undefined,
      newValue: newValue || undefined,
    });
  };

  // Calcular novo valor automaticamente
  const calculateNewValue = () => {
    if (indexValue && currentValue) {
      const current = parseFloat(currentValue);
      const index = parseFloat(indexValue);
      if (!isNaN(current) && !isNaN(index)) {
        const calculated = current * (1 + index / 100);
        setNewValue(calculated.toFixed(2));
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Apostilamento</DialogTitle>
          <DialogDescription>
            Registre alterações que não modificam a essência do contrato (reajustes, correções, designações)
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Tipo de Apostilamento */}
          <div className="space-y-2">
            <Label htmlFor="type">Tipo de Apostilamento *</Label>
            <Select value={type} onValueChange={(value: any) => setType(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reajuste">Reajuste de Valor</SelectItem>
                <SelectItem value="correcao">Correção de Dados</SelectItem>
                <SelectItem value="designacao">Designação de Fiscal</SelectItem>
                <SelectItem value="outro">Outro</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Apostilamentos não alteram o objeto ou prazo do contrato
            </p>
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <Label htmlFor="description">Descrição *</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva a alteração que será realizada..."
              rows={4}
              required
            />
            <p className="text-xs text-muted-foreground">
              Detalhamento da alteração contratual
            </p>
          </div>

          {/* Reajuste de Valor */}
          {type === "reajuste" && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="indexType">Índice de Reajuste *</Label>
                  <Select value={indexType} onValueChange={setIndexType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="IPCA">IPCA</SelectItem>
                      <SelectItem value="IGP-M">IGP-M</SelectItem>
                      <SelectItem value="INPC">INPC</SelectItem>
                      <SelectItem value="IPC">IPC</SelectItem>
                      <SelectItem value="Outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="indexValue">Percentual (%) *</Label>
                  <div className="flex gap-2">
                    <Input
                      id="indexValue"
                      type="number"
                      step="0.01"
                      value={indexValue}
                      onChange={(e) => setIndexValue(e.target.value)}
                      placeholder="0.00"
                      required
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={calculateNewValue}
                      disabled={!indexValue}
                    >
                      Calcular
                    </Button>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="newValue">Novo Valor do Contrato *</Label>
                <Input
                  id="newValue"
                  type="number"
                  step="0.01"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="0.00"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Valor atual: {new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  }).format(parseFloat(currentValue))}
                  {newValue && ` → Novo valor: ${new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  }).format(parseFloat(newValue))}`}
                </p>
              </div>
            </>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createApostille.isPending}>
              {createApostille.isPending ? "Criando..." : "Criar Apostilamento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

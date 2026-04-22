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

interface NewAmendmentModalProps {
  open: boolean;
  onClose: () => void;
  contractId: number;
  currentEndDate: string;
  currentValue: string;
}

export function NewAmendmentModal({
  open,
  onClose,
  contractId,
  currentEndDate,
  currentValue,
}: NewAmendmentModalProps) {
  const [type, setType] = useState<"prazo" | "valor" | "escopo" | "misto">("prazo");
  const [justification, setJustification] = useState("");
  const [newEndDate, setNewEndDate] = useState("");
  const [valueChange, setValueChange] = useState("");
  const [scopeChange, setScopeChange] = useState("");

  const utils = trpc.useUtils();

  const createAmendment = trpc.contracts.amendments.create.useMutation({
    onSuccess: () => {
      toast.success("Aditivo criado com sucesso!");
      utils.contracts.getById.invalidate({ id: contractId });
      utils.contracts.amendments.list.invalidate({ contractId });
      utils.contracts.audit.getLogs.invalidate({ contractId });
      handleClose();
    },
    onError: (error) => {
      toast.error(`Erro ao criar aditivo: ${error.message}`);
    },
  });

  const handleClose = () => {
    setType("prazo");
    setJustification("");
    setNewEndDate("");
    setValueChange("");
    setScopeChange("");
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!justification.trim()) {
      toast.error("A justificativa é obrigatória");
      return;
    }

    if (type === "prazo" && !newEndDate) {
      toast.error("A nova data de término é obrigatória para aditivo de prazo");
      return;
    }

    if (type === "valor" && !valueChange) {
      toast.error("A alteração de valor é obrigatória para aditivo de valor");
      return;
    }

    if (type === "escopo" && !scopeChange.trim()) {
      toast.error("A descrição da alteração de escopo é obrigatória");
      return;
    }

    if (type === "misto" && !newEndDate && !valueChange && !scopeChange.trim()) {
      toast.error("Informe pelo menos uma alteração (prazo, valor ou escopo)");
      return;
    }

    createAmendment.mutate({
      contractId,
      number: 1,
      type,
      justification,
      newEndDate: newEndDate ? new Date(newEndDate) : undefined,
      valueChange: valueChange ? parseFloat(valueChange) : undefined,
      scopeChanges: scopeChange || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Novo Aditivo Contratual</DialogTitle>
          <DialogDescription>
            Registre alterações de prazo, valor ou escopo do contrato
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Tipo de Aditivo */}
          <div className="space-y-2">
            <Label htmlFor="type">Tipo de Aditivo *</Label>
            <Select value={type} onValueChange={(value: any) => setType(value)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="prazo">Aditivo de Prazo</SelectItem>
                <SelectItem value="valor">Aditivo de Valor</SelectItem>
                <SelectItem value="escopo">Aditivo de Escopo</SelectItem>
                <SelectItem value="misto">Aditivo Misto (Prazo + Valor + Escopo)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Selecione o tipo de alteração que será realizada
            </p>
          </div>

          {/* Justificativa */}
          <div className="space-y-2">
            <Label htmlFor="justification">Justificativa *</Label>
            <Textarea
              id="justification"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Descreva os motivos que justificam este aditivo..."
              rows={4}
              required
            />
            <p className="text-xs text-muted-foreground">
              Fundamentação legal e técnica para a alteração contratual
            </p>
          </div>

          {/* Nova Data de Término (Prazo ou Misto) */}
          {(type === "prazo" || type === "misto") && (
            <div className="space-y-2">
              <Label htmlFor="newEndDate">
                Nova Data de Término {type === "prazo" && "*"}
              </Label>
              <Input
                id="newEndDate"
                type="date"
                value={newEndDate}
                onChange={(e) => setNewEndDate(e.target.value)}
                min={currentEndDate}
                required={type === "prazo"}
              />
              <p className="text-xs text-muted-foreground">
                Data atual de término: {new Date(currentEndDate).toLocaleDateString("pt-BR")}
              </p>
            </div>
          )}

          {/* Alteração de Valor (Valor ou Misto) */}
          {(type === "valor" || type === "misto") && (
            <div className="space-y-2">
              <Label htmlFor="valueChange">
                Alteração de Valor {type === "valor" && "*"}
              </Label>
              <Input
                id="valueChange"
                type="number"
                step="0.01"
                value={valueChange}
                onChange={(e) => setValueChange(e.target.value)}
                placeholder="0.00"
                required={type === "valor"}
              />
              <p className="text-xs text-muted-foreground">
                Valor atual: {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(parseFloat(currentValue))} • Use valores positivos para acréscimo e negativos para supressão
              </p>
            </div>
          )}

          {/* Alteração de Escopo (Escopo ou Misto) */}
          {(type === "escopo" || type === "misto") && (
            <div className="space-y-2">
              <Label htmlFor="scopeChange">
                Alteração de Escopo {type === "escopo" && "*"}
              </Label>
              <Textarea
                id="scopeChange"
                value={scopeChange}
                onChange={(e) => setScopeChange(e.target.value)}
                placeholder="Descreva as alterações no escopo do contrato..."
                rows={3}
                required={type === "escopo"}
              />
              <p className="text-xs text-muted-foreground">
                Detalhamento das modificações no objeto contratual
              </p>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createAmendment.isPending}>
              {createAmendment.isPending ? "Criando..." : "Criar Aditivo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

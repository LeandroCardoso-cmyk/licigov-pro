import { useState } from "react";
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
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

interface NewProcessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export default function NewProcessDialog({ open, onOpenChange, onSuccess }: NewProcessDialogProps) {
  const [formData, setFormData] = useState({
    name: "",
    object: "",
    estimatedValue: "",
    modality: "",
    category: "",
  });

  const createProcessMutation = trpc.processes.create.useMutation({
    onSuccess: () => {
      toast.success("Processo criado com sucesso!", {
        description: "A geração do ETP será iniciada automaticamente.",
      });
      setFormData({
        name: "",
        object: "",
        estimatedValue: "",
        modality: "",
        category: "",
      });
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (error) => {
      toast.error("Erro ao criar processo", {
        description: error.message,
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validação
    if (!formData.name.trim()) {
      toast.error("Nome do processo é obrigatório");
      return;
    }
    if (!formData.object.trim()) {
      toast.error("Objeto da contratação é obrigatório");
      return;
    }
    if (!formData.estimatedValue || parseFloat(formData.estimatedValue) <= 0) {
      toast.error("Valor estimado deve ser maior que zero");
      return;
    }
    if (!formData.modality) {
      toast.error("Modalidade é obrigatória");
      return;
    }
    if (!formData.category) {
      toast.error("Categoria é obrigatória");
      return;
    }

    createProcessMutation.mutate({
      name: formData.name.trim(),
      object: formData.object.trim(),
      estimatedValue: parseFloat(formData.estimatedValue),
      modality: formData.modality,
      category: formData.category,
    });
  };

  const formatCurrency = (value: string) => {
    // Remove tudo exceto números
    const numbers = value.replace(/\D/g, "");
    
    // Converte para número e formata
    const amount = parseFloat(numbers) / 100;
    
    return amount.toLocaleString("pt-BR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handleValueChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCurrency(e.target.value);
    setFormData({ ...formData, estimatedValue: formatted });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Novo Processo Licitatório</DialogTitle>
          <DialogDescription>
            Preencha as informações básicas do processo. O sistema irá gerar automaticamente o ETP
            com base na Lei 14.133/21.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          {/* Nome do Processo */}
          <div className="space-y-2">
            <Label htmlFor="name">
              Nome do Processo <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              placeholder="Ex: Aquisição de Material de Escritório 2024"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={createProcessMutation.isPending}
            />
          </div>

          {/* Objeto da Contratação */}
          <div className="space-y-2">
            <Label htmlFor="object">
              Objeto da Contratação <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="object"
              placeholder="Descreva detalhadamente o objeto da contratação..."
              value={formData.object}
              onChange={(e) => setFormData({ ...formData, object: e.target.value })}
              disabled={createProcessMutation.isPending}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Seja específico. Esta descrição será usada para gerar o ETP.
            </p>
          </div>

          {/* Valor Estimado */}
          <div className="space-y-2">
            <Label htmlFor="estimatedValue">
              Valor Estimado (R$) <span className="text-destructive">*</span>
            </Label>
            <Input
              id="estimatedValue"
              placeholder="0,00"
              value={formData.estimatedValue}
              onChange={handleValueChange}
              disabled={createProcessMutation.isPending}
            />
          </div>

          {/* Modalidade e Categoria em Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Modalidade */}
            <div className="space-y-2">
              <Label htmlFor="modality">
                Modalidade <span className="text-destructive">*</span>
              </Label>
              <Select
                value={formData.modality}
                onValueChange={(value) => setFormData({ ...formData, modality: value })}
                disabled={createProcessMutation.isPending}
              >
                <SelectTrigger id="modality">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pregao">Pregão</SelectItem>
                  <SelectItem value="concorrencia">Concorrência</SelectItem>
                  <SelectItem value="tomada_precos">Tomada de Preços</SelectItem>
                  <SelectItem value="concurso">Concurso</SelectItem>
                  <SelectItem value="leilao">Leilão</SelectItem>
                  <SelectItem value="dialogo_competitivo">Diálogo Competitivo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Categoria */}
            <div className="space-y-2">
              <Label htmlFor="category">
                Categoria <span className="text-destructive">*</span>
              </Label>
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
                disabled={createProcessMutation.isPending}
              >
                <SelectTrigger id="category">
                  <SelectValue placeholder="Selecione..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="obras">Obras</SelectItem>
                  <SelectItem value="servicos">Serviços</SelectItem>
                  <SelectItem value="compras">Compras</SelectItem>
                  <SelectItem value="locacao">Locação</SelectItem>
                  <SelectItem value="alienacao">Alienação</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createProcessMutation.isPending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={createProcessMutation.isPending}>
              {createProcessMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Criar Processo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

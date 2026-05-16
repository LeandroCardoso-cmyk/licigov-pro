import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platformId: number | null;
  nextStepNumber: number;
  onSubmit: (data: any) => void;
  isLoading: boolean;
}

export function AddStepDialog({ open, onOpenChange, platformId, nextStepNumber, onSubmit, isLoading }: Props) {
  const [formData, setFormData] = useState({ title: "", description: "", category: "", isOptional: false });

  const handleSubmit = () => {
    if (!platformId || !formData.title) { toast.error("Preencha todos os campos obrigatórios"); return; }
    onSubmit({
      platformId, stepNumber: nextStepNumber, title: formData.title,
      description: formData.description || undefined, category: formData.category || undefined,
      isOptional: formData.isOptional,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar Novo Passo</DialogTitle>
          <DialogDescription>Preencha as informações do novo passo do checklist</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="stepNumber">Número do Passo</Label>
            <Input id="stepNumber" value={nextStepNumber} disabled className="bg-muted" />
          </div>
          <div>
            <Label htmlFor="title">Título *</Label>
            <Input
              id="title"
              placeholder="Ex: Acessar plataforma"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="description">Descrição</Label>
            <Textarea
              id="description"
              placeholder="Instruções detalhadas..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
            />
          </div>
          <div>
            <Label htmlFor="category">Categoria</Label>
            <Input
              id="category"
              placeholder="Ex: Acesso, Cadastro, Documentos..."
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isOptional"
              checked={formData.isOptional}
              onCheckedChange={(checked) => setFormData({ ...formData, isOptional: checked as boolean })}
            />
            <Label htmlFor="isOptional" className="cursor-pointer">Passo opcional</Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isLoading}>
              {isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Adicionando...</> : "Adicionar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

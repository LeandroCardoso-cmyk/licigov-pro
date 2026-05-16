import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

interface ChecklistStep {
  id: number;
  title: string;
  description?: string | null;
  category?: string | null;
  isOptional?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: ChecklistStep | null;
  onSubmit: (data: any) => void;
  isLoading: boolean;
}

export function EditStepDialog({ open, onOpenChange, step, onSubmit, isLoading }: Props) {
  const [formData, setFormData] = useState({
    title: step?.title || "",
    description: step?.description || "",
    category: step?.category || "",
    isOptional: step?.isOptional || false,
  });

  useEffect(() => {
    if (step) {
      setFormData({
        title: step.title || "",
        description: step.description || "",
        category: step.category || "",
        isOptional: step.isOptional || false,
      });
    }
  }, [step]);

  const handleSubmit = () => {
    if (!step || !formData.title) { toast.error("Preencha todos os campos obrigatórios"); return; }
    onSubmit({
      stepId: step.id, title: formData.title,
      description: formData.description || undefined, category: formData.category || undefined,
      isOptional: formData.isOptional,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Passo</DialogTitle>
          <DialogDescription>Atualize as informações do passo do checklist</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="edit-title">Título *</Label>
            <Input
              id="edit-title"
              placeholder="Ex: Acessar plataforma"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="edit-description">Descrição</Label>
            <Textarea
              id="edit-description"
              placeholder="Instruções detalhadas..."
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
            />
          </div>
          <div>
            <Label htmlFor="edit-category">Categoria</Label>
            <Input
              id="edit-category"
              placeholder="Ex: Acesso, Cadastro, Documentos..."
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            />
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="edit-isOptional"
              checked={formData.isOptional}
              onCheckedChange={(checked) => setFormData({ ...formData, isOptional: checked as boolean })}
            />
            <Label htmlFor="edit-isOptional" className="cursor-pointer">Passo opcional</Label>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={isLoading}>
              {isLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</> : "Salvar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

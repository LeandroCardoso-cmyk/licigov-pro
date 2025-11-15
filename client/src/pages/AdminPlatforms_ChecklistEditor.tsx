import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { trpc } from "@/lib/trpc";
import { Edit, Loader2, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Dialog para editar checklist
 */
export function ChecklistEditorDialog({
  open,
  onOpenChange,
  platformId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platformId: number | null;
}) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedStep, setSelectedStep] = useState<any>(null);

  const utils = trpc.useUtils();

  const { data: checklist, isLoading } = trpc.platforms.getChecklist.useQuery(
    { platformId: platformId || 0 },
    { enabled: !!platformId && open }
  );

  // Mutations
  const createMutation = trpc.platforms.createChecklistStep.useMutation({
    onSuccess: () => {
      toast.success("Passo adicionado com sucesso!");
      utils.platforms.getChecklist.invalidate();
      setAddDialogOpen(false);
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao adicionar passo");
    },
  });

  const updateMutation = trpc.platforms.updateChecklistStep.useMutation({
    onSuccess: () => {
      toast.success("Passo atualizado com sucesso!");
      utils.platforms.getChecklist.invalidate();
      setEditDialogOpen(false);
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao atualizar passo");
    },
  });

  const deleteMutation = trpc.platforms.deleteChecklistStep.useMutation({
    onSuccess: () => {
      toast.success("Passo removido com sucesso!");
      utils.platforms.getChecklist.invalidate();
      setDeleteDialogOpen(false);
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao remover passo");
    },
  });

  const reorderMutation = trpc.platforms.reorderChecklistStep.useMutation({
    onSuccess: () => {
      toast.success("Passo reordenado com sucesso!");
      utils.platforms.getChecklist.invalidate();
    },
    onError: (error) => {
      toast.error(error.message || "Erro ao reordenar passo");
    },
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Checklist de Publicação</DialogTitle>
            <DialogDescription>
              Adicione, edite ou remova passos do checklist de publicação
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">
                  {checklist?.length || 0} passos cadastrados
                </p>
                <Button size="sm" onClick={() => setAddDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Adicionar Passo
                </Button>
              </div>

              <div className="space-y-2">
                {checklist?.map((step) => (
                  <Card key={step.id}>
                    <CardHeader className="py-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <CardTitle className="text-sm">
                            Passo {step.stepNumber}: {step.title}
                          </CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {step.category} {step.isOptional && "• Opcional"}
                          </CardDescription>
                          {step.description && (
                            <p className="text-xs text-muted-foreground mt-2">
                              {step.description}
                            </p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => reorderMutation.mutate({ stepId: step.id, direction: "up" })}
                            disabled={reorderMutation.isPending || step.stepNumber === 1}
                            title="Mover para cima"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => reorderMutation.mutate({ stepId: step.id, direction: "down" })}
                            disabled={reorderMutation.isPending || step.stepNumber === (checklist?.length || 0)}
                            title="Mover para baixo"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedStep(step);
                              setEditDialogOpen(true);
                            }}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedStep(step);
                              setDeleteDialogOpen(true);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Fechar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog Adicionar Passo */}
      <AddStepDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        platformId={platformId}
        nextStepNumber={(checklist?.length || 0) + 1}
        onSubmit={(data) => createMutation.mutate(data)}
        isLoading={createMutation.isPending}
      />

      {/* Dialog Editar Passo */}
      <EditStepDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        step={selectedStep}
        onSubmit={(data) => updateMutation.mutate(data)}
        isLoading={updateMutation.isPending}
      />

      {/* Dialog Confirmar Exclusão */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover o passo "{selectedStep?.title}"? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedStep) {
                  deleteMutation.mutate({ stepId: selectedStep.id });
                }
              }}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Removendo..." : "Remover"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Dialog para adicionar novo passo
 */
function AddStepDialog({
  open,
  onOpenChange,
  platformId,
  nextStepNumber,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platformId: number | null;
  nextStepNumber: number;
  onSubmit: (data: any) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    category: "",
    isOptional: false,
  });

  const handleSubmit = () => {
    if (!platformId || !formData.title) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    onSubmit({
      platformId,
      stepNumber: nextStepNumber,
      title: formData.title,
      description: formData.description || undefined,
      category: formData.category || undefined,
      isOptional: formData.isOptional,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar Novo Passo</DialogTitle>
          <DialogDescription>
            Preencha as informações do novo passo do checklist
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="stepNumber">Número do Passo</Label>
            <Input
              id="stepNumber"
              value={nextStepNumber}
              disabled
              className="bg-muted"
            />
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
              onCheckedChange={(checked) =>
                setFormData({ ...formData, isOptional: checked as boolean })
              }
            />
            <Label htmlFor="isOptional" className="cursor-pointer">
              Passo opcional
            </Label>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adicionando...
                </>
              ) : (
                "Adicionar"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Dialog para editar passo existente
 */
function EditStepDialog({
  open,
  onOpenChange,
  step,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  step: any;
  onSubmit: (data: any) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    title: step?.title || "",
    description: step?.description || "",
    category: step?.category || "",
    isOptional: step?.isOptional || false,
  });

  // Atualizar form quando step mudar
  useState(() => {
    if (step) {
      setFormData({
        title: step.title || "",
        description: step.description || "",
        category: step.category || "",
        isOptional: step.isOptional || false,
      });
    }
  });

  const handleSubmit = () => {
    if (!step || !formData.title) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    onSubmit({
      stepId: step.id,
      title: formData.title,
      description: formData.description || undefined,
      category: formData.category || undefined,
      isOptional: formData.isOptional,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar Passo</DialogTitle>
          <DialogDescription>
            Atualize as informações do passo do checklist
          </DialogDescription>
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
              onCheckedChange={(checked) =>
                setFormData({ ...formData, isOptional: checked as boolean })
              }
            />
            <Label htmlFor="edit-isOptional" className="cursor-pointer">
              Passo opcional
            </Label>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSubmit} disabled={isLoading}>
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Salvar"
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

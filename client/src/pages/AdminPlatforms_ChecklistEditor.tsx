import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Edit, Loader2, Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AddStepDialog } from "@/components/checklist-editor/AddStepDialog";
import { EditStepDialog } from "@/components/checklist-editor/EditStepDialog";

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

  const createMutation = trpc.platforms.createChecklistStep.useMutation({
    onSuccess: () => { toast.success("Passo adicionado com sucesso!"); utils.platforms.getChecklist.invalidate(); setAddDialogOpen(false); },
    onError: (e) => toast.error(e.message || "Erro ao adicionar passo"),
  });

  const updateMutation = trpc.platforms.updateChecklistStep.useMutation({
    onSuccess: () => { toast.success("Passo atualizado com sucesso!"); utils.platforms.getChecklist.invalidate(); setEditDialogOpen(false); },
    onError: (e) => toast.error(e.message || "Erro ao atualizar passo"),
  });

  const deleteMutation = trpc.platforms.deleteChecklistStep.useMutation({
    onSuccess: () => { toast.success("Passo removido com sucesso!"); utils.platforms.getChecklist.invalidate(); setDeleteDialogOpen(false); },
    onError: (e) => toast.error(e.message || "Erro ao remover passo"),
  });

  const reorderMutation = trpc.platforms.reorderChecklistStep.useMutation({
    onSuccess: () => { toast.success("Passo reordenado com sucesso!"); utils.platforms.getChecklist.invalidate(); },
    onError: (e) => toast.error(e.message || "Erro ao reordenar passo"),
  });

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Checklist de Publicação</DialogTitle>
            <DialogDescription>Adicione, edite ou remova passos do checklist de publicação</DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <p className="text-sm text-muted-foreground">{checklist?.length || 0} passos cadastrados</p>
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
                          <CardTitle className="text-sm">Passo {step.stepNumber}: {step.title}</CardTitle>
                          <CardDescription className="text-xs mt-1">
                            {step.category} {step.isOptional && "• Opcional"}
                          </CardDescription>
                          {step.description && (
                            <p className="text-xs text-muted-foreground mt-2">{step.description}</p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm" variant="ghost" title="Mover para cima"
                            onClick={() => reorderMutation.mutate({ stepId: step.id, direction: "up" })}
                            disabled={reorderMutation.isPending || step.stepNumber === 1}
                          >
                            <ChevronUp className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm" variant="ghost" title="Mover para baixo"
                            onClick={() => reorderMutation.mutate({ stepId: step.id, direction: "down" })}
                            disabled={reorderMutation.isPending || step.stepNumber === (checklist?.length || 0)}
                          >
                            <ChevronDown className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setSelectedStep(step); setEditDialogOpen(true); }}>
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setSelectedStep(step); setDeleteDialogOpen(true); }}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                  </Card>
                ))}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => onOpenChange(false)}>Fechar</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AddStepDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        platformId={platformId}
        nextStepNumber={(checklist?.length || 0) + 1}
        onSubmit={(data) => createMutation.mutate(data)}
        isLoading={createMutation.isPending}
      />

      <EditStepDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        step={selectedStep}
        onSubmit={(data) => updateMutation.mutate(data)}
        isLoading={updateMutation.isPending}
      />

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
              onClick={() => selectedStep && deleteMutation.mutate({ stepId: selectedStep.id })}
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

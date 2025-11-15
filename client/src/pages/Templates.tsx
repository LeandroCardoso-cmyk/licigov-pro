import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Plus, Edit, Trash2, FileText, Star, Loader2 } from "lucide-react";
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

const documentTypeLabels: Record<string, string> = {
  etp: "ETP (Estudo Técnico Preliminar)",
  tr: "TR (Termo de Referência)",
  dfd: "DFD (Documento de Formalização de Demanda)",
  edital: "Edital",
};

export default function Templates() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [templateToDelete, setTemplateToDelete] = useState<number | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"etp" | "tr" | "dfd" | "edital">("etp");
  const [content, setContent] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const utils = trpc.useUtils();
  const { data: templates = [], isLoading } = trpc.templates.list.useQuery();
  
  const createMutation = trpc.templates.create.useMutation({
    onSuccess: () => {
      toast.success("Template criado com sucesso!");
      utils.templates.list.invalidate();
      resetForm();
      setDialogOpen(false);
    },
  });

  const updateMutation = trpc.templates.update.useMutation({
    onSuccess: () => {
      toast.success("Template atualizado com sucesso!");
      utils.templates.list.invalidate();
      resetForm();
      setDialogOpen(false);
    },
  });

  const deleteMutation = trpc.templates.delete.useMutation({
    onSuccess: () => {
      toast.success("Template excluído com sucesso!");
      utils.templates.list.invalidate();
      setDeleteDialogOpen(false);
      setTemplateToDelete(null);
    },
  });

  const resetForm = () => {
    setName("");
    setDescription("");
    setType("etp");
    setContent("");
    setIsDefault(false);
    setEditingTemplate(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !content.trim()) {
      toast.error("Nome e conteúdo são obrigatórios");
      return;
    }

    if (editingTemplate) {
      updateMutation.mutate({
        id: editingTemplate.id,
        name,
        description,
        content,
        isDefault,
      });
    } else {
      createMutation.mutate({
        name,
        description,
        type,
        content,
        isDefault,
      });
    }
  };

  const handleEdit = (template: any) => {
    setEditingTemplate(template);
    setName(template.name);
    setDescription(template.description || "");
    setType(template.type);
    setContent(template.content);
    setIsDefault(template.isDefault === 1);
    setDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    setTemplateToDelete(id);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (templateToDelete) {
      deleteMutation.mutate({ id: templateToDelete });
    }
  };

  const toggleDefault = (template: any) => {
    updateMutation.mutate({
      id: template.id,
      isDefault: template.isDefault === 1 ? false : true,
    });
  };

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Templates de Documentos</h1>
          <p className="text-muted-foreground mt-1">
            Crie e gerencie templates reutilizáveis para seus documentos
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) resetForm();
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Novo Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingTemplate ? "Editar Template" : "Novo Template"}
              </DialogTitle>
              <DialogDescription>
                {editingTemplate
                  ? "Atualize as informações do template"
                  : "Crie um template reutilizável para seus documentos"}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Nome do Template *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Template Padrão ETP"
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="description">Descrição</Label>
                  <Input
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descrição opcional do template"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="type">Tipo de Documento *</Label>
                  <Select
                    value={type}
                    onValueChange={(value: any) => setType(value)}
                    disabled={!!editingTemplate}
                  >
                    <SelectTrigger id="type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(documentTypeLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {editingTemplate && (
                    <p className="text-xs text-muted-foreground">
                      O tipo não pode ser alterado após a criação
                    </p>
                  )}
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="content">Conteúdo do Template *</Label>
                  <Textarea
                    id="content"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Digite o conteúdo do template em markdown..."
                    className="min-h-[300px] font-mono text-sm"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Use markdown para formatação. Este conteúdo será usado como base ao criar novos documentos.
                  </p>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="isDefault"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="isDefault" className="text-sm font-normal cursor-pointer">
                    Definir como template padrão para este tipo de documento
                  </Label>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setDialogOpen(false);
                    resetForm();
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                >
                  {(createMutation.isPending || updateMutation.isPending) && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {editingTemplate ? "Atualizar" : "Criar Template"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Lista de Templates */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium mb-2">Nenhum template criado</p>
            <p className="text-sm text-muted-foreground mb-4">
              Crie seu primeiro template para reutilizar em novos documentos
            </p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Criar Primeiro Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template: any) => (
            <Card key={template.id} className="relative">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      {template.name}
                      {template.isDefault === 1 && (
                        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {template.description || "Sem descrição"}
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="secondary" className="mt-2 w-fit">
                  {documentTypeLabels[template.type]}
                </Badge>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-muted-foreground">
                    Criado em {new Date(template.createdAt).toLocaleDateString("pt-BR")}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleDefault(template)}
                      title={template.isDefault === 1 ? "Remover como padrão" : "Definir como padrão"}
                    >
                      <Star className={`h-4 w-4 ${template.isDefault === 1 ? "fill-yellow-400 text-yellow-400" : ""}`} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(template)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(template.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog de Confirmação de Exclusão */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este template? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Excluindo...
                </>
              ) : (
                "Excluir"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

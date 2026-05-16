import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

const DOC_TYPE_LABELS: Record<string, string> = {
  etp: "ETP (Estudo Técnico Preliminar)",
  tr: "TR (Termo de Referência)",
  dfd: "DFD (Documento de Formalização de Demanda)",
  edital: "Edital",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingTemplate: any | null;
}

export function TemplateFormDialog({ open, onOpenChange, editingTemplate }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<"etp" | "tr" | "dfd" | "edital">("etp");
  const [content, setContent] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const utils = trpc.useUtils();

  useEffect(() => {
    if (editingTemplate) {
      setName(editingTemplate.name);
      setDescription(editingTemplate.description || "");
      setType(editingTemplate.type);
      setContent(editingTemplate.content);
      setIsDefault(editingTemplate.isDefault === 1);
    } else {
      resetForm();
    }
  }, [editingTemplate, open]);

  const resetForm = () => {
    setName(""); setDescription(""); setType("etp"); setContent(""); setIsDefault(false);
  };

  const close = () => { onOpenChange(false); resetForm(); };

  const onSuccess = () => { utils.templates.list.invalidate(); close(); };

  const createMutation = trpc.templates.create.useMutation({
    onSuccess: () => { toast.success("Template criado com sucesso!"); onSuccess(); },
  });

  const updateMutation = trpc.templates.update.useMutation({
    onSuccess: () => { toast.success("Template atualizado com sucesso!"); onSuccess(); },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !content.trim()) { toast.error("Nome e conteúdo são obrigatórios"); return; }
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, name, description, content, isDefault });
    } else {
      createMutation.mutate({ name, description, type, content, isDefault });
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); else onOpenChange(true); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editingTemplate ? "Editar Template" : "Novo Template"}</DialogTitle>
          <DialogDescription>
            {editingTemplate ? "Atualize as informações do template" : "Crie um template reutilizável para seus documentos"}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Nome do Template *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Template Padrão ETP" required />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Descrição</Label>
              <Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição opcional do template" />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="type">Tipo de Documento *</Label>
              <Select value={type} onValueChange={(v: any) => setType(v)} disabled={!!editingTemplate}>
                <SelectTrigger id="type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {editingTemplate && (
                <p className="text-xs text-muted-foreground">O tipo não pode ser alterado após a criação</p>
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
              <input type="checkbox" id="isDefault" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="h-4 w-4" />
              <Label htmlFor="isDefault" className="text-sm font-normal cursor-pointer">
                Definir como template padrão para este tipo de documento
              </Label>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>Cancelar</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingTemplate ? "Atualizar" : "Criar Template"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

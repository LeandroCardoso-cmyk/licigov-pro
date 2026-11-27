import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";
import type { TaskStatus } from "./TaskCard";

/**
 * PROMPT 08 / D-1 — diálogo ÚNICO de criação de tarefa do departamento (botão do cabeçalho e "Nova tarefa" de cada coluna do
 * Kanban). Prazo opcional enviado como data local `AAAA-MM-DD` (o servidor fixa o fim do dia em Brasília); responsável = quem
 * cria (reatribuição no detalhe da tarefa). Viewer não vê o gatilho; o servidor recusa de todo modo (NEW-006).
 */
export const PRIORITIES = [
  { value: "baixa", label: "Baixa" },
  { value: "media", label: "Média" },
  { value: "alta", label: "Alta" },
  { value: "urgente", label: "Urgente" },
] as const;

export function CreateTaskDialog({ open, onOpenChange, initialStatus = "pendente" }: {
  open: boolean; onOpenChange: (open: boolean) => void; initialStatus?: TaskStatus;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]["value"]>("media");
  const [deadline, setDeadline] = useState("");
  const reset = () => { setTitle(""); setDescription(""); setType(""); setPriority("media"); setDeadline(""); };
  const create = trpc.departmentTasks.create.useMutation({
    onSuccess: async () => {
      await utils.departmentTasks.list.invalidate();
      toast.success("Tarefa criada.");
      reset();
      onOpenChange(false);
    },
    onError: (err) => toast.error("Não foi possível criar a tarefa", { description: err.message }),
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!create.isPending) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova tarefa</DialogTitle>
          <DialogDescription>Registre uma atividade do departamento. O prazo é opcional.</DialogDescription>
        </DialogHeader>
        <form
          id="create-task-form"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) { toast.error("Informe o título da tarefa."); return; }
            create.mutate({
              title: title.trim(), description: description.trim() || undefined, type: type.trim() || "geral",
              priority, status: initialStatus, deadline: deadline || null,
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="task-title">Título *</Label>
            <Input id="task-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="task-type">Tipo de atividade</Label>
            <Input id="task-type" value={type} maxLength={50} placeholder="Ex.: Análise de documentação" onChange={(e) => setType(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="task-priority">Prioridade</Label>
              <select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm">
                {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="task-deadline">Prazo</Label>
              <Input id="task-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="task-description">Descrição</Label>
            <Textarea id="task-description" value={description} rows={3} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancelar</Button>
          <Button type="submit" form="create-task-form" disabled={create.isPending || !title.trim()}>
            {create.isPending ? "Criando…" : "Criar tarefa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

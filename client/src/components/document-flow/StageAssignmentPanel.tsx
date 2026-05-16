import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { UserCheck, UserX, UserPlus } from "lucide-react";
import { toast } from "sonner";
import type { DocType } from "./types";

interface Props {
  processId: number;
  docType: DocType;
  isOwner: boolean;
}

export function StageAssignmentPanel({ processId, docType, isOwner }: Props) {
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [note, setNote] = useState("");
  const utils = trpc.useUtils();

  const { data: assignments = [] } = trpc.collaboration.getStageAssignments.useQuery({ processId });
  const { data: members = [] } = trpc.collaboration.listMembers.useQuery({ processId });

  const current = assignments.find((a) => a.docType === docType);

  const invalidate = () => {
    utils.collaboration.getStageAssignments.invalidate({ processId });
    utils.activities.listByProcess.invalidate({ processId });
  };

  const assignMutation = trpc.collaboration.assignStage.useMutation({
    onSuccess: () => {
      toast.success("Responsável atribuído!");
      setOpen(false);
      setSelectedUserId("");
      setNote("");
      invalidate();
    },
    onError: (e) => toast.error("Erro ao atribuir", { description: e.message }),
  });

  const unassignMutation = trpc.collaboration.unassignStage.useMutation({
    onSuccess: () => { toast.success("Responsável removido."); invalidate(); },
    onError: (e) => toast.error("Erro ao remover", { description: e.message }),
  });

  if (current) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="gap-1.5 text-xs">
          <UserCheck className="h-3 w-3 text-primary" />
          {current.assignedUserName ?? "Responsável"}
        </Badge>
        {isOwner && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Remover responsável"
            onClick={() => unassignMutation.mutate({ processId, docType })}
            disabled={unassignMutation.isPending}
          >
            <UserX className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>
    );
  }

  if (!isOwner) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground gap-1">
          <UserPlus className="h-3.5 w-3.5" />
          Atribuir responsável
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Atribuir responsável — {docType.toUpperCase()}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <Select value={selectedUserId} onValueChange={setSelectedUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Selecionar membro..." />
            </SelectTrigger>
            <SelectContent>
              {members.map((m) => (
                <SelectItem key={m.userId} value={String(m.userId)}>
                  {m.userName ?? m.userEmail}
                  {m.functionalRole && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({ROLE_LABELS[m.functionalRole] ?? m.functionalRole})
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Textarea
            placeholder="Nota para o responsável (opcional)..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          <Button
            className="w-full"
            disabled={!selectedUserId || assignMutation.isPending}
            onClick={() =>
              assignMutation.mutate({
                processId,
                docType,
                assignedUserId: parseInt(selectedUserId),
                note: note || undefined,
              })
            }
          >
            Atribuir
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ROLE_LABELS: Record<string, string> = {
  solicitante: "Solicitante",
  compras: "Compras",
  juridico: "Jurídico",
  controle_interno: "Controle Interno",
  gestor: "Gestor",
  fiscal: "Fiscal",
  administrador: "Administrador",
};

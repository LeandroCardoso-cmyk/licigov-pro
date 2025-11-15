import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Users, Plus, Trash2, Mail, Shield } from "lucide-react";
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

interface MembersDialogProps {
  processId: number;
  processName: string;
}

const permissionLabels: Record<string, string> = {
  owner: "Proprietário",
  approver: "Aprovador",
  editor: "Editor",
  viewer: "Visualizador",
};

const permissionColors: Record<string, string> = {
  owner: "bg-purple-500",
  approver: "bg-blue-500",
  editor: "bg-green-500",
  viewer: "bg-gray-500",
};

export function MembersDialog({ processId, processName }: MembersDialogProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"viewer" | "editor" | "approver">("viewer");
  const [memberToRemove, setMemberToRemove] = useState<number | null>(null);

  const utils = trpc.useUtils();
  
  const { data: members = [], isLoading } = trpc.collaboration.listMembers.useQuery(
    { processId },
    { enabled: open }
  );

  const { data: currentPermission } = trpc.collaboration.checkPermission.useQuery(
    { processId },
    { enabled: open }
  );

  const addMemberMutation = trpc.collaboration.addMember.useMutation({
    onSuccess: () => {
      toast.success("Membro adicionado com sucesso!");
      setEmail("");
      setPermission("viewer");
      utils.collaboration.listMembers.invalidate({ processId });
    },
  });

  const removeMemberMutation = trpc.collaboration.removeMember.useMutation({
    onSuccess: () => {
      toast.success("Membro removido com sucesso!");
      setMemberToRemove(null);
      utils.collaboration.listMembers.invalidate({ processId });
    },
  });

  const updatePermissionMutation = trpc.collaboration.updatePermission.useMutation({
    onSuccess: () => {
      toast.success("Permissão atualizada!");
      utils.collaboration.listMembers.invalidate({ processId });
    },
  });

  const handleAddMember = () => {
    if (!email.trim()) {
      toast.error("Digite um email válido");
      return;
    }

    addMemberMutation.mutate({
      processId,
      userEmail: email.trim(),
      permission,
    });
  };

  const handleRemoveMember = (userId: number) => {
    removeMemberMutation.mutate({
      processId,
      userId,
    });
  };

  const handleUpdatePermission = (userId: number, newPermission: "viewer" | "editor" | "approver") => {
    updatePermissionMutation.mutate({
      processId,
      userId,
      permission: newPermission,
    });
  };

  const canManageMembers = currentPermission?.isOwner || currentPermission?.permission === "approver";
  const isOwner = currentPermission?.isOwner;

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Users className="mr-2 h-4 w-4" />
            Gerenciar Membros
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Membros do Processo</DialogTitle>
            <DialogDescription>
              Gerencie quem tem acesso ao processo "{processName}"
            </DialogDescription>
          </DialogHeader>

          {canManageMembers && (
            <div className="space-y-4 border-b pb-4">
              <h3 className="text-sm font-semibold">Adicionar Novo Membro</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-2">
                  <Label htmlFor="email">Email do Usuário</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="usuario@exemplo.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-9"
                      disabled={addMemberMutation.isPending}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="permission">Permissão</Label>
                  <Select
                    value={permission}
                    onValueChange={(value) => setPermission(value as any)}
                    disabled={addMemberMutation.isPending}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Visualizador</SelectItem>
                      <SelectItem value="editor">Editor</SelectItem>
                      <SelectItem value="approver">Aprovador</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                onClick={handleAddMember}
                disabled={addMemberMutation.isPending}
                className="w-full"
              >
                <Plus className="mr-2 h-4 w-4" />
                {addMemberMutation.isPending ? "Adicionando..." : "Adicionar Membro"}
              </Button>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Membros Atuais</h3>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Carregando membros...
              </div>
            ) : members.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="mx-auto h-12 w-12 mb-2 opacity-50" />
                <p>Nenhum membro adicionado ainda</p>
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-white font-semibold">
                        {member.userName?.charAt(0).toUpperCase() || "?"}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{member.userName || "Usuário"}</p>
                        <p className="text-sm text-muted-foreground">{member.userEmail}</p>
                      </div>
                      {isOwner && member.permission !== "owner" ? (
                        <Select
                          value={member.permission}
                          onValueChange={(value) =>
                            handleUpdatePermission(member.userId, value as any)
                          }
                          disabled={updatePermissionMutation.isPending}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="viewer">Visualizador</SelectItem>
                            <SelectItem value="editor">Editor</SelectItem>
                            <SelectItem value="approver">Aprovador</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge className={permissionColors[member.permission]}>
                          <Shield className="mr-1 h-3 w-3" />
                          {permissionLabels[member.permission]}
                        </Badge>
                      )}
                    </div>
                    {canManageMembers && member.permission !== "owner" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setMemberToRemove(member.userId)}
                        disabled={removeMemberMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <div className="text-xs text-muted-foreground space-y-1">
              <p><strong>Visualizador:</strong> Pode ver documentos</p>
              <p><strong>Editor:</strong> Pode editar documentos</p>
              <p><strong>Aprovador:</strong> Pode aprovar e gerenciar membros</p>
              <p><strong>Proprietário:</strong> Controle total do processo</p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={memberToRemove !== null} onOpenChange={() => setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover Membro</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja remover este membro do processo? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => memberToRemove && handleRemoveMember(memberToRemove)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

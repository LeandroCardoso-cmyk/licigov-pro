import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { UserPlus, Search, Send, X, Loader2, MoreVertical, ShieldAlert } from "lucide-react";
import { translateAuthError } from "@/utils/authErrorMessages";
import { ORG_ROLE_LABELS as ROLE_LABELS, orgRoleLabelShort } from "@/utils/orgRoleLabels";
import { useOrgRole } from "@/_core/hooks/useOrgRole";

type OrgRole = "owner" | "admin" | "manager" | "operator" | "viewer";
/** Papéis atribuíveis via UI — owner só é definido pelo onboarding de tenant (nunca aqui). */
type AssignableRole = Exclude<OrgRole, "owner">;

const INVITABLE_ROLES: AssignableRole[] = ["admin", "manager", "operator", "viewer"];
const ASSIGNABLE_ROLES: AssignableRole[] = ["admin", "manager", "operator", "viewer"];

const INVITATION_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  accepted: "Aceito",
  expired: "Expirado",
  cancelled: "Cancelado",
  superseded: "Substituído",
};

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function Usuarios() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<AssignableRole>("operator");
  const [inviteError, setInviteError] = useState("");

  const [pendingRemoval, setPendingRemoval] = useState<{ userId: number; label: string; kind: "deactivate" | "remove" } | null>(null);

  // PR A.1 (refinamento) — autorização de EXPERIÊNCIA por papel de organização (o backend já
  // protege cada procedure com orgRoleProcedure("admin")). Só admin/owner gerenciam usuários.
  const { canManageUsers, isLoading: roleLoading } = useOrgRole();

  const currentOrgQuery = trpc.organizations.getCurrent.useQuery();
  // Queries administrativas só disparam para quem pode gerenciar — evita FORBIDDEN desnecessário.
  const membersQuery = trpc.organizations.listAllMembersWithUsers.useQuery(undefined, { enabled: canManageUsers });
  const invitationsQuery = trpc.invitations.list.useQuery(undefined, { enabled: canManageUsers });

  const invalidateAll = () => {
    utils.organizations.listAllMembersWithUsers.invalidate();
    utils.invitations.list.invalidate();
  };

  const createInviteMutation = trpc.invitations.create.useMutation({
    onSuccess: () => {
      toast.success("Convite enviado com sucesso.");
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("operator");
      setInviteError("");
      invalidateAll();
    },
    onError: (err) => setInviteError(translateAuthError(err.message)),
  });

  const resendMutation = trpc.invitations.resend.useMutation({
    onSuccess: () => { toast.success("Convite reenviado."); invalidateAll(); },
    onError: (err) => toast.error(translateAuthError(err.message)),
  });

  const cancelMutation = trpc.invitations.cancel.useMutation({
    onSuccess: () => { toast.success("Convite cancelado."); invalidateAll(); },
    onError: (err) => toast.error(translateAuthError(err.message)),
  });

  const updateRoleMutation = trpc.organizations.updateMemberRole.useMutation({
    onSuccess: () => { toast.success("Papel atualizado."); invalidateAll(); },
    onError: (err) => toast.error(translateAuthError(err.message)),
  });

  const deactivateMutation = trpc.organizations.deactivateMember.useMutation({
    onSuccess: () => { toast.success("Membro desativado."); setPendingRemoval(null); invalidateAll(); },
    onError: (err) => { toast.error(translateAuthError(err.message)); setPendingRemoval(null); },
  });

  const activateMutation = trpc.organizations.activateMember.useMutation({
    onSuccess: () => { toast.success("Membro reativado."); invalidateAll(); },
    onError: (err) => toast.error(translateAuthError(err.message)),
  });

  const removeMutation = trpc.organizations.removeMember.useMutation({
    onSuccess: () => { toast.success("Usuário removido da organização."); setPendingRemoval(null); invalidateAll(); },
    onError: (err) => { toast.error(translateAuthError(err.message)); setPendingRemoval(null); },
  });

  const members = membersQuery.data ?? [];
  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return members;
    return members.filter(
      m => (m.user.name ?? "").toLowerCase().includes(term) || (m.user.email ?? "").toLowerCase().includes(term)
    );
  }, [members, search]);

  const pendingInvitations = (invitationsQuery.data ?? []).filter(i => i.status === "pending");
  const invitationHistory = (invitationsQuery.data ?? []).filter(i => i.status !== "pending");

  const handleInviteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError("");
    createInviteMutation.mutate({ email: inviteEmail, role: inviteRole, invitedName: inviteName || undefined });
  };

  // ── Guarda de rota: acesso direto por URL sem papel admin/owner → "Acesso não autorizado".
  //    (O backend já retorna FORBIDDEN; isto é a experiência correta no frontend.)
  if (roleLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!canManageUsers) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
              <ShieldAlert className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Acesso não autorizado</CardTitle>
            <CardDescription>
              A gestão de usuários é restrita a administradores da organização. Fale com um
              administrador se precisar de acesso.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => (window.location.href = "/dashboard")}>
              Voltar ao início
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="bg-background">
      <div className="border-b bg-card">
        <div className="container py-6">
          <Breadcrumbs items={[{ label: "Usuários" }]} className="mb-2" />
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground">Usuários da organização</h1>
              <p className="text-muted-foreground mt-1">
                {currentOrgQuery.data ? currentOrgQuery.data.org.nome : "Carregando organização..."}
              </p>
            </div>
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <Button size="lg" className="gap-2">
                  <UserPlus className="h-4 w-4" />
                  Convidar usuário
                </Button>
              </DialogTrigger>
              <DialogContent>
                <form onSubmit={handleInviteSubmit}>
                  <DialogHeader>
                    <DialogTitle>Convidar usuário</DialogTitle>
                    <DialogDescription>
                      Será enviado um convite de acesso ao usuário informado. O convite expira em 7 dias.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="invite-email">E-mail</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        placeholder="usuario@orgao.gov.br"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        required
                        autoFocus
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invite-name">Nome (opcional)</Label>
                      <Input
                        id="invite-name"
                        type="text"
                        placeholder="Nome do convidado"
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invite-role">Papel</Label>
                      <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AssignableRole)}>
                        <SelectTrigger id="invite-role">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INVITABLE_ROLES.map(role => (
                            <SelectItem key={role} value={role}>{ROLE_LABELS[role]}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {inviteError && (
                      <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{inviteError}</p>
                    )}
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={createInviteMutation.isPending}>
                      {createInviteMutation.isPending ? "Enviando..." : "Enviar convite"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </div>

      <div className="container py-6 space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Membros</CardTitle>
            <CardDescription>Usuários com acesso a esta organização, ativos e desativados.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome ou e-mail..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {membersQuery.isLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Último acesso</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMembers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        Nenhum membro encontrado.
                      </TableCell>
                    </TableRow>
                  )}
                  {filteredMembers.map(m => {
                    const isOwner = m.role === "owner";
                    const memberLabel = m.user.name ?? m.user.email ?? "este membro";
                    return (
                    <TableRow key={m.userId}>
                      <TableCell className="font-medium">{m.user.name ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{m.user.email ?? "—"}</TableCell>
                      <TableCell>
                        {/* Papel: badge com rótulo CURTO (owner→"Administrador" na tabela). */}
                        <Badge variant={isOwner ? "secondary" : "outline"}>{orgRoleLabelShort(m.role)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.ativo ? "default" : "outline"}>{m.ativo ? "Ativo" : "Desativado"}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(m.user.lastSignedIn)}</TableCell>
                      <TableCell className="text-right">
                        {/* Menu de contexto (⋮) — estruturado para expansão futura. */}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Ações para ${memberLabel}`}>
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel className="truncate">{memberLabel}</DropdownMenuLabel>
                            <DropdownMenuSeparator />

                            <DropdownMenuItem disabled>Editar usuário (em breve)</DropdownMenuItem>

                            {/* Alterar papel — submenu (owner não pode ser alterado por esta API). */}
                            <DropdownMenuSub>
                              <DropdownMenuSubTrigger disabled={isOwner || updateRoleMutation.isPending}>
                                Alterar papel
                              </DropdownMenuSubTrigger>
                              <DropdownMenuSubContent>
                                {ASSIGNABLE_ROLES.map(role => (
                                  <DropdownMenuItem
                                    key={role}
                                    disabled={m.role === role}
                                    onClick={() => updateRoleMutation.mutate({ userId: m.userId, role })}
                                  >
                                    {ROLE_LABELS[role]}
                                    {m.role === role && <span className="ml-auto text-xs text-muted-foreground">atual</span>}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuSubContent>
                            </DropdownMenuSub>

                            <DropdownMenuSeparator />

                            {m.ativo ? (
                              <DropdownMenuItem
                                disabled={isOwner}
                                onClick={() => setPendingRemoval({ userId: m.userId, label: memberLabel, kind: "deactivate" })}
                              >
                                Desativar
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                disabled={activateMutation.isPending}
                                onClick={() => activateMutation.mutate({ userId: m.userId })}
                              >
                                Reativar
                              </DropdownMenuItem>
                            )}

                            <DropdownMenuItem
                              variant="destructive"
                              disabled={isOwner}
                              onClick={() => setPendingRemoval({ userId: m.userId, label: memberLabel, kind: "remove" })}
                            >
                              Remover da organização
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Convites pendentes</CardTitle>
            <CardDescription>Aguardando aceite. Convites expiram em 7 dias.</CardDescription>
          </CardHeader>
          <CardContent>
            {pendingInvitations.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nenhum convite pendente.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Expira em</TableHead>
                    <TableHead>Reenvios</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingInvitations.map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.emailNormalized}</TableCell>
                      <TableCell>{ROLE_LABELS[inv.role as OrgRole] ?? inv.role}</TableCell>
                      <TableCell className="text-muted-foreground">{formatDate(inv.expiresAt)}</TableCell>
                      <TableCell className="text-muted-foreground">{inv.resendCount}</TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={resendMutation.isPending}
                          onClick={() => resendMutation.mutate({ invitationId: inv.id })}
                        >
                          <Send className="h-4 w-4 mr-1" />
                          Reenviar
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={cancelMutation.isPending}
                          onClick={() => cancelMutation.mutate({ invitationId: inv.id })}
                        >
                          <X className="h-4 w-4 mr-1" />
                          Cancelar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {invitationHistory.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Histórico de convites</CardTitle>
              <CardDescription>Convites aceitos, cancelados, expirados ou substituídos.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>E-mail</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitationHistory.map(inv => (
                    <TableRow key={inv.id}>
                      <TableCell className="text-muted-foreground">{inv.emailNormalized}</TableCell>
                      <TableCell className="text-muted-foreground">{ROLE_LABELS[inv.role as OrgRole] ?? inv.role}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{INVITATION_STATUS_LABELS[inv.status] ?? inv.status}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={pendingRemoval !== null} onOpenChange={(open) => !open && setPendingRemoval(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRemoval?.kind === "remove" ? "Remover da organização" : "Desativar membro"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRemoval && (pendingRemoval.kind === "remove"
                ? `${pendingRemoval.label} deixará de ter acesso a esta organização.`
                : `${pendingRemoval.label} perderá acesso a esta organização. Você pode reativar depois.`)}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingRemoval) return;
                if (pendingRemoval.kind === "remove") removeMutation.mutate({ userId: pendingRemoval.userId });
                else deactivateMutation.mutate({ userId: pendingRemoval.userId });
              }}
            >
              {pendingRemoval?.kind === "remove" ? "Remover" : "Desativar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

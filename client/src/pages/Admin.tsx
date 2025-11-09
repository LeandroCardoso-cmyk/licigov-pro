import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, User, TrendingUp, ArrowLeft, FileText } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
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
import { useState } from "react";

export default function Admin() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [promotingUserId, setPromotingUserId] = useState<number | null>(null);
  const [demotingUserId, setDemotingUserId] = useState<number | null>(null);

  const { data: users, isLoading, refetch } = trpc.admin.listUsers.useQuery();

  const promoteToAdminMutation = trpc.admin.promoteToAdmin.useMutation({
    onSuccess: () => {
      toast.success("Usuário promovido a administrador!");
      setPromotingUserId(null);
      refetch();
    },
    onError: (error) => {
      toast.error("Erro ao promover usuário", { description: error.message });
    },
  });

  const demoteFromAdminMutation = trpc.admin.demoteFromAdmin.useMutation({
    onSuccess: () => {
      toast.success("Administrador rebaixado para usuário!");
      setDemotingUserId(null);
      refetch();
    },
    onError: (error) => {
      toast.error("Erro ao rebaixar administrador", { description: error.message });
    },
  });

  if (user?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>Apenas administradores podem acessar esta página</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setLocation("/")} className="w-full">
              Voltar para Início
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const handlePromote = (userId: number) => {
    promoteToAdminMutation.mutate({ userId });
  };

  const handleDemote = (userId: number) => {
    demoteFromAdminMutation.mutate({ userId });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto py-8">
        <Button variant="ghost" onClick={() => setLocation("/")} className="mb-6">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>

        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Painel de Administração</h1>
            <p className="text-muted-foreground">
              Gerencie usuários e permissões do sistema
            </p>
          </div>
          <Button onClick={() => setLocation("/audit-logs")} variant="outline">
            <FileText className="mr-2 h-4 w-4" />
            Ver Logs de Auditoria
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Usuários Cadastrados</CardTitle>
            <CardDescription>Total de {users?.length || 0} usuários</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {users?.map((u) => (
                <div key={u.id} className="flex items-center justify-between border-b pb-4 last:border-b-0">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      {u.role === "admin" ? (
                        <Shield className="h-5 w-5 text-primary" />
                      ) : (
                        <User className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                    <div>
                      <div className="font-medium">{u.name || "Sem nome"}</div>
                      <div className="text-sm text-muted-foreground">{u.email || "Sem email"}</div>
                      <div className="text-xs text-muted-foreground">
                        ID: {u.id} • Cadastrado em {new Date(u.createdAt).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                      {u.role === "admin" ? "Administrador" : "Usuário"}
                    </Badge>
                    {u.id !== user.id && (
                      <>
                        {u.role === "admin" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setDemotingUserId(u.id)}
                            disabled={demoteFromAdminMutation.isPending}
                          >
                            <TrendingUp className="mr-2 h-4 w-4 rotate-180" />
                            Rebaixar
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPromotingUserId(u.id)}
                            disabled={promoteToAdminMutation.isPending}
                          >
                            <TrendingUp className="mr-2 h-4 w-4" />
                            Promover
                          </Button>
                        )}
                      </>
                    )}
                    {u.id === user.id && (
                      <Badge variant="outline" className="text-xs">Você</Badge>
                    )}
                  </div>
                </div>
              ))}
              {users?.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  Nenhum usuário cadastrado
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Dialog de confirmação de promoção */}
        <AlertDialog
          open={promotingUserId !== null}
          onOpenChange={() => setPromotingUserId(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Promover a Administrador</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja promover este usuário a administrador? Ele terá acesso total ao sistema, incluindo gerenciamento de outros usuários.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => promotingUserId && handlePromote(promotingUserId)}>
                Promover
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Dialog de confirmação de rebaixamento */}
        <AlertDialog
          open={demotingUserId !== null}
          onOpenChange={() => setDemotingUserId(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rebaixar para Usuário</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja rebaixar este administrador para usuário comum? Ele perderá acesso ao painel administrativo e outras funcionalidades de admin.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => demotingUserId && handleDemote(demotingUserId)}>
                Rebaixar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, User, TrendingUp, ArrowLeft, FileText, AlertCircle, DollarSign, BarChart3, Users, FileCheck, ScrollText, Calendar } from "lucide-react";
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
  
  // Buscar estatísticas gerais
  const { data: processesData } = trpc.processes.list.useQuery({ status: undefined, year: undefined });
  const { data: directContractsData } = trpc.directContracts.list.useQuery({ type: undefined, status: undefined, year: undefined });
  const { data: contractsOverview } = trpc.contracts.analytics.getOverview.useQuery();
  const { data: proposalsData } = trpc.proposals.list.useQuery();

  const promoteToAdminMutation = trpc.admin.promoteToAdmin.useMutation({
    onSuccess: () => {
      toast.success("Usuário promovido a administrador!");
      setPromotingUserId(null);
      refetch();
    },
  });

  const demoteFromAdminMutation = trpc.admin.demoteFromAdmin.useMutation({
    onSuccess: () => {
      toast.success("Administrador rebaixado para usuário!");
      setDemotingUserId(null);
      refetch();
    },
  });

  if (user?.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50">
        <Card className="w-full max-w-md shadow-xl">
          <CardHeader>
            <CardTitle>Acesso Negado</CardTitle>
            <CardDescription>Apenas administradores podem acessar esta página</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => setLocation("/dashboard")} className="w-full bg-gradient-to-r from-blue-600 to-indigo-600">
              Voltar para Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50">
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="container mx-auto py-8 px-4">
        <Button variant="ghost" onClick={() => setLocation("/dashboard")} className="mb-6 hover:bg-blue-50">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar ao Dashboard
        </Button>

        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Painel de Administração
          </h1>
          <p className="text-gray-600 text-lg">
            Gerencie usuários, assinaturas, propostas e documentos do sistema
          </p>
        </div>

        {/* Estatísticas Gerais */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="border-2 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600">Total de Usuários</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                  <Users className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-gray-900">{users?.length || 0}</p>
                  <p className="text-xs text-gray-600">
                    {users?.filter(u => u.role === 'admin').length || 0} admins
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600">Processos Licitatórios</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                  <FileText className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-gray-900">{processesData?.length || 0}</p>
                  <p className="text-xs text-gray-600">Total de processos</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600">Contratações Diretas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                  <FileCheck className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-gray-900">{directContractsData?.length || 0}</p>
                  <p className="text-xs text-gray-600">Dispensas e inexigibilidades</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 hover:shadow-lg transition-shadow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600">Contratos Vigentes</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-gradient-to-br from-green-500 to-green-600 text-white">
                  <ScrollText className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-3xl font-bold text-gray-900">{contractsOverview?.activeCount || 0}</p>
                  <p className="text-xs text-gray-600">
                    {contractsOverview?.expiredCount || 0} vencidos
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cards de Navegação - Gestão de Assinaturas */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-blue-600" />
            Gestão de Assinaturas
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all border-2 hover:border-blue-300" onClick={() => setLocation("/gestao-comercial")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                  Assinaturas
                </CardTitle>
                <CardDescription>Visualize e gerencie todas as assinaturas (Stripe + Empenho)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Total de propostas</span>
                  <Badge variant="secondary">{proposalsData?.length || 0}</Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all border-2 hover:border-purple-300" onClick={() => setLocation("/admin/propostas")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 text-white">
                    <FileText className="h-5 w-5" />
                  </div>
                  Propostas
                </CardTitle>
                <CardDescription>Gerencie solicitações, registre empenhos e ative assinaturas</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Pendentes</span>
                  <Badge variant="secondary">
                    {proposalsData?.filter(p => p.status === 'pendente').length || 0}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all border-2 hover:border-orange-300" onClick={() => setLocation("/admin/documentos")}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 text-white">
                    <FileText className="h-5 w-5" />
                  </div>
                  Documentos
                </CardTitle>
                <CardDescription>Gerencie certidões e documentos da empresa</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Gestão de docs</span>
                  <Badge variant="secondary">Ativo</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Cards de Navegação - Gestão Financeira */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-green-600" />
            Gestão Financeira e Relatórios
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all border-2 hover:border-red-300 opacity-75" onClick={() => toast.info("Em breve", { description: "Funcionalidade em desenvolvimento" })}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-red-500 to-red-600 text-white">
                    <AlertCircle className="h-5 w-5" />
                  </div>
                  Inadimplência
                  <Badge variant="secondary" className="ml-auto">Em Breve</Badge>
                </CardTitle>
                <CardDescription>Dashboard de parcelas atrasadas e ações em massa</CardDescription>
              </CardHeader>
            </Card>

            <Card className="cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all border-2 hover:border-green-300 opacity-75" onClick={() => toast.info("Em breve", { description: "Funcionalidade em desenvolvimento" })}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-green-500 to-green-600 text-white">
                    <DollarSign className="h-5 w-5" />
                  </div>
                  Relatórios Financeiros
                  <Badge variant="secondary" className="ml-auto">Em Breve</Badge>
                </CardTitle>
                <CardDescription>Receita prevista vs recebida, taxa de inadimplência e projeções</CardDescription>
              </CardHeader>
            </Card>

            <Card className="cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all border-2 hover:border-blue-300 opacity-75" onClick={() => toast.info("Em breve", { description: "Funcionalidade em desenvolvimento" })}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                    <Calendar className="h-5 w-5" />
                  </div>
                  Contratos no Limite
                  <Badge variant="secondary" className="ml-auto">Em Breve</Badge>
                </CardTitle>
                <CardDescription>Contratos com 7+ renovações que precisam de novo processo licitatório</CardDescription>
              </CardHeader>
            </Card>
          </div>
        </div>

        {/* Gestão de Usuários */}
        <Card className="border-2 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
            <CardTitle className="flex items-center gap-2 text-2xl">
              <Users className="h-6 w-6 text-blue-600" />
              Usuários Cadastrados
            </CardTitle>
            <CardDescription className="text-base">Total de {users?.length || 0} usuários no sistema</CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {users?.map((u) => (
                <div key={u.id} className="flex items-center justify-between border-b pb-4 last:border-b-0 hover:bg-gray-50 p-3 rounded-lg transition-colors">
                  <div className="flex items-center gap-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                      u.role === "admin" 
                        ? "bg-gradient-to-br from-blue-500 to-indigo-600" 
                        : "bg-gray-200"
                    }`}>
                      {u.role === "admin" ? (
                        <Shield className="h-6 w-6 text-white" />
                      ) : (
                        <User className="h-6 w-6 text-gray-600" />
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">{u.name || "Sem nome"}</div>
                      <div className="text-sm text-gray-600">{u.email || "Sem email"}</div>
                      <div className="text-xs text-gray-500 mt-1">
                        ID: {u.id} • Cadastrado em {new Date(u.createdAt).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge 
                      variant={u.role === "admin" ? "default" : "secondary"}
                      className={u.role === "admin" ? "bg-gradient-to-r from-blue-600 to-indigo-600" : ""}
                    >
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
                            className="hover:bg-red-50 hover:border-red-300"
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
                            className="hover:bg-blue-50 hover:border-blue-300"
                          >
                            <TrendingUp className="mr-2 h-4 w-4" />
                            Promover
                          </Button>
                        )}
                      </>
                    )}
                    {u.id === user.id && (
                      <Badge variant="outline" className="text-xs border-blue-300 text-blue-700">Você</Badge>
                    )}
                  </div>
                </div>
              ))}
              {users?.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Users className="h-12 w-12 mx-auto mb-3 text-gray-400" />
                  <p>Nenhum usuário cadastrado</p>
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
              <AlertDialogAction 
                onClick={() => promotingUserId && handlePromote(promotingUserId)}
                className="bg-gradient-to-r from-blue-600 to-indigo-600"
              >
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
              <AlertDialogAction 
                onClick={() => demotingUserId && handleDemote(demotingUserId)}
                className="bg-gradient-to-r from-red-600 to-red-700"
              >
                Rebaixar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

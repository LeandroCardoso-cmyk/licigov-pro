import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, TrendingUp, ArrowLeft, FileText, AlertCircle, DollarSign, BarChart3, Calendar } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { AdminStatsGrid } from "@/components/admin/AdminStatsGrid";
import { AdminUsersTable } from "@/components/admin/AdminUsersTable";

export default function Admin() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [promotingUserId, setPromotingUserId] = useState<number | null>(null);
  const [demotingUserId, setDemotingUserId] = useState<number | null>(null);

  const { data: users, isLoading, refetch } = trpc.admin.listUsers.useQuery();
  const { data: processesData } = trpc.processes.list.useQuery();
  const { data: directContractsData } = trpc.directContracts.list.useQuery({ type: undefined, status: undefined, year: undefined });
  const { data: contractsOverview } = trpc.contracts.analytics.getOverview.useQuery();
  const { data: proposalsData } = (trpc as any).proposals?.list?.useQuery?.() ?? { data: undefined };

  const promoteToAdminMutation = trpc.admin.promoteToAdmin.useMutation({
    onSuccess: () => { toast.success("Usuário promovido a administrador!"); setPromotingUserId(null); refetch(); },
  });
  const demoteFromAdminMutation = trpc.admin.demoteFromAdmin.useMutation({
    onSuccess: () => { toast.success("Administrador rebaixado para usuário!"); setDemotingUserId(null); refetch(); },
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="container mx-auto py-8 px-4">
        <Button variant="ghost" onClick={() => setLocation("/dashboard")} className="mb-6 hover:bg-blue-50">
          <ArrowLeft className="mr-2 h-4 w-4" />Voltar ao Dashboard
        </Button>
        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
            Painel de Administração
          </h1>
          <p className="text-gray-600 text-lg">Gerencie usuários, assinaturas, propostas e documentos do sistema</p>
        </div>

        <AdminStatsGrid
          totalUsers={users?.length ?? 0}
          adminCount={users?.filter((u) => u.role === "admin").length ?? 0}
          totalProcesses={processesData?.length ?? 0}
          totalDirectContracts={directContractsData?.length ?? 0}
          activeContracts={contractsOverview?.active ?? 0}
          expiredContracts={contractsOverview?.expired ?? 0}
        />

        {/* Gestão de Assinaturas */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-blue-600" />Gestão de Assinaturas
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { href: "/gestao-comercial", title: "Assinaturas", desc: "Visualize e gerencie todas as assinaturas (Stripe + Empenho)", Icon: TrendingUp, gradient: "from-blue-500 to-blue-600", border: "hover:border-blue-300", sub: "Total de propostas", count: proposalsData?.length ?? 0 },
              { href: "/admin/propostas", title: "Propostas", desc: "Gerencie solicitações, registre empenhos e ative assinaturas", Icon: FileText, gradient: "from-purple-500 to-purple-600", border: "hover:border-purple-300", sub: "Pendentes", count: proposalsData?.filter((p: any) => p.status === "pendente").length ?? 0 },
              { href: "/admin/documentos", title: "Documentos", desc: "Gerencie certidões e documentos da empresa", Icon: FileText, gradient: "from-orange-500 to-orange-600", border: "hover:border-orange-300", sub: "Gestão de docs", count: null as number | null },
            ].map(({ href, title, desc, Icon, gradient, border, sub, count }) => (
              <Card key={href} className={`cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all border-2 ${border}`} onClick={() => setLocation(href)}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg bg-gradient-to-br ${gradient} text-white`}><Icon className="h-5 w-5" /></div>
                    {title}
                  </CardTitle>
                  <CardDescription>{desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">{sub}</span>
                    <Badge variant="secondary">{count !== null ? count : "Ativo"}</Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Gestão Financeira */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-4 flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-green-600" />Gestão Financeira e Relatórios
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: "Inadimplência", desc: "Dashboard de parcelas atrasadas e ações em massa", Icon: AlertCircle, gradient: "from-red-500 to-red-600", border: "hover:border-red-300" },
              { title: "Relatórios Financeiros", desc: "Receita prevista vs recebida, taxa de inadimplência e projeções", Icon: DollarSign, gradient: "from-green-500 to-green-600", border: "hover:border-green-300" },
              { title: "Contratos no Limite", desc: "Contratos com 7+ renovações que precisam de novo processo licitatório", Icon: Calendar, gradient: "from-blue-500 to-blue-600", border: "hover:border-blue-300" },
            ].map(({ title, desc, Icon, gradient, border }) => (
              <Card key={title} className={`cursor-pointer hover:shadow-xl hover:scale-[1.02] transition-all border-2 ${border} opacity-75`}
                onClick={() => toast.info("Em breve", { description: "Funcionalidade em desenvolvimento" })}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <div className={`p-2 rounded-lg bg-gradient-to-br ${gradient} text-white`}><Icon className="h-5 w-5" /></div>
                    {title}
                    <Badge variant="secondary" className="ml-auto">Em Breve</Badge>
                  </CardTitle>
                  <CardDescription>{desc}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>

        <AdminUsersTable
          users={users ?? []}
          currentUserId={user.id}
          promotePending={promoteToAdminMutation.isPending}
          demotePending={demoteFromAdminMutation.isPending}
          onPromote={setPromotingUserId}
          onDemote={setDemotingUserId}
        />

        <AlertDialog open={promotingUserId !== null} onOpenChange={() => setPromotingUserId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Promover a Administrador</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja promover este usuário a administrador? Ele terá acesso total ao sistema.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => promotingUserId && promoteToAdminMutation.mutate({ userId: promotingUserId })} className="bg-gradient-to-r from-blue-600 to-indigo-600">
                Promover
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={demotingUserId !== null} onOpenChange={() => setDemotingUserId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Rebaixar para Usuário</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja rebaixar este administrador para usuário comum? Ele perderá acesso ao painel administrativo.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => demotingUserId && demoteFromAdminMutation.mutate({ userId: demotingUserId })} className="bg-gradient-to-r from-red-600 to-red-700">
                Rebaixar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { CreditCard, FileText, Loader2, Search, X } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
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

export default function AdminSubscriptions() {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMethod, setFilterMethod] = useState<"all" | "stripe" | "empenho">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "canceled">("all");
  const [cancelSubscriptionId, setCancelSubscriptionId] = useState<number | null>(null);

  const { data: subscriptions, isLoading, refetch } = trpc.billing.getAllSubscriptions.useQuery();
  const cancelMutation = trpc.billing.cancelSubscription.useMutation();

  const handleCancelSubscription = async () => {
    if (!cancelSubscriptionId) return;

    try {
      await cancelMutation.mutateAsync({ subscriptionId: cancelSubscriptionId });
      toast.success("Assinatura cancelada com sucesso");
      refetch();
      setCancelSubscriptionId(null);
    } catch (error: any) {
      toast.error(error.message || "Erro ao cancelar assinatura");
    }
  };

  const filteredSubscriptions = subscriptions?.filter((sub) => {
    const matchesSearch =
      searchTerm === "" ||
      sub.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sub.userEmail?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesMethod =
      filterMethod === "all" ||
      (filterMethod === "stripe" && sub.stripeSubscriptionId) ||
      (filterMethod === "empenho" && !sub.stripeSubscriptionId);

    const matchesStatus =
      filterStatus === "all" ||
      (filterStatus === "active" && sub.status === "active") ||
      (filterStatus === "canceled" && sub.status === "canceled");

    return matchesSearch && matchesMethod && matchesStatus;
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Gerenciar Assinaturas</CardTitle>
          <CardDescription>
            Visualize e gerencie todas as assinaturas (Stripe e Empenho)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Filtros */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
              <Input
                placeholder="Buscar por nome ou email..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterMethod} onValueChange={(v: any) => setFilterMethod(v)}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os métodos</SelectItem>
                <SelectItem value="stripe">Stripe</SelectItem>
                <SelectItem value="empenho">Empenho</SelectItem>
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={(v: any) => setFilterStatus(v)}>
              <SelectTrigger className="w-full md:w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="active">Ativas</SelectItem>
                <SelectItem value="canceled">Canceladas</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Tabela */}
          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSubscriptions && filteredSubscriptions.length > 0 ? (
                  filteredSubscriptions.map((sub) => (
                    <TableRow key={sub.id}>
                      <TableCell>
                        <div>
                          <div className="font-medium">{sub.userName}</div>
                          {sub.userEmail && (
                            <div className="text-sm text-muted-foreground">{sub.userEmail}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{sub.planName}</div>
                        <div className="text-sm text-muted-foreground">
                          R$ {sub.planPrice.toFixed(2)}/mês
                        </div>
                      </TableCell>
                      <TableCell>
                        {sub.stripeSubscriptionId ? (
                          <Badge variant="default" className="gap-1">
                            <CreditCard className="w-3 h-3" />
                            Stripe
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="gap-1">
                            <FileText className="w-3 h-3" />
                            Empenho
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {sub.status === "active" ? (
                          <Badge variant="default" className="bg-green-600">
                            Ativa
                          </Badge>
                        ) : sub.status === "canceled" ? (
                          <Badge variant="secondary">Cancelada</Badge>
                        ) : (
                          <Badge variant="outline">{sub.status}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {sub.currentPeriodEnd ? (
                          <div className="text-sm">
                            {format(new Date(sub.currentPeriodEnd), "dd/MM/yyyy", { locale: ptBR })}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {sub.status === "active" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCancelSubscriptionId(sub.id)}
                          >
                            <X className="w-4 h-4 mr-1" />
                            Cancelar
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Nenhuma assinatura encontrada
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Estatísticas */}
          {subscriptions && subscriptions.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>Total de Assinaturas</CardDescription>
                  <CardTitle className="text-3xl">{subscriptions.length}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>Assinaturas Ativas</CardDescription>
                  <CardTitle className="text-3xl text-green-600">
                    {subscriptions.filter((s) => s.status === "active").length}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-3">
                  <CardDescription>Receita Mensal Estimada</CardDescription>
                  <CardTitle className="text-3xl">
                    R${" "}
                    {subscriptions
                      .filter((s) => s.status === "active")
                      .reduce((sum, s) => sum + s.planPrice, 0)
                      .toFixed(2)}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialog de Confirmação de Cancelamento */}
      <AlertDialog open={cancelSubscriptionId !== null} onOpenChange={() => setCancelSubscriptionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar Assinatura</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja cancelar esta assinatura? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancelSubscription}
              className="bg-red-600 hover:bg-red-700"
            >
              Cancelar Assinatura
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

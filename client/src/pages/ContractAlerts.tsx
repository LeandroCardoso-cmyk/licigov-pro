import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, AlertTriangle, Clock, Calendar, FileText, Bell, Download } from "lucide-react";
import { toast } from "sonner";
import { differenceInDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Página de Alertas de Contratos
 * Exibe contratos próximos ao vencimento e vencidos
 */
export default function ContractAlerts() {
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<"all" | "expired" | "30" | "60" | "90">("all");
  
  // Mutation para exportar Excel
  const exportExcelMutation = trpc.contracts.reports.exportAlertsExcel.useMutation({
    onSuccess: (data) => {
      // Converter base64 para blob e fazer download
      const byteCharacters = atob(data.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = data.filename;
      link.click();
      window.URL.revokeObjectURL(url);
      toast.success("Relatório exportado com sucesso!");
    },
    onError: (error) => {
      toast.error("Erro ao exportar relatório", {
        description: error.message,
      });
    },
  });
  
  // Mutation para verificar vencimentos manualmente
  const checkExpirationsMutation = trpc.contracts.notifications.checkExpirations.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Verificação concluída!`, {
          description: `${data.notificationsSent} notificações enviadas`,
        });
      } else {
        toast.error("Erro ao verificar vencimentos", {
          description: data.message,
        });
      }
    },
    onError: (error) => {
      toast.error("Erro ao verificar vencimentos", {
        description: error.message,
      });
    },
  });

  // Buscar todos os contratos ativos
  const { data: contracts, isLoading } = trpc.contracts.list.useQuery({
    status: "active",
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Carregando alertas...</p>
      </div>
    );
  }

  // Calcular dias até vencimento e filtrar
  const contractsWithDays = (contracts || []).map((contract) => {
    const daysUntilExpiry = differenceInDays(new Date(contract.endDate), new Date());
    return { ...contract, daysUntilExpiry };
  });

  // Aplicar filtro
  const filteredContracts = contractsWithDays.filter((contract) => {
    if (filter === "expired") return contract.daysUntilExpiry < 0;
    if (filter === "30") return contract.daysUntilExpiry >= 0 && contract.daysUntilExpiry <= 30;
    if (filter === "60") return contract.daysUntilExpiry > 30 && contract.daysUntilExpiry <= 60;
    if (filter === "90") return contract.daysUntilExpiry > 60 && contract.daysUntilExpiry <= 90;
    return true; // "all"
  });

  // Ordenar por dias até vencimento (mais urgente primeiro)
  const sortedContracts = filteredContracts.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  // Função para obter badge de alerta
  const getAlertBadge = (days: number) => {
    if (days < 0) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Vencido há {Math.abs(days)} dias
        </Badge>
      );
    } else if (days <= 30) {
      return (
        <Badge variant="destructive" className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Vence em {days} dias
        </Badge>
      );
    } else if (days <= 60) {
      return (
        <Badge className="flex items-center gap-1 bg-orange-500 hover:bg-orange-600">
          <Clock className="h-3 w-3" />
          Vence em {days} dias
        </Badge>
      );
    } else if (days <= 90) {
      return (
        <Badge className="flex items-center gap-1 bg-yellow-500 hover:bg-yellow-600">
          <Clock className="h-3 w-3" />
          Vence em {days} dias
        </Badge>
      );
    }
    return null;
  };

  // Estatísticas
  const stats = {
    expired: contractsWithDays.filter((c) => c.daysUntilExpiry < 0).length,
    within30: contractsWithDays.filter((c) => c.daysUntilExpiry >= 0 && c.daysUntilExpiry <= 30).length,
    within60: contractsWithDays.filter((c) => c.daysUntilExpiry > 30 && c.daysUntilExpiry <= 60).length,
    within90: contractsWithDays.filter((c) => c.daysUntilExpiry > 60 && c.daysUntilExpiry <= 90).length,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <Button variant="ghost" onClick={() => setLocation("/contracts")} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar para Contratos
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Alertas de Vencimento</h1>
              <p className="text-muted-foreground">
                Contratos próximos ao vencimento e vencidos
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => exportExcelMutation.mutate()}
                disabled={exportExcelMutation.isPending}
                variant="outline"
              >
                <Download className="h-4 w-4 mr-2" />
                {exportExcelMutation.isPending ? "Exportando..." : "Exportar Excel"}
              </Button>
              <Button
                onClick={() => checkExpirationsMutation.mutate()}
                disabled={checkExpirationsMutation.isPending}
                variant="outline"
              >
                <Bell className="h-4 w-4 mr-2" />
                {checkExpirationsMutation.isPending ? "Verificando..." : "Verificar e Notificar"}
              </Button>
            </div>
          </div>
        </div>

        {/* Cards de Estatísticas */}
        <div className="grid gap-6 md:grid-cols-4 mb-8">
          <Card className="border-destructive">
            <CardHeader className="pb-3">
              <CardDescription>Vencidos</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-destructive">{stats.expired}</div>
            </CardContent>
          </Card>

          <Card className="border-destructive/50">
            <CardHeader className="pb-3">
              <CardDescription>Vencem em 30 dias</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-destructive">{stats.within30}</div>
            </CardContent>
          </Card>

          <Card className="border-orange-500">
            <CardHeader className="pb-3">
              <CardDescription>Vencem em 60 dias</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-orange-500">{stats.within60}</div>
            </CardContent>
          </Card>

          <Card className="border-yellow-500">
            <CardHeader className="pb-3">
              <CardDescription>Vencem em 90 dias</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-yellow-500">{stats.within90}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <div className="mb-6">
          <Select value={filter} onValueChange={(value: any) => setFilter(value)}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Alertas</SelectItem>
              <SelectItem value="expired">Vencidos</SelectItem>
              <SelectItem value="30">Vencem em 30 dias</SelectItem>
              <SelectItem value="60">Vencem em 60 dias</SelectItem>
              <SelectItem value="90">Vencem em 90 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Lista de Contratos */}
        {sortedContracts.length > 0 ? (
          <div className="space-y-4">
            {sortedContracts.map((contract) => (
              <Card
                key={contract.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors"
                onClick={() => setLocation(`/contracts/${contract.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <CardTitle className="text-lg">
                          Contrato {contract.number}/{contract.year}
                        </CardTitle>
                        {getAlertBadge(contract.daysUntilExpiry)}
                      </div>
                      <CardDescription>{contract.object}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <span className="text-sm text-muted-foreground">Contratado</span>
                      <p className="font-medium">{contract.contractorName}</p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Valor Atual</span>
                      <p className="font-medium">
                        {new Intl.NumberFormat("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        }).format(contract.currentValue)}
                      </p>
                    </div>
                    <div>
                      <span className="text-sm text-muted-foreground">Data de Término</span>
                      <p className="font-medium flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        {format(new Date(contract.endDate), "dd/MM/yyyy", { locale: ptBR })}
                      </p>
                    </div>
                  </div>
                  {contract.fiscalUserName && (
                    <div className="mt-4 pt-4 border-t">
                      <span className="text-sm text-muted-foreground">Fiscal do Contrato</span>
                      <p className="font-medium">{contract.fiscalUserName}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhum alerta encontrado</h3>
              <p className="text-muted-foreground">
                {filter === "all"
                  ? "Não há contratos próximos ao vencimento"
                  : "Nenhum contrato corresponde ao filtro selecionado"}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

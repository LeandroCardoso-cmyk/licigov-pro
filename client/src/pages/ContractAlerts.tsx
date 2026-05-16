import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, FileText, Bell, Download } from "lucide-react";
import { toast } from "sonner";
import { differenceInDays } from "date-fns";
import { ContractAlertStats } from "@/components/contract-alerts/ContractAlertStats";
import { ContractAlertCard } from "@/components/contract-alerts/ContractAlertCard";

export default function ContractAlerts() {
  const [, setLocation] = useLocation();
  const [filter, setFilter] = useState<"all" | "expired" | "30" | "60" | "90">("all");

  const exportExcelMutation = trpc.contracts.reports.exportAlertsExcel.useMutation({
    onSuccess: (data) => {
      const byteCharacters = atob(data.data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const blob = new Blob([new Uint8Array(byteNumbers)], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), { href: url, download: data.filename }).click();
      window.URL.revokeObjectURL(url);
      toast.success("Relatório exportado com sucesso!");
    },
    onError: (error) => toast.error("Erro ao exportar relatório", { description: error.message }),
  });

  const checkExpirationsMutation = trpc.contracts.notifications.checkExpirations.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("Verificação concluída!", { description: `${data.notificationsSent} notificações enviadas` });
      } else {
        toast.error("Erro ao verificar vencimentos", { description: data.message });
      }
    },
    onError: (error) => toast.error("Erro ao verificar vencimentos", { description: error.message }),
  });

  const { data: contracts, isLoading } = trpc.contracts.list.useQuery({ status: "active" });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Carregando alertas...</p>
      </div>
    );
  }

  const contractsWithDays = (contracts || []).map((c) => ({
    ...c,
    daysUntilExpiry: differenceInDays(new Date(c.endDate), new Date()),
  }));

  const filteredContracts = contractsWithDays.filter((c) => {
    if (filter === "expired") return c.daysUntilExpiry < 0;
    if (filter === "30") return c.daysUntilExpiry >= 0 && c.daysUntilExpiry <= 30;
    if (filter === "60") return c.daysUntilExpiry > 30 && c.daysUntilExpiry <= 60;
    if (filter === "90") return c.daysUntilExpiry > 60 && c.daysUntilExpiry <= 90;
    return true;
  });

  const sortedContracts = filteredContracts.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

  const stats = {
    expired: contractsWithDays.filter((c) => c.daysUntilExpiry < 0).length,
    within30: contractsWithDays.filter((c) => c.daysUntilExpiry >= 0 && c.daysUntilExpiry <= 30).length,
    within60: contractsWithDays.filter((c) => c.daysUntilExpiry > 30 && c.daysUntilExpiry <= 60).length,
    within90: contractsWithDays.filter((c) => c.daysUntilExpiry > 60 && c.daysUntilExpiry <= 90).length,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-6 py-8">
        <div className="mb-8">
          <Button variant="ghost" onClick={() => setLocation("/contracts")} className="mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar para Contratos
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Alertas de Vencimento</h1>
              <p className="text-muted-foreground">Contratos próximos ao vencimento e vencidos</p>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => exportExcelMutation.mutate()} disabled={exportExcelMutation.isPending} variant="outline">
                <Download className="h-4 w-4 mr-2" />
                {exportExcelMutation.isPending ? "Exportando..." : "Exportar Excel"}
              </Button>
              <Button onClick={() => checkExpirationsMutation.mutate()} disabled={checkExpirationsMutation.isPending} variant="outline">
                <Bell className="h-4 w-4 mr-2" />
                {checkExpirationsMutation.isPending ? "Verificando..." : "Verificar e Notificar"}
              </Button>
            </div>
          </div>
        </div>

        <ContractAlertStats
          expired={stats.expired}
          within30={stats.within30}
          within60={stats.within60}
          within90={stats.within90}
        />

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

        {sortedContracts.length > 0 ? (
          <div className="space-y-4">
            {sortedContracts.map((contract) => (
              <ContractAlertCard
                key={contract.id}
                contract={contract}
                onClick={() => setLocation(`/contracts/${contract.id}`)}
              />
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

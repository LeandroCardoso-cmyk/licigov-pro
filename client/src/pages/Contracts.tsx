import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, FileText, AlertTriangle, Clock, DollarSign, Search, Filter } from "lucide-react";
import { BackToDashboard } from "@/components/BackToDashboard";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Página de Dashboard de Contratos
 * Lista contratos com filtros, estatísticas e alertas de vencimento
 */
export default function Contracts() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  if (!user) return null;
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [yearFilter, setYearFilter] = useState<number | undefined>(undefined);

  // Buscar estatísticas
  const { data: overview } = trpc.contracts.analytics.getOverview.useQuery();

  // Buscar contratos com filtros
  const { data: contracts, isLoading } = trpc.contracts.list.useQuery({
    type: typeFilter !== "all" ? typeFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    year: yearFilter,
  });

  // Filtrar por termo de busca (client-side)
  const filteredContracts = contracts?.filter(contract =>
    contract.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contract.object.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contract.contractorName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Função para obter badge de status
  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline", label: string }> = {
      draft: { variant: "secondary", label: "Rascunho" },
      active: { variant: "default", label: "Ativo" },
      suspended: { variant: "outline", label: "Suspenso" },
      terminated: { variant: "destructive", label: "Rescindido" },
      expired: { variant: "destructive", label: "Vencido" },
      completed: { variant: "secondary", label: "Concluído" },
    };
    const config = variants[status] || { variant: "outline" as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  // Função para obter badge de tipo
  const getTypeBadge = (type: string) => {
    const labels: Record<string, string> = {
      fornecimento: "Fornecimento",
      servico: "Serviço",
      obra: "Obra",
      concessao: "Concessão",
      outro: "Outro",
    };
    return <Badge variant="outline">{labels[type] || type}</Badge>;
  };

  // Calcular dias até vencimento
  const getDaysUntilExpiry = (endDate: Date) => {
    const now = new Date();
    const end = new Date(endDate);
    const diffTime = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  // Obter cor do alerta de vencimento
  const getExpiryColor = (endDate: Date, status: string) => {
    if (status !== "active") return "";
    const days = getDaysUntilExpiry(endDate);
    if (days < 0) return "text-red-600";
    if (days <= 30) return "text-red-500";
    if (days <= 60) return "text-orange-500";
    if (days <= 90) return "text-yellow-600";
    return "";
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <BackToDashboard variant="ghost" />
              <div>
                <h1 className="text-3xl font-bold">Contratos</h1>
                <p className="text-muted-foreground mt-1">
                  Gerencie contratos, aditivos e prazos de vigência
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setLocation("/contracts/alerts")} variant="outline">
                <AlertTriangle className="h-4 w-4 mr-2" />
                Alertas
                {overview && (overview.expiredCount + overview.expiring30Days) > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {overview.expiredCount + overview.expiring30Days}
                  </Badge>
                )}
              </Button>
              <Button onClick={() => setLocation("/contracts/new")}>
                <Plus className="h-4 w-4 mr-2" />
                Novo Contrato
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container py-8">
        {/* Cards de Estatísticas */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Contratos Ativos</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{overview?.byStatus.active || 0}</div>
              <p className="text-xs text-muted-foreground">
                {overview?.total || 0} total
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Vencidos</CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{overview?.byStatus.expired || 0}</div>
              <p className="text-xs text-muted-foreground">
                Requerem atenção
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">A Vencer (30 dias)</CardTitle>
              <Clock className="h-4 w-4 text-orange-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-orange-600">
                {contracts?.filter(c => {
                  const days = getDaysUntilExpiry(c.endDate);
                  return c.status === "active" && days > 0 && days <= 30;
                }).length || 0}
              </div>
              <p className="text-xs text-muted-foreground">
                Próximos do vencimento
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Valor Total</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {new Intl.NumberFormat('pt-BR', {
                  style: 'currency',
                  currency: 'BRL',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                }).format(overview?.totalValue || 0)}
              </div>
              <p className="text-xs text-muted-foreground">
                Contratos ativos
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filtros */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid gap-4 md:grid-cols-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por número, objeto ou contratado..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os tipos</SelectItem>
                  <SelectItem value="fornecimento">Fornecimento</SelectItem>
                  <SelectItem value="servico">Serviço</SelectItem>
                  <SelectItem value="obra">Obra</SelectItem>
                  <SelectItem value="concessao">Concessão</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="suspended">Suspenso</SelectItem>
                  <SelectItem value="terminated">Rescindido</SelectItem>
                  <SelectItem value="expired">Vencido</SelectItem>
                  <SelectItem value="completed">Concluído</SelectItem>
                </SelectContent>
              </Select>

              <Select value={yearFilter?.toString() || "all"} onValueChange={(v) => setYearFilter(v === "all" ? undefined : parseInt(v))}>
                <SelectTrigger>
                  <SelectValue placeholder="Ano" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os anos</SelectItem>
                  {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(year => (
                    <SelectItem key={year} value={year.toString()}>{year}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Lista de Contratos */}
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Carregando contratos...</p>
          </div>
        ) : filteredContracts && filteredContracts.length > 0 ? (
          <div className="grid gap-4">
            {filteredContracts.map((contract) => {
              const daysUntilExpiry = getDaysUntilExpiry(contract.endDate);
              const expiryColor = getExpiryColor(contract.endDate, contract.status);

              return (
                <Card
                  key={contract.id}
                  className="hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setLocation(`/contracts/${contract.id}`)}
                >
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-lg font-semibold">
                            Contrato nº {contract.number}/{contract.year}
                          </h3>
                          {getStatusBadge(contract.status)}
                          {getTypeBadge(contract.type)}
                        </div>

                        <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                          {contract.object}
                        </p>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Contratado:</span>
                            <p className="font-medium">{contract.contractorName}</p>
                          </div>

                          <div>
                            <span className="text-muted-foreground">Valor Atual:</span>
                            <p className="font-medium">
                              {new Intl.NumberFormat('pt-BR', {
                                style: 'currency',
                                currency: 'BRL',
                              }).format(parseFloat(contract.currentValue))}
                            </p>
                          </div>

                          <div>
                            <span className="text-muted-foreground">Vigência:</span>
                            <p className="font-medium">
                              {new Date(contract.startDate).toLocaleDateString('pt-BR')} até{' '}
                              {new Date(contract.endDate).toLocaleDateString('pt-BR')}
                            </p>
                          </div>

                          <div>
                            <span className="text-muted-foreground">Vencimento:</span>
                            <p className={`font-medium ${expiryColor}`}>
                              {contract.status === "active" ? (
                                daysUntilExpiry < 0 ? (
                                  `Vencido há ${Math.abs(daysUntilExpiry)} dias`
                                ) : daysUntilExpiry === 0 ? (
                                  "Vence hoje"
                                ) : daysUntilExpiry <= 90 ? (
                                  `${daysUntilExpiry} dias`
                                ) : (
                                  formatDistanceToNow(new Date(contract.endDate), {
                                    addSuffix: true,
                                    locale: ptBR,
                                  })
                                )
                              ) : (
                                "-"
                              )}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Nenhum contrato encontrado</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm || typeFilter !== "all" || statusFilter !== "all" || yearFilter
                  ? "Tente ajustar os filtros de busca"
                  : "Comece criando seu primeiro contrato"}
              </p>
              <Button onClick={() => setLocation("/contracts/new")}>
                <Plus className="h-4 w-4 mr-2" />
                Novo Contrato
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { Plus, Search, FileText, TrendingUp, AlertCircle, CheckCircle, Clock, BarChart3 } from "lucide-react";
import { BackToDashboard } from "@/components/BackToDashboard";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";

/**
 * Dashboard de Contratações Diretas
 * Lista, filtra e exibe estatísticas de dispensas e inexigibilidades
 */
export default function DirectContracts() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "dispensa" | "inexigibilidade">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "approved" | "published">("all");
  const [yearFilter, setYearFilter] = useState<string>("all");

  // Query
  const { data: contracts, isLoading } = trpc.directContracts.list.useQuery();

  // Filtros
  const filteredContracts = contracts?.filter((contract) => {
    const matchesSearch =
      contract.object.toLowerCase().includes(searchTerm.toLowerCase()) ||
      contract.number.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === "all" || contract.type === typeFilter;
    const matchesStatus = statusFilter === "all" || contract.status === statusFilter;
    const matchesYear = yearFilter === "all" || contract.year.toString() === yearFilter;

    return matchesSearch && matchesType && matchesStatus && matchesYear;
  });

  // Estatísticas
  const stats = {
    total: contracts?.length || 0,
    dispensas: contracts?.filter((c) => c.type === "dispensa").length || 0,
    inexigibilidades: contracts?.filter((c) => c.type === "inexigibilidade").length || 0,
    totalValue:
      contracts?.reduce((sum, c) => sum + c.value, 0) || 0,
  };

  // Anos disponíveis
  const availableYears = Array.from(
    new Set(contracts?.map((c) => c.year.toString()) || [])
  ).sort((a, b) => parseInt(b) - parseInt(a));

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: any; label: string; icon: any }> = {
      draft: { variant: "secondary", label: "Rascunho", icon: Clock },
      approved: { variant: "default", label: "Aprovado", icon: CheckCircle },
      published: { variant: "outline", label: "Publicado", icon: FileText },
    };

    const config = variants[status] || variants.draft;
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {config.label}
      </Badge>
    );
  };

  const getTypeBadge = (type: string) => {
    return type === "dispensa" ? (
      <Badge variant="default" className="bg-blue-500">
        Dispensa
      </Badge>
    ) : (
      <Badge variant="default" className="bg-purple-500">
        Inexigibilidade
      </Badge>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Contratações Diretas
            </h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">
              Dispensas e Inexigibilidades de Licitação
            </p>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => setLocation("/direct-contracts/analytics")} size="lg" variant="outline">
              <BarChart3 className="w-5 h-5 mr-2" />
              Analytics
            </Button>
            <Button onClick={() => setLocation("/direct-contracts/new")} size="lg">
              <Plus className="w-5 h-5 mr-2" />
              Nova Contratação
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Total de Contratações
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-gray-900 dark:text-white">
                {stats.total}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Dispensas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-blue-600">
                {stats.dispensas}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Inexigibilidades
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-purple-600">
                {stats.inexigibilidades}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Valor Total
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                R$ {(stats.totalValue / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Filtros</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  placeholder="Buscar por objeto ou número..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              <Select value={typeFilter} onValueChange={(v: any) => setTypeFilter(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Tipos</SelectItem>
                  <SelectItem value="dispensa">Dispensa</SelectItem>
                  <SelectItem value="inexigibilidade">Inexigibilidade</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={(v: any) => setStatusFilter(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="draft">Rascunho</SelectItem>
                  <SelectItem value="approved">Aprovado</SelectItem>
                  <SelectItem value="published">Publicado</SelectItem>
                </SelectContent>
              </Select>

              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Ano" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Anos</SelectItem>
                  {availableYears.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Contracts List */}
        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Carregando...</p>
          </div>
        ) : filteredContracts && filteredContracts.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {filteredContracts.map((contract) => (
              <Card
                key={contract.id}
                className="hover:shadow-lg transition-shadow cursor-pointer"
                onClick={() => setLocation(`/direct-contracts/${contract.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        {getTypeBadge(contract.type)}
                        {getStatusBadge(contract.status)}
                        <span className="text-sm text-gray-600 dark:text-gray-400">
                          Nº {contract.number}/{contract.year}
                        </span>
                      </div>
                      <CardTitle className="text-xl mb-2">{contract.object}</CardTitle>
                      <CardDescription>
                        {contract.legalArticle?.article} {contract.legalArticle?.inciso || ""}
                      </CardDescription>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-green-600">
                        R$ {(contract.value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {formatDistanceToNow(new Date(contract.createdAt), {
                          addSuffix: true,
                          locale: ptBR,
                        })}
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-4">
                      {contract.supplierName && (
                        <span className="text-gray-600 dark:text-gray-400">
                          <strong>Fornecedor:</strong> {contract.supplierName}
                        </span>
                      )}
                      {contract.executionDeadline && (
                        <span className="text-gray-600 dark:text-gray-400">
                          <strong>Prazo:</strong> {contract.executionDeadline} dias
                        </span>
                      )}
                    </div>
                    <Button variant="ghost" size="sm">
                      Ver Detalhes →
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {searchTerm || typeFilter !== "all" || statusFilter !== "all" || yearFilter !== "all"
                  ? "Nenhuma contratação encontrada com os filtros aplicados"
                  : "Nenhuma contratação direta cadastrada"}
              </p>
              <Button onClick={() => setLocation("/direct-contracts/new")}>
                <Plus className="w-4 h-4 mr-2" />
                Criar Primeira Contratação
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

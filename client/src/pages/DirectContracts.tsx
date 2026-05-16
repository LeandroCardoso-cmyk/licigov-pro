import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { Plus, AlertCircle, BarChart3 } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BackToDashboard } from "@/components/BackToDashboard";
import { DirectContractStats } from "@/components/direct-contracts/DirectContractStats";
import { DirectContractFilters } from "@/components/direct-contracts/DirectContractFilters";
import { DirectContractCard } from "@/components/direct-contracts/DirectContractCard";

export default function DirectContracts() {
  const [, setLocation] = useLocation();
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");

  const { data: contracts, isLoading } = trpc.directContracts.list.useQuery();

  const filteredContracts = contracts?.filter((c) => {
    const matchesSearch =
      c.object.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.number.toLowerCase().includes(searchTerm.toLowerCase());
    return (
      matchesSearch &&
      (typeFilter === "all" || c.type === typeFilter) &&
      (statusFilter === "all" || c.status === statusFilter) &&
      (yearFilter === "all" || c.year.toString() === yearFilter)
    );
  });

  const stats = {
    total: contracts?.length ?? 0,
    dispensas: contracts?.filter((c) => c.type === "dispensa").length ?? 0,
    inexigibilidades: contracts?.filter((c) => c.type === "inexigibilidade").length ?? 0,
    totalValue: contracts?.reduce((sum, c) => sum + c.value, 0) ?? 0,
  };

  const availableYears = Array.from(new Set(contracts?.map((c) => c.year.toString()) ?? [])).sort((a, b) => parseInt(b) - parseInt(a));

  const hasFilters = searchTerm || typeFilter !== "all" || statusFilter !== "all" || yearFilter !== "all";

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Breadcrumbs items={[{ label: "Contratação Direta" }]} className="mb-2" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Contratações Diretas</h1>
            <p className="text-gray-600 dark:text-gray-400 mt-2">Dispensas e Inexigibilidades de Licitação</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => setLocation("/direct-contracts/analytics")} size="lg" variant="outline">
              <BarChart3 className="w-5 h-5 mr-2" />Analytics
            </Button>
            <Button onClick={() => setLocation("/direct-contracts/new")} size="lg">
              <Plus className="w-5 h-5 mr-2" />Nova Contratação
            </Button>
          </div>
        </div>

        <DirectContractStats
          total={stats.total}
          dispensas={stats.dispensas}
          inexigibilidades={stats.inexigibilidades}
          totalValue={stats.totalValue}
        />

        <DirectContractFilters
          searchTerm={searchTerm}
          typeFilter={typeFilter}
          statusFilter={statusFilter}
          yearFilter={yearFilter}
          availableYears={availableYears}
          onSearchChange={setSearchTerm}
          onTypeChange={setTypeFilter}
          onStatusChange={setStatusFilter}
          onYearChange={setYearFilter}
        />

        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-gray-600 dark:text-gray-400">Carregando...</p>
          </div>
        ) : filteredContracts && filteredContracts.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {filteredContracts.map((contract) => (
              <DirectContractCard
                key={contract.id}
                contract={contract}
                onClick={() => setLocation(`/direct-contracts/${contract.id}`)}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400 mb-4">
                {hasFilters ? "Nenhuma contratação encontrada com os filtros aplicados" : "Nenhuma contratação direta cadastrada"}
              </p>
              <Button onClick={() => setLocation("/direct-contracts/new")}>
                <Plus className="w-4 h-4 mr-2" />Criar Primeira Contratação
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

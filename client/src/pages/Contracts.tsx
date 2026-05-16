import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, AlertTriangle } from "lucide-react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { BackToDashboard } from "@/components/BackToDashboard";
import { ContractStatsGrid } from "@/components/contracts/ContractStatsGrid";
import { ContractFilters } from "@/components/contracts/ContractFilters";
import { ContractCard, daysUntilExpiry } from "@/components/contracts/ContractCard";

export default function Contracts() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  if (!user) return null;

  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState<number | undefined>(undefined);

  const { data: overview } = trpc.contracts.analytics.getOverview.useQuery();
  const { data: contracts, isLoading } = trpc.contracts.list.useQuery({
    type: typeFilter !== "all" ? typeFilter : undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    year: yearFilter,
  });

  const filteredContracts = contracts?.filter((c) =>
    c.number.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.object.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.contractorName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const expiringIn30Count = contracts?.filter((c) => {
    const days = daysUntilExpiry(c.endDate);
    return c.status === "active" && days > 0 && days <= 30;
  }).length ?? 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <BackToDashboard variant="ghost" />
              <div>
                <Breadcrumbs items={[{ label: "Gestão de Contratos" }]} className="mb-2" />
                <h1 className="text-3xl font-bold">Contratos</h1>
                <p className="text-muted-foreground mt-1">Gerencie contratos, aditivos e prazos de vigência</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={() => setLocation("/contracts/alerts")} variant="outline">
                <AlertTriangle className="h-4 w-4 mr-2" />
                Alertas
                {overview && (overview.expired + overview.expiringSoon) > 0 && (
                  <Badge variant="destructive" className="ml-2">{overview.expired + overview.expiringSoon}</Badge>
                )}
              </Button>
              <Button onClick={() => setLocation("/contracts/new")}>
                <Plus className="h-4 w-4 mr-2" />Novo Contrato
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container py-8">
        <ContractStatsGrid overview={overview} expiringIn30Count={expiringIn30Count} />

        <ContractFilters
          searchTerm={searchTerm}
          typeFilter={typeFilter}
          statusFilter={statusFilter}
          yearFilter={yearFilter}
          onSearchChange={setSearchTerm}
          onTypeChange={setTypeFilter}
          onStatusChange={setStatusFilter}
          onYearChange={setYearFilter}
        />

        {isLoading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Carregando contratos...</p>
          </div>
        ) : filteredContracts && filteredContracts.length > 0 ? (
          <div className="grid gap-4">
            {filteredContracts.map((contract) => (
              <ContractCard
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
              <h3 className="text-lg font-semibold mb-2">Nenhum contrato encontrado</h3>
              <p className="text-muted-foreground mb-4">
                {searchTerm || typeFilter !== "all" || statusFilter !== "all" || yearFilter
                  ? "Tente ajustar os filtros de busca"
                  : "Comece criando seu primeiro contrato"}
              </p>
              <Button onClick={() => setLocation("/contracts/new")}>
                <Plus className="h-4 w-4 mr-2" />Novo Contrato
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

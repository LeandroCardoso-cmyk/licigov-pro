import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import { AlertCircle } from "lucide-react";
import { PresentialPackageModal } from "@/components/PresentialPackageModal";
import { ChecklistTab } from "@/components/ChecklistTab";
import { AuditTimeline } from "@/components/AuditTimeline";
import { DirectContractHeader } from "@/components/direct-contract-details/DirectContractHeader";
import { OverviewTab } from "@/components/direct-contract-details/OverviewTab";
import { DocumentsTab } from "@/components/direct-contract-details/DocumentsTab";
import { QuotationsTab } from "@/components/direct-contract-details/QuotationsTab";

export default function DirectContractDetails() {
  const [, params] = useRoute("/direct-contracts/:id");
  const [, setLocation] = useLocation();
  const contractId = params?.id ? parseInt(params.id) : 0;

  const [showPresentialPackage, setShowPresentialPackage] = useState(false);

  const { data: contract, isLoading } = trpc.directContracts.getById.useQuery({ id: contractId });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Carregando...</p>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <p className="text-gray-600 mb-4">Contratação não encontrada</p>
          <Button onClick={() => setLocation("/direct-contracts")}>Voltar para Lista</Button>
        </div>
      </div>
    );
  }

  const handleRequestOpinion = () =>
    setLocation(`/parecer-juridico/novo?contractId=${contract.id}&type=contratacao_direta`);

  const handleCreateContract = () => {
    const qs = new URLSearchParams({
      source: "direct",
      directContractId: contract.id.toString(),
      number: contract.number,
      object: contract.object,
      contractedName: contract.supplierName || "",
      contractedCnpj: contract.supplierCNPJ || "",
      value: (contract.value / 100).toString(),
    });
    setLocation(`/contracts/new?${qs.toString()}`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-gray-900 dark:to-gray-800 p-6">
      <div className="max-w-7xl mx-auto">
        <DirectContractHeader
          contract={contract}
          onBack={() => setLocation("/direct-contracts")}
          onRequestOpinion={handleRequestOpinion}
          onCreateContract={handleCreateContract}
          onOpenPresentialPackage={() => setShowPresentialPackage(true)}
        />

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList>
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="documents">Documentos</TabsTrigger>
            <TabsTrigger value="quotations">Cotações</TabsTrigger>
            {contract.platformId && (
              <TabsTrigger value="checklist">Checklist da Plataforma</TabsTrigger>
            )}
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <OverviewTab contract={contract} />
          </TabsContent>

          <TabsContent value="documents" className="space-y-6">
            <DocumentsTab contractId={contractId} contractType={contract.type} />
          </TabsContent>

          <TabsContent value="quotations" className="space-y-6">
            <QuotationsTab contractId={contractId} />
          </TabsContent>

          {contract.platformId && (
            <TabsContent value="checklist" className="space-y-6">
              <ChecklistTab contractId={contractId} platformId={contract.platformId} />
            </TabsContent>
          )}

          <TabsContent value="history" className="space-y-6">
            <AuditTimeline contractId={contractId} />
          </TabsContent>
        </Tabs>
      </div>

      <PresentialPackageModal
        open={showPresentialPackage}
        onOpenChange={setShowPresentialPackage}
        contractId={contractId}
      />
    </div>
  );
}

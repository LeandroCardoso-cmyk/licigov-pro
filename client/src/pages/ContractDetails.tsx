import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { NewAmendmentModal } from "@/components/NewAmendmentModal";
import { NewApostilleModal } from "@/components/NewApostilleModal";
import { RescissionModal } from "@/components/RescissionModal";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, AlertTriangle, Pencil } from "lucide-react";
import { toast } from "sonner";
import { triggerBlobDownload, base64ToBlob } from "@/services/download";
import { mutationToastCallbacks } from "@/hooks/useMutationToast";
import { ContractOverviewTab } from "@/components/contract-details/ContractOverviewTab";
import { ContractAmendmentsTab } from "@/components/contract-details/ContractAmendmentsTab";
import { ContractApostillesTab } from "@/components/contract-details/ContractApostillesTab";
import { ContractDocumentsTab } from "@/components/contract-details/ContractDocumentsTab";
import { ContractHistoryTab } from "@/components/contract-details/ContractHistoryTab";
import type { ContractDocument } from "@/components/contract-details/types";

export default function ContractDetails() {
  const { id } = useParams();
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("overview");
  const [amendmentModalOpen, setAmendmentModalOpen] = useState(false);
  const [apostilleModalOpen, setApostilleModalOpen] = useState(false);
  const [rescissionModalOpen, setRescissionModalOpen] = useState(false);

  const contractId = parseInt(id!);
  const utils = trpc.useUtils();

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: contract, isLoading } = trpc.contracts.getById.useQuery(
    { id: contractId },
    { enabled: !!id }
  );
  const { data: amendments } = trpc.contracts.amendments.list.useQuery(
    { contractId },
    { enabled: !!id }
  );
  const { data: apostilles } = trpc.contracts.apostilles.list.useQuery(
    { contractId },
    { enabled: !!id }
  );
  const { data: documents } = trpc.contracts.documents.list.useQuery(
    { contractId },
    { enabled: !!id }
  );
  const { data: auditLogs } = trpc.contracts.audit.getLogs.useQuery(
    { contractId },
    { enabled: !!id }
  );

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const exportAuditMutation = trpc.contracts.reports.exportAuditExcel.useMutation({
    onSuccess: (data) => {
      const blob = base64ToBlob(
        data.data,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      triggerBlobDownload(blob, data.filename);
      toast.success("Histórico exportado com sucesso!");
    },
    onError: (error) => toast.error("Erro ao exportar histórico", { description: error.message }),
  });

  const generateMinutaMutation = trpc.contracts.generation.generateMinuta.useMutation({
    onSuccess: (data) => {
      toast.success("Minuta gerada com sucesso!");
      downloadMarkdown(data.content, `Minuta_Contrato_${contract?.number}_${contract?.year}.md`);
      utils.contracts.documents.list.invalidate({ contractId });
      utils.contracts.audit.getLogs.invalidate({ contractId });
    },
    onError: (error) => {
      toast.error("Erro ao gerar minuta: " + error.message);
    },
  });

  const generateRescissionMutation = trpc.contracts.generation.generateRescission.useMutation({
    onSuccess: (data) => {
      toast.success("Termo de rescisão gerado com sucesso!");
      downloadMarkdown(
        data.content,
        `Termo_Rescisao_Contrato_${contract?.number}_${contract?.year}.md`
      );
      utils.contracts.documents.list.invalidate({ contractId });
      utils.contracts.audit.getLogs.invalidate({ contractId });
      utils.contracts.getById.invalidate({ id: contractId });
      setRescissionModalOpen(false);
    },
    onError: (error) => {
      toast.error("Erro ao gerar termo de rescisão: " + error.message);
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const downloadMarkdown = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    triggerBlobDownload(blob, filename);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; label: string }> = {
      draft: { variant: "secondary", label: "Rascunho" },
      active: { variant: "default", label: "Ativo" },
      suspended: { variant: "outline", label: "Suspenso" },
      terminated: { variant: "destructive", label: "Rescindido" },
      expired: { variant: "destructive", label: "Vencido" },
      completed: { variant: "secondary", label: "Concluído" },
    };
    const config = variants[status] ?? { variant: "outline" as const, label: status };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  // ── Handlers ──────────────────────────────────────────────────────────────────

  const handleGenerateRescission = (rescissionData: {
    type: "unilateral" | "bilateral" | "judicial";
    reason: string;
    effectiveDate: string;
    penaltyAmount?: string;
    notes?: string;
  }) => {
    if (!contract) return;
    generateRescissionMutation.mutate({
      contractId: contract.id,
      type: rescissionData.type,
      reason: rescissionData.reason,
      effectiveDate: new Date(rescissionData.effectiveDate),
      penaltyAmount: rescissionData.penaltyAmount
        ? parseFloat(rescissionData.penaltyAmount)
        : undefined,
      notes: rescissionData.notes || undefined,
    });
  };

  // ── Loading / not-found guards ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Carregando contrato...</p>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-2xl font-bold mb-2">Contrato não encontrado</h2>
          <Button onClick={() => setLocation("/contracts")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar para Contratos
          </Button>
        </div>
      </div>
    );
  }

  const daysUntilExpiry = Math.ceil(
    (new Date(contract.endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card">
        <div className="container py-6">
          <div className="flex items-center gap-4 mb-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/contracts")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="flex-1">
              <Breadcrumbs
                items={[
                  { label: "Gestão de Contratos", href: "/contracts" },
                  { label: "Detalhes do Contrato" },
                ]}
                className="mb-2"
              />
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-3xl font-bold">
                  Contrato nº {contract.number}/{contract.year}
                </h1>
                {getStatusBadge(contract.status)}
              </div>
              <p className="text-muted-foreground">{contract.object}</p>
            </div>
            <Button variant="outline">
              <Pencil className="h-4 w-4 mr-2" />
              Editar
            </Button>
          </div>

          {/* Alerta de Vencimento */}
          {contract.status === "active" && daysUntilExpiry <= 90 && (
            <div
              className={`p-4 rounded-lg border ${
                daysUntilExpiry <= 30
                  ? "bg-red-50 border-red-200"
                  : daysUntilExpiry <= 60
                  ? "bg-orange-50 border-orange-200"
                  : "bg-yellow-50 border-yellow-200"
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle
                  className={`h-5 w-5 ${
                    daysUntilExpiry <= 30
                      ? "text-red-500"
                      : daysUntilExpiry <= 60
                      ? "text-orange-500"
                      : "text-yellow-600"
                  }`}
                />
                <p
                  className={`font-medium ${
                    daysUntilExpiry <= 30
                      ? "text-red-700"
                      : daysUntilExpiry <= 60
                      ? "text-orange-700"
                      : "text-yellow-800"
                  }`}
                >
                  {daysUntilExpiry < 0
                    ? `Contrato vencido há ${Math.abs(daysUntilExpiry)} dias`
                    : daysUntilExpiry === 0
                    ? "Contrato vence hoje!"
                    : `Contrato vence em ${daysUntilExpiry} dias`}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="container py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">Visão Geral</TabsTrigger>
            <TabsTrigger value="amendments">
              Aditivos{amendments && amendments.length > 0 && ` (${amendments.length})`}
            </TabsTrigger>
            <TabsTrigger value="apostilles">
              Apostilamentos{apostilles && apostilles.length > 0 && ` (${apostilles.length})`}
            </TabsTrigger>
            <TabsTrigger value="documents">
              Documentos{documents && documents.length > 0 && ` (${documents.length})`}
            </TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <ContractOverviewTab contract={contract} />
          </TabsContent>

          <TabsContent value="amendments" className="space-y-6">
            <ContractAmendmentsTab
              amendments={amendments}
              onNewAmendment={() => setAmendmentModalOpen(true)}
            />
          </TabsContent>

          <TabsContent value="apostilles" className="space-y-6">
            <ContractApostillesTab
              apostilles={apostilles}
              onNewApostille={() => setApostilleModalOpen(true)}
            />
          </TabsContent>

          <TabsContent value="documents" className="space-y-6">
            <ContractDocumentsTab
              documents={documents}
              generateMinutaIsPending={generateMinutaMutation.isPending}
              onGenerateMinuta={() => contract && generateMinutaMutation.mutate({ contractId: contract.id })}
              onOpenRescission={() => setRescissionModalOpen(true)}
              onDownloadDocument={(doc: ContractDocument) => {
                downloadMarkdown(doc.content, `${doc.title}.md`);
                toast.success("Download iniciado!");
              }}
            />
          </TabsContent>

          <TabsContent value="history" className="space-y-6">
            <ContractHistoryTab
              auditLogs={auditLogs}
              exportIsPending={exportAuditMutation.isPending}
              onExport={() => exportAuditMutation.mutate({ contractId: contract.id })}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Modais */}
      <NewAmendmentModal
        open={amendmentModalOpen}
        onClose={() => setAmendmentModalOpen(false)}
        contractId={contract.id}
        currentEndDate={
          contract.endDate instanceof Date
            ? contract.endDate.toISOString()
            : String(contract.endDate)
        }
        currentValue={String(contract.value)}
      />
      <NewApostilleModal
        open={apostilleModalOpen}
        onClose={() => setApostilleModalOpen(false)}
        contractId={contract.id}
        currentValue={String(contract.value)}
      />
      <RescissionModal
        open={rescissionModalOpen}
        onClose={() => setRescissionModalOpen(false)}
        onConfirm={handleGenerateRescission}
        isLoading={generateRescissionMutation.isPending}
      />
    </div>
  );
}

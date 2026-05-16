import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  RegisterEmpenhoDialog,
  type EmpenhoData,
} from "@/components/commercial/RegisterEmpenhoDialog";
import { CommercialProposalsTable } from "@/components/commercial/CommercialProposalsTable";

const EMPTY_EMPENHO: EmpenhoData = { numeroEmpenho: "", dataEmpenho: "", valorEmpenho: "", observacoes: "" };

export default function CommercialManagement() {
  const [selectedProposal, setSelectedProposal] = useState<any>(null);
  const [showEmpenhoDialog, setShowEmpenhoDialog] = useState(false);
  const [empenhoData, setEmpenhoData] = useState<EmpenhoData>(EMPTY_EMPENHO);

  const { data: proposals, isLoading, refetch } = trpc.commercial.list.useQuery();
  const registerEmpenhoMutation = trpc.commercial.registerEmpenho.useMutation();
  const activateSubscriptionMutation = trpc.commercial.activateSubscription.useMutation();

  const handleRegisterEmpenho = async () => {
    if (!selectedProposal) return;
    try {
      await registerEmpenhoMutation.mutateAsync({
        proposalId: selectedProposal.id,
        numeroEmpenho: empenhoData.numeroEmpenho,
        dataEmpenho: new Date(empenhoData.dataEmpenho),
        valorEmpenho: parseFloat(empenhoData.valorEmpenho),
      });
      toast.success("Empenho registrado com sucesso");
      refetch();
      setShowEmpenhoDialog(false);
      setEmpenhoData(EMPTY_EMPENHO);
    } catch (error: any) {
      toast.error(error.message || "Erro ao registrar empenho");
    }
  };

  const handleActivateSubscription = async (proposalId: number) => {
    try {
      await activateSubscriptionMutation.mutateAsync({ proposalId, userId: proposalId });
      toast.success("Assinatura ativada com sucesso!");
      refetch();
    } catch (error: any) {
      toast.error(error.message || "Erro ao ativar assinatura");
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin" /></div>;
  }

  return (
    <div className="container mx-auto py-8 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Gestão Comercial</CardTitle>
          <CardDescription>Gerencie clientes, contratos e assinaturas do LiciGov Pro</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <CommercialProposalsTable
            proposals={proposals ?? []}
            activateIsPending={activateSubscriptionMutation.isPending}
            onRegisterEmpenho={(proposal) => { setSelectedProposal(proposal); setShowEmpenhoDialog(true); }}
            onActivate={handleActivateSubscription}
          />
        </CardContent>
      </Card>

      <RegisterEmpenhoDialog
        open={showEmpenhoDialog}
        onOpenChange={setShowEmpenhoDialog}
        empenhoData={empenhoData}
        onEmpenhoDataChange={setEmpenhoData}
        onSubmit={handleRegisterEmpenho}
        isPending={registerEmpenhoMutation.isPending}
      />
    </div>
  );
}

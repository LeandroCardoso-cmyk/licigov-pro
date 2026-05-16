import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { toast } from "sonner";
import { useState } from "react";
import { SetSignaturePasswordDialog } from "@/components/SetSignaturePasswordDialog";
import { SignatureHistory } from "@/components/SignatureHistory";
import { LegalOpinionHeader } from "@/components/legal-opinion-details/LegalOpinionHeader";
import { LegalOpinionContent } from "@/components/legal-opinion-details/LegalOpinionContent";
import { LegalOpinionSidebar } from "@/components/legal-opinion-details/LegalOpinionSidebar";
import { SignOpinionDialog } from "@/components/legal-opinion-details/SignOpinionDialog";

export default function LegalOpinionDetails() {
  const { user, loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const [, params] = useRoute("/parecer-juridico/:id");
  const opinionId = params?.id ? parseInt(params.id) : null;

  const [showSignDialog, setShowSignDialog] = useState(false);
  const [showSetPasswordDialog, setShowSetPasswordDialog] = useState(false);

  const { data: opinion, isLoading, refetch } = trpc.legalOpinions.getById.useQuery(
    { id: opinionId! },
    { enabled: !!opinionId }
  );
  const { data: hasPassword } = trpc.legalOpinions.hasSignaturePassword.useQuery(undefined, {
    enabled: !!user,
  });
  const { data: signatureHistoryData } = trpc.legalOpinions.getSignatureHistory.useQuery(
    { id: opinionId! },
    { enabled: !!opinionId }
  );
  trpc.legalOpinions.verifySignature.useQuery(
    { id: opinionId! },
    { enabled: !!opinionId && !!(opinion as any)?.signatureId }
  );

  const generateMutation = trpc.legalOpinions.generateOpinion.useMutation({
    onSuccess: () => { toast.success("Parecer gerado com sucesso!"); refetch(); },
    onError: (e) => toast.error(e.message || "Erro ao gerar parecer"),
  });

  const updateMutation = trpc.legalOpinions.update.useMutation({
    onSuccess: () => { toast.success("Status atualizado!"); refetch(); },
    onError: (e) => toast.error(e.message || "Erro ao atualizar"),
  });

  const exportPDFMutation = trpc.legalOpinions.exportPDF.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([Uint8Array.from(atob(data.buffer), (c) => c.charCodeAt(0))], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = data.filename; a.click();
      URL.revokeObjectURL(url);
      toast.success("PDF baixado com sucesso!");
    },
    onError: (e) => toast.error(e.message || "Erro ao exportar PDF"),
  });

  const exportDOCXMutation = trpc.legalOpinions.exportDOCX.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([Uint8Array.from(atob(data.buffer), (c) => c.charCodeAt(0))], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = data.filename; a.click();
      URL.revokeObjectURL(url);
      toast.success("DOCX baixado com sucesso!");
    },
    onError: (e) => toast.error(e.message || "Erro ao exportar DOCX"),
  });

  const signMutation = trpc.legalOpinions.sign.useMutation({
    onSuccess: (data) => {
      toast.success(`✅ Parecer assinado digitalmente! (${data.signaturesCount}/${data.requiredSignatures})`);
      setShowSignDialog(false);
      refetch();
    },
    onError: (e) => toast.error(e.message || "Erro ao assinar parecer"),
  });

  if (authLoading || isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!opinion) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen">
        <p className="text-lg text-muted-foreground mb-4">Parecer não encontrado</p>
        <Button onClick={() => navigate("/parecer-juridico")}>Voltar para Pareceres</Button>
      </div>
    );
  }

  const handleSignClick = () => {
    if (!hasPassword) { setShowSetPasswordDialog(true); return; }
    setShowSignDialog(true);
  };

  return (
    <div className="min-h-screen bg-background">
      <LegalOpinionHeader
        opinion={opinion}
        signatureHistoryData={signatureHistoryData}
        isGenerating={generateMutation.isPending}
        exportPDFPending={exportPDFMutation.isPending}
        exportDOCXPending={exportDOCXMutation.isPending}
        updatePending={updateMutation.isPending}
        signPending={signMutation.isPending}
        onGenerate={() => opinionId && generateMutation.mutateAsync({ id: opinionId })}
        onApprove={() => opinionId && updateMutation.mutateAsync({ id: opinionId, status: "approved", reviewedBy: user?.id })}
        onSignClick={handleSignClick}
        onExportPDF={() => exportPDFMutation.mutate({ id: opinion.id })}
        onExportDOCX={() => exportDOCXMutation.mutate({ id: opinion.id })}
        onSaveAsTemplate={() => (updateMutation as any).mutate({ id: opinion.id, isTemplate: true })}
      />

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <LegalOpinionContent
            opinion={opinion}
            isGenerating={generateMutation.isPending}
            onGenerate={() => opinionId && generateMutation.mutateAsync({ id: opinionId })}
          />
          <LegalOpinionSidebar opinion={opinion} />

          {signatureHistoryData && signatureHistoryData.length > 0 && (
            <SignatureHistory
              signatures={signatureHistoryData}
              requiredSignatures={opinion.requiredSignatures}
            />
          )}
        </div>
      </div>

      <SignOpinionDialog
        open={showSignDialog}
        onOpenChange={setShowSignDialog}
        opinionId={opinion.id}
        isPending={signMutation.isPending}
        onSign={(args) => signMutation.mutate(args)}
      />

      <SetSignaturePasswordDialog
        open={showSetPasswordDialog}
        onOpenChange={setShowSetPasswordDialog}
        onSuccess={() => { setShowSetPasswordDialog(false); setShowSignDialog(true); }}
      />
    </div>
  );
}

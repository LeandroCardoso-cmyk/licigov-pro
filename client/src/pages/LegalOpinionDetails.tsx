import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { toast } from "sonner";
import { SignatureHistory } from "@/components/SignatureHistory";
import { LegalOpinionHeader } from "@/components/legal-opinion-details/LegalOpinionHeader";
import { LegalOpinionContent } from "@/components/legal-opinion-details/LegalOpinionContent";
import { LegalOpinionSidebar } from "@/components/legal-opinion-details/LegalOpinionSidebar";

/**
 * R2 / PR-03 (LEG-012; SEM-016/017) — detalhe do parecer LEGADO como LEITURA HISTÓRICA.
 * Gerar com IA, aprovar, salvar como template, configurar senha e assinar foram desligados no servidor
 * (LEGACY_ENDPOINT_DISABLED); esta tela não oferece mais essas ações. Leitura, verificação de assinatura e
 * exportação do conteúdo histórico continuam disponíveis. Novos pareceres: workspace canônico (/parecer).
 */
export default function LegalOpinionDetails() {
  const { loading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const params = useParams();
  const opinionId = params?.id ? parseInt(params.id) : null;

  const { data: opinion, isLoading } = trpc.legalOpinions.getById.useQuery(
    { id: opinionId! },
    { enabled: !!opinionId }
  );
  const { data: signatureHistoryData } = trpc.legalOpinions.getSignatureHistory.useQuery(
    { id: opinionId! },
    { enabled: !!opinionId }
  );
  trpc.legalOpinions.verifySignature.useQuery(
    { id: opinionId! },
    { enabled: !!opinionId && !!(opinion as { signatureId?: unknown } | undefined)?.signatureId }
  );

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

  // PR B.1 — Imprimir: reusa o PDF institucional (façade) e abre INLINE numa nova
  // aba (blob), sem chrome da aplicação → o usuário imprime pelo visualizador.
  const printPDFMutation = trpc.legalOpinions.exportPDF.useMutation({
    onSuccess: (data) => {
      const blob = new Blob([Uint8Array.from(atob(data.buffer), (c) => c.charCodeAt(0))], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    onError: (e) => toast.error(e.message || "Erro ao imprimir"),
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
        <Button onClick={() => navigate("/parecer")}>Voltar para Pareceres</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <LegalOpinionHeader
        opinion={opinion}
        signatureHistoryData={signatureHistoryData}
        exportPDFPending={exportPDFMutation.isPending}
        exportDOCXPending={exportDOCXMutation.isPending}
        onExportPDF={() => exportPDFMutation.mutate({ id: opinion.id })}
        onExportDOCX={() => exportDOCXMutation.mutate({ id: opinion.id })}
        onPrint={() => printPDFMutation.mutate({ id: opinion.id })}
        printPending={printPDFMutation.isPending}
      />

      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <LegalOpinionContent opinion={opinion} />
          <LegalOpinionSidebar opinion={opinion} />

          {signatureHistoryData && signatureHistoryData.length > 0 && (
            <SignatureHistory
              signatures={signatureHistoryData}
              requiredSignatures={opinion.requiredSignatures}
            />
          )}
        </div>
      </div>

    </div>
  );
}

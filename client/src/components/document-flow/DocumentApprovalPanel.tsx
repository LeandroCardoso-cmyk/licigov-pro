import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock, Send, FileCheck } from "lucide-react";
import { toast } from "sonner";

type DocStatus = "draft" | "in_review" | "approved" | "rejected";

interface Props {
  documentId: number;
  documentStatus: DocStatus;
  onStatusChange: () => void;
}

const STATUS_CONFIG: Record<DocStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: React.ReactNode }> = {
  draft: { label: "Rascunho", variant: "secondary", icon: <FileCheck className="h-3 w-3" /> },
  in_review: { label: "Em revisão", variant: "outline", icon: <Clock className="h-3 w-3" /> },
  approved: { label: "Aprovado", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
  rejected: { label: "Rejeitado", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
};

export function DocumentApprovalPanel({ documentId, documentStatus, onStatusChange }: Props) {
  const utils = trpc.useUtils();

  const invalidate = () => {
    utils.documents.listByProcess.invalidate();
    utils.documents.getVersionHistory.invalidate({ documentId });
    onStatusChange();
  };

  const submitMutation = trpc.documents.submitForReview.useMutation({
    onSuccess: () => { toast.success("Documento enviado para revisão!"); invalidate(); },
    onError: (e) => toast.error("Erro ao enviar para revisão", { description: e.message }),
  });

  const approveMutation = trpc.documents.approveDocument.useMutation({
    onSuccess: () => { toast.success("Documento aprovado!"); invalidate(); },
    onError: (e) => toast.error("Erro ao aprovar documento", { description: e.message }),
  });

  const rejectMutation = trpc.documents.rejectDocument.useMutation({
    onSuccess: () => { toast.success("Documento rejeitado."); invalidate(); },
    onError: (e) => toast.error("Erro ao rejeitar documento", { description: e.message }),
  });

  const config = STATUS_CONFIG[documentStatus];
  const isPending = submitMutation.isPending || approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant={config.variant} className="gap-1">
        {config.icon}
        {config.label}
      </Badge>

      {documentStatus === "draft" && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => submitMutation.mutate({ documentId })}
          disabled={isPending}
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          Enviar para revisão
        </Button>
      )}

      {documentStatus === "in_review" && (
        <>
          <Button
            variant="outline"
            size="sm"
            className="border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
            onClick={() => approveMutation.mutate({ documentId })}
            disabled={isPending}
          >
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
            Aprovar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            onClick={() => rejectMutation.mutate({ documentId })}
            disabled={isPending}
          >
            <XCircle className="mr-1.5 h-3.5 w-3.5" />
            Rejeitar
          </Button>
        </>
      )}

      {documentStatus === "rejected" && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => submitMutation.mutate({ documentId })}
          disabled={isPending}
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          Reenviar para revisão
        </Button>
      )}
    </div>
  );
}

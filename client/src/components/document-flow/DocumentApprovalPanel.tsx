import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, XCircle, Clock, Send, FileCheck, Undo2, History, Archive } from "lucide-react";
import { toast } from "sonner";
import { useOrgRole } from "@/_core/hooks/useOrgRole";
import { useAuth } from "@/_core/hooks/useAuth";
import { newIdempotencyKey } from "@/lib/ingestion/sha256";

type DocStatus = "draft" | "in_review" | "approved" | "rejected" | "archived";

interface Props {
  documentId: number;
  documentVersion: number;
  documentStatus: DocStatus;
  authorUserId?: number | null;
  onStatusChange: () => void;
}

const STATUS_CONFIG: Record<DocStatus, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; icon: React.ReactNode }> = {
  draft: { label: "Rascunho", variant: "secondary", icon: <FileCheck className="h-3 w-3" /> },
  in_review: { label: "Em revisão", variant: "outline", icon: <Clock className="h-3 w-3" /> },
  approved: { label: "Aprovado", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
  rejected: { label: "Rejeitado", variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  archived: { label: "Arquivado", variant: "secondary", icon: <Archive className="h-3 w-3" /> },
};

const ACTION_LABELS: Record<string, string> = {
  submit_for_review: "Enviado para revisão",
  approve: "Aprovado",
  reject: "Rejeitado",
  request_changes: "Ajustes solicitados",
};

export function DocumentApprovalPanel({ documentId, documentVersion, documentStatus, authorUserId, onStatusChange }: Props) {
  const utils = trpc.useUtils();
  const { hasRole } = useOrgRole();
  const { user } = useAuth();

  // Idempotência estável por ação (double-submit / retry → um único efeito). Rotaciona no sucesso.
  const keys = useRef<Record<string, string>>({});
  const keyFor = (action: string) => (keys.current[action] ??= newIdempotencyKey());
  const rotate = (action: string) => { delete keys.current[action]; };

  const [reasonDialog, setReasonDialog] = useState<null | "reject" | "request_changes">(null);
  const [reason, setReason] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);

  const invalidate = () => {
    utils.documents.listByProcess.invalidate();
    utils.documents.getVersionHistory.invalidate({ documentId });
    utils.documentReview.getReviewDecisions.invalidate({ documentId });
    onStatusChange();
  };

  const decisions = trpc.documentReview.getReviewDecisions.useQuery(
    { documentId },
    { enabled: historyOpen },
  );

  const submitMutation = trpc.documentReview.submitForReview.useMutation({
    onSuccess: () => { toast.success("Documento enviado para revisão!"); rotate("submit_for_review"); invalidate(); },
    onError: (e) => toast.error("Erro ao enviar para revisão", { description: e.message }),
  });
  const approveMutation = trpc.documentReview.approve.useMutation({
    onSuccess: () => { toast.success(`Versão v${documentVersion} aprovada!`); rotate("approve"); invalidate(); },
    onError: (e) => toast.error("Erro ao aprovar", { description: e.message }),
  });
  const rejectMutation = trpc.documentReview.reject.useMutation({
    onSuccess: () => { toast.success("Documento rejeitado."); rotate("reject"); setReasonDialog(null); setReason(""); invalidate(); },
    onError: (e) => toast.error("Erro ao rejeitar", { description: e.message }),
  });
  const requestChangesMutation = trpc.documentReview.requestChanges.useMutation({
    onSuccess: () => { toast.success("Ajustes solicitados (devolvido ao autor)."); rotate("request_changes"); setReasonDialog(null); setReason(""); invalidate(); },
    onError: (e) => toast.error("Erro ao solicitar ajustes", { description: e.message }),
  });

  const isPending = submitMutation.isPending || approveMutation.isPending || rejectMutation.isPending || requestChangesMutation.isPending;
  const config = STATUS_CONFIG[documentStatus] ?? STATUS_CONFIG.draft;

  // RBAC (o backend é a autoridade; aqui apenas gateamos a UI).
  const canSubmit = hasRole("operator");
  const canReview = hasRole("manager");
  const isAuthor = authorUserId != null && user?.id != null && authorUserId === user.id;
  const canApprove = canReview && !isAuthor; // reviewer ≠ autor

  const submit = () => submitMutation.mutate({ documentId, idempotencyKey: keyFor("submit_for_review"), expectedVersion: documentVersion });
  const approve = () => approveMutation.mutate({ documentId, idempotencyKey: keyFor("approve"), expectedVersion: documentVersion });
  const confirmReason = () => {
    const r = reason.trim();
    if (!r) { toast.error("Justificativa obrigatória."); return; }
    if (reasonDialog === "reject") rejectMutation.mutate({ documentId, reason: r, idempotencyKey: keyFor("reject"), expectedVersion: documentVersion });
    else if (reasonDialog === "request_changes") requestChangesMutation.mutate({ documentId, reason: r, idempotencyKey: keyFor("request_changes"), expectedVersion: documentVersion });
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Badge variant={config.variant} className="gap-1">{config.icon}{config.label}</Badge>
      <span className="text-xs text-muted-foreground">v{documentVersion}</span>

      {documentStatus === "draft" && canSubmit && (
        <Button variant="outline" size="sm" onClick={submit} disabled={isPending}>
          <Send className="mr-1.5 h-3.5 w-3.5" />Enviar para revisão
        </Button>
      )}

      {documentStatus === "in_review" && canReview && (
        <>
          <Button
            variant="outline" size="sm"
            className="border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50"
            onClick={approve} disabled={isPending || !canApprove}
            title={!canApprove && isAuthor ? "Segregação de deveres: o autor não pode aprovar a própria versão" : undefined}
          >
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />Aprovar
          </Button>
          <Button
            variant="outline" size="sm"
            className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20"
            onClick={() => { setReason(""); setReasonDialog("request_changes"); }} disabled={isPending}
          >
            <Undo2 className="mr-1.5 h-3.5 w-3.5" />Solicitar ajustes
          </Button>
          <Button
            variant="outline" size="sm"
            className="border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
            onClick={() => { setReason(""); setReasonDialog("reject"); }} disabled={isPending}
          >
            <XCircle className="mr-1.5 h-3.5 w-3.5" />Rejeitar
          </Button>
        </>
      )}

      {documentStatus === "rejected" && canSubmit && (
        <Button variant="outline" size="sm" onClick={submit} disabled={isPending}>
          <Send className="mr-1.5 h-3.5 w-3.5" />Reenviar para revisão
        </Button>
      )}

      {/* Histórico imutável de decisões (reconstruído do backend). */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            <History className="mr-1.5 h-3.5 w-3.5" />Histórico
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Histórico de decisões</DialogTitle>
            <DialogDescription>Trilha imutável de revisão/aprovação deste documento.</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-80 pr-3">
            {decisions.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
            {decisions.data && decisions.data.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma decisão registrada ainda.</p>
            )}
            <ul className="space-y-3">
              {decisions.data?.map((d) => (
                <li key={d.id} className="rounded-md border border-border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{ACTION_LABELS[d.action] ?? d.action}</span>
                    <span className="text-xs text-muted-foreground">v{d.documentVersion}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {d.fromState} → {d.toState} · ator #{d.actorUserId}
                    {d.createdAt ? ` · ${new Date(d.createdAt as unknown as string).toLocaleString("pt-BR")}` : ""}
                  </div>
                  {d.justification && <p className="mt-1.5 whitespace-pre-wrap">{d.justification}</p>}
                </li>
              ))}
            </ul>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Justificativa obrigatória para rejeição / solicitação de ajustes. */}
      <Dialog open={reasonDialog !== null} onOpenChange={(o) => { if (!o) { setReasonDialog(null); setReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{reasonDialog === "reject" ? "Rejeitar documento" : "Solicitar ajustes"}</DialogTitle>
            <DialogDescription>
              {reasonDialog === "reject"
                ? "A justificativa é obrigatória e ficará registrada na trilha imutável."
                : "Descreva os ajustes necessários. O documento volta ao autor como rascunho."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="review-reason">Justificativa</Label>
            <Textarea
              id="review-reason" value={reason} onChange={(e) => setReason(e.target.value)}
              rows={4} placeholder="Motivo…" autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setReasonDialog(null); setReason(""); }} disabled={isPending}>Cancelar</Button>
            <Button
              variant={reasonDialog === "reject" ? "destructive" : "default"}
              onClick={confirmReason} disabled={isPending || !reason.trim()}
            >
              {reasonDialog === "reject" ? "Confirmar rejeição" : "Confirmar devolução"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

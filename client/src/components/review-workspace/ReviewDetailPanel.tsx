import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ConfidenceBadge, scoreToLevel } from "@/components/ui/ConfidenceBadge";
import { SemanticScoreBar } from "@/components/ui/SemanticScoreBar";
import { ReviewActions } from "./ReviewActions";
import { Loader2, Package, Tag, Hash, DollarSign } from "lucide-react";
import type { ReviewItemShape, ItemReviewState } from "./ReviewQueueItem";

interface ReviewDetailPanelProps {
  item: ReviewItemShape | null;
  isLoading: boolean;
  organizationId: number;
  processId?: number;
  actorUserId: number;
  onApprove: (id: string, orgId: number, processId: number, actorUserId: number) => void;
  onReject: (id: string, orgId: number, processId: number, actorUserId: number, reason: string) => void;
  onOverride: (
    id: string,
    orgId: number,
    processId: number,
    actorUserId: number,
    overrides: { quantity?: number; estimatedUnitPrice?: number; description?: string; canonicalUnit?: string },
    justification: string,
  ) => void;
  isApproving?: boolean;
  isRejecting?: boolean;
  isOverriding?: boolean;
}

const stateLabels: Record<ItemReviewState, string> = {
  pending_match:       "Aguardando Match",
  candidate_generated: "Candidatos Gerados",
  awaiting_review:     "Aguardando Revisão",
  approved:            "Aprovado",
  rejected:            "Rejeitado",
  overridden:          "Sobrescrito",
  manual_entry:        "Entrada Manual",
  finalized:           "Finalizado",
};

function FieldRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b last:border-b-0">
      <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
      <span className="text-sm">{value ?? <span className="text-muted-foreground italic">—</span>}</span>
    </div>
  );
}

export function ReviewDetailPanel({
  item,
  isLoading,
  organizationId,
  processId = 1,
  actorUserId,
  onApprove,
  onReject,
  onOverride,
  isApproving,
  isRejecting,
  isOverriding,
}: ReviewDetailPanelProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
        <Package className="h-12 w-12 opacity-30" />
        <p className="text-sm">Selecione um item na fila para ver os detalhes</p>
      </div>
    );
  }

  const level = scoreToLevel(item.confidenceScore);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <span className="text-xs text-muted-foreground">Item #{item.itemNumber}</span>
            <h2 className="text-base font-semibold mt-0.5 line-clamp-3">{item.description}</h2>
          </div>
          <Badge variant="outline" className="shrink-0 text-xs">
            {stateLabels[item.reviewState]}
          </Badge>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ConfidenceBadge level={level} score={item.confidenceScore} showScore />
        </div>
        <SemanticScoreBar score={item.confidenceScore} label="Confiança semântica" />
        <ReviewActions
          itemId={item.id}
          organizationId={organizationId}
          processId={processId}
          actorUserId={actorUserId}
          reviewState={item.reviewState}
          onApprove={onApprove}
          onReject={onReject}
          onOverride={onOverride}
          isApproving={isApproving}
          isRejecting={isRejecting}
          isOverriding={isOverriding}
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mt-3 shrink-0">
          <TabsTrigger value="details" className="text-xs">Detalhes</TabsTrigger>
          <TabsTrigger value="candidates" className="text-xs">Candidatos</TabsTrigger>
          <TabsTrigger value="history" className="text-xs">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="flex-1 overflow-y-auto p-4 space-y-1">
          <FieldRow label="Quantidade" value={item.quantity} />
          <FieldRow label="Unidade" value={item.unit} />
          <FieldRow label="Unidade Canônica" value={item.canonicalUnit} />
          <FieldRow
            label="Preço Unitário"
            value={item.estimatedUnitPrice != null ? `R$ ${item.estimatedUnitPrice.toFixed(2)}` : null}
          />
          <FieldRow
            label="Valor Total Est."
            value={item.estimatedTotalPrice != null ? `R$ ${item.estimatedTotalPrice.toFixed(2)}` : null}
          />
          <FieldRow label="Estado" value={stateLabels[item.reviewState]} />
        </TabsContent>

        <TabsContent value="candidates" className="flex-1 overflow-y-auto p-4">
          <p className="text-sm text-muted-foreground">
            Os candidatos semânticos são exibidos no painel de candidatos completo (SemanticCandidatePanel).
          </p>
        </TabsContent>

        <TabsContent value="history" className="flex-1 overflow-y-auto p-4">
          <p className="text-sm text-muted-foreground">
            O histórico de transições será exibido aqui após ações de revisão.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}

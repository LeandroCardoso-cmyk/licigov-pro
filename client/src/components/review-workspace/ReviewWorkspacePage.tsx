import { useState } from "react";
import { toast } from "sonner";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { ReviewQueue } from "./ReviewQueue";
import { ReviewDetailPanel } from "./ReviewDetailPanel";
import { BulkReviewBar } from "./BulkReviewBar";
import {
  useReviewQueue,
  useApproveItem,
  useRejectItem,
  useOverrideItem,
  useBulkApprove,
  useBulkReject,
} from "@/hooks/useReviewWorkspace";
import type { ReviewItemShape } from "./ReviewQueueItem";

interface ReviewWorkspacePageProps {
  organizationId: number;
  processId?: number;
  actorUserId?: number;
  processName?: string;
}

export function ReviewWorkspacePage({
  organizationId,
  processId = 1,
  actorUserId = 1,
  processName,
}: ReviewWorkspacePageProps) {
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [checkedIds,  setCheckedIds]  = useState<Set<string>>(new Set());

  const queueQuery   = useReviewQueue(organizationId, processId);
  const approveMut   = useApproveItem();
  const rejectMut    = useRejectItem();
  const overrideMut  = useOverrideItem();
  const bulkApproveMut = useBulkApprove();
  const bulkRejectMut  = useBulkReject();

  const items: ReviewItemShape[] = (queueQuery.data ?? []).map(item => ({
    id:                  item.id,
    itemNumber:          item.itemNumber,
    description:         item.description,
    quantity:            item.quantity,
    unit:                item.unit,
    canonicalUnit:       item.canonicalUnit,
    confidenceScore:     item.confidenceScore,
    reviewState:         item.reviewState,
    estimatedUnitPrice:  item.estimatedUnitPrice,
    estimatedTotalPrice: item.estimatedTotalPrice,
  }));

  const selectedItem = selectedId ? items.find(i => i.id === selectedId) ?? null : null;

  function handleCheckboxChange(id: string, checked: boolean) {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleApprove(id: string, orgId: number, pid: number, uid: number) {
    approveMut.mutate(
      { id, organizationId: orgId, processId: pid, actorUserId: uid },
      {
        onSuccess: () => toast.success("Item aprovado com sucesso"),
        onError:   err => toast.error(err.message),
      },
    );
  }

  function handleReject(id: string, orgId: number, pid: number, uid: number, reason: string) {
    rejectMut.mutate(
      { id, organizationId: orgId, processId: pid, actorUserId: uid, reason },
      {
        onSuccess: () => toast.success("Item rejeitado"),
        onError:   err => toast.error(err.message),
      },
    );
  }

  function handleOverride(
    id: string,
    orgId: number,
    pid: number,
    uid: number,
    overrides: { quantity?: number; estimatedUnitPrice?: number; description?: string; canonicalUnit?: string },
    justification: string,
  ) {
    overrideMut.mutate(
      { id, organizationId: orgId, processId: pid, actorUserId: uid, overrides, justification },
      {
        onSuccess: () => toast.success("Override aplicado"),
        onError:   err => toast.error(err.message),
      },
    );
  }

  function handleBulkApprove() {
    const ids = Array.from(checkedIds);
    bulkApproveMut.mutate(
      { ids, organizationId, processId, actorUserId },
      {
        onSuccess: res => {
          toast.success(`${res.approved.length} item(s) aprovado(s)`);
          if (res.failed.length > 0) {
            toast.warning(`${res.failed.length} item(s) falharam na aprovação`);
          }
          setCheckedIds(new Set());
        },
        onError: err => toast.error(err.message),
      },
    );
  }

  function handleBulkReject() {
    const ids = Array.from(checkedIds);
    bulkRejectMut.mutate(
      { ids, organizationId, processId, actorUserId, reason: "Rejeitado em lote" },
      {
        onSuccess: res => {
          toast.success(`${res.rejected.length} item(s) rejeitado(s)`);
          if (res.failed.length > 0) {
            toast.warning(`${res.failed.length} item(s) falharam na rejeição`);
          }
          setCheckedIds(new Set());
        },
        onError: err => toast.error(err.message),
      },
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b px-6 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-0.5">
          <span>Processos</span>
          <span>/</span>
          <span>{processName ?? `Processo #${processId}`}</span>
          <span>/</span>
          <span className="text-foreground font-medium">Central de Revisão Semântica</span>
        </div>
        <h1 className="text-xl font-semibold">Central de Revisão Semântica</h1>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Left: Queue */}
          <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
            <div className="h-full border-r overflow-hidden">
              <ReviewQueue
                items={items}
                isLoading={queueQuery.isLoading}
                selectedId={selectedId}
                onSelect={setSelectedId}
                checkedIds={checkedIds}
                onCheckboxChange={handleCheckboxChange}
              />
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right: Detail */}
          <ResizablePanel defaultSize={65} minSize={40}>
            <div className="h-full overflow-hidden">
              <ReviewDetailPanel
                item={selectedItem}
                isLoading={queueQuery.isLoading && !selectedItem}
                organizationId={organizationId}
                processId={processId}
                actorUserId={actorUserId}
                onApprove={handleApprove}
                onReject={handleReject}
                onOverride={handleOverride}
                isApproving={approveMut.isPending}
                isRejecting={rejectMut.isPending}
                isOverriding={overrideMut.isPending}
              />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Bulk bar */}
      <BulkReviewBar
        selectedCount={checkedIds.size}
        onBulkApprove={handleBulkApprove}
        onBulkReject={handleBulkReject}
        isApproving={bulkApproveMut.isPending}
        isRejecting={bulkRejectMut.isPending}
      />
    </div>
  );
}

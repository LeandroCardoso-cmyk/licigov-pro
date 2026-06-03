import { trpc } from "@/lib/trpc";

type ItemReviewState =
  | "pending_match"
  | "candidate_generated"
  | "awaiting_review"
  | "approved"
  | "rejected"
  | "overridden"
  | "manual_entry"
  | "finalized";

export function useReviewQueue(organizationId: number, processId?: number) {
  return trpc.reviewWorkspace.getQueue.useQuery(
    { organizationId, processId },
    { enabled: organizationId > 0 },
  );
}

export function useReviewSummary(organizationId: number, processId?: number) {
  return trpc.reviewWorkspace.getSummary.useQuery(
    { organizationId, processId },
    { enabled: organizationId > 0 },
  );
}

export function useReviewHistory(itemId: string, organizationId: number, processId?: number) {
  return trpc.reviewWorkspace.getReviewHistory.useQuery(
    { itemId, organizationId, processId },
    { enabled: !!itemId && organizationId > 0 },
  );
}

export function useApproveItem() {
  const utils = trpc.useUtils();
  return trpc.itemTr.approve.useMutation({
    onSuccess: () => {
      void utils.reviewWorkspace.getQueue.invalidate();
      void utils.reviewWorkspace.getSummary.invalidate();
      void utils.itemTr.list.invalidate();
    },
  });
}

export function useRejectItem() {
  const utils = trpc.useUtils();
  return trpc.itemTr.reject.useMutation({
    onSuccess: () => {
      void utils.reviewWorkspace.getQueue.invalidate();
      void utils.reviewWorkspace.getSummary.invalidate();
      void utils.itemTr.list.invalidate();
    },
  });
}

export function useOverrideItem() {
  const utils = trpc.useUtils();
  return trpc.itemTr.override.useMutation({
    onSuccess: () => {
      void utils.reviewWorkspace.getQueue.invalidate();
      void utils.reviewWorkspace.getSummary.invalidate();
      void utils.itemTr.list.invalidate();
    },
  });
}

export function useBulkApprove() {
  const utils = trpc.useUtils();
  return trpc.itemTr.bulkApprove.useMutation({
    onSuccess: () => {
      void utils.reviewWorkspace.getQueue.invalidate();
      void utils.reviewWorkspace.getSummary.invalidate();
      void utils.itemTr.list.invalidate();
    },
  });
}

export function useBulkReject() {
  const utils = trpc.useUtils();
  return trpc.itemTr.bulkReject.useMutation({
    onSuccess: () => {
      void utils.reviewWorkspace.getQueue.invalidate();
      void utils.reviewWorkspace.getSummary.invalidate();
      void utils.itemTr.list.invalidate();
    },
  });
}

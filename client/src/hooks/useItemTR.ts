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

interface ItemTRFilters {
  reviewState?: ItemReviewState;
  page?: number;
  pageSize?: number;
}

export function useItemTRList(
  processId: number,
  organizationId: number,
  filters: ItemTRFilters = {},
) {
  return trpc.itemTr.list.useQuery(
    { processId, organizationId, ...filters },
    { enabled: processId > 0 && organizationId > 0 },
  );
}

export function useItemTRById(id: string, organizationId: number) {
  return trpc.itemTr.getById.useQuery(
    { id, organizationId },
    { enabled: !!id && organizationId > 0 },
  );
}

export function useSelectCandidate() {
  const utils = trpc.useUtils();
  return trpc.itemTr.selectCandidate.useMutation({
    onSuccess: () => {
      void utils.itemTr.list.invalidate();
      void utils.itemTr.getById.invalidate();
      void utils.reviewWorkspace.getQueue.invalidate();
    },
  });
}

export function useItemTRAnalytics(organizationId: number, processId?: number) {
  return trpc.itemAnalytics.getDashboard.useQuery(
    { organizationId, processId },
    { enabled: organizationId > 0 },
  );
}

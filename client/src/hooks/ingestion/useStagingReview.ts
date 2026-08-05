/**
 * PR B.2.2 — Revisão humana do staging (listagem paginada + ações auditáveis).
 *
 * Reutiliza os contratos B.2.1: listStagingItems (paginado, tenant-safe), reviewItem, reviewBulk
 * e approveSession. NÃO há correção de VALORES na B.2.1 (diferida para a B.2.3) — a revisão cobre
 * aceitar / rejeitar / pular (+ nota). Aprovar exige zero pendentes e NÃO promove ao domínio.
 */
import { useCallback, useState } from "react";
import { trpc } from "@/lib/trpc";

export type ReviewAction = "approved" | "rejected" | "skipped";
export type ReviewFilter = "pending" | "approved" | "rejected" | "skipped" | undefined;

export function useStagingReview(sessionId: number | null, enabled: boolean) {
  const utils = trpc.useUtils();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [filter, setFilter] = useState<ReviewFilter>(undefined);

  const list = trpc.ingestion.listStagingItems.useQuery(
    { sessionId: sessionId ?? 0, page, pageSize, reviewStatus: filter },
    { enabled: enabled && sessionId != null, refetchOnWindowFocus: false, placeholderData: (prev) => prev },
  );

  const invalidate = useCallback(() => {
    void utils.ingestion.listStagingItems.invalidate();
    void utils.ingestion.getSessionStatus.invalidate();
  }, [utils]);

  const reviewItem = trpc.ingestion.reviewItem.useMutation({ onSuccess: invalidate });
  const reviewBulk = trpc.ingestion.reviewBulk.useMutation({ onSuccess: invalidate });
  const approveSession = trpc.ingestion.approveSession.useMutation({ onSuccess: invalidate });

  const doReviewItem = useCallback(
    (itemId: number, action: ReviewAction, note?: string) => {
      if (sessionId == null || reviewItem.isPending) return; // guarda de submissão duplicada
      return reviewItem.mutateAsync({ sessionId, itemId, action, note });
    },
    [sessionId, reviewItem],
  );

  const doReviewBulk = useCallback(
    (itemIds: number[], action: ReviewAction, note?: string) => {
      if (sessionId == null || itemIds.length === 0 || reviewBulk.isPending) return;
      return reviewBulk.mutateAsync({ sessionId, itemIds, action, note });
    },
    [sessionId, reviewBulk],
  );

  const doApprove = useCallback(() => {
    if (sessionId == null || approveSession.isPending) return;
    return approveSession.mutateAsync({ sessionId });
  }, [sessionId, approveSession]);

  return {
    items: list.data?.items ?? [],
    total: list.data?.total ?? 0,
    totalPages: list.data?.totalPages ?? 1,
    page,
    pageSize,
    filter,
    isLoading: list.isLoading,
    error: list.error ?? null,
    setPage,
    setFilter,
    reviewItem: doReviewItem,
    reviewBulk: doReviewBulk,
    approveSession: doApprove,
    isReviewing: reviewItem.isPending || reviewBulk.isPending,
    isApproving: approveSession.isPending,
    approveError: approveSession.error ?? null,
  };
}

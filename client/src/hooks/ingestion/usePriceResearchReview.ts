/**
 * Pesquisa de Preços — revisão por ITEM LÓGICO (projeção do servidor) + decisão por item (mutation ATÔMICA).
 * Revisão individual de cotação reutiliza `reviewItem`; correção segue pelo drawer (`correctItem`).
 */
import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import type { GroupReviewAction } from "@/lib/ingestion/priceResearchReview";

export function usePriceResearchReview(sessionId: number | null, enabled: boolean, procurementProcessId: string) {
  const utils = trpc.useUtils();
  const query = trpc.ingestion.getPriceResearchReview.useQuery(
    { sessionId: sessionId ?? 0, procurementProcessId },
    { enabled: enabled && sessionId != null && procurementProcessId !== "", refetchOnWindowFocus: false, placeholderData: (prev) => prev },
  );

  const invalidate = useCallback(() => {
    void utils.ingestion.getPriceResearchReview.invalidate();
    void utils.ingestion.listStagingItems.invalidate();
    void utils.ingestion.getSessionStatus.invalidate();
  }, [utils]);

  const decide = trpc.ingestion.reviewPriceResearchGroups.useMutation({ onSettled: invalidate });

  const decideGroups = useCallback(
    (action: GroupReviewAction, groups: { groupKey: string; expectedRevision: string }[], note?: string) => {
      if (sessionId == null || groups.length === 0 || decide.isPending) return;
      return decide.mutateAsync({ sessionId, procurementProcessId, action, groups, note }).catch(() => undefined);
    },
    [sessionId, procurementProcessId, decide],
  );

  return {
    review: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error ?? null,
    refresh: invalidate,
    decideGroups,
    isDeciding: decide.isPending,
    decisionError: decide.error?.message ?? null,
  };
}

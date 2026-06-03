import { trpc } from "@/lib/trpc";

type EntityType = "item_tr" | "clause" | "document" | "workflow";

export function useDiscussionThreads(
  entityId: string,
  entityType: EntityType,
  organizationId: number,
) {
  return trpc.collaborationComments.getThreads.useQuery(
    { entityId, entityType, organizationId },
    { enabled: !!entityId && organizationId > 0 },
  );
}

export function useCreateComment() {
  const utils = trpc.useUtils();
  return trpc.collaborationComments.createComment.useMutation({
    onSuccess: (_data, variables) => {
      void utils.collaborationComments.getThreads.invalidate({
        entityId: variables.entityId,
        entityType: variables.entityType,
        organizationId: variables.organizationId,
      });
      void utils.collaborationComments.getTimeline.invalidate({
        entityId: variables.entityId,
        organizationId: variables.organizationId,
      });
    },
  });
}

export function useResolveThread() {
  const utils = trpc.useUtils();
  return trpc.collaborationComments.resolveThread.useMutation({
    onSuccess: (_data, variables) => {
      void utils.collaborationComments.getThreads.invalidate({
        organizationId: variables.organizationId,
      });
    },
  });
}

export function useCollaborationTimeline(
  entityId: string,
  organizationId: number,
) {
  return trpc.collaborationComments.getTimeline.useQuery(
    { entityId, organizationId },
    { enabled: !!entityId && organizationId > 0 },
  );
}

import { trpc } from "@/lib/trpc";

export function useExportHistory(organizationId: number, processId?: number) {
  return trpc.exports.getHistory.useQuery(
    { organizationId, processId, limit: 50 },
    { enabled: organizationId > 0 },
  );
}

export function useGenerateExport() {
  const utils = trpc.useUtils();
  return trpc.exports.generate.useMutation({
    onSuccess: () => {
      utils.exports.getHistory.invalidate();
    },
  });
}

export function useExportPreview(processId: number, organizationId: number) {
  return trpc.exports.getPreview.useQuery(
    { processId, organizationId },
    { enabled: processId > 0 && organizationId > 0 },
  );
}

/**
 * PR B.2.2 — Capacidades de ingestão do tenant (gating da UI).
 *
 * Read-only. Se `enabled` for false (flag desligada / fail-closed) a superfície não deve ser
 * exposta. O backend continua autorizando cada operação individualmente.
 */
import { trpc } from "@/lib/trpc";
import type { IngestionCapabilities } from "@/lib/ingestion/capabilities";

export function useIngestionCapabilities() {
  const query = trpc.ingestion.getCapabilities.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const capabilities = query.data as IngestionCapabilities | undefined;
  return {
    capabilities,
    enabled: capabilities?.enabled ?? false,
    isLoading: query.isLoading,
    error: query.error ?? null,
  };
}

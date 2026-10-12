import { trpc } from "../../lib/trpc";
import type { PreparationStateView } from "@/lib/editalPreparation";

export interface EditalPreparationQueryParams { modality?: string; form?: string; platform?: string }
export type EditalTrPin = { documentId: string; version: number; contentHash: string } | null | undefined;

type PreparationData = PreparationStateView | { status: "UNAVAILABLE"; resolution: string; reason: string };

/**
 * Estado da preparação (rota existente `editalTemplatePreparation`). UMA fonte para o painel e para o CTA da workspace: a MESMA entrada
 * ⇒ a MESMA chave de cache do TanStack Query (uma só requisição); nenhuma segunda engine de prontidão.
 */
export function useEditalPreparationState(processId: string, params: EditalPreparationQueryParams, trPin: EditalTrPin, enabled = true) {
  const input = { processId, ...params, ...(trPin ? { officialPins: { TR: trPin } } : {}) } as never;
  const query = trpc.procurementProcess.editalTemplatePreparation.useQuery(input, { enabled: enabled && !!processId });
  const data = query.data as PreparationData | undefined;
  return { query, state: data?.status === "READY_FOR_PREPARATION" ? data : undefined };
}

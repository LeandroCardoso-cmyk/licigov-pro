/**
 * FASE 5 — Centro de Operações: Registro de Publicações (status + data)
 *
 * As publicações permanecem DENTRO dos Business Domains; aqui registramos apenas
 * o STATUS e a DATA por canal — nunca viram eventos de calendário. Os nomes dos
 * canais NÃO são fixos: cada município configura Órgão Oficial, Jornal e Portal.
 * Apenas o PNCP é padrão. Determinístico, multi-tenant.
 */

import { createHash } from "crypto";

/** Canais padrão. Apenas `pncp` é fixo; os demais são configuráveis por município. */
export type PublicationChannel = "pncp" | "orgao_oficial" | "diario_oficial" | "portal" | "jornal";

export const DEFAULT_PUBLICATION_CHANNELS: readonly PublicationChannel[] = [
  "pncp", "orgao_oficial", "diario_oficial", "portal", "jornal",
];

export type PublicationStatus = "nao_iniciado" | "pendente" | "publicado";

export interface PublicationRecord {
  readonly id: string;
  readonly organizationId: number;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly channel: PublicationChannel;
  readonly status: PublicationStatus;
  readonly date: string;
  readonly correlationId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function createPublicationRecord(params: {
  organizationId: number;
  referenceType: string;
  referenceId: string;
  channel: PublicationChannel;
  status?: PublicationStatus;
  date?: string;
  correlationId: string;
  createdAt?: string;
}): PublicationRecord {
  const id = createHash("sha256")
    .update(`oppub:${params.organizationId}:${params.referenceId}:${params.channel}`)
    .digest("hex").slice(0, 20);
  const ts = params.createdAt ?? new Date().toISOString();
  return {
    id,
    organizationId: params.organizationId,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    channel: params.channel,
    status: params.status ?? "nao_iniciado",
    date: params.date ?? "",
    correlationId: params.correlationId,
    createdAt: ts,
    updatedAt: ts,
  };
}

/** Rótulo configurável de um canal (o município pode renomear; PNCP é fixo). */
export function channelLabel(channel: PublicationChannel, config: Partial<Record<PublicationChannel, string>> = {}): string {
  if (channel === "pncp") return "PNCP";
  const defaults: Record<PublicationChannel, string> = {
    pncp: "PNCP",
    orgao_oficial: "Órgão Oficial do Município",
    diario_oficial: "Diário Oficial",
    portal: "Portal Eletrônico",
    jornal: "Jornal de Grande Circulação",
  };
  return config[channel] ?? defaults[channel];
}

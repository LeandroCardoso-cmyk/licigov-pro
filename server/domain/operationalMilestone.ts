/**
 * FASE 5 — Centro de Operações: Marcos Operacionais (preenchimento manual)
 *
 * Marcos são informações que acontecem FORA do LiciGov e não existem em nenhum
 * Business Domain — data do certame, homologação, assinatura externa. NUNCA
 * duplicam informações já existentes no sistema. Determinístico, multi-tenant.
 */

import { createHash } from "crypto";

export type MilestoneType =
  | "certame"
  | "homologacao"
  | "assinatura"
  | "sessao_publica"
  | "outro";

export interface OperationalMilestone {
  readonly id: string;
  readonly organizationId: number;
  /** Processo/registro de referência (do domínio ou um OperationRecord). */
  readonly referenceType: string;
  readonly referenceId: string;
  readonly milestoneType: MilestoneType;
  readonly date: string;
  readonly time: string;
  readonly result: string;
  readonly observation: string;
  readonly correlationId: string;
  readonly createdAt: string;
}

export function createOperationalMilestone(params: {
  organizationId: number;
  referenceType: string;
  referenceId: string;
  milestoneType: MilestoneType;
  date?: string;
  time?: string;
  result?: string;
  observation?: string;
  correlationId: string;
  createdAt?: string;
}): OperationalMilestone {
  const id = createHash("sha256")
    .update(`opms:${params.organizationId}:${params.referenceId}:${params.milestoneType}`)
    .digest("hex").slice(0, 20);
  return {
    id,
    organizationId: params.organizationId,
    referenceType: params.referenceType,
    referenceId: params.referenceId,
    milestoneType: params.milestoneType,
    date: params.date ?? "",
    time: params.time ?? "",
    result: params.result ?? "",
    observation: params.observation ?? "",
    correlationId: params.correlationId,
    createdAt: params.createdAt ?? new Date().toISOString(),
  };
}

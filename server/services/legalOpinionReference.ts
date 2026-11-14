/**
 * M8 pós-homologação — REFERÊNCIA HUMANA da origem de um parecer.
 *
 * `referenceProcessId` da solicitação é o id do WORKSPACE de origem (contrato, contratação direta ou processo licitatório) —
 * não um número de processo. A tela mostrava "Processo ref.: <id técnico>" e o pedido ao Copiloto dizia "referente ao processo
 * <id do contrato>". Aqui a origem é resolvida no PRÓPRIO tenant, pelo domínio de origem da solicitação, em rótulo legível
 * ("Contrato nº X — Processo nº AAAA/NNNN"). Sem origem resolvível ⇒ `null` (a ausência é declarada; nada é presumido).
 * O campo armazenado não muda (identidade da solicitação, devolução e lineage continuam pelo id).
 */
import { getRequest } from "../db/institutionalRequests";
import { getContractWorkspace } from "../db/contractWorkspace";
import { getDirectProcurementWorkspace } from "../db/directProcurement";
import { getProcess } from "../db/procurement";

export interface OpinionReference {
  /** Domínio de origem da solicitação (null quando a solicitação não é encontrada no tenant). */
  readonly sourceDomain: string | null;
  /** Rótulo humano da origem; null quando não há origem identificável (declarado como ausente na tela e no pedido). */
  readonly label: string | null;
}

const clean = (v: string | null | undefined): string => (v ?? "").trim();

/** Rótulo PURO a partir dos registros já lidos (testável sem banco). */
export function opinionReferenceLabel(input: {
  sourceDomain: string | null;
  contract?: { contractNumber: string; originType: string } | null;
  originProcessNumber?: string | null;
  directProcessNumber?: string | null;
  procurementProcessNumber?: string | null;
}): string | null {
  if (input.sourceDomain === "contratos") {
    const n = clean(input.contract?.contractNumber);
    if (!n) return null;
    const origin = clean(input.originProcessNumber);
    if (origin && input.contract?.originType === "processo_licitatorio") return `Contrato nº ${n} — Processo nº ${origin}`;
    if (origin && input.contract?.originType === "contratacao_direta") return `Contrato nº ${n} — Contratação direta nº ${origin}`;
    return `Contrato nº ${n}`;
  }
  if (input.sourceDomain === "contratacao_direta") {
    const n = clean(input.directProcessNumber);
    return n ? `Contratação direta nº ${n}` : null;
  }
  if (input.sourceDomain === "processo_licitatorio") {
    const n = clean(input.procurementProcessNumber);
    return n ? `Processo nº ${n}` : null;
  }
  return null;
}

/** Resolve a origem no tenant (leituras filtradas por organização; nenhum dado de outra organização entra no rótulo). */
export async function resolveOpinionReference(organizationId: number, requestId: string | null | undefined, referenceId: string | null | undefined): Promise<OpinionReference> {
  const req = requestId ? await getRequest(requestId, organizationId).catch(() => null) : null;
  const sourceDomain = req?.sourceDomain ?? null;
  const id = clean(referenceId);
  if (!sourceDomain || !id) return { sourceDomain, label: null };
  try {
    if (sourceDomain === "contratos") {
      const contract = await getContractWorkspace(id, organizationId);
      let originProcessNumber: string | null = null;
      if (contract?.originProcess && contract.originType === "processo_licitatorio") originProcessNumber = (await getProcess(contract.originProcess, organizationId))?.processNumber ?? null;
      if (contract?.originProcess && contract.originType === "contratacao_direta") originProcessNumber = (await getDirectProcurementWorkspace(contract.originProcess, organizationId))?.processNumber ?? null;
      return { sourceDomain, label: opinionReferenceLabel({ sourceDomain, contract, originProcessNumber }) };
    }
    if (sourceDomain === "contratacao_direta") {
      return { sourceDomain, label: opinionReferenceLabel({ sourceDomain, directProcessNumber: (await getDirectProcurementWorkspace(id, organizationId))?.processNumber }) };
    }
    if (sourceDomain === "processo_licitatorio") {
      return { sourceDomain, label: opinionReferenceLabel({ sourceDomain, procurementProcessNumber: (await getProcess(id, organizationId))?.processNumber }) };
    }
  } catch {
    // Origem ilegível ⇒ ausência declarada (nunca o id técnico como se fosse número de processo).
  }
  return { sourceDomain, label: null };
}

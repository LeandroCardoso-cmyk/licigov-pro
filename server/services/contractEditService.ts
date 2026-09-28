/**
 * SEM-023 (PR-12) — "Contrato vigente só muda por instrumento".
 *
 * Gravação GOVERNADA da edição direta do contrato (`contractWorkspace.updateContract` / "Salvar contrato"):
 *  1. CAS de revisão — o cliente envia a revisão (`updatedAt`) que carregou; revisão divergente ⇒
 *     `ContractRevisionConflictError` (CONFLICT, `CONTRACT_REVISION_CONFLICT`) sem nenhuma escrita; a escrita
 *     em si é um UPDATE condicional (`compareAndSetContractWorkspace`), então dois salvamentos concorrentes
 *     com a mesma revisão ⇒ exatamente um vence.
 *  2. Campos econômicos/de identidade E gestor/fiscal só mudam na minuta — a guarda vive no domínio
 *     (`updateContractFields` → `assertContractFieldsEditable`), antes de qualquer efeito.
 *  3. Rastreabilidade — cada gravação aceita registra um evento `change` no timeline do contrato com
 *     antes → depois dos campos alterados e o ator real.
 *
 * Arquivo próprio (e não `contractService.ts`) para não sobrepor as mudanças de instrumentos/status (PR-08).
 * Não altera a máquina de estados nem a criação de aditivo/apostilamento.
 */

import { recordProcessEvent } from "../db/procurement";
import { compareAndSetContractWorkspace } from "../db/contractWorkspace";
import {
  ContractRevisionConflictError, isSameContractRevision, nextContractRevision,
  type ContractWorkspace,
} from "../domain/contractWorkspace";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("ContractEditService");

const TRACKED_FIELDS = ["contractNumber", "contractor", "object", "value", "term", "manager", "inspector", "status"] as const;

/** Pré-checagem barata do CAS (antes de validar o patch): revisão divergente ⇒ recusa sem escrita. */
export function assertExpectedContractRevision(current: ContractWorkspace, expectedUpdatedAt: string): void {
  if (!isSameContractRevision(current.updatedAt, expectedUpdatedAt)) throw new ContractRevisionConflictError();
}

function clip(v: unknown): string {
  const s = String(v ?? "");
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/** Descrição auditável "campo: antes → depois" (somente campos realmente alterados). */
export function describeContractChanges(before: ContractWorkspace, after: ContractWorkspace): string[] {
  return TRACKED_FIELDS
    .filter(f => String(before[f] ?? "") !== String(after[f] ?? ""))
    .map(f => `${f}: "${clip(before[f])}" → "${clip(after[f])}"`);
}

/**
 * Persiste `after` (já validado pelo domínio) por CAS contra `expectedUpdatedAt`. A revisão nova é sempre
 * estritamente posterior à esperada. Retorna o contrato gravado (com a revisão nova, para o próximo save).
 */
export async function saveGovernedContractEdit(params: {
  before: ContractWorkspace; after: ContractWorkspace; expectedUpdatedAt: string;
  actorUserId: number; correlationId: string;
}): Promise<ContractWorkspace> {
  assertExpectedContractRevision(params.before, params.expectedUpdatedAt);
  const saved: ContractWorkspace = { ...params.after, updatedAt: nextContractRevision(params.expectedUpdatedAt) };
  const ok = await compareAndSetContractWorkspace(saved, params.expectedUpdatedAt);
  if (!ok) throw new ContractRevisionConflictError();

  const changes = describeContractChanges(params.before, saved);
  try {
    await recordProcessEvent({
      organizationId: saved.organizationId, processId: saved.id, eventType: "change", actor: `user:${params.actorUserId}`,
      summary: changes.length > 0
        ? `Contrato ${saved.contractNumber} editado diretamente (${changes.join("; ")}).`
        : `Contrato ${saved.contractNumber} salvo sem alteração de campos.`,
      refId: saved.id, correlationId: params.correlationId,
    });
  } catch (e) {
    // A edição JÁ foi gravada (CAS venceu): falha do timeline não pode virar "erro" para o usuário, que
    // refaria o save e receberia CONFLICT. Registrado para reconciliação.
    log.warn("contract_edit_event_failed", { contractId: saved.id, organizationId: saved.organizationId, error: e instanceof Error ? e.message : String(e) });
  }
  return saved;
}

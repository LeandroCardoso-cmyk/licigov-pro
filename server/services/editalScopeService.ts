/**
 * Escopo do Edital escolhido antes da 1ª geração (modalidade/forma/plataforma) — leitura e registro humano no ledger EXISTENTE
 * de fatos do Contexto Canônico (`edital.scope`). Sem migration. Tenant-scoped (processo de outra organização ⇒ NOT_FOUND).
 * CAS por `expectedValueHash` (a pessoa altera o escopo que VIU); mesmo valor ⇒ idempotente, nada gravado.
 */
import { TRPCError } from "@trpc/server";
import { getProcess, recordProcessEvent } from "../db/procurement";
import { listContextFacts } from "../db/procurementContext";
import {
  EDITAL_SCOPE_PATH, editalScopeSelection, encodeEditalScope, normalizeEditalScope, type EditalScopeSelection,
} from "../domain/editalScopeSelection";
import { recordContextAssertions } from "./canonicalContextService";
import { serviceLogger } from "./observabilityService";

const log = serviceLogger("EditalScope");

export const EDITAL_SCOPE_CHANGED = "EDITAL_SCOPE_CHANGED";

async function requireTenantProcess(organizationId: number, processId: string): Promise<void> {
  if (!(await getProcess(processId, organizationId))) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado nesta organização." });
}

export async function getEditalScopeSelection(organizationId: number, processId: string): Promise<EditalScopeSelection> {
  await requireTenantProcess(organizationId, processId);
  return editalScopeSelection(await listContextFacts(organizationId, processId));
}

export interface RecordEditalScopeInput {
  readonly organizationId: number;
  readonly processId: string;
  readonly actorUserId: number;
  readonly correlationId: string;
  readonly scope: { readonly modality?: string | null; readonly form?: string | null; readonly platform?: string | null };
  /** Hash do escopo vigente que a pessoa viu (null = nenhum registrado). */
  readonly expectedValueHash: string | null;
}

export async function recordEditalScope(input: RecordEditalScopeInput): Promise<{ readonly recorded: boolean; readonly selection: EditalScopeSelection }> {
  if (!Number.isInteger(input.actorUserId) || input.actorUserId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "Escopo do Edital exige ator humano identificado." });
  const normalized = normalizeEditalScope(input.scope);
  if (!normalized.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `${normalized.reason}: informe modalidade, forma e (na forma eletrônica) plataforma válidas.` });
  await requireTenantProcess(input.organizationId, input.processId);

  const facts = await listContextFacts(input.organizationId, input.processId);
  const current = editalScopeSelection(facts);
  const encoded = encodeEditalScope(normalized.scope);
  if (current.scope && encodeEditalScope(current.scope) === encoded) return { recorded: false, selection: current };
  if (current.conflict || (current.valueHash ?? null) !== (input.expectedValueHash ?? null)) {
    throw new TRPCError({ code: "CONFLICT", message: `${EDITAL_SCOPE_CHANGED}: o escopo do Edital foi alterado por outra pessoa; recarregue antes de alterar.` });
  }

  const previous = facts.filter((f) => f.path === EDITAL_SCOPE_PATH).reduce((m, f) => Math.max(m, f.id), 0);
  await recordContextAssertions({
    organizationId: input.organizationId, processId: input.processId, correlationId: input.correlationId,
    facts: [{
      path: EDITAL_SCOPE_PATH, value: encoded, sourceType: "user", sourceId: "edital-scope", sourceVersion: `rev:${previous}`,
      status: "confirmed", actorUserId: input.actorUserId, basisValueHash: current.valueHash,
    }],
  });
  const s = normalized.scope;
  await recordProcessEvent({
    organizationId: input.organizationId, processId: input.processId, eventType: "change", actor: String(input.actorUserId),
    summary: `Escopo do Edital escolhido antes da geração: ${s.modality} / ${s.form}${s.platform ? ` / ${s.platform}` : ""}.`, correlationId: input.correlationId,
  });
  const selection = editalScopeSelection(await listContextFacts(input.organizationId, input.processId));
  log.info("edital_scope_recorded", {
    organizationId: input.organizationId, processId: input.processId, actorUserId: input.actorUserId, correlationId: input.correlationId,
    modality: s.modality, form: s.form, platform: s.platform,
  });
  return { recorded: true, selection };
}

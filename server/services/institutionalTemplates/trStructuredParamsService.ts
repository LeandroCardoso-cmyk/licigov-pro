/**
 * PARÂMETROS ESTRUTURADOS DO TR — leitura do estado e registro humano (CONTEXT_REUSE 2.0).
 *
 * Camada estruturada do MESMO fluxo do TR (sem outro documento). Persistência no ledger EXISTENTE de fatos do Contexto Canônico
 * (`procurement_context_facts`): caminho `tr.param.<variável>`, fonte `tr`, ator humano, status `confirmed`, append-only, com
 * `basisValueHash` (superação consciente) e proveniência explícita (`sourceVersion` = `rev:<id anterior>[;def:<revisão do padrão>]`).
 * Nenhuma migration. IA nunca afirma um parâmetro. Tenant-scoped; processo de outra organização falha fechado (NOT_FOUND).
 *
 * O TR (rascunho) e o Edital CONSOMEM os mesmos fatos: o Edital os lê por `editalContextReuse` (mesma resolução).
 */
import { TRPCError } from "@trpc/server";
import { getProcess } from "../../db/procurement";
import { listContextFacts } from "../../db/procurementContext";
import { conditionVariables, evaluateCondition2, type Cond2 } from "../../domain/institutionalTemplates/conditionalDsl2";
import { formatValue2 } from "../../domain/institutionalTemplates/valueTypes2";
import { authorityEntryOf, isDefaultEligible } from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import type { EditalBoundaryParams } from "../../domain/institutionalTemplates/editalBridgeScope";
import { GOVERNED_ORG_SUBJECT, readGovernedRecord, type GovernedRecord } from "./governedFieldsStore";
import { encodeTrParamValue, resolveTrParams, trParamPath, trParamsDigest } from "../../domain/trStructuredParams";
import { resolveField } from "../../domain/canonicalProcurementContext";
import { recordContextAssertions } from "../canonicalContextService";
import { serviceLogger } from "../observabilityService";
import type { BridgeDeps } from "./editalBridgeService";
import { loadEditalCatalog } from "./editalCatalogLoader";
import { trParamDefs, trParamProposals } from "./editalContextReuse";

const log = serviceLogger("TrStructuredParams");

export type TrParamStatus = "SET" | "UNSET" | "INVALID" | "CONFLICT";

export interface TrParamView {
  readonly name: string;
  readonly path: string;
  readonly type: string;
  readonly description: string;
  readonly required: boolean;
  readonly conditional: boolean;
  readonly requiredWhen?: Cond2;
  readonly requiredWhenVariables: readonly string[];
  readonly enumValues?: readonly string[];
  /** A condição `requiredWhen` está ATIVA dado o que o TR já informou (campos inativos não são exigidos nem consumidos). */
  readonly active: boolean;
  readonly status: TrParamStatus;
  readonly value?: unknown;
  readonly reason?: string;
  /** Proveniência do fato vigente. */
  readonly origin?: { readonly sourceType: string; readonly sourceId: string; readonly sourceVersion: string; readonly status: string; readonly actorUserId: number | null; readonly updatedAt: string | null };
  /** Padrão institucional ELEGÍVEL (proposta; só vira fato com confirmação humana). */
  readonly proposal?: { readonly value: unknown; readonly orgProfileRevision: number };
  readonly defaultEligible: boolean;
}

export type TrStructuredState =
  | { readonly status: "UNAVAILABLE"; readonly reason: string }
  | {
    readonly status: "READY";
    readonly catalogVersion: string;
    readonly fields: readonly TrParamView[];
    readonly digest: string;
    readonly orgProfileRevision: number | null;
    readonly summary: { readonly total: number; readonly active: number; readonly set: number; readonly pending: number; readonly proposals: number };
  };

const ZERO_COND_FACTS = (values: Map<string, unknown>): Record<string, unknown> => Object.fromEntries(values);

async function requireTenantProcess(organizationId: number, processId: string): Promise<void> {
  const p = await getProcess(processId, organizationId);
  if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado nesta organização." });
}

export async function getTrStructuredState(deps: BridgeDeps, organizationId: number, processId: string, params: EditalBoundaryParams): Promise<TrStructuredState> {
  await requireTenantProcess(organizationId, processId);
  const loaded = await loadEditalCatalog(deps, organizationId, params);
  if (loaded.status !== "OK") return { status: "UNAVAILABLE", reason: loaded.reason };
  const { catalog } = loaded;
  const [facts, orgRecord] = await Promise.all([
    listContextFacts(organizationId, processId),
    readGovernedRecord(organizationId, "ORG", GOVERNED_ORG_SUBJECT, catalog).catch(() => null as GovernedRecord | null),
  ]);
  const defs = trParamDefs(catalog);
  const resolved = resolveTrParams(defs, facts);
  const proposals = trParamProposals(catalog, orgRecord);

  // Condições dos campos condicionais: avaliadas com o que o TR já informou (os pais são parâmetros do TR — Authority Matrix).
  const known = new Map<string, unknown>();
  for (const [name, p] of resolved) if (p.status === "SET") known.set(name, p.value);
  const activeOf = (name: string): boolean => {
    const def = defs.find((d) => d.name === name)!;
    return !def.requiredWhen || evaluateCondition2(def.requiredWhen, ZERO_COND_FACTS(known)).result;
  };

  const fields: TrParamView[] = defs.map((def): TrParamView => {
    const r = resolved.get(def.name)!;
    const prop = proposals.get(def.name);
    const active = activeOf(def.name);
    return {
      name: def.name, path: def.path, type: def.type, description: (def.description ?? "").replace(/\s*\[[^\]]*\]\s*$/, ""),
      required: def.required, conditional: !!def.requiredWhen,
      requiredWhenVariables: def.requiredWhen ? [...new Set(conditionVariables(def.requiredWhen))].sort() : [],
      ...(def.requiredWhen ? { requiredWhen: def.requiredWhen } : {}), ...(def.enumValues ? { enumValues: def.enumValues } : {}),
      active, status: r.status,
      ...(r.status === "SET" ? { value: r.value } : {}), ...(r.reason ? { reason: r.reason } : {}),
      ...(r.field.source ? { origin: { sourceType: r.field.source.type, sourceId: r.field.source.id, sourceVersion: r.field.source.version, status: r.field.status, actorUserId: r.field.actorUserId, updatedAt: r.field.updatedAt } } : {}),
      ...(prop && r.status === "UNSET" ? { proposal: { value: prop.value, orgProfileRevision: prop.revision } } : {}),
      defaultEligible: isDefaultEligible(def.name),
    };
  });
  const activeFields = fields.filter((f) => f.active && (f.required || f.conditional));
  return {
    status: "READY", catalogVersion: catalog.version, fields, digest: trParamsDigest(resolved), orgProfileRevision: orgRecord?.revision ?? null,
    summary: {
      total: fields.length, active: activeFields.length, set: activeFields.filter((f) => f.status === "SET").length,
      pending: activeFields.filter((f) => f.status !== "SET").length, proposals: fields.filter((f) => f.proposal).length,
    },
  };
}

export interface RecordTrParamsInput {
  readonly organizationId: number;
  readonly processId: string;
  readonly actorUserId: number;
  readonly correlationId: string;
  readonly params: EditalBoundaryParams;
  /** nome da variável → valor tipado. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Nomes cujo valor veio de PROPOSTA de padrão institucional (proveniência `def:<revisão>`); a confirmação é desta chamada. */
  readonly fromDefaults?: readonly string[];
  /** Nomes a limpar (nova afirmação vazia; o histórico permanece). */
  readonly clear?: readonly string[];
}

export interface RecordTrParamsResult { readonly recorded: number; readonly unchanged: number; readonly digest: string }

export async function recordTrStructuredParams(deps: BridgeDeps, input: RecordTrParamsInput): Promise<RecordTrParamsResult> {
  if (!Number.isInteger(input.actorUserId) || input.actorUserId <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "Parâmetro estruturado do TR exige ator humano identificado." });
  await requireTenantProcess(input.organizationId, input.processId);
  const loaded = await loadEditalCatalog(deps, input.organizationId, input.params);
  if (loaded.status !== "OK") throw new TRPCError({ code: "PRECONDITION_FAILED", message: `TR_PARAMS_UNAVAILABLE: ${loaded.reason}` });
  const { catalog } = loaded;
  const defs = new Map(trParamDefs(catalog).map((d) => [d.name, d] as const));
  const facts = await listContextFacts(input.organizationId, input.processId);
  const orgRecord = await readGovernedRecord(input.organizationId, "ORG", GOVERNED_ORG_SUBJECT, catalog).catch(() => null as GovernedRecord | null);
  const fromDefaults = new Set(input.fromDefaults ?? []);

  const toWrite: Parameters<typeof recordContextAssertions>[0]["facts"][number][] = [];
  let unchanged = 0;
  const entries: Array<[string, unknown, boolean]> = [
    ...Object.entries(input.values).map(([n, v]): [string, unknown, boolean] => [n, v, false]),
    ...(input.clear ?? []).map((n): [string, unknown, boolean] => [n, null, true]),
  ];
  for (const [name, raw, clearing] of entries) {
    const def = defs.get(name);
    if (!def) throw new TRPCError({ code: "BAD_REQUEST", message: `TR_PARAM_UNKNOWN: "${name}" não é parâmetro estruturado do TR neste modelo.` });
    if (authorityEntryOf(name)?.entry !== "TR_SECTION") throw new TRPCError({ code: "BAD_REQUEST", message: `TR_PARAM_UNKNOWN: "${name}" não é informado no TR.` });
    const path = trParamPath(name);
    const current = resolveField(path, facts);
    if (current.status === "conflict") throw new TRPCError({ code: "CONFLICT", message: `TR_PARAM_CONFLICT: "${name}" tem afirmações divergentes; resolva antes de alterar.` });
    let encoded: string | null = null;
    if (!clearing) {
      const enc = encodeTrParamValue(def, raw);
      if (!enc.ok) throw new TRPCError({ code: "BAD_REQUEST", message: `TR_PARAM_INVALID: ${name}: ${enc.reason}` });
      encoded = enc.encoded;
    }
    if ((current.value ?? null) === encoded) { unchanged++; continue; }
    const previous = facts.filter((f) => f.path === path).reduce((m, f) => Math.max(m, f.id), 0);
    const defMark = !clearing && fromDefaults.has(name) && orgRecord ? `;def:${orgRecord.revision}` : "";
    toWrite.push({
      path, value: encoded, sourceType: "tr", sourceId: "tr-params", sourceVersion: `rev:${previous}${defMark}`.slice(0, 64),
      status: "confirmed", actorUserId: input.actorUserId,
      basisValueHash: current.valueHash,
    });
  }
  const recorded = toWrite.length ? await recordContextAssertions({ organizationId: input.organizationId, processId: input.processId, correlationId: input.correlationId, facts: toWrite }) : 0;
  const after = toWrite.length ? await listContextFacts(input.organizationId, input.processId) : facts;
  const digest = trParamsDigest(resolveTrParams([...defs.values()], after));
  log.info("tr_structured_params_recorded", {
    organizationId: input.organizationId, processId: input.processId, actorUserId: input.actorUserId, correlationId: input.correlationId,
    recorded, unchanged, names: toWrite.map((f) => f.path.slice("tr.param.".length)).slice(0, 60), digest: digest.slice(0, 16),
  });
  return { recorded, unchanged, digest };
}


/**
 * Bloco DETERMINÍSTICO dos parâmetros confirmados, para o TEXTO do TR (mesmos fatos que o Edital consome). Gerado pelo sistema
 * (como o quadro de itens): sem IA, sem inferência; só parâmetros com valor confirmado e condição ativa; vazio ⇒ `null`.
 */
export async function renderTrStructuredBlock(deps: BridgeDeps, organizationId: number, processId: string, params: EditalBoundaryParams): Promise<{ block: string; digest: string; count: number } | null> {
  const loaded = await loadEditalCatalog(deps, organizationId, params);
  if (loaded.status !== "OK") return null;
  const defs = trParamDefs(loaded.catalog);
  const facts = await listContextFacts(organizationId, processId);
  const resolved = resolveTrParams(defs, facts);
  const known = new Map<string, unknown>();
  for (const [name, p] of resolved) if (p.status === "SET") known.set(name, p.value);
  const lines: string[] = [];
  for (const def of defs) {
    const p = resolved.get(def.name);
    if (!p || p.status !== "SET") continue;
    if (def.requiredWhen && !evaluateCondition2(def.requiredWhen, ZERO_COND_FACTS(known)).result) continue;
    const label = (def.description ?? def.name).replace(/\s*\[[^\]]*\]\s*$/, "");
    lines.push(`- ${label}: ${formatValue2(def, p.value)}`);
  }
  if (lines.length === 0) return null;
  return {
    block: `PARÂMETROS ESTRUTURADOS DA CONTRATAÇÃO (confirmados neste processo; o Edital usa os mesmos dados)\n\n${lines.join("\n")}`,
    digest: trParamsDigest(resolved), count: lines.length,
  };
}

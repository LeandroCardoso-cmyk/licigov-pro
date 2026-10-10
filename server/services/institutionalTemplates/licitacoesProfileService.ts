/**
 * PERFIL INSTITUCIONAL DE LICITAÇÕES — estado de leitura (CONTEXT_REUSE 2.0).
 *
 * Configuração ÚNICA por órgão, reutilizada por todo Edital: papéis institucionais (nome/cargo/ato/vigência), políticas estáveis e
 * PADRÕES institucionais explícitos. Persistência no ledger ORG EXISTENTE (`institutional.policy`, `governed-fields`); a escrita
 * usa os endpoints governados (`governed.recordOrganizationFields` / `governed.recordLicitacoesProfile`) com CAS por revisão.
 * Somente leitura; tenant-scoped; nada é inferido nem copiado de outro processo.
 */
import type { EditalBoundaryParams } from "../../domain/institutionalTemplates/editalBridgeScope";
import {
  ROLE_KEYS, ROLE_LABEL, ROLE_VARIABLES, isDefaultEligible, resolveRoleVariable, type RoleAssignment, type RoleKey,
} from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import { classifyVariable } from "../../domain/institutionalTemplates/editalPreparationModel";
import { AUTHORITY_OWNED_PATHS } from "../../domain/institutionalTemplates/governedSources";
import type { BridgeDeps } from "./editalBridgeService";
import { loadEditalCatalog } from "./editalCatalogLoader";
import { GOVERNED_ORG_SUBJECT, readGovernedRecord } from "./governedFieldsStore";
import { describeVariable } from "./editalPreparationService";
import type { PreparationField, PreparationSection } from "./editalPreparationService";
import type { VariableSource2 } from "../../domain/institutionalTemplates/variableCatalog2";

export interface RoleView {
  readonly role: RoleKey;
  readonly label: string;
  readonly assignment: RoleAssignment | null;
  readonly state: "OK" | "MISSING" | "STALE";
  readonly reason?: string;
  /** Variáveis do modelo que usam o papel (vazio ⇒ papel registrado para outros modelos/uso futuro). */
  readonly usedBy: readonly { readonly name: string; readonly description: string }[];
}

export interface DefaultView {
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly enumValues?: readonly string[];
  readonly value: unknown;
  readonly hasValue: boolean;
  readonly incompatibleReason?: string;
}

export type LicitacoesProfileState =
  | { readonly status: "UNAVAILABLE"; readonly reason: string }
  | {
    readonly status: "READY";
    readonly catalogVersion: string;
    /** CAS (`expectedRevision`) do registro do órgão; 0 = nenhum registro ainda. */
    readonly revision: number;
    readonly hash: string | null;
    readonly asOf: string;
    /** Políticas do órgão (campos editáveis) agrupadas por fonte — mesma forma da preparação, para reutilizar o plano de salvar. */
    readonly sections: readonly PreparationSection[];
    readonly roles: readonly RoleView[];
    readonly defaults: readonly DefaultView[];
    readonly summary: { readonly policyTotal: number; readonly policyFilled: number; readonly policyPending: number; readonly rolesNeeded: number; readonly rolesOk: number; readonly rolesPending: number; readonly pendingCount: number };
  };

const ORG_SOURCES: readonly VariableSource2[] = ["IDENTITY", "POLICY"];

export async function getLicitacoesProfileState(deps: BridgeDeps, organizationId: number, params: EditalBoundaryParams): Promise<LicitacoesProfileState> {
  const loaded = await loadEditalCatalog(deps, organizationId, params);
  if (loaded.status !== "OK") return { status: "UNAVAILABLE", reason: loaded.reason };
  const { catalog } = loaded;
  const record = await readGovernedRecord(organizationId, "ORG", GOVERNED_ORG_SUBJECT, catalog);
  const asOf = deps.now().slice(0, 10);

  // Políticas: variáveis do ESCOPO ÓRGÃO que NÃO são papel nem autoridade canônica.
  const fields: Record<string, PreparationField[]> = {};
  let policyTotal = 0, policyFilled = 0, policyPending = 0;
  for (const v of catalog.vars) {
    if (!ORG_SOURCES.includes(v.source)) continue;
    const c = classifyVariable(v);
    if (c.rule === "ORG_ROLE" || c.class === "CANONICAL" || c.class === "POST_AWARD" || (AUTHORITY_OWNED_PATHS[v.source] ?? []).includes(v.path)) continue;
    const section = record?.payload.sections[v.source] as Record<string, unknown> | undefined;
    const stored = section && Object.prototype.hasOwnProperty.call(section, v.path) ? section[v.path] : undefined;
    const hasValue = stored !== undefined && stored !== null && stored !== "" && !(Array.isArray(stored) && stored.length === 0);
    const unconditional = !v.requiredWhen && v.required;
    const status: PreparationField["status"] = hasValue ? "ORG_REUSED" : unconditional ? "PENDING" : "OPTIONAL";
    if (unconditional) { policyTotal++; if (hasValue) policyFilled++; else policyPending++; }
    (fields[v.source] ??= []).push({
      ...describeVariable(v), hasValue, ...(hasValue ? { currentValue: stored, displayValue: stored } : {}),
      class: c.class, rule: c.rule, authority: c.authority, entry: c.entry, status, editable: true,
      ...(hasValue ? { origin: { label: "Perfil institucional do órgão", ref: { revision: record?.revision ?? 0 } } } : {}),
    });
  }
  const sections: PreparationSection[] = ORG_SOURCES.filter((s) => fields[s]?.length).map((source) => {
    const list = fields[source].slice().sort((a, b) => (a.name < b.name ? -1 : 1));
    return { source, scope: "ORG" as const, fields: list, pendingRequired: list.filter((f) => f.status === "PENDING").length };
  });

  // Papéis: todos os papéis conhecidos; "necessário" = usado por alguma variável do modelo.
  const roles: RoleView[] = ROLE_KEYS.map((role): RoleView => {
    const usedBy = catalog.vars.filter((v) => ROLE_VARIABLES[v.name]?.role === role).map((v) => ({ name: v.name, description: describeVariable(v).description }));
    const assignment = record?.payload.roles?.[role] ?? null;
    let state: RoleView["state"] = "MISSING"; let reason: string | undefined;
    if (assignment) {
      const probe = usedBy.map((u) => resolveRoleVariable(u.name, record!.payload.roles, asOf)).find((r): r is Exclude<typeof r, null | { state: "OK" }> => !!r && r.state !== "OK");
      if (probe) { state = probe.state === "STALE" ? "STALE" : "MISSING"; reason = probe.reason; } else state = "OK";
    } else if (usedBy.length) reason = `${ROLE_LABEL[role]} não designado`;
    return { role, label: ROLE_LABEL[role], assignment, state, ...(reason ? { reason } : {}), usedBy };
  });
  const needed = roles.filter((r) => r.usedBy.length > 0);

  // Padrões institucionais: variáveis ELEGÍVEIS do catálogo (por ação humana explícita).
  const rejected = new Map((record?.payload.defaultsRejected ?? []).map((r) => [r.name, r.reason] as const));
  const current = record?.payload.defaults ?? {};
  const eligible = catalog.vars.filter((v) => isDefaultEligible(v.name) && v.type !== "table" && v.type !== "document_ref");
  const defaults: DefaultView[] = eligible.map((v): DefaultView => {
    const d = describeVariable(v);
    const has = Object.prototype.hasOwnProperty.call(current, v.name);
    return { name: v.name, description: d.description, type: v.type, ...(v.enumValues ? { enumValues: v.enumValues } : {}), value: has ? current[v.name] : null, hasValue: has, ...(rejected.has(v.name) ? { incompatibleReason: rejected.get(v.name)! } : {}) };
  }).sort((a, b) => (a.name < b.name ? -1 : 1));

  const rolesOk = needed.filter((r) => r.state === "OK").length;
  const rolesPending = needed.length - rolesOk;
  return {
    status: "READY", catalogVersion: catalog.version, revision: record?.revision ?? 0, hash: record?.hash ?? null, asOf, sections, roles, defaults,
    summary: { policyTotal, policyFilled, policyPending, rolesNeeded: needed.length, rolesOk, rolesPending, pendingCount: policyPending + rolesPending },
  };
}

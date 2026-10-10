/**
 * CAMADA DE REUSO DE CONTEXTO do Edital (CONTEXT_REUSE 2.0). Fonte ÚNICA do que o sistema já sabe além das projeções canônicas:
 *
 *  - TR_PARAM    parâmetro estruturado do TR (fato `tr.param.<variável>` do Contexto Canônico; fonte `tr`, ator humano);
 *  - ORG_ROLE    papel institucional do Perfil de Licitações (nome/cargo/ato/vigência), projeção determinística por variável;
 *  - ORG_DEFAULT padrão institucional EXPLÍCITO (criado por ação humana) — só para variável elegível e valor válido.
 *
 * Usada pela composição (`canonicalSources`) e pela preparação (`editalPreparationService`): o que a tela mostra como "reaproveitado" é
 * exatamente o que o composer consome. Nada é inferido: sem dado ⇒ sem valor (a variável segue pendente, com a entrada correta).
 * Multi-tenant: tudo é lido por (organizationId[, processId]); nunca "último processo".
 */
import { listContextFacts } from "../../db/procurementContext";
import { getOfficialDocument } from "../../db/officialDocuments";
import type { VariableCatalog2 } from "../../domain/institutionalTemplates";
import {
  ROLE_LABEL, authorityEntryOf, isDefaultEligible, resolveRoleVariable, type RoleKey,
} from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import type { GovernedRecord } from "./governedFieldsStore";
import { TR_PARAMS_DIGEST_RE, resolveTrParams, trParamsDigest, type ResolvedTrParam } from "../../domain/trStructuredParams";
import { validateDefaults } from "../../domain/institutionalTemplates/governedSources";
import { templateHash } from "../../domain/institutionalTemplates/semanticHash";
import type { VariableDef2 } from "../../domain/institutionalTemplates/variableCatalog2";

export type ReuseKind = "TR_PARAM" | "ORG_ROLE" | "ORG_DEFAULT";

export interface ReusedValue {
  readonly kind: ReuseKind;
  readonly value: unknown;
  readonly origin: { readonly label: string; readonly ref: Readonly<Record<string, string | number>> };
}

export type ReuseProblemCode = "ROLE_MISSING" | "ROLE_STALE" | "DEFAULT_INCOMPATIBLE" | "TR_PARAM_INVALID" | "TR_PARAM_CONFLICT";
export interface ReuseProblem { readonly name: string; readonly kind: ReuseKind; readonly code: ReuseProblemCode; readonly reason: string; readonly role?: RoleKey }

export interface ContextReuse {
  readonly values: ReadonlyMap<string, ReusedValue>;
  readonly problems: ReadonlyMap<string, ReuseProblem>;
  /** Todos os parâmetros do TR do catálogo (inclusive UNSET) — base da seção do TR e da avaliação de condições. */
  readonly trParams: ReadonlyMap<string, ResolvedTrParam>;
  readonly trDigest: string;
  readonly orgProfile: { readonly revision: number; readonly hash: string } | null;
}

/** Variáveis do catálogo que o TR estruturado alimenta (entrada = seção de parâmetros do TR). */
export function trParamDefs(catalog: VariableCatalog2): VariableDef2[] {
  return catalog.vars.filter((v) => authorityEntryOf(v.name)?.entry === "TR_SECTION" && v.type !== "document_ref" && v.type !== "table");
}

export interface ReuseInputs {
  readonly catalog: VariableCatalog2;
  readonly orgRecord: GovernedRecord | null;
  readonly trAssertions: Parameters<typeof resolveTrParams>[1];
  /** Data (AAAA-MM-DD) de referência para vigência de papéis. */
  readonly asOf: string;
}

/** Puro: monta o reuso a partir dos registros já lidos. */
export function buildContextReuse(input: ReuseInputs): ContextReuse {
  const { catalog, orgRecord, asOf } = input;
  const values = new Map<string, ReusedValue>();
  const problems = new Map<string, ReuseProblem>();
  const profileRef = { revision: orgRecord?.revision ?? 0, hash: (orgRecord?.hash ?? "").slice(0, 12) };

  const trParams = resolveTrParams(trParamDefs(catalog), input.trAssertions);
  const rejectedDefaults = new Map((orgRecord?.payload.defaultsRejected ?? []).map((r) => [r.name, r.reason] as const));

  for (const v of catalog.vars) {
    const entry = authorityEntryOf(v.name);
    if (!entry) continue;

    // 1) papel institucional
    const role = resolveRoleVariable(v.name, orgRecord?.payload.roles, asOf);
    if (role) {
      if (role.state === "OK") {
        values.set(v.name, { kind: "ORG_ROLE", value: role.value, origin: { label: `Perfil de Licitações · ${ROLE_LABEL[role.role]}`, ref: { ...profileRef, role: role.role } } });
      } else {
        problems.set(v.name, { name: v.name, kind: "ORG_ROLE", code: role.state === "STALE" ? "ROLE_STALE" : "ROLE_MISSING", reason: role.reason, role: role.role });
      }
      continue;
    }

    // 2) parâmetro estruturado do TR
    const tp = trParams.get(v.name);
    if (tp) {
      if (tp.status === "SET") {
        values.set(v.name, {
          kind: "TR_PARAM", value: tp.value,
          origin: { label: "Parâmetros estruturados do TR", ref: { sourceId: tp.field.source?.id ?? "", sourceVersion: tp.field.source?.version ?? "", status: tp.field.status } },
        });
      } else if (tp.status === "INVALID") problems.set(v.name, { name: v.name, kind: "TR_PARAM", code: "TR_PARAM_INVALID", reason: tp.reason ?? "valor inválido" });
      else if (tp.status === "CONFLICT") problems.set(v.name, { name: v.name, kind: "TR_PARAM", code: "TR_PARAM_CONFLICT", reason: tp.reason ?? "conflito" });
      continue;
    }

    // 3) padrão institucional explícito (decisões do certame elegíveis)
    if (entry.cls === "TRUE_PROCESS_DECISION" && isDefaultEligible(v.name) && orgRecord?.payload.defaults && Object.prototype.hasOwnProperty.call(orgRecord.payload.defaults, v.name)) {
      values.set(v.name, { kind: "ORG_DEFAULT", value: orgRecord.payload.defaults[v.name], origin: { label: "Padrão institucional", ref: profileRef } });
    } else if (rejectedDefaults.has(v.name)) {
      problems.set(v.name, { name: v.name, kind: "ORG_DEFAULT", code: "DEFAULT_INCOMPATIBLE", reason: rejectedDefaults.get(v.name)! });
    }
  }

  return { values, problems, trParams, trDigest: trParamsDigest(trParams), orgProfile: orgRecord ? { revision: orgRecord.revision, hash: orgRecord.hash } : null };
}

/** Padrões institucionais ELEGÍVEIS para PROPOR no preenchimento dos parâmetros do TR (nunca aplicados sem confirmação humana). */
export function trParamProposals(catalog: VariableCatalog2, orgRecord: GovernedRecord | null): Map<string, { value: unknown; revision: number }> {
  const out = new Map<string, { value: unknown; revision: number }>();
  const defaults = orgRecord?.payload.defaults;
  if (!defaults) return out;
  const check = validateDefaults(catalog, defaults, "read");
  if (!check.ok) return out;
  for (const def of trParamDefs(catalog)) {
    if (isDefaultEligible(def.name) && Object.prototype.hasOwnProperty.call(check.value, def.name)) out.set(def.name, { value: check.value[def.name], revision: orgRecord!.revision });
  }
  return out;
}

/** Carrega o reuso: fatos do TR do PROCESSO (tenant-scoped) + registro do ÓRGÃO já lido. */
export async function loadContextReuse(p: {
  organizationId: number; processId: string; catalog: VariableCatalog2; orgRecord: GovernedRecord | null; asOf: string;
}): Promise<ContextReuse> {
  const facts = await listContextFacts(p.organizationId, p.processId);
  return buildContextReuse({ catalog: p.catalog, orgRecord: p.orgRecord, trAssertions: facts, asOf: p.asOf });
}

/** Define `value` no caminho pontuado sem sobrescrever o que já existe. Retorna se definiu. */
export function setNestedIfAbsent(data: Record<string, unknown>, path: string, value: unknown): boolean {
  const segs = path.split(".");
  let cur = data;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    if (next === undefined) cur[seg] = {};
    else if (typeof next !== "object" || next === null || Array.isArray(next)) return false;
    cur = cur[seg] as Record<string, unknown>;
  }
  const leaf = segs[segs.length - 1];
  if (Object.prototype.hasOwnProperty.call(cur, leaf)) return false;
  cur[leaf] = value;
  return true;
}

/**
 * Impressão digital do Perfil de Licitações (papéis + padrões), anexada ao snapshot da fonte POLICY: a identidade institucional
 * (papéis em IDENTITY) não tem chave própria no manifest, então SEM isto a troca de um ocupante só apareceria como
 * COMPOSITION_DRIFT. Com ela, qualquer mudança de papel/padrão entre o M1 e a emissão é SOURCE_CHANGED. `null` quando o órgão não
 * usa papéis nem padrões ⇒ o snapshot (e o digest de manifests anteriores) permanece EXATAMENTE igual.
 */
export function profileFingerprint(record: GovernedRecord | null): string | null {
  const roles = record?.raw.roles, defaults = record?.raw.defaults;
  if (!roles && !defaults) return null;
  return templateHash({ roles: roles ?? null, defaults: defaults ?? null });
}

// ─── Lineage dos parâmetros estruturados × TR oficial EXATO ─────────────────────────────────────────────────────────

export const TR_STRUCTURED_LINEAGE_UNAVAILABLE = "TR_STRUCTURED_LINEAGE_UNAVAILABLE";
export const TR_STRUCTURED_SOURCE_CHANGED = "TR_STRUCTURED_SOURCE_CHANGED";
export const TR_STRUCTURED_LINEAGE_MESSAGE = "O Termo de Referência oficial selecionado não corresponde aos parâmetros estruturados atuais. Revise/emita a versão correspondente do TR antes de prosseguir.";

/** Digest COMPLETO (SHA-256, 64 hex) do snapshot lógico ATUAL — o mesmo do marcador `trparams:` do TR. */
export const currentTrDigest = (reuse: Pick<ContextReuse, "trDigest">): string => reuse.trDigest;
export const hasStructuredTrParams = (reuse: Pick<ContextReuse, "trParams">): boolean => [...reuse.trParams.values()].some((p) => p.status === "SET");

/**
 * INVARIANTE: o TR oficial pinado e os parâmetros estruturados que o Edital consome pertencem ao MESMO snapshot lógico. O TR emitido
 * carrega o digest dos parâmetros que participaram da versão (`metadata.structuredParamsDigest`, vindo do marcador `trparams:` do
 * rascunho). Compara com o snapshot ATUAL; nunca atribui o estado corrente a um TR sem lineage.
 *  - null  ⇒ compatível (ou não aplicável: TR legado e nenhum parâmetro estruturado confirmado);
 *  - LINEAGE_UNAVAILABLE ⇒ há parâmetros confirmados, mas o TR não registra o snapshot (TR anterior à feature / importado / gerado antes);
 *  - SOURCE_CHANGED ⇒ o snapshot do TR difere do estado atual (parâmetros alterados depois daquela versão, ou limpos).
 */
export async function checkTrStructuredLineage(organizationId: number, trPin: { documentId: string }, reuse: Pick<ContextReuse, "trDigest" | "trParams">): Promise<typeof TR_STRUCTURED_LINEAGE_UNAVAILABLE | typeof TR_STRUCTURED_SOURCE_CHANGED | null> {
  const doc = await getOfficialDocument(trPin.documentId, organizationId);
  const raw = doc?.metadata?.["structuredParamsDigest"];
  const expected = typeof raw === "string" && TR_PARAMS_DIGEST_RE.test(raw) ? raw : null;
  const has = hasStructuredTrParams(reuse);
  if (!expected && !has) return null;
  if (!expected) return TR_STRUCTURED_LINEAGE_UNAVAILABLE;
  return expected === currentTrDigest(reuse) ? null : TR_STRUCTURED_SOURCE_CHANGED;
}

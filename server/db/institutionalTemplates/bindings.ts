/**
 * Institutional Templates — repositório de BINDINGS (T2).
 *
 * - O binding SEMPRE aponta para o id EXATO de uma revisão PUBLISHED da MESMA identidade: `pinned_revision_id` é NOT NULL e
 *   a FK composta (organização, identidade, revisão) garante, no banco, que a revisão é da identidade e da organização.
 *   Binding sem pin NÃO é armazenável (BINDING_REVISION_NOT_PINNED) — nunca "latest", nunca fuzzy, nunca IA.
 * - No máximo UM binding ATIVO por (organização, tipo, escopo): `uq_itb_active_scope` torna a ambiguidade estruturalmente
 *   impossível; a resolução do domínio continua fail-closed por defesa em profundidade.
 * - Bindings não são editados: desativa-se (`active` 1 → 0, com CAS) e cria-se outro.
 */
import { and, asc, eq } from "drizzle-orm";
import {
  institutionalTemplateBindingsTable, institutionalTemplateRevisionsTable, type InstitutionalTemplateBindingRow,
} from "../../../drizzle/schema";
import {
  TEMPLATE_DOCUMENT_KINDS, resolveTemplateBinding, sameScope, scopeIssues,
  type BindingRequest, type BindingResolution, type BindingScope, type TemplateBinding, type TemplateDocumentKind, type TemplateRevision,
} from "../../domain/institutionalTemplates";
import { TemplatePersistenceError } from "./errors";
import { recordTemplateEvent } from "./events";
import { affectedRows, duplicateKeyName, isDuplicateKey, requireReader, type TemplatesContext, type TemplatesReader, type TemplatesTx } from "./executor";
import { lockRevisionForShare, rowToRevision } from "./revisions";

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/**
 * Escopo → colunas ('' = não especificado). A validação (texto não vazio, sem '|', slug em forma/plataforma) é a MESMA do
 * domínio (`scopeIssues`): uma só regra, sem divergência entre resolução e persistência.
 */
function scopeColumns(scope: BindingScope): { modality: string; form: string; platform: string; regime: string; criterion: string } {
  const problems = scopeIssues(scope);
  if (problems.length) throw new TemplatePersistenceError("INVALID_INPUT", problems[0].message, problems);
  return {
    modality: scope.modality ?? "", form: scope.form ?? "", platform: scope.platform ?? "",
    regime: scope.regime ?? "", criterion: scope.criterion ?? "",
  };
}

export function rowToBinding(r: InstitutionalTemplateBindingRow): TemplateBinding {
  return {
    id: r.id, organizationId: r.organizationId, documentKind: r.documentKind as TemplateDocumentKind,
    scope: {
      ...(r.scopeModality ? { modality: r.scopeModality } : {}),
      ...(r.scopeForm ? { form: r.scopeForm } : {}),
      ...(r.scopePlatform ? { platform: r.scopePlatform } : {}),
      ...(r.scopeRegime ? { regime: r.scopeRegime } : {}),
      ...(r.scopeCriterion ? { criterion: r.scopeCriterion } : {}),
    },
    identityId: r.identityId, pinnedRevisionId: r.pinnedRevisionId, active: r.active === 1, effectiveFrom: r.effectiveFromIso,
  };
}

export async function getBinding(organizationId: number, id: string, executor?: TemplatesReader): Promise<TemplateBinding | null> {
  const db = await requireReader(executor);
  const rows = await db.select().from(institutionalTemplateBindingsTable).where(and(
    eq(institutionalTemplateBindingsTable.organizationId, organizationId), eq(institutionalTemplateBindingsTable.id, id))).limit(1);
  return rows.length === 1 && rows[0].id === id ? rowToBinding(rows[0]) : null;
}

export async function listBindings(
  organizationId: number, filter: { documentKind?: TemplateDocumentKind; activeOnly?: boolean } = {}, executor?: TemplatesReader,
): Promise<TemplateBinding[]> {
  const db = await requireReader(executor);
  const conds = [eq(institutionalTemplateBindingsTable.organizationId, organizationId)];
  if (filter.documentKind) conds.push(eq(institutionalTemplateBindingsTable.documentKind, filter.documentKind));
  if (filter.activeOnly) conds.push(eq(institutionalTemplateBindingsTable.active, 1));
  const rows = await db.select().from(institutionalTemplateBindingsTable).where(and(...conds)).orderBy(asc(institutionalTemplateBindingsTable.id));
  return rows.map(rowToBinding);
}

const sameBinding = (a: TemplateBinding, b: TemplateBinding): boolean =>
  a.documentKind === b.documentKind && a.identityId === b.identityId && a.pinnedRevisionId === b.pinnedRevisionId
  && a.effectiveFrom === b.effectiveFrom && sameScope(a.scope, b.scope);

export interface PersistedBinding { readonly binding: TemplateBinding; readonly created: boolean }

/** Cria um binding ATIVO. A revisão fixada é validada (tenant + identidade + PUBLISHED) na mesma transação. */
export async function insertBinding(tx: TemplatesTx, ctx: TemplatesContext, binding: TemplateBinding): Promise<PersistedBinding> {
  if (binding.organizationId !== ctx.organizationId) {
    throw new TemplatePersistenceError("CROSS_TENANT_REFERENCE", "o binding pertence a outra organização que o contexto autoritativo");
  }
  if (!binding.pinnedRevisionId) {
    throw new TemplatePersistenceError("BINDING_REVISION_NOT_PINNED", "binding sem revisão exata não é armazenável (nunca 'latest')");
  }
  if (!TEMPLATE_DOCUMENT_KINDS.includes(binding.documentKind)) throw new TemplatePersistenceError("INVALID_INPUT", "tipo documental fora do contrato");
  if (!binding.active) throw new TemplatePersistenceError("INVALID_INPUT", "um binding novo nasce ativo");
  if (!ISO_UTC_RE.test(binding.effectiveFrom)) throw new TemplatePersistenceError("INVALID_INPUT", "effectiveFrom deve ser ISO-8601 UTC");
  const scope = scopeColumns(binding.scope);

  const revision = await lockRevisionForShare(tx, ctx.organizationId, binding.pinnedRevisionId);
  if (!revision || revision.identityId !== binding.identityId) {
    throw new TemplatePersistenceError("REFERENCE_NOT_FOUND", "revisão fixada inexistente para a identidade neste tenant");
  }
  if (revision.status !== "PUBLISHED") {
    throw new TemplatePersistenceError("BINDING_REVISION_NOT_PUBLISHED", `a revisão fixada está ${revision.status}; só PUBLISHED pode ser vinculada`);
  }
  try {
    await tx.insert(institutionalTemplateBindingsTable).values({
      id: binding.id, organizationId: binding.organizationId, documentKind: binding.documentKind,
      scopeModality: scope.modality, scopeForm: scope.form, scopePlatform: scope.platform, scopeRegime: scope.regime, scopeCriterion: scope.criterion,
      identityId: binding.identityId, pinnedRevisionId: binding.pinnedRevisionId, active: 1, effectiveFromIso: binding.effectiveFrom,
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const key = duplicateKeyName(err);
    const existing = await getBindingLocked(tx, ctx.organizationId, binding.id);
    if (existing && sameBinding(existing, binding)) return { binding: existing, created: false };
    if (key === "uq_itb_active_scope") {
      throw new TemplatePersistenceError("BINDING_ACTIVE_SCOPE_TAKEN", "já existe um binding ATIVO para este tipo e escopo; desative-o antes");
    }
    throw new TemplatePersistenceError("CONFLICT", "o id do binding já existe com outro conteúdo");
  }
  await recordTemplateEvent(tx, ctx, {
    identityId: binding.identityId, bindingId: binding.id, eventType: "BINDING_CREATED", toStatus: "active",
  });
  const stored = await getBindingLocked(tx, ctx.organizationId, binding.id);
  if (!stored) throw new TemplatePersistenceError("PERSISTED_RECORD_CORRUPT", "binding não encontrado após a inserção");
  return { binding: stored, created: true };
}

async function getBindingLocked(tx: TemplatesTx, organizationId: number, id: string): Promise<TemplateBinding | null> {
  const rows = await tx.select().from(institutionalTemplateBindingsTable).where(and(
    eq(institutionalTemplateBindingsTable.organizationId, organizationId), eq(institutionalTemplateBindingsTable.id, id)))
    .limit(1).for("share");
  return rows.length === 1 && rows[0].id === id ? rowToBinding(rows[0]) : null;
}

/** Desativa (CAS 1 → 0). Replay converge: já inativo ⇒ `changed: false`. Nunca apaga nem reativa. */
export async function deactivateBinding(tx: TemplatesTx, ctx: TemplatesContext, bindingId: string): Promise<{ binding: TemplateBinding; changed: boolean }> {
  const result = await tx.update(institutionalTemplateBindingsTable).set({ active: 0 }).where(and(
    eq(institutionalTemplateBindingsTable.organizationId, ctx.organizationId),
    eq(institutionalTemplateBindingsTable.id, bindingId), eq(institutionalTemplateBindingsTable.active, 1)));
  const current = await getBindingLocked(tx, ctx.organizationId, bindingId);
  if (!current) throw new TemplatePersistenceError("NOT_FOUND", "binding inexistente neste tenant");
  const changed = affectedRows(result) === 1;
  if (changed) {
    await recordTemplateEvent(tx, ctx, { identityId: current.identityId, bindingId, eventType: "BINDING_DEACTIVATED", fromStatus: "active", toStatus: "inactive" });
  }
  return { binding: current, changed };
}

/** Entrada do resolvedor determinístico do domínio: bindings ATIVOS do tipo e as revisões fixadas por eles. */
export async function loadBindingResolutionInput(
  request: BindingRequest, executor?: TemplatesReader,
): Promise<{ bindings: TemplateBinding[]; revisions: TemplateRevision[] }> {
  const db = await requireReader(executor);
  const bindings = await listBindings(request.organizationId, { documentKind: request.documentKind, activeOnly: true }, db);
  const revisions: TemplateRevision[] = [];
  for (const b of bindings) {
    if (!b.pinnedRevisionId) continue;
    const rows = await db.select().from(institutionalTemplateRevisionsTable).where(and(
      eq(institutionalTemplateRevisionsTable.organizationId, request.organizationId),
      eq(institutionalTemplateRevisionsTable.id, b.pinnedRevisionId))).limit(1);
    if (rows.length === 1 && rows[0].id === b.pinnedRevisionId) revisions.push(rowToRevision(rows[0]));
  }
  return { bindings, revisions };
}

/** Resolve o binding vigente pelo resolvedor PURO do domínio (pin exato; ambíguo/ausente fail-closed). */
export async function resolveBinding(request: BindingRequest, executor?: TemplatesReader): Promise<BindingResolution> {
  const { bindings, revisions } = await loadBindingResolutionInput(request, executor);
  return resolveTemplateBinding(request, bindings, revisions);
}

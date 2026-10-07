/**
 * Institutional Templates — repositório de REVISÕES (T2).
 *
 * Contrato:
 *  - APPEND-ONLY: não existe DELETE de revisão (a FK RESTRICT também impede apagar revisão usada por binding/manifest);
 *  - lifecycle canônico DRAFT → APPROVED → PUBLISHED → DEPRECATED, um passo por vez, com CAS (`WHERE status = <atual>`);
 *    sem RETIRED, sem IN_REVIEW; APPROVED ≠ PUBLISHED: duas transições, duas decisões institucionais DISTINTAS;
 *  - o CONTEÚDO (AST, versão do catálogo, hash semântico) só muda em DRAFT: o UPDATE leva `status = 'DRAFT'` no WHERE, então
 *    uma revisão PUBLISHED nunca tem o conteúdo alterado em silêncio — mudança = nova revisão;
 *  - o hash semântico é SEMPRE recalculado a partir do AST persistido (escrita e leitura): divergência ⇒ falha fechada;
 *  - tenant-scoped em toda consulta; ids comparados byte a byte após a leitura (a colação é case-insensitive).
 */
import { and, asc, count, eq } from "drizzle-orm";
import {
  documentCompositionManifestsTable, institutionalTemplateBindingsTable, institutionalTemplateRevisionsTable,
  type InstitutionalTemplateRevisionRow,
} from "../../../drizzle/schema";
import {
  REVISION_STATUSES, TEMPLATE_HASH_VERSION, revisionSemanticHash, templateCanonicalJson,
  type AnyTemplateAST, type RevisionSourceFormat, type RevisionStatus, type TemplateRevision, type HashVersion,
} from "../../domain/institutionalTemplates";
import { TemplatePersistenceError } from "./errors";
import { assertDecisionInTenant } from "./existingParents";
import { recordTemplateEvent, type TemplateEventType } from "./events";
import { affectedRows, duplicateKeyName, isDuplicateKey, requireReader, type TemplatesContext, type TemplatesReader, type TemplatesTx } from "./executor";
import { requireIdentity } from "./identities";

const SOURCE_FORMATS: readonly RevisionSourceFormat[] = ["NATIVE", "MARKDOWN_IMPORT", "DOCX_IMPORT"];
const corrupt = (why: string) => new TemplatePersistenceError("PERSISTED_RECORD_CORRUPT", `revisão persistida inválida: ${why}`);

/** Linha → domínio, RECALCULANDO o hash semântico (nunca confia no valor gravado). */
export function rowToRevision(r: InstitutionalTemplateRevisionRow): TemplateRevision {
  if (!REVISION_STATUSES.includes(r.status as RevisionStatus)) throw corrupt(`estado fora do lifecycle (${r.status})`);
  if (r.hashVersion !== TEMPLATE_HASH_VERSION) throw corrupt(`versão de hash desconhecida (${r.hashVersion})`);
  if (!SOURCE_FORMATS.includes(r.sourceFormat as RevisionSourceFormat)) throw corrupt(`formato de origem desconhecido (${r.sourceFormat})`);
  let ast: AnyTemplateAST;
  try { ast = JSON.parse(r.astJson) as AnyTemplateAST; } catch { throw corrupt("AST ilegível"); }
  const revision: TemplateRevision = {
    id: r.id, identityId: r.identityId, organizationId: r.organizationId, revision: r.revision,
    status: r.status as RevisionStatus, ast, variableCatalogVersion: r.variableCatalogVersion,
    semanticHash: r.semanticHash, hashVersion: r.hashVersion as HashVersion, sourceFormat: r.sourceFormat as RevisionSourceFormat,
    ...(r.approvalDecisionId ? { approvalDecisionId: r.approvalDecisionId } : {}),
    ...(r.publishDecisionId ? { publishDecisionId: r.publishDecisionId } : {}),
  };
  if (revisionSemanticHash(revision) !== r.semanticHash) throw corrupt("o hash semântico não corresponde ao AST persistido");
  return revision;
}

export async function getRevision(organizationId: number, id: string, executor?: TemplatesReader): Promise<TemplateRevision | null> {
  const db = await requireReader(executor);
  const rows = await db.select().from(institutionalTemplateRevisionsTable).where(and(
    eq(institutionalTemplateRevisionsTable.organizationId, organizationId), eq(institutionalTemplateRevisionsTable.id, id))).limit(1);
  return rows.length === 1 && rows[0].id === id ? rowToRevision(rows[0]) : null;
}

export async function getRevisionByNumber(
  organizationId: number, identityId: string, revision: number, executor?: TemplatesReader,
): Promise<TemplateRevision | null> {
  const db = await requireReader(executor);
  const rows = await db.select().from(institutionalTemplateRevisionsTable).where(and(
    eq(institutionalTemplateRevisionsTable.organizationId, organizationId),
    eq(institutionalTemplateRevisionsTable.identityId, identityId),
    eq(institutionalTemplateRevisionsTable.revision, revision))).limit(1);
  return rows.length === 1 ? rowToRevision(rows[0]) : null;
}

export async function listRevisions(organizationId: number, identityId: string, executor?: TemplatesReader): Promise<TemplateRevision[]> {
  const db = await requireReader(executor);
  const rows = await db.select().from(institutionalTemplateRevisionsTable).where(and(
    eq(institutionalTemplateRevisionsTable.organizationId, organizationId), eq(institutionalTemplateRevisionsTable.identityId, identityId)))
    .orderBy(asc(institutionalTemplateRevisionsTable.revision));
  return rows.map(rowToRevision);
}

/** Leitura com lock compartilhado, dentro da transação da escrita que depende da revisão. */
export async function lockRevisionForShare(tx: TemplatesTx, organizationId: number, id: string): Promise<TemplateRevision | null> {
  const rows = await tx.select().from(institutionalTemplateRevisionsTable).where(and(
    eq(institutionalTemplateRevisionsTable.organizationId, organizationId), eq(institutionalTemplateRevisionsTable.id, id)))
    .limit(1).for("share");
  return rows.length === 1 && rows[0].id === id ? rowToRevision(rows[0]) : null;
}

/** Quantos bindings e manifests referenciam a revisão (insumo do `revisionDeletionIssues` do domínio). */
export async function countRevisionReferences(organizationId: number, revisionId: string, executor?: TemplatesReader): Promise<number> {
  const db = await requireReader(executor);
  const [b] = await db.select({ n: count() }).from(institutionalTemplateBindingsTable).where(and(
    eq(institutionalTemplateBindingsTable.organizationId, organizationId), eq(institutionalTemplateBindingsTable.pinnedRevisionId, revisionId)));
  const [m] = await db.select({ n: count() }).from(documentCompositionManifestsTable).where(and(
    eq(documentCompositionManifestsTable.organizationId, organizationId), eq(documentCompositionManifestsTable.templateRevisionId, revisionId)));
  return Number(b?.n ?? 0) + Number(m?.n ?? 0);
}

export interface PersistedRevision { readonly revision: TemplateRevision; readonly created: boolean }

/** Insere uma revisão NOVA, sempre em DRAFT. Replay idêntico converge; qualquer divergência é CONFLICT. */
export async function insertDraftRevision(tx: TemplatesTx, ctx: TemplatesContext, revision: TemplateRevision): Promise<PersistedRevision> {
  if (revision.organizationId !== ctx.organizationId) {
    throw new TemplatePersistenceError("CROSS_TENANT_REFERENCE", "a revisão pertence a outra organização que o contexto autoritativo");
  }
  if (revision.status !== "DRAFT" || revision.approvalDecisionId || revision.publishDecisionId) {
    throw new TemplatePersistenceError("INVALID_INPUT", "toda revisão nova nasce DRAFT, sem decisões registradas");
  }
  if (!Number.isSafeInteger(revision.revision) || revision.revision < 1) {
    throw new TemplatePersistenceError("INVALID_INPUT", "o número da revisão deve ser inteiro ≥ 1");
  }
  if (revision.hashVersion !== TEMPLATE_HASH_VERSION || revision.semanticHash !== revisionSemanticHash(revision)) {
    throw new TemplatePersistenceError("INVALID_INPUT", "o hash semântico informado não corresponde ao AST e ao catálogo");
  }
  await requireIdentity(tx, ctx.organizationId, revision.identityId);
  try {
    await tx.insert(institutionalTemplateRevisionsTable).values({
      id: revision.id, organizationId: revision.organizationId, identityId: revision.identityId, revision: revision.revision,
      status: "DRAFT", astJson: templateCanonicalJson(revision.ast), variableCatalogVersion: revision.variableCatalogVersion,
      semanticHash: revision.semanticHash, hashVersion: revision.hashVersion, sourceFormat: revision.sourceFormat,
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    const existing = await lockRevisionForShare(tx, ctx.organizationId, revision.id);
    if (existing && existing.identityId === revision.identityId && existing.revision === revision.revision
      && existing.semanticHash === revision.semanticHash && existing.variableCatalogVersion === revision.variableCatalogVersion
      && existing.sourceFormat === revision.sourceFormat) {
      return { revision: existing, created: false };
    }
    throw new TemplatePersistenceError("CONFLICT", duplicateKeyName(err) === "uq_itr_org_identity_rev"
      ? "o número desta revisão já está em uso para a identidade"
      : "o id da revisão já existe com outro conteúdo");
  }
  await recordTemplateEvent(tx, ctx, { identityId: revision.identityId, revisionId: revision.id, eventType: "REVISION_CREATED", toStatus: "DRAFT" });
  const stored = await lockRevisionForShare(tx, ctx.organizationId, revision.id);
  if (!stored) throw corrupt("revisão não encontrada após a inserção");
  return { revision: stored, created: true };
}

/**
 * Atualiza o CONTEÚDO de uma revisão — somente em DRAFT (o guard está no próprio UPDATE). O hash semântico é derivado aqui
 * (não é aceito do chamador). Em qualquer outro estado: REVISION_IMMUTABLE; mudança de conteúdo publicado = nova revisão.
 */
export async function updateDraftContent(
  tx: TemplatesTx, ctx: TemplatesContext, revisionId: string,
  content: { readonly ast: AnyTemplateAST; readonly variableCatalogVersion: string },
  /** CAS opcional: só atualiza se o hash semântico ainda for o que quem edita viu (outro editor ganhou ⇒ CONFLICT). */
  expectedSemanticHash?: string,
): Promise<TemplateRevision> {
  const semanticHash = revisionSemanticHash({ ast: content.ast, variableCatalogVersion: content.variableCatalogVersion });
  const result = await tx.update(institutionalTemplateRevisionsTable).set({
    astJson: templateCanonicalJson(content.ast), variableCatalogVersion: content.variableCatalogVersion, semanticHash,
    hashVersion: TEMPLATE_HASH_VERSION,
  }).where(and(
    eq(institutionalTemplateRevisionsTable.organizationId, ctx.organizationId),
    eq(institutionalTemplateRevisionsTable.id, revisionId),
    eq(institutionalTemplateRevisionsTable.status, "DRAFT"),
    ...(expectedSemanticHash !== undefined ? [eq(institutionalTemplateRevisionsTable.semanticHash, expectedSemanticHash)] : [])));
  if (affectedRows(result) === 0) {
    const current = await lockRevisionForShare(tx, ctx.organizationId, revisionId);
    if (!current) throw new TemplatePersistenceError("NOT_FOUND", "revisão inexistente neste tenant");
    if (current.status === "DRAFT") throw new TemplatePersistenceError("CONFLICT", "o rascunho foi alterado por outro editor; recarregue antes de salvar");
    throw new TemplatePersistenceError("REVISION_IMMUTABLE", `a revisão está ${current.status}; só DRAFT aceita alteração de conteúdo — crie uma nova revisão`);
  }
  const updated = await lockRevisionForShare(tx, ctx.organizationId, revisionId);
  if (!updated) throw corrupt("revisão não encontrada após a atualização");
  return updated;
}

export interface RevisionStepInput {
  readonly revisionId: string;
  readonly to: Exclude<RevisionStatus, "DRAFT">;
  /**
   * Obrigatória em APPROVED (decisão de aprovação) e PUBLISHED (decisão de publicação DISTINTA). Em DEPRECATED é
   * opcional na estrutura (a revisão não guarda FK de depreciação), mas, se informada, é validada (id + tenant) e fica
   * registrada no EVENTO da transição — a linhagem prova deterministicamente a decisão de depreciação.
   */
  readonly decisionId?: string;
}
export interface RevisionStepResult { readonly revision: TemplateRevision; readonly changed: boolean }

const EVENT_FOR: Record<RevisionStepInput["to"], TemplateEventType> = {
  APPROVED: "REVISION_APPROVED", PUBLISHED: "REVISION_PUBLISHED", DEPRECATED: "REVISION_DEPRECATED",
};

/**
 * Um passo do lifecycle, com CAS. Replay do mesmo passo (mesma decisão) converge sem alterar nada (`changed: false`).
 * As decisões referenciadas são validadas (id + tenant) na MESMA transação — HD-26. A validação de conteúdo da revisão
 * (AST, catálogo) é do domínio (`transitionRevision`) e acontece ANTES, no serviço.
 */
export async function transitionRevisionStatus(tx: TemplatesTx, ctx: TemplatesContext, step: RevisionStepInput): Promise<RevisionStepResult> {
  const rows = await tx.select().from(institutionalTemplateRevisionsTable).where(and(
    eq(institutionalTemplateRevisionsTable.organizationId, ctx.organizationId), eq(institutionalTemplateRevisionsTable.id, step.revisionId)))
    .limit(1).for("update");
  if (rows.length !== 1 || rows[0].id !== step.revisionId) throw new TemplatePersistenceError("NOT_FOUND", "revisão inexistente neste tenant");
  const current = rowToRevision(rows[0]);

  const sameDecision = step.to === "APPROVED" ? current.approvalDecisionId === step.decisionId
    : step.to === "PUBLISHED" ? current.publishDecisionId === step.decisionId : true;
  if (current.status === step.to) {
    if (sameDecision) return { revision: current, changed: false }; // replay do mesmo passo
    throw new TemplatePersistenceError("CONFLICT", `a revisão já está ${step.to} com outra decisão`);
  }
  const from = REVISION_STATUSES.indexOf(current.status);
  const to = REVISION_STATUSES.indexOf(step.to);
  if (to !== from + 1) {
    throw new TemplatePersistenceError("REVISION_TRANSITION_INVALID", `transição ${current.status} → ${step.to} não permitida (um passo por vez; APPROVED ≠ PUBLISHED)`);
  }
  if (step.to !== "DEPRECATED") {
    if (!step.decisionId) throw new TemplatePersistenceError("INVALID_INPUT", `${step.to} exige a decisão institucional correspondente`);
    if (step.to === "PUBLISHED" && step.decisionId === current.approvalDecisionId) {
      throw new TemplatePersistenceError("INVALID_INPUT", "a publicação exige decisão própria, distinta da de aprovação (APPROVED ≠ PUBLISHED)");
    }
    await assertDecisionInTenant(tx, ctx.organizationId, step.decisionId);
  } else if (step.decisionId) {
    await assertDecisionInTenant(tx, ctx.organizationId, step.decisionId);
  }
  const result = await tx.update(institutionalTemplateRevisionsTable).set({
    status: step.to,
    ...(step.to === "APPROVED" ? { approvalDecisionId: step.decisionId } : {}),
    ...(step.to === "PUBLISHED" ? { publishDecisionId: step.decisionId } : {}),
  }).where(and(
    eq(institutionalTemplateRevisionsTable.organizationId, ctx.organizationId),
    eq(institutionalTemplateRevisionsTable.id, step.revisionId),
    eq(institutionalTemplateRevisionsTable.status, current.status)));
  if (affectedRows(result) !== 1) throw new TemplatePersistenceError("CONFLICT", "a revisão mudou concorrentemente; recarregue e repita");
  await recordTemplateEvent(tx, ctx, {
    identityId: current.identityId, revisionId: current.id, eventType: EVENT_FOR[step.to],
    fromStatus: current.status, toStatus: step.to, decisionId: step.decisionId ?? null,
  });
  const updated = await lockRevisionForShare(tx, ctx.organizationId, step.revisionId);
  if (!updated) throw corrupt("revisão não encontrada após a transição");
  return { revision: updated, changed: true };
}

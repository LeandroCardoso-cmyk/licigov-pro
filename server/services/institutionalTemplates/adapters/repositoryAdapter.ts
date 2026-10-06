/**
 * Adapter REAL do `TemplateRepositoryPort` sobre a persistência da Lane A (`server/db/institutionalTemplates/**`).
 * Não duplica repositório: só traduz o contrato do workflow, abre a transação (retry SEM-084) e traduz erros.
 *
 * `commitLifecycleTransition` — decisão institucional + transição da revisão + evento do modelo, na MESMA transação:
 *   1. lock da linha-pai da revisão (`lockDecisionSubject`, extensão do mecanismo existente — não há segundo ledger/lock);
 *   2. replay pela chave de idempotência (mesma chave + mesmo pedido ⇒ decisão já gravada; outro pedido ⇒ conflito);
 *   3. CAS no estado esperado (`STALE_STATUS` sem escrita);
 *   4. INSERT da decisão (ledger append-only) + `transitionRevisionStatus` (CAS + evento) — qualquer falha ⇒ ROLLBACK TOTAL.
 */
import {
  deactivateBinding, getBinding, getIdentity, getRevision, insertBinding, insertDraftRevision, insertIdentity, listBindings,
  listIdentities, listRevisions, countRevisionReferences, findIdentityBySlug, transitionRevisionStatus, updateDraftContent,
  withTemplatesTransaction, TemplatePersistenceError, type TemplatesContext,
} from "../../../db/institutionalTemplates";
import { DecisionWriteRaceError, getDecisionByIdempotencyKey, insertDecision, lockDecisionSubject } from "../../../db/institutionalDecisions";
import {
  DuplicateTemplateIdentityError, DuplicateTemplateRevisionError,
  type LifecycleCommit, type LifecycleCommitResult, type PersistenceContext, type TemplateRepositoryPort,
} from "../ports";
import { getDb } from "../../../db/connection";
import { translating, translatePersistenceError } from "./errors";

const tctx = (organizationId: number, p: PersistenceContext): TemplatesContext => ({ organizationId, actorUserId: p.actorUserId, correlationId: p.correlationId });

export function createTemplateRepositoryAdapter(): TemplateRepositoryPort {
  return {
    listIdentities: (org, filter) => translating(() => listIdentities(org, filter.documentKind)),
    getIdentity: (org, id) => translating(() => getIdentity(org, id)),
    findIdentityBySlug: (org, kind, slug) => translating(() => findIdentityBySlug(org, kind, slug)),
    async insertIdentity(identity, p) {
      const ctx = tctx(identity.organizationId, p);
      try {
        await withTemplatesTransaction("template.identity.insert", ctx, (tx) => insertIdentity(tx, ctx, identity));
      } catch (err) {
        if (err instanceof TemplatePersistenceError && err.code === "CONFLICT") throw new DuplicateTemplateIdentityError();
        return translatePersistenceError(err);
      }
    },

    listRevisions: (org, identityId) => translating(() => listRevisions(org, identityId)),
    getRevision: (org, id) => translating(() => getRevision(org, id)),
    async insertDraftRevision(revision, p) {
      const ctx = tctx(revision.organizationId, p);
      try {
        await withTemplatesTransaction("template.revision.insert", ctx, (tx) => insertDraftRevision(tx, ctx, revision));
      } catch (err) {
        if (err instanceof TemplatePersistenceError && err.code === "CONFLICT") throw new DuplicateTemplateRevisionError();
        return translatePersistenceError(err);
      }
    },
    async updateDraftContent(org, before, after, p) {
      const ctx = tctx(org, p);
      try {
        await withTemplatesTransaction("template.revision.update", ctx, (tx) =>
          updateDraftContent(tx, ctx, before.id, { ast: after.ast, variableCatalogVersion: after.variableCatalogVersion }, before.semanticHash));
        return true;
      } catch (err) {
        if (err instanceof TemplatePersistenceError && (err.code === "CONFLICT" || err.code === "REVISION_IMMUTABLE")) return false;
        return translatePersistenceError(err);
      }
    },
    commitLifecycleTransition: (commit) => commitLifecycle(commit),
    getDecisionByIdempotencyKey: async (org, key) => {
      const db = await getDb();
      if (!db) throw new TemplatePersistenceError("DB_UNAVAILABLE", "banco indisponível");
      return getDecisionByIdempotencyKey(db, org, key.trim());
    },
    countManifestReferences: (org, revisionId) => translating(() => countRevisionReferences(org, revisionId)),

    listBindings: (org, filter) => translating(() => listBindings(org, filter)),
    getBinding: (org, id) => translating(() => getBinding(org, id)),
    async insertBinding(binding, p, replacesBindingId) {
      const ctx = tctx(binding.organizationId, p);
      try {
        await withTemplatesTransaction("template.binding.insert", ctx, async (tx) => {
          if (replacesBindingId !== undefined) await deactivateBinding(tx, ctx, replacesBindingId); // MESMA transação
          await insertBinding(tx, ctx, binding);
        });
      } catch (err) { return translatePersistenceError(err); }
    },
    async deactivateBinding(org, bindingId, p) {
      const ctx = tctx(org, p);
      try {
        const r = await withTemplatesTransaction("template.binding.deactivate", ctx, (tx) => deactivateBinding(tx, ctx, bindingId));
        return r.changed;
      } catch (err) {
        if (err instanceof TemplatePersistenceError && err.code === "NOT_FOUND") return false;
        return translatePersistenceError(err);
      }
    },
  };
}

async function commitLifecycle(c: LifecycleCommit): Promise<LifecycleCommitResult> {
  const ctx: TemplatesContext = { organizationId: c.organizationId, actorUserId: c.actorUserId, correlationId: c.correlationId };
  const d = c.decision;
  if (d.organizationId !== c.organizationId || d.subjectId !== c.before.id || c.before.organizationId !== c.organizationId || c.after.id !== c.before.id) {
    throw new TemplatePersistenceError("CROSS_TENANT_REFERENCE", "decisão/revisão não correspondem ao contexto autoritativo");
  }
  const to = c.after.status;
  if (to !== "APPROVED" && to !== "PUBLISHED" && to !== "DEPRECATED") {
    throw new TemplatePersistenceError("REVISION_TRANSITION_INVALID", "o destino do ciclo de vida deve ser APPROVED, PUBLISHED ou DEPRECATED");
  }
  try {
    return await withTemplatesTransaction("template.lifecycle", ctx, async (tx): Promise<LifecycleCommitResult> => {
      const exists = await lockDecisionSubject(tx, c.organizationId, d.subjectType, d.subjectId);
      if (!exists) throw new TemplatePersistenceError("NOT_FOUND", "revisão inexistente neste tenant");

      const byKey = await getDecisionByIdempotencyKey(tx, c.organizationId, d.idempotencyKey);
      if (byKey) {
        return byKey.requestHash === d.requestHash && byKey.subjectId === d.subjectId && byKey.subjectType === d.subjectType
          ? { status: "REPLAYED", decision: byKey }
          : { status: "DECISION_IDEMPOTENCY_CONFLICT" };
      }
      const current = await getRevision(c.organizationId, c.before.id, tx);
      if (!current) throw new TemplatePersistenceError("NOT_FOUND", "revisão inexistente neste tenant");
      if (current.status !== c.expectedStatus) return { status: "STALE_STATUS", currentStatus: current.status };

      await insertDecision(tx, d);   // append-only; colisão de revisão da decisão ⇒ DecisionWriteRaceError (rollback)
      await transitionRevisionStatus(tx, ctx, { revisionId: c.before.id, to, decisionId: d.id });
      return { status: "COMMITTED", decision: d };
    });
  } catch (err) {
    if (err instanceof DecisionWriteRaceError) {
      // outra transação gravou a mesma revisão da decisão: o estado mudou — nada ficou gravado nesta (rollback)
      const current = await getRevision(c.organizationId, c.before.id);
      return { status: "STALE_STATUS", currentStatus: current?.status ?? c.expectedStatus };
    }
    return translatePersistenceError(err);
  }
}

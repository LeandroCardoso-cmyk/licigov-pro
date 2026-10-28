/**
 * Adapter REAL do `TemplateDraftPort` sobre o rascunho canônico (`generated_documents`) e sua mutação governada
 * (`applyDraftContentMutationTx`: lock, ledger append-only de edições, autoria preservada).
 *
 * Regras:
 *  - id determinístico por (organização, processo, tipo): repetir o comando não cria segundo rascunho;
 *  - NUNCA sobrescreve um rascunho existente com conteúdo diferente (a edição humana não é perdida): falha fechada;
 *    conteúdo idêntico ⇒ no-op (replay) — com OUTRO M1 (ex.: novo pin oficial; a referência institucional não carrega id/hash, então o
 *    texto pode não mudar) só o vínculo `tpl-m1:` é atualizado, com a MESMA trava de documento oficial da recomposição; a ÚNICA exceção é a RECOMPOSIÇÃO governada (`draft.replace`): hash esperado sob lock,
 *    sem documento aprovado/oficial, sem edição humana (ou `confirmReplace`), com o conteúdo anterior preservado no ledger;
 *  - só documentos de processo licitatório (dfd/etp/tr/edital); outros tipos ⇒ falha fechada (sem backing).
 */
import { createHash } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { generatedDocumentEditsTable, generatedDocumentsTable } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import { applyDraftContentMutationTx, recordProcessEvent, type ProcurementExecutor } from "../../../db/procurement";
import { TemplatePersistenceError } from "../../../db/institutionalTemplates";
import { toDbDatetime } from "../../../db/institutionalConsultations";
import { draftContentHash, type DocumentKind, type GeneratedDocument } from "../../../domain/generatedDocument";
import { classifyTemplateDraftHumanState, humanEditRefusalMessage, officialRegenerationBlock, officialRegenerationRefusalMessage } from "../../../domain/draftRegeneration";
import { getLatestOfficialPromotion, type PromotionExecutor } from "../../../db/officialDocumentPromotions";
import type { TemplateDraftPort } from "../ports";

const KINDS: readonly string[] = ["dfd", "etp", "tr", "edital"];

function assertKind(documentType: string): DocumentKind {
  if (!KINDS.includes(documentType)) {
    throw new TemplatePersistenceError("INVALID_INPUT", `composição por modelo não tem rascunho canônico para o tipo ${documentType} (sem backing — falha fechada)`);
  }
  return documentType as DocumentKind;
}

export const templateDraftId = (organizationId: number, processId: string, kind: string): string =>
  `gd${createHash("sha256").update(`tpl-draft:${organizationId}:${processId}:${kind}`).digest("hex").slice(0, 18)}`;

export function createTemplateDraftAdapter(): TemplateDraftPort {
  return {
    async reserveDraftId(organizationId, subjectId, documentType) {
      const kind = assertKind(documentType);
      const db = await getDb();
      if (!db) throw new TemplatePersistenceError("DB_UNAVAILABLE", "banco indisponível");
      const rows = await db.select({ id: generatedDocumentsTable.id }).from(generatedDocumentsTable).where(and(
        eq(generatedDocumentsTable.organizationId, organizationId), eq(generatedDocumentsTable.processId, subjectId), eq(generatedDocumentsTable.kind, kind))).limit(1);
      return rows.length === 1 ? rows[0].id : templateDraftId(organizationId, subjectId, kind);
    },

    async writeDraft(draft, executor) {
      const kind = assertKind(draft.documentType);
      const tx = executor as unknown as ProcurementExecutor;
      const rows = await tx.select().from(generatedDocumentsTable).where(and(
        eq(generatedDocumentsTable.organizationId, draft.organizationId), eq(generatedDocumentsTable.processId, draft.subjectId), eq(generatedDocumentsTable.kind, kind)))
        .limit(1).for("update");
      if (rows.length === 1) {
        const existing = rows[0];
        if (existing.id === draft.id && draftContentHash(existing.content ?? "") === draftContentHash(draft.content)) {
          await relinkIdenticalDraft(tx, existing, draft, kind);   // replay (mesmo M1) ou só o vínculo do M1 novo
          return;
        }
        if (!draft.replace) {
          throw new TemplatePersistenceError("CONFLICT", "já existe rascunho para este processo e tipo com outro conteúdo; descarte-o (reset governado) antes de compor por modelo — nada foi sobrescrito");
        }
        await recomposeExisting(tx, existing, draft, kind);
        return;
      }
      const now = new Date().toISOString();
      const doc: GeneratedDocument = {
        id: draft.id, processId: draft.subjectId, organizationId: draft.organizationId, kind, title: draft.title, content: draft.content,
        status: "rascunho", sources: ["origem:template", `tpl-m1:${draft.generationManifestId}`], modality: null, form: null, platform: null,
        legalJustification: "", judgmentCriterion: null, executionRegime: null, authorUserId: draft.actorUserId,
        lastSubstantiveActorUserId: draft.actorUserId, lastSubstantiveAt: now, correlationId: draft.correlationId, createdAt: now, updatedAt: now,
      };
      await applyDraftContentMutationTx(tx, {
        organizationId: draft.organizationId, processId: draft.subjectId, kind, actorUserId: draft.actorUserId, doc, operation: "template_compose",
        expectedState: { type: "absent" }, idempotencyKey: `tplc_${draft.generationManifestId}`.slice(0, 64), correlationId: draft.correlationId,
        reason: `Composição governada por modelo institucional (${draft.generationManifestId}).`, ledgerOnCreate: true,
      });
    },
  };
}

/**
 * Texto IDÊNTICO ao do rascunho `origem:template` existente (já bloqueado FOR UPDATE). Mesmo M1 ⇒ replay puro. OUTRO M1 (fontes/pins
 * mudaram sem mudar o texto composto) ⇒ o conteúdo não muda: o vínculo `tpl-m1:` passa a apontar o M1 vigente, sem mudar autoria nem
 * último ator substantivo. NÃO é silencioso: `updatedAt`/`correlationId` mudam (a revisão confirmada antes deixa de valer — o revisor
 * revê a minuta, agora ligada a outras fontes/referências oficiais) e um evento de processo registra a troca, na MESMA transação.
 * Documento com versão OFICIAL emitida nunca é revinculado (mesma recusa da recomposição): sem isso, um novo M1 geraria uma versão
 * `gerado` depois da emissão.
 */
async function relinkIdenticalDraft(
  tx: ProcurementExecutor, existing: typeof generatedDocumentsTable.$inferSelect,
  draft: Parameters<TemplateDraftPort["writeDraft"]>[0], kind: DocumentKind,
): Promise<void> {
  const sources = parseSources(existing.sources);
  const link = `tpl-m1:${draft.generationManifestId}`;
  if (!sources.includes("origem:template") || sources.includes(link)) return;
  const block = officialRegenerationBlock(existing, await getLatestOfficialPromotion(draft.organizationId, draft.subjectId, kind, tx as unknown as PromotionExecutor));
  if (block) throw new TRPCError({ code: "PRECONDITION_FAILED", message: officialRegenerationRefusalMessage(kind as "etp" | "tr" | "edital", block) });
  const previous = sources.find((x) => x.startsWith("tpl-m1:"))?.slice("tpl-m1:".length) ?? "—";
  await tx.update(generatedDocumentsTable).set({
    sources: JSON.stringify([...sources.filter((x) => !x.startsWith("tpl-m1:")), link]),
    correlationId: draft.correlationId, updatedAt: toDbDatetime(new Date().toISOString()) ?? undefined,
  }).where(and(eq(generatedDocumentsTable.id, existing.id), eq(generatedDocumentsTable.organizationId, draft.organizationId)));
  await recordProcessEvent({
    organizationId: draft.organizationId, processId: draft.subjectId, eventType: "change", actor: String(draft.actorUserId),
    summary: `Minuta ${kind.toUpperCase()} recomposta pelo modelo com texto idêntico; passa a se apoiar na composição vigente (${previous} → ${draft.generationManifestId}): fontes ou documentos oficiais referenciados mudaram — revise antes de emitir.`,
    refId: existing.id, correlationId: draft.correlationId, idempotencyKey: `tpl-relink:${draft.generationManifestId}`,
  }, tx);
}

/** RECOMPOSIÇÃO governada do rascunho `origem:template` existente (já bloqueado FOR UPDATE pelo chamador). */
async function recomposeExisting(
  tx: ProcurementExecutor, existing: typeof generatedDocumentsTable.$inferSelect,
  draft: Parameters<TemplateDraftPort["writeDraft"]>[0], kind: DocumentKind,
): Promise<void> {
  const replace = draft.replace!;
  const sources = parseSources(existing.sources);
  if (!sources.includes("origem:template")) {
    throw new TemplatePersistenceError("CONFLICT", "só um rascunho composto por modelo pode ser recomposto; este rascunho tem outra origem — nada foi sobrescrito");
  }
  const kindLabel = kind as "etp" | "tr" | "edital";
  // documento aprovado ou com versão OFICIAL emitida: nunca recomposto (novo ciclo de versão governado)
  const block = officialRegenerationBlock(existing, await getLatestOfficialPromotion(draft.organizationId, draft.subjectId, kind, tx as unknown as PromotionExecutor));
  if (block) throw new TRPCError({ code: "PRECONDITION_FAILED", message: officialRegenerationRefusalMessage(kindLabel, block) });
  const content = existing.content ?? "";
  if (draftContentHash(content) !== replace.expectedContentHash) {
    throw new TRPCError({ code: "CONFLICT", message: "O rascunho mudou desde o carregamento — recarregue e revise antes de recompor." });
  }
  const last = (await tx.select({
    operation: generatedDocumentEditsTable.operation, actorUserId: generatedDocumentEditsTable.actorUserId,
    newContentHash: generatedDocumentEditsTable.newContentHash, createdAt: generatedDocumentEditsTable.createdAt,
  }).from(generatedDocumentEditsTable).where(and(
    eq(generatedDocumentEditsTable.organizationId, draft.organizationId), eq(generatedDocumentEditsTable.processId, draft.subjectId), eq(generatedDocumentEditsTable.kind, kind)))
    .orderBy(desc(generatedDocumentEditsTable.id)).limit(1))[0];
  const refusal = humanEditRefusalMessage(kindLabel, classifyTemplateDraftHumanState({ content, sources }, last ? { ...last, createdAt: String(last.createdAt) } : null), replace.confirmReplace);
  if (refusal) throw new TRPCError({ code: "CONFLICT", message: refusal });
  const now = new Date().toISOString();
  const doc: GeneratedDocument = {
    id: existing.id, processId: draft.subjectId, organizationId: draft.organizationId, kind, title: draft.title, content: draft.content,
    status: "rascunho", sources: ["origem:template", `tpl-m1:${draft.generationManifestId}`],
    modality: (existing.modality ?? null) as GeneratedDocument["modality"], form: (existing.form ?? null) as GeneratedDocument["form"],
    platform: (existing.platform ?? null) as GeneratedDocument["platform"], legalJustification: existing.legalJustification ?? "",
    judgmentCriterion: existing.judgmentCriterion ?? null, executionRegime: existing.executionRegime ?? null,
    authorUserId: existing.authorUserId ?? null, lastSubstantiveActorUserId: draft.actorUserId, lastSubstantiveAt: now,
    correlationId: draft.correlationId, createdAt: String(existing.createdAt), updatedAt: now,
  };
  await applyDraftContentMutationTx(tx, {
    organizationId: draft.organizationId, processId: draft.subjectId, kind, actorUserId: draft.actorUserId, doc, operation: "template_compose",
    expectedState: { type: "present", contentHash: replace.expectedContentHash }, idempotencyKey: `tplc_${draft.generationManifestId}`.slice(0, 64),
    correlationId: draft.correlationId, reason: `Recomposição governada por modelo institucional (${draft.generationManifestId}); o conteúdo anterior permanece no histórico.`,
  });
}

function parseSources(raw: string | null): string[] {
  try { const v = JSON.parse(raw ?? "[]"); return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
}

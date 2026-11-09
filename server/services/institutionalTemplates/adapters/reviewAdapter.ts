/**
 * Adapter REAL do `TemplateReviewPort`.
 *  - saídas de IA: `ai_orchestrations.outputs.templateNarrative = { slotKey, text }` da execução (tenant-scoped, por
 *    `executionId`). Forma inesperada ⇒ a saída é tratada como AUSENTE (a emissão bloqueia; nada é inferido);
 *  - aceites, reconhecimentos de desvio e resoluções de slot (E2): decisões institucionais humanas (ledger existente) — ver `reviewService`
 *    e `slotResolutionService`. Evidência fora do formato ⇒ o registro é IGNORADO (a revalidação trata o slot como pendente);
 *  - edições humanas: ledger append-only `generated_document_edits` (`operation = human_edit`), encadeado por hash a
 *    partir do texto composto. Operações não humanas (regeneração, importação) quebram a cadeia — a revalidação recusa.
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { aiOrchestrationsTable, generatedDocumentEditsTable } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import { listDecisionsBySubjectPrefix } from "../../../db/institutionalDecisions";
import { TemplatePersistenceError } from "../../../db/institutionalTemplates";
import type { AiNarrativeAcceptance, HumanEditLink, StructuralDeviationAcknowledgment, StructuralDeviationKind } from "../../../domain/institutionalTemplates/revalidation";
import type { AiNarrativeOutput } from "../../../domain/institutionalTemplates/composer";
import { SLOT_RESOLUTION_TYPES, type SlotResolutionRecord, type SlotResolutionType } from "../../../domain/institutionalTemplates/slotResolution";
import type { TemplateReviewPort } from "../ports";
import { AI_ACCEPTANCE_SUBJECT, DEVIATION_ACK_SUBJECT } from "../reviewService";
import { SLOT_RESOLUTION_SUBJECT, slotResolutionSubjectId } from "../slotResolutionSubject";

const tag = (evidence: readonly string[], name: string): string | null => {
  const hit = evidence.find((e) => e.startsWith(`${name}:`));
  return hit ? hit.slice(name.length + 1) : null;
};
/** Âncora gravada como string JSON (preserva espaços/quebras de linha nas bordas, que o ledger normalizaria). */
const jsonString = (raw: string | null): string | null => {
  if (raw === null) return null;
  try { const v: unknown = JSON.parse(raw); return typeof v === "string" ? v : null; } catch { return null; }
};
const asObject = (v: unknown): Record<string, unknown> | null => {
  let x = v;
  if (typeof x === "string") { try { x = JSON.parse(x); } catch { return null; } }
  return typeof x === "object" && x !== null && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
};

export function createTemplateReviewAdapter(): TemplateReviewPort {
  return {
    async loadAiOutputs(organizationId, executionIds) {
      if (executionIds.length === 0) return [];
      const db = await getDb();
      if (!db) throw new TemplatePersistenceError("DB_UNAVAILABLE", "banco indisponível");
      const rows = await db.select({ id: aiOrchestrationsTable.id, outputs: aiOrchestrationsTable.outputs }).from(aiOrchestrationsTable)
        .where(and(eq(aiOrchestrationsTable.organizationId, organizationId), inArray(aiOrchestrationsTable.id, [...executionIds])));
      const out: AiNarrativeOutput[] = [];
      for (const r of rows) {
        const narrative = asObject(asObject(r.outputs)?.templateNarrative);
        if (narrative && typeof narrative.slotKey === "string" && typeof narrative.text === "string") {
          out.push({ organizationId, slotKey: narrative.slotKey, executionId: r.id, text: narrative.text });
        }
      }
      return out;
    },

    async listAiAcceptances(organizationId, generationManifestId) {
      const decisions = await listDecisionsBySubjectPrefix(organizationId, AI_ACCEPTANCE_SUBJECT, `${generationManifestId}:`);
      const out: AiNarrativeAcceptance[] = [];
      for (const d of decisions) {
        const slotKey = tag(d.evidence, "slot"), executionId = tag(d.evidence, "execution"), outputHash = tag(d.evidence, "output");
        if (d.outcome !== "aceito" || !slotKey || !executionId || !outputHash) continue;
        out.push({ organizationId, manifestId: generationManifestId, slotKey, executionId, outputHash, acceptedByUserId: d.recordedByUserId });
      }
      return out;
    },

    async listDeviationAcknowledgments(organizationId, generationManifestId) {
      const decisions = await listDecisionsBySubjectPrefix(organizationId, DEVIATION_ACK_SUBJECT, `${generationManifestId}:`);
      const out: StructuralDeviationAcknowledgment[] = [];
      for (const d of decisions) {
        const blockId = tag(d.evidence, "block"), kind = tag(d.evidence, "kind");
        if (d.outcome !== "reconhecido" || !blockId || (kind !== "INCLUDED_BLOCK_REMOVED" && kind !== "EXCLUDED_BLOCK_INSERTED")) continue;
        out.push({ blockId, kind: kind as StructuralDeviationKind, acknowledgmentRef: d.id });
      }
      return out;
    },

    async listSlotResolutions(organizationId, generationManifestId) {
      const decisions = await listDecisionsBySubjectPrefix(organizationId, SLOT_RESOLUTION_SUBJECT, `${generationManifestId}:`);
      const out: SlotResolutionRecord[] = [];
      for (const d of decisions) {
        const slotKey = tag(d.evidence, "slot"), type = tag(d.evidence, "type"), textHash = tag(d.evidence, "text"), policyVersion = tag(d.evidence, "policy");
        const prefix = jsonString(tag(d.evidence, "prefix")), suffix = jsonString(tag(d.evidence, "suffix"));
        if (d.decisionType !== "template_slot_resolution" || !slotKey || !type || d.outcome !== type || !(SLOT_RESOLUTION_TYPES as readonly string[]).includes(type)) continue;
        if (!textHash || prefix === null || suffix === null || !policyVersion) continue;
        // O assunto precisa ser EXATAMENTE o do slot declarado na evidência (evidência de um slot não vale para outro).
        if (d.subjectId !== slotResolutionSubjectId(generationManifestId, slotKey)) continue;
        out.push({
          organizationId, manifestId: generationManifestId, slotKey, resolution: type as SlotResolutionType, textHash, prefix, suffix, policyVersion,
          decisionRef: d.id, revision: d.revision, resolvedByUserId: d.recordedByUserId, resolvedByName: d.decidedByName, decidedAt: d.decidedAt,
        });
      }
      return out;
    },

    async listHumanEdits(organizationId, generatedDocumentId, fromContentHash) {
      const db = await getDb();
      if (!db) throw new TemplatePersistenceError("DB_UNAVAILABLE", "banco indisponível");
      const rows = await db.select().from(generatedDocumentEditsTable).where(and(
        eq(generatedDocumentEditsTable.organizationId, organizationId), eq(generatedDocumentEditsTable.generatedDocumentId, generatedDocumentId)))
        .orderBy(asc(generatedDocumentEditsTable.id));
      const chain: HumanEditLink[] = [];
      let cursor = fromContentHash;
      // A cadeia parte da ocorrência MAIS RECENTE do texto composto (X → Y → X: o mesmo texto composto pode reaparecer no histórico);
      // sem nenhuma ocorrência registrada, parte do início (comportamento anterior).
      let start = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].newContentHash === fromContentHash) { start = i + 1; break; }
      for (const r of rows.slice(start)) {
        if (r.previousContentHash !== cursor) continue;
        if (r.operation !== "human_edit") break; // alteração não humana quebra a cadeia: a revalidação recusa
        chain.push({ editRef: `edit:${r.id}`, previousContentHash: r.previousContentHash, resultingContentHash: r.newContentHash, editorUserId: r.actorUserId });
        cursor = r.newContentHash;
      }
      return chain;
    },
  };
}

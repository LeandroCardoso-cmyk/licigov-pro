/**
 * Adapter REAL do `TemplateReviewPort`.
 *  - saídas de IA: `ai_orchestrations.outputs.templateNarrative = { slotKey, text }` da execução (tenant-scoped, por
 *    `executionId`). Forma inesperada ⇒ a saída é tratada como AUSENTE (a emissão bloqueia; nada é inferido);
 *  - aceites e reconhecimentos de desvio: decisões institucionais humanas (ledger existente) — ver `reviewService`;
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
import type { TemplateReviewPort } from "../ports";
import { AI_ACCEPTANCE_SUBJECT, DEVIATION_ACK_SUBJECT } from "../reviewService";

const tag = (evidence: readonly string[], name: string): string | null => {
  const hit = evidence.find((e) => e.startsWith(`${name}:`));
  return hit ? hit.slice(name.length + 1) : null;
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

    async listHumanEdits(organizationId, generatedDocumentId, fromContentHash) {
      const db = await getDb();
      if (!db) throw new TemplatePersistenceError("DB_UNAVAILABLE", "banco indisponível");
      const rows = await db.select().from(generatedDocumentEditsTable).where(and(
        eq(generatedDocumentEditsTable.organizationId, organizationId), eq(generatedDocumentEditsTable.generatedDocumentId, generatedDocumentId)))
        .orderBy(asc(generatedDocumentEditsTable.id));
      const chain: HumanEditLink[] = [];
      let cursor = fromContentHash;
      for (const r of rows) {
        if (r.previousContentHash !== cursor) continue;
        if (r.operation !== "human_edit") break; // alteração não humana quebra a cadeia: a revalidação recusa
        chain.push({ editRef: `edit:${r.id}`, previousContentHash: r.previousContentHash, resultingContentHash: r.newContentHash, editorUserId: r.actorUserId });
        cursor = r.newContentHash;
      }
      return chain;
    },
  };
}

/**
 * Adapter REAL do `TemplateManifestPort` sobre `server/db/institutionalTemplates/manifests.ts` (INSERT-only, tenant-scoped,
 * HD-26: pais existentes validados id + tenant na MESMA transação do chamador). M1 e M2 são registros distintos; o M1 não
 * carrega a versão oficial (o vínculo `officialDocumentId` pertence ao M2).
 */
import {
  getManifest, listManifestsForGeneratedDocument, persistGenerationManifest, persistIssuanceManifest, type TemplatesReader, type TemplatesTx,
} from "../../../db/institutionalTemplates";
import { and, eq } from "drizzle-orm";
import { generatedDocumentsTable } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import type { GenerationManifest } from "../../../domain/institutionalTemplates/manifest";
import type { PersistenceContext, TemplateManifestPort } from "../ports";

const ctxOf = (organizationId: number, p: PersistenceContext) => ({ organizationId, actorUserId: p.actorUserId, correlationId: p.correlationId });

/** Vínculo `tpl-m1:` do rascunho (tenant-scoped, somente leitura); `null` quando ausente/ilegível. */
async function draftManifestLink(organizationId: number, generatedDocumentId: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select({ sources: generatedDocumentsTable.sources }).from(generatedDocumentsTable)
    .where(and(eq(generatedDocumentsTable.organizationId, organizationId), eq(generatedDocumentsTable.id, generatedDocumentId))).limit(1);
  if (rows.length !== 1) return null;
  try {
    const v = JSON.parse(rows[0].sources ?? "[]");
    const link = Array.isArray(v) ? v.find((x): x is string => typeof x === "string" && x.startsWith("tpl-m1:")) : undefined;
    return link ? link.slice("tpl-m1:".length) : null;
  } catch { return null; }
}

export function createTemplateManifestAdapter(): TemplateManifestPort {
  return {
    async getManifest(org, id, executor) {
      return (await getManifest(org, id, executor as TemplatesReader | undefined))?.manifest ?? null;
    },
    async findGenerationManifestForDraft(org, generatedDocumentId) {
      const all = await listManifestsForGeneratedDocument(org, generatedDocumentId);
      const m1s = all.map((s) => s.manifest).filter((m): m is GenerationManifest => m.stage === "GENERATION");
      if (!m1s.length) return null;
      // O M1 VIGENTE é o do vínculo explícito da minuta (`tpl-m1:`), não o gravado por último: numa volta a fontes anteriores
      // (X → Y → X) a minuta é ressincronizada a um M1 que já existia. Sem vínculo legível (rascunho antigo), o mais recente — comportamento anterior.
      const linked = await draftManifestLink(org, generatedDocumentId);
      return (linked ? m1s.find((m) => m.id === linked) : undefined) ?? m1s[m1s.length - 1];
    },
    async insertGenerationManifest(manifest, p, executor) {
      const r = await persistGenerationManifest(executor as unknown as TemplatesTx, ctxOf(manifest.organizationId, p), manifest);
      return { created: r.created };
    },
    async insertIssuanceManifest(manifest, link, p, executor) {
      await persistIssuanceManifest(executor as unknown as TemplatesTx, ctxOf(manifest.organizationId, p), manifest, link.officialDocumentId);
    },
  };
}

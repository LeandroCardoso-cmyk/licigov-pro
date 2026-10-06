/**
 * Adapter REAL do `TemplateManifestPort` sobre `server/db/institutionalTemplates/manifests.ts` (INSERT-only, tenant-scoped,
 * HD-26: pais existentes validados id + tenant na MESMA transação do chamador). M1 e M2 são registros distintos; o M1 não
 * carrega a versão oficial (o vínculo `officialDocumentId` pertence ao M2).
 */
import {
  getManifest, listManifestsForGeneratedDocument, persistGenerationManifest, persistIssuanceManifest, type TemplatesReader, type TemplatesTx,
} from "../../../db/institutionalTemplates";
import type { GenerationManifest } from "../../../domain/institutionalTemplates/manifest";
import type { PersistenceContext, TemplateManifestPort } from "../ports";

const ctxOf = (organizationId: number, p: PersistenceContext) => ({ organizationId, actorUserId: p.actorUserId, correlationId: p.correlationId });

export function createTemplateManifestAdapter(): TemplateManifestPort {
  return {
    async getManifest(org, id, executor) {
      return (await getManifest(org, id, executor as TemplatesReader | undefined))?.manifest ?? null;
    },
    async findGenerationManifestForDraft(org, generatedDocumentId) {
      const all = await listManifestsForGeneratedDocument(org, generatedDocumentId);
      const m1s = all.map((s) => s.manifest).filter((m): m is GenerationManifest => m.stage === "GENERATION");
      return m1s.length ? m1s[m1s.length - 1] : null;
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

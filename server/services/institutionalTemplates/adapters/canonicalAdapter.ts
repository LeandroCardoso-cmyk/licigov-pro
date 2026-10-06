/**
 * Adapter REAL do `CanonicalReferencePort`: lê o domínio institucional (DOMAIN = TRUTH) por serviços/repositórios
 * existentes, tenant-scoped, FORA de transação. Nada é inferido nem completado: fonte ausente ⇒ omitida (o composer falha
 * por `MISSING_REQUIRED` se o catálogo a exigir); fonte sem backing (ITEMS) ⇒ falha fechada, nunca silêncio.
 *  PROCESS  = processo licitatório (número, objeto, modalidade)
 *  IDENTITY = identidade institucional vigente (snapshot canônico)
 *  DFD/ETP/TR = ÚLTIMA versão OFICIAL `emitido` do tipo, para a origem (o rascunho/`gerado` não é fonte)
 *  PARAMS   = parâmetros do Edital persistidos no rascunho (modalidade, forma, plataforma, critério, regime)
 */
import { createHash } from "crypto";
import { getGeneratedDocumentByKind, getProcess } from "../../../db/procurement";
import { getLatestEmittedByOrigin } from "../../../db/officialDocuments";
import { snapshotInstitutionalIdentity } from "../../institutionalIdentityService";
import type { DocRefKind } from "../../../domain/institutionalTemplates/ast";
import type { CanonicalSourceSnapshot, OfficialDocumentPin } from "../../../domain/institutionalTemplates/composer";
import type { VariableSource } from "../../../domain/institutionalTemplates/variableCatalog";
import { TemplatePersistenceUnavailableError, type CanonicalReferencePort } from "../ports";

const DOMAIN = "processo_licitatorio";
const OFFICIAL_TYPE: Partial<Record<DocRefKind | "DFD" | "ETP" | "TR", "dfd" | "etp" | "tr">> = { DFD: "dfd", ETP: "etp", TR: "tr" };
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

export function createCanonicalReferenceAdapter(): CanonicalReferencePort {
  return {
    async resolveSources(organizationId, subjectId, sources) {
      const out: Partial<Record<VariableSource, CanonicalSourceSnapshot>> = {};
      for (const source of sources) {
        switch (source) {
          case "PROCESS": {
            const p = await getProcess(subjectId, organizationId);
            if (p) out.PROCESS = { organizationId, data: { number: p.processNumber, object: p.object, modality: p.modality } };
            break;
          }
          case "IDENTITY": {
            const { snapshot } = await snapshotInstitutionalIdentity(organizationId);
            const { organizationId: _o, ...rest } = snapshot;
            out.IDENTITY = { organizationId, data: Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) };
            break;
          }
          case "DFD": case "ETP": case "TR": {
            const doc = await getLatestEmittedByOrigin(organizationId, DOMAIN, subjectId, OFFICIAL_TYPE[source]!);
            if (doc) out[source] = { organizationId, data: { title: doc.title, version: doc.version, content: doc.content } };
            break;
          }
          case "PARAMS": {
            const edital = await getGeneratedDocumentByKind(subjectId, organizationId, "edital");
            if (edital) {
              out.PARAMS = { organizationId, data: Object.fromEntries(Object.entries({
                modality: edital.modality, form: edital.form, platform: edital.platform,
                judgmentCriterion: edital.judgmentCriterion, executionRegime: edital.executionRegime,
              }).filter(([, v]) => v !== null)) };
            }
            break;
          }
          default:
            throw new TemplatePersistenceUnavailableError(`canonical:${source}`);
        }
      }
      return out;
    },

    async resolveOfficialDocuments(organizationId, subjectId, kinds) {
      const out: Partial<Record<DocRefKind, OfficialDocumentPin>> = {};
      for (const kind of kinds) {
        const type = OFFICIAL_TYPE[kind];
        if (!type) continue; // ANNEX etc.: sem backing ⇒ ausente (o composer recusa se for exigido)
        const doc = await getLatestEmittedByOrigin(organizationId, DOMAIN, subjectId, type);
        if (doc) out[kind] = { organizationId, documentId: doc.id, lineageId: doc.lineageId, version: doc.version, contentHash: sha256(doc.content ?? ""), title: doc.title };
      }
      return out;
    },

    async identityFingerprint(organizationId) {
      return (await snapshotInstitutionalIdentity(organizationId)).fingerprint;
    },
  };
}

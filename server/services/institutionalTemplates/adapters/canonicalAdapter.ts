/**
 * Adapter REAL do `CanonicalReferencePort`: lê o domínio institucional (DOMAIN = TRUTH) por serviços/repositórios
 * existentes, tenant-scoped, FORA de transação. Nada é inferido nem completado: fonte ausente ⇒ omitida (o composer falha
 * por `MISSING_REQUIRED` se o catálogo a exigir); fonte sem backing/inconsistente ⇒ `TemplateSourceUnavailableError`.
 *  PROCESS    = processo licitatório (número, objeto, modalidade)
 *  IDENTITY   = identidade institucional vigente (snapshot canônico) — também o fingerprint do M1
 *  DFD/ETP/TR = ÚLTIMA versão OFICIAL `emitido` do tipo (o rascunho/`gerado` não é fonte); o pin de GERAÇÃO é exato (ver abaixo)
 *  PARAMS     = parâmetros do Edital persistidos no rascunho (modalidade, forma, plataforma, critério, regime)
 *  ITEMS · CERTAME_CONFIG · POLICY · BUDGET · NORMATIVE · LIFECYCLE · RESULT = `canonicalSources.ts` (uma autoridade cada)
 */
import { createHash } from "crypto";
import { getGeneratedDocumentByKind, getProcess } from "../../../db/procurement";
import { getLatestEmittedByOrigin, getOfficialDocument } from "../../../db/officialDocuments";
import { snapshotInstitutionalIdentity } from "../../institutionalIdentityService";
import type { DocRefKind } from "../../../domain/institutionalTemplates/ast";
import type { CanonicalSourceSnapshot, OfficialDocumentPin } from "../../../domain/institutionalTemplates/composer";
import type { VariableSource } from "../../../domain/institutionalTemplates/variableCatalog";
import { TemplateSourceUnavailableError, type CanonicalReferencePort, type RequestedOfficialPin } from "../ports";
import {
  budgetSnapshot, certameSnapshot, itemsSnapshot, lifecycleSnapshot, normativeSnapshot, policySnapshot, resultSource,
} from "./canonicalSources";

const DOMAIN = "processo_licitatorio";
const OFFICIAL_TYPE: Partial<Record<DocRefKind | "DFD" | "ETP" | "TR", "dfd" | "etp" | "tr">> = { DFD: "dfd", ETP: "etp", TR: "tr" };
const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const today = (): string => new Date().toISOString().slice(0, 10);

function pinOf(organizationId: number, doc: { id: string; lineageId: string; version: number; content: string | null; title: string }): OfficialDocumentPin {
  return { organizationId, documentId: doc.id, lineageId: doc.lineageId, version: doc.version, contentHash: sha256(doc.content ?? ""), title: doc.title };
}

export function createCanonicalReferenceAdapter(): CanonicalReferencePort {
  return {
    async resolveSources(organizationId, subjectId, sources) {
      const out: Partial<Record<VariableSource, CanonicalSourceSnapshot>> = {};
      const put = (k: VariableSource, v: CanonicalSourceSnapshot | null) => { if (v) out[k] = v; };
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
          case "ITEMS": out.ITEMS = await itemsSnapshot(organizationId, subjectId); break;
          case "CERTAME_CONFIG": put(source, await certameSnapshot(organizationId, subjectId)); break;
          case "POLICY": put(source, await policySnapshot(organizationId)); break;
          case "BUDGET": put(source, await budgetSnapshot(organizationId, subjectId)); break;
          case "NORMATIVE": out.NORMATIVE = await normativeSnapshot(organizationId, today()); break;
          case "LIFECYCLE": put(source, await lifecycleSnapshot(organizationId, subjectId)); break;
          case "RESULT": resultSource(); break;
          default: throw new TemplateSourceUnavailableError(String(source), "UNKNOWN_SOURCE", "fonte fora do contrato");
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
        if (doc) out[kind] = pinOf(organizationId, doc);
      }
      return out;
    },

    async pinOfficialDocuments(organizationId, subjectId, kinds, requested: Partial<Record<DocRefKind, RequestedOfficialPin>>) {
      const out: Partial<Record<DocRefKind, OfficialDocumentPin>> = {};
      for (const kind of kinds) {
        const type = OFFICIAL_TYPE[kind];
        if (!type) throw new TemplateSourceUnavailableError(`official:${kind}`, "UNSUPPORTED_KIND", "tipo de documento oficial sem backing de pin");
        const req = requested[kind];
        if (!req) throw new TemplateSourceUnavailableError(`official:${kind}`, "OFFICIAL_PIN_REQUIRED", "informe o documento oficial EXATO (id + versão + hash); o servidor não escolhe \"o último\"");
        // Tenant-scoped por construção: documento de outro tenant é indistinguível de inexistente.
        const doc = await getOfficialDocument(req.documentId, organizationId);
        if (!doc || doc.documentType !== type || doc.businessDomain !== DOMAIN || doc.origin !== subjectId || doc.status !== "emitido") {
          throw new TemplateSourceUnavailableError(`official:${kind}`, "OFFICIAL_PIN_NOT_FOUND", "documento oficial emitido não encontrado para este processo e tipo");
        }
        if (doc.version !== req.version || sha256(doc.content ?? "") !== req.contentHash) {
          throw new TemplateSourceUnavailableError(`official:${kind}`, "OFFICIAL_PIN_MISMATCH", "versão/hash informados não correspondem ao documento oficial persistido");
        }
        const latest = await getLatestEmittedByOrigin(organizationId, DOMAIN, subjectId, type);
        if (!latest || latest.id !== doc.id) {
          throw new TemplateSourceUnavailableError(`official:${kind}`, "OFFICIAL_PIN_STALE", "existe versão oficial mais recente deste tipo; fixe a versão vigente");
        }
        out[kind] = pinOf(organizationId, doc);
      }
      return out;
    },

    async identityFingerprint(organizationId) {
      return (await snapshotInstitutionalIdentity(organizationId)).fingerprint;
    },
  };
}

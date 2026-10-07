/**
 * Leitura dos campos GOVERNADOS (ledger institucional existente), com verificação de integridade e de contrato.
 * Compartilhada pelo serviço de registro e pelos adapters canônicos: UMA leitura, UMA validação.
 *  - escopo PROCESSO: decisão corrente `procurement.source_fields` (assunto = id do processo);
 *  - escopo ÓRGÃO:    decisão corrente `institutional.policy` (assunto = `GOVERNED_ORG_SUBJECT`).
 */
import { getCurrentDecision } from "../../db/institutionalDecisions";
import type { InstitutionalDecision } from "../../domain/institutionalDecision";
import type { VariableCatalog2 } from "../../domain/institutionalTemplates";
import {
  GOVERNED_FIELDS_SCHEMA, decodeGovernedPayload, validateGovernedPayload, type GovernedPayload, type GovernedScope,
} from "../../domain/institutionalTemplates/governedSources";
import { TemplateSourceUnavailableError } from "./ports";

export const GOVERNED_ORG_SUBJECT = "governed-fields";

export const GOVERNED_SUBJECT_TYPE = { PROCESS: "procurement.source_fields", ORG: "institutional.policy" } as const;
export const GOVERNED_DECISION_TYPE = { PROCESS: "source_fields_declared", ORG: "institutional_policy" } as const;
export const GOVERNED_OUTCOME = { PROCESS: "declarado", ORG: "estabelecida" } as const;

export interface GovernedRecord { readonly payload: GovernedPayload; /** Payload decodificado COMPLETO (inclui campos de outros modelos; só para preservá-los ao regravar). */ readonly raw: { sections?: Record<string, Record<string, unknown>> }; readonly hash: string; readonly revision: number; readonly decision: InstitutionalDecision }

/** Registro corrente decodificado e REVALIDADO contra o catálogo informado; `null` = nenhuma decisão registrada. */
export async function readGovernedRecord(
  organizationId: number, scope: GovernedScope, subjectId: string, catalog: VariableCatalog2,
): Promise<GovernedRecord | null> {
  const d = await getCurrentDecision(null, organizationId, GOVERNED_SUBJECT_TYPE[scope], subjectId);
  if (!d) return null;
  const source = scope === "PROCESS" ? "GOVERNED_FIELDS" : "GOVERNED_FIELDS_ORG";
  const decoded = decodeGovernedPayload(d.evidence, GOVERNED_FIELDS_SCHEMA);
  if (!decoded) throw new TemplateSourceUnavailableError(source, "EVIDENCE_CORRUPT", "o registro não passa na verificação de integridade (schema/hash)");
  const valid = validateGovernedPayload(catalog, scope, decoded.payload);
  if (!valid.ok) throw new TemplateSourceUnavailableError(source, "EVIDENCE_CONTRACT_INVALID", `o registro não obedece ao catálogo ${catalog.version}: ${valid.issues[0]?.path ?? ""}`);
  return { payload: valid.value, raw: decoded.payload as GovernedRecord["raw"], hash: decoded.hash, revision: d.revision, decision: d };
}

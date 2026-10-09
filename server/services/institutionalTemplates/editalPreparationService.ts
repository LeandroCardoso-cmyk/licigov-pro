/**
 * Preparação OPERACIONAL do Edital institucional (somente leitura): quais campos GOVERNADOS o modelo EXATO vinculado precisa, qual o
 * valor corrente de cada um e quais revisões (CAS) os registros têm. Os descritores vêm do CATÁLOGO da revisão exata no servidor — o
 * navegador não tem uma segunda cópia do modelo. A ESCRITA continua nos endpoints governados existentes
 * (`institutionalTemplates.governed.*` → `GovernedSourceService`); nada aqui persiste nem decide.
 *
 *  - campos cuja autoridade é canônica (`AUTHORITY_OWNED_PATHS`) NÃO são editáveis e são listados à parte;
 *  - campos pós-homologação (`pos.*`), fontes sem autoridade pré-certame (RESULT/PARAMS) e documentos oficiais (pin) ficam fora;
 *  - `requiredWhen` é apenas informativo: a autoridade final da condição é o servidor (preflight/composição).
 */
import { getCurrentDecision } from "../../db/institutionalDecisions";
import { isCatalogV2 } from "../../domain/institutionalTemplates/astVersions";
import { conditionVariables } from "../../domain/institutionalTemplates/conditionalDsl2";
import {
  AUTHORITY_OWNED_PATHS, ORG_SCOPE_SOURCES, PROCESS_SCOPE_SOURCES, type GovernedParticipation, type GovernedScope,
} from "../../domain/institutionalTemplates/governedSources";
import type { OrgId } from "../../domain/institutionalTemplates/types";
import type { VariableDef2, VariableSource2 } from "../../domain/institutionalTemplates/variableCatalog2";
import type { EditalBoundaryParams } from "../../domain/institutionalTemplates/editalBridgeScope";
import { resolveEditalTemplate, type BridgeDeps, type EditalTemplateResolution } from "./editalBridgeService";
import { GOVERNED_ORG_SUBJECT, readGovernedRecord, type GovernedRecord } from "./governedFieldsStore";

export interface PreparationField {
  readonly name: string;
  readonly source: VariableSource2;
  readonly path: string;
  readonly type: string;
  readonly description: string;
  readonly required: boolean;
  /** `true` quando a obrigatoriedade depende de outra decisão (informativo; a autoridade é o servidor). */
  readonly conditional: boolean;
  readonly requiredWhenVariables: readonly string[];
  readonly enumValues?: readonly string[];
  readonly itemType?: string;
  readonly columns?: readonly { readonly key: string; readonly type: string; readonly label: string; readonly required: boolean }[];
  readonly hasValue: boolean;
  readonly currentValue?: unknown;
}

export interface PreparationSection {
  readonly source: VariableSource2;
  readonly scope: GovernedScope;
  readonly fields: readonly PreparationField[];
  readonly pendingRequired: number;
}

export type EditalPreparationState =
  | { readonly status: "UNAVAILABLE"; readonly resolution: EditalTemplateResolution["status"]; readonly reason: string }
  | {
    readonly status: "READY_FOR_PREPARATION";
    readonly revisionId: string; readonly catalogVersion: string;
    /** `expectedRevision` (CAS) do registro governado INTEIRO de cada escopo; 0 = nenhum registro ainda. */
    readonly revisions: { readonly process: number; readonly organization: number; readonly budget: number };
    readonly budgetDisclosure: "publico" | "sigiloso" | null;
    readonly participation: GovernedParticipation | null;
    readonly sections: readonly PreparationSection[];
    /** Campos de autoridade canônica (somente leitura; nunca duplicados no ledger). */
    readonly authorityOwned: readonly { readonly name: string; readonly source: VariableSource2; readonly path: string }[];
  };

const SOURCE_ORDER: readonly VariableSource2[] = ["IDENTITY", "POLICY", "PROCESS", "TR", "CERTAME_CONFIG", "ITEMS", "BUDGET", "NORMATIVE", "LIFECYCLE"];
const GOVERNABLE = new Set<string>([...PROCESS_SCOPE_SOURCES, ...ORG_SCOPE_SOURCES]);
const scopeOf = (source: VariableSource2): GovernedScope => ((ORG_SCOPE_SOURCES as readonly string[]).includes(source) ? "ORG" : "PROCESS");
const isOwned = (v: VariableDef2): boolean => (AUTHORITY_OWNED_PATHS[v.source] ?? []).includes(v.path);
/** Pós-homologação (`pos.*`) nunca é preenchido no pré-certame (ficam "a preencher"). */
const isPostAward = (v: VariableDef2): boolean => v.name.startsWith("pos.");

function valueOf(source: VariableSource2, path: string, process: GovernedRecord | null, org: GovernedRecord | null): unknown {
  const rec = scopeOf(source) === "ORG" ? org : process;
  const section = rec?.payload.sections[source] as Record<string, unknown> | undefined;
  return section && Object.prototype.hasOwnProperty.call(section, path) ? section[path] : undefined;
}

export async function getEditalPreparationState(deps: BridgeDeps, organizationId: OrgId, processId: string, params: EditalBoundaryParams): Promise<EditalPreparationState> {
  const resolution = await resolveEditalTemplate(deps, organizationId, params);
  if (resolution.status !== "BOUND" || !deps.ports) {
    return { status: "UNAVAILABLE", resolution: resolution.status, reason: "a preparação existe apenas quando um modelo institucional publicado está vinculado ao escopo do Edital" };
  }
  const revision = await deps.ports.repository.getRevision(organizationId, resolution.template.revisionId);
  const catalog = revision ? deps.ports.catalog.byVersion(revision.variableCatalogVersion) : null;
  if (!revision || revision.organizationId !== organizationId || !catalog || !isCatalogV2(catalog)) {
    return { status: "UNAVAILABLE", resolution: "INVALID", reason: "revisão vinculada ou catálogo tpl-catalog/2 indisponível" };
  }
  // Registro corrompido/fora do contrato do catálogo propaga como erro (fail-closed): nunca é "consertado" aqui.
  const readRecord = (scope: GovernedScope, subject: string) => readGovernedRecord(organizationId, scope, subject, catalog);
  const [processRec, orgRec, budget] = await Promise.all([
    readRecord("PROCESS", processId),
    readRecord("ORG", GOVERNED_ORG_SUBJECT),
    getCurrentDecision(null, organizationId, "procurement.budget_disclosure", processId),
  ]);

  const sections: PreparationSection[] = [];
  for (const source of SOURCE_ORDER) {
    if (!GOVERNABLE.has(source)) continue;
    const fields: PreparationField[] = catalog.vars
      .filter((v) => v.source === source && !isOwned(v) && !isPostAward(v) && v.type !== "document_ref")
      .map((v) => {
        const cur = valueOf(source, v.path, processRec, orgRec);
        return {
          name: v.name, source, path: v.path, type: v.type, description: (v.description ?? "").replace(/\s*\[[^\]]*\]\s*$/, ""), required: v.required,
          conditional: !!v.requiredWhen, requiredWhenVariables: v.requiredWhen ? [...new Set(conditionVariables(v.requiredWhen))].sort() : [],
          ...(v.enumValues ? { enumValues: v.enumValues } : {}), ...(v.itemType ? { itemType: v.itemType } : {}),
          ...(v.columns ? { columns: v.columns.map((c) => ({ key: c.key, type: c.type, label: c.label, required: c.required !== false })) } : {}),
          hasValue: cur !== undefined, ...(cur !== undefined ? { currentValue: cur } : {}),
        };
      })
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (fields.length === 0) continue;
    sections.push({ source, scope: scopeOf(source), fields, pendingRequired: fields.filter((f) => f.required && !f.hasValue).length });
  }
  const outcome = budget?.outcome;
  return {
    status: "READY_FOR_PREPARATION", revisionId: revision.id, catalogVersion: catalog.version,
    revisions: { process: processRec?.revision ?? 0, organization: orgRec?.revision ?? 0, budget: budget?.revision ?? 0 },
    budgetDisclosure: outcome === "publico" || outcome === "sigiloso" ? outcome : null,
    participation: processRec?.payload.participation ?? null,
    sections,
    authorityOwned: catalog.vars.filter((v) => GOVERNABLE.has(v.source) || v.source === "ITEMS").filter(isOwned).map((v) => ({ name: v.name, source: v.source, path: v.path })).sort((a, b) => (a.name < b.name ? -1 : 1)),
  };
}

/**
 * Preparação OPERACIONAL do Edital institucional (somente leitura) — ZERO_REENTRY, orientada por exceções.
 *
 * Para a revisão EXATA vinculada, classifica TODA variável do catálogo (`editalPreparationModel`), resolve o que o sistema já sabe
 * (autoridade canônica, projeções determinísticas, perfil institucional do órgão, decisões já registradas) e devolve só o que a
 * pessoa precisa decidir. Os descritores vêm do CATÁLOGO da revisão no servidor; o navegador não tem segunda cópia do modelo.
 * A ESCRITA continua nos endpoints governados existentes (`institutionalTemplates.governed.*` → `GovernedSourceService`); nada
 * aqui persiste nem decide.
 *
 *  - campos de autoridade canônica (`AUTHORITY_OWNED_PATHS`) e projeções aparecem como valor + origem (nunca como input);
 *  - campos pós-homologação (`pos.*`) e condicionais com a condição inativa ficam ocultos;
 *  - `requiredWhen` aqui é só para ocultar/mostrar: a autoridade final da condição é o composer (preflight/geração).
 */
import { getCurrentDecision } from "../../db/institutionalDecisions";
import { getProcess } from "../../db/procurement";
import { isCatalogV2 } from "../../domain/institutionalTemplates/astVersions";
import { conditionVariables, evaluateCondition2, type Cond2 } from "../../domain/institutionalTemplates/conditionalDsl2";
import {
  classifyVariable, RULE_LABEL, type PreparationClass, type VariableClassification,
} from "../../domain/institutionalTemplates/editalPreparationModel";
import type { EditalBoundaryParams } from "../../domain/institutionalTemplates/editalBridgeScope";
import {
  AUTHORITY_OWNED_PATHS, ORG_SCOPE_SOURCES, PROCESS_SCOPE_SOURCES, type GovernedParticipation, type GovernedScope,
} from "../../domain/institutionalTemplates/governedSources";
import type { OrgId } from "../../domain/institutionalTemplates/types";
import type { VariableDef2, VariableSource2 } from "../../domain/institutionalTemplates/variableCatalog2";
import { resolveProcurementContext } from "../canonicalContextService";
import { snapshotInstitutionalIdentity } from "../institutionalIdentityService";
import { resolveEditalTemplate, type BridgeDeps, type EditalTemplateResolution } from "./editalBridgeService";
import { resolveEditalProjections, type ProjectedValue } from "./editalProjections";
import { GOVERNED_ORG_SUBJECT, readGovernedRecord, type GovernedRecord } from "./governedFieldsStore";

export type FieldStatus =
  | "AUTO"                 // resolvido pelo sistema (autoridade canônica ou projeção determinística)
  | "ORG_REUSED"           // reutilizado do perfil institucional vigente do órgão
  | "DECIDED"              // decisão humana já registrada para este processo
  | "PENDING"              // precisa de você (obrigatório e aplicável, ainda sem valor)
  | "OPTIONAL"             // opcional, sem valor (decisões que ativam campos adicionais ficam aqui)
  | "AWAITING"             // depende de outra decisão ainda não registrada (ex.: divulgação do orçamento)
  | "CANONICAL_UNRESOLVED" // a autoridade canônica existe mas está incompleta (resolva na própria autoridade)
  | "HIDDEN_CONDITIONAL"   // condição inativa
  | "HIDDEN_POST_AWARD";   // pós-homologação

export interface PreparationOrigin {
  readonly label: string;
  /** Referência explicável (documentId/version/hash/revisão…). */
  readonly ref?: Readonly<Record<string, string | number>>;
}

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
  /** Condição (DSL v2) que torna o campo obrigatório: permite à tela mostrar/ocultar ao vivo; a autoridade final é o composer. */
  readonly requiredWhen?: Cond2;
  readonly enumValues?: readonly string[];
  readonly itemType?: string;
  readonly columns?: readonly { readonly key: string; readonly type: string; readonly label: string; readonly required: boolean }[];
  /** Há valor DECLARADO (governado) armazenado para este caminho. */
  readonly hasValue: boolean;
  readonly currentValue?: unknown;
  readonly class: PreparationClass;
  readonly rule: VariableClassification["rule"];
  readonly status: FieldStatus;
  /** A pessoa pode digitar este valor (falso para AUTO/ORG_REUSED somente leitura na tela principal). */
  readonly editable: boolean;
  /** Valor a exibir (explicabilidade): canônico/projetado/reutilizado/decidido. Ausente em pendências. */
  readonly displayValue?: unknown;
  readonly origin?: PreparationOrigin;
}

export interface PreparationSection {
  readonly source: VariableSource2;
  readonly scope: GovernedScope;
  readonly fields: readonly PreparationField[];
  /** Obrigatórios aplicáveis sem valor (status PENDING). */
  readonly pendingRequired: number;
}

export interface CanonicalReadOnlyField {
  readonly name: string;
  readonly source: VariableSource2;
  readonly path: string;
  readonly type: string;
  readonly description: string;
  readonly status: FieldStatus;
  readonly displayValue?: unknown;
  readonly origin: PreparationOrigin;
}

export type SummaryGroupId = "institucional" | "politicas" | "processo" | "tr" | "itens" | "certame" | "normativo";
export interface SummaryGroup {
  readonly id: SummaryGroupId;
  readonly title: string;
  /** Campos aplicáveis (não ocultos, obrigatórios ou com valor). */
  readonly total: number;
  readonly resolved: number;
  readonly reused: number;
  readonly pending: number;
  /** Itens bloqueados por autoridade incompleta fora desta tela (ex.: Itens da contratação). */
  readonly blockedCanonical: number;
}

export interface PreparationMetrics {
  readonly TOTAL_TEMPLATE_FIELDS: number;
  readonly AUTO_RESOLVED: number;
  readonly ORG_REUSED: number;
  readonly TR_PROJECTED: number;
  readonly DECIDED: number;
  readonly CONDITIONAL_HIDDEN: number;
  readonly POST_AWARD_HIDDEN: number;
  readonly OPTIONAL_HIDDEN: number;
  readonly MANUAL_DECISIONS_VISIBLE: number;
  readonly BY_CLASS: Readonly<Record<PreparationClass, number>>;
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
    /** Regime de participação dos itens é exigido pelo quadro de itens do modelo e ainda sem valor. */
    readonly participationPending: boolean;
    readonly sections: readonly PreparationSection[];
    /** Valores conhecidos por NOME de variável (decisões registradas + projeções + divulgação): base da avaliação ao vivo das condições. */
    readonly facts: Readonly<Record<string, unknown>>;
    /** Campos resolvidos pelo sistema (autoridade canônica / projeção): somente leitura, com origem. */
    readonly canonicalFields: readonly CanonicalReadOnlyField[];
    /** Perfil institucional do órgão: revisão/hash vigentes (lineage do que é reutilizado). */
    readonly orgProfile: { readonly revision: number; readonly hash: string | null } | null;
    readonly summary: { readonly groups: readonly SummaryGroup[]; readonly reusedAutomatically: number; readonly pendingDecisions: number };
    readonly metrics: PreparationMetrics;
  };

const SOURCE_ORDER: readonly VariableSource2[] = ["IDENTITY", "POLICY", "PROCESS", "TR", "CERTAME_CONFIG", "ITEMS", "BUDGET", "NORMATIVE", "LIFECYCLE"];
const GOVERNABLE = new Set<string>([...PROCESS_SCOPE_SOURCES, ...ORG_SCOPE_SOURCES]);
const scopeOf = (source: VariableSource2): GovernedScope => ((ORG_SCOPE_SOURCES as readonly string[]).includes(source) ? "ORG" : "PROCESS");
const isOwned = (v: VariableDef2): boolean => (AUTHORITY_OWNED_PATHS[v.source] ?? []).includes(v.path);

const GROUP_OF: Readonly<Partial<Record<VariableSource2, SummaryGroupId>>> = {
  IDENTITY: "institucional", POLICY: "politicas", PROCESS: "processo", TR: "tr", ITEMS: "itens", BUDGET: "itens",
  CERTAME_CONFIG: "certame", NORMATIVE: "normativo", LIFECYCLE: "normativo",
};
const GROUP_TITLE: Readonly<Record<SummaryGroupId, string>> = {
  institucional: "Dados institucionais", politicas: "Políticas do órgão", processo: "Processo", tr: "TR oficial",
  itens: "Itens e orçamento", certame: "Configuração do certame", normativo: "Fundamentos normativos e ciclo de vida",
};
const GROUP_ORDER: readonly SummaryGroupId[] = ["institucional", "processo", "tr", "itens", "certame", "politicas", "normativo"];

function storedValue(source: VariableSource2, path: string, process: GovernedRecord | null, org: GovernedRecord | null): unknown {
  const rec = scopeOf(source) === "ORG" ? org : process;
  const section = rec?.payload.sections[source] as Record<string, unknown> | undefined;
  return section && Object.prototype.hasOwnProperty.call(section, path) ? section[path] : undefined;
}

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

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
  const [processRec, orgRec, budget, projections, process, identity, ctx] = await Promise.all([
    readRecord("PROCESS", processId),
    readRecord("ORG", GOVERNED_ORG_SUBJECT),
    getCurrentDecision(null, organizationId, "procurement.budget_disclosure", processId),
    resolveEditalProjections(organizationId, processId, catalog),
    getProcess(processId, organizationId).catch(() => null),
    snapshotInstitutionalIdentity(organizationId).catch(() => null),
    resolveProcurementContext({ organizationId, processId }).catch(() => null),
  ]);
  const disclosure: "publico" | "sigiloso" | null = budget?.outcome === "publico" || budget?.outcome === "sigiloso" ? budget.outcome : null;

  // ── valores conhecidos por NOME (base da avaliação das condições): decisão registrada + canônico + projeção ──────────
  const classes = new Map<string, VariableClassification>(catalog.vars.map((v) => [v.name, classifyVariable(v)]));
  const known = new Map<string, unknown>();
  for (const v of catalog.vars) {
    const c = classes.get(v.name)!;
    if (c.class === "POST_AWARD") continue;
    if (!isOwned(v)) {
      const stored = storedValue(v.source, v.path, processRec, orgRec);
      if (!isEmpty(stored)) known.set(v.name, stored);
      else if (projections.has(v.name)) known.set(v.name, projections.get(v.name)!.value);
    }
  }
  if (disclosure && catalog.vars.some((v) => v.name === "controle.orcamentoSigilosoSimNao")) known.set("controle.orcamentoSigilosoSimNao", disclosure === "sigiloso");

  const facts = Object.fromEntries(known);

  // Condição inativa ⇒ o valor guardado de uma variável condicional NÃO conta (propaga a cadeia até estabilizar).
  const inactive = new Set<string>();
  for (let round = 0; round < 12; round++) {
    let changed = false;
    for (const v of catalog.vars) {
      if (!v.requiredWhen || inactive.has(v.name)) continue;
      const facts = Object.fromEntries([...known].filter(([k]) => !inactive.has(k)));
      if (!evaluateCondition2(v.requiredWhen, facts).result) { inactive.add(v.name); known.delete(v.name); changed = true; }
    }
    if (!changed) break;
  }

  // ── owned: valor de exibição + origem ───────────────────────────────────────────────────────────────────────────────
  const itemsOk = !!ctx && ctx.items.length > 0 && ctx.priceContext.itemsMissingPlannedQuantity === 0;
  const ownedView = (v: VariableDef2): { status: FieldStatus; displayValue?: unknown; origin: PreparationOrigin } => {
    switch (`${v.source}.${v.path}`) {
      case "PROCESS.numeroProcesso": return process ? { status: "AUTO", displayValue: process.processNumber, origin: { label: "Processo", ref: { processId } } } : { status: "CANONICAL_UNRESOLVED", origin: { label: "Processo" } };
      case "PROCESS.ano": { const y = process ? /^(\d{4})\//.exec(process.processNumber)?.[1] : undefined; return y ? { status: "AUTO", displayValue: Number(y), origin: { label: "Processo", ref: { processId } } } : { status: "CANONICAL_UNRESOLVED", origin: { label: "Processo" } }; }
      case "PROCESS.orcamentoSigilosoSimNao": return disclosure ? { status: "AUTO", displayValue: disclosure === "sigiloso", origin: { label: "Divulgação do orçamento", ref: { revision: budget?.revision ?? 0 } } } : { status: "AWAITING", origin: { label: "Divulgação do orçamento" } };
      case "IDENTITY.municipioNome": return identity?.snapshot.municipio ? { status: "AUTO", displayValue: identity.snapshot.municipio, origin: { label: "Cadastro do órgão", ref: { organizationId } } } : { status: "CANONICAL_UNRESOLVED", origin: { label: "Cadastro do órgão" } };
      case "IDENTITY.municipioCnpj": return identity?.snapshot.cnpj ? { status: "AUTO", displayValue: identity.snapshot.cnpj, origin: { label: "Cadastro do órgão", ref: { organizationId } } } : { status: "CANONICAL_UNRESOLVED", origin: { label: "Cadastro do órgão" } };
      case "IDENTITY.municipioEndereco": return identity?.snapshot.address ? { status: "AUTO", displayValue: identity.snapshot.address, origin: { label: "Cadastro do órgão", ref: { organizationId } } } : { status: "CANONICAL_UNRESOLVED", origin: { label: "Cadastro do órgão" } };
      case "IDENTITY.municipioTelefone": return identity?.snapshot.phone ? { status: "AUTO", displayValue: identity.snapshot.phone, origin: { label: "Cadastro do órgão", ref: { organizationId } } } : { status: "CANONICAL_UNRESOLVED", origin: { label: "Cadastro do órgão" } };
      case "IDENTITY.municipioSite": return identity?.snapshot.website ? { status: "AUTO", displayValue: identity.snapshot.website, origin: { label: "Cadastro do órgão", ref: { organizationId } } } : { status: "CANONICAL_UNRESOLVED", origin: { label: "Cadastro do órgão" } };
      case "ITEMS.quadroItensContratacao": return itemsOk
        ? { status: "AUTO", displayValue: `${ctx!.items.length} item(ns) com quantidade prevista`, origin: { label: "Itens da contratação", ref: { items: ctx!.items.length, contextVersion: ctx!.version } } }
        : { status: "CANONICAL_UNRESOLVED", origin: { label: "Itens da contratação" } };
      case "BUDGET.valorEstimado": {
        if (!disclosure) return { status: "AWAITING", origin: { label: "Orçamento" } };
        if (disclosure === "sigiloso") return { status: "AUTO", displayValue: "não divulgado (orçamento sigiloso)", origin: { label: "Divulgação do orçamento", ref: { revision: budget?.revision ?? 0 } } };
        return ctx?.priceContext.complete && ctx.priceContext.estimatedTotalCents !== null
          ? { status: "AUTO", displayValue: ctx.priceContext.estimatedTotalCents, origin: { label: "Pesquisa de preços", ref: { contextVersion: ctx.version } } }
          : { status: "CANONICAL_UNRESOLVED", origin: { label: "Pesquisa de preços" } };
      }
      default: return { status: "CANONICAL_UNRESOLVED", origin: { label: RULE_LABEL.AUTHORITY_OWNED } };
    }
  };

  // ── campos ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const orgLineage = orgRec ? { revision: orgRec.revision, hash: orgRec.hash } : null;
  const canonicalFields: CanonicalReadOnlyField[] = [];
  const bySource = new Map<VariableSource2, PreparationField[]>();
  const groupAcc = new Map<SummaryGroupId, { total: number; resolved: number; reused: number; pending: number; blocked: number }>();
  const bump = (g: SummaryGroupId | undefined, k: "total" | "resolved" | "reused" | "pending" | "blocked") => {
    if (!g) return;
    const a = groupAcc.get(g) ?? { total: 0, resolved: 0, reused: 0, pending: 0, blocked: 0 };
    a[k]++;
    groupAcc.set(g, a);
  };
  const m = { AUTO: 0, ORG: 0, TRP: 0, DEC: 0, CH: 0, PH: 0, OH: 0, MAN: 0 };
  const byClass = Object.fromEntries((["CANONICAL", "ORG_PROFILE", "TR_PROJECTION", "PROCESS_DECISION", "CONDITIONAL", "POST_AWARD"] as const).map((k) => [k, 0])) as Record<PreparationClass, number>;

  for (const v of catalog.vars) {
    const c = classes.get(v.name)!;
    byClass[c.class]++;
    const group = GROUP_OF[v.source];
    if (c.class === "POST_AWARD") { m.PH++; continue; }

    const requiredWhenVariables = v.requiredWhen ? [...new Set(conditionVariables(v.requiredWhen))].sort() : [];
    const descriptor = {
      name: v.name, source: v.source, path: v.path, type: v.type, description: (v.description ?? "").replace(/\s*\[[^\]]*\]\s*$/, ""),
      required: v.required, conditional: !!v.requiredWhen, requiredWhenVariables, ...(v.requiredWhen ? { requiredWhen: v.requiredWhen } : {}),
      ...(v.enumValues ? { enumValues: v.enumValues } : {}), ...(v.itemType ? { itemType: v.itemType } : {}),
      ...(v.columns ? { columns: v.columns.map((col) => ({ key: col.key, type: col.type, label: col.label, required: col.required !== false })) } : {}),
    };

    // Autoridade canônica "dona" (nunca digitada): lista à parte, somente leitura.
    if (c.rule === "AUTHORITY_OWNED" || c.rule === "DOCUMENT_PIN") {
      const view = ownedView(v);
      canonicalFields.push({ name: v.name, source: v.source, path: v.path, type: v.type, description: descriptor.description, status: view.status, ...(view.displayValue !== undefined ? { displayValue: view.displayValue } : {}), origin: view.origin });
      if (view.status === "AUTO") { m.AUTO++; bump(group, "total"); bump(group, "resolved"); bump(group, "reused"); }
      else if (view.status === "CANONICAL_UNRESOLVED") { bump(group, "total"); bump(group, "blocked"); }
      continue;
    }

    const stored = storedValue(v.source, v.path, processRec, orgRec);
    const hasValue = stored !== undefined;
    const projected: ProjectedValue | undefined = projections.get(v.name);
    let status: FieldStatus; let displayValue: unknown; let origin: PreparationOrigin | undefined; let editable = true;

    if (inactive.has(v.name)) { status = "HIDDEN_CONDITIONAL"; m.CH++; }
    else if (hasValue && !isEmpty(stored)) {
      displayValue = stored;
      if (c.scope === "ORG") {
        status = "ORG_REUSED"; m.ORG++;
        origin = { label: "Perfil institucional do órgão", ref: { revision: orgLineage?.revision ?? 0, hash: (orgLineage?.hash ?? "").slice(0, 12) } };
      } else {
        status = "DECIDED"; m.DEC++;
        origin = { label: "Decisão registrada para este processo", ref: { revision: processRec?.revision ?? 0 } };
      }
    } else if (projected) {
      status = "AUTO"; displayValue = projected.value; origin = { label: projected.origin, ref: projected.ref }; editable = false;
      if (c.class === "TR_PROJECTION") m.TRP++; else m.AUTO++;
    } else if (v.required || (v.requiredWhen && !inactive.has(v.name))) {
      status = "PENDING"; m.MAN++;
    } else { status = "OPTIONAL"; m.OH++; }

    // Denominador do resumo: aplicáveis (não ocultos) que são obrigatórios/condicionais ativos ou já têm valor.
    const applicable = !(["HIDDEN_CONDITIONAL", "OPTIONAL", "AWAITING"] as FieldStatus[]).includes(status);
    if (applicable) {
      bump(group, "total");
      if (status === "PENDING") bump(group, "pending");
      else { bump(group, "resolved"); if (status === "AUTO" || status === "ORG_REUSED") bump(group, "reused"); }
    }

    const field: PreparationField = {
      ...descriptor, hasValue, ...(hasValue ? { currentValue: stored } : {}), class: c.class, rule: c.rule, status, editable,
      ...(displayValue !== undefined ? { displayValue } : {}), ...(origin ? { origin } : {}),
    };
    if (!GOVERNABLE.has(v.source) || v.type === "document_ref") continue;
    (bySource.get(v.source) ?? bySource.set(v.source, []).get(v.source)!).push(field);
  }

  const sections: PreparationSection[] = [];
  for (const source of SOURCE_ORDER) {
    const fields = (bySource.get(source) ?? []).slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    if (fields.length === 0) continue;
    sections.push({ source, scope: scopeOf(source), fields, pendingRequired: fields.filter((f) => f.status === "PENDING").length });
  }

  // Regime de participação dos itens: exigido pela coluna obrigatória do quadro e ainda sem valor declarado.
  const itemsTable = catalog.vars.find((v) => v.source === "ITEMS" && v.path === "quadroItensContratacao");
  const participationNeeded = !!itemsTable?.columns?.some((col) => col.key === "regimeParticipacao" && col.required !== false);
  const part = processRec?.payload.participation ?? null;
  const participationPending = participationNeeded && !part?.default && !Object.keys(part?.byItem ?? {}).length && !Object.keys(part?.byLot ?? {}).length;
  if (participationPending) { bump("itens", "total"); bump("itens", "pending"); m.MAN++; }
  else if (participationNeeded) { bump("itens", "total"); bump("itens", "resolved"); }
  if (!disclosure) { bump("itens", "total"); bump("itens", "pending"); m.MAN++; }
  else { bump("itens", "total"); bump("itens", "resolved"); }

  const groups: SummaryGroup[] = GROUP_ORDER.filter((id) => groupAcc.has(id)).map((id) => {
    const a = groupAcc.get(id)!;
    return { id, title: GROUP_TITLE[id], total: a.total, resolved: a.resolved, reused: a.reused, pending: a.pending, blockedCanonical: a.blocked };
  });
  const pendingDecisions = groups.reduce((n, g) => n + g.pending, 0);
  const reusedAutomatically = m.AUTO + m.ORG + m.TRP;

  return {
    status: "READY_FOR_PREPARATION", revisionId: revision.id, catalogVersion: catalog.version,
    revisions: { process: processRec?.revision ?? 0, organization: orgRec?.revision ?? 0, budget: budget?.revision ?? 0 },
    budgetDisclosure: disclosure, participation: part, participationPending,
    sections, facts, canonicalFields: canonicalFields.sort((a, b) => (a.name < b.name ? -1 : 1)), orgProfile: orgLineage,
    summary: { groups, reusedAutomatically, pendingDecisions },
    metrics: {
      TOTAL_TEMPLATE_FIELDS: catalog.vars.length, AUTO_RESOLVED: m.AUTO, ORG_REUSED: m.ORG, TR_PROJECTED: m.TRP, DECIDED: m.DEC,
      CONDITIONAL_HIDDEN: m.CH, POST_AWARD_HIDDEN: m.PH, OPTIONAL_HIDDEN: m.OH, MANUAL_DECISIONS_VISIBLE: m.MAN, BY_CLASS: byClass,
    },
  };
}

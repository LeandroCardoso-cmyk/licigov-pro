/**
 * CONFIGURAÇÃO DO CERTAME (CertameConfig) — leitura (PR #288). Autoridade ÚNICA das decisões tomadas UMA vez por processo
 * (número do pregão, SRP, inversão de fases, critério, modo de disputa, prazos, enquadramentos…). O Edital não cria cópia: ele CONSOME
 * esta configuração, e qualquer outro documento (TR, Contrato…) pode lê-la por aqui sem redigitar. Persistência: o registro governado
 * do PROCESSO no ledger existente (`institutional_decisions`), versionado por revisão; a escrita semântica é
 * `institutionalTemplates.governed.recordCertameConfig`. Somente leitura; tenant-scoped; nada é inferido nem copiado de outro processo.
 *
 * Também expõe os estados de ORIGEM que o Edital apenas consome: participação nos Itens e divulgação do orçamento.
 */
import { getCurrentDecision } from "../../db/institutionalDecisions";
import { readPriceResearchSuggestedDate } from "../../db/priceResearchBaseDate";
import type { EditalBoundaryParams } from "../../domain/institutionalTemplates/editalBridgeScope";
import { authorityEntryOf, type AuthorityClass } from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import { COMBINATION_PREFIX, DERIVED_VARIABLES, deriveFormaJulgamento, deriveRegimeParticipacao, type ItemStructure } from "../../domain/institutionalTemplates/certameAuthority";
import type { GovernedParticipation } from "../../domain/institutionalTemplates/governedSources";
import type { BridgeDeps } from "./editalBridgeService";
import { loadEditalCatalog } from "./editalCatalogLoader";
import { GOVERNED_ORG_SUBJECT, readGovernedRecord } from "./governedFieldsStore";
import { loadContextReuse } from "./editalContextReuse";
import { describeVariable } from "./editalPreparationService";
import { isDeferredPublication } from "../../domain/institutionalTemplates/variableCatalog2";
import { projectPublicationSchedule, type PublicationReadiness, type PublicationScheduleProjection } from "../../domain/institutionalTemplates/publicationSchedule";
import { resolveProcurementContext } from "../canonicalContextService";

export type CertameFieldStatus = "DECIDED" | "ORG_DEFAULT" | "DERIVED" | "PENDING" | "OPTIONAL" | "DEFERRED";

export interface CertameConfigField {
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly enumValues?: readonly string[];
  readonly authority: AuthorityClass;
  readonly status: CertameFieldStatus;
  readonly value?: unknown;
  readonly origin?: string;
}

export type CertameConfigState =
  | { readonly status: "UNAVAILABLE"; readonly reason: string }
  | {
    readonly status: "READY";
    readonly catalogVersion: string;
    /** CAS do registro do processo; 0 = nenhuma configuração ainda. */
    readonly revision: number;
    readonly hash: string | null;
    readonly fields: readonly CertameConfigField[];
    /** Número do pregão: persistido UMA vez na configuração e reutilizado por todo documento do certame (nunca gerado sem regra governada). */
    readonly numeroPregao: string | null;
    /**
     * PublicationScheduleProjection (cronograma + número do pregão) e PublicationReadiness — leitura ESTÁVEL para consumidores operacionais
     * (calendário, centro de operações, alertas). `complete=false` NUNCA bloqueia a composição do Edital.
     */
    readonly publication: { readonly schedule: PublicationScheduleProjection; readonly readiness: PublicationReadiness };
  };

const FAMILY: readonly AuthorityClass[] = ["CERTAME_CONFIG", "CERTAME_SCHEDULE"];

export async function getCertameConfigState(deps: BridgeDeps, organizationId: number, processId: string, params: EditalBoundaryParams): Promise<CertameConfigState> {
  const loaded = await loadEditalCatalog(deps, organizationId, params);
  if (loaded.status !== "OK") return { status: "UNAVAILABLE", reason: loaded.reason };
  const { catalog } = loaded;
  const [processRec, orgRec] = await Promise.all([
    readGovernedRecord(organizationId, "PROCESS", processId, catalog),
    readGovernedRecord(organizationId, "ORG", GOVERNED_ORG_SUBJECT, catalog),
  ]);
  const reuse = await loadContextReuse({ organizationId, processId, catalog, orgRecord: orgRec, asOf: deps.now().slice(0, 10), processRecord: processRec });
  const fields: CertameConfigField[] = [];
  let numeroPregao: string | null = null;
  const effective: Record<string, unknown> = {};
  for (const v of catalog.vars) {
    const entry = authorityEntryOf(v.name);
    if (!entry || !(FAMILY.includes(entry.cls) || (entry.cls === "CONDITIONAL" && entry.entry === "CERTAME_CONFIG"))) continue;
    const sec = processRec?.payload.sections[v.source] as Record<string, unknown> | undefined;
    const stored = sec && Object.prototype.hasOwnProperty.call(sec, v.path) ? sec[v.path] : undefined;
    const ru = reuse.values.get(v.name);
    const d = describeVariable(v);
    const base = { name: v.name, description: d.description, type: v.type, ...(v.enumValues ? { enumValues: v.enumValues } : {}), authority: entry.cls };
    if (ru?.kind === "SCHEDULE") fields.push({ ...base, status: "DERIVED", value: ru.value, origin: ru.origin.label });
    else if (stored !== undefined && stored !== null && stored !== "") fields.push({ ...base, status: "DECIDED", value: stored, origin: `Configuração do certame · revisão ${processRec?.revision ?? 0}` });
    else if (ru?.kind === "ORG_DEFAULT") fields.push({ ...base, status: "ORG_DEFAULT", value: ru.value, origin: "Padrão institucional do órgão" });
    else fields.push({ ...base, status: v.required ? "PENDING" : isDeferredPublication(v) ? "DEFERRED" : "OPTIONAL" });
    const last = fields[fields.length - 1];
    if (last.value !== undefined && last.status !== "PENDING" && last.status !== "OPTIONAL" && last.status !== "DEFERRED") effective[v.name] = last.value;
    if (v.name === "processo.numeroPregao" && typeof stored === "string" && stored !== "") numeroPregao = stored;
  }
  return { status: "READY", catalogVersion: catalog.version, revision: processRec?.revision ?? 0, hash: processRec?.hash ?? null, fields, numeroPregao, publication: projectPublicationSchedule(effective) };
}

// ─── Itens: participação e estrutura (origem do regime e da forma de julgamento) ─────────────────────────────────────────

export type ItemsParticipationState =
  | { readonly status: "UNAVAILABLE"; readonly reason: string }
  | {
    readonly status: "READY";
    readonly catalogVersion: string;
    readonly revision: number;
    readonly participation: GovernedParticipation | null;
    /** Opções selecionáveis (o regime combinado é DERIVADO, nunca escolhido). */
    readonly regimes: readonly string[];
    readonly lots: readonly { readonly code: string; readonly name: string }[];
    readonly itemCount: number;
    /** O que o Edital derivará disto. */
    readonly derived: {
      readonly formaJulgamento: { readonly state: "OK" | "EMPTY" | "AMBIGUOUS"; readonly value?: "item" | "lote"; readonly reason?: string };
      readonly regime: { readonly state: "OK" | "MISSING" | "INVALID"; readonly value?: string; readonly combined?: boolean; readonly reason?: string };
    };
  };

export async function getItemsParticipationState(deps: BridgeDeps, organizationId: number, processId: string, params: EditalBoundaryParams): Promise<ItemsParticipationState> {
  const loaded = await loadEditalCatalog(deps, organizationId, params);
  if (loaded.status !== "OK") return { status: "UNAVAILABLE", reason: loaded.reason };
  const { catalog } = loaded;
  const regimeDef = catalog.vars.find((v) => DERIVED_VARIABLES[v.name] === "REGIME_PARTICIPACAO");
  if (!regimeDef) return { status: "UNAVAILABLE", reason: "o modelo vinculado não usa regime de participação" };
  const [processRec, ctx] = await Promise.all([
    readGovernedRecord(organizationId, "PROCESS", processId, catalog),
    resolveProcurementContext({ organizationId, processId }).catch(() => null),
  ]);
  if (!ctx) return { status: "UNAVAILABLE", reason: "processo não encontrado nesta organização" };
  const lotCode = new Map(ctx.lots.map((l) => [l.id, l.code] as const));
  const items: ItemStructure[] = ctx.items.map((it) => ({ key: it.key, lotId: it.lotId, lotCode: it.lotId ? lotCode.get(it.lotId) ?? null : null }));
  const regimes = (regimeDef.enumValues ?? []).filter((r) => !r.startsWith(COMBINATION_PREFIX));
  const forma = deriveFormaJulgamento(items);
  const reg = deriveRegimeParticipacao(processRec?.payload.participation, items, regimeDef.enumValues ?? []);
  return {
    status: "READY", catalogVersion: catalog.version, revision: processRec?.revision ?? 0, participation: processRec?.payload.participation ?? null,
    regimes, lots: ctx.lots.map((l) => ({ code: l.code, name: l.name })), itemCount: items.length,
    derived: {
      formaJulgamento: forma.state === "OK" ? { state: "OK", value: forma.value } : forma.state === "AMBIGUOUS" ? { state: "AMBIGUOUS", reason: forma.reason } : { state: "EMPTY" },
      regime: reg.state === "OK" ? { state: "OK", value: reg.value, combined: reg.combined } : { state: reg.state, reason: reg.reason },
    },
  };
}

// ─── Orçamento: divulgação (registrada UMA vez) e data-base ──────────────────────────────────────────────────────────────

export interface BudgetDisclosureState {
  /** O módulo de modelos institucionais está habilitado para esta organização (senão a decisão não é exigida). */
  readonly enabled: boolean;
  readonly disclosure: "publico" | "sigiloso" | null;
  /** CAS da decisão de divulgação; 0 = nenhuma. */
  readonly revision: number;
  /** Data-base REGISTRADA (AAAA-MM-DD) na seção BUDGET do registro governado do processo, ou null. É a ÚNICA autoridade. */
  readonly baseDate: string | null;
  /** CAS do registro do processo (escrita da data-base); 0 = nenhum registro. */
  readonly baseDateRevision: number;
  /** Versão do catálogo do modelo (necessária para registrar a data-base); null = modelo indisponível para este processo. */
  readonly catalogVersion: string | null;
  /** SUGESTÃO de UX (data de registro da pesquisa): nunca é usada sem confirmação humana explícita. */
  readonly suggestedBaseDate: string | null;
}

export async function getBudgetDisclosureState(deps: BridgeDeps, organizationId: number, processId: string, params: EditalBoundaryParams): Promise<BudgetDisclosureState> {
  const enabled = !!deps.ports && (await deps.ports.enablement.isEnabled(organizationId));
  if (!enabled) return { enabled: false, disclosure: null, revision: 0, baseDate: null, baseDateRevision: 0, catalogVersion: null, suggestedBaseDate: null };
  const loaded = await loadEditalCatalog(deps, organizationId, params);
  const [d, suggested, rec] = await Promise.all([
    getCurrentDecision(null, organizationId, "procurement.budget_disclosure", processId),
    readPriceResearchSuggestedDate(organizationId, processId).catch(() => null),
    loaded.status === "OK" ? readGovernedRecord(organizationId, "PROCESS", processId, loaded.catalog) : Promise.resolve(null),
  ]);
  const disclosure = d?.outcome === "publico" || d?.outcome === "sigiloso" ? d.outcome : null;
  const budgetDef = loaded.status === "OK" ? loaded.catalog.vars.find((v) => DERIVED_VARIABLES[v.name] === "BUDGET_DATE") : undefined;
  const stored = budgetDef ? (rec?.payload.sections[budgetDef.source] as Record<string, unknown> | undefined)?.[budgetDef.path] : undefined;
  return {
    enabled: true, disclosure, revision: d?.revision ?? 0, baseDate: typeof stored === "string" ? stored : null, baseDateRevision: rec?.revision ?? 0,
    catalogVersion: loaded.status === "OK" && budgetDef ? loaded.catalog.version : null, suggestedBaseDate: suggested,
  };
}

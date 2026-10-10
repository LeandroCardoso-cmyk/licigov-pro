/**
 * CAMADA DE REUSO DE CONTEXTO do Edital (CONTEXT_REUSE 2.0). Fonte ÚNICA do que o sistema já sabe além das projeções canônicas:
 *
 *  - TR_PARAM    parâmetro estruturado do TR (fato `tr.param.<variável>` do Contexto Canônico; fonte `tr`, ator humano);
 *  - ORG_ROLE    papel institucional do Perfil de Licitações (nome/cargo/ato/vigência), projeção determinística por variável;
 *  - ORG_DEFAULT padrão institucional EXPLÍCITO (criado por ação humana) — só para variável elegível e valor válido.
 *
 * Usada pela composição (`canonicalSources`) e pela preparação (`editalPreparationService`): o que a tela mostra como "reaproveitado" é
 * exatamente o que o composer consome. Nada é inferido: sem dado ⇒ sem valor (a variável segue pendente, com a entrada correta).
 * Multi-tenant: tudo é lido por (organizationId[, processId]); nunca "último processo".
 */
import { listContextFacts } from "../../db/procurementContext";
import { readPriceResearchBaseDate } from "../../db/priceResearchBaseDate";
import { resolveProcurementContext } from "../canonicalContextService";
import { getOfficialDocument } from "../../db/officialDocuments";
import type { VariableCatalog2 } from "../../domain/institutionalTemplates";
import {
  ROLE_LABEL, authorityEntryOf, isDefaultEligible, resolveRoleVariable, type EntryPoint, type RoleKey,
} from "../../domain/institutionalTemplates/editalAuthorityMatrix";
import {
  BLL_PLATFORM, DERIVED_VARIABLES, SCHEDULE, deriveFormaJulgamento, deriveRegimeParticipacao, deriveSchedule, isIsoDate, resolvePlatformVariable,
  type ItemStructure, type PlatformProfiles,
} from "../../domain/institutionalTemplates/certameAuthority";
import type { GovernedRecord } from "./governedFieldsStore";
import { TR_PARAMS_DIGEST_RE, resolveTrParams, trParamsDigest, type ResolvedTrParam } from "../../domain/trStructuredParams";
import { validateDefaults } from "../../domain/institutionalTemplates/governedSources";
import { templateHash } from "../../domain/institutionalTemplates/semanticHash";
import type { VariableDef2 } from "../../domain/institutionalTemplates/variableCatalog2";

export type ReuseKind = "TR_PARAM" | "ORG_ROLE" | "ORG_DEFAULT" | "PLATFORM" | "ITEMS" | "BUDGET" | "LIFECYCLE" | "SCHEDULE";

export interface ReusedValue {
  readonly kind: ReuseKind;
  readonly value: unknown;
  readonly origin: { readonly label: string; readonly ref: Readonly<Record<string, string | number>> };
}

export type ReuseProblemCode =
  | "ROLE_MISSING" | "ROLE_STALE" | "DEFAULT_INCOMPATIBLE" | "TR_PARAM_INVALID" | "TR_PARAM_CONFLICT"
  | "PLATFORM_MISSING" | "ITEMS_MISSING" | "ITEMS_AMBIGUOUS" | "ITEMS_INVALID" | "BUDGET_DATE_MISSING" | "SCHEDULE_BASE_MISSING";
/** `fix` = onde a pessoa resolve (a origem da autoridade), nunca o Edital. */
export interface ReuseProblem { readonly name: string; readonly kind: ReuseKind; readonly code: ReuseProblemCode; readonly reason: string; readonly role?: RoleKey; readonly fix?: EntryPoint }

export interface ContextReuse {
  readonly values: ReadonlyMap<string, ReusedValue>;
  readonly problems: ReadonlyMap<string, ReuseProblem>;
  /** Todos os parâmetros do TR do catálogo (inclusive UNSET) — base da seção do TR e da avaliação de condições. */
  readonly trParams: ReadonlyMap<string, ResolvedTrParam>;
  readonly trDigest: string;
  readonly orgProfile: { readonly revision: number; readonly hash: string } | null;
}

/** Variáveis do catálogo que o TR estruturado alimenta (entrada = seção de parâmetros do TR). */
export function trParamDefs(catalog: VariableCatalog2): VariableDef2[] {
  return catalog.vars.filter((v) => authorityEntryOf(v.name)?.entry === "TR_SECTION" && v.type !== "document_ref" && v.type !== "table");
}

export interface ReuseInputs {
  readonly catalog: VariableCatalog2;
  readonly orgRecord: GovernedRecord | null;
  readonly trAssertions: Parameters<typeof resolveTrParams>[1];
  /** Data (AAAA-MM-DD) de referência para vigência de papéis. */
  readonly asOf: string;
  /** Registro governado do PROCESSO (CertameConfig + participação): base do cronograma derivado e do regime de participação. */
  readonly processRecord?: GovernedRecord | null;
  /** Estrutura canônica dos Itens (item × lote); `null` = indisponível. */
  readonly items?: readonly ItemStructure[] | null;
  /** Data-base do orçamento (AAAA-MM-DD) da Pesquisa de Preços; `null` = ausente. */
  readonly budgetDate?: string | null;
  /** Data (AAAA-MM-DD) do evento de composição governada: a MESMA na geração (M1), na revalidação e na emissão (M2). */
  readonly compositionDate?: string;
}

const storedAt = (catalog: VariableCatalog2, record: GovernedRecord | null | undefined, name: string): unknown => {
  const v = catalog.vars.find((x) => x.name === name);
  if (!v) return undefined;
  const sec = record?.payload.sections[v.source] as Record<string, unknown> | undefined;
  return sec && Object.prototype.hasOwnProperty.call(sec, v.path) ? sec[v.path] : undefined;
};

/** Puro: monta o reuso a partir dos registros já lidos. */
export function buildContextReuse(input: ReuseInputs): ContextReuse {
  const { catalog, orgRecord, asOf } = input;
  const values = new Map<string, ReusedValue>();
  const problems = new Map<string, ReuseProblem>();
  const profileRef = { revision: orgRecord?.revision ?? 0, hash: (orgRecord?.hash ?? "").slice(0, 12) };

  const trParams = resolveTrParams(trParamDefs(catalog), input.trAssertions);
  const rejectedDefaults = new Map((orgRecord?.payload.defaultsRejected ?? []).map((r) => [r.name, r.reason] as const));

  const platforms = orgRecord?.payload.platforms as PlatformProfiles | undefined;
  const platformRef = { revision: orgRecord?.revision ?? 0, hash: (orgRecord?.hash ?? "").slice(0, 12) };
  const itemsList = input.items ?? null;
  const derive = (v: VariableCatalog2["vars"][number], kind: NonNullable<(typeof DERIVED_VARIABLES)[string]>): void => {
    const problem = (kindR: ReuseKind, code: ReuseProblemCode, reason: string, fix: EntryPoint) => problems.set(v.name, { name: v.name, kind: kindR, code, reason, fix });
    switch (kind) {
      case "PLATFORM": {
        const r = resolvePlatformVariable(v.name, platforms);
        if (!r) return;
        if (r.state === "OK") values.set(v.name, { kind: "PLATFORM", value: r.value, origin: { label: `Perfil da plataforma · ${r.platform.toUpperCase()}`, ref: { ...platformRef, platform: r.platform } } });
        else problem("PLATFORM", "PLATFORM_MISSING", r.reason, "PLATFORM_PROFILE");
        return;
      }
      case "FORMA_JULGAMENTO": {
        if (!itemsList) { problem("ITEMS", "ITEMS_MISSING", "estrutura dos Itens da contratação indisponível", "ITEMS"); return; }
        const r = deriveFormaJulgamento(itemsList);
        if (r.state === "OK") values.set(v.name, { kind: "ITEMS", value: r.value, origin: { label: "Itens da contratação (estrutura item × lote)", ref: { items: itemsList.length, lots: new Set(itemsList.map((i) => i.lotId).filter(Boolean)).size } } });
        else problem("ITEMS", r.state === "EMPTY" ? "ITEMS_MISSING" : "ITEMS_AMBIGUOUS", r.state === "EMPTY" ? "o processo não possui Itens da contratação" : r.reason, "ITEMS");
        return;
      }
      case "REGIME_PARTICIPACAO": {
        if (!itemsList) { problem("ITEMS", "ITEMS_MISSING", "estrutura dos Itens da contratação indisponível", "ITEMS"); return; }
        const r = deriveRegimeParticipacao(input.processRecord?.payload.participation, itemsList, v.enumValues ?? []);
        if (r.state === "OK") values.set(v.name, { kind: "ITEMS", value: r.value, origin: { label: r.combined ? "Itens da contratação (regimes diferentes por item/lote)" : "Itens da contratação (regime de participação)", ref: { items: itemsList.length, revision: input.processRecord?.revision ?? 0 } } });
        else problem("ITEMS", r.state === "MISSING" ? "ITEMS_MISSING" : "ITEMS_INVALID", r.reason, "ITEMS");
        return;
      }
      case "BUDGET_DATE": {
        if (input.budgetDate && isIsoDate(input.budgetDate)) values.set(v.name, { kind: "BUDGET", value: input.budgetDate, origin: { label: "Pesquisa de Preços (data-base)", ref: { baseDate: input.budgetDate } } });
        else problem("BUDGET", "BUDGET_DATE_MISSING", "a Pesquisa de Preços que originou os Itens aprovados não tem data-base", "PRICE_RESEARCH");
        return;
      }
      case "EMISSION_DATE": {
        if (input.compositionDate && isIsoDate(input.compositionDate)) values.set(v.name, { kind: "LIFECYCLE", value: input.compositionDate, origin: { label: "Ciclo de vida documental (atribuída pelo sistema)", ref: { compositionDate: input.compositionDate } } });
        return;
      }
      default: return;
    }
  };

  for (const v of catalog.vars) {
    const entry = authorityEntryOf(v.name);
    if (!entry) continue;

    // 1) papel institucional
    const role = resolveRoleVariable(v.name, orgRecord?.payload.roles, asOf);
    if (role) {
      if (role.state === "OK") {
        values.set(v.name, { kind: "ORG_ROLE", value: role.value, origin: { label: `Perfil de Licitações · ${ROLE_LABEL[role.role]}`, ref: { ...profileRef, role: role.role } } });
      } else {
        problems.set(v.name, { name: v.name, kind: "ORG_ROLE", code: role.state === "STALE" ? "ROLE_STALE" : "ROLE_MISSING", reason: role.reason, role: role.role });
      }
      continue;
    }

    // 1b) autoridades DERIVADAS (PR #288): plataforma, itens, orçamento, ciclo de vida. Nunca entrada do Edital.
    const dk = DERIVED_VARIABLES[v.name];
    if (dk && dk !== "SCHEDULE") {
      derive(v, dk);
      continue;
    }

    // 2) parâmetro estruturado do TR
    const tp = trParams.get(v.name);
    if (tp) {
      if (tp.status === "SET") {
        values.set(v.name, {
          kind: "TR_PARAM", value: tp.value,
          origin: { label: "Parâmetros estruturados do TR", ref: { sourceId: tp.field.source?.id ?? "", sourceVersion: tp.field.source?.version ?? "", status: tp.field.status } },
        });
      } else if (tp.status === "INVALID") problems.set(v.name, { name: v.name, kind: "TR_PARAM", code: "TR_PARAM_INVALID", reason: tp.reason ?? "valor inválido" });
      else if (tp.status === "CONFLICT") problems.set(v.name, { name: v.name, kind: "TR_PARAM", code: "TR_PARAM_CONFLICT", reason: tp.reason ?? "conflito" });
      continue;
    }

    // 3) padrão institucional explícito (decisões do certame elegíveis)
    if ((entry.cls === "CERTAME_CONFIG" || entry.cls === "CERTAME_SCHEDULE") && isDefaultEligible(v.name) && orgRecord?.payload.defaults && Object.prototype.hasOwnProperty.call(orgRecord.payload.defaults, v.name)) {
      values.set(v.name, { kind: "ORG_DEFAULT", value: orgRecord.payload.defaults[v.name], origin: { label: "Padrão institucional", ref: profileRef } });
    } else if (rejectedDefaults.has(v.name)) {
      problems.set(v.name, { name: v.name, kind: "ORG_DEFAULT", code: "DEFAULT_INCOMPATIBLE", reason: rejectedDefaults.get(v.name)! });
    }
  }

  // Cronograma: equivalência técnica SOMENTE por regra declarada no Perfil da plataforma (valor-base conhecido = decisão registrada ou padrão).
  const rule = platforms?.[BLL_PLATFORM]?.cronograma;
  if (rule) {
    const known: Record<string, unknown> = {};
    for (const n of [SCHEDULE.divulgacao, SCHEDULE.abertura, SCHEDULE.horarioAbertura]) {
      const st = storedAt(catalog, input.processRecord, n);
      const dv = values.get(n);
      const val = st !== undefined && st !== null && st !== "" ? st : dv?.kind === "ORG_DEFAULT" ? dv.value : undefined;
      if (val !== undefined) known[n] = val;
    }
    const derived = deriveSchedule(rule, known);
    for (const [n, d] of derived) {
      if (!catalog.vars.some((x) => x.name === n)) continue;
      values.set(n, { kind: "SCHEDULE", value: d.value, origin: { label: `Cronograma (${d.rule})`, ref: { basis: d.basis.join(","), platform: BLL_PLATFORM, revision: orgRecord?.revision ?? 0 } } });
    }
    // Regra DECLARADA ⇒ a variável é derivada, NUNCA digitada: enquanto a base (data/horário independente) falta, aguarda a base (não é decisão nova).
    const governedByRule: Array<[string, string]> = [];
    if (rule.limitePropostas === "ABERTURA_DA_SESSAO") governedByRule.push([SCHEDULE.fim, SCHEDULE.abertura], [SCHEDULE.horarioFim, SCHEDULE.horarioAbertura]);
    if (rule.inicioPropostas === "PUBLICACAO" && rule.horarioInicioPropostas) governedByRule.push([SCHEDULE.inicio, SCHEDULE.divulgacao]);
    for (const [n, base] of governedByRule) {
      if (derived.has(n) || !catalog.vars.some((x) => x.name === n)) continue;
      problems.set(n, { name: n, kind: "SCHEDULE", code: "SCHEDULE_BASE_MISSING", reason: `derivado pela regra da plataforma; aguarda ${base === SCHEDULE.abertura ? "a data da sessão" : base === SCHEDULE.horarioAbertura ? "o horário da sessão" : "a data prevista de divulgação"}`, fix: "CERTAME_CONFIG" });
    }
  }

  return { values, problems, trParams, trDigest: trParamsDigest(trParams), orgProfile: orgRecord ? { revision: orgRecord.revision, hash: orgRecord.hash } : null };
}

/** Padrões institucionais ELEGÍVEIS para PROPOR no preenchimento dos parâmetros do TR (nunca aplicados sem confirmação humana). */
export function trParamProposals(catalog: VariableCatalog2, orgRecord: GovernedRecord | null): Map<string, { value: unknown; revision: number }> {
  const out = new Map<string, { value: unknown; revision: number }>();
  const defaults = orgRecord?.payload.defaults;
  if (!defaults) return out;
  const check = validateDefaults(catalog, defaults, "read");
  if (!check.ok) return out;
  for (const def of trParamDefs(catalog)) {
    if (isDefaultEligible(def.name) && Object.prototype.hasOwnProperty.call(check.value, def.name)) out.set(def.name, { value: check.value[def.name], revision: orgRecord!.revision });
  }
  return out;
}

/** Carrega o reuso: fatos do TR do PROCESSO (tenant-scoped) + registro do ÓRGÃO já lido. */
export async function loadContextReuse(p: {
  organizationId: number; processId: string; catalog: VariableCatalog2; orgRecord: GovernedRecord | null; asOf: string;
  /** Registro governado do PROCESSO já lido (evita nova leitura); ausente ⇒ tratado como sem registro. */
  processRecord?: GovernedRecord | null;
  /** Data do evento de composição (default = `asOf`). Na revalidação/emissão é a data do M1. */
  compositionDate?: string;
}): Promise<ContextReuse> {
  const [facts, items, budgetDate] = await Promise.all([
    listContextFacts(p.organizationId, p.processId),
    loadItemStructure(p.organizationId, p.processId),
    readPriceResearchBaseDate(p.organizationId, p.processId).catch(() => null),
  ]);
  return buildContextReuse({
    catalog: p.catalog, orgRecord: p.orgRecord, trAssertions: facts, asOf: p.asOf, processRecord: p.processRecord ?? null,
    items, budgetDate, compositionDate: p.compositionDate ?? p.asOf,
  });
}

/** Estrutura canônica dos Itens (item × lote), tenant-scoped; `null` quando o processo não pôde ser resolvido. */
export async function loadItemStructure(organizationId: number, processId: string): Promise<ItemStructure[] | null> {
  const ctx = await resolveProcurementContext({ organizationId, processId }).catch(() => null);
  if (!ctx) return null;
  const lotCode = new Map(ctx.lots.map((l) => [l.id, l.code] as const));
  return ctx.items.map((it) => ({ key: it.key, lotId: it.lotId, lotCode: it.lotId ? lotCode.get(it.lotId) ?? null : null }));
}

/** Define `value` no caminho pontuado sem sobrescrever o que já existe. Retorna se definiu. */
export function setNestedIfAbsent(data: Record<string, unknown>, path: string, value: unknown): boolean {
  const segs = path.split(".");
  let cur = data;
  for (const seg of segs.slice(0, -1)) {
    const next = cur[seg];
    if (next === undefined) cur[seg] = {};
    else if (typeof next !== "object" || next === null || Array.isArray(next)) return false;
    cur = cur[seg] as Record<string, unknown>;
  }
  const leaf = segs[segs.length - 1];
  if (Object.prototype.hasOwnProperty.call(cur, leaf)) return false;
  cur[leaf] = value;
  return true;
}

/**
 * Impressão digital do Perfil de Licitações (papéis + padrões), anexada ao snapshot da fonte POLICY: a identidade institucional
 * (papéis em IDENTITY) não tem chave própria no manifest, então SEM isto a troca de um ocupante só apareceria como
 * COMPOSITION_DRIFT. Com ela, qualquer mudança de papel/padrão entre o M1 e a emissão é SOURCE_CHANGED. `null` quando o órgão não
 * usa papéis nem padrões ⇒ o snapshot (e o digest de manifests anteriores) permanece EXATAMENTE igual.
 */
export function profileFingerprint(record: GovernedRecord | null): string | null {
  const roles = record?.raw.roles, defaults = record?.raw.defaults, platforms = record?.raw.platforms;
  if (!roles && !defaults && !platforms) return null;
  // `platforms` só entra quando existe: o fingerprint de órgãos sem Perfil da plataforma permanece EXATAMENTE o anterior.
  return templateHash(platforms ? { roles: roles ?? null, defaults: defaults ?? null, platforms } : { roles: roles ?? null, defaults: defaults ?? null });
}

// ─── Lineage dos parâmetros estruturados × TR oficial EXATO ─────────────────────────────────────────────────────────

export const TR_STRUCTURED_LINEAGE_UNAVAILABLE = "TR_STRUCTURED_LINEAGE_UNAVAILABLE";
export const TR_STRUCTURED_SOURCE_CHANGED = "TR_STRUCTURED_SOURCE_CHANGED";
export const TR_STRUCTURED_LINEAGE_MESSAGE = "O Termo de Referência oficial selecionado não corresponde aos parâmetros estruturados atuais. Revise/emita a versão correspondente do TR antes de prosseguir.";

/** Digest COMPLETO (SHA-256, 64 hex) do snapshot lógico ATUAL — o mesmo do marcador `trparams:` do TR. */
export const currentTrDigest = (reuse: Pick<ContextReuse, "trDigest">): string => reuse.trDigest;
export const hasStructuredTrParams = (reuse: Pick<ContextReuse, "trParams">): boolean => [...reuse.trParams.values()].some((p) => p.status === "SET");

/**
 * INVARIANTE: o TR oficial pinado e os parâmetros estruturados que o Edital consome pertencem ao MESMO snapshot lógico. O TR emitido
 * carrega o digest dos parâmetros que participaram da versão (`metadata.structuredParamsDigest`, vindo do marcador `trparams:` do
 * rascunho). Compara com o snapshot ATUAL; nunca atribui o estado corrente a um TR sem lineage.
 *  - null  ⇒ compatível (ou não aplicável: TR legado e nenhum parâmetro estruturado confirmado);
 *  - LINEAGE_UNAVAILABLE ⇒ há parâmetros confirmados, mas o TR não registra o snapshot (TR anterior à feature / importado / gerado antes);
 *  - SOURCE_CHANGED ⇒ o snapshot do TR difere do estado atual (parâmetros alterados depois daquela versão, ou limpos).
 */
export async function checkTrStructuredLineage(organizationId: number, trPin: { documentId: string }, reuse: Pick<ContextReuse, "trDigest" | "trParams">): Promise<typeof TR_STRUCTURED_LINEAGE_UNAVAILABLE | typeof TR_STRUCTURED_SOURCE_CHANGED | null> {
  const doc = await getOfficialDocument(trPin.documentId, organizationId);
  const raw = doc?.metadata?.["structuredParamsDigest"];
  const expected = typeof raw === "string" && TR_PARAMS_DIGEST_RE.test(raw) ? raw : null;
  const has = hasStructuredTrParams(reuse);
  if (!expected && !has) return null;
  if (!expected) return TR_STRUCTURED_LINEAGE_UNAVAILABLE;
  return expected === currentTrDigest(reuse) ? null : TR_STRUCTURED_SOURCE_CHANGED;
}

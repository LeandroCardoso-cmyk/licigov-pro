/**
 * Fontes canônicas dos Modelos Institucionais `tpl-catalog/2` — cada uma lê a AUTORIDADE EXISTENTE do domínio e monta os
 * dados no formato de CAMINHOS do catálogo (nada é copiado para um "PARAMS genérico"). Tenant-scoped, fora de transação.
 * Fonte sem dado ⇒ omitida (o composer falha com MISSING_REQUIRED se o catálogo a exigir); fonte inconsistente ⇒
 * `TemplateSourceUnavailableError` (falha fechada).
 *
 *  PROCESS         número/ano do processo e controle de sigilo do orçamento (derivado da DECISÃO de divulgação) + campos governados
 *  IDENTITY        snapshot da identidade institucional (município, CNPJ, endereço, telefone, site) + campos governados do órgão
 *  ITEMS           Itens da contratação CANÔNICOS (HD-01): quantidade = `plannedQuantity`, nunca cotação/manual/IA; valor só se PÚBLICO
 *  BUDGET          estimativa global canônica — só com divulgação PÚBLICA; sigiloso nunca expõe valor (nem no digest)
 *  TR              campos governados "iguais ao TR" (o documento do TR é referenciado por PIN EXATO, não por esta fonte)
 *  CERTAME_CONFIG  configuração decidida do certame (campos governados) — o LiciGov NÃO registra o certame na plataforma
 *  POLICY          política institucional do órgão (campos governados)
 *  NORMATIVE       reference set normativo GOVERNADO e VERIFICADO (gate: sem set verificado ⇒ falha fechada) + campos governados
 *  LIFECYCLE       projeção do ciclo de vida do processo (0313) + campos governados
 *  RESULT          sem autoridade no pré-certame ⇒ OMITIDA (campos pós-homologação renderizam o texto governado "a preencher")
 */
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { procurementProcessesTable } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import { getCurrentDecision } from "../../../db/institutionalDecisions";
import { getProcess } from "../../../db/procurement";
import { resolveActiveReferenceSet } from "../../../db/legalReference";
import type { VariableCatalog2 } from "../../../domain/institutionalTemplates";
import type { CanonicalSourceSnapshot } from "../../../domain/institutionalTemplates/composer";
import {
  applyFieldsToData, participationRegimeFor, type BudgetDisclosure, type GovernedParticipation, type GovernedPayload,
} from "../../../domain/institutionalTemplates/governedSources";
import type { VariableSource2 } from "../../../domain/institutionalTemplates/variableCatalog2";
import { canonicalDocumentItems, loadApprovedContextItems } from "../../authoring/authoringContext";
import { resolveProcurementContext } from "../../canonicalContextService";
import { snapshotInstitutionalIdentity } from "../../institutionalIdentityService";
import { GOVERNED_ORG_SUBJECT, readGovernedRecord, type GovernedRecord } from "../governedFieldsStore";
import { TemplateSourceUnavailableError } from "../ports";
import { resolveEditalProjections, type ProjectedValue } from "../editalProjections";
import {
  TR_STRUCTURED_LINEAGE_MESSAGE, checkTrStructuredLineage, currentTrDigest, hasStructuredTrParams, loadContextReuse, profileFingerprint, setNestedIfAbsent, type ContextReuse,
} from "../editalContextReuse";
import type { DocRefKind2 } from "../../../domain/institutionalTemplates/ast2";
import type { OfficialDocumentPin } from "../../../domain/institutionalTemplates/composer";
import { PROJECTION_BY_VARIABLE, canonicalProjectedPaths } from "../../../domain/institutionalTemplates/canonicalProjectionPolicy";
import { ALWAYS_DERIVED } from "../../../domain/institutionalTemplates/certameAuthority";

const unavailable = (source: string, reason: string, message: string) => new TemplateSourceUnavailableError(source, reason, message);
export const sha256Of = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Divulgação CORRENTE do orçamento do processo; `null` = nenhuma decisão (valores permanecem ocultos). */
export async function readBudgetDisclosure(organizationId: number, processId: string): Promise<BudgetDisclosure | null> {
  const d = await getCurrentDecision(null, organizationId, "procurement.budget_disclosure", processId);
  if (!d) return null;
  if (d.outcome !== "publico" && d.outcome !== "sigiloso") throw unavailable("BUDGET", "DECISION_CORRUPT", "resultado de divulgação fora do contrato");
  return d.outcome;
}

/** Contexto de leitura de UMA composição v2: o catálogo da revisão e os registros governados já lidos. */
export interface SourceReadContext {
  readonly organizationId: number;
  readonly processId: string;
  readonly catalog: VariableCatalog2;
  readonly asOfDate: string;
  /** Documentos oficiais EXATOS já validados pelo pin (geração) ou a autoridade atual (revalidação): base das projeções do TR. */
  readonly official?: Partial<Record<DocRefKind2, OfficialDocumentPin>>;
  /** GERAÇÃO/preflight (pin exato escolhido por pessoa): exige que os parâmetros estruturados do TR pertençam ao snapshot do TR pinado. */
  readonly pinned?: boolean;
  /** Data (AAAA-MM-DD) do evento de composição (M1): a data de emissão do Edital é atribuída por ela. Ausente ⇒ `asOfDate`. */
  readonly compositionDate?: string;
}

interface Memo {
  disclosure?: BudgetDisclosure | null;
  processRecord?: GovernedRecord | null;
  orgRecord?: GovernedRecord | null;
  projections?: Map<string, ProjectedValue>;
  reuse?: ContextReuse;
}

/** Projeções determinísticas (ZERO_REENTRY) das variáveis da fonte: base sobre a qual a decisão humana registrada prevalece. */
async function projectedFor(rc: SourceReadContext, m: Memo, source: VariableSource2): Promise<Record<string, unknown>> {
  if (!m.projections) m.projections = await resolveEditalProjections(rc.organizationId, rc.processId, rc.catalog, rc.official);
  const out: Record<string, unknown> = {};
  for (const v of rc.catalog.vars) {
    const p = v.source === source ? m.projections.get(v.name) : undefined;
    if (p && !v.path.includes(".")) out[v.path] = p.value;
  }
  return out;
}

const declares = (catalog: VariableCatalog2, source: VariableSource2, path: string): boolean => catalog.vars.some((v) => v.source === source && v.path === path);
const compact = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ""));

async function disclosureOf(rc: SourceReadContext, m: Memo): Promise<BudgetDisclosure | null> {
  if (m.disclosure === undefined) m.disclosure = await readBudgetDisclosure(rc.organizationId, rc.processId);
  return m.disclosure;
}
async function processRecordOf(rc: SourceReadContext, m: Memo): Promise<GovernedRecord | null> {
  if (m.processRecord === undefined) m.processRecord = await readGovernedRecord(rc.organizationId, "PROCESS", rc.processId, rc.catalog);
  return m.processRecord;
}
async function orgRecordOf(rc: SourceReadContext, m: Memo): Promise<GovernedRecord | null> {
  if (m.orgRecord === undefined) m.orgRecord = await readGovernedRecord(rc.organizationId, "ORG", GOVERNED_ORG_SUBJECT, rc.catalog);
  return m.orgRecord;
}

/**
 * Aplica a seção governada da fonte sobre os dados (os caminhos de autoridade já foram recusados no registro).
 * `skip` = caminhos cuja autoridade é CANONICAL/projetada: o valor do ledger (legado) é IGNORADO — preservado como história, nunca
 * promovido a autoridade. A decisão humana só vale onde NÃO há autoridade canônica nem projeção disponível.
 */
function withGoverned(source: VariableSource2, data: Record<string, unknown>, record: GovernedRecord | null, skip: ReadonlySet<string> = new Set()): Record<string, unknown> {
  const section = record?.payload.sections[source];
  if (section) {
    const effective = Object.fromEntries(Object.entries(section).filter(([path]) => !skip.has(path)));
    try { applyFieldsToData(data, effective); } catch (e) { throw unavailable(source, "GOVERNED_FIELD_CONFLICT", e instanceof Error ? e.message : "conflito de campos governados"); }
  }
  return data;
}

/** Reuso de contexto (TR estruturado, papéis, padrões institucionais) — lido UMA vez por composição, tenant-scoped. */
async function reuseOf(rc: SourceReadContext, m: Memo): Promise<ContextReuse> {
  if (!m.reuse) {
    const reuse = await loadContextReuse({
      organizationId: rc.organizationId, processId: rc.processId, catalog: rc.catalog, orgRecord: await orgRecordOf(rc, m), asOf: rc.asOfDate.slice(0, 10),
      processRecord: await processRecordOf(rc, m), compositionDate: rc.compositionDate ?? rc.asOfDate.slice(0, 10),
    });
    // INVARIANTE: TR oficial pinado + parâmetros estruturados do MESMO snapshot. Falha fechada; nunca usa o estado novo em silêncio.
    if (rc.pinned && rc.official?.TR) {
      const bad = await checkTrStructuredLineage(rc.organizationId, rc.official.TR, reuse);
      if (bad) throw unavailable("TR", bad, `${bad}: ${TR_STRUCTURED_LINEAGE_MESSAGE}`);
    }
    m.reuse = reuse;
  }
  return m.reuse;
}

/**
 * Aplica o reuso da fonte sobre os dados e devolve os dados governados. Precedência por variável:
 *  - papel institucional e parâmetro estruturado do TR (autoridade): VENCEM o valor governado (legado/humano) do mesmo caminho;
 *  - padrão institucional explícito: só PREENCHE o que nenhuma decisão do processo nem projeção já definiu.
 */
async function govern(
  rc: SourceReadContext, m: Memo, source: VariableSource2, data: Record<string, unknown>, record: GovernedRecord | null, skip: ReadonlySet<string> = new Set(),
): Promise<Record<string, unknown>> {
  const reuse = await reuseOf(rc, m);
  const shadow = new Set(skip);
  const defaults: Array<[string, unknown]> = [];
  for (const v of rc.catalog.vars) {
    if (v.source !== source) continue;
    // PR #288: autoridade DERIVADA (plataforma, itens, orçamento, ciclo de vida): o valor governado/legado do mesmo caminho NUNCA vale,
    // nem quando a origem ainda não tem o dado (falha fechada ⇒ MISSING_REQUIRED apontando a origem, jamais uma segunda autoridade).
    if (ALWAYS_DERIVED(v.name) || reuse.problems.get(v.name)?.kind === "SCHEDULE") shadow.add(v.path);
    const r = reuse.values.get(v.name);
    if (!r) continue;
    if (r.kind === "ORG_DEFAULT") { defaults.push([v.path, r.value]); continue; }
    setNestedIfAbsent(data, v.path, r.value); // projeção canônica já presente (ex.: objeto do TR exato) prevalece
    shadow.add(v.path);
  }
  withGoverned(source, data, record, shadow);
  for (const [path, value] of defaults) setNestedIfAbsent(data, path, value);
  // Snapshot lógico dos parâmetros do TR no próprio snapshot da fonte TR (entra no digest do M1). Só quando há parâmetros confirmados.
  if (source === "TR" && hasStructuredTrParams(reuse)) data["parametrosEstruturadosDigest"] = currentTrDigest(reuse);
  return data;
}

const present = (data: Record<string, unknown>): CanonicalSourceSnapshot["data"] | null => (Object.keys(data).length ? data : null);

/** Caminhos da fonte cujo valor governado NÃO vale: projeção CANONICAL (sempre) e projeção do TR exato (quando o TR traz o dado). */
async function shadowedPaths(rc: SourceReadContext, m: Memo, source: VariableSource2): Promise<ReadonlySet<string>> {
  if (!m.projections) m.projections = await resolveEditalProjections(rc.organizationId, rc.processId, rc.catalog, rc.official);
  const skip = new Set(canonicalProjectedPaths(rc.catalog.vars, source));
  for (const v of rc.catalog.vars) {
    if (v.source === source && PROJECTION_BY_VARIABLE[v.name]?.key === "TR_OBJECT" && m.projections.has(v.name)) skip.add(v.path);
  }
  return skip;
}

// ─── ITEMS ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface ItemRow {
  item: string; descricao: string; codigoCatalogacao?: string; unidade: string; quantidade: number; regimeParticipacao?: string;
  valorUnitarioEstimado?: number; valorTotalEstimado?: number;
}

/** Itens canônicos → linhas do quadro. Valores monetários SÓ com divulgação pública (sigiloso/ausente ⇒ chaves inexistentes). */
async function itemRows(rc: SourceReadContext, disclosure: BudgetDisclosure | null, participation: GovernedParticipation | undefined): Promise<ItemRow[]> {
  const ctx = await resolveProcurementContext({ organizationId: rc.organizationId, processId: rc.processId }).catch(() => {
    throw unavailable("ITEMS", "PROCESS_NOT_FOUND", "processo inexistente nesta organização");
  });
  if (ctx.items.length === 0) throw unavailable("ITEMS", "CANONICAL_ITEMS_REQUIRED", "o processo não possui Itens da contratação canônicos (HD-01)");
  const { approvedItems } = await loadApprovedContextItems({ organizationId: rc.organizationId, processId: rc.processId });
  const { items, state } = canonicalDocumentItems(ctx, approvedItems);
  if (state.missingPlannedQuantity.length > 0) {
    throw unavailable("ITEMS", "PLANNED_QUANTITY_MISSING", `${state.missingPlannedQuantity.length} item(ns) sem quantidade prevista canônica (ou em conflito) — a quantidade nunca vem de cotação/IA`);
  }
  const showValues = disclosure === "publico";
  return items.map((it, i): ItemRow => {
    const priced = showValues && !it.priceBlockedReason && it.averagePriceCents > 0;
    const regime = participationRegimeFor(participation, { itemKey: it.id, lotCode: it.lotCode ?? null });
    return {
      item: it.lotCode ? `Lote ${it.lotCode} — ${i + 1}` : String(i + 1),
      descricao: it.description, unidade: it.unit, quantidade: it.quantity,
      ...(it.confirmedCatalogCode ? { codigoCatalogacao: it.confirmedCatalogCode } : {}),
      ...(regime ? { regimeParticipacao: regime } : {}),
      ...(priced ? { valorUnitarioEstimado: it.averagePriceCents, valorTotalEstimado: Math.round(it.averagePriceCents * it.quantity) } : {}),
    };
  });
}

// ─── Dispatcher v2 ──────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Resolve as fontes pedidas para o catálogo v2. RESULT é omitida (sem autoridade no pré-certame). Qualquer fonte sem backing ou
 * inconsistente lança `TemplateSourceUnavailableError`; fonte sem dado nenhum é omitida (o composer decide pela obrigatoriedade).
 */
export async function resolveSourcesV2(
  rc: SourceReadContext, sources: readonly VariableSource2[],
): Promise<Partial<Record<VariableSource2, CanonicalSourceSnapshot>>> {
  const out: Partial<Record<VariableSource2, CanonicalSourceSnapshot>> = {};
  const memo: Memo = {};
  const put = (source: VariableSource2, data: Record<string, unknown>) => { const d = present(data); if (d) out[source] = { organizationId: rc.organizationId, data: d }; };

  for (const source of [...new Set(sources)].sort()) {
    switch (source) {
      case "PROCESS": {
        const p = await getProcess(rc.processId, rc.organizationId);
        if (!p) throw unavailable("PROCESS", "PROCESS_NOT_FOUND", "processo inexistente nesta organização");
        const disclosure = await disclosureOf(rc, memo);
        const year = /^(\d{4})\//.exec(p.processNumber)?.[1];
        const data = compact({
          ...(await projectedFor(rc, memo, "PROCESS")),
          ...(declares(rc.catalog, "PROCESS", "numeroProcesso") ? { numeroProcesso: p.processNumber } : {}),
          ...(declares(rc.catalog, "PROCESS", "ano") && year ? { ano: Number(year) } : {}),
          // O sigilo do orçamento é DERIVADO da decisão de divulgação (nunca digitado): fonte única da verdade.
          ...(declares(rc.catalog, "PROCESS", "orcamentoSigilosoSimNao") && disclosure ? { orcamentoSigilosoSimNao: disclosure === "sigiloso" } : {}),
        });
        put(source, await govern(rc, memo, source, data, await processRecordOf(rc, memo), await shadowedPaths(rc, memo, "PROCESS")));
        break;
      }
      case "IDENTITY": {
        const { snapshot } = await snapshotInstitutionalIdentity(rc.organizationId);
        const cnpj = snapshot.cnpj ? snapshot.cnpj.replace(/\D/g, "") : undefined;
        const data = compact({
          ...(await projectedFor(rc, memo, "IDENTITY")),
          ...(declares(rc.catalog, "IDENTITY", "municipioNome") ? { municipioNome: snapshot.municipio } : {}),
          ...(declares(rc.catalog, "IDENTITY", "municipioCnpj") ? { municipioCnpj: cnpj } : {}),
          ...(declares(rc.catalog, "IDENTITY", "municipioEndereco") ? { municipioEndereco: snapshot.address } : {}),
          ...(declares(rc.catalog, "IDENTITY", "municipioTelefone") ? { municipioTelefone: snapshot.phone } : {}),
          ...(declares(rc.catalog, "IDENTITY", "municipioSite") ? { municipioSite: snapshot.website } : {}),
        });
        put(source, await govern(rc, memo, source, data, await orgRecordOf(rc, memo), await shadowedPaths(rc, memo, "IDENTITY")));
        break;
      }
      case "POLICY": {
        const org = await orgRecordOf(rc, memo);
        const data = await govern(rc, memo, source, {}, org);
        // Impressão digital do Perfil (papéis/padrões): troca de ocupante/padrão entre M1 e emissão ⇒ SOURCE_CHANGED.
        const fp = profileFingerprint(org);
        if (fp) data["perfilLicitacoes"] = fp;
        put(source, data);
        break;
      }
      case "TR": put(source, await govern(rc, memo, source, await projectedFor(rc, memo, "TR"), await processRecordOf(rc, memo), await shadowedPaths(rc, memo, "TR"))); break;
      case "CERTAME_CONFIG": put(source, await govern(rc, memo, source, {}, await processRecordOf(rc, memo))); break;
      case "ITEMS": {
        const record = await processRecordOf(rc, memo);
        const rows = await itemRows(rc, await disclosureOf(rc, memo), record?.payload.participation);
        const data = await govern(rc, memo, source, declares(rc.catalog, "ITEMS", "quadroItensContratacao") ? { quadroItensContratacao: rows } : {}, record);
        put(source, data);
        break;
      }
      case "BUDGET": {
        const disclosure = await disclosureOf(rc, memo);
        const data: Record<string, unknown> = {};
        // SIGILOSO (ou sem decisão) nunca expõe valor: a chave simplesmente não existe (nem no digest do manifest).
        if (disclosure === "publico" && declares(rc.catalog, "BUDGET", "valorEstimado")) {
          const ctx = await resolveProcurementContext({ organizationId: rc.organizationId, processId: rc.processId }).catch(() => {
            throw unavailable("BUDGET", "PROCESS_NOT_FOUND", "processo inexistente nesta organização");
          });
          const { priceContext } = ctx;
          if (priceContext.complete && priceContext.estimatedTotalCents !== null) data.valorEstimado = priceContext.estimatedTotalCents;
        }
        put(source, await govern(rc, memo, source, data, await processRecordOf(rc, memo)));
        break;
      }
      case "NORMATIVE": {
        // Gate: reference set GOVERNADO, ativo, aprovado e íntegro para a data. Sem ele a fonte NÃO existe (falha fechada).
        let set;
        try { set = (await resolveActiveReferenceSet(rc.asOfDate)).set; } catch (err) {
          throw unavailable("NORMATIVE", (err as { code?: string }).code ?? "REFERENCE_SET_UNAVAILABLE", "não há reference set normativo ativo, aprovado e íntegro para a data");
        }
        const data = await govern(rc, memo, source, {
          referenceSet: { version: set.version, contentHash: set.contentHash, approvedReferenceHash: set.approvedReferenceHash, effectiveFrom: set.effectiveFrom, ...(set.effectiveTo ? { effectiveTo: set.effectiveTo } : {}) },
        }, await processRecordOf(rc, memo));
        put(source, data);
        break;
      }
      case "LIFECYCLE": {
        const db = await getDb();
        if (!db) throw unavailable("LIFECYCLE", "DB_UNAVAILABLE", "banco indisponível");
        const rows = await db.select({
          generationNo: procurementProcessesTable.generationNo, lifecycleState: procurementProcessesTable.lifecycleState, lifecycleRevision: procurementProcessesTable.lifecycleRevision,
        }).from(procurementProcessesTable).where(and(eq(procurementProcessesTable.id, rc.processId), eq(procurementProcessesTable.organizationId, rc.organizationId))).limit(1);
        if (rows.length !== 1) throw unavailable("LIFECYCLE", "PROCESS_NOT_FOUND", "processo inexistente nesta organização");
        const r = rows[0];
        put(source, await govern(rc, memo, source, { ciclo: { estado: r.lifecycleState, geracao: r.generationNo, revisao: r.lifecycleRevision } }, await processRecordOf(rc, memo)));
        break;
      }
      case "RESULT": break; // sem autoridade: omitida (nunca inventada)
      case "PARAMS": throw unavailable("PARAMS", "UNSUPPORTED_IN_V2", "PARAMS não existe no catálogo v2: cada variável aponta para a fonte real");
      case "DFD": case "ETP": break; // documentos oficiais entram por docRef/pin, não por dados
      default: throw unavailable(String(source), "UNKNOWN_SOURCE", "fonte fora do contrato");
    }
  }
  return out;
}

export type { GovernedPayload };

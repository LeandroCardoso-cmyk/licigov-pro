/**
 * Fontes canônicas dos Modelos Institucionais — cada uma lê a AUTORIDADE EXISTENTE do domínio (nada é inventado, nada é
 * copiado para um "PARAMS genérico"). Tenant-scoped, fora de transação. Fonte ausente ⇒ omitida (o composer falha com
 * MISSING_REQUIRED se o catálogo a exigir); fonte inconsistente/sem backing ⇒ `TemplateSourceUnavailableError`.
 *
 *  ITEMS           Itens da contratação CANÔNICOS (HD-01): quantidade = `plannedQuantity`; nunca cotação/paralelo/IA
 *  CERTAME_CONFIG  decisão `certame_configuration` (ledger institucional) do processo
 *  POLICY          decisões `institutional_policy` correntes do órgão
 *  BUDGET          divulgação do orçamento (decisão) + estimativa global canônica — valores só quando PÚBLICO
 *  NORMATIVE       reference set normativo GOVERNADO e VERIFICADO (ativo, aprovado, hash íntegro)
 *  LIFECYCLE       ciclo de vida do processo (geração/estado/revisão) — projeção do lifecycle 0313
 *  RESULT          sem autoridade ⇒ falha fechada (documento pré-certame não tem resultado)
 */
import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { procurementProcessesTable } from "../../../../drizzle/schema";
import { getDb } from "../../../db/connection";
import { getCurrentDecision, listCurrentDecisionsBySubjectType } from "../../../db/institutionalDecisions";
import { getProcess } from "../../../db/procurement";
import { resolveActiveReferenceSet, getReferenceEntries, getReferenceOverrides } from "../../../db/legalReference";
import { LEGAL_REFERENCE_V1_META } from "../../../domain/legalReference/manifestV1";
import { formatQuantity } from "../../../domain/authoritativeItems";
import { formatBRL } from "../../../domain/money";
import { windowContains } from "../../../domain/legalReference/readiness";
import {
  CERTAME_CONFIG_SCHEMA, POLICY_PAYLOAD_SCHEMA, decodeGovernedPayload, participationRegimeFor, validateCertameConfig, validatePolicyPayload,
  type BudgetDisclosure, type CertameConfig,
} from "../../../domain/institutionalTemplates/governedSources";
import type { CanonicalSourceSnapshot } from "../../../domain/institutionalTemplates/composer";
import type { VariableSource } from "../../../domain/institutionalTemplates/variableCatalog";
import { canonicalDocumentItems, loadApprovedContextItems } from "../../authoring/authoringContext";
import { resolveProcurementContext } from "../../canonicalContextService";
import { TemplateSourceUnavailableError } from "../ports";

const unavailable = (source: string, reason: string, message: string) => new TemplateSourceUnavailableError(source, reason, message);

// ─── Decisões governadas (leitura) ───────────────────────────────────────────────────────────────────────────────

/** Configuração CORRENTE do certame do processo (decodificada e REVALIDADA); `null` = nenhuma decisão registrada. */
export async function readCertameConfig(organizationId: number, processId: string): Promise<{ config: CertameConfig; hash: string; revision: number } | null> {
  const d = await getCurrentDecision(null, organizationId, "procurement.certame_config", processId);
  if (!d) return null;
  const decoded = decodeGovernedPayload(d.evidence, CERTAME_CONFIG_SCHEMA);
  const valid = decoded ? validateCertameConfig(decoded.payload) : null;
  if (!decoded || !valid?.ok) throw unavailable("CERTAME_CONFIG", "EVIDENCE_CORRUPT", "a configuração registrada não passa na verificação de integridade/contrato");
  return { config: valid.value, hash: decoded.hash, revision: d.revision };
}

/** Divulgação CORRENTE do orçamento do processo; `null` = nenhuma decisão (valores permanecem ocultos). */
export async function readBudgetDisclosure(organizationId: number, processId: string): Promise<BudgetDisclosure | null> {
  const d = await getCurrentDecision(null, organizationId, "procurement.budget_disclosure", processId);
  if (!d) return null;
  if (d.outcome !== "publico" && d.outcome !== "sigiloso") throw unavailable("BUDGET", "DECISION_CORRUPT", "resultado de divulgação fora do contrato");
  return d.outcome;
}

// ─── ITEMS ──────────────────────────────────────────────────────────────────────────────────────────────────────

export async function itemsSnapshot(organizationId: number, processId: string): Promise<CanonicalSourceSnapshot> {
  const ctx = await resolveProcurementContext({ organizationId, processId }).catch(() => {
    throw unavailable("ITEMS", "PROCESS_NOT_FOUND", "processo inexistente nesta organização");
  });
  if (ctx.items.length === 0) throw unavailable("ITEMS", "CANONICAL_ITEMS_REQUIRED", "o processo não possui Itens da contratação canônicos (HD-01)");
  const { approvedItems } = await loadApprovedContextItems({ organizationId, processId });
  const { items, state } = canonicalDocumentItems(ctx, approvedItems);
  if (state.missingPlannedQuantity.length > 0) {
    throw unavailable("ITEMS", "PLANNED_QUANTITY_MISSING", `${state.missingPlannedQuantity.length} item(ns) sem quantidade prevista canônica (ou em conflito) — a quantidade nunca vem de cotação/IA`);
  }
  const [certame, disclosure] = await Promise.all([readCertameConfig(organizationId, processId), readBudgetDisclosure(organizationId, processId)]);
  const valuesDisclosed = disclosure === "publico";
  const lotName: Record<string, string> = Object.fromEntries(ctx.lots.map((l) => [l.code, l.name]));
  interface Row {
    ordinal: number; itemKey: string; lotCode: string | null; description: string; unit: string; quantity: number;
    catalogCode: string | null; participationRegime: string | null; unitReferencePriceCents?: number; estimatedTotalCents?: number;
  }
  const rows: Row[] = items.map((it, i) => {
    const priced = valuesDisclosed && !it.priceBlockedReason && it.averagePriceCents > 0;
    const participation = participationRegimeFor(certame?.config ?? null, { itemKey: it.id, lotCode: it.lotCode ?? null });
    return {
      ordinal: i + 1, itemKey: it.id, lotCode: it.lotCode ?? null, description: it.description, unit: it.unit, quantity: it.quantity,
      catalogCode: it.confirmedCatalogCode, participationRegime: participation,
      ...(priced ? { unitReferencePriceCents: it.averagePriceCents, estimatedTotalCents: Math.round(it.averagePriceCents * it.quantity) } : {}),
    };
  });
  const quadroLinhas = rows.map((r) => [
    `${r.ordinal}.`,
    r.lotCode ? `[Lote ${r.lotCode}${lotName[r.lotCode] ? ` — ${lotName[r.lotCode]}` : ""}]` : null,
    r.description, `Unidade: ${r.unit}`, `Quantidade: ${formatQuantity(r.quantity)}`,
    r.catalogCode ? `Código: ${r.catalogCode}` : null,
    r.participationRegime ? `Participação: ${r.participationRegime}` : null,
    r.unitReferencePriceCents !== undefined ? `Valor unitário de referência: ${formatBRL(r.unitReferencePriceCents)}` : null,
    r.estimatedTotalCents !== undefined ? `Valor estimado: ${formatBRL(r.estimatedTotalCents)}` : null,
  ].filter((x): x is string => x !== null).join(" — "));
  return {
    organizationId,
    data: {
      itemCount: rows.length, lotCount: ctx.lots.length, valuesDisclosed,
      lots: ctx.lots.map((l) => ({ code: l.code, name: l.name })), items: rows, quadroLinhas,
      ...(valuesDisclosed && ctx.priceContext.estimatedTotalCents !== null && ctx.priceContext.complete ? { estimatedTotalCents: ctx.priceContext.estimatedTotalCents } : {}),
    },
  };
}

// ─── CERTAME_CONFIG / POLICY / BUDGET ───────────────────────────────────────────────────────────────────────────

export async function certameSnapshot(organizationId: number, processId: string): Promise<CanonicalSourceSnapshot | null> {
  const found = await readCertameConfig(organizationId, processId);
  if (!found) return null;
  const { schema: _s, ...config } = found.config;
  const windows = (found.config.operationalWindows ?? []).map((w) => `${w.key}: ${w.startTime}–${w.endTime}`);
  return { organizationId, data: { ...config, ...(windows.length ? { operationalWindowLines: windows } : {}) } };
}

export async function policySnapshot(organizationId: number): Promise<CanonicalSourceSnapshot | null> {
  const decisions = await listCurrentDecisionsBySubjectType(organizationId, "institutional.policy");
  if (decisions.length === 0) return null;
  const data: Record<string, unknown> = {};
  for (const d of decisions) {
    const decoded = decodeGovernedPayload(d.evidence, POLICY_PAYLOAD_SCHEMA);
    const valid = decoded ? validatePolicyPayload(decoded.payload) : null;
    if (!decoded || !valid?.ok) throw unavailable("POLICY", "EVIDENCE_CORRUPT", `a política ${d.subjectId} não passa na verificação de integridade/contrato`);
    data[d.subjectId] = valid.value;
  }
  return { organizationId, data };
}

export async function budgetSnapshot(organizationId: number, processId: string): Promise<CanonicalSourceSnapshot | null> {
  const disclosure = await readBudgetDisclosure(organizationId, processId);
  if (!disclosure) return null;
  // SIGILOSO nunca expõe valor: o snapshot só diz que é sigiloso (o valor não entra no documento nem no digest).
  if (disclosure === "sigiloso") return { organizationId, data: { disclosure } };
  const ctx = await resolveProcurementContext({ organizationId, processId }).catch(() => {
    throw unavailable("BUDGET", "PROCESS_NOT_FOUND", "processo inexistente nesta organização");
  });
  const { priceContext } = ctx;
  return {
    organizationId,
    data: {
      disclosure, estimateComplete: priceContext.complete,
      ...(priceContext.complete && priceContext.estimatedTotalCents !== null ? { estimatedTotalCents: priceContext.estimatedTotalCents } : {}),
    },
  };
}

// ─── NORMATIVE ──────────────────────────────────────────────────────────────────────────────────────────────────

const SAFE_KEY = (locator: string) => locator.replace(/[^A-Za-z0-9_]/g, "_");

/** Reference set GOVERNADO ativo (aprovado, hash íntegro, vigente hoje). Sem set verificado ⇒ falha fechada (nunca texto livre). */
export async function normativeSnapshot(organizationId: number, asOfDate: string): Promise<CanonicalSourceSnapshot> {
  let resolved;
  try { resolved = await resolveActiveReferenceSet(asOfDate); } catch (err) {
    throw unavailable("NORMATIVE", (err as { code?: string }).code ?? "REFERENCE_SET_UNAVAILABLE", "não há reference set normativo ativo, aprovado e íntegro para a data");
  }
  const { set } = resolved;
  const [entries, overrides] = await Promise.all([getReferenceEntries(set.id), getReferenceOverrides(set.id)]);
  const out: Record<string, unknown> = {};
  for (const e of [...entries].sort((a, b) => (a.canonicalLocator < b.canonicalLocator ? -1 : 1))) {
    const key = SAFE_KEY(e.canonicalLocator);
    if (key in out) throw unavailable("NORMATIVE", "LOCATOR_COLLISION", `locators colidem após normalização: ${e.canonicalLocator}`);
    const value = overrides.filter((o) => o.canonicalLocator === e.canonicalLocator && windowContains({ effectiveFrom: o.effectiveFrom, effectiveTo: o.effectiveTo ?? null }, asOfDate));
    out[key] = {
      display: e.canonicalDisplay, hypothesisSummary: e.hypothesisSummary, procurementType: e.procurementType,
      sourceAuthority: e.sourceAuthority, sourceIdentifier: e.sourceIdentifier, sourceUrl: e.sourceUrl, contentHash: e.contentHash,
      ...(e.publicationDate ? { publicationDate: e.publicationDate } : {}),
      ...(value.length === 1 ? { valueCents: value[0].valueCents } : {}),
    };
  }
  return {
    organizationId,
    data: {
      law: LEGAL_REFERENCE_V1_META.law, jurisdiction: LEGAL_REFERENCE_V1_META.jurisdiction,
      referenceSetVersion: set.version, referenceSetContentHash: set.contentHash, approvedReferenceHash: set.approvedReferenceHash,
      effectiveFrom: set.effectiveFrom, ...(set.effectiveTo ? { effectiveTo: set.effectiveTo } : {}),
      ...(set.sourceAuthority ? { sourceAuthority: set.sourceAuthority } : {}), ...(set.sourceIdentifier ? { sourceIdentifier: set.sourceIdentifier } : {}),
      ...(set.verificationMethod ? { verificationMethod: set.verificationMethod } : {}),
      entries: out,
    },
  };
}

// ─── LIFECYCLE ──────────────────────────────────────────────────────────────────────────────────────────────────

export async function lifecycleSnapshot(organizationId: number, processId: string): Promise<CanonicalSourceSnapshot | null> {
  const process = await getProcess(processId, organizationId);
  if (!process) return null;
  const db = await getDb();
  if (!db) throw unavailable("LIFECYCLE", "DB_UNAVAILABLE", "banco indisponível");
  const rows = await db.select({
    lineageId: procurementProcessesTable.lineageId, generationNo: procurementProcessesTable.generationNo,
    lifecycleState: procurementProcessesTable.lifecycleState, lifecycleRevision: procurementProcessesTable.lifecycleRevision,
  }).from(procurementProcessesTable).where(and(eq(procurementProcessesTable.id, processId), eq(procurementProcessesTable.organizationId, organizationId))).limit(1);
  if (rows.length !== 1) return null;
  const r = rows[0];
  return {
    organizationId,
    data: {
      state: r.lifecycleState, generation: r.generationNo, revision: r.lifecycleRevision,
      ...(r.lineageId ? { lineageId: r.lineageId } : {}), stage: process.currentStage, status: process.status,
    },
  };
}

export const resultSource = (): never => {
  throw unavailable("RESULT", "NO_AUTHORITY", "não existe autoridade canônica de resultado do certame neste contrato (documento pré-certame)");
};

export const sha256Of = (s: string): string => createHash("sha256").update(s).digest("hex");

export type ResolvableSource = Exclude<VariableSource, "DFD" | "ETP" | "TR" | "PROCESS" | "IDENTITY" | "PARAMS">;

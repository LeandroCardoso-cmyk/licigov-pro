/**
 * Contexto Canônico da Contratação — serviço de RESOLUÇÃO (leitura) e de REGISTRO de afirmações.
 *
 * Resolve a partir das fontes EXISTENTES (nada duplicado): Processo (número/objeto),
 * Organização (identidade institucional), Itens Inteligentes (evidência de preço + descrição/unidade
 * observadas) e o ledger `procurement_context_facts` (fatos informados por humanos, com proveniência).
 * Toda a política de autoridade/conflito está no domínio (canonicalProcurementContext.ts).
 *
 * Multi-tenant: organizationId SEMPRE do contexto autenticado; o processo é carregado por
 * (processId, organizationId) — tenant B nunca resolve o contexto do tenant A.
 */
import { TRPCError } from "@trpc/server";
import { serviceLogger } from "./observabilityService";
import { getProcess, listIntelligentItems, type ProcurementExecutor } from "../db/procurement";
import { getOrganizationById } from "../db/organizations";
import { appendContextFacts, listContextFacts, type NewFactAssertion } from "../db/procurementContext";
import { listProcurementItems, listProcurementLots, listItemSourceLinks } from "../db/procurementItems";
import {
  isSourceAllowed, resolveCanonicalContext, type ProcurementCanonicalContext,
} from "../domain/canonicalProcurementContext";

const log = serviceLogger("CanonicalContextService");

export async function resolveProcurementContext(p: {
  organizationId: number; processId: string; correlationId?: string; executor?: ProcurementExecutor;
}): Promise<ProcurementCanonicalContext> {
  const t0 = Date.now();
  const process = await getProcess(p.processId, p.organizationId);
  if (!process) throw new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado nesta organização." });

  // O usuário que criou/opera o Processo NÃO é o "Responsável pela demanda" (não é lido aqui).
  const [org, items, assertions, pItems, lots, links] = await Promise.all([
    getOrganizationById(p.organizationId).catch(() => null),
    listIntelligentItems(p.processId, p.organizationId),
    listContextFacts(p.organizationId, p.processId, p.executor),
    listProcurementItems(p.organizationId, p.processId, p.executor),
    listProcurementLots(p.organizationId, p.processId, p.executor),
    listItemSourceLinks(p.organizationId, p.processId, p.executor),
  ]);

  const ctx = resolveCanonicalContext({
    organizationId: p.organizationId,
    processId: p.processId,
    process: {
      number: process.processNumber, object: process.object,
      responsibleUserId: process.responsibleUser, createdAt: process.createdAt,
    },
    organization: org ? { name: org.nome ?? null, municipio: org.municipio ?? null, uf: org.uf ?? null } : null,
    assertions: assertions ?? [],
    intelligentItems: (items ?? []).map((i) => ({
      id: i.id, description: i.description, unit: i.unit, quantity: i.quantity, status: i.status,
      averagePriceCents: i.averagePriceCents, quoteCount: i.quoteCount,
    })),
    procurementItems: (pItems ?? []).map((i) => ({
      id: i.id, description: i.description, unit: i.unit, lotId: i.lotId, ordinal: i.ordinal,
      status: i.status, revision: i.revision, fingerprint: i.fingerprint,
    })),
    lots: (lots ?? []).map((l) => ({ id: l.id, code: l.code, name: l.name, ordinal: l.ordinal, status: l.status })),
    // Evidência de preço = vínculo HUMANO item canônico → Item Inteligente (Pesquisa de Preços).
    priceLinks: (links ?? []).filter((l) => l.sourceType === "price_research").map((l) => ({ itemId: l.itemId, intelligentItemId: l.sourceId })),
  });

  log.info("canonical_context_resolved", {
    organizationId: p.organizationId, processId: p.processId, correlationId: p.correlationId,
    contextVersion: ctx.version, contextDigest: ctx.digest.slice(0, 16),
    knownFields: ctx.stats.knownFields, unknownFields: ctx.stats.unknownFields, conflictCount: ctx.stats.conflictCount,
    items: ctx.items.length, lots: ctx.lots.length, durationMs: Date.now() - t0,
  });
  return ctx;
}

/**
 * Registra afirmações de fato (append-only, idempotente). A POLÍTICA é aplicada também na escrita:
 * fonte não autorizada para o caminho (ex.: price_research → plannedQuantity; ai_draft → qualquer fato)
 * é recusada — nunca gravada para depois ser "ignorada".
 */
export async function recordContextAssertions(p: {
  organizationId: number; processId: string; correlationId: string;
  facts: readonly NewFactAssertion[]; executor?: ProcurementExecutor;
}): Promise<number> {
  for (const f of p.facts) {
    if (!isSourceAllowed(f.path, f.sourceType)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `CONTEXT_SOURCE_NOT_ALLOWED: a fonte "${f.sourceType}" não pode afirmar "${f.path}".` });
    }
  }
  const inserted = await appendContextFacts(p.organizationId, p.processId, p.facts, p.correlationId, p.executor);
  if (inserted > 0) {
    log.info("canonical_context_field_changed", {
      organizationId: p.organizationId, processId: p.processId, correlationId: p.correlationId,
      inserted, paths: p.facts.map((f) => f.path).slice(0, 50),
      sources: [...new Set(p.facts.map((f) => f.sourceType))],
    });
  }
  return inserted;
}

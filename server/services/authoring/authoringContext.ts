/**
 * P0 piloto — CONTEXTO REAL DE AUTORIA do ETP e do TR (generaliza o Context Builder do Edital).
 *
 *   ETP ← processo + DFD (+ itens/pesquisa, se houver)                      [art. 18 da Lei 14.133/2021]
 *   TR  ← processo + DFD + ETP + Itens Inteligentes APROVADOS + cotações +
 *         classificação CONFIRMADA (ledger catmat_decisions)                [art. 6º, XXIII]
 *
 * Hardening P0 — SNAPSHOT CANÔNICO. O contexto é construído em duas etapas:
 *   1) `snapshot` = TUDO (e só) o que a autoria consome: processo (objeto, número), recorte EFETIVO dos
 *      documentos (hash do recorte + cobertura full/partial + seções), itens aprovados (descrição, qtd,
 *      unidade, média em centavos, nº de cotações válidas, classificação confirmada, sugestão, estado da
 *      fonte) com as cotações (fornecedor, marca, modelo, valor) e o nº de itens pendentes;
 *   2) o prompt e o quadro autoritativo são RENDERIZADOS a partir do snapshot.
 *   `sourcesDigest = SHA-256(JSON canônico do snapshot)`. Regra: altera o prompt ⇔ altera o digest
 *   (ordem física das cotações/itens NÃO altera — conjuntos ordenados deterministicamente).
 *
 * Regras mantidas: fonte ausente → `[REVISAR: …]` explícito; números NÃO são da IA (quadro autoritativo do
 * servidor); documento importado ≡ documento gerado; tenant-scoped.
 */
import { getProcess, listIntelligentItems, getGeneratedDocumentByKind } from "../../db/procurement";
import { getLatestCatmatDecisionsForItems } from "../../db/catmatGovernance";
import {
  AUTHORITATIVE_ITEMS_CONTRACT_VERSION, computeItemEstimates, renderAuthoritativeItemsBlock, formatQuantity,
  type AuthoritativeItemInput, type AuthoritativeItemsEstimate,
} from "../../domain/authoritativeItems";
import { formatBRL, reaisToCents } from "../../domain/money";
import { draftContentHash } from "../../domain/generatedDocument";
import { canonicalDigest, selectDocumentExcerpt, sha256Hex, type CanonicalValue } from "../../domain/canonicalJson";
import { listProcurementItems } from "../../db/procurementItems";
import { resolveProcurementContext } from "../canonicalContextService";
import type { ProcurementCanonicalContext } from "../../domain/canonicalProcurementContext";

export const AUTHORING_CONTEXT_VERSION = "authoring-context/2.0";

/** Orçamento (caracteres) do recorte de cada documento-base no contexto da autoria. */
export const AUTHORING_DOC_BUDGET = 6000;
const MAX_ITEMS_IN_PROMPT = 60;

export type ContextualKind = "etp" | "tr";

export interface UpstreamDoc {
  readonly present: boolean;
  readonly status: string | null;
  readonly contentHash: string | null;
  readonly content: string;
  /** "import" quando o rascunho veio de um documento importado (informativo; não muda o tratamento). */
  readonly origin: "import" | "generated" | "manual" | null;
}

/** Cotação consumida pela autoria (apenas campos renderizados). */
export interface ContextQuote {
  readonly quoteId: string;
  readonly supplier: string;
  readonly brand: string;
  readonly model: string;
  /** Centavos; null = sem preço (não entra na média nem na contagem). */
  readonly valueCents: number | null;
}

/** Item aprovado com os dados necessários à autoria (já resolvidos). */
export interface ContextItem extends AuthoritativeItemInput {
  readonly quotes: readonly ContextQuote[];
  /** current | source_changed | review_required */
  readonly sourceState: string;
}

export interface DocumentAuthoringInputs {
  readonly organizationId: number;
  readonly processId: string;
  readonly kind: ContextualKind;
  readonly object: string;
  readonly processObject: string | null;
  readonly processNumber: string | null;
  readonly dfd: UpstreamDoc | null;
  readonly etp: UpstreamDoc | null;
  readonly approvedItems: readonly ContextItem[];
  /** Itens ainda não aprovados (o TR usa SÓ os aprovados; a contagem aparece no prompt ⇒ entra no digest). */
  readonly pendingItemCount: number;
  /**
   * Contexto Canônico (TR) — presente ⇔ o processo tem Itens da contratação. Nesse modo `approvedItems` já
   * vem dos ITENS CANÔNICOS (quantidade = PREVISTA; preço = referência vinculada) e a ordem é a oficial.
   */
  readonly canonical?: CanonicalTRState;
}

/** Estado do modo canônico do TR (ver `canonicalTRItems`). */
export interface CanonicalTRState {
  readonly contextDigest: string;
  /** Itens canônicos SEM quantidade prevista (ou em conflito) — bloqueiam a geração (fail-closed). */
  readonly missingPlannedQuantity: ReadonlyArray<{ id: string; description: string }>;
  /** Itens Inteligentes aprovados que NÃO estão vinculados a nenhum item da contratação — bloqueiam. */
  readonly unlinkedApprovedItemCount: number;
}

export interface SourceVersion {
  readonly present: boolean; readonly status: string | null; readonly contentHash: string | null; readonly origin: string | null;
  /** Cobertura do recorte consumido: full | partial (null quando ausente). */
  readonly coverage: "full" | "partial" | null;
}

export interface DocumentAuthoringContext {
  readonly contractVersion: typeof AUTHORING_CONTEXT_VERSION;
  readonly kind: ContextualKind;
  readonly promptContext: string;
  readonly usedSources: string[];
  readonly missing: string[];
  readonly sourcesDigest: string;
  /** O snapshot canônico (o que efetivamente alimentou prompt + quadro). */
  readonly snapshot: CanonicalValue;
  readonly sourceVersions: { dfd: SourceVersion; etp: SourceVersion };
  readonly lineageMarkers: string[];
  readonly authoritativeBlock: string | null;
  readonly estimate: AuthoritativeItemsEstimate;
  readonly pendingItemCount: number;
  /** "canonical_planned" = quantidade PREVISTA dos Itens da contratação; "legacy" = quantidade da cotação (processos sem Itens Canônicos). */
  readonly quantitySource: "canonical_planned" | "legacy";
  readonly canonical: CanonicalTRState | null;
}

function short(hash: string | null): string {
  return hash ? hash.slice(0, 12) : "none";
}

function docSnapshot(doc: UpstreamDoc | null): { snap: CanonicalValue; excerpt: ReturnType<typeof selectDocumentExcerpt> | null } {
  if (!doc?.present || !doc.content.trim()) return { snap: null, excerpt: null };
  const excerpt = selectDocumentExcerpt(doc.content, AUTHORING_DOC_BUDGET);
  return {
    excerpt,
    snap: {
      excerptHash: sha256Hex(excerpt.text), coverage: excerpt.coverage, totalChars: excerpt.totalChars,
      usedChars: excerpt.usedChars, status: doc.status ?? null, origin: doc.origin ?? null,
    },
  };
}

function versionOf(doc: UpstreamDoc | null, coverage: "full" | "partial" | null): SourceVersion {
  return { present: !!doc?.present, status: doc?.status ?? null, contentHash: doc?.contentHash ?? null, origin: doc?.origin ?? null, coverage };
}

/** Ordem determinística pelo CONTEÚDO renderizado (não por id): reordenar/reidentificar não muda nada. */
const quoteKey = (q: ContextQuote) => JSON.stringify([q.supplier.trim(), q.brand.trim(), q.model.trim(), q.valueCents]);
const sortQuotes = (qs: readonly ContextQuote[]) => [...qs].sort((a, b) => (quoteKey(a) < quoteKey(b) ? -1 : quoteKey(a) > quoteKey(b) ? 1 : 0));

/**
 * Builder PURO (sem IO, determinístico): snapshot canônico → prompt + quadro + digest.
 */
export function buildDocumentAuthoringContext(input: DocumentAuthoringInputs): DocumentAuthoringContext {
  const objeto = input.object?.trim() || input.processObject?.trim() || "";
  const dfd = docSnapshot(input.dfd);
  const etp = input.kind === "tr" ? docSnapshot(input.etp) : { snap: null, excerpt: null };
  const canonical = input.kind === "tr" && input.canonical ? input.canonical : null;
  const estimate = computeItemEstimates(input.approvedItems, { preserveOrder: !!canonical });
  const byId = new Map(input.approvedItems.map((i) => [i.id, i]));

  // (1) SNAPSHOT canônico — itens na ordem determinística do quadro; cotações por quoteId.
  const snapshot: CanonicalValue = {
    v: AUTHORING_CONTEXT_VERSION, iv: AUTHORITATIVE_ITEMS_CONTRACT_VERSION,
    o: input.organizationId, p: input.processId, k: input.kind,
    process: { object: objeto, processNumber: input.processNumber ?? null },
    dfd: dfd.snap, etp: etp.snap,
    items: estimate.rows.map((r) => {
      const src = byId.get(r.id)!;
      return {
        id: r.id, description: r.description.trim(), quantity: r.quantity, unit: r.unit.trim(),
        averagePriceCents: r.averagePriceCents, quoteCount: r.quoteCount,
        confirmedCatalogCode: r.confirmedCatalogCode ?? null, suggested: !!r.suggestedCatalogCode,
        sourceState: src.sourceState,
        // Só campos RENDERIZADOS no prompt (o quoteId não aparece no prompt ⇒ não entra no digest).
        quotes: sortQuotes(src.quotes).map((q) => ({ supplier: q.supplier.trim(), brand: q.brand.trim(), model: q.model.trim(), valueCents: q.valueCents })),
      };
    }),
    pendingItemCount: input.pendingItemCount,
    // Modo canônico: a quantidade é a PREVISTA e entra no digest (replay/CONFLICT/SOURCE_CHANGED). Chaves só
    // presentes neste modo ⇒ o snapshot (e o digest) dos processos legados permanece byte-idêntico.
    ...(canonical ? {
      qs: "canonical_planned",
      missingPlanned: canonical.missingPlannedQuantity.map((m) => m.id).sort(),
      unlinked: canonical.unlinkedApprovedItemCount,
    } : {}),
  };
  const sourcesDigest = canonicalDigest(snapshot);

  // (2) Renderização a partir do snapshot.
  const usedSources: string[] = [];
  const missing: string[] = [];
  const lines: string[] = ["## Processo", `- Objeto: ${objeto || "[REVISAR: objeto não informado]"}`];
  if (!objeto) missing.push("objeto");
  if (input.processNumber) lines.push(`- Número do processo: ${input.processNumber}`);
  lines.push("");

  const renderDoc = (label: string, key: "dfd" | "etp", doc: UpstreamDoc | null, ex: ReturnType<typeof selectDocumentExcerpt> | null) => {
    if (doc && ex) {
      usedSources.push(key);
      const cov = ex.coverage === "full"
        ? "cobertura: integral"
        : `cobertura: PARCIAL — ${ex.usedChars} de ${ex.totalChars} caracteres; todas as ${ex.sections.length} seção(ões) representadas`;
      lines.push(`## Base — ${label} (estado: ${doc.status ?? "?"}${doc.origin === "import" ? ", importado e revisado" : ""}; ${cov})`);
      lines.push(ex.text, "");
    } else {
      missing.push(key);
      lines.push(`## Base — ${label}`);
      lines.push(`[REVISAR: ${label} não localizado no processo — NÃO inferir o conteúdo; sinalizar a lacuna na seção correspondente]`, "");
    }
  };
  renderDoc("Documento de Formalização da Demanda (DFD)", "dfd", input.dfd, dfd.excerpt);
  if (input.kind === "tr") renderDoc("Estudo Técnico Preliminar (ETP)", "etp", input.etp, etp.excerpt);

  if (estimate.itemCount > 0) {
    usedSources.push("itens");
    if (estimate.quoteCount > 0) usedSources.push("pesquisa_precos");
    const shown = estimate.rows.slice(0, MAX_ITEMS_IN_PROMPT);
    lines.push(canonical
      ? `## Itens da contratação (${estimate.itemCount}${estimate.itemCount > MAX_ITEMS_IN_PROMPT ? `, exibindo ${MAX_ITEMS_IN_PROMPT}; o quadro do sistema traz todos` : ""}) — quantidade PREVISTA; referência, NÃO redigir valores`
      : `## Itens Inteligentes aprovados (${estimate.itemCount}${estimate.itemCount > MAX_ITEMS_IN_PROMPT ? `, exibindo ${MAX_ITEMS_IN_PROMPT}; o quadro do sistema traz todos` : ""}) — referência, NÃO redigir valores`);
    for (const r of shown) {
      const src = byId.get(r.id)!;
      const catalog = r.confirmedCatalogCode ? ` · catálogo confirmado: ${r.confirmedCatalogCode}` : " · catálogo: a revisar";
      const flag = src.sourceState !== "current" ? " · [REVISAR: fonte da pesquisa alterada após a decisão]" : "";
      lines.push(`- Item ${r.index}: ${r.description || "[item sem descrição]"} — ${formatQuantity(r.quantity)} ${r.unit}${canonical ? " (quantidade prevista)" : ""} · ${r.quoteCount} cotação(ões) válida(s)${catalog}${flag}`);
      for (const q of sortQuotes(src.quotes)) {
        const bm = [q.brand.trim(), q.model.trim()].filter(Boolean).join(" / ");
        lines.push(`  - ${q.supplier.trim() || "Fornecedor não identificado"}${bm ? ` (${bm})` : ""}: ${q.valueCents !== null && q.valueCents > 0 ? formatBRL(q.valueCents) : "sem preço"}`);
      }
      if (src.sourceState !== "current") missing.push(`fonte_alterada:${r.index}`);
    }
    lines.push(`- Valor estimado global (calculado pelo sistema): ${formatBRL(estimate.globalTotalCents)}`, "");
  } else {
    missing.push("itens");
    lines.push("## Itens Inteligentes aprovados");
    lines.push(input.kind === "tr"
      ? "[REVISAR: nenhum Item Inteligente aprovado — quantitativos, especificações e estimativa de valor dependem da Pesquisa de Preços e da aprovação dos itens]"
      : "(sem pesquisa de preços consolidada ainda — o levantamento de mercado deve indicar as fontes a consultar)");
    lines.push("");
  }
  if (input.pendingItemCount > 0) {
    lines.push(`> Há ${input.pendingItemCount} Item(ns) Inteligente(s) ainda NÃO aprovado(s) — não considerados.`, "");
  }

  const sourceVersions = {
    dfd: versionOf(input.dfd, dfd.excerpt?.coverage ?? null),
    etp: versionOf(input.kind === "tr" ? input.etp : null, etp.excerpt?.coverage ?? null),
  };
  const lineageMarkers = [
    `srcdigest:${sourcesDigest.slice(0, 16)}`,
    `ctx:${AUTHORING_CONTEXT_VERSION}`,
    `base:dfd@${short(sourceVersions.dfd.contentHash)}`,
    ...(sourceVersions.dfd.coverage ? [`coverage:dfd=${sourceVersions.dfd.coverage}`] : []),
    ...(input.kind === "tr" ? [`base:etp@${short(sourceVersions.etp.contentHash)}`] : []),
    ...(input.kind === "tr" && sourceVersions.etp.coverage ? [`coverage:etp=${sourceVersions.etp.coverage}`] : []),
    `itens:${estimate.itemCount}`,
    `cotacoes:${estimate.quoteCount}`,
    ...(canonical ? ["qtd:prevista", `ctxdigest:${canonical.contextDigest.slice(0, 16)}`] : []),
  ];

  return {
    contractVersion: AUTHORING_CONTEXT_VERSION, kind: input.kind,
    promptContext: lines.join("\n"),
    usedSources, missing, sourcesDigest, snapshot, sourceVersions, lineageMarkers,
    authoritativeBlock: input.kind === "tr"
      ? renderAuthoritativeItemsBlock(estimate, canonical ? { quantitySource: "canonical_planned" } : {})
      : null,
    estimate, pendingItemCount: input.pendingItemCount,
    quantitySource: canonical ? "canonical_planned" : "legacy", canonical,
  };
}

/**
 * TR × Contexto Canônico — projeção PURA dos Itens da contratação para o quadro do TR:
 *  - quantidade = `plannedQuantity` (necessidade). NUNCA `sourceQuantity`/`intelligent_items.quantity`;
 *  - preço = `unitReferencePriceCents` já vinculado ao item (consumido do Item Inteligente aprovado; sem
 *    regra nova; ambíguo ⇒ sem preço, [REVISAR]);
 *  - cotações/classificação = as dos Itens Inteligentes APROVADOS vinculados ao item (evidência);
 *  - ordem oficial (lote → ordinal); id = canonicalItemId.
 * Sem quantidade prevista (ou em conflito) ⇒ listado em `missingPlannedQuantity` (a geração é bloqueada).
 * Item Inteligente aprovado sem vínculo ⇒ contado em `unlinkedApprovedItemCount` (nunca presumido como necessidade).
 */
export function canonicalTRItems(
  ctx: ProcurementCanonicalContext,
  approved: readonly ContextItem[],
): { items: ContextItem[]; state: CanonicalTRState } {
  const byII = new Map(approved.map((i) => [i.id, i]));
  const linked = new Set<string>();
  const missing: Array<{ id: string; description: string }> = [];
  const items = ctx.items.map((it) => {
    const evid = it.priceContext.intelligentItemIds.map((id) => byII.get(id)).filter((x): x is ContextItem => !!x);
    evid.forEach((e) => linked.add(e.id));
    const description = String(it.description.value ?? "");
    const planned = it.plannedQuantity.status === "conflict" ? null : it.plannedQuantity.value;
    if (planned === null || !(planned > 0)) missing.push({ id: it.key, description });
    const catalogs = [...new Set(evid.map((e) => e.confirmedCatalogCode).filter((c): c is string => !!c))];
    return {
      id: it.key, description, unit: String(it.unit.value ?? ""),
      quantity: planned ?? 0,
      averagePriceCents: it.priceContext.unitReferencePriceCents ?? 0,
      quoteCount: evid.reduce((n, e) => n + e.quoteCount, 0),
      confirmedCatalogCode: catalogs.length === 1 ? catalogs[0] : null,
      suggestedCatalogCode: evid.find((e) => e.suggestedCatalogCode)?.suggestedCatalogCode ?? null,
      sourceState: evid.find((e) => e.sourceState !== "current")?.sourceState ?? "current",
      quotes: evid.flatMap((e) => e.quotes),
    } satisfies ContextItem;
  });
  return {
    items,
    state: {
      contextDigest: ctx.digest,
      missingPlannedQuantity: missing,
      unlinkedApprovedItemCount: approved.filter((a) => !linked.has(a.id)).length,
    },
  };
}

function draftOrigin(sources: readonly string[]): "import" | "generated" | "manual" {
  if (sources.includes("origem:import")) return "import";
  if (sources.some((s) => s === "edicao_manual" || s === "edicao_humana")) return "manual";
  return "generated";
}

function toUpstream(doc: Awaited<ReturnType<typeof getGeneratedDocumentByKind>>): UpstreamDoc | null {
  if (!doc) return null;
  const present = !!doc.content && doc.content.trim().length > 0;
  return {
    present, status: doc.status ?? null,
    contentHash: present ? draftContentHash(doc.content) : null,
    content: doc.content ?? "", origin: draftOrigin(doc.sources ?? []),
  };
}

/** Classificação CONFIRMADA = decisão humana vigente `confirmado`/`substituido` com código. */
export function confirmedCatalogFromDecision(d: { decision: string; catmatCode: string | null } | undefined): string | null {
  if (!d) return null;
  return (d.decision === "confirmado" || d.decision === "substituido") && d.catmatCode ? d.catmatCode : null;
}

/**
 * Resolve as fontes (TENANT-SCOPED) e monta o contexto. Documento/itens de outro tenant retornam vazio
 * (tratados como ausentes, nunca vazam).
 */
export async function resolveDocumentAuthoringContext(params: {
  organizationId: number; processId: string; kind: ContextualKind; object: string;
}): Promise<DocumentAuthoringContext> {
  const [process, dfd, etp, items] = await Promise.all([
    getProcess(params.processId, params.organizationId),
    getGeneratedDocumentByKind(params.processId, params.organizationId, "dfd"),
    params.kind === "tr" ? getGeneratedDocumentByKind(params.processId, params.organizationId, "etp") : Promise.resolve(null),
    listIntelligentItems(params.processId, params.organizationId),
  ]);
  const approved = items.filter((i) => i.status === "aprovado");
  const decisions = await getLatestCatmatDecisionsForItems(approved.map((i) => i.id), params.organizationId);
  const approvedItems: ContextItem[] = approved.map((i) => ({
    id: i.id, description: i.description, quantity: i.quantity, unit: i.unit,
    averagePriceCents: i.averagePriceCents, quoteCount: i.quoteCount,
    confirmedCatalogCode: confirmedCatalogFromDecision(decisions.get(i.id)),
    suggestedCatalogCode: i.suggestedCATMAT,
    sourceState: i.sourceState ?? "current",
    quotes: i.suppliers.map((s, idx) => ({
      quoteId: s.quoteId ?? `legacy:${idx}:${s.name}:${s.value}`,
      supplier: s.name ?? "", brand: s.brand ?? "", model: s.model ?? "",
      valueCents: Number(s.value) > 0 ? reaisToCents(s.value) : null,
    })),
  }));
  // GATE DETERMINÍSTICO (sem feature flag): o processo tem Itens da contratação ⇒ o TR consome o Contexto
  // Canônico (quantidade PREVISTA). Sem Itens Canônicos ⇒ caminho legado inalterado (processos anteriores).
  let canonical: CanonicalTRState | undefined;
  let trItems = approvedItems;
  if (params.kind === "tr" && (await listProcurementItems(params.organizationId, params.processId)).some((i) => i.status === "active")) {
    const ctx = await resolveProcurementContext({ organizationId: params.organizationId, processId: params.processId });
    const projected = canonicalTRItems(ctx, approvedItems);
    trItems = projected.items;
    canonical = projected.state;
  }
  return buildDocumentAuthoringContext({
    organizationId: params.organizationId, processId: params.processId, kind: params.kind,
    object: params.object, processObject: process?.object ?? null, processNumber: process?.processNumber ?? null,
    dfd: toUpstream(dfd), etp: toUpstream(etp), approvedItems: trItems,
    pendingItemCount: items.filter((i) => i.status !== "aprovado" && i.status !== "rejeitado").length,
    canonical,
  });
}

/** Digest gravado no documento (marcador `srcdigest:`), ou null. */
export function storedSourcesDigest(sources: readonly string[] | null | undefined): string | null {
  return (sources ?? []).find((s) => s.startsWith("srcdigest:"))?.slice("srcdigest:".length) ?? null;
}

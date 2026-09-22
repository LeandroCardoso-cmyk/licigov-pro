/**
 * P0 piloto — CONTEXTO REAL DE AUTORIA do ETP e do TR (generaliza o Context Builder do Edital).
 *
 * Antes, ETP/TR eram autorados só com o OBJETO — DFD, ETP, pesquisa e itens aprovados não chegavam à
 * cognição. Agora, de forma TENANT-SCOPED e determinística:
 *
 *   ETP ← processo + DFD (+ resumo dos itens/pesquisa, se houver)          [art. 18 da Lei 14.133/2021]
 *   TR  ← processo + DFD + ETP + Itens Inteligentes APROVADOS + cotações +
 *         classificação CONFIRMADA (ledger catmat_decisions)                [art. 6º, XXIII]
 *
 * Regras:
 *   - NADA inventado: fonte ausente → `[REVISAR: …]` explícito (e listada em `missing`).
 *   - NÚMEROS NÃO SÃO DA IA: descrição/quantidade/unidade/preço médio/valor do item/valor global do TR vêm do
 *     bloco AUTORITATIVO renderizado pelo servidor (authoritativeItems.ts, centavos half-up). O prompt pede à
 *     IA que NÃO redija valores; o bloco é anexado ao conteúdo após a autoria.
 *   - `sourcesDigest` determinístico (versão do contrato + hashes das fontes + assinatura dos itens) → entra no
 *     payloadHash (replay com as MESMAS fontes; fonte alterada sob a mesma chave → CONFLICT) e grava o marcador
 *     `srcdigest:` no documento (detecção de desatualização SOURCE_CHANGED, como no Edital).
 *   - Documento importado e documento gerado são INDISTINGUÍVEIS aqui (ambos são o rascunho canônico).
 */
import { createHash } from "crypto";
import { getProcess, listIntelligentItems, getGeneratedDocumentByKind } from "../../db/procurement";
import { getLatestCatmatDecisionsForItems } from "../../db/catmatGovernance";
import { draftContentHash } from "../../domain/generatedDocument";
import {
  AUTHORITATIVE_ITEMS_CONTRACT_VERSION, computeItemEstimates, renderAuthoritativeItemsBlock, formatQuantity,
  type AuthoritativeItemInput, type AuthoritativeItemsEstimate,
} from "../../domain/authoritativeItems";
import { formatBRL } from "../../domain/money";

export const AUTHORING_CONTEXT_VERSION = "authoring-context/1.0";

const MAX_DOC_CHARS = 6000;
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

/** Item aprovado com os dados necessários à autoria (já resolvidos). */
export interface ContextItem extends AuthoritativeItemInput {
  readonly suppliers: readonly string[];
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
  /** Itens ainda não aprovados (informativo: o TR usa SÓ os aprovados). */
  readonly pendingItemCount: number;
}

export interface SourceVersion { readonly present: boolean; readonly status: string | null; readonly contentHash: string | null; readonly origin: string | null }

export interface DocumentAuthoringContext {
  readonly contractVersion: typeof AUTHORING_CONTEXT_VERSION;
  readonly kind: ContextualKind;
  /** Bloco de contexto BOUNDED (markdown) injetado na query cognitiva. */
  readonly promptContext: string;
  readonly usedSources: string[];
  readonly missing: string[];
  readonly sourcesDigest: string;
  readonly sourceVersions: { dfd: SourceVersion; etp: SourceVersion };
  readonly lineageMarkers: string[];
  /** TR: bloco autoritativo (markdown) anexado ao conteúdo; ETP: null. */
  readonly authoritativeBlock: string | null;
  readonly estimate: AuthoritativeItemsEstimate;
  readonly pendingItemCount: number;
}

function truncate(s: string, max: number): string {
  const t = (s ?? "").trim();
  return t.length <= max ? t : `${t.slice(0, max)}\n…[conteúdo truncado para o contexto]`;
}

function short(hash: string | null): string {
  return hash ? hash.slice(0, 12) : "none";
}

function itemsSignature(items: readonly ContextItem[]): Array<Record<string, unknown>> {
  return items
    .map((i) => ({
      id: i.id, d: i.description.trim(), q: i.quantity, u: i.unit.trim(), c: i.averagePriceCents,
      n: i.quoteCount, cc: i.confirmedCatalogCode ?? null, sc: i.suggestedCatalogCode ? 1 : 0,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function versionOf(doc: UpstreamDoc | null): SourceVersion {
  return { present: !!doc?.present, status: doc?.status ?? null, contentHash: doc?.contentHash ?? null, origin: doc?.origin ?? null };
}

/**
 * Builder PURO (sem IO, determinístico): monta o contexto de autoria do ETP/TR a partir das fontes resolvidas.
 */
export function buildDocumentAuthoringContext(input: DocumentAuthoringInputs): DocumentAuthoringContext {
  const usedSources: string[] = [];
  const missing: string[] = [];
  const lines: string[] = [];
  const objeto = input.object?.trim() || input.processObject?.trim() || "";

  lines.push("## Processo");
  lines.push(`- Objeto: ${objeto || "[REVISAR: objeto não informado]"}`);
  if (!objeto) missing.push("objeto");
  if (input.processNumber) lines.push(`- Número do processo: ${input.processNumber}`);
  lines.push("");

  const renderDoc = (label: string, key: "dfd" | "etp", doc: UpstreamDoc | null) => {
    if (doc?.present && doc.content.trim()) {
      usedSources.push(key);
      lines.push(`## Base — ${label} (estado: ${doc.status ?? "?"}${doc.origin === "import" ? ", importado e revisado" : ""})`);
      lines.push(truncate(doc.content, MAX_DOC_CHARS));
      lines.push("");
    } else {
      missing.push(key);
      lines.push(`## Base — ${label}`);
      lines.push(`[REVISAR: ${label} não localizado no processo — NÃO inferir o conteúdo; sinalizar a lacuna na seção correspondente]`);
      lines.push("");
    }
  };
  renderDoc("Documento de Formalização da Demanda (DFD)", "dfd", input.dfd);
  if (input.kind === "tr") renderDoc("Estudo Técnico Preliminar (ETP)", "etp", input.etp);

  const estimate = computeItemEstimates(input.approvedItems);
  if (input.approvedItems.length > 0) {
    usedSources.push("itens");
    if (estimate.quoteCount > 0) usedSources.push("pesquisa_precos");
    const shown = estimate.rows.slice(0, MAX_ITEMS_IN_PROMPT);
    lines.push(`## Itens Inteligentes aprovados (${estimate.itemCount}${estimate.itemCount > MAX_ITEMS_IN_PROMPT ? `, exibindo ${MAX_ITEMS_IN_PROMPT}` : ""}) — referência, NÃO redigir valores`);
    for (const r of shown) {
      const suppliers = input.approvedItems.find((i) => i.id === r.id)?.suppliers ?? [];
      const catalog = r.confirmedCatalogCode ? ` · catálogo confirmado: ${r.confirmedCatalogCode}` : " · catálogo: a revisar";
      lines.push(`- Item ${r.index}: ${r.description || "[item sem descrição]"} — ${formatQuantity(r.quantity)} ${r.unit} · ${r.quoteCount} cotação(ões)${suppliers.length ? ` (${suppliers.slice(0, 5).join(", ")})` : ""}${catalog}`);
    }
    lines.push(`- Valor estimado global (calculado pelo sistema): ${formatBRL(estimate.globalTotalCents)}`);
    lines.push("");
  } else {
    missing.push("itens");
    lines.push("## Itens Inteligentes aprovados");
    lines.push(input.kind === "tr"
      ? "[REVISAR: nenhum Item Inteligente aprovado — quantitativos, especificações e estimativa de valor dependem da Pesquisa de Preços e da aprovação dos itens]"
      : "(sem pesquisa de preços consolidada ainda — o levantamento de mercado deve indicar as fontes a consultar)");
    lines.push("");
  }
  if (input.pendingItemCount > 0) {
    lines.push(`> Há ${input.pendingItemCount} Item(ns) Inteligente(s) ainda NÃO aprovado(s) — não considerados.`);
    lines.push("");
  }

  const sourcesDigest = createHash("sha256").update(JSON.stringify({
    v: AUTHORING_CONTEXT_VERSION, iv: AUTHORITATIVE_ITEMS_CONTRACT_VERSION,
    o: input.organizationId, p: input.processId, k: input.kind, obj: objeto,
    dfd: input.dfd?.contentHash ?? null,
    etp: input.kind === "tr" ? (input.etp?.contentHash ?? null) : null,
    items: itemsSignature(input.approvedItems),
  })).digest("hex");

  const sourceVersions = { dfd: versionOf(input.dfd), etp: versionOf(input.kind === "tr" ? input.etp : null) };
  const lineageMarkers = [
    `srcdigest:${sourcesDigest.slice(0, 16)}`,
    `ctx:${AUTHORING_CONTEXT_VERSION}`,
    `base:dfd@${short(sourceVersions.dfd.contentHash)}`,
    ...(input.kind === "tr" ? [`base:etp@${short(sourceVersions.etp.contentHash)}`] : []),
    `itens:${estimate.itemCount}`,
    `cotacoes:${estimate.quoteCount}`,
  ];

  return {
    contractVersion: AUTHORING_CONTEXT_VERSION,
    kind: input.kind,
    promptContext: lines.join("\n"),
    usedSources, missing, sourcesDigest, sourceVersions, lineageMarkers,
    authoritativeBlock: input.kind === "tr" ? renderAuthoritativeItemsBlock(estimate) : null,
    estimate,
    pendingItemCount: input.pendingItemCount,
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
    suppliers: i.suppliers.map((s) => s.name).filter(Boolean),
  }));
  return buildDocumentAuthoringContext({
    organizationId: params.organizationId, processId: params.processId, kind: params.kind,
    object: params.object, processObject: process?.object ?? null, processNumber: process?.processNumber ?? null,
    dfd: toUpstream(dfd), etp: toUpstream(etp), approvedItems,
    pendingItemCount: items.filter((i) => i.status !== "aprovado" && i.status !== "rejeitado").length,
  });
}

/** Digest gravado no documento (marcador `srcdigest:`), ou null. */
export function storedSourcesDigest(sources: readonly string[] | null | undefined): string | null {
  return (sources ?? []).find((s) => s.startsWith("srcdigest:"))?.slice("srcdigest:".length) ?? null;
}

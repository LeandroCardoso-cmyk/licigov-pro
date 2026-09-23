/**
 * P0 EDITAL — CONTEXT BUILDER canônico do Edital.
 *
 * Coleta, de forma TENANT-SCOPED, o contexto institucional já existente no processo (DFD, ETP, TR,
 * itens aprovados, parâmetros do edital e metadados do processo) e o consolida num bloco de contexto
 * BOUNDED que alimenta a autoria estruturada do Edital pelo Kernel cognitivo. O servidor NÃO reintroduz
 * manualmente o que já existe estruturado no fluxo DFD → ETP → TR.
 *
 * Regras (Constituição do Produto + mandato P0):
 *   - NÃO inventar dado. Fonte ausente/indisponível → marcador EXPLÍCITO `[REVISAR: …]` (nunca alucinação).
 *   - Precedência de fonte: TR (peso elevado) → ETP → DFD → processo → parâmetros. Preferir conteúdo de
 *     documento em estado mais avançado (aprovado > em_revisão > rascunho) na sinalização de confiança.
 *   - Determinístico: mesmo conjunto de fontes ⇒ mesmo `sourcesDigest` (replay-safe + detecção de
 *     desatualização). Alterar DFD/ETP/TR/itens/parâmetros muda o digest.
 *   - Puro e testável: `buildEditalSourceContext` não faz IO; `resolveEditalSources` faz as leituras
 *     org-scoped e delega ao builder puro.
 */

import { createHash } from "crypto";
import { getProcess, listIntelligentItems, getGeneratedDocumentByKind } from "../../db/procurement";
import { draftContentHash } from "../../domain/generatedDocument";
import { getLatestCatmatDecisionsForItems } from "../../db/catmatGovernance";
import { formatBRL, reaisToCents } from "../../domain/money";
import {
  AUTHORITATIVE_ITEMS_CONTRACT_VERSION, computeItemEstimates, renderAuthoritativeItemsBlock, formatQuantity,
} from "../../domain/authoritativeItems";
import { confirmedCatalogFromDecision } from "./authoringContext";
import { selectDocumentExcerpt, sha256Hex } from "../../domain/canonicalJson";

/**
 * Versão do contrato de montagem de contexto do Edital (compõe o digest/lineage).
 * 1.1 (P0 piloto): preço médio lido em REAIS (antes `/100` exibia R$ 25,50 como R$ 0,26), classificação só
 * quando CONFIRMADA por decisão humana, bloco autoritativo de itens compartilhado com o TR. Editais gerados
 * com 1.0 passam a aparecer como `source_changed` (o contexto deles continha o valor errado) — correto.
 * 1.2 (hardening P0): o digest representa o que o prompt CONSOME — número do processo, recorte efetivo de
 * cada documento (hash + cobertura, seleção por seções) e estado da fonte dos itens (antes: número do
 * processo fora do digest e hash do documento inteiro mesmo quando só 4.000 caracteres entravam).
 */
export const EDITAL_CONTEXT_VERSION = "edital-context/1.2";

/** Limite de caracteres por documento-base injetado no contexto (custo/tamanho previsíveis). */
const MAX_DOC_CHARS = 4000;
const MAX_ITEMS = 60;

/** Rascunho canônico de um documento-base (DFD/ETP/TR) já lido do generated_documents. */
export interface EditalUpstreamDoc {
  readonly present: boolean;
  readonly status: string | null;
  readonly contentHash: string | null;
  readonly content: string;
}

export interface EditalApprovedItem {
  readonly id: string;
  readonly description: string;
  readonly quantity: number;
  readonly unit: string;
  /** Preço médio em REAIS (DECIMAL(14,2) canônico) — NUNCA centavos. */
  readonly averagePrice: number;
  /** Sugestão automática (NÃO é decisão). */
  readonly suggestedCATMAT: string | null;
  /** Classificação CONFIRMADA (ledger catmat_decisions); ausente/null ⇒ "a revisar". */
  readonly confirmedCatalogCode?: string | null;
  /** Nº de cotações VÁLIDAS que compõem o preço médio. */
  readonly quoteCount?: number;
  /** current | source_changed | review_required (renderizado ⇒ entra no digest). */
  readonly sourceState?: string;
}

/** Entradas JÁ RESOLVIDAS (fetched) para o builder PURO. */
export interface EditalSourceInputs {
  readonly organizationId: number;
  readonly processId: string;
  readonly object: string;
  readonly modality: string;
  readonly form: string;
  readonly platform: string | null;
  readonly processObject: string | null;
  readonly processNumber: string | null;
  readonly currentStage: string | null;
  readonly dfd: EditalUpstreamDoc | null;
  readonly etp: EditalUpstreamDoc | null;
  readonly tr: EditalUpstreamDoc | null;
  readonly approvedItems: readonly EditalApprovedItem[];
  /** Parâmetros complementares do edital, quando existirem no espaço canônico (senão REVISAR). */
  readonly criterioJulgamento: string | null;
  readonly regimeContratacao: string | null;
}

/** Estado de UMA fonte-base para lineage + detecção de desatualização. */
export interface EditalSourceVersion {
  readonly present: boolean;
  readonly status: string | null;
  readonly contentHash: string | null;
}

export interface EditalSourceContext {
  /** Bloco de contexto BOUNDED (markdown) injetado na query cognitiva. */
  readonly promptContext: string;
  /** Fontes efetivamente localizadas (para exibição/explicabilidade). */
  readonly usedSources: string[];
  /** Campos NÃO localizados (marcados como [REVISAR] no contexto). */
  readonly missing: string[];
  /** Digest determinístico das FONTES (upstream + parâmetros + itens) — replay + stale detection. */
  readonly sourcesDigest: string;
  /** Estado por fonte (DFD/ETP/TR) para lineage e detecção de mudança. */
  readonly sourceVersions: { dfd: EditalSourceVersion; etp: EditalSourceVersion; tr: EditalSourceVersion };
  /** Marcadores de lineage a persistir em `sources` do documento gerado. */
  readonly lineageMarkers: string[];
  /** Bloco AUTORITATIVO de itens/valores (servidor, determinístico) — anexado à minuta, nunca redigido pela IA. */
  readonly authoritativeBlock: string;
}

function short(hash: string | null): string {
  return hash ? hash.slice(0, 12) : "none";
}

/** Assinatura determinística e ORDENADA dos itens aprovados (independe da ordem de leitura). */
function itemsSignature(items: readonly EditalApprovedItem[]): Array<Record<string, unknown>> {
  return items
    .map((i) => ({
      id: i.id, d: i.description.trim(), q: i.quantity, u: i.unit.trim(), c: reaisToCents(i.averagePrice),
      cm: i.suggestedCATMAT ?? null, cc: i.confirmedCatalogCode ?? null, n: i.quoteCount ?? 0, ss: i.sourceState ?? "current",
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Builder PURO: consolida o contexto do Edital a partir de entradas já resolvidas. Sem IO, determinístico.
 * Fontes ausentes viram `[REVISAR: …]` — nunca conteúdo fabricado.
 */
export function buildEditalSourceContext(input: EditalSourceInputs): EditalSourceContext {
  const usedSources: string[] = [];
  const missing: string[] = [];
  const lines: string[] = [];

  const objeto = input.object?.trim() || input.processObject?.trim() || "";
  lines.push("## Parâmetros do certame (definidos no fluxo do Edital)");
  lines.push(`- Objeto: ${objeto || "[REVISAR: objeto não informado]"}`);
  if (!objeto) missing.push("objeto");
  lines.push(`- Modalidade: ${input.modality}`);
  lines.push(`- Forma: ${input.form}`);
  lines.push(`- Plataforma: ${input.platform ?? "(não aplicável / presencial)"}`);
  if (input.processNumber) lines.push(`- Número do processo: ${input.processNumber}`);
  if (input.criterioJulgamento && input.criterioJulgamento.trim()) {
    lines.push(`- Critério de julgamento: ${input.criterioJulgamento.trim()}`);
  } else {
    lines.push("- Critério de julgamento: [REVISAR: definir critério de julgamento conforme o objeto e a Lei 14.133/2021]");
    missing.push("criterio_julgamento");
  }
  if (input.regimeContratacao && input.regimeContratacao.trim()) {
    lines.push(`- Regime de contratação/execução: ${input.regimeContratacao.trim()}`);
  } else {
    lines.push("- Regime de contratação/execução: [REVISAR: definir regime de execução aplicável]");
    missing.push("regime_contratacao");
  }
  lines.push("");

  const excerpts: Record<string, { h: string; cov: string; used: number; total: number } | null> = { dfd: null, etp: null, tr: null };
  const renderDoc = (label: string, key: "dfd" | "etp" | "tr", doc: EditalUpstreamDoc | null) => {
    if (doc?.present && doc.content.trim()) {
      usedSources.push(key);
      // Seleção por SEÇÕES com cobertura explícita (nunca afirma consumo integral quando não houve).
      const ex = selectDocumentExcerpt(doc.content, MAX_DOC_CHARS);
      excerpts[key] = { h: sha256Hex(ex.text), cov: ex.coverage, used: ex.usedChars, total: ex.totalChars };
      const cov = ex.coverage === "full" ? "cobertura: integral" : `cobertura: PARCIAL — ${ex.usedChars} de ${ex.totalChars} caracteres; todas as ${ex.sections.length} seção(ões) representadas`;
      lines.push(`## Base — ${label} (estado: ${doc.status ?? "?"}; ${cov})`);
      lines.push(ex.text);
      lines.push("");
    } else {
      missing.push(key);
      lines.push(`## Base — ${label}`);
      lines.push(`[REVISAR: ${label} não localizado no processo — elaborar a seção correspondente sem inferir dados inexistentes]`);
      lines.push("");
    }
  };
  // Precedência de exibição: TR primeiro (peso elevado), depois ETP e DFD.
  renderDoc("Termo de Referência (TR)", "tr", input.tr);
  renderDoc("Estudo Técnico Preliminar (ETP)", "etp", input.etp);
  renderDoc("Documento de Formalização da Demanda (DFD)", "dfd", input.dfd);

  // Estimativa AUTORITATIVA (mesmo renderer do TR): centavos half-up; preço lido em REAIS (sem /100).
  const estimate = computeItemEstimates(input.approvedItems.map((i) => ({
    id: i.id, description: i.description, quantity: i.quantity, unit: i.unit,
    averagePriceCents: reaisToCents(i.averagePrice), quoteCount: i.quoteCount ?? 0,
    confirmedCatalogCode: i.confirmedCatalogCode ?? null, suggestedCatalogCode: i.suggestedCATMAT,
  })));
  const items = estimate.rows.slice(0, MAX_ITEMS);
  if (items.length > 0) {
    usedSources.push("itens");
    lines.push(`## Itens aprovados (${items.length}${input.approvedItems.length > MAX_ITEMS ? `, exibindo ${MAX_ITEMS}` : ""}) — referência, NÃO redigir valores`);
    for (const it of items) {
      const price = it.averagePriceCents > 0 ? ` · valor médio est.: ${formatBRL(it.averagePriceCents)}` : "";
      // Sugestão automática NÃO é apresentada como código oficial.
      const catmat = it.confirmedCatalogCode ? ` · CATMAT/CATSER: ${it.confirmedCatalogCode}` : it.suggestedCatalogCode ? " · CATMAT/CATSER: a revisar (sugestão não confirmada)" : "";
      const changed = input.approvedItems.find((a) => a.id === it.id)?.sourceState;
      const flag = changed && changed !== "current" ? " · [REVISAR: fonte da pesquisa alterada após a decisão]" : "";
      lines.push(`- ${it.description || "[item sem descrição]"} — ${formatQuantity(it.quantity)} ${it.unit}${price}${catmat}${flag}`);
    }
    lines.push(`- Valor estimado global (calculado pelo sistema): ${formatBRL(estimate.globalTotalCents)}`);
    lines.push("");
  } else {
    missing.push("itens");
    lines.push("## Itens aprovados");
    lines.push("[REVISAR: nenhum item aprovado localizado — confira o Termo de Referência quanto a quantitativos e especificações]");
    lines.push("");
  }

  const sourcesDigest = createHash("sha256")
    .update(JSON.stringify({
      v: EDITAL_CONTEXT_VERSION,
      iv: AUTHORITATIVE_ITEMS_CONTRACT_VERSION,
      o: input.organizationId,
      p: input.processId,
      obj: objeto,
      pn: input.processNumber ?? null,
      m: input.modality,
      f: input.form,
      pl: input.platform ?? null,
      cj: input.criterioJulgamento ?? null,
      rc: input.regimeContratacao ?? null,
      // Recorte EFETIVAMENTE consumido de cada documento (hash + cobertura), não o documento inteiro.
      dfd: excerpts.dfd, etp: excerpts.etp, tr: excerpts.tr,
      items: itemsSignature(input.approvedItems),
    }))
    .digest("hex");

  const sourceVersions = {
    dfd: { present: !!input.dfd?.present, status: input.dfd?.status ?? null, contentHash: input.dfd?.contentHash ?? null },
    etp: { present: !!input.etp?.present, status: input.etp?.status ?? null, contentHash: input.etp?.contentHash ?? null },
    tr: { present: !!input.tr?.present, status: input.tr?.status ?? null, contentHash: input.tr?.contentHash ?? null },
  };

  const lineageMarkers = [
    `srcdigest:${sourcesDigest.slice(0, 16)}`,
    `base:tr@${short(sourceVersions.tr.contentHash)}`,
    `base:etp@${short(sourceVersions.etp.contentHash)}`,
    `base:dfd@${short(sourceVersions.dfd.contentHash)}`,
    `itens:${input.approvedItems.length}`,
  ];

  return {
    promptContext: lines.join("\n"),
    usedSources,
    missing,
    sourcesDigest,
    sourceVersions,
    lineageMarkers,
    authoritativeBlock: renderAuthoritativeItemsBlock(estimate, { heading: "Itens, quantitativos e valor estimado (dados autoritativos do processo)" }),
  };
}

function toUpstream(doc: Awaited<ReturnType<typeof getGeneratedDocumentByKind>>): EditalUpstreamDoc | null {
  if (!doc) return null;
  return {
    present: !!doc.content && doc.content.trim().length > 0,
    status: doc.status ?? null,
    contentHash: doc.content ? draftContentHash(doc.content) : null,
    content: doc.content ?? "",
  };
}

/**
 * Resolve as fontes do Edital de forma TENANT-SCOPED e monta o contexto. Toda leitura é escopada por
 * `organizationId` (documento de outro tenant retorna null → tratado como ausente/[REVISAR], nunca vaza).
 * Os parâmetros modalidade/forma/plataforma vêm do próprio passo do Edital (não há reentrada de dados de
 * etapas anteriores); critério/regime ficam como [REVISAR] quando não disponíveis no espaço canônico.
 */
export async function resolveEditalSources(params: {
  organizationId: number;
  processId: string;
  object: string;
  modality: string;
  form: string;
  platform: string | null;
  criterioJulgamento?: string | null;
  regimeContratacao?: string | null;
}): Promise<EditalSourceContext> {
  const [process, dfd, etp, tr, items] = await Promise.all([
    getProcess(params.processId, params.organizationId),
    getGeneratedDocumentByKind(params.processId, params.organizationId, "dfd"),
    getGeneratedDocumentByKind(params.processId, params.organizationId, "etp"),
    getGeneratedDocumentByKind(params.processId, params.organizationId, "tr"),
    listIntelligentItems(params.processId, params.organizationId),
  ]);
  const approved = items.filter((i) => i.status === "aprovado");
  const decisions = await getLatestCatmatDecisionsForItems(approved.map((i) => i.id), params.organizationId);
  const approvedItems: EditalApprovedItem[] = approved.map((i) => ({
    id: i.id, description: i.description, quantity: i.quantity, unit: i.unit, averagePrice: i.averagePrice,
    suggestedCATMAT: i.suggestedCATMAT, confirmedCatalogCode: confirmedCatalogFromDecision(decisions.get(i.id)),
    quoteCount: i.quoteCount, sourceState: i.sourceState,
  }));

  return buildEditalSourceContext({
    organizationId: params.organizationId,
    processId: params.processId,
    object: params.object,
    modality: params.modality,
    form: params.form,
    platform: params.platform,
    processObject: process?.object ?? null,
    processNumber: process?.processNumber ?? null,
    currentStage: process?.currentStage ?? null,
    dfd: toUpstream(dfd),
    etp: toUpstream(etp),
    tr: toUpstream(tr),
    approvedItems,
    criterioJulgamento: params.criterioJulgamento ?? null,
    regimeContratacao: params.regimeContratacao ?? null,
  });
}

/**
 * Recalcula APENAS o digest de fontes (sem montar o contexto completo) — usado pela detecção de
 * desatualização (SOURCE_CHANGED). Reusa `buildEditalSourceContext` para garantir a MESMA fórmula.
 */
export async function computeCurrentSourcesDigest(params: {
  organizationId: number;
  processId: string;
  object: string;
  modality: string;
  form: string;
  platform: string | null;
  criterioJulgamento?: string | null;
  regimeContratacao?: string | null;
}): Promise<string> {
  const ctx = await resolveEditalSources(params);
  return ctx.sourcesDigest;
}

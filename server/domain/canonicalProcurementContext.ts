/**
 * Contexto Canônico da Contratação — FATOS + DECISÕES + ESTADO INSTITUCIONAL + PROVENIÊNCIA de um processo,
 * reutilizáveis entre documentos (DFD → ETP → Pesquisa/Itens → TR → Edital). NÃO é um documento: os
 * documentos continuam existindo e CONSOMEM o contexto (prefill determinístico + rascunho supervisionado).
 *
 * Puro e determinístico (sem I/O). Toda a política de AUTORIDADE vive aqui (nunca espalhada em
 * if/else pelo backend/frontend): quais fontes podem afirmar cada fato, como uma afirmação supera outra,
 * quando há CONFLITO (nunca escolhido silenciosamente) e como o contexto é versionado (digest).
 *
 * Fonte ≠ necessidade: a Pesquisa de Preços é EVIDÊNCIA de preço (e pode trazer a quantidade do
 * documento — `sourceQuantity`), nunca autoridade da quantidade a contratar (`plannedQuantity`).
 * Ver docs/architecture/CANONICAL_PROCUREMENT_CONTEXT.md.
 */
import { createHash } from "crypto";
import { canonicalDigest, type CanonicalValue } from "./canonicalJson";
import { canonicalUnit, normalizeDescription } from "./priceQuoteConsolidation";
import { multiplyQuantityCents, sumCents } from "./money";

export const CANONICAL_CONTEXT_VERSION = "canonical-context/1";

// ─── Fontes, estados e caminhos ────────────────────────────────────────────────────

/** Origem de um fato. `ai_draft` existe para rastrear texto sugerido — NUNCA é fonte de fato. */
export type ContextSourceType =
  | "process" | "organization" | "user" | "dfd" | "etp" | "tr"
  | "price_research" | "intelligent_item" | "approved_document" | "ai_draft";

/** Estado de uma AFIRMAÇÃO (persistida). `superseded` e `unknown` são derivados na resolução. */
export type AssertionStatus = "observed" | "draft" | "confirmed" | "approved";
export type FieldStatus = "unknown" | AssertionStatus | "conflict";

/** Autoridade por ESTADO (derivada do workflow real: aprovação > dado estruturado confirmado por humano >
 *  rascunho > evidência observada). A IA não tem posto: nunca afirma fato. */
export const STATUS_RANK: Readonly<Record<AssertionStatus, number>> = { observed: 1, draft: 2, confirmed: 3, approved: 4 };

export type ScalarPath =
  | "process.number" | "process.object"
  | "organization.name" | "organization.location"
  | "demand.requestingUnit" | "demand.responsibleParty"
  | "planning.pcaAlignment" | "planning.priority" | "planning.desiredDate";

export type ItemFieldName = "description" | "unit" | "plannedQuantity";
export type ItemPath = `items.${string}.${ItemFieldName}`;
export type ContextPath = ScalarPath | ItemPath;

/**
 * POLÍTICA DE AUTORIDADE — quais fontes podem AFIRMAR cada fato. Explícita, testável e documentada.
 *  - process.* e organization.*: só a própria fonte estruturada;
 *  - necessidade (unidade, responsável, planejamento): Processo, humano, DFD e documentos posteriores;
 *  - plannedQuantity: SOMENTE humano/documentos da necessidade — NUNCA price_research/intelligent_item
 *    (a quantidade da cotação é `sourceQuantity`, evidência) e NUNCA ai_draft;
 *  - descrição/unidade do item: também observáveis a partir do Item Inteligente (evidência consolidada).
 */
const NEED_SOURCES: readonly ContextSourceType[] = ["process", "user", "dfd", "etp", "tr", "approved_document"];
export const AUTHORITY_POLICY: Readonly<Record<string, readonly ContextSourceType[]>> = {
  "process.number":          ["process"],
  "process.object":          ["process"],
  "organization.name":       ["organization"],
  "organization.location":   ["organization"],
  "demand.requestingUnit":   NEED_SOURCES,
  "demand.responsibleParty": NEED_SOURCES,
  "planning.pcaAlignment":   ["user", "dfd", "etp", "approved_document"],
  "planning.priority":       ["user", "dfd", "etp", "approved_document"],
  "planning.desiredDate":    ["user", "dfd", "etp", "approved_document"],
  "items.*.description":     ["user", "dfd", "etp", "tr", "approved_document", "intelligent_item"],
  "items.*.unit":            ["user", "dfd", "etp", "tr", "approved_document", "intelligent_item"],
  "items.*.plannedQuantity": ["user", "dfd", "etp", "tr", "approved_document"],
};

function policyKey(path: string): string {
  const m = /^items\.[^.]+\.(description|unit|plannedQuantity)$/.exec(path);
  return m ? `items.*.${m[1]}` : path;
}

export function isSourceAllowed(path: string, source: ContextSourceType): boolean {
  return (AUTHORITY_POLICY[policyKey(path)] ?? []).includes(source);
}

// ─── Afirmações e campos resolvidos ─────────────────────────────────────────────────

export type FactValue = string | number | null;

export interface FactAssertion {
  /** Sequência do ledger (monotônica por processo). Projeções (Processo/Organização/Item) usam 0. */
  id: number;
  path: ContextPath;
  value: FactValue;
  valueHash: string;
  sourceType: ContextSourceType;
  sourceId: string;
  sourceVersion: string;
  status: AssertionStatus;
  actorUserId: number | null;
  /** Hash do valor que o autor VIU como vigente ao afirmar (base da superação consciente). */
  basisValueHash: string | null;
  createdAt: string;
}

export interface FieldSource { type: ContextSourceType; id: string; version: string }

export interface CanonicalField<T extends FactValue = FactValue> {
  value: T | null;
  status: FieldStatus;
  source: FieldSource | null;
  actorUserId: number | null;
  updatedAt: string | null;
  valueHash: string | null;
  /** Outras fontes vigentes que afirmam o MESMO valor (corroboração). */
  corroboratedBy: FieldSource[];
  /** Em CONFLITO: as afirmações divergentes de mesma autoridade (nenhuma é escolhida). */
  conflict: Array<{ value: FactValue; source: FieldSource; status: AssertionStatus; actorUserId: number | null }> | null;
}

/** Hash canônico de um valor de fato (texto normalizado; número em forma canônica). */
export function factValueHash(value: FactValue): string {
  const norm = value === null ? "∅" : typeof value === "number" ? `n:${canonicalNumber(value)}` : `s:${normalizeText(value)}`;
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

export function normalizeText(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

function canonicalNumber(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 1000) / 1000) : "NaN";
}

const UNKNOWN: CanonicalField = {
  value: null, status: "unknown", source: null, actorUserId: null, updatedAt: null, valueHash: null, corroboratedBy: [], conflict: null,
};

/**
 * Resolve UM caminho a partir das afirmações:
 *  1. aplica a POLÍTICA (fonte não autorizada é ignorada — defesa em profundidade);
 *  2. considera a afirmação mais recente por fonte (sourceType + sourceId);
 *  3. SUPERAÇÃO CONSCIENTE: uma afirmação posterior, de autoridade ≥, feita VENDO o valor de outra
 *     (basisValueHash = hash daquele valor) supera-a — ex.: o humano alterou no DFD o valor pré-preenchido;
 *  4. entre as vigentes de MAIOR autoridade: valor único → resolvido; valores distintos → CONFLITO (sem
 *     valor escolhido). Afirmações de autoridade menor não geram conflito.
 */
export function resolveField(path: ContextPath, assertions: readonly FactAssertion[]): CanonicalField {
  const allowed = assertions.filter((a) => a.path === path && isSourceAllowed(path, a.sourceType));
  if (allowed.length === 0) return { ...UNKNOWN };

  // 2. vigente por fonte (maior id; projeções id 0 empatam por createdAt — são únicas por fonte).
  const bySource = new Map<string, FactAssertion>();
  for (const a of allowed) {
    const k = `${a.sourceType}:${a.sourceId}`;
    const cur = bySource.get(k);
    if (!cur || cmp(a, cur) > 0) bySource.set(k, a);
  }
  let current = [...bySource.values()];

  // 3. superação consciente.
  current = current.filter((c) => !current.some((d) =>
    d !== c && cmp(d, c) > 0 && d.basisValueHash === c.valueHash && STATUS_RANK[d.status] >= STATUS_RANK[c.status]));

  // 4. maior autoridade.
  const top = Math.max(...current.map((c) => STATUS_RANK[c.status]));
  const winners = current.filter((c) => STATUS_RANK[c.status] === top).sort((a, b) => cmp(b, a));
  const distinct = new Set(winners.map((w) => w.valueHash));
  const src = (a: FactAssertion): FieldSource => ({ type: a.sourceType, id: a.sourceId, version: a.sourceVersion });

  if (distinct.size > 1) {
    return {
      ...UNKNOWN, status: "conflict",
      conflict: winners.map((w) => ({ value: w.value, source: src(w), status: w.status, actorUserId: w.actorUserId })),
    };
  }
  const w = winners[0];
  if (w.value === null) return { ...UNKNOWN };
  return {
    value: w.value, status: w.status, source: src(w), actorUserId: w.actorUserId, updatedAt: w.createdAt,
    valueHash: w.valueHash, corroboratedBy: winners.slice(1).map(src), conflict: null,
  };
}

/** Ordem canônica: id do ledger (projeções = 0 vêm antes de qualquer afirmação), depois createdAt. */
function cmp(a: FactAssertion, b: FactAssertion): number {
  if (a.id !== b.id) return a.id - b.id;
  return (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
}

// ─── Fingerprint de item (necessidade ≠ cotação) ─────────────────────────────────────

/**
 * FINGERPRINT determinístico do item da contratação: descrição normalizada + unidade canônica — SEM
 * quantidade. NÃO é identidade: a identidade persistente é o `id` estável do Item Canônico
 * (`procurement_items`). O fingerprint só PROPÕE vínculo (igualdade exata normalizada, sem fuzzy, sem
 * LLM); colisão/ambiguidade exige decisão humana. Reusa as normalizações da chave do Item Inteligente.
 */
export function canonicalItemKey(description: string, unit: string | null | undefined): string {
  return createHash("sha256")
    .update(`need-item:v1:${normalizeDescription(description)}|${canonicalUnit(unit)}`)
    .digest("hex").slice(0, 16);
}

export function itemPath(key: string, field: ItemFieldName): ItemPath {
  return `items.${key}.${field}`;
}

// ─── Evidência de preço (formato-agnóstica) ───────────────────────────────────────────

/**
 * Contrato SEMÂNTICO de evidência de preço — o mesmo para PDF, XLSX, CSV, DOCX, colagem e entrada manual
 * (tudo converge para Itens Inteligentes/cotações). `sourceQuantity` é a quantidade VISTA no documento:
 * pode ser 1, a quantidade real, parcial ou ausente (null) — e NUNCA vira `plannedQuantity`.
 */
export interface PriceEvidence {
  itemKey: string;
  intelligentItemId: string;
  description: string;
  unit: string;
  sourceQuantity: number | null;
  unitAmountCents: number | null;
  quoteCount: number;
  approved: boolean;
}

// ─── Entradas e contexto resolvido ─────────────────────────────────────────────────────

export interface ContextInputs {
  organizationId: number;
  processId: string;
  process: { number: string; object: string; responsibleUserId: number; createdAt: string };
  responsibleUserName: string | null;
  organization: { name: string | null; municipio: string | null; uf: string | null } | null;
  /** Afirmações do ledger (JÁ filtradas por organizationId + processId pelo chamador). */
  assertions: readonly FactAssertion[];
  /** Itens Inteligentes (Pesquisa de Preços) — EVIDÊNCIA de preço/quantidade da fonte, nunca a necessidade. */
  intelligentItems: ReadonlyArray<{
    id: string; description: string; unit: string; quantity: number; status: string;
    averagePriceCents: number; quoteCount: number;
  }>;
  /** Itens Canônicos da Contratação (entidade persistente com id estável). */
  procurementItems?: ReadonlyArray<{
    id: string; description: string; unit: string; lotId: string | null; ordinal: number;
    status: string; revision: number; fingerprint: string;
  }>;
  /** Lotes (opcionais). */
  lots?: ReadonlyArray<{ id: string; code: string; name: string; ordinal: number; status: string }>;
  /** Vínculos Item Canônico → Item Inteligente (evidência de preço), decididos por humano. */
  priceLinks?: ReadonlyArray<{ itemId: string; intelligentItemId: string }>;
}

export interface CanonicalItem {
  /** Id ESTÁVEL do Item Canônico (procurement_items.id) — identidade persistente. */
  key: string;
  /** Fingerprint (descrição+unidade) — só para proposta de vínculo, nunca identidade. */
  fingerprint: string;
  lotId: string | null;
  ordinal: number;
  description: CanonicalField<string>;
  unit: CanonicalField<string>;
  plannedQuantity: CanonicalField<number>;
  priceContext: {
    /**
     * Preço de referência unitário CONSUMIDO do domínio da Pesquisa de Preços: o `averagePriceCents` do
     * Item Inteligente APROVADO vinculado a ESTE item (média das cotações DESTE item, calculada lá). O
     * contexto não cria regra de preço: nunca faz média entre itens diferentes nem entre Itens Inteligentes.
     * Vários vinculados com preços distintos ⇒ null + `priceAmbiguous` (decisão humana).
     */
    unitReferencePriceCents: number | null;
    priceAmbiguous: boolean;
    evidenceCount: number;
    /** Quantidades vistas nos documentos da pesquisa (distintas; null = documento sem quantidade). */
    sourceQuantities: Array<number | null>;
    intelligentItemIds: string[];
  };
  /** plannedQuantity × unitReferencePrice — só quando AMBOS estão institucionalmente definidos. */
  estimatedTotalCents: number | null;
}

export interface ProcurementCanonicalContext {
  contractVersion: typeof CANONICAL_CONTEXT_VERSION;
  organizationId: number;
  processId: string;
  process: { number: CanonicalField<string>; object: CanonicalField<string> };
  organization: { name: CanonicalField<string>; location: CanonicalField<string> };
  /** Lotes ativos, em ordem. Vazio = contratação sem lotes. */
  lots: Array<{ id: string; code: string; name: string; ordinal: number }>;
  demand: { requestingUnit: CanonicalField<string>; responsibleParty: CanonicalField<string> };
  planning: { pcaAlignment: CanonicalField<string>; priority: CanonicalField<string>; desiredDate: CanonicalField<string> };
  items: CanonicalItem[];
  priceContext: {
    estimatedTotalCents: number | null;
    complete: boolean;
    itemsMissingPlannedQuantity: number;
    itemsMissingReferencePrice: number;
  };
  stats: { knownFields: number; unknownFields: number; conflictCount: number };
  /** Sequência do ledger consumida (0 = só projeções). Monotônica por processo. */
  version: number;
  /** Digest determinístico dos FATOS resolvidos (valor + origem + estado). Muda ⇔ algum fato muda. */
  digest: string;
}

function projection(
  path: ContextPath, value: string | null | undefined, sourceType: ContextSourceType, sourceId: string,
  status: AssertionStatus, createdAt: string,
): FactAssertion | null {
  const v = value == null ? null : normalizeText(String(value));
  if (!v) return null;
  const valueHash = factValueHash(v);
  return { id: 0, path, value: v, valueHash, sourceType, sourceId, sourceVersion: valueHash, status, actorUserId: null, basisValueHash: null, createdAt };
}

/** Resolve o contexto canônico completo. Mesmas entradas ⇒ mesmo contexto e mesmo digest. */
export function resolveCanonicalContext(input: ContextInputs): ProcurementCanonicalContext {
  const t0 = input.process.createdAt;
  const proj: FactAssertion[] = [
    projection("process.number", input.process.number, "process", input.processId, "confirmed", t0),
    projection("process.object", input.process.object, "process", input.processId, "confirmed", t0),
    projection("demand.responsibleParty", input.responsibleUserName, "process", input.processId, "confirmed", t0),
    projection("organization.name", input.organization?.name, "organization", String(input.organizationId), "confirmed", t0),
    projection("organization.location",
      [input.organization?.municipio, input.organization?.uf].filter(Boolean).join("/") || null,
      "organization", String(input.organizationId), "confirmed", t0),
  ].filter((x): x is FactAssertion => x !== null);

  // Itens Inteligentes (não rejeitados) → EVIDÊNCIA de preço e de quantidade da fonte (sourceQuantity).
  const evidence: PriceEvidence[] = input.intelligentItems
    .filter((i) => i.status !== "rejeitado")
    .map((i) => ({
      itemKey: canonicalItemKey(i.description, i.unit), intelligentItemId: i.id,
      description: normalizeText(i.description), unit: canonicalUnit(i.unit),
      sourceQuantity: Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : null,
      unitAmountCents: i.averagePriceCents > 0 ? i.averagePriceCents : null,
      quoteCount: i.quoteCount, approved: i.status === "aprovado",
    }));
  const evidenceById = new Map(evidence.map((e) => [e.intelligentItemId, e]));

  // Itens Canônicos ATIVOS → descrição/unidade projetadas da ENTIDADE (confirmadas por humano ao criar).
  const pItems = (input.procurementItems ?? []).filter((i) => i.status === "active");
  const lots = (input.lots ?? []).filter((l) => l.status === "active")
    .map((l) => ({ id: l.id, code: l.code, name: l.name, ordinal: l.ordinal }))
    .sort((a, b) => a.ordinal - b.ordinal || (a.id < b.id ? -1 : 1));
  const lotOrder = new Map(lots.map((l, i) => [l.id, i]));
  for (const it of pItems) {
    const d = projection(itemPath(it.id, "description"), it.description, "user", `pitem:${it.id}`, "confirmed", t0);
    const u = projection(itemPath(it.id, "unit"), it.unit, "user", `pitem:${it.id}`, "confirmed", t0);
    if (d) proj.push(d);
    if (u) proj.push(u);
  }

  const all = [...proj, ...input.assertions];
  const f = (p: ContextPath) => resolveField(p, all);

  const items: CanonicalItem[] = pItems.map((it) => {
    const ev = (input.priceLinks ?? []).filter((l) => l.itemId === it.id)
      .map((l) => evidenceById.get(l.intelligentItemId)).filter((e): e is PriceEvidence => !!e);
    const priced = ev.filter((e) => e.approved && e.unitAmountCents !== null && e.quoteCount > 0);
    const distinct = [...new Set(priced.map((e) => e.unitAmountCents as number))];
    const unitReferencePriceCents = distinct.length === 1 ? distinct[0] : null;
    const sourceQuantities = [...new Set(ev.map((e) => e.sourceQuantity))].sort((a, b) => (a ?? -1) - (b ?? -1));
    const plannedQuantity = asNumberField(f(itemPath(it.id, "plannedQuantity")));
    const pq = plannedQuantity.value;
    const lotId = it.lotId && lotOrder.has(it.lotId) ? it.lotId : null;
    return {
      key: it.id, fingerprint: it.fingerprint, lotId, ordinal: it.ordinal,
      description: f(itemPath(it.id, "description")) as CanonicalField<string>,
      unit: f(itemPath(it.id, "unit")) as CanonicalField<string>,
      plannedQuantity,
      priceContext: {
        unitReferencePriceCents, priceAmbiguous: distinct.length > 1,
        evidenceCount: ev.reduce((s, e) => s + e.quoteCount, 0),
        sourceQuantities, intelligentItemIds: ev.map((e) => e.intelligentItemId).sort(),
      },
      estimatedTotalCents: pq !== null && pq > 0 && unitReferencePriceCents !== null
        ? multiplyQuantityCents(pq, unitReferencePriceCents) : null,
    };
  }).sort((a, b) => {
    // Ordem oficial: lotes (ordinal) → itens sem lote → ordinal do item → id (desempate estável).
    const la = a.lotId === null ? Number.MAX_SAFE_INTEGER : lotOrder.get(a.lotId)!;
    const lb = b.lotId === null ? Number.MAX_SAFE_INTEGER : lotOrder.get(b.lotId)!;
    return la - lb || a.ordinal - b.ordinal || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  });

  const ctx: Omit<ProcurementCanonicalContext, "stats" | "version" | "digest" | "priceContext"> = {
    contractVersion: CANONICAL_CONTEXT_VERSION,
    organizationId: input.organizationId,
    processId: input.processId,
    process: { number: f("process.number") as CanonicalField<string>, object: f("process.object") as CanonicalField<string> },
    organization: { name: f("organization.name") as CanonicalField<string>, location: f("organization.location") as CanonicalField<string> },
    lots,
    demand: {
      requestingUnit: f("demand.requestingUnit") as CanonicalField<string>,
      responsibleParty: f("demand.responsibleParty") as CanonicalField<string>,
    },
    planning: {
      pcaAlignment: f("planning.pcaAlignment") as CanonicalField<string>,
      priority: f("planning.priority") as CanonicalField<string>,
      desiredDate: f("planning.desiredDate") as CanonicalField<string>,
    },
    items,
  };

  const missingQty = items.filter((i) => i.plannedQuantity.value === null).length;
  const missingPrice = items.filter((i) => i.priceContext.unitReferencePriceCents === null).length;
  const complete = items.length > 0 && missingQty === 0 && missingPrice === 0;
  const priceContext = {
    estimatedTotalCents: complete ? sumCents(items.map((i) => i.estimatedTotalCents as number)) : null,
    complete, itemsMissingPlannedQuantity: missingQty, itemsMissingReferencePrice: missingPrice,
  };

  const fields = allFields(ctx);
  const stats = {
    knownFields: fields.filter((x) => x.value !== null).length,
    unknownFields: fields.filter((x) => x.value === null && x.status !== "conflict").length,
    conflictCount: fields.filter((x) => x.status === "conflict").length,
  };
  const version = input.assertions.reduce((m, a) => Math.max(m, a.id), 0);
  const digest = canonicalDigest(digestSnapshot(ctx, priceContext));
  return { ...ctx, priceContext, stats, version, digest };
}

function asNumberField(f: CanonicalField): CanonicalField<number> {
  if (f.value === null || typeof f.value === "number") return f as CanonicalField<number>;
  const n = Number(f.value);
  return Number.isFinite(n) ? { ...f, value: n } : { ...f, value: null, status: "unknown" };
}

function allFields(ctx: Pick<ProcurementCanonicalContext, "process" | "organization" | "demand" | "planning" | "items">): CanonicalField[] {
  return [
    ctx.process.number, ctx.process.object, ctx.organization.name, ctx.organization.location,
    ctx.demand.requestingUnit, ctx.demand.responsibleParty,
    ctx.planning.pcaAlignment, ctx.planning.priority, ctx.planning.desiredDate,
    ...ctx.items.flatMap((i) => [i.description, i.unit, i.plannedQuantity]),
  ];
}

function fieldSnap(f: CanonicalField): CanonicalValue {
  return {
    v: f.value, s: f.status, src: f.source ? `${f.source.type}:${f.source.id}:${f.source.version}` : null,
    c: f.conflict ? f.conflict.map((c) => `${c.source.type}:${c.source.id}:${factValueHash(c.value)}`).sort() : null,
  };
}

/** Snapshot canônico do digest — FATOS (valor + origem + estado), sem timestamps/atores/ordem de leitura. */
function digestSnapshot(
  ctx: Pick<ProcurementCanonicalContext, "contractVersion" | "organizationId" | "processId" | "process" | "organization" | "lots" | "demand" | "planning" | "items">,
  price: ProcurementCanonicalContext["priceContext"],
): CanonicalValue {
  return {
    v: ctx.contractVersion, o: ctx.organizationId, p: ctx.processId,
    process: { number: fieldSnap(ctx.process.number), object: fieldSnap(ctx.process.object) },
    org: { name: fieldSnap(ctx.organization.name), loc: fieldSnap(ctx.organization.location) },
    demand: { unit: fieldSnap(ctx.demand.requestingUnit), resp: fieldSnap(ctx.demand.responsibleParty) },
    planning: { pca: fieldSnap(ctx.planning.pcaAlignment), prio: fieldSnap(ctx.planning.priority), date: fieldSnap(ctx.planning.desiredDate) },
    lots: ctx.lots.map((l) => ({ id: l.id, c: l.code, n: l.name })),
    items: ctx.items.map((i) => ({
      k: i.key, l: i.lotId, d: fieldSnap(i.description), u: fieldSnap(i.unit), q: fieldSnap(i.plannedQuantity),
      ref: i.priceContext.unitReferencePriceCents, amb: i.priceContext.priceAmbiguous,
      sq: i.priceContext.sourceQuantities, n: i.priceContext.evidenceCount,
    })),
    total: price.estimatedTotalCents,
  };
}

/**
 * Itens da Contratação — domínio PURO (sem I/O) do Item Canônico, do Lote e dos Candidatos.
 *
 * Princípios:
 *  - IDENTIDADE ≠ FINGERPRINT: o Item Canônico tem `id` estável (gerado uma vez, a partir da ORIGEM, nunca
 *    da descrição); o fingerprint (descrição normalizada + unidade canônica) só PROPÕE vínculo. Igualdade
 *    exata; nada de fuzzy, embeddings ou LLM; colisão/ambiguidade ⇒ decisão humana.
 *  - FONTE ≠ NECESSIDADE: `sourceQuantity` (quantidade vista no documento/pesquisa) é evidência e NUNCA vira
 *    `plannedQuantity` sozinha — só por decisão humana explícita ("Usar N"), com proveniência.
 *  - LOTE ≠ IDENTIDADE: o lote é pertencimento estrutural (lotId | null); mover de lote não cria item novo.
 *  - Pesquisa/DFD/ETP/TR não são donos dos itens: PRODUZEM evidências (candidatos) ou CONSOMEM o item.
 */
import { createHash } from "crypto";
import { canonicalItemKey, normalizeText } from "./canonicalProcurementContext";
import { intelligentItemLogicalKey } from "./priceQuoteConsolidation";
import { numberToDecimalString } from "./money";

export const PROCUREMENT_ITEMS_VERSION = "procurement-items/1";

// ─── Tipos ─────────────────────────────────────────────────────────────────────────────

export type ItemOrigin = "price_research" | "dfd" | "manual";
export type ItemStatus = "active" | "withdrawn";
export type LotStatus = "active" | "archived";
export type CandidateSourceType = "price_research" | "dfd";

export interface FieldProvenance {
  /** Origem do valor vigente: fonte estruturada ou humano ("user"). */
  source: ItemOrigin | "user";
  sourceId: string | null;
  /** Valor como veio da fonte (preservado quando o humano corrigiu). */
  sourceValue: string | null;
  /** Humano que alterou o valor da fonte (null = aceito como veio). */
  overriddenBy: number | null;
  at: string;
}

export interface ItemProvenance {
  description: FieldProvenance;
  unit: FieldProvenance;
  lot: { assignedBy: number | null; source: "manual" | "source_structure" | null; at: string | null };
  /** Contexto opcional do item manual (motivo, documento de referência) — continua MANUAL. */
  manual?: { reason: string | null; contextDocumentId: string | null } | null;
}

export interface ProcurementItem {
  id: string;
  organizationId: number;
  processId: string;
  description: string;
  unit: string;
  lotId: string | null;
  ordinal: number;
  status: ItemStatus;
  fingerprint: string;
  origin: ItemOrigin;
  provenance: ItemProvenance;
  revision: number;
  createdBy: number;
  updatedBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProcurementLot {
  id: string;
  organizationId: number;
  processId: string;
  code: string;
  codeKey: string;
  name: string;
  description: string | null;
  ordinal: number;
  status: LotStatus;
  revision: number;
  createdBy: number;
  updatedBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface ItemSourceLink {
  itemId: string;
  sourceType: CandidateSourceType;
  sourceId: string;
  sourceItemKey: string;
  sourceDigest: string;
  sourceQuantity: number | null;
  sourceDescription: string;
  sourceUnit: string;
  sourceLotCode: string | null;
  createdBy: number;
  createdAt: string;
}

// ─── Identidades ────────────────────────────────────────────────────────────────────────

const h = (s: string, n = 24) => createHash("sha256").update(s).digest("hex").slice(0, n);

/** Id ESTÁVEL do Item Canônico: função da ORIGEM (fonte+chave estrutural, ou chave idempotente do manual). */
export function procurementItemId(organizationId: number, processId: string, originKey: string): string {
  return h(`pitem:v1:${organizationId}:${processId}:${originKey}`);
}

export function procurementLotId(organizationId: number, processId: string, originKey: string): string {
  return h(`plot:v1:${organizationId}:${processId}:${originKey}`);
}

export const itemFingerprint = canonicalItemKey;

/** Código de lote normalizado para unicidade/comparação: "Lote 01" ≡ "01" ≡ "1" (numérico sem zeros à esquerda). */
export function lotCodeKey(code: string): string {
  const t = normalizeText(code).toUpperCase().replace(/^LOTE\s*/, "").trim();
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

export function candidateKeyOf(sourceType: CandidateSourceType, sourceId: string, sourceItemKey: string): string {
  return h(`pcand:v1:${sourceType}:${sourceId}:${sourceItemKey}`);
}

// ─── Quantidade (contrato decimal DECIMAL(14,3)) ─────────────────────────────────────────

export type QuantityParse = { ok: true; value: number | null } | { ok: false; error: string };

/**
 * Quantidade prevista: vazio ⇒ null (válido: item pode existir sem quantidade). Aceita "35", "35,5",
 * "1.200", "1.200,5", 35.5. Exige > 0, no máximo 3 casas decimais e 11 dígitos inteiros. O valor é
 * validado a partir do texto decimal (sem arredondar em float) e carregado como número canônico.
 */
export function parsePlannedQuantity(input: string | number | null | undefined): QuantityParse {
  if (input === null || input === undefined) return { ok: true, value: null };
  let s = typeof input === "number" ? (numberToDecimalString(input) ?? "") : String(input).trim();
  if (s === "") return { ok: true, value: null };
  if (typeof input !== "number") {
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, "");
    s = s.replace(",", ".");
  }
  const m = /^(\d{1,11})(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) return { ok: false, error: "INVALID_QUANTITY: informe um número maior que zero, com até 3 casas decimais." };
  const n = Number(s);
  if (!(n > 0)) return { ok: false, error: "INVALID_QUANTITY: a quantidade prevista deve ser maior que zero." };
  return { ok: true, value: n };
}

export function formatQuantityBR(q: number | null): string {
  if (q === null) return "";
  return (numberToDecimalString(q) ?? String(q)).replace(".", ",");
}

// ─── Candidatos ─────────────────────────────────────────────────────────────────────────

export type CandidateMatchStatus =
  | "linked"          // esta evidência já está vinculada a um Item Canônico (reprocessar não duplica)
  | "possible_match"  // fingerprint idêntico a UM item existente — "Possível item já cadastrado" (humano decide)
  | "ambiguous"       // fingerprint idêntico a VÁRIOS itens — humano escolhe
  | "new"             // nenhum item correspondente
  | "blocked";        // fonte com revisão de identidade pendente — não utilizável ainda

export interface ItemCandidate {
  candidateKey: string;
  sourceType: CandidateSourceType;
  sourceId: string;
  sourceItemKey: string;
  sourceDigest: string;
  description: string;
  unit: string;
  sourceQuantity: number | null;
  /** Lote EXPLÍCITO na fonte (estrutura), nunca inferido por semântica. */
  sourceLotCode: string | null;
  fingerprint: string;
  match: { status: CandidateMatchStatus; canonicalItemId: string | null; candidateItemIds: string[]; reason: string | null };
  /** Outro candidato do MESMO lote com mesmo fingerprint (ex.: cotado com quantidades distintas). */
  duplicateOfCandidateKey: string | null;
  /** Lote existente correspondente ao código da fonte (quando houver). */
  sourceLotId: string | null;
}

export interface IntelligentItemSource {
  id: string; description: string; unit: string; quantity: number; status: string;
  sourceState?: string | null; averagePriceCents?: number; quoteCount?: number;
  /** Decisão humana do Item Inteligente (quem aprovou). */
  approvedBy?: number | null;
  /** Pesquisa de origem do item (`intelligent_items.source_research_id`). */
  sourceResearchId?: string | null;
  /** Pesquisas das COTAÇÕES do item (`suppliers[].researchId`) — lineage por cotação. */
  evidenceResearchIds?: readonly string[];
}

function digest(parts: Array<string | number | null>): string {
  return h(JSON.stringify(parts), 32);
}

// ─── Elegibilidade de candidatos da Pesquisa de Preços (lineage + workflow) ───────────────────

/**
 * Proveniência de uma pesquisa (`price_research`) do processo, RESOLVIDA PELO SERVIDOR (tenant-scoped):
 *  - `promoted_session`: pesquisa criada pela PROMOÇÃO GOVERNADA de uma sessão de importação — sessão
 *    `approved` (revisão humana concluída, nenhuma linha pendente) e `promotionStatus = promoted`, com ledger
 *    `import_promotions` (targetKind price_research, targetRef = pesquisa) no MESMO tenant e processo;
 *  - `manual_import`: pesquisa registrada pelo caminho manual/colar (`importPriceResearch`), sem sessão de
 *    importação — o texto vira cotações SEM revisão prévia; a revisão humana é a DECISÃO do Item Inteligente.
 * Pesquisa ausente do mapa ⇒ desconhecida (outro processo/tenant, removida ou nunca registrada).
 */
export type PriceResearchProvenance = "promoted_session" | "manual_import";
export interface PriceResearchRecord { researchId: string; provenance: PriceResearchProvenance; importSessionId: number | null }

export type CandidateIneligibility =
  | "rejected"                  // Item Inteligente rejeitado
  | "no_lineage"                // sem pesquisa de origem nem cotações com pesquisa (órfão)
  | "unknown_research"          // pesquisa(s) de origem não pertencem ao processo/tenant ou não existem
  | "manual_import_unreviewed"; // importação manual cujo Item ainda NÃO foi aprovado por um humano

export type CandidateEligibility =
  | { eligible: true; via: "promoted_session" | "approved_manual_import"; importSessionIds: number[] }
  | { eligible: false; reason: CandidateIneligibility };

/**
 * REGRA CENTRAL de elegibilidade de um Item Inteligente como candidato a Item da contratação. Existir em
 * `intelligent_items` NÃO basta: é preciso lineage comprovável até uma origem governada.
 *  1. rejeitado ⇒ inelegível;
 *  2. pesquisas de evidência = origem do item ∪ pesquisas das cotações; nenhuma ⇒ inelegível (órfão);
 *  3. alguma pesquisa de SESSÃO PROMOVIDA (revisão humana aprovada + promoção) ⇒ elegível;
 *  4. só importação manual ⇒ elegível apenas com o Item APROVADO por humano (status `aprovado` + `approvedBy`);
 *  5. caso contrário (pesquisas desconhecidas) ⇒ inelegível — FAIL-CLOSED, sem inferência.
 * Nunca usa descrição, quantidade, preço ou nº de cotações como critério; sem IA, sem fuzzy.
 */
export function priceResearchCandidateEligibility(
  item: IntelligentItemSource, researches: ReadonlyMap<string, PriceResearchRecord>,
): CandidateEligibility {
  if (item.status === "rejeitado") return { eligible: false, reason: "rejected" };
  const ids = [...new Set([item.sourceResearchId ?? "", ...(item.evidenceResearchIds ?? [])].filter((x) => x.trim() !== ""))];
  if (ids.length === 0) return { eligible: false, reason: "no_lineage" };
  const known = ids.map((id) => researches.get(id)).filter((r): r is PriceResearchRecord => !!r);
  const promoted = known.filter((r) => r.provenance === "promoted_session");
  if (promoted.length > 0) {
    return { eligible: true, via: "promoted_session", importSessionIds: [...new Set(promoted.map((r) => r.importSessionId).filter((x): x is number => x !== null))].sort((a, b) => a - b) };
  }
  if (known.some((r) => r.provenance === "manual_import")) {
    return item.status === "aprovado" && item.approvedBy != null
      ? { eligible: true, via: "approved_manual_import", importSessionIds: [] }
      : { eligible: false, reason: "manual_import_unreviewed" };
  }
  return { eligible: false, reason: "unknown_research" };
}

export interface PriceResearchEligibilitySummary {
  intelligentItemCount: number; eligibleCount: number; ineligibleCount: number;
  rejectedCount: number; legacyOrUnlinkedCount: number; manualUnreviewedCount: number;
  promotedSessionCount: number;
}

export function summarizePriceResearchEligibility(
  items: readonly IntelligentItemSource[], researches: ReadonlyMap<string, PriceResearchRecord>,
): PriceResearchEligibilitySummary {
  const results = items.map((i) => priceResearchCandidateEligibility(i, researches));
  const why = (r: CandidateIneligibility) => results.filter((x) => !x.eligible && x.reason === r).length;
  const sessions = new Set(results.flatMap((x) => (x.eligible ? x.importSessionIds : [])));
  const eligibleCount = results.filter((x) => x.eligible).length;
  return {
    intelligentItemCount: items.length, eligibleCount, ineligibleCount: items.length - eligibleCount,
    rejectedCount: why("rejected"), legacyOrUnlinkedCount: why("no_lineage") + why("unknown_research"),
    manualUnreviewedCount: why("manual_import_unreviewed"), promotedSessionCount: sessions.size,
  };
}

/**
 * Fonte de candidatos da Pesquisa de Preços: SOMENTE Itens Inteligentes ELEGÍVEIS
 * (`priceResearchCandidateEligibility`). Identidade em revisão (`review_required`) fica BLOQUEADA.
 * Staging/OCR não revisado NUNCA é fonte de candidato (não gera Item Inteligente).
 */
export function priceResearchCandidateSources(
  items: readonly IntelligentItemSource[], researches: ReadonlyMap<string, PriceResearchRecord>,
): Array<Omit<ItemCandidate, "match" | "duplicateOfCandidateKey" | "sourceLotId" | "candidateKey"> & { blocked: boolean }> {
  return items.filter((i) => priceResearchCandidateEligibility(i, researches).eligible).map((i) => {
    const sourceItemKey = h(intelligentItemLogicalKey({ description: i.description, unit: i.unit, quantity: i.quantity }), 32);
    const q = Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : null;
    return {
      sourceType: "price_research" as const, sourceId: i.id, sourceItemKey,
      sourceDigest: digest([i.description, i.unit, q]),
      description: normalizeText(i.description), unit: normalizeText(i.unit ?? "") || "UN",
      sourceQuantity: q, sourceLotCode: null, fingerprint: itemFingerprint(i.description, i.unit),
      blocked: i.sourceState === "review_required",
    };
  });
}

export interface DFDRowSource { description: string; unit: string; quantity: number | null; lotCode: string | null }

/** Linhas da tabela de itens do DFD (inclusive coluna "Lote", quando presente) como fonte de candidatos. */
export function dfdCandidateSources(documentId: string, rows: readonly DFDRowSource[]) {
  return rows.map((r) => {
    const lot = r.lotCode ? lotCodeKey(r.lotCode) : "";
    const fp = itemFingerprint(r.description, r.unit);
    return {
      sourceType: "dfd" as const, sourceId: documentId, sourceItemKey: `${fp}:${lot}`,
      sourceDigest: digest([r.description, r.unit, r.quantity, lot]),
      description: normalizeText(r.description), unit: normalizeText(r.unit ?? "") || "UN",
      sourceQuantity: r.quantity, sourceLotCode: r.lotCode ? normalizeText(r.lotCode) : null, fingerprint: fp,
      blocked: false,
    };
  });
}

/**
 * Matching determinístico, na ordem: (1) vínculo persistido desta mesma evidência; (2) identidade
 * estrutural já vinculada (mesma fonte, mesma chave estrutural); (3) fingerprint EXATO ⇒ apenas
 * PROPOSTA (possible_match/ambiguous); (4) novo. Nada é fundido automaticamente.
 */
export function matchCandidates(
  sources: ReadonlyArray<ReturnType<typeof priceResearchCandidateSources>[number] | ReturnType<typeof dfdCandidateSources>[number]>,
  items: readonly Pick<ProcurementItem, "id" | "fingerprint" | "status" | "lotId">[],
  links: readonly Pick<ItemSourceLink, "itemId" | "sourceType" | "sourceId" | "sourceItemKey">[],
  lots: readonly Pick<ProcurementLot, "id" | "codeKey" | "status">[],
): ItemCandidate[] {
  const active = items.filter((i) => i.status === "active");
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Map<string, string>();
  return sources.map((s) => {
    const candidateKey = candidateKeyOf(s.sourceType, s.sourceId, s.sourceItemKey);
    const sourceLotId = s.sourceLotCode
      ? lots.find((l) => l.status === "active" && l.codeKey === lotCodeKey(s.sourceLotCode!))?.id ?? null
      : null;
    let match: ItemCandidate["match"];
    const exact = links.find((l) => l.sourceType === s.sourceType && l.sourceId === s.sourceId && l.sourceItemKey === s.sourceItemKey);
    const structural = exact ?? links.find((l) => l.sourceType === s.sourceType && l.sourceItemKey === s.sourceItemKey);
    if (s.blocked) {
      match = { status: "blocked", canonicalItemId: null, candidateItemIds: [], reason: "Identidade do item em revisão na Pesquisa de Preços." };
    } else if (structural && byId.get(structural.itemId)?.status === "active") {
      match = { status: "linked", canonicalItemId: structural.itemId, candidateItemIds: [structural.itemId], reason: null };
    } else {
      const same = active.filter((i) => i.fingerprint === s.fingerprint && (sourceLotId === null || i.lotId === null || i.lotId === sourceLotId));
      match = same.length === 1
        ? { status: "possible_match", canonicalItemId: null, candidateItemIds: [same[0].id], reason: "Possível item já cadastrado." }
        : same.length > 1
          ? { status: "ambiguous", canonicalItemId: null, candidateItemIds: same.map((i) => i.id).sort(), reason: "Mais de um item cadastrado corresponde a esta descrição e unidade." }
          : { status: "new", canonicalItemId: null, candidateItemIds: [], reason: null };
    }
    const dupKey = `${s.fingerprint}:${s.sourceLotCode ? lotCodeKey(s.sourceLotCode) : ""}`;
    const duplicateOfCandidateKey = match.status === "linked" || match.status === "blocked" ? null : seen.get(dupKey) ?? null;
    if (!duplicateOfCandidateKey && match.status !== "linked" && match.status !== "blocked") seen.set(dupKey, candidateKey);
    return { ...s, candidateKey, match, duplicateOfCandidateKey, sourceLotId } as ItemCandidate;
  });
}

// ─── Decisões humanas sobre candidatos ──────────────────────────────────────────────────

export type LotChoice = { kind: "none" } | { kind: "existing"; lotId: string } | { kind: "source" };

export type CandidateDecision =
  | {
      candidateKey: string; action: "create";
      description?: string; unit?: string;
      plannedQuantity?: string | number | null;
      /** "Usar N" — adota a quantidade da fonte como prevista, por decisão explícita. */
      adoptSourceQuantity?: boolean;
      lot?: LotChoice;
    }
  | { candidateKey: string; action: "link"; canonicalItemId?: string; toCandidateKey?: string }
  | { candidateKey: string; action: "skip" };

export interface PlannedCreate {
  itemId: string; candidate: ItemCandidate; description: string; unit: string;
  descriptionOverridden: boolean; unitOverridden: boolean;
  quantity: number | null; quantityMode: "informed" | "adopted_source" | null;
  lot: { kind: "none" } | { kind: "existing"; lotId: string } | { kind: "source"; code: string; codeKey: string; lotId: string };
}
export interface PlannedLink { itemId: string; candidate: ItemCandidate }
export interface CandidatePlan { creates: PlannedCreate[]; links: PlannedLink[]; lotsToCreate: Array<{ lotId: string; code: string; codeKey: string }>; skipped: number }

export class ItemDomainError extends Error {
  constructor(public readonly code: string, message: string) { super(`${code}: ${message}`); }
}

/**
 * Valida as decisões contra a projeção RECALCULADA no servidor (o browser não escolhe ids arbitrários):
 * candidato inexistente/desatualizado ⇒ STALE_CANDIDATES; já vinculado ⇒ não cria de novo; possível
 * duplicata/ambiguidade exige ação explícita (create/link); vínculo só a item ativo do processo.
 */
export function planCandidateDecisions(p: {
  organizationId: number; processId: string;
  candidates: readonly ItemCandidate[]; decisions: readonly CandidateDecision[];
  items: readonly Pick<ProcurementItem, "id" | "status">[];
  lots: readonly Pick<ProcurementLot, "id" | "codeKey" | "status">[];
}): CandidatePlan {
  const byKey = new Map(p.candidates.map((c) => [c.candidateKey, c]));
  const seen = new Set<string>();
  const creates: PlannedCreate[] = [];
  const links: PlannedLink[] = [];
  const lotsToCreate = new Map<string, { lotId: string; code: string; codeKey: string }>();
  const deferred: Array<{ c: ItemCandidate; to: string }> = [];
  let skipped = 0;
  for (const d of p.decisions) {
    const c = byKey.get(d.candidateKey);
    if (!c) throw new ItemDomainError("STALE_CANDIDATES", "a lista de itens identificados mudou — recarregue e revise novamente.");
    if (seen.has(d.candidateKey)) throw new ItemDomainError("DUPLICATE_DECISION", "o mesmo item identificado foi decidido duas vezes.");
    seen.add(d.candidateKey);
    if (d.action === "skip") { skipped++; continue; }
    if (c.match.status === "blocked") throw new ItemDomainError("CANDIDATE_BLOCKED", c.match.reason ?? "item bloqueado na fonte.");
    if (c.match.status === "linked") {
      if (d.action === "link" && (d.canonicalItemId === c.match.canonicalItemId || !d.canonicalItemId && !d.toCandidateKey)) { skipped++; continue; }
      throw new ItemDomainError("CANDIDATE_ALREADY_LINKED", "este item identificado já está nos Itens da contratação.");
    }
    if (d.action === "link") {
      if (d.canonicalItemId) {
        const target = p.items.find((i) => i.id === d.canonicalItemId && i.status === "active");
        if (!target) throw new ItemDomainError("ITEM_NOT_FOUND", "item de destino inexistente ou retirado neste processo.");
        links.push({ itemId: target.id, candidate: c });
      } else if (d.toCandidateKey) {
        deferred.push({ c, to: d.toCandidateKey });
      } else throw new ItemDomainError("INVALID_DECISION", "informe o item de destino da associação.");
      continue;
    }
    // create
    const q = parsePlannedQuantity(d.plannedQuantity ?? null);
    if (!q.ok) throw new ItemDomainError("INVALID_QUANTITY", q.error.replace(/^INVALID_QUANTITY: /, ""));
    if (d.adoptSourceQuantity && q.value !== null) throw new ItemDomainError("INVALID_DECISION", "escolha informar a quantidade OU usar a quantidade do documento.");
    if (d.adoptSourceQuantity && c.sourceQuantity === null) throw new ItemDomainError("NO_SOURCE_QUANTITY", "o documento não informa quantidade para este item.");
    const description = normalizeText(d.description ?? c.description);
    const unit = normalizeText(d.unit ?? c.unit);
    if (!description || !unit) throw new ItemDomainError("INVALID_ITEM", "descrição e unidade são obrigatórias.");
    const quantity = d.adoptSourceQuantity ? c.sourceQuantity : q.value;
    let lot: PlannedCreate["lot"] = { kind: "none" };
    const lc = d.lot ?? { kind: "none" };
    if (lc.kind === "existing") {
      if (!p.lots.some((l) => l.id === lc.lotId && l.status === "active")) throw new ItemDomainError("LOT_NOT_FOUND", "lote inexistente ou arquivado neste processo.");
      lot = { kind: "existing", lotId: lc.lotId };
    } else if (lc.kind === "source") {
      if (!c.sourceLotCode) throw new ItemDomainError("NO_SOURCE_LOT", "a fonte não identifica lote para este item.");
      const codeKey = lotCodeKey(c.sourceLotCode);
      const existing = p.lots.find((l) => l.status === "active" && l.codeKey === codeKey);
      const lotId = existing?.id ?? procurementLotId(p.organizationId, p.processId, `src:${codeKey}`);
      if (!existing) lotsToCreate.set(codeKey, { lotId, code: c.sourceLotCode, codeKey });
      lot = { kind: "source", code: c.sourceLotCode, codeKey, lotId };
    }
    creates.push({
      itemId: procurementItemId(p.organizationId, p.processId, `${c.sourceType}:${c.sourceId}:${c.sourceItemKey}`),
      candidate: c, description, unit,
      descriptionOverridden: description !== normalizeText(c.description), unitOverridden: unit !== normalizeText(c.unit),
      quantity, quantityMode: quantity === null ? null : d.adoptSourceQuantity ? "adopted_source" : "informed", lot,
    });
  }
  for (const { c, to } of deferred) {
    const target = creates.find((x) => x.candidate.candidateKey === to);
    if (!target) throw new ItemDomainError("INVALID_DECISION", "o item de destino da associação precisa ser criado nesta mesma confirmação.");
    links.push({ itemId: target.itemId, candidate: c });
  }
  return { creates, links, lotsToCreate: [...lotsToCreate.values()], skipped };
}

// ─── Governança (antecipa a futura Alteração Governada da Necessidade) ─────────────────────

export type NeedChange = "quantity_define" | "quantity_change" | "description" | "unit" | "withdraw" | "create" | "lot";

export interface GovernanceState {
  /** Tipos com versão OFICIAL emitida no processo (Document Engine). */
  officialEmittedKinds: readonly string[];
  /** Itens consumidos por documento APROVADO (ex.: DFD aprovado que listou o item). */
  itemsConsumedByApproved: ReadonlySet<string>;
}

export const GOVERNED_CHANGE_REQUIRED = "GOVERNED_CHANGE_REQUIRED";

/**
 * Regra temporária de domínio (não é o workflow completo): enquanto a necessidade está em ELABORAÇÃO, a
 * edição é livre (com auditoria, nova versão do contexto e drafts dependentes desatualizados). Depois que
 *  (a) TR ou Edital tem versão oficial emitida ⇒ qualquer mudança nos itens/lotes exige alteração governada;
 *  (b) um documento APROVADO consumiu o item ⇒ alterar quantidade já definida, descrição, unidade ou
 *      retirá-lo exige alteração governada (definir pela 1ª vez uma quantidade "a definir" é permitido).
 */
export function governedChangeReason(state: GovernanceState, change: NeedChange, itemId: string | null): string | null {
  const formal = state.officialEmittedKinds.filter((k) => k === "tr" || k === "edital");
  if (formal.length) return `Esta necessidade já foi formalizada (${formal.map((k) => k.toUpperCase()).join(", ")} emitido). Uma alteração governada da necessidade é necessária.`;
  if (itemId && state.itemsConsumedByApproved.has(itemId) && change !== "quantity_define" && change !== "lot" && change !== "create") {
    return "Esta informação já foi utilizada em documento aprovado. Uma alteração governada da necessidade é necessária.";
  }
  return null;
}

// ─── Auditoria (hash sem conteúdo) ────────────────────────────────────────────────────────

export function stateHash(v: unknown): string {
  return h(JSON.stringify(v ?? null), 16);
}

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
import { canonicalUnit, intelligentItemLogicalKey } from "./priceQuoteConsolidation";
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

/**
 * R9 / SEM-067 — id de lote NOVO a partir da origem, sem colidir com um lote já existente (tipicamente um lote
 * ARQUIVADO com a mesma origem, ex.: "manual:1"): base determinística e, se ocupada, `${originKey}#2`, `#3`… — a mesma
 * entrada (mesmo conjunto de lotes) produz sempre o mesmo id. Um lote arquivado nunca é "reaproveitado" como destino.
 */
export function freshLotId(organizationId: number, processId: string, originKey: string, takenIds: Iterable<string>): string {
  const taken = new Set(takenIds);
  let id = procurementLotId(organizationId, processId, originKey);
  for (let n = 2; taken.has(id); n++) id = procurementLotId(organizationId, processId, `${originKey}#${n}`);
  return id;
}

/**
 * R9 / SEM-067 — o índice único `uq_procurement_lots_code (organization_id, process_id, code_key)` cobre também os
 * lotes ARQUIVADOS. Para LIBERAR o código ao arquivar (sem migration), o `code_key` do lote arquivado é renomeado de
 * forma DETERMINÍSTICA para `${prefixo}~${lotId}` (≤ 40 caracteres; único porque o id é único), na MESMA transação do
 * arquivamento. O `code` exibido ("01") é preservado para o histórico; só a chave de unicidade muda.
 */
export const ARCHIVED_LOT_CODE_KEY_SEP = "~";
export function archivedLotCodeKey(codeKey: string, lotId: string): string {
  if (isArchivedLotCodeKey(codeKey, lotId)) return codeKey;
  return `${codeKey.slice(0, Math.max(0, 40 - lotId.length - 1))}${ARCHIVED_LOT_CODE_KEY_SEP}${lotId}`;
}
export function isArchivedLotCodeKey(codeKey: string, lotId: string): boolean {
  return codeKey.endsWith(`${ARCHIVED_LOT_CODE_KEY_SEP}${lotId}`);
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
  /**
   * R9 / SEM-030 — estado GOVERNADO do Item Inteligente (só candidatos da Pesquisa de Preços): status da decisão humana,
   * estado da fonte e preço — exibidos no painel de candidatos (aprovar a extração ≠ aprovar o item).
   */
  evidence?: { status: string; sourceState: string; averagePriceCents: number | null; quoteCount: number } | null;
  /**
   * R9 / SEM-069 — esta MESMA evidência já foi confirmada como um item que depois foi RETIRADO da contratação. Não há
   * transição "retirado → ativo" no domínio: reincluir pelo painel é RECUSADO (ITEM_PREVIOUSLY_WITHDRAWN), nunca um
   * no-op silencioso reportado como sucesso. Ausente/null = nenhum item retirado associado.
   */
  withdrawnItemId?: string | null;
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
  | "manual_import_unreviewed" // importação manual cujo Item ainda NÃO foi aprovado por um humano
  | "item_not_approved";       // R9 / SEM-030: sessão promovida, mas o Item Inteligente não foi aprovado por humano

export type CandidateEligibility =
  | { eligible: true; via: "promoted_session" | "approved_manual_import"; importSessionIds: number[] }
  | { eligible: false; reason: CandidateIneligibility };

/**
 * REGRA CENTRAL de elegibilidade de um Item Inteligente como candidato a Item da contratação. Existir em
 * `intelligent_items` NÃO basta: é preciso lineage comprovável até uma origem governada.
 *  1. rejeitado ⇒ inelegível;
 *  2. pesquisas de evidência = origem do item ∪ pesquisas das cotações; nenhuma ⇒ inelegível (órfão);
 *  3. alguma pesquisa de SESSÃO PROMOVIDA (revisão humana aprovada + promoção) ⇒ elegível SÓ com o Item Inteligente
 *     APROVADO por humano (R9 / SEM-030: aprovar a EXTRAÇÃO não é aprovar o ITEM para a contratação);
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
    if (!(item.status === "aprovado" && item.approvedBy != null)) return { eligible: false, reason: "item_not_approved" };
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
  /** R9 / SEM-030 — itens de sessão promovida ainda sem aprovação humana do Item Inteligente. */
  itemNotApprovedCount: number;
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
    itemNotApprovedCount: why("item_not_approved"),
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
      // R9 / SEM-030: fonte alterada (`source_changed`) também bloqueia — o item precisa ser revisado antes.
      blocked: (i.sourceState ?? "current") !== "current",
      evidence: {
        status: i.status, sourceState: i.sourceState ?? "current",
        averagePriceCents: i.averagePriceCents && i.averagePriceCents > 0 ? i.averagePriceCents : null, quoteCount: i.quoteCount ?? 0,
      },
    };
  });
}

export interface DFDRowSource {
  description: string; unit: string; quantity: number | null; lotCode: string | null;
  /**
   * R9 / SEM-068 — posição (1-based) da linha na tabela de itens do DFD INTEIRA (não na lista filtrada). Ausente ⇒
   * posição no array recebido (chamadores que passam a tabela completa).
   */
  rowOrdinal?: number;
}

/**
 * R9 / SEM-068 — chave estrutural da LINHA do DFD como evidência: `${fingerprint}#r${ordinal}:${lotKey}`. O ordinal da
 * linha entra na chave para que duas linhas IDÊNTICAS (mesma descrição/unidade/lote) sejam DUAS evidências (dois
 * candidatos), em vez de colapsarem numa só e travarem a confirmação com DUPLICATE_DECISION. O ordinal fica ANTES do
 * lote para não ser cortado pelo limite de 64 caracteres da coluna (`source_item_key`).
 * Formato LEGADO (vínculos já persistidos, sem ordinal): `${fingerprint}:${lotKey}` — continua reconhecido por
 * `parseDfdSourceItemKey` (rowOrdinal = null), então decisões antigas seguem ligando suas linhas. As chaves das
 * demais fontes (Pesquisa de Preços) NÃO mudam.
 */
export function dfdSourceItemKey(fingerprint: string, lotCode: string | null, rowOrdinal: number): string {
  return `${fingerprint}#r${rowOrdinal}:${lotCode ? lotCodeKey(lotCode) : ""}`;
}

export function parseDfdSourceItemKey(key: string): { fingerprint: string; lotKey: string | null; rowOrdinal: number | null } {
  const sep = key.indexOf(":"); // fingerprint é hex (sem ":" nem "#")
  const head = sep >= 0 ? key.slice(0, sep) : key;
  const lot = sep >= 0 ? key.slice(sep + 1) : "";
  const m = /^([^#]*)#r(\d+)$/.exec(head);
  return { fingerprint: m ? m[1] : head, lotKey: lot || null, rowOrdinal: m ? Number(m[2]) : null };
}

/** Linhas da tabela de itens do DFD (inclusive coluna "Lote", quando presente) como fonte de candidatos. */
export function dfdCandidateSources(documentId: string, rows: readonly DFDRowSource[]) {
  return rows.map((r, idx) => {
    const lot = r.lotCode ? lotCodeKey(r.lotCode) : "";
    const fp = itemFingerprint(r.description, r.unit);
    return {
      sourceType: "dfd" as const, sourceId: documentId, sourceItemKey: dfdSourceItemKey(fp, r.lotCode, r.rowOrdinal ?? idx + 1),
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
    // R9 / SEM-069 — evidência cujo vínculo persistido aponta para um item RETIRADO: sinaliza (a UI explica e o plano recusa).
    const withdrawnItemId = match.status === "linked" ? null : withdrawnLinkOf(s, links, byId);
    return { ...s, candidateKey, match, duplicateOfCandidateKey, sourceLotId, withdrawnItemId } as ItemCandidate;
  });
}

/**
 * R9 / SEM-069 — vínculo persistido DESTA evidência que aponta para um item retirado: chave exata, ou — só no DFD — a
 * chave LEGADA sem ordinal (`${fingerprint}:${lotKey}`, mesmo documento), para que um item retirado antes da mudança
 * de chave (SEM-068) não "volte" silenciosamente como item novo com outra identidade.
 */
function withdrawnLinkOf(
  s: { sourceType: CandidateSourceType; sourceId: string; sourceItemKey: string },
  links: readonly Pick<ItemSourceLink, "itemId" | "sourceType" | "sourceId" | "sourceItemKey">[],
  byId: ReadonlyMap<string, Pick<ProcurementItem, "status">>,
): string | null {
  const own = links.filter((l) => l.sourceType === s.sourceType && l.sourceId === s.sourceId);
  const withdrawn = (l: { itemId: string }) => byId.get(l.itemId)?.status === "withdrawn";
  const exact = own.find((l) => l.sourceItemKey === s.sourceItemKey && withdrawn(l));
  if (exact) return exact.itemId;
  if (s.sourceType !== "dfd") return null;
  const k = parseDfdSourceItemKey(s.sourceItemKey);
  const legacy = own.find((l) => {
    const lk = parseDfdSourceItemKey(l.sourceItemKey);
    return lk.rowOrdinal === null && lk.fingerprint === k.fingerprint && lk.lotKey === k.lotKey && withdrawn(l);
  });
  return legacy?.itemId ?? null;
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

/** R9 / SEM-069 — código estável da recusa de reincluir, pelo painel, um item já retirado da contratação. */
export const ITEM_PREVIOUSLY_WITHDRAWN = "ITEM_PREVIOUSLY_WITHDRAWN";
const WITHDRAWN_MESSAGE = "este item já foi RETIRADO da contratação e não é reincluído automaticamente. Se a necessidade voltou, adicione-o manualmente (\"+ Adicionar item\") informando o motivo.";

/**
 * R9 / SEM-031 — vínculo de PREÇO (Pesquisa de Preços) só entre unidades canônicas iguais: preço por CX não é preço
 * por UN. Nenhuma conversão é inventada; a pessoa ajusta a unidade do item ou escolhe outro vínculo.
 */
function assertPriceUnitCompatible(c: ItemCandidate, itemUnit: string): void {
  if (c.sourceType !== "price_research") return;
  if (canonicalUnit(c.unit) !== canonicalUnit(itemUnit)) {
    throw new ItemDomainError("UNIT_INCOMPATIBLE", `a unidade da cotação ("${c.unit}") é diferente da unidade do item ("${itemUnit}") — nenhuma conversão é feita; ajuste a unidade ou escolha outro item.`);
  }
}

/**
 * Valida as decisões contra a projeção RECALCULADA no servidor (o browser não escolhe ids arbitrários):
 * candidato inexistente/desatualizado ⇒ STALE_CANDIDATES; já vinculado ⇒ não cria de novo; possível
 * duplicata/ambiguidade exige ação explícita (create/link); vínculo só a item ativo do processo.
 */
export function planCandidateDecisions(p: {
  organizationId: number; processId: string;
  candidates: readonly ItemCandidate[]; decisions: readonly CandidateDecision[];
  items: readonly Pick<ProcurementItem, "id" | "status" | "unit">[];
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
    // R9 / SEM-069 — evidência de item RETIRADO: o domínio não tem transição "retirado → ativo"; recusa explícita
    // (antes: o id determinístico já existia, o insert virava no-op e a confirmação respondia sucesso sem fazer nada).
    const withdrawnId = c.withdrawnItemId
      ?? p.items.find((i) => i.status === "withdrawn" && i.id === procurementItemId(p.organizationId, p.processId, `${c.sourceType}:${c.sourceId}:${c.sourceItemKey}`))?.id
      ?? null;
    if (withdrawnId) throw new ItemDomainError(ITEM_PREVIOUSLY_WITHDRAWN, WITHDRAWN_MESSAGE);
    if (d.action === "link") {
      if (d.canonicalItemId) {
        const target = p.items.find((i) => i.id === d.canonicalItemId && i.status === "active");
        if (!target) throw new ItemDomainError("ITEM_NOT_FOUND", "item de destino inexistente ou retirado neste processo.");
        assertPriceUnitCompatible(c, target.unit);
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
      // R9 / SEM-067 — só lote ATIVO é destino; um lote ARQUIVADO com o mesmo código/origem nunca recebe o item (antes
      // o id determinístico `src:<código>` coincidia com o do arquivado ⇒ pertencimento pendente a lote invisível).
      const existing = p.lots.find((l) => l.status === "active" && l.codeKey === codeKey);
      const lotId = existing?.id ?? lotsToCreate.get(codeKey)?.lotId ?? freshLotId(p.organizationId, p.processId, `src:${codeKey}`, p.lots.map((l) => l.id));
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
    assertPriceUnitCompatible(c, target.unit);
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

// ─── "Usar N": quantidade ATUAL da fonte (R9 / SEM-049, SEM-055) ─────────────────────────────

/** Igualdade de quantidades pelo texto decimal canônico (sem comparar floats crus). */
export function sameQuantity(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return numberToDecimalString(a) === numberToDecimalString(b);
}

export type AdoptSourceCheck =
  | { ok: true; value: number }
  | { ok: false; code: "SOURCE_NOT_FOUND" }
  | { ok: false; code: "NO_SOURCE_QUANTITY" }
  | { ok: false; code: "SOURCE_QUANTITY_CHANGED"; linked: number | null; current: number; expected: number | null | undefined };

/**
 * R9 / SEM-049 — "Usar N" adota a quantidade ATUAL da fonte (linha do DFD vigente / Item Inteligente), lida pelo
 * SERVIDOR; `item_source_links.source_quantity` é só o valor CONGELADO no vínculo. Regras:
 *  - fonte não encontrada (`current === undefined`) ⇒ SOURCE_NOT_FOUND; fonte sem quantidade ⇒ NO_SOURCE_QUANTITY;
 *  - o cliente confirmou o valor que VIU (`expected`): adota só se for exatamente o atual; senão SOURCE_QUANTITY_CHANGED;
 *  - sem `expected`: adota só se o atual for igual ao do vínculo; divergência ⇒ SOURCE_QUANTITY_CHANGED (vínculo ×
 *    atual) — nunca adota em silêncio um valor diferente do que a pessoa viu.
 */
export function checkAdoptSourceQuantity(p: { linked: number | null; current: number | null | undefined; expected?: number | null }): AdoptSourceCheck {
  if (p.current === undefined) return { ok: false, code: "SOURCE_NOT_FOUND" };
  if (p.current === null) return { ok: false, code: "NO_SOURCE_QUANTITY" };
  const reference = p.expected !== undefined ? p.expected : p.linked;
  if (!sameQuantity(reference, p.current)) return { ok: false, code: "SOURCE_QUANTITY_CHANGED", linked: p.linked, current: p.current, expected: p.expected };
  return { ok: true, value: p.current };
}

/**
 * R9 / SEM-055 — "Usar N" sobre uma quantidade prevista JÁ definida (por humano) exige confirmação explícita da
 * substituição (antigo → novo). Sem valor vigente, ou com conflito a resolver, não há o que confirmar.
 */
export function adoptionNeedsReplaceConfirmation(current: { value: number | string | null; status: string | null } | null): boolean {
  return !!current && current.status !== "conflict" && current.value !== null;
}

/**
 * R9 / SEM-052 — PRÉVIA e TOKEN de estado esperado para "Aplicar cotações atualizadas" (puro, determinístico).
 *
 * Aplicar as cotações pendentes (`pending_suppliers`) troca o conjunto de cotações e a média do item e, se o
 * item já estava decidido (aprovado/rejeitado), REVOGA a decisão humana (volta a `em_analise`). Isso nunca
 * pode acontecer num clique: o usuário vê ANTES, por item, o comparativo atual × proposto (nº de cotações
 * válidas, média em centavos, cotações incluídas/removidas/alteradas) e a revogação; a confirmação envia o
 * `expectedStateToken` da prévia que viu. O servidor recalcula o token sob lock da linha e:
 *   - token igual            → aplica exatamente o que foi mostrado;
 *   - token diferente        → CONFLICT (o estado mudou depois da prévia; nada é aplicado);
 *   - já aplicado (replay)   → reconhece pelo componente "alvo" do token e responde sem novo efeito.
 *
 * Formato do token: `sui1.<pré-estado>.<alvo>` — `pré-estado` cobre id, status, conjunto atual, média atual e
 * conjunto proposto; `alvo` cobre só id + conjunto proposto (o que o conjunto atual passa a ser após aplicar).
 */
import { createHash } from "crypto";
import { averageCents, type Cents } from "./money";
import { quoteSetSignature, validQuotes, withContentHash, type PriceQuote } from "./priceQuoteConsolidation";

export const SOURCE_UPDATE_TOKEN_VERSION = "sui1";

export interface SourceUpdateQuoteView {
  readonly quoteId: string;
  readonly supplier: string;
  /** Centavos; `null` = cotação sem preço (não entra na média). */
  readonly valueCents: Cents | null;
}

export interface SourceUpdateChangedQuote {
  readonly quoteId: string;
  readonly supplier: string;
  readonly beforeCents: Cents | null;
  readonly afterCents: Cents | null;
}

export interface SourceUpdateSide {
  /** Cotações VÁLIDAS (com preço), as que entram na média. */
  readonly quoteCount: number;
  readonly averageCents: Cents;
  readonly quotes: readonly SourceUpdateQuoteView[];
}

export interface SourceUpdatePreview {
  readonly itemId: string;
  readonly description: string;
  readonly status: string;
  /** Decisão humana que será REVOGADA ao aplicar (aprovado/rejeitado), ou `null`. */
  readonly revokesDecision: "aprovado" | "rejeitado" | null;
  /** Status resultante após aplicar. */
  readonly statusAfter: string;
  readonly current: SourceUpdateSide;
  readonly proposed: SourceUpdateSide;
  readonly averageDeltaCents: Cents;
  readonly added: readonly SourceUpdateQuoteView[];
  readonly removed: readonly SourceUpdateQuoteView[];
  readonly changed: readonly SourceUpdateChangedQuote[];
  readonly expectedStateToken: string;
}

const h32 = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 32);

function isDecided(status: string): status is "aprovado" | "rejeitado" {
  return status === "aprovado" || status === "rejeitado";
}

/** Componente "alvo" do token: id + conjunto de cotações que passa a valer após aplicar. */
export function sourceUpdateTargetHash(itemId: string, targetQuotes: readonly PriceQuote[]): string {
  return h32(JSON.stringify([SOURCE_UPDATE_TOKEN_VERSION, "target", itemId, quoteSetSignature(targetQuotes)]));
}

export function sourceUpdateToken(p: {
  itemId: string; status: string; currentQuotes: readonly PriceQuote[]; currentAverageCents: Cents; pendingQuotes: readonly PriceQuote[];
}): string {
  const pre = h32(JSON.stringify([
    SOURCE_UPDATE_TOKEN_VERSION, "pre", p.itemId, p.status, quoteSetSignature(p.currentQuotes), p.currentAverageCents,
    quoteSetSignature(p.pendingQuotes),
  ]));
  return `${SOURCE_UPDATE_TOKEN_VERSION}.${pre}.${sourceUpdateTargetHash(p.itemId, p.pendingQuotes)}`;
}

/** Componente "alvo" de um token bem-formado, ou `null`. */
export function parseSourceUpdateToken(token: string): { pre: string; target: string } | null {
  const m = /^sui1\.([a-f0-9]{32})\.([a-f0-9]{32})$/.exec(token);
  return m ? { pre: m[1], target: m[2] } : null;
}

const view = (q: PriceQuote): SourceUpdateQuoteView => ({ quoteId: q.quoteId, supplier: q.supplier, valueCents: q.valueCents });

function side(quotes: readonly PriceQuote[], avg: Cents): SourceUpdateSide {
  return { quoteCount: validQuotes(quotes).length, averageCents: avg, quotes: quotes.map(view) };
}

/**
 * Prévia do que "Aplicar cotações atualizadas" faria. `currentAverageCents` é a média PERSISTIDA do item
 * (a que vale hoje); a proposta é recalculada das cotações pendentes (mesma regra de `applyItemSourceUpdate`).
 */
export function buildSourceUpdatePreview(p: {
  itemId: string; description: string; status: string;
  currentQuotes: readonly PriceQuote[]; currentAverageCents: Cents; pendingQuotes: readonly PriceQuote[];
}): SourceUpdatePreview {
  const proposedAvg = averageCents(validQuotes(p.pendingQuotes).map((q) => q.valueCents as Cents));
  const cur = new Map(p.currentQuotes.map((q) => [q.quoteId, withContentHash(q)]));
  const pen = new Map(p.pendingQuotes.map((q) => [q.quoteId, withContentHash(q)]));
  const added = p.pendingQuotes.filter((q) => !cur.has(q.quoteId)).map(view);
  const removed = p.currentQuotes.filter((q) => !pen.has(q.quoteId)).map(view);
  const changed: SourceUpdateChangedQuote[] = [];
  for (const [id, after] of pen) {
    const before = cur.get(id);
    if (before && before.contentHash !== after.contentHash) {
      changed.push({ quoteId: id, supplier: after.supplier, beforeCents: before.valueCents, afterCents: after.valueCents });
    }
  }
  const decided = isDecided(p.status);
  return {
    itemId: p.itemId, description: p.description, status: p.status,
    revokesDecision: decided ? p.status as "aprovado" | "rejeitado" : null,
    statusAfter: decided ? "em_analise" : p.status,
    current: side(p.currentQuotes, p.currentAverageCents),
    proposed: side(p.pendingQuotes, proposedAvg),
    averageDeltaCents: proposedAvg - p.currentAverageCents,
    added, removed, changed,
    expectedStateToken: sourceUpdateToken(p),
  };
}

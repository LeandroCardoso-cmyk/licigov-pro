/**
 * R9 / SEM-052 — prévia e token de estado esperado de "Aplicar cotações atualizadas" (puro).
 *
 *   T1. prévia: atual × proposto (cotações válidas, média em CENTAVOS), incluídas/removidas/alteradas;
 *   T2. decisão aprovada/rejeitada é declarada como REVOGADA (status após = em_analise); pendente não;
 *   T3. token determinístico e insensível à ordem física das cotações;
 *   T4. token muda quando muda o conjunto proposto, o conjunto atual, a média atual ou o status (stale ⇒ CONFLICT);
 *   T5. componente "alvo" do token = conjunto proposto (base do replay idempotente) e parse estrito.
 */
import { describe, it, expect } from "vitest";
import {
  buildSourceUpdatePreview, parseSourceUpdateToken, sourceUpdateTargetHash, sourceUpdateToken,
} from "../../domain/itemSourceUpdate";
import type { PriceQuote } from "../../domain/priceQuoteConsolidation";

const q = (quoteId: string, supplier: string, valueCents: number | null): PriceQuote => ({
  quoteId, researchId: "r1", description: "Papel A4", quantity: 10, unit: "resma", supplier, brand: "", model: "", source: "", valueCents,
});

const CURRENT = [q("a", "Papelaria A", 10000), q("b", "Papelaria B", 12000)];
const PENDING = [q("a", "Papelaria A", 10000), q("b", "Papelaria B", 15000), q("c", "Papelaria C", 20000), q("d", "Sem preço", null)];

const base = { itemId: "item-1", description: "Papel A4", status: "aprovado", currentQuotes: CURRENT, currentAverageCents: 11000, pendingQuotes: PENDING };

describe("R9 / SEM-052 — prévia de aplicação das cotações atualizadas", () => {
  it("T1) comparativo atual × proposto em centavos, com incluídas/removidas/alteradas", () => {
    const p = buildSourceUpdatePreview(base);
    expect(p.current).toMatchObject({ quoteCount: 2, averageCents: 11000 });
    expect(p.proposed).toMatchObject({ quoteCount: 3, averageCents: 15000 }); // (100+150+200)/3, sem a cotação sem preço
    expect(p.averageDeltaCents).toBe(4000);
    expect(p.added.map((x) => x.quoteId)).toEqual(["c", "d"]);
    expect(p.removed).toEqual([]);
    expect(p.changed).toEqual([{ quoteId: "b", supplier: "Papelaria B", beforeCents: 12000, afterCents: 15000 }]);
    const removedCase = buildSourceUpdatePreview({ ...base, pendingQuotes: [q("a", "Papelaria A", 10000)] });
    expect(removedCase.removed.map((x) => x.quoteId)).toEqual(["b"]);
  });

  it("T2) decisão humana revogada declarada (aprovado/rejeitado → em_analise); pendente mantém o status", () => {
    expect(buildSourceUpdatePreview(base)).toMatchObject({ revokesDecision: "aprovado", statusAfter: "em_analise" });
    expect(buildSourceUpdatePreview({ ...base, status: "rejeitado" })).toMatchObject({ revokesDecision: "rejeitado", statusAfter: "em_analise" });
    expect(buildSourceUpdatePreview({ ...base, status: "pendente" })).toMatchObject({ revokesDecision: null, statusAfter: "pendente" });
  });

  it("T3) token determinístico e independente da ordem física das cotações", () => {
    const t = buildSourceUpdatePreview(base).expectedStateToken;
    expect(buildSourceUpdatePreview(base).expectedStateToken).toBe(t);
    expect(buildSourceUpdatePreview({ ...base, pendingQuotes: [...PENDING].reverse(), currentQuotes: [...CURRENT].reverse() }).expectedStateToken).toBe(t);
    expect(t).toMatch(/^sui1\.[a-f0-9]{32}\.[a-f0-9]{32}$/);
  });

  it("T4) qualquer mudança do estado mostrado gera OUTRO token (confirmação antiga fica stale)", () => {
    const t = sourceUpdateToken(base);
    const variants = [
      { ...base, pendingQuotes: [...PENDING.slice(0, 3), q("d", "Sem preço", 100)] }, // proposta mudou
      { ...base, currentQuotes: [q("a", "Papelaria A", 10000)] },                      // conjunto atual mudou
      { ...base, currentAverageCents: 11001 },                                          // média vigente mudou
      { ...base, status: "rejeitado" },                                                 // decisão mudou
      { ...base, itemId: "item-2" },                                                    // outro item
    ];
    for (const v of variants) expect(sourceUpdateToken(v)).not.toBe(t);
  });

  it("T5) componente alvo = id + conjunto proposto (replay); parse estrito", () => {
    const t = sourceUpdateToken(base);
    const parsed = parseSourceUpdateToken(t)!;
    expect(parsed.target).toBe(sourceUpdateTargetHash("item-1", [...PENDING].reverse()));
    expect(parsed.target).not.toBe(sourceUpdateTargetHash("item-1", CURRENT));
    expect(parseSourceUpdateToken("qualquer")).toBeNull();
    expect(parseSourceUpdateToken(`${t}x`)).toBeNull();
    expect(parseSourceUpdateToken(t.toUpperCase())).toBeNull();
  });
});

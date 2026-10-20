/**
 * M8 — GOVERNANÇA DOS PREÇOS DE REFERÊNCIA (política aprovada pelo Owner em 20/10/2026, alternativa D) — regras PURAS.
 *
 * Proveniência estruturada (explícita × suspeita × legado), formação da referência canônica (FICTITIOUS_SOURCE),
 * bloqueio ESTRUTURAL da emissão (EMISSION_FICTITIOUS_PRICES, independe do texto), Contratação Direta (cotação fictícia
 * excluída de média/mediana/mínimo; só fictícias ⇒ recusa) e a guarda da exceção de homologação sintética.
 * A numeração [n] segue a lista de testes obrigatórios da rodada; os casos com escrita estão no smoke MySQL
 * `m8-price-reference-governance-mysql-smoke.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  classifyIncomingQuote, countProvenance, declaresFictitious, deriveItemRisks, describeQuoteSet, effectiveQuoteProvenance,
  institutionallyUsableCount, LEGACY_LOW_QUOTE_COUNT_RISK_TEXT, LOW_QUOTE_COUNT_RISK_TEXT, mergeReimportedProvenance, suggestsDemonstrative,
} from "../../domain/quoteProvenance";
import { parsePriceResearchText } from "../../domain/priceResearchParser";
import { drizzle } from "drizzle-orm/mysql2";
import { priceResearchItemsTable } from "../../../drizzle/schema";
import { provenanceOnReimportSql, quoteProvenanceCounts } from "../../db/procurement";
import { extractItemsFromText } from "../../domain/priceResearch";
import {
  canonicalItemKey, factValueHash, itemPath, resolveCanonicalContext, type FactAssertion,
} from "../../domain/canonicalProcurementContext";
import { buildDFDPrefill } from "../../domain/dfdPrefill";
import { canonicalDocumentItems, type ContextItem } from "../../services/authoring/authoringContext";
import { computeItemEstimates, FICTITIOUS_PRICE_CELL_TEXT, fictitiousQuotesReviewText, renderAuthoritativeItemsBlock, suspectedQuotesReviewText } from "../../domain/authoritativeItems";
import { emissionBlockers } from "../../domain/emissionPreconditions";
import {
  buildResearchLineage, describeLineage, PRICE_RESEARCH_FICTITIOUS, summarizePriceResearch,
} from "../../domain/directPriceReference";
import {
  homologationDemonstrativeAllowed, HOMOLOGATION_SYNTHETIC_SLUG, parseHomologationOrgIds, PROTECTED_REAL_ORGANIZATION_ID,
} from "../../config/homologation";

const ctxText = { researchId: "r1", processId: "p1", organizationId: 7 };

describe("M8 — proveniência das cotações [1–10]", () => {
  it("[1] fonte EXPLICITAMENTE fictícia ⇒ `ficticia` (parser, extração e classificação)", () => {
    const p = parsePriceResearchText("Caneta azul;10;UN;R$ 1,50;Fornecedor Fictício A\nCaneta azul;10;UN;R$ 1,70;Fornecedor Fictício B");
    expect(p.synthetic).toBe(true);
    expect(p.items[0].quotes.every((q) => q.fictitious)).toBe(true);
    expect(extractItemsFromText("Caneta azul;10;UN;R$ 1,50;Fornecedor Fictício A", ctxText).map((i) => i.provenanceKind)).toEqual(["ficticia"]);
    expect(classifyIncomingQuote({ supplier: "Fornecedora Fictícia Ltda" })).toBe("ficticia");
    expect(classifyIncomingQuote({ supplier: "Alfa", notes: "valores demonstrativos para treinamento" })).toBe("ficticia");
  });

  it("[2] fonte informada sem declaração ⇒ `declarada` (nunca `verificada`)", () => {
    const items = extractItemsFromText("Caneta azul;10;UN;R$ 1,50;Papelaria Alfa Ltda\nCaneta azul;10;UN;R$ 1,70;Comercial Beta ME", ctxText);
    expect(items.map((i) => i.provenanceKind)).toEqual(["declarada", "declarada"]);
    expect(classifyIncomingQuote({ supplier: "Papelaria Alfa Ltda", notes: "CNPJ 12.345.678/0001-90 · 05/10/2026" })).toBe("declarada");
  });

  it("[3] `verificada` só por procedimento legítimo: nenhum caminho de leitura/parser a atribui; reimportação não a apaga", () => {
    const texts = ["Caneta;1;UN;R$ 1,00;Alfa Ltda CNPJ 12.345.678/0001-90", "Caneta;1;UN;R$ 1,00;Fornecedor Fictício A", "Caneta;1;UN;R$ 1,00;Teste Comércio"];
    for (const t of texts) expect(extractItemsFromText(t, ctxText).some((i) => i.provenanceKind === "verificada")).toBe(false);
    expect(effectiveQuoteProvenance({ stored: "verificada", supplierName: "Alfa" })).toBe("verificada");
    expect(mergeReimportedProvenance({ existing: "verificada", incoming: "declarada", sameEconomicContent: true })).toBe("verificada");
  });

  it("[4] legado sem proveniência (NULL) ⇒ `desconhecida`: nem fictícia nem verificada", () => {
    expect(effectiveQuoteProvenance({ stored: null, supplierName: "Comercial Beta ME" })).toBe("desconhecida");
    expect(effectiveQuoteProvenance({ stored: undefined })).toBe("desconhecida");
  });

  it("[5] valor desconhecido na coluna ⇒ tratado como legado (fail-safe, sem promoção)", () => {
    expect(effectiveQuoteProvenance({ stored: "aprovada_pelo_cliente", supplierName: "Alfa" })).toBe("desconhecida");
    expect(effectiveQuoteProvenance({ stored: "VERIFICADA", supplierName: "Alfa" })).toBe("desconhecida");
  });

  it("[6] falso positivo por nome de fornecedor real ⇒ `declarada` (só suspeita/aviso)", () => {
    for (const name of ["Couros Sintéticos Ltda", "Papelaria Teste & Cia", "Exemplo Distribuidora", "Simulados Educacionais ME", "Homologação Engenharia"]) {
      expect(classifyIncomingQuote({ supplier: name }), name).toBe("declarada");
      expect(effectiveQuoteProvenance({ stored: null, supplierName: name }), name).toBe("desconhecida");
    }
    const p = parsePriceResearchText("Caneta azul;10;UN;R$ 1,50;Couros Sintéticos Ltda");
    expect(p.synthetic).toBe(false);
    expect(p.items[0].quotes[0].fictitious).toBe(false);
  });

  it("[7] termos genéricos 'teste', 'exemplo', 'homologação' ⇒ SUSPEITA (aviso), nunca `ficticia` gravada", () => {
    expect(suggestsDemonstrative("dados de teste da homologação")).toBe(true);
    expect(declaresFictitious("dados de teste da homologação")).toBe(false);
    const p = parsePriceResearchText(["Observação: planilha de exemplo usada na homologação", "Caneta azul;10;UN;R$ 1,50;Papelaria Alfa"].join("\n"));
    expect(p.synthetic).toBe(false);
    expect(p.suspected).toBe(true);
    expect(p.items[0].quotes[0].fictitious).toBe(false);
    expect(extractItemsFromText(["Observação: planilha de exemplo usada na homologação", "Caneta azul;10;UN;R$ 1,50;Papelaria Alfa"].join("\n"), ctxText)[0].provenanceKind).toBe("declarada");
    // Declaração EXPLÍCITA do documento (nota) marca todas as cotações.
    const d = parsePriceResearchText(["Observação: os valores são fictícios", "Caneta azul;10;UN;R$ 1,50;Papelaria Alfa"].join("\n"));
    expect(d.synthetic).toBe(true);
    expect(d.items[0].quotes[0].fictitious).toBe(true);
  });

  it("[8] reimportação: declaração fictícia nova prevalece; mesmo conteúdo preserva fictícia/verificada; remover a nota não 'esquenta' a cotação", () => {
    expect(mergeReimportedProvenance({ existing: "declarada", incoming: "ficticia", sameEconomicContent: true })).toBe("ficticia");
    expect(mergeReimportedProvenance({ existing: "verificada", incoming: "ficticia", sameEconomicContent: true })).toBe("ficticia");
    expect(mergeReimportedProvenance({ existing: "ficticia", incoming: "declarada", sameEconomicContent: true })).toBe("ficticia");
    expect(mergeReimportedProvenance({ existing: null, incoming: "declarada", sameEconomicContent: true })).toBe("declarada");
  });

  it("[8] guarda do upsert: o SET do ON DUPLICATE KEY UPDATE atribui `provenance_kind` ANTES de supplier/value (lê os antigos)", () => {
    const db = drizzle({ client: {} as never, mode: "default" });
    const q = db.insert(priceResearchItemsTable).values({ id: "x", organizationId: 1, researchId: "r", processId: "p" })
      .onDuplicateKeyUpdate({ set: { provenanceKind: provenanceOnReimportSql(), value: "1", supplier: "S", description: "d" } }).toSQL().sql;
    const at = (col: string) => q.indexOf(`\`${col}\` = `, q.indexOf("on duplicate key update"));
    expect(at("provenance_kind")).toBeGreaterThan(0);
    expect(at("provenance_kind")).toBeLessThan(at("supplier"));
    expect(at("provenance_kind")).toBeLessThan(at("value"));
    expect(at("provenance_kind")).toBeLessThan(at("description"));
  });

  it("[9] valor/fornecedor alterado ⇒ é outra cotação: vale a proveniência nova (passa pela revisão governada da fonte)", () => {
    expect(mergeReimportedProvenance({ existing: "ficticia", incoming: "declarada", sameEconomicContent: false })).toBe("declarada");
    expect(mergeReimportedProvenance({ existing: "verificada", incoming: "declarada", sameEconomicContent: false })).toBe("declarada");
  });

  it("[10] fictícia antiga mantida no item após nova importação ⇒ a referência continua SUSPENSA (fail-closed)", () => {
    const counts = countProvenance(["declarada", "declarada", "declarada", "ficticia"]);
    expect(institutionallyUsableCount(counts)).toBe(3);
    const ctx = ctxOf([{ fq: 1, price: 10_000 }]);
    expect(ctx.items[0].priceContext.priceBlockedReason).toBe("FICTITIOUS_SOURCE");
    expect(ctx.items[0].priceContext.unitReferencePriceCents).toBeNull();
  });
});

// ─── Contexto canônico (fonte única de DFD/ETP/TR/Edital IA/Edital BLL) ───────────────────────────────────────────
const ITEM = "a1a1a1a1a1a1a1a1a1a1a1a1";
const planned = (v: number): FactAssertion => ({
  id: 1, path: itemPath(ITEM, "plannedQuantity"), value: v, valueHash: factValueHash(v), sourceType: "user", sourceId: "items-area",
  sourceVersion: "r1:informed", status: "confirmed", actorUserId: 5, basisValueHash: null, createdAt: "2026-02-01T00:00:00.000Z",
});
function ctxOf(evid: Array<{ fq: number; price: number; state?: string; quotes?: number }>, opts: { allowed?: boolean } = {}) {
  return resolveCanonicalContext({
    organizationId: 7, processId: "p1", process: { number: "1", object: "Material", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
    organization: null, assertions: [planned(10)],
    intelligentItems: evid.map((e, i) => ({
      id: `ii${i}`, description: "Caneta azul", unit: "UN", quantity: 10, status: "aprovado", averagePriceCents: e.price,
      quoteCount: e.quotes ?? 3, sourceState: e.state ?? "current", fictitiousQuoteCount: e.fq,
    })),
    procurementItems: [{ id: ITEM, description: "Caneta azul", unit: "UN", lotId: null, ordinal: 1, status: "active", revision: 1, fingerprint: canonicalItemKey("Caneta azul", "UN") }],
    priceLinks: evid.map((_, i) => ({ itemId: ITEM, intelligentItemId: `ii${i}` })),
    ...(opts.allowed !== undefined ? { demonstrativePricesAllowed: opts.allowed } : {}),
  });
}
const approvedCtxItem = (fq: number, price = 150): ContextItem => ({
  id: "ii0", description: "Caneta azul", quantity: 10, unit: "UN", averagePriceCents: price, quoteCount: 2, fictitiousQuoteCount: fq,
  confirmedCatalogCode: null, suggestedCatalogCode: null, sourceState: "current",
  quotes: [{ quoteId: "q1", supplier: "Fornecedor Fictício A", brand: "", model: "", valueCents: price }],
});

describe("M8 — formação do preço de referência [11–18]", () => {
  it("[11] item SOMENTE com fictícias ⇒ sem referência institucional (FICTITIOUS_SOURCE)", () => {
    const c = ctxOf([{ fq: 3, price: 150 }]);
    expect(c.items[0].priceContext).toMatchObject({ unitReferencePriceCents: null, priceBlockedReason: "FICTITIOUS_SOURCE", priceAmbiguous: false });
    expect(c.items[0].estimatedTotalCents).toBeNull();
    expect(c.priceContext.complete).toBe(false);
  });

  it("[12] mistura reais + fictícias ⇒ a média com fictícia NUNCA vira referência (exige revisão governada da fonte)", () => {
    const c = ctxOf([{ fq: 1, price: 150, quotes: 3 }]);
    expect(c.items[0].priceContext.priceBlockedReason).toBe("FICTITIOUS_SOURCE");
    expect(c.items[0].priceContext.unitReferencePriceCents).toBeNull();
    // Evidência real + evidência fictícia no MESMO item ⇒ fail-closed (não se escolhe "a que sobrou").
    const two = ctxOf([{ fq: 0, price: 150 }, { fq: 2, price: 150 }]);
    expect(two.items[0].priceContext.priceBlockedReason).toBe("FICTITIOUS_SOURCE");
  });

  it("[13] somente declaradas ⇒ referência = média (contrato vigente; sem bloqueio retrospectivo do legado)", () => {
    const c = ctxOf([{ fq: 0, price: 150 }]);
    expect(c.items[0].priceContext).toMatchObject({ unitReferencePriceCents: 150, priceBlockedReason: null });
    expect(c.items[0].estimatedTotalCents).toBe(1500);
  });

  it("[14] fonte verificada ⇒ referência normal (a proveniência só RESTRINGE fictícias)", () => {
    expect(countProvenance(["verificada", "verificada", "declarada"]).ficticia).toBe(0);
    expect(ctxOf([{ fq: 0, price: 990 }]).items[0].priceContext.unitReferencePriceCents).toBe(990);
  });

  it("[15] item sem preço ⇒ sem referência e SEM motivo de bloqueio fictício", () => {
    const c = ctxOf([{ fq: 0, price: 0 }]);
    expect(c.items[0].priceContext).toMatchObject({ unitReferencePriceCents: null, priceBlockedReason: null });
  });

  it("[16] mudança de fonte após aprovação: fonte alterada ⇒ SOURCE_NOT_CURRENT; com fictícia, FICTITIOUS_SOURCE prevalece", () => {
    expect(ctxOf([{ fq: 0, price: 150, state: "source_changed" }]).items[0].priceContext.priceBlockedReason).toBe("SOURCE_NOT_CURRENT");
    expect(ctxOf([{ fq: 1, price: 150, state: "source_changed" }]).items[0].priceContext.priceBlockedReason).toBe("FICTITIOUS_SOURCE");
  });

  it("[17] referência suspensa: o digest muda (invalida replays/derivados), o DFD não estima e o documento não exibe o valor", () => {
    const real = ctxOf([{ fq: 0, price: 150 }]);
    const fict = ctxOf([{ fq: 1, price: 150 }]);
    expect(fict.digest).not.toBe(real.digest);
    expect(ctxOf([{ fq: 1, price: 150 }]).digest).toBe(fict.digest); // determinístico
    expect(buildDFDPrefill(real).values.orcamento.value).toContain("Estimativa preliminar");
    expect(buildDFDPrefill(fict).values.orcamento.value).toBeNull();
    const { items } = canonicalDocumentItems(fict, [approvedCtxItem(1)]);
    expect(items[0]).toMatchObject({ averagePriceCents: 0, priceBlockedReason: "FICTITIOUS_SOURCE" });
    const block = renderAuthoritativeItemsBlock(computeItemEstimates(items, { preserveOrder: true }));
    expect(block).toContain(FICTITIOUS_PRICE_CELL_TEXT);
    expect(block).not.toMatch(/\| 1,50 \|/);
  });

  it("[18] Contratação Direta: média/mediana/mínimo só com cotações elegíveis; fictícias excluídas e declaradas na linhagem", () => {
    const rows = [
      { description: "Caneta", unit: "UN", quantity: 10, value: 1.0 },
      { description: "Caneta", unit: "UN", quantity: 10, value: 2.0 },
      { description: "Caneta", unit: "UN", quantity: 10, value: 3.0 },
      { description: "Caneta", unit: "UN", quantity: 10, value: 100.0, fictitious: true },
    ];
    const s = summarizePriceResearch(rows);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.summary.values).toEqual({ media: 20, mediana: 20, menor_preco: 10 });
    expect(s.summary.quoteCount).toBe(3);
    expect(s.summary.excludedFictitiousQuoteCount).toBe(1);
    const lineage = buildResearchLineage({ researchId: "r", contentHash: "h".repeat(64), importedAt: "2026-10-20", importSource: "colar", summary: s.summary, method: "media", proposedValue: null });
    expect(lineage.excludedFictitiousQuoteCount).toBe(1);
    expect(describeLineage(lineage)).toContain("1 cotação(ões) fictícia(s) excluída(s) do cálculo");
    // Sem fictícias ⇒ linhagem byte-idêntica à anterior (sem a chave nova).
    const plain = summarizePriceResearch(rows.slice(0, 3));
    if (!plain.ok) throw new Error("plain");
    expect("excludedFictitiousQuoteCount" in buildResearchLineage({ researchId: "r", contentHash: "h".repeat(64), importedAt: "x", importSource: "colar", summary: plain.summary, method: "media", proposedValue: null })).toBe(false);
    // Só fictícias (em QUALQUER item) ⇒ recusa — nunca um valor substituto nem o item some do total.
    const only = summarizePriceResearch([...rows.slice(0, 3), { description: "Lápis", unit: "UN", quantity: 5, value: 9, fictitious: true }]);
    expect(only).toMatchObject({ ok: false, code: PRICE_RESEARCH_FICTITIOUS });
    expect(summarizePriceResearch([{ description: "Lápis", unit: "UN", quantity: 5, value: 9, fictitious: true }])).toMatchObject({ ok: false, code: PRICE_RESEARCH_FICTITIOUS });
  });
});

describe("M8 — governança documental e de emissão [19–24]", () => {
  const emission = (over: Partial<Parameters<typeof emissionBlockers>[0]> = {}) => emissionBlockers({
    kind: "tr", content: "Termo de Referência sem marcadores.", contentHash: "h1", sourceState: "current", changedSourceLabels: [],
    trEmitted: true, lastEmittedContentHash: null, lastEmittedVersion: null, ...over,
  });

  it("[19] aprovação operacional não promove: item APROVADO com fictícia continua sem referência", () => {
    const c = ctxOf([{ fq: 2, price: 150 }]); // status "aprovado" no fixture
    expect(c.items[0].priceContext.priceBlockedReason).toBe("FICTITIOUS_SOURCE");
    expect(c.priceContext.estimatedTotalCents).toBeNull();
  });

  it("[20] emissão com preço fictício ⇒ EMISSION_FICTITIOUS_PRICES", () => {
    const b = emission({ fictitiousPriceItemCount: 2 });
    expect(b.map((x) => x.code)).toEqual(["EMISSION_FICTITIOUS_PRICES"]);
    expect(b[0].message).toContain("2 item(ns)");
    expect(emission({ fictitiousPriceItemCount: 0 })).toEqual([]);
    expect(emission()).toEqual([]);
  });

  it("[21] remover manualmente o [REVISAR] NÃO libera: o bloqueio vem das fontes, não do texto", () => {
    const withMarker = emission({ content: `${FICTITIOUS_PRICE_CELL_TEXT}`, fictitiousPriceItemCount: 1 }).map((x) => x.code);
    expect(withMarker).toEqual(["EMISSION_REVIEW_MARKERS", "EMISSION_FICTITIOUS_PRICES"]);
    const edited = emission({ content: "| 1 | Caneta | 10 | UN | 1,50 | 15,00 | a revisar | 2 |", fictitiousPriceItemCount: 1 }).map((x) => x.code);
    expect(edited).toEqual(["EMISSION_FICTITIOUS_PRICES"]);
  });

  it("[22] exportação DOCX/PDF renderiza o conteúdo fielmente: o bloco gerado já traz o preço SUSPENSO, nunca o valor fictício", () => {
    const block = renderAuthoritativeItemsBlock(computeItemEstimates([{ ...approvedCtxItem(2), averagePriceCents: 0, priceBlockedReason: "FICTITIOUS_SOURCE" }]));
    expect(block).toContain(FICTITIOUS_PRICE_CELL_TEXT);
    expect(block).toContain(fictitiousQuotesReviewText(2));
    expect(block).not.toContain("R$ 1,50");
  });

  it("[23] Edital BLL: o resolvedor de fontes só preenche valores sem `priceBlockedReason` (mesma projeção canônica)", () => {
    const { items } = canonicalDocumentItems(ctxOf([{ fq: 1, price: 150 }]), [approvedCtxItem(1)]);
    expect(items[0].priceBlockedReason).toBe("FICTITIOUS_SOURCE");
    const src = readFileSync(path.join(__dirname, "../../services/institutionalTemplates/adapters/canonicalSources.ts"), "utf8");
    expect(src).toMatch(/const priced = showValues && !it\.priceBlockedReason && it\.averagePriceCents > 0;/);
  });

  it("[24] DFD/ETP legados: sem Itens da contratação, o mesmo bloqueio é aplicado na carga dos itens aprovados", () => {
    const src = readFileSync(path.join(__dirname, "../../services/authoring/authoringContext.ts"), "utf8");
    expect(src).toMatch(/priceBlocked\(i\)\s*\n\s*\? \{ averagePriceCents: 0, priceBlockedReason: "FICTITIOUS_SOURCE" \}/);
    const ed = readFileSync(path.join(__dirname, "../../services/authoring/editalContext.ts"), "utf8");
    expect(ed).toMatch(/\? \{ averagePrice: 0, priceBlockedReason: "FICTITIOUS_SOURCE" \}/);
    // ETP legado: preço 0 + motivo ⇒ célula suspensa (sem valor), estimativa fora do total.
    const est = computeItemEstimates([{ ...approvedCtxItem(1), averagePriceCents: 0, priceBlockedReason: "FICTITIOUS_SOURCE" }]);
    expect(est.globalTotalCents).toBe(0);
    expect(est.unpricedItemCount).toBe(1);
  });
});

describe("M8 — homologação sintética: exceção controlada [31–37]", () => {
  const org = (id: number, slug: string | null = HOMOLOGATION_SYNTHETIC_SLUG) => ({ id, slug });

  it("[31] org sintética autorizada, ambiente não produtivo, slug real conferido ⇒ exceção", () => {
    expect(homologationDemonstrativeAllowed({ appEnv: "staging", allowedOrgIds: [42], organization: org(42) })).toBe(true);
    expect(homologationDemonstrativeAllowed({ appEnv: "development", allowedOrgIds: [42], organization: org(42) })).toBe(true);
    const c = ctxOf([{ fq: 2, price: 150 }], { allowed: true });
    expect(c.items[0].priceContext).toMatchObject({ unitReferencePriceCents: 150, priceBlockedReason: null });
  });

  it("[32] sem configuração ⇒ nenhuma exceção (fail-closed)", () => {
    expect(parseHomologationOrgIds(undefined)).toEqual([]);
    expect(parseHomologationOrgIds("")).toEqual([]);
    expect(homologationDemonstrativeAllowed({ appEnv: "staging", allowedOrgIds: [], organization: org(42) })).toBe(false);
    expect(ctxOf([{ fq: 2, price: 150 }]).items[0].priceContext.priceBlockedReason).toBe("FICTITIOUS_SOURCE");
  });

  it("[33] slug correto, mas organização NÃO autorizada ⇒ recusa (slug nunca é a única autorização)", () => {
    expect(homologationDemonstrativeAllowed({ appEnv: "staging", allowedOrgIds: [43], organization: org(42) })).toBe(false);
    // autorizada, mas o slug REAL não confere ⇒ recusa
    expect(homologationDemonstrativeAllowed({ appEnv: "staging", allowedOrgIds: [42], organization: org(42, "prefeitura-x") })).toBe(false);
    expect(homologationDemonstrativeAllowed({ appEnv: "staging", allowedOrgIds: [42], organization: org(42, null) })).toBe(false);
    expect(homologationDemonstrativeAllowed({ appEnv: "staging", allowedOrgIds: [42], organization: null })).toBe(false);
  });

  it("[34] autorizada, mas ambiente PRODUTIVO ⇒ recusa", () => {
    expect(homologationDemonstrativeAllowed({ appEnv: "production", allowedOrgIds: [42], organization: org(42) })).toBe(false);
  });

  it("[35] organização 1 (dados reais) ⇒ recusa SEMPRE, qualquer configuração", () => {
    expect(PROTECTED_REAL_ORGANIZATION_ID).toBe(1);
    for (const appEnv of ["development", "staging", "production"] as const) {
      expect(homologationDemonstrativeAllowed({ appEnv, allowedOrgIds: [1], organization: org(1) })).toBe(false);
    }
    expect(parseHomologationOrgIds(" 1, 42 ,x,-3,0, 42")).toEqual([1, 42]); // a guarda (não o parser) recusa a org 1
  });

  it("[36] nenhum router/cliente habilita a exceção (só o backend a decide)", () => {
    const routers = path.join(__dirname, "../../routers");
    const offenders: string[] = [];
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
      const f = path.join(d, n);
      return statSync(f).isDirectory() ? walk(f) : [f];
    });
    for (const f of [...walk(routers), ...walk(path.join(__dirname, "../../../client/src"))]) {
      if (!/\.(ts|tsx)$/.test(f)) continue;
      const s = readFileSync(f, "utf8");
      if (/demonstrativePricesAllowed|HOMOLOGATION_DEMONSTRATIVE|homologationDemonstrativeAllowed/.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it("[37] na exceção o valor continua DEMONSTRATIVO: o documento mantém a marcação [REVISAR] de fonte fictícia", () => {
    const c = ctxOf([{ fq: 2, price: 150 }], { allowed: true });
    const { items } = canonicalDocumentItems(c, [approvedCtxItem(2)]);
    const block = renderAuthoritativeItemsBlock(computeItemEstimates(items, { preserveOrder: true }));
    expect(block).toContain(fictitiousQuotesReviewText(2));
    expect(block).toContain("não constitui pesquisa de preços válida");
  });
});

describe("M8 — texto honesto do conjunto de cotações e riscos derivados na leitura", () => {
  it("nunca 'válida' só por ter preço; fictícia declarada como não utilizável", () => {
    expect(describeQuoteSet(countProvenance(["ficticia"]))).toBe(
      "1 cotação(ões) importada(s) com preço; 1 identificada(s) como fictícia(s) — não utilizável(is) como pesquisa de preços oficial.");
    expect(describeQuoteSet(countProvenance(["declarada", "declarada"]))).toBe("2 cotação(ões) importada(s) com preço.");
    expect(describeQuoteSet(countProvenance([]))).toBe("Nenhuma cotação com preço.");
  });

  it("risco legado 'válidas' é normalizado na LEITURA e o risco de fonte fictícia é derivado (o banco não é reescrito)", () => {
    const stored = [{ id: "r1", type: "baixa_competitividade", severity: "medio", description: LEGACY_LOW_QUOTE_COUNT_RISK_TEXT, explanation: "x" }];
    const out = deriveItemRisks("ii1", stored, countProvenance(["ficticia"]));
    expect(out[0].description).toBe(LOW_QUOTE_COUNT_RISK_TEXT);
    expect(out[1]).toMatchObject({ type: "fonte_ficticia", severity: "alto" });
    expect(out[1].description).toContain("identificada(s) como fictícia(s)");
    expect(stored[0].description).toBe(LEGACY_LOW_QUOTE_COUNT_RISK_TEXT);
    expect(deriveItemRisks("ii1", [], countProvenance(["declarada"]))).toEqual([]);
  });
});

describe("M8 — correções da auditoria independente", () => {
  it("P1-3 negação e linhas não reconhecidas não declaram o documento fictício; 'pesquisa sintética' não é declaração", () => {
    expect(declaresFictitious("Obs.: não foram aceitas cotações de fornecedores fictícios")).toBe(false);
    expect(suggestsDemonstrative("Obs.: não foram aceitas cotações de fornecedores fictícios")).toBe(true);
    expect(declaresFictitious("Vedadas cotações fictícias.")).toBe(false);
    expect(declaresFictitious("Pesquisa sintética de preços")).toBe(false);
    expect(declaresFictitious("Observação: os valores são fictícios")).toBe(true);
    const p = parsePriceResearchText(["Observação: não foram aceitas cotações de fornecedores fictícios", "Caneta azul;10;UN;R$ 1,50;Papelaria Alfa"].join("\n"));
    expect(p.synthetic).toBe(false);
    expect(p.items[0].quotes[0].fictitious).toBe(false);
  });

  it("P1-1 o nome que declara 'fictício' prevalece sobre o valor gravado; o marcador legado com declaração nas notas ⇒ fictícia", () => {
    expect(effectiveQuoteProvenance({ stored: "declarada", supplierName: "Fornecedor Fictício A" })).toBe("ficticia");
    expect(effectiveQuoteProvenance({ stored: "verificada", supplierName: "Fornecedor Fictício A" })).toBe("ficticia");
    expect(effectiveQuoteProvenance({ stored: null, supplierName: "Empresa A", legacyMarker: true, legacyNotes: "Observação: dados fictícios" })).toBe("ficticia");
    expect(effectiveQuoteProvenance({ stored: null, supplierName: "Empresa A", legacyMarker: true, legacyNotes: "Data: 05/10/2026" })).toBe("suspeita");
  });

  it("P1-1 vínculo proveniência × conteúdo: retrato preservado com outro conteúdo não herda a proveniência da linha reimportada", () => {
    const row = (stored: string | null, supplier: string, valueCents: number) => ({ stored, legacyMarker: false, supplier, valueCents });
    // retrato aprovado "Empresa A / 100" marcado fictício na materialização; a linha foi reimportada como "Alfa / 100" declarada.
    const snapFict = [{ name: "Empresa A", value: 100, quoteId: "q1", provenanceKind: "ficticia" }];
    expect(quoteProvenanceCounts(snapFict, new Map([["q1", row("declarada", "Alfa", 10_000)]])).ficticia).toBe(1);
    // retrato legado (sem proveniência) com nome fictício ⇒ fictícia pelo nome, qualquer que seja a linha.
    expect(quoteProvenanceCounts([{ name: "Fornecedor Fictício A", value: 100, quoteId: "q1" }], new Map([["q1", row("declarada", "Alfa", 10_000)]])).ficticia).toBe(1);
    // mesmo conteúdo + nova declaração fictícia na linha ⇒ fictícia (a declaração nova prevalece).
    expect(quoteProvenanceCounts([{ name: "Alfa", value: 100, quoteId: "q1", provenanceKind: "declarada" }], new Map([["q1", row("ficticia", "Alfa", 10_000)]])).ficticia).toBe(1);
    // retrato legado, conteúdo divergente, nome neutro ⇒ desconhecida (nunca verificada por herança).
    const c = quoteProvenanceCounts([{ name: "Beta", value: 100, quoteId: "q1" }], new Map([["q1", row("verificada", "Alfa", 10_000)]]));
    expect([c.desconhecida, c.verificada]).toEqual([1, 0]);
  });

  it("P1-2 cotação legada possivelmente demonstrativa volta a marcar [REVISAR] no documento (sem bloqueio estrutural)", () => {
    const block = renderAuthoritativeItemsBlock(computeItemEstimates([{ ...approvedCtxItem(0), suspectedQuoteCount: 2 }]));
    expect(block).toContain(suspectedQuotesReviewText(2));
    expect(renderAuthoritativeItemsBlock(computeItemEstimates([approvedCtxItem(0)]))).not.toContain("possivelmente demonstrativa");
  });

  it("P2-3 a exceção de homologação deixa rastro: digest canônico (`dem`) e linhagem da Contratação Direta", () => {
    const demo = ctxOf([{ fq: 2, price: 150 }], { allowed: true });
    expect(demo.items[0].priceContext.demonstrative).toBe(true);
    expect(demo.digest).not.toBe(ctxOf([{ fq: 0, price: 150 }], { allowed: true }).digest);
    expect("demonstrative" in ctxOf([{ fq: 0, price: 150 }]).items[0].priceContext).toBe(false);
    const s = summarizePriceResearch([
      { description: "Caneta", unit: "UN", quantity: 10, value: 1, demonstrative: true },
      { description: "Caneta", unit: "UN", quantity: 10, value: 3, demonstrative: true },
    ]);
    if (!s.ok) throw new Error("demo");
    const l = buildResearchLineage({ researchId: "r", contentHash: "h".repeat(64), importedAt: "x", importSource: "colar", summary: s.summary, method: "media", proposedValue: null });
    expect(l.demonstrativeQuoteCount).toBe(2);
    expect(describeLineage(l)).toContain("DEMONSTRATIVA(S)");
  });
});

describe("M8 emenda — Contratação Direta: a pesquisa da linhagem é IMUTÁVEL (sem janela entre revalidação e publicação)", () => {
  it("só três escritores de price_research_items; nenhum UPDATE/DELETE; a importação direta é INSERT estrito (sem upsert)", () => {
    const root = path.join(__dirname, "../..");
    const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
      const f = path.join(d, n);
      return statSync(f).isDirectory() ? (n === "__tests__" ? [] : walk(f)) : [f];
    });
    const writers: string[] = [];
    for (const f of walk(root).filter((x) => /\.ts$/.test(x))) {
      const s = readFileSync(f, "utf8");
      if (/\.(update|delete)\(priceResearchItemsTable\)/.test(s) || /(UPDATE|DELETE FROM)\s+`?price_research_items/i.test(s)) writers.push(`MUTATION:${path.relative(root, f)}`);
      if (/\.insert\(priceResearchItemsTable\)/.test(s)) writers.push(path.relative(root, f));
    }
    expect(writers.sort()).toEqual(["db/directPriceImport.ts", "db/procurement.ts", "services/importPromotionService.ts"]);
    const direct = readFileSync(path.join(root, "db/directPriceImport.ts"), "utf8");
    expect(direct).toContain("tx.insert(priceResearchItemsTable)");
    expect(direct).not.toContain("onDuplicateKeyUpdate"); // linha da importação direta nunca é reescrita
  });
});

/**
 * Itens da Contratação — domínio PURO: identidade estável × fingerprint, candidatos da Pesquisa/DFD,
 * matching determinístico (sem fuzzy/LLM), decisões humanas, sourceQuantity × plannedQuantity, lotes
 * (opcionais, não fazem parte da identidade), governança antecipada e integração com o contexto/DFD.
 */
import { describe, it, expect } from "vitest";
import {
  procurementItemId, procurementLotId, itemFingerprint, lotCodeKey, parsePlannedQuantity, priceResearchCandidateSources,
  dfdCandidateSources, matchCandidates, planCandidateDecisions, governedChangeReason, ItemDomainError,
  type ItemCandidate, type ProcurementLot,
} from "../../domain/procurementItems";
import { resolveCanonicalContext, itemPath, factValueHash, type FactAssertion } from "../../domain/canonicalProcurementContext";
import { buildDFDPrefill, renderDFDContent, parseDFD, linkDFDRows, computeDFDFieldStates, writeMarkers, prefillMarkers } from "../../domain/dfdPrefill";

const ORG = 7, PID = "proc-1";
/** Fixture sanitizada: 5 itens lógicos (30 cotações ao todo) já materializados após revisão aprovada + promoção. */
const RESEARCH = [
  { id: "ii1", description: "Concentrado ativado", unit: "Tambor", quantity: 1, status: "aprovado", quoteCount: 6 },
  { id: "ii2", description: "Detergente automotivo", unit: "Galão", quantity: 20, status: "pendente", quoteCount: 6 },
  { id: "ii3", description: "Pano de microfibra", unit: "UN", quantity: 0, status: "aprovado", quoteCount: 6 },
  { id: "ii4", description: "Cera líquida", unit: "Litro", quantity: 35, status: "aprovado", quoteCount: 6 },
  { id: "ii5", description: "Escova de cerdas", unit: "UN", quantity: 1, status: "aprovado", quoteCount: 6 },
].map((i) => ({ ...i, sourceResearchId: "rs-promoted" }));
/** Lineage governado: a pesquisa veio da PROMOÇÃO de uma sessão aprovada (revisão humana concluída). */
const RESEARCHES = new Map([["rs-promoted", { researchId: "rs-promoted", provenance: "promoted_session" as const, importSessionId: 1 }]]);
const lots: ProcurementLot[] = [];
const sources = () => priceResearchCandidateSources(RESEARCH, RESEARCHES);
const cands = (items = [] as Parameters<typeof matchCandidates>[1], links = [] as Parameters<typeof matchCandidates>[2], l = lots as Parameters<typeof matchCandidates>[3]) => matchCandidates(sources(), items, links, l);
const plan = (candidates: ItemCandidate[], decisions: Parameters<typeof planCandidateDecisions>[0]["decisions"], items: Array<{ id: string; status: "active" | "withdrawn" }> = [], l: Array<Pick<ProcurementLot, "id" | "codeKey" | "status">> = []) =>
  planCandidateDecisions({ organizationId: ORG, processId: PID, candidates, decisions, items, lots: l });

describe("Itens da contratação — identidade, candidatos e quantidades", () => {
  it("3) Pesquisa revisada (5 itens lógicos / 30 cotações) ⇒ 5 candidatos com descrição e unidade herdadas", () => {
    const c = cands();
    expect(c).toHaveLength(5);
    expect(c.map((x) => [x.description, x.unit])).toEqual([
      ["Concentrado ativado", "Tambor"], ["Detergente automotivo", "Galão"], ["Pano de microfibra", "UN"], ["Cera líquida", "Litro"], ["Escova de cerdas", "UN"],
    ]);
    expect(c.every((x) => x.match.status === "new")).toBe(true);
  });

  it("4/5/6) sourceQuantity preservada como evidência (1, 35, ausente) e NUNCA vira prevista sozinha", () => {
    const c = cands();
    expect(c.map((x) => x.sourceQuantity)).toEqual([1, 20, null, 35, 1]);
    const p = plan(c, c.map((x) => ({ candidateKey: x.candidateKey, action: "create" as const })));
    expect(p.creates.map((x) => x.quantity)).toEqual([null, null, null, null, null]);
    // 4) fonte = 1, necessidade = 35 → coexistem
    const p2 = plan(c, [{ candidateKey: c[0].candidateKey, action: "create", plannedQuantity: "35" }]);
    expect(p2.creates[0]).toMatchObject({ quantity: 35, quantityMode: "informed" });
    expect(p2.creates[0].candidate.sourceQuantity).toBe(1);
  });

  it("7) 'Usar N' adota a quantidade da fonte por decisão explícita; sem quantidade na fonte ⇒ recusa", () => {
    const c = cands();
    const p = plan(c, [{ candidateKey: c[3].candidateKey, action: "create", adoptSourceQuantity: true }]);
    expect(p.creates[0]).toMatchObject({ quantity: 35, quantityMode: "adopted_source" });
    expect(() => plan(c, [{ candidateKey: c[2].candidateKey, action: "create", adoptSourceQuantity: true }])).toThrow(/NO_SOURCE_QUANTITY/);
    expect(() => plan(c, [{ candidateKey: c[3].candidateKey, action: "create", adoptSourceQuantity: true, plannedQuantity: "2" }])).toThrow(/INVALID_DECISION/);
  });

  it("8/9/10) descrição/unidade editadas pelo humano antes de confirmar: override registrado, fonte preservada", () => {
    const c = cands();
    const p = plan(c, [{ candidateKey: c[0].candidateKey, action: "create", description: "Carvão ativado concentrado", unit: "Tambor 200L" }]);
    expect(p.creates[0]).toMatchObject({ description: "Carvão ativado concentrado", unit: "Tambor 200L", descriptionOverridden: true, unitOverridden: true });
    expect(p.creates[0].candidate.description).toBe("Concentrado ativado"); // fonte intacta
  });

  it("11/14) fingerprint determinístico; id estável é função da ORIGEM (não da descrição)", () => {
    expect(itemFingerprint("  Cadeira GIRATÓRIA. ", "un")).toBe(itemFingerprint("cadeira giratória", "UN"));
    const c = cands();
    const p = plan(c, [{ candidateKey: c[0].candidateKey, action: "create", description: "Outro texto" }]);
    const again = plan(c, [{ candidateKey: c[0].candidateKey, action: "create" }]);
    expect(p.creates[0].itemId).toBe(again.creates[0].itemId); // mesma origem ⇒ mesmo id (replay não duplica)
    expect(p.creates[0].itemId).toMatch(/^[0-9a-f]{24}$/);
    expect(procurementItemId(ORG, PID, "manual:5:k1")).not.toBe(procurementItemId(ORG, PID, "manual:5:k2"));
  });

  it("12/13/17) mesmo fingerprint NÃO funde: propõe (possible_match) ou exige escolha (ambiguous)", () => {
    const fp = itemFingerprint("Concentrado ativado", "Tambor");
    const one = cands([{ id: "x1", fingerprint: fp, status: "active", lotId: null }]);
    expect(one[0].match).toMatchObject({ status: "possible_match", canonicalItemId: null, candidateItemIds: ["x1"] });
    const two = cands([{ id: "x1", fingerprint: fp, status: "active", lotId: "L1" }, { id: "x2", fingerprint: fp, status: "active", lotId: "L2" }]);
    expect(two[0].match).toMatchObject({ status: "ambiguous", candidateItemIds: ["x1", "x2"] });
    // Humano decide: criar como novo é permitido (itens iguais em estruturas distintas coexistem)
    const p = plan(two, [{ candidateKey: two[0].candidateKey, action: "create" }], [{ id: "x1", status: "active" }, { id: "x2", status: "active" }]);
    expect(p.creates).toHaveLength(1);
    const pl = plan(two, [{ candidateKey: two[0].candidateKey, action: "link", canonicalItemId: "x2" }], [{ id: "x1", status: "active" }, { id: "x2", status: "active" }]);
    expect(pl.links[0].itemId).toBe("x2");
  });

  it("duplicidade: evidência já vinculada ⇒ 'linked' (reprocessar/clicar duas vezes não cria de novo)", () => {
    const c0 = cands();
    const links = [{ itemId: "x1", sourceType: "price_research" as const, sourceId: "ii1", sourceItemKey: c0[0].sourceItemKey }];
    const c = cands([{ id: "x1", fingerprint: c0[0].fingerprint, status: "active", lotId: null }], links);
    expect(c[0].match).toMatchObject({ status: "linked", canonicalItemId: "x1" });
    expect(() => plan(c, [{ candidateKey: c[0].candidateKey, action: "create" }], [{ id: "x1", status: "active" }])).toThrow(/CANDIDATE_ALREADY_LINKED/);
    expect(plan(c, [{ candidateKey: c[0].candidateKey, action: "link" }], [{ id: "x1", status: "active" }]).skipped).toBe(1);
  });

  it("candidato inexistente/desatualizado, ids arbitrários e identidade em revisão são recusados", () => {
    const c = cands();
    expect(() => plan(c, [{ candidateKey: "f".repeat(24), action: "create" }])).toThrow(/STALE_CANDIDATES/);
    expect(() => plan(c, [{ candidateKey: c[0].candidateKey, action: "link", canonicalItemId: "nao-existe" }])).toThrow(/ITEM_NOT_FOUND/);
    const blocked = matchCandidates(priceResearchCandidateSources([{ ...RESEARCH[0], sourceState: "review_required" }], RESEARCHES), [], [], []);
    expect(blocked[0].match.status).toBe("blocked");
    expect(() => plan(blocked, [{ candidateKey: blocked[0].candidateKey, action: "create" }])).toThrow(/CANDIDATE_BLOCKED/);
  });

  it("rejeitados na Pesquisa não viram candidatos (gate: só Itens Inteligentes materializados e não rejeitados)", () => {
    expect(priceResearchCandidateSources([{ ...RESEARCH[0], status: "rejeitado" }], RESEARCHES)).toHaveLength(0);
  });

  it("1) item pode existir sem quantidade; validação decimal (DECIMAL(14,3), sem float canônico)", () => {
    expect(parsePlannedQuantity("")).toEqual({ ok: true, value: null });
    expect(parsePlannedQuantity("35")).toEqual({ ok: true, value: 35 });
    expect(parsePlannedQuantity("1.200,5")).toEqual({ ok: true, value: 1200.5 });
    expect(parsePlannedQuantity("2,125")).toEqual({ ok: true, value: 2.125 });
    for (const bad of ["0", "-1", "1,2345", "abc", "123456789012"]) expect(parsePlannedQuantity(bad).ok).toBe(false);
  });
});

describe("Lotes — opcionais, explícitos na fonte, nunca parte da identidade", () => {
  const rows = [
    { description: "Detergente", unit: "UN", quantity: null, lotCode: "LOTE 01" },
    { description: "Desinfetante", unit: "UN", quantity: 10, lotCode: "01" },
    { description: "Cloro", unit: "Litro", quantity: null, lotCode: "02" },
  ];

  it("importação: fonte com LOTE 01 {A,B} / LOTE 02 {C} ⇒ proposta de 2 lotes e 3 itens", () => {
    const c = matchCandidates(dfdCandidateSources("doc1", rows), [], [], []);
    const p = plan(c, c.map((x) => ({ candidateKey: x.candidateKey, action: "create" as const, lot: { kind: "source" as const } })));
    expect(p.lotsToCreate.map((l) => l.codeKey)).toEqual(["1", "2"]);
    expect(p.creates.map((x) => x.lot.kind === "source" ? x.lot.codeKey : null)).toEqual(["1", "1", "2"]);
    expect(new Set(p.creates.map((x) => x.lot.kind === "source" ? x.lot.lotId : null)).size).toBe(2);
    expect(lotCodeKey("Lote 001")).toBe(lotCodeKey("1"));
  });

  it("lote ambíguo/ausente na fonte ⇒ sem vínculo silencioso ('source' recusado; humano escolhe)", () => {
    const c = matchCandidates(dfdCandidateSources("doc1", [{ ...rows[0], lotCode: null }]), [], [], []);
    expect(c[0].sourceLotCode).toBeNull();
    expect(() => plan(c, [{ candidateKey: c[0].candidateKey, action: "create", lot: { kind: "source" } }])).toThrow(/NO_SOURCE_LOT/);
    expect(() => plan(c, [{ candidateKey: c[0].candidateKey, action: "create", lot: { kind: "existing", lotId: "nope" } }])).toThrow(/LOT_NOT_FOUND/);
    const ok = plan(c, [{ candidateKey: c[0].candidateKey, action: "create", lot: { kind: "existing", lotId: "L9" } }], [], [{ id: "L9", codeKey: "9", status: "active" }]);
    expect(ok.creates[0].lot).toEqual({ kind: "existing", lotId: "L9" });
  });

  it("15/16) mover de lote não muda o id do item; processo sem lote não exige lote", () => {
    const id = procurementItemId(ORG, PID, "price_research:ii1:k");
    const mk = (lotId: string | null) => resolveCanonicalContext({
      organizationId: ORG, processId: PID, process: { number: "1", object: "Obj", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
      organization: null, assertions: [], intelligentItems: [],
      procurementItems: [{ id, description: "Detergente", unit: "UN", lotId, ordinal: 1, status: "active", revision: 1, fingerprint: itemFingerprint("Detergente", "UN") }],
      lots: [{ id: "L1", code: "01", name: "Limpeza", ordinal: 1, status: "active" }, { id: "L2", code: "02", name: "Químicos", ordinal: 2, status: "active" }],
    });
    expect(mk("L1").items[0].key).toBe(id);
    expect(mk("L2").items[0].key).toBe(id);
    expect(mk(null).items[0].lotId).toBeNull();
    expect(mk("L1").digest).not.toBe(mk("L2").digest); // estrutura mudou ⇒ nova versão do contexto
    expect(procurementLotId(ORG, PID, "manual:1")).toMatch(/^[0-9a-f]{24}$/);
  });
});

describe("Governança antecipada (GOVERNED_CHANGE_REQUIRED)", () => {
  it("elaboração: livre; TR/Edital emitido: tudo exige alteração governada; aprovado consumiu o item: só definir 1ª vez", () => {
    const free = { officialEmittedKinds: [] as string[], itemsConsumedByApproved: new Set<string>() };
    expect(governedChangeReason(free, "quantity_change", "i1")).toBeNull();
    expect(governedChangeReason({ ...free, officialEmittedKinds: ["tr"] }, "create", null)).toMatch(/alteração governada/);
    const consumed = { ...free, itemsConsumedByApproved: new Set(["i1"]) };
    expect(governedChangeReason(consumed, "quantity_change", "i1")).toMatch(/documento aprovado/);
    expect(governedChangeReason(consumed, "description", "i1")).toMatch(/documento aprovado/);
    expect(governedChangeReason(consumed, "quantity_define", "i1")).toBeNull();
    expect(governedChangeReason(consumed, "quantity_change", "i2")).toBeNull();
    expect(governedChangeReason({ ...free, officialEmittedKinds: ["etp"] }, "create", null)).toBeNull();
  });
  it("erro de domínio estável", () => {
    expect(new ItemDomainError("X", "y").message).toBe("X: y");
  });
});

describe("DFD consome os Itens da contratação (lotes, sem quantidade, desatualização)", () => {
  const A = "a1a1a1a1a1a1a1a1a1a1a1a1", B = "b2b2b2b2b2b2b2b2b2b2b2b2";
  const fact = (id: number, path: string, value: number, basis: string | null = null): FactAssertion => ({
    id, path: path as FactAssertion["path"], value, valueHash: factValueHash(value), sourceType: "user", sourceId: "items-area",
    sourceVersion: `r${id}:informed`, status: "confirmed", actorUserId: 5, basisValueHash: basis, createdAt: "2026-02-01T00:00:00.000Z",
  });
  const ctxOf = (facts: FactAssertion[]) => resolveCanonicalContext({
    organizationId: ORG, processId: PID, process: { number: "1", object: "Limpeza", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
    organization: null, assertions: facts, intelligentItems: [],
    procurementItems: [
      { id: A, description: "Detergente", unit: "UN", lotId: "L1", ordinal: 1, status: "active", revision: 1, fingerprint: itemFingerprint("Detergente", "UN") },
      { id: B, description: "Detergente", unit: "UN", lotId: "L2", ordinal: 2, status: "active", revision: 1, fingerprint: itemFingerprint("Detergente", "UN") },
    ],
    lots: [{ id: "L1", code: "01", name: "Prédio A", ordinal: 1, status: "active" }, { id: "L2", code: "02", name: "Prédio B", ordinal: 2, status: "active" }],
  });

  it("com lotes: tabela ganha coluna Lote; itens iguais em lotes distintos ligam-se às linhas certas; sem quantidade ⇒ [a definir]", () => {
    const pf = buildDFDPrefill(ctxOf([fact(1, itemPath(A, "plannedQuantity"), 10)]));
    const content = renderDFDContent(pf);
    expect(content).toContain("| Lote | Item | Descrição | Unidade | Quantidade prevista |");
    expect(content).toContain("| 01 | 1 | Detergente | UN | 10 |");
    expect(content).toContain("| 02 | 2 | Detergente | UN | [a definir] |");
    const linked = linkDFDRows(parseDFD(content), pf.items, writeMarkers([], prefillMarkers(pf)));
    expect(linked.map((l) => l.itemId)).toEqual([A, B]);
  });

  it("20) quantidade muda na Área de Itens ⇒ campo do DFD desatualizado (reconciliação explícita)", () => {
    const c0 = ctxOf([fact(1, itemPath(A, "plannedQuantity"), 10)]);
    const pf = buildDFDPrefill(c0);
    const content = renderDFDContent(pf);
    const sources = writeMarkers([], prefillMarkers(pf));
    const c1 = ctxOf([fact(1, itemPath(A, "plannedQuantity"), 10), fact(2, itemPath(A, "plannedQuantity"), 12, factValueHash(10))]);
    const v = computeDFDFieldStates(content, sources, buildDFDPrefill(c1)).find((f) => f.key === `item:${A}`)!;
    expect(v).toMatchObject({ state: "stale", documentValue: "10", contextValue: "12", reconcilable: true });
    expect(c1.version).toBeGreaterThan(c0.version);
  });
});

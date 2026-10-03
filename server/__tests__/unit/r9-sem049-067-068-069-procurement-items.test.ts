/**
 * R9 / SEM-049, SEM-067, SEM-068, SEM-069 — Itens da contratação, domínio PURO:
 *  - SEM-049: "Usar N" adota a quantidade ATUAL da fonte; divergência do vínculo congelado ⇒ SOURCE_QUANTITY_CHANGED
 *    (ou adoção do valor que o cliente confirmou ter visto); SEM-055: substituir prevista definida exige confirmação;
 *  - SEM-067: lote arquivado libera o código (code_key renomeado deterministicamente) e nunca é destino no plano;
 *  - SEM-068: linhas IDÊNTICAS do DFD são candidatos distintos (ordinal na chave); chaves legadas continuam reconhecidas;
 *  - SEM-069: reincluir item retirado ⇒ recusa explícita ITEM_PREVIOUSLY_WITHDRAWN (nunca no-op "sucesso").
 */
import { createHash } from "crypto";
import { describe, it, expect } from "vitest";
import {
  dfdCandidateSources, dfdSourceItemKey, parseDfdSourceItemKey, matchCandidates, planCandidateDecisions, priceResearchCandidateSources,
  procurementItemId, procurementLotId, freshLotId, archivedLotCodeKey, isArchivedLotCodeKey, itemFingerprint, lotCodeKey,
  checkAdoptSourceQuantity, sameQuantity, adoptionNeedsReplaceConfirmation, ITEM_PREVIOUSLY_WITHDRAWN,
  type ItemCandidate, type ProcurementLot,
} from "../../domain/procurementItems";
import { intelligentItemLogicalKey } from "../../domain/priceQuoteConsolidation";
import { parseDFD, linkDFDRows } from "../../domain/dfdPrefill";

const ORG = 960_490, PID = "proc-r9";
const plan = (
  candidates: ItemCandidate[], decisions: Parameters<typeof planCandidateDecisions>[0]["decisions"],
  items: Array<{ id: string; status: "active" | "withdrawn"; unit?: string }> = [], lots: Array<Pick<ProcurementLot, "id" | "codeKey" | "status">> = [],
) => planCandidateDecisions({ organizationId: ORG, processId: PID, candidates, decisions, items: items.map((i) => ({ unit: "UN", ...i })), lots });

const TWIN = [
  { description: "Detergente neutro", unit: "UN", quantity: 10, lotCode: null },
  { description: "Detergente neutro", unit: "UN", quantity: 10, lotCode: null },
];

describe("R9 / SEM-068 — linhas idênticas do DFD não colapsam", () => {
  it("duas linhas idênticas ⇒ duas chaves/candidatos; confirmar ambas cria DOIS itens (sem DUPLICATE_DECISION)", () => {
    const s = dfdCandidateSources("doc1", TWIN);
    expect(s[0].sourceItemKey).not.toBe(s[1].sourceItemKey);
    const c = matchCandidates(s, [], [], []);
    expect(new Set(c.map((x) => x.candidateKey)).size).toBe(2);
    expect(c[1].duplicateOfCandidateKey).toBe(c[0].candidateKey); // só informativo: mesma descrição/unidade
    const p = plan(c, c.map((x) => ({ candidateKey: x.candidateKey, action: "create" as const })));
    expect(p.creates).toHaveLength(2);
    expect(p.creates[0].itemId).not.toBe(p.creates[1].itemId);
  });

  it("o ordinal é a posição na tabela INTEIRA (rowOrdinal explícito), não na lista filtrada", () => {
    const s = dfdCandidateSources("doc1", [{ ...TWIN[0], rowOrdinal: 5 }]);
    expect(s[0].sourceItemKey).toBe(dfdSourceItemKey(itemFingerprint("Detergente neutro", "UN"), null, 5));
    expect(parseDfdSourceItemKey(s[0].sourceItemKey)).toEqual({ fingerprint: itemFingerprint("Detergente neutro", "UN"), lotKey: null, rowOrdinal: 5 });
  });

  it("chave nova cabe em 64 caracteres com o ordinal antes do lote; chave LEGADA continua parseável (rowOrdinal = null)", () => {
    const fp = itemFingerprint("X", "UN");
    const k = dfdSourceItemKey(fp, "Lote 0001", 123);
    expect(k).toBe(`${fp}#r123:1`);
    expect(parseDfdSourceItemKey(`${fp}:1`)).toEqual({ fingerprint: fp, lotKey: "1", rowOrdinal: null });
    expect(parseDfdSourceItemKey(`${fp}:`)).toEqual({ fingerprint: fp, lotKey: null, rowOrdinal: null });
    expect(parseDfdSourceItemKey(k.slice(0, 64)).rowOrdinal).toBe(123);
  });

  it("chaves da Pesquisa de Preços NÃO mudam", () => {
    const ii = { id: "ii1", description: "Cera líquida", unit: "Litro", quantity: 35, status: "aprovado", approvedBy: 9, sourceResearchId: "rs" };
    const [s] = priceResearchCandidateSources([ii], new Map([["rs", { researchId: "rs", provenance: "promoted_session" as const, importSessionId: 1 }]]));
    expect(s.sourceItemKey).toBe(createHash("sha256").update(intelligentItemLogicalKey(ii)).digest("hex").slice(0, 32));
  });

  it("linkDFDRows: vínculos com ordinal ligam CADA linha idêntica ao seu item; vínculo legado (sem ordinal) segue ligando", () => {
    const content = [
      "## 4. Itens", "| Item | Descrição | Unidade | Quantidade prevista |", "|---|---|---|---|",
      "| 1 | Detergente neutro | UN | 10 |", "| 2 | Detergente neutro | UN | 12 |", "| 3 | Sabão | Kg | 4 |",
    ].join("\n");
    const fpD = itemFingerprint("Detergente neutro", "UN"), fpS = itemFingerprint("Sabão", "Kg");
    const it = (key: string, fp: string) => ({ key, fingerprint: fp, lotCode: null, description: "", unit: "", plannedQuantity: null, qtyOrigin: null, qtyConflict: false });
    const items = [it("A", fpD), it("B", fpD), it("S", fpS)];
    const links = [
      { ...parseDfdSourceItemKey(dfdSourceItemKey(fpD, null, 2)), itemId: "B" },
      { ...parseDfdSourceItemKey(dfdSourceItemKey(fpD, null, 1)), itemId: "A" },
      { ...parseDfdSourceItemKey(`${fpS}:`), itemId: "S" }, // legado
    ];
    const linked = linkDFDRows(parseDFD(content), items as never, [], links);
    expect(linked.map((l) => [l.itemId, l.via])).toEqual([["A", "source_link"], ["B", "source_link"], ["S", "source_link"]]);
    // Antes (sem ordinal) as duas linhas idênticas ficavam AMBÍGUAS e nenhuma era ligada.
    const legacyOnly = linkDFDRows(parseDFD(content), items as never, [], [{ fingerprint: fpD, lotKey: null, itemId: "A" }, { fingerprint: fpD, lotKey: null, itemId: "B" }]);
    expect(legacyOnly.slice(0, 2).map((l) => l.itemId)).toEqual([null, null]);
  });
});

describe("R9 / SEM-069 — reincluir item retirado é recusado explicitamente", () => {
  it("vínculo exato da evidência aponta para item retirado ⇒ withdrawnItemId; create/link recusados", () => {
    const [c0] = matchCandidates(dfdCandidateSources("doc1", [TWIN[0]]), [], [], []);
    const links = [{ itemId: "w1", sourceType: "dfd" as const, sourceId: "doc1", sourceItemKey: c0.sourceItemKey }];
    const items = [{ id: "w1", fingerprint: c0.fingerprint, status: "withdrawn" as const, lotId: null }];
    const [c] = matchCandidates(dfdCandidateSources("doc1", [TWIN[0]]), items, links, []);
    expect(c.match.status).toBe("new");
    expect(c.withdrawnItemId).toBe("w1");
    expect(() => plan([c], [{ candidateKey: c.candidateKey, action: "create" }], [{ id: "w1", status: "withdrawn" }])).toThrow(new RegExp(ITEM_PREVIOUSLY_WITHDRAWN));
    expect(() => plan([c], [{ candidateKey: c.candidateKey, action: "link", canonicalItemId: "a1" }], [{ id: "a1", status: "active" }])).toThrow(/ITEM_PREVIOUSLY_WITHDRAWN/);
    expect(plan([c], [{ candidateKey: c.candidateKey, action: "skip" }]).skipped).toBe(1); // pular continua possível
  });

  it("vínculo LEGADO do DFD (sem ordinal) de item retirado também sinaliza (não volta como item novo com outra identidade)", () => {
    const fp = itemFingerprint("Detergente neutro", "UN");
    const links = [{ itemId: "w1", sourceType: "dfd" as const, sourceId: "doc1", sourceItemKey: `${fp}:` }];
    const [c] = matchCandidates(dfdCandidateSources("doc1", [TWIN[0]]), [{ id: "w1", fingerprint: fp, status: "withdrawn", lotId: null }], links, []);
    expect(c.withdrawnItemId).toBe("w1");
    // de OUTRO documento: não é a mesma evidência
    const [other] = matchCandidates(dfdCandidateSources("doc2", [TWIN[0]]), [{ id: "w1", fingerprint: fp, status: "withdrawn", lotId: null }], links, []);
    expect(other.withdrawnItemId).toBeNull();
  });

  it("sem vínculo, mas o id determinístico pertence a item retirado ⇒ recusa (defesa em profundidade)", () => {
    const [c] = matchCandidates(dfdCandidateSources("doc1", [TWIN[0]]), [], [], []);
    const wid = procurementItemId(ORG, PID, `dfd:doc1:${c.sourceItemKey}`);
    expect(() => plan([c], [{ candidateKey: c.candidateKey, action: "create" }], [{ id: wid, status: "withdrawn" }])).toThrow(/ITEM_PREVIOUSLY_WITHDRAWN/);
  });

  it("evidência vinculada a item ATIVO continua 'linked' (não é sinalizada)", () => {
    const [c0] = matchCandidates(dfdCandidateSources("doc1", [TWIN[0]]), [], [], []);
    const links = [{ itemId: "a1", sourceType: "dfd" as const, sourceId: "doc1", sourceItemKey: c0.sourceItemKey }];
    const [c] = matchCandidates(dfdCandidateSources("doc1", [TWIN[0]]), [{ id: "a1", fingerprint: c0.fingerprint, status: "active", lotId: null }], links, []);
    expect(c.match.status).toBe("linked");
    expect(c.withdrawnItemId).toBeNull();
  });
});

describe("R9 / SEM-067 — lote arquivado libera o código e nunca é destino", () => {
  it("archivedLotCodeKey: determinístico, ≤ 40 caracteres, único por lote e idempotente", () => {
    const id = "f".repeat(24);
    const k = archivedLotCodeKey("1", id);
    expect(k).toBe(`1~${id}`);
    expect(archivedLotCodeKey(k, id)).toBe(k);
    expect(isArchivedLotCodeKey(k, id)).toBe(true);
    const long = archivedLotCodeKey("X".repeat(40), id);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith(`~${id}`)).toBe(true);
    expect(archivedLotCodeKey("1", "e".repeat(24))).not.toBe(k);
    expect(lotCodeKey("Lote 01")).not.toBe(k); // o código liberado volta a ser usável
  });

  it("freshLotId evita ids ocupados (ex.: lote arquivado com a mesma origem) de forma determinística", () => {
    const base = procurementLotId(ORG, PID, "manual:1");
    expect(freshLotId(ORG, PID, "manual:1", [])).toBe(base);
    const next = freshLotId(ORG, PID, "manual:1", [base]);
    expect(next).not.toBe(base);
    expect(freshLotId(ORG, PID, "manual:1", [base])).toBe(next);
    expect(freshLotId(ORG, PID, "manual:1", [base, next])).not.toBe(next);
  });

  it("plano: lote da fonte com código de um ARQUIVADO ⇒ novo lote (id ≠ arquivado); o item nunca aponta para o arquivado", () => {
    const archivedId = procurementLotId(ORG, PID, "src:1");
    const c = matchCandidates(dfdCandidateSources("doc1", [{ ...TWIN[0], lotCode: "01" }, { description: "Cloro", unit: "L", quantity: 2, lotCode: "1" }]), [], [], [
      { id: archivedId, codeKey: "1", status: "archived" },
    ]);
    expect(c.every((x) => x.sourceLotId === null)).toBe(true); // arquivado nunca é o lote da fonte
    const p = plan(c, c.map((x) => ({ candidateKey: x.candidateKey, action: "create" as const, lot: { kind: "source" as const } })), [], [{ id: archivedId, codeKey: "1", status: "archived" }]);
    expect(p.lotsToCreate).toHaveLength(1);
    expect(p.lotsToCreate[0].lotId).not.toBe(archivedId);
    expect(p.creates.map((x) => (x.lot.kind === "source" ? x.lot.lotId : null))).toEqual([p.lotsToCreate[0].lotId, p.lotsToCreate[0].lotId]);
    expect(() => plan(c, [{ candidateKey: c[0].candidateKey, action: "create", lot: { kind: "existing", lotId: archivedId } }], [], [{ id: archivedId, codeKey: "1", status: "archived" }]))
      .toThrow(/LOT_NOT_FOUND/);
  });
});

describe("R9 / SEM-049, SEM-055 — 'Usar N' adota a quantidade ATUAL da fonte", () => {
  it("atual = vínculo ⇒ adota; atual ≠ vínculo sem confirmação ⇒ SOURCE_QUANTITY_CHANGED com vínculo × atual", () => {
    expect(checkAdoptSourceQuantity({ linked: 10, current: 10 })).toEqual({ ok: true, value: 10 });
    expect(checkAdoptSourceQuantity({ linked: 10, current: 12 })).toEqual({ ok: false, code: "SOURCE_QUANTITY_CHANGED", linked: 10, current: 12, expected: undefined });
  });

  it("cliente confirmou o valor ATUAL que viu ⇒ adota o atual; confirmou valor velho ⇒ recusa", () => {
    expect(checkAdoptSourceQuantity({ linked: 10, current: 12, expected: 12 })).toEqual({ ok: true, value: 12 });
    expect(checkAdoptSourceQuantity({ linked: 10, current: 12, expected: 10 })).toMatchObject({ ok: false, code: "SOURCE_QUANTITY_CHANGED" });
    expect(checkAdoptSourceQuantity({ linked: 10, current: 13, expected: 12 })).toMatchObject({ ok: false, code: "SOURCE_QUANTITY_CHANGED", current: 13 });
  });

  it("fonte ausente ⇒ SOURCE_NOT_FOUND; fonte sem quantidade ⇒ NO_SOURCE_QUANTITY; decimal comparado sem float cru", () => {
    expect(checkAdoptSourceQuantity({ linked: 10, current: undefined })).toEqual({ ok: false, code: "SOURCE_NOT_FOUND" });
    expect(checkAdoptSourceQuantity({ linked: 10, current: null })).toEqual({ ok: false, code: "NO_SOURCE_QUANTITY" });
    expect(checkAdoptSourceQuantity({ linked: null, current: 4 })).toMatchObject({ ok: false, code: "SOURCE_QUANTITY_CHANGED" });
    expect(sameQuantity(0.1 + 0.2, 0.3)).toBe(false);
    expect(sameQuantity(1.5, 1.5)).toBe(true);
    expect(sameQuantity(null, undefined)).toBe(true);
  });

  it("SEM-055: substituir prevista JÁ definida exige confirmação; vazia ou em conflito não", () => {
    expect(adoptionNeedsReplaceConfirmation({ value: 35, status: "confirmed" })).toBe(true);
    expect(adoptionNeedsReplaceConfirmation({ value: null, status: "unknown" })).toBe(false);
    expect(adoptionNeedsReplaceConfirmation({ value: 3, status: "conflict" })).toBe(false);
    expect(adoptionNeedsReplaceConfirmation(null)).toBe(false);
  });
});

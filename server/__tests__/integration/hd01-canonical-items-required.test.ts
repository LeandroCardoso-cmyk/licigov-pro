/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HD-01 (opção A) — Itens da contratação canônicos são OBRIGATÓRIOS para TODA geração NOVA de TR e de Edital.
 *
 *   QUOTE_QUANTITY = EVIDENCE;  QUOTE_QUANTITY != NEED;  NO_CANONICAL_ITEMS ⇒ CANONICAL_ITEMS_REQUIRED (fail-closed).
 *
 * A regra NÃO depende de existir quantidade de cotação: com ZERO itens/cotações aprovados também bloqueia. O bloqueio
 * ocorre ANTES de reservar idempotência, de qualquer cognição (IA/provider), de rascunho e de documento oficial.
 * DB/idempotência/provider mockados (a prova com MySQL real está em `canonical-quantity-documents-mysql-smoke`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeTx = { __tx: true };
vi.mock("../../db/procurement");
vi.mock("../../db/officialDocumentPromotions", () => ({ getLatestOfficialPromotion: vi.fn(async () => null), insertOfficialPromotion: vi.fn(async () => {}) }));
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({ transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx) })),
}));
vi.mock("../../services/kernelAccessService", () => ({ assertKernelAccess: vi.fn() }));
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn(async () => ({ status: "new" })), saveIdempotencyResult: vi.fn(async () => {}), failIdempotencyKey: vi.fn(async () => {}),
}));
vi.mock("../../services/documentEngineService", () => ({
  generateOfficialDocument: vi.fn(async () => ({ id: "off-1", version: 1, lineageId: "lin-1" })),
}));
vi.mock("../../db/cognitiveProvenance", () => ({ linkProvenanceArtifact: vi.fn(async () => ({ linked: 1 })) }));
vi.mock("../../services/authoring/authoringContext", async (orig) => ({
  ...(await orig<typeof import("../../services/authoring/authoringContext")>()),
  resolveDocumentAuthoringContext: vi.fn(),
}));
vi.mock("../../services/authoring/structuredAuthoringService", async (orig) => ({
  ...(await orig<typeof import("../../services/authoring/structuredAuthoringService")>()),
  generateStructuredAuthoring: vi.fn(),
  generateEditalAuthoring: vi.fn(),
}));
vi.mock("../../services/authoring/editalContext", async (orig) => ({
  ...(await orig<typeof import("../../services/authoring/editalContext")>()),
  resolveEditalSources: vi.fn(),
}));

import * as procDb from "../../db/procurement";
import * as docEngine from "../../services/documentEngineService";
import * as idem from "../../services/idempotencyService";
import * as authoring from "../../services/authoring/authoringContext";
import * as structured from "../../services/authoring/structuredAuthoringService";
import * as edital from "../../services/authoring/editalContext";
import { CANONICAL_ITEMS_REQUIRED, generateDocument, generateNotice } from "../../services/procurementProcessService";

const base = { sourcesDigest: "d".repeat(64), lineageMarkers: [], usedSources: [], missing: [], estimate: {}, sourceVersions: {} };
const canonicalOk = { contextDigest: "c".repeat(64), missingPlannedQuantity: [], unlinkedApprovedItemCount: 0 };
const ctxNoCanonicalWithQuotes = { ...base, canonical: null, legacyQuotedItemCount: 3, quantitySource: "legacy" } as any;
const ctxNoCanonicalZeroQuotes = { ...base, canonical: null, legacyQuotedItemCount: 0, quantitySource: "legacy" } as any;
const ctxValid = { ...base, canonical: canonicalOk, legacyQuotedItemCount: 0, quantitySource: "canonical_planned" } as any;
const ctxMissingPlanned = { ...ctxValid, canonical: { ...canonicalOk, missingPlannedQuantity: [{ id: "i1", description: "Cadeira" }] } } as any;
const ctxUnlinked = { ...ctxValid, canonical: { ...canonicalOk, unlinkedApprovedItemCount: 2 } } as any;
const authored = { content: "# Novo rascunho IA", groundingState: "grounded", evidences: [], evidenceComplete: true, evidenceFingerprint: "f", corpusFingerprint: "c", structured: { usedSourceIds: [] } } as any;

const genTR = () => generateDocument({
  organizationId: 7, processId: "p1", kind: "tr", object: "Limpeza", correlationId: "c", idempotencyKey: "k", actorUserId: 11, invoke: async () => "{}",
} as any);
const genEdital = () => generateNotice({
  organizationId: 7, processId: "p1", object: "Limpeza", modality: "concorrencia", form: "presencial", correlationId: "c", idempotencyKey: "k", actorUserId: 11,
  invoke: async () => "{}",
} as any);

function setContext(ctx: any) {
  vi.mocked(authoring.resolveDocumentAuthoringContext).mockResolvedValue(ctx);
  vi.mocked(edital.resolveEditalSources).mockResolvedValue(ctx);
}

/** Bloqueio ANTES de reserva de idempotência, cognição, rascunho e documento oficial (nenhum efeito colateral). */
function expectZeroEffects() {
  expect(idem.checkIdempotency).not.toHaveBeenCalled();
  expect(idem.saveIdempotencyResult).not.toHaveBeenCalled();
  expect(structured.generateStructuredAuthoring).not.toHaveBeenCalled();
  expect(structured.generateEditalAuthoring).not.toHaveBeenCalled();
  expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
  expect(procDb.recordProcessEvent).not.toHaveBeenCalled();
  expect(docEngine.generateOfficialDocument).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(procDb.listIntelligentItems).mockResolvedValue([] as any);
  vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(null);
  vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(null);
  vi.mocked(procDb.applyDraftContentMutationTx).mockImplementation(async (_tx: any, input: any) => ({ created: true, changed: true, document: input.doc }));
  vi.mocked(structured.generateStructuredAuthoring).mockResolvedValue(authored);
  vi.mocked(structured.generateEditalAuthoring).mockResolvedValue(authored);
});

describe("HD-01 — sem Itens da contratação canônicos a geração NOVA de TR/Edital é bloqueada", () => {
  it("o código estável permanece CANONICAL_ITEMS_REQUIRED", () => {
    expect(CANONICAL_ITEMS_REQUIRED).toBe("CANONICAL_ITEMS_REQUIRED");
  });

  it("Caso A — sem itens canônicos + COTAÇÃO existente ⇒ TR e Edital BLOQUEADOS (mensagem contextual da cotação)", async () => {
    setContext(ctxNoCanonicalWithQuotes);
    const expected = { code: "PRECONDITION_FAILED", message: expect.stringMatching(/^CANONICAL_ITEMS_REQUIRED:.*3 item\(ns\) da Pesquisa de Preços.*evidência de preço e não representa a necessidade/) };
    await expect(genTR()).rejects.toMatchObject(expected);
    await expect(genEdital()).rejects.toMatchObject(expected);
    expectZeroEffects();
  });

  it("Caso B — sem itens canônicos + ZERO itens/cotações aprovadas ⇒ TR e Edital BLOQUEADOS (o `return` legado não existe mais)", async () => {
    setContext(ctxNoCanonicalZeroQuotes);
    const expected = { code: "PRECONDITION_FAILED", message: expect.stringMatching(/^CANONICAL_ITEMS_REQUIRED: cadastre os "Itens da contratação"/) };
    await expect(genTR()).rejects.toMatchObject(expected);
    await expect(genEdital()).rejects.toMatchObject(expected);
    // sem cotação, a mensagem NÃO afirma quantidade de cotação
    await expect(genTR()).rejects.toThrow(/^(?!.*Pesquisa de Preços)/s);
    expectZeroEffects();
  });

  it("Caso C — Itens canônicos válidos + quantidade prevista válida ⇒ geração PERMITIDA (TR e Edital)", async () => {
    setContext(ctxValid);
    const tr = await genTR();
    expect(tr.document.content).toContain("Novo rascunho IA");
    const ed = await genEdital();
    expect(ed.document.content).toContain("Novo rascunho IA");
    expect(structured.generateStructuredAuthoring).toHaveBeenCalledTimes(1);
    expect(structured.generateEditalAuthoring).toHaveBeenCalledTimes(1);
  });

  it("Caso D — Itens canônicos existentes + quantidade prevista AUSENTE ⇒ PLANNED_QUANTITY_REQUIRED (zero efeitos)", async () => {
    setContext(ctxMissingPlanned);
    const expected = { code: "PRECONDITION_FAILED", message: expect.stringMatching(/^PLANNED_QUANTITY_REQUIRED:/) };
    await expect(genTR()).rejects.toMatchObject(expected);
    await expect(genEdital()).rejects.toMatchObject(expected);
    expectZeroEffects();
  });

  it("Caso E — item de pesquisa aprovado mas NÃO vinculado ⇒ PRICE_RESEARCH_ITEM_UNLINKED (zero efeitos)", async () => {
    setContext(ctxUnlinked);
    const expected = { code: "PRECONDITION_FAILED", message: expect.stringMatching(/^PRICE_RESEARCH_ITEM_UNLINKED: 2 item\(ns\)/) };
    await expect(genTR()).rejects.toMatchObject(expected);
    await expect(genEdital()).rejects.toMatchObject(expected);
    expectZeroEffects();
  });

  it("o ETP NÃO é alterado por esta regra (decisão congelada é só TR/Edital): sem itens canônicos segue sem bloqueio", async () => {
    setContext(ctxNoCanonicalZeroQuotes);
    const etp = await generateDocument({
      organizationId: 7, processId: "p1", kind: "etp", object: "Limpeza", correlationId: "c", idempotencyKey: "k", actorUserId: 11, invoke: async () => "{}",
    } as any);
    expect(etp.document.kind).toBe("etp");
  });
});

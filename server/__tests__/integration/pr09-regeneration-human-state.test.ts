/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR-09 (SEM-014 / SEM-009) — R5.6 (mockado): "regerar sobre edição humana sem confirmação ⇒ recusa".
 *
 * Prova no caminho vivo (`generateDocument` ETP/TR e `generateNotice`), com DB/idempotência mockados:
 *   1. conteúdo humano sem `confirmReplace` ⇒ CONFLICT HUMAN_EDIT_WOULD_BE_OVERWRITTEN, ANTES de reservar
 *      idempotência, de qualquer cognição e de qualquer write;
 *   2. `confirmReplace: true` ⇒ segue; ledger recebe `reason` rastreável e o estado esperado é o hash visto;
 *   3. rascunho só de IA regenera SEM confirmação (comportamento inalterado);
 *   4. `expectedContentHash` divergente ⇒ CONFLICT antes de qualquer efeito;
 *   5. Edital: parâmetros PERSISTIDOS usados no servidor; proposta divergente sem troca explícita ⇒ CONFLICT;
 *      sem parâmetros ⇒ PRECONDITION_FAILED (sem padrão silencioso).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeTx = { __tx: true };
vi.mock("../../db/procurement");
// R5 — a regeneração consulta o ledger de emissão oficial (autoridade); neste teste mockado nada foi emitido.
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
import * as promotions from "../../db/officialDocumentPromotions";
import * as docEngine from "../../services/documentEngineService";
import * as idem from "../../services/idempotencyService";
import * as authoring from "../../services/authoring/authoringContext";
import * as structured from "../../services/authoring/structuredAuthoringService";
import * as edital from "../../services/authoring/editalContext";
import { generateDocument, generateNotice } from "../../services/procurementProcessService";
import { draftContentHash } from "../../domain/generatedDocument";

const HUMAN = "# TR\nSeção 5 reescrita pelo jurista (edição humana).";
const ctx = { sourcesDigest: "d".repeat(64), lineageMarkers: [], usedSources: [], missing: [], canonical: { contextDigest: "c".repeat(64), missingPlannedQuantity: [], unlinkedApprovedItemCount: 0 }, legacyQuotedItemCount: 0, quantitySource: "canonical_planned", estimate: {}, sourceVersions: {} } as any;
const authored = { content: "# Novo rascunho IA", groundingState: "grounded", evidences: [], evidenceComplete: true, evidenceFingerprint: "f", corpusFingerprint: "c", structured: { usedSourceIds: [] } } as any;

function draftRow(content: string, extra: Record<string, unknown> = {}) {
  return { id: "g1", kind: "tr", title: "TR — X", content, status: "rascunho", sources: ["grounding:grounded"], authorUserId: 5, lastSubstantiveActorUserId: 9, updatedAt: "2026-09-01T00:00:00Z", modality: null, form: null, platform: null, ...extra } as any;
}
const ledger = (operation: string, content: string) => ({ operation, actorUserId: 9, newContentHash: draftContentHash(content), createdAt: "2026-09-01T10:00:00.000Z" });

const genTR = (over: Record<string, unknown> = {}) => generateDocument({
  organizationId: 7, processId: "p1", kind: "tr", object: "Limpeza", correlationId: "c", idempotencyKey: "k", actorUserId: 11,
  invoke: async () => "{}", ...over,
} as any);

function expectZeroEffects() {
  expect(idem.checkIdempotency).not.toHaveBeenCalled();
  expect(structured.generateStructuredAuthoring).not.toHaveBeenCalled();
  expect(structured.generateEditalAuthoring).not.toHaveBeenCalled();
  expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
  expect(procDb.recordProcessEvent).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(procDb.listIntelligentItems).mockResolvedValue([] as any);
  vi.mocked(authoring.resolveDocumentAuthoringContext).mockResolvedValue(ctx);
  vi.mocked(edital.resolveEditalSources).mockResolvedValue(ctx);
  vi.mocked(structured.generateStructuredAuthoring).mockResolvedValue(authored);
  vi.mocked(structured.generateEditalAuthoring).mockResolvedValue(authored);
  vi.mocked(procDb.applyDraftContentMutationTx).mockImplementation(async (_tx: any, input: any) => ({ created: false, changed: true, document: input.doc }));
  vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(null);
});

describe("SEM-014 — regenerar ETP/TR sobre conteúdo humano", () => {
  it("R5.6 — edição humana (ledger human_edit) sem confirmReplace ⇒ CONFLICT HUMAN_EDIT_WOULD_BE_OVERWRITTEN, zero IA e zero writes", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow(HUMAN));
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(ledger("human_edit", HUMAN));
    await expect(genTR()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^HUMAN_EDIT_WOULD_BE_OVERWRITTEN: o rascunho do TR/) });
    await expect(genTR({ confirmReplace: false })).rejects.toMatchObject({ code: "CONFLICT" });
    expectZeroEffects();
  });

  it("documento importado (marcador origem:import) também é protegido", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow(HUMAN, { sources: ["origem:import"] }));
    await expect(generateDocument({ organizationId: 7, processId: "p1", kind: "etp", object: "X", correlationId: "c", idempotencyKey: "k", actorUserId: 11, invoke: async () => "{}" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("o rascunho do ETP contém documento importado") });
    expectZeroEffects();
  });

  it("confirmReplace: true ⇒ regenera; estado esperado = hash visto; ledger ai_regenerate com motivo rastreável", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow(HUMAN));
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(ledger("human_edit", HUMAN));
    const res = await genTR({ confirmReplace: true, expectedContentHash: draftContentHash(HUMAN) });
    expect(res.document.content).toContain("Novo rascunho IA");
    const call = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1];
    expect(call.operation).toBe("ai_regenerate");
    expect(call.expectedState).toEqual({ type: "present", contentHash: draftContentHash(HUMAN) });
    expect(call.reason).toBe("confirm_replace:human_edit:human_edit");
    const event = vi.mocked(procDb.recordProcessEvent).mock.calls[0][0];
    expect(event.summary).toContain("Substituiu conteúdo humano por confirmação explícita");
  });

  it("rascunho SÓ de IA (último ledger ai_regenerate / sem ledger) regenera SEM confirmação — inalterado", async () => {
    const ai = "# TR gerado por IA";
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow(ai));
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(ledger("ai_regenerate", ai));
    await genTR();
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(null);
    await genTR({ idempotencyKey: "k2" });
    expect(structured.generateStructuredAuthoring).toHaveBeenCalledTimes(2);
    const call = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1];
    expect(call.reason).toBeNull();
    expect(call.expectedState).toEqual({ type: "present", contentHash: draftContentHash(ai) });
  });

  it("1ª geração (sem rascunho) ⇒ sem guarda, estado esperado ausente", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(null);
    await genTR();
    expect(procDb.getLatestDraftEdit).not.toHaveBeenCalled();
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].expectedState).toEqual({ type: "absent" });
  });

  it("expectedContentHash divergente (o humano viu outra versão) ⇒ CONFLICT antes de qualquer efeito, mesmo com confirmReplace", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow(HUMAN));
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(ledger("human_edit", HUMAN));
    await expect(genTR({ confirmReplace: true, expectedContentHash: "f".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("mudou desde o carregamento") });
    expectZeroEffects();
  });
});

describe("SEM-014 + SEM-009 — Edital", () => {
  const persistedRow = (content: string) => draftRow(content, { kind: "edital", modality: "concorrencia", form: "presencial", platform: null });
  const genEdital = (over: Record<string, unknown> = {}) => generateNotice({
    organizationId: 7, processId: "p1", object: "Obra", correlationId: "c", idempotencyKey: "ke", actorUserId: 11,
    invoke: async () => "{}", ...over,
  } as any);

  it("Edital com edição humana sem confirmReplace ⇒ recusa (zero IA/writes)", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(persistedRow(HUMAN));
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(ledger("human_edit", HUMAN));
    await expect(genEdital()).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^HUMAN_EDIT_WOULD_BE_OVERWRITTEN: o rascunho do Edital/) });
    expectZeroEffects();
  });

  it("sem proposta ⇒ usa os parâmetros PERSISTIDOS (concorrência/presencial), nunca pregão/eletrônico por padrão", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(persistedRow("# Edital IA"));
    await genEdital();
    expect(vi.mocked(edital.resolveEditalSources).mock.calls[0][0]).toMatchObject({ modality: "concorrencia", form: "presencial", platform: null });
    expect(vi.mocked(structured.generateEditalAuthoring).mock.calls[0][0]).toMatchObject({ modality: "concorrencia", form: "presencial" });
    const doc = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].doc;
    expect(doc).toMatchObject({ modality: "concorrencia", form: "presencial", platform: null });
    expect(doc.legalJustification.length).toBeGreaterThan(0); // presencial ⇒ justificativa estruturada
  });

  it("proposta divergente (o antigo padrão da UI) sem troca explícita ⇒ CONFLICT EDITAL_PARAMETERS_CHANGED (zero efeitos)", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(persistedRow("# Edital IA"));
    await expect(genEdital({ modality: "pregao", form: "eletronico", platform: "compras_gov" }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^EDITAL_PARAMETERS_CHANGED:/) });
    expectZeroEffects();
  });

  it("troca explícita (confirmParameterChange) ⇒ aplica a proposta e registra atual → proposto na timeline", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(persistedRow("# Edital IA"));
    await genEdital({ modality: "pregao", form: "eletronico", platform: "compras_gov", confirmParameterChange: true });
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].doc).toMatchObject({ modality: "pregao", form: "eletronico", platform: "compras_gov" });
    expect(vi.mocked(procDb.recordProcessEvent).mock.calls[0][0].summary).toContain("Parâmetros trocados explicitamente: concorrencia/presencial → pregao/eletronico/compras_gov");
  });

  it("sem parâmetros persistidos e sem proposta ⇒ PRECONDITION_FAILED EDITAL_PARAMETERS_REQUIRED (zero efeitos)", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(null);
    await expect(genEdital()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/^EDITAL_PARAMETERS_REQUIRED:/) });
    expectZeroEffects();
  });
});

// ─── R5 (decisões do owner) ──────────────────────────────────────────────────────────────────────

describe("R5.B — documento APROVADO/OFICIAL não é regenerado diretamente", () => {
  const emitted = { officialDocumentId: "off-9", lineageId: "lin-9", version: 2, contentHash: "h", actorUserId: 3, createdAt: "2026-09-10T00:00:00.000Z" };
  const edRow = (extra: Record<string, unknown> = {}) => draftRow("# Edital IA", { kind: "edital", modality: "pregao", form: "eletronico", platform: "bll", ...extra });

  it.each(["etp", "tr"] as const)("%s com versão oficial emitida ⇒ PRECONDITION_FAILED OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE mesmo com confirmReplace (zero efeitos)", async (kind) => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow(HUMAN, { kind }));
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(ledger("human_edit", HUMAN));
    vi.mocked(promotions.getLatestOfficialPromotion).mockResolvedValue(emitted);
    for (const extra of [{}, { confirmReplace: true, expectedContentHash: draftContentHash(HUMAN) }]) {
      await expect(generateDocument({ organizationId: 7, processId: "p1", kind, object: "X", correlationId: "c", idempotencyKey: "k", actorUserId: 11, invoke: async () => "{}", ...extra } as any))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/^OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE: o (ETP|TR) já possui versão OFICIAL emitida \(v2\)/) });
    }
    expectZeroEffects();
    // Recusa ANTES de montar contexto/classificar (nenhuma leitura de ledger de edição, nenhum contexto).
    expect(authoring.resolveDocumentAuthoringContext).not.toHaveBeenCalled();
    expect(procDb.getLatestDraftEdit).not.toHaveBeenCalled();
    expect(vi.mocked(promotions.getLatestOfficialPromotion).mock.calls[0]).toEqual([7, "p1", kind, undefined]); // tenant-scoped
  });

  it("Edital oficial ⇒ recusa ANTES da resolução de parâmetros (nem troca confirmada, nem confirmReplace)", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(edRow());
    vi.mocked(promotions.getLatestOfficialPromotion).mockResolvedValue(emitted);
    await expect(generateNotice({
      organizationId: 7, processId: "p1", object: "Obra", modality: "concorrencia", form: "presencial", confirmParameterChange: true,
      confirmReplace: true, judgmentCriterion: "Menor preço", correlationId: "c", idempotencyKey: "ke", actorUserId: 11, invoke: async () => "{}",
    } as any)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/^OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE: o Edital/) });
    expectZeroEffects();
    expect(edital.resolveEditalSources).not.toHaveBeenCalled();
  });

  it("status aprovado (sem emissão) também bloqueia", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow("# TR IA", { status: "aprovado" }));
    vi.mocked(promotions.getLatestOfficialPromotion).mockResolvedValue(null);
    await expect(genTR({ confirmReplace: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("está APROVADO") });
    expectZeroEffects();
  });

  it("emissão concluída DURANTE a cognição ⇒ revalidação na transação recusa; nada persistido, chave marcada failed", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow("# TR IA"));
    vi.mocked(promotions.getLatestOfficialPromotion).mockResolvedValueOnce(null).mockResolvedValueOnce(emitted);
    await expect(genTR()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/^OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE:/) });
    expect(vi.mocked(promotions.getLatestOfficialPromotion).mock.calls[1][3]).toBe(fakeTx); // revalidado na MESMA transação
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
    expect(procDb.recordProcessEvent).not.toHaveBeenCalled();
    expect(idem.saveIdempotencyResult).not.toHaveBeenCalled();
    expect(idem.failIdempotencyKey).toHaveBeenCalledTimes(1);
  });
});

describe("R5.A — regenerar rascunho: confirmação explícita basta (sem justificativa textual)", () => {
  it("confirmReplace: true SEM qualquer justificativa ⇒ regenera; o conteúdo humano segue para o ledger (previous_content)", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow(HUMAN));
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(ledger("human_edit", HUMAN));
    vi.mocked(promotions.getLatestOfficialPromotion).mockResolvedValue(null);
    await expect(genTR({ confirmReplace: true })).resolves.toBeTruthy();
    const call = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1];
    expect(call.operation).toBe("ai_regenerate"); // applyDraftContentMutationTx grava previous_content = conteúdo vigente
    expect(call.expectedState).toEqual({ type: "present", contentHash: draftContentHash(HUMAN) });
  });

  it("recusa NÃO reserva idempotência: a MESMA chave segue utilizável após confirmar", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow(HUMAN));
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(ledger("human_edit", HUMAN));
    vi.mocked(promotions.getLatestOfficialPromotion).mockResolvedValue(null);
    await expect(genTR({ idempotencyKey: "same" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(idem.checkIdempotency).not.toHaveBeenCalled();
    await genTR({ idempotencyKey: "same", confirmReplace: true });
    expect(idem.checkIdempotency).toHaveBeenCalledTimes(1);
    expect(vi.mocked(idem.checkIdempotency).mock.calls[0][0]).toBe("same");
  });
});

describe("R5.C — Edital lê critério de julgamento / regime de execução PERSISTIDOS", () => {
  const row = (extra: Record<string, unknown>) => draftRow("# Edital IA", { kind: "edital", modality: "pregao", form: "eletronico", platform: "bll", ...extra });
  const genEdital = (over: Record<string, unknown> = {}) => generateNotice({
    organizationId: 7, processId: "p1", object: "Obra", correlationId: "c", idempotencyKey: "ke", actorUserId: 11,
    invoke: async () => "{}", ...over,
  } as any);
  beforeEach(() => { vi.mocked(promotions.getLatestOfficialPromotion).mockResolvedValue(null); });

  it("persistidos ⇒ contexto recebe critério/regime (sem [REVISAR]) e o rascunho os mantém; metadata carrega o lineage", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row({ judgmentCriterion: "Menor preço", executionRegime: "Empreitada por preço global" }));
    await genEdital();
    expect(vi.mocked(edital.resolveEditalSources).mock.calls[0][0]).toMatchObject({ criterioJulgamento: "Menor preço", regimeContratacao: "Empreitada por preço global" });
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].doc).toMatchObject({ judgmentCriterion: "Menor preço", executionRegime: "Empreitada por preço global" });
    expect((vi.mocked(docEngine.generateOfficialDocument).mock.calls[0][0] as any).metadata)
      .toMatchObject({ judgmentCriterion: "Menor preço", executionRegime: "Empreitada por preço global", parametersSource: "persisted" });
  });

  it("NULL (linha antiga) ⇒ contexto recebe null (vira [REVISAR]); nenhum valor inventado é gravado", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row({ judgmentCriterion: null, executionRegime: null }));
    await genEdital();
    expect(vi.mocked(edital.resolveEditalSources).mock.calls[0][0]).toMatchObject({ criterioJulgamento: null, regimeContratacao: null });
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].doc).toMatchObject({ judgmentCriterion: null, executionRegime: null });
  });

  it("1ª definição de critério ainda NULL ⇒ sem confirmação; timeline registra o complemento", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row({}));
    await genEdital({ judgmentCriterion: "Maior desconto" });
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].doc).toMatchObject({ modality: "pregao", judgmentCriterion: "Maior desconto", executionRegime: null });
    expect(vi.mocked(procDb.recordProcessEvent).mock.calls[0][0].summary).toContain("Parâmetros complementados: pregao/eletronico/bll → pregao/eletronico/bll · critério de julgamento: Maior desconto");
  });

  it("sobrescrever critério decidido sem confirmParameterChange ⇒ CONFLICT (zero efeitos); com confirmação ⇒ aplicado", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row({ judgmentCriterion: "Menor preço" }));
    await expect(genEdital({ judgmentCriterion: "Técnica e preço" })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^EDITAL_PARAMETERS_CHANGED:/) });
    expectZeroEffects();
    await genEdital({ judgmentCriterion: "Técnica e preço", confirmParameterChange: true });
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].doc).toMatchObject({ judgmentCriterion: "Técnica e preço" });
    expect(vi.mocked(procDb.recordProcessEvent).mock.calls[0][0].summary).toContain("Parâmetros trocados explicitamente");
  });
});

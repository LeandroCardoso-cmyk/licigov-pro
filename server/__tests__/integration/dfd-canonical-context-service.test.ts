/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DFD × Contexto Canônico — SERVIÇO (persistência mockada; a real é coberta pelo smoke MySQL).
 *  - Criar DFD: prefill do contexto + marcadores; fallback histórico se o contexto falhar; nunca sobrescreve
 *    edição humana/IA/importação; DFD aprovado intocável;
 *  - Salvar: preserva marcadores, afirma fatos (fonte dfd, confirmado) NA MESMA transação, audita override;
 *  - Reconciliar: ação explícita campo a campo (ledger dfd_context_reconcile);
 *  - IA supervisionada: só via AIExecutionEngine, contexto governado, rascunho marcado, proveniência
 *    obrigatória, sem chamada de IA quando a pré-condição falha, replay sem nova chamada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/procurement");
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({ transaction: async (cb: (tx: unknown) => unknown) => cb({ __tx: true }) })),
}));
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn(async () => ({ status: "new" })),
  saveIdempotencyResult: vi.fn(async () => undefined),
  failIdempotencyKey: vi.fn(async () => undefined),
}));
vi.mock("../../services/canonicalContextService", () => ({
  resolveProcurementContext: vi.fn(),
  recordContextAssertions: vi.fn(async () => 1),
}));
vi.mock("../../db/cognitiveProvenance", () => ({ linkProvenanceArtifact: vi.fn(async () => ({ linked: 1 })) }));
vi.mock("../../services/aiExecutionEngine", () => ({ executeCognitiveTask: vi.fn() }));

import * as procDb from "../../db/procurement";
import * as ctxSvc from "../../services/canonicalContextService";
import * as idem from "../../services/idempotencyService";
import * as prov from "../../db/cognitiveProvenance";
import * as engine from "../../services/aiExecutionEngine";
import {
  generateDFDDraft, saveDFDDraft, reconcileDFDFieldDraft, generateDFDJustificationDraft, getDFDAssistState,
} from "../../services/procurementProcessService";
import {
  resolveCanonicalContext, canonicalItemKey, itemPath, factValueHash, type FactAssertion, type ContextPath, type FactValue, type ContextSourceType,
} from "../../domain/canonicalProcurementContext";
import { readMarkers, parseDFD } from "../../domain/dfdPrefill";
import { buildDFDDraft, draftContentHash } from "../../domain/generatedDocument";

const ORG = 7;
const PID = "proc-1";
const K = "a1a1a1a1a1a1a1a1a1a1a1a1"; // id estável do Item Canônico
let seq = 0;
const fact = (path: ContextPath, value: FactValue, sourceType: ContextSourceType, extra: Partial<FactAssertion> = {}): FactAssertion => ({
  id: ++seq, path, value, valueHash: factValueHash(value), sourceType, sourceId: `${sourceType}-1`, sourceVersion: "v1",
  status: "confirmed", actorUserId: 3, basisValueHash: null, createdAt: "2026-02-01T10:00:00.000Z", ...extra,
});
function ctxWith(extra: FactAssertion[] = []) {
  return resolveCanonicalContext({
    organizationId: ORG, processId: PID,
    process: { number: "2026/0001", object: "Mobiliário escolar", responsibleUserId: 3, createdAt: "2026-01-01T00:00:00.000Z" },
    responsibleUserName: "Servidora Responsável", organization: { name: "Prefeitura de Teste", municipio: "Teste", uf: "PR" },
    assertions: [fact("demand.requestingUnit", "Secretaria de Educação", "process", { sourceId: PID }), fact(itemPath(K, "plannedQuantity"), 30, "user"), ...extra.map((e) => ({ ...e, id: ++seq }))],
    intelligentItems: [{ id: "i1", description: "Cadeira giratória", unit: "UN", quantity: 1, status: "aprovado", averagePriceCents: 45_000, quoteCount: 3 }],
    procurementItems: [{ id: K, description: "Cadeira giratória", unit: "UN", lotId: null, ordinal: 1, status: "active", revision: 1, fingerprint: canonicalItemKey("Cadeira giratória", "UN") }],
    priceLinks: [{ itemId: K, intelligentItemId: "i1" }],
  });
}

const base = { organizationId: ORG, processId: PID, object: "Mobiliário escolar", correlationId: "corr-1", actorUserId: 5 };

/** Cria (via serviço) o DFD pré-preenchido e devolve a linha "persistida". */
async function createdDFD(status = "rascunho") {
  const { document } = await generateDFDDraft({ ...base, idempotencyKey: "gen-1" });
  return { id: document.id, kind: "dfd", title: document.title, content: document.content, status, sources: [...document.sources], authorUserId: 5, lastSubstantiveActorUserId: 5, updatedAt: "" };
}

beforeEach(() => {
  vi.clearAllMocks();
  seq = 0;
  vi.mocked(ctxSvc.resolveProcurementContext).mockResolvedValue(ctxWith());
  vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(null as any);
  vi.mocked(procDb.applyDraftContentMutationTx).mockImplementation(async (_tx: any, input: any) => ({ created: false, changed: true, document: input.doc }));
  vi.mocked(procDb.recordProcessEvent).mockResolvedValue(undefined as any);
  vi.mocked(idem.checkIdempotency).mockResolvedValue({ status: "new" } as any);
  vi.mocked(prov.linkProvenanceArtifact).mockResolvedValue({ linked: 1 });
  vi.mocked(engine.executeCognitiveTask).mockResolvedValue({
    response: { content: "A Secretaria de Educação necessita do mobiliário para o funcionamento das salas de aula.", provider: "mock", model: "mock-1" },
    context: { id: "exec-abc" }, replayed: false,
  } as any);
});

describe("Criar DFD — prefill a partir do Contexto Canônico", () => {
  it("pré-preenche o MESMO template, grava marcadores e o digest do contexto no payload", async () => {
    const { document } = await generateDFDDraft({ ...base, idempotencyKey: "gen-1" });
    expect(document.content).toContain("Setor/unidade demandante: Secretaria de Educação");
    expect(document.content).toContain("| 1 | Cadeira giratória | UN | 30 |");
    expect(document.status).toBe("rascunho"); // prefill ≠ aprovação
    expect(readMarkers(document.sources).contextDigest).toBe(ctxWith().digest.slice(0, 16));
    expect(document.sources).toContain("estrutura:art_12_par_1_lei_14133");
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].operation).toBe("dfd_regenerate");
    expect(procDb.recordProcessEvent).toHaveBeenCalledTimes(1);
    // payloadHash muda com o contexto (mesma chave + contexto novo ⇒ CONFLICT no serviço de idempotência)
    const h1 = vi.mocked(idem.checkIdempotency).mock.calls[0][4];
    vi.mocked(ctxSvc.resolveProcurementContext).mockResolvedValue(ctxWith([fact("planning.priority", "alta", "user")]));
    await generateDFDDraft({ ...base, idempotencyKey: "gen-1" });
    expect(vi.mocked(idem.checkIdempotency).mock.calls[1][4]).not.toBe(h1);
  });

  it("contexto indisponível ⇒ fallback histórico (template só com o objeto), sem bloquear", async () => {
    vi.mocked(ctxSvc.resolveProcurementContext).mockRejectedValue(new Error("db down"));
    const { document } = await generateDFDDraft({ ...base, idempotencyKey: "gen-2" });
    expect(document.content).toBe(buildDFDDraft("Mobiliário escolar"));
    expect(document.sources).toEqual(["estrutura:art_12_par_1_lei_14133"]);
  });

  it("NÃO regenera por cima de edição humana / IA / importação; DFD aprovado é intocável", async () => {
    const row = await createdDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ ...row, sources: ["edicao_manual", ...row.sources] } as any);
    await expect(generateDFDDraft({ ...base, idempotencyKey: "gen-3" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ ...row, status: "aprovado" } as any);
    await expect(generateDFDDraft({ ...base, idempotencyKey: "gen-4" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("DFD_APPROVED") });
    expect(idem.failIdempotencyKey).toHaveBeenCalled();
  });
});

describe("Salvar DFD — override humano preservado e fatos afirmados", () => {
  it("preserva marcadores, afirma (fonte dfd, confirmado) o que o humano informou NA MESMA transação", async () => {
    const row = await createdDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    vi.clearAllMocks();
    vi.mocked(ctxSvc.resolveProcurementContext).mockResolvedValue(ctxWith());
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    vi.mocked(procDb.applyDraftContentMutationTx).mockImplementation(async (_tx: any, input: any) => ({ created: false, changed: true, document: input.doc }));
    vi.mocked(idem.checkIdempotency).mockResolvedValue({ status: "new" } as any);
    const edited = row.content
      .replace("| 1 | Cadeira giratória | UN | 30 |", "| 1 | Cadeira giratória | UN | 45 |")
      .replace("Setor/unidade demandante: Secretaria de Educação", "Setor/unidade demandante: Gabinete");
    const { document } = await saveDFDDraft({ ...base, content: edited, expectedContentHash: draftContentHash(row.content), idempotencyKey: "save-1" });
    expect(document.content).toBe(edited); // conteúdo humano intacto
    expect(document.sources[0]).toBe("edicao_manual");
    expect(readMarkers(document.sources).prefill["identificacao.unidade"]).toBeDefined();
    const call = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1];
    expect(call.operation).toBe("dfd_manual_edit");
    const rec = vi.mocked(ctxSvc.recordContextAssertions).mock.calls[0][0];
    expect(rec.executor).toEqual({ __tx: true }); // mesma transação
    expect(rec.facts.map((f) => [f.path, f.value, f.sourceType, f.status]).sort()).toEqual([
      ["demand.requestingUnit", "Gabinete", "dfd", "confirmed"],
      [itemPath(K, "plannedQuantity"), 45, "dfd", "confirmed"],
    ].sort());
    expect(rec.facts.every((f) => f.actorUserId === 5 && f.basisValueHash)).toBe(true);
    const tl = vi.mocked(procDb.recordProcessEvent).mock.calls[0][0];
    expect(tl.summary).toMatch(/^DFD salvo \(rascunho\)\. Campos informados\/alterados pelo servidor: /);
    expect(tl.summary).not.toContain("Gabinete"); // auditoria sem conteúdo
  });

  it("DFD aprovado não é salvo por esta via", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ ...(await createdDFD()), status: "aprovado" } as any);
    await expect(saveDFDDraft({ ...base, content: "x", expectedContentHash: "h", idempotencyKey: "s" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(procDb.applyDraftContentMutationTx).toHaveBeenCalledTimes(1); // só a criação
  });
});

describe("Desatualização e reconciliação explícita", () => {
  it("contexto mudou → estado 'stale' (read-only) → reconcilia SÓ o campo pedido", async () => {
    const row = await createdDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    const qty = ctxWith().items[0].plannedQuantity.valueHash;
    vi.mocked(ctxSvc.resolveProcurementContext).mockResolvedValue(ctxWith([fact(itemPath(K, "plannedQuantity"), 40, "user", { basisValueHash: qty })]));
    const writesBefore = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls.length;
    const st = await getDFDAssistState({ organizationId: ORG, processId: PID, correlationId: "c" });
    expect(st.stale).toBe(true);
    expect(st.fields.find((f) => f.key === `item:${K}`)).toMatchObject({ state: "stale", reconcilable: true });
    expect(procDb.applyDraftContentMutationTx).toHaveBeenCalledTimes(writesBefore); // leitura não grava

    const { document } = await reconcileDFDFieldDraft({ ...base, fieldKey: `item:${K}`, expectedContentHash: draftContentHash(row.content), idempotencyKey: "rec-1" });
    expect(document.content).toContain("| 1 | Cadeira giratória | UN | 40 |");
    expect(parseDFD(document.content).values["identificacao.unidade"]).toBe("Secretaria de Educação");
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls.at(-1)![1].operation).toBe("dfd_context_reconcile");
  });

  it("campo sem informação de origem nova → PRECONDITION_FAILED (nada gravado)", async () => {
    const row = await createdDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    const n = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls.length;
    await expect(reconcileDFDFieldDraft({ ...base, fieldKey: "identificacao.unidade", expectedContentHash: draftContentHash(row.content), idempotencyKey: "rec-2" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(procDb.applyDraftContentMutationTx).toHaveBeenCalledTimes(n);
  });
});

describe("Rascunho SUPERVISIONADO de IA da justificativa", () => {
  it("via AIExecutionEngine, contexto governado, rascunho marcado + proveniência + explicabilidade", async () => {
    const row = await createdDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    const { document, explanation } = await generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(row.content), idempotencyKey: "ai-1" });
    const call = vi.mocked(engine.executeCognitiveTask).mock.calls[0][0];
    expect(call).toMatchObject({ task: "GENERATE_DOCUMENT", tenantId: ORG, businessDomain: "processo_licitatorio", stage: "DFD", responseType: "text", actorUserId: 5 });
    expect(call.idempotencyKey).toBe("dfdj:ai-1");
    expect(call.query).not.toMatch(/R\$|450|Servidora/); // sem preços nem nome de pessoa
    expect(document.content).toContain("necessita do mobiliário para o funcionamento das salas de aula");
    expect(document.status).toBe("rascunho");
    expect(readMarkers(document.sources).ai.justificativa).toMatchObject({ executionId: "exec-abc" });
    expect(explanation).toMatchObject({ executionId: "exec-abc", provider: "mock", model: "mock-1", promptVersion: "dfd-justificativa/1", actorUserId: 5, correlationId: "corr-1" });
    expect(explanation.contextDigest).toBe(ctxWith().digest.slice(0, 16));
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls.at(-1)![1].operation).toBe("dfd_ai_draft");
    expect(prov.linkProvenanceArtifact).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: ORG, correlationId: "corr-1", artifactKind: "dfd" }));
  });

  it("justificativa escrita por humano: recusa SEM chamar a IA; com confirmação explícita substitui", async () => {
    const row = await createdDFD();
    const human = { ...row, content: row.content.replace(/Descrever a necessidade pública[\s\S]*?\[preencher\]/, "Texto escrito pelo servidor."), sources: ["edicao_manual", ...row.sources.slice(1)] };
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(human as any);
    await expect(generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(human.content), idempotencyKey: "ai-2" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("USER_MODIFIED_FIELD") });
    expect(engine.executeCognitiveTask).not.toHaveBeenCalled();
    const ok = await generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(human.content), confirmReplace: true, idempotencyKey: "ai-3" });
    expect(ok.document.content).not.toContain("Texto escrito pelo servidor.");
  });

  it("rascunho mudou (hash) → CONFLICT sem chamar a IA; DFD aprovado → recusa", async () => {
    const row = await createdDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    await expect(generateDFDJustificationDraft({ ...base, expectedContentHash: "stale", idempotencyKey: "ai-4" })).rejects.toMatchObject({ code: "CONFLICT" });
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ ...row, status: "aprovado" } as any);
    await expect(generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(row.content), idempotencyKey: "ai-5" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(engine.executeCognitiveTask).not.toHaveBeenCalled();
  });

  it("cognição real sem proveniência vinculada → fail-closed (nada persistido)", async () => {
    const row = await createdDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    vi.mocked(prov.linkProvenanceArtifact).mockResolvedValue({ linked: 0 });
    await expect(generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(row.content), idempotencyKey: "ai-6" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(idem.saveIdempotencyResult).not.toHaveBeenCalledWith("ai-6", expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it("replay (mesma chave concluída) devolve o resultado cacheado SEM nova chamada de IA", async () => {
    const row = await createdDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    vi.mocked(idem.checkIdempotency).mockResolvedValue({ status: "completed", payloadMismatch: false, response: { document: row, explanation: { executionId: "exec-old" } } } as any);
    const r = await generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(row.content), idempotencyKey: "ai-7" });
    expect(r.replayed).toBe(true);
    expect(r.explanation.executionId).toBe("exec-old");
    expect(engine.executeCognitiveTask).not.toHaveBeenCalled();
  });

  it("número não confirmado pelo processo vira [REVISAR: …] (IA não inventa quantidade/prazo/valor)", async () => {
    const row = await createdDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    vi.mocked(engine.executeCognitiveTask).mockResolvedValue({ response: { content: "Serão adquiridas 75 cadeiras em 90 dias.", provider: "mock", model: "m" }, context: { id: "e2" } } as any);
    const { document, explanation } = await generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(row.content), idempotencyKey: "ai-8" });
    expect(document.content).toContain("Serão adquiridas [REVISAR: 75] cadeiras em [REVISAR: 90] dias.");
    expect(explanation.unverifiedNumbers).toEqual(["75", "90"]);
  });
});

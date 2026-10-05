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
vi.mock("../../db/cognitiveProvenance", () => ({
  linkProvenanceArtifact: vi.fn(async () => ({ linked: 1 })),
  listProvenanceByCorrelation: vi.fn(async () => [{ id: "p1" }]),
}));
vi.mock("../../services/aiExecutionEngine", () => ({ executeCognitiveTask: vi.fn() }));

import * as procDb from "../../db/procurement";
import * as ctxSvc from "../../services/canonicalContextService";
import * as idem from "../../services/idempotencyService";
import * as prov from "../../db/cognitiveProvenance";
import * as engine from "../../services/aiExecutionEngine";
import {
  generateDFDDraft, saveDFDDraft, reconcileDFDFieldDraft, generateDFDJustificationDraft, acceptDFDJustificationSuggestion, getDFDAssistState,
} from "../../services/procurementProcessService";
import {
  resolveCanonicalContext, canonicalItemKey, itemPath, factValueHash, type FactAssertion, type ContextPath, type FactValue, type ContextSourceType,
} from "../../domain/canonicalProcurementContext";
import { readMarkers, parseDFD } from "../../domain/dfdPrefill";
import { buildDFDDraft, draftContentHash } from "../../domain/generatedDocument";
import { suggestionTextHash, suggestionEventSummary, parseSuggestionEventHash } from "../../domain/dfdJustificationSuggestion";

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
    organization: { name: "Prefeitura de Teste", municipio: "Teste", uf: "PR" },
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
  vi.mocked(prov.listProvenanceByCorrelation).mockResolvedValue([{ id: "p1" }] as any);
  vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue(null as any);
  vi.mocked(procDb.listProcessEventsByRef).mockResolvedValue([]);
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

describe("Responsável pela demanda — operador do Processo não é fonte (piloto)", () => {
  const HUMAN = "Aristides Fernandes Junior";
  /** DFD legado: valor humano + marcador de prefill gravado quando o Processo "preenchia" o operador. */
  async function legacyRow() {
    const row = await createdDFD();
    const content = row.content.replace("Responsável pela demanda: [preencher]", `Responsável pela demanda: ${HUMAN}`);
    const sources = [...row.sources.filter((x) => !x.startsWith("pf:identificacao.responsavel=")), `pf:identificacao.responsavel=${factValueHash("Operador LiciGov")}@process`];
    return { ...row, content, sources };
  }

  it("sem fonte válida: nenhuma divergência, nenhuma ação, e a reconciliação é recusada sem gravar nada", async () => {
    const row = await legacyRow();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    const st = await getDFDAssistState({ organizationId: ORG, processId: PID, correlationId: "c" });
    expect(st.fields.find((f) => f.key === "identificacao.responsavel")).toMatchObject({ state: "user_modified", documentValue: HUMAN, contextValue: null, reconcilable: false });
    expect(st.summary.conflict).toBe(0);
    const n = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls.length;
    await expect(reconcileDFDFieldDraft({ ...base, fieldKey: "identificacao.responsavel", expectedContentHash: draftContentHash(row.content), idempotencyKey: "rec-r0" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(procDb.applyDraftContentMutationTx).toHaveBeenCalledTimes(n);
  });

  it("fonte válida (ETP): substituição só por ação explícita, auditada no MESMO evento de reconciliação e escopada por org+processo", async () => {
    const row = await legacyRow();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    vi.mocked(ctxSvc.resolveProcurementContext).mockResolvedValue(ctxWith([fact("demand.responsibleParty", "Maria Souza", "etp")]));
    const st = await getDFDAssistState({ organizationId: ORG, processId: PID, correlationId: "c" });
    expect(st.fields.find((f) => f.key === "identificacao.responsavel")).toMatchObject({ state: "conflict", documentValue: HUMAN, contextValue: "Maria Souza", contextOrigin: "etp", reconcilable: true });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { document } = await reconcileDFDFieldDraft({ ...base, fieldKey: "identificacao.responsavel", expectedContentHash: draftContentHash(row.content), idempotencyKey: "rec-r1" });
    const event = info.mock.calls.map((c) => JSON.parse(String(c[0]))).find((e) => e.operation === "document_context_reconciled");
    info.mockRestore();
    // Auditoria no evento EXISTENTE: campo, origem aplicada, hashes antes/depois, ator, correlação, timestamp — sem conteúdo.
    expect(event).toMatchObject({
      field: "identificacao.responsavel", sourceType: "etp", previousState: "conflict",
      beforeHash: factValueHash(HUMAN), afterHash: factValueHash("Maria Souza"), actorUserId: 5, correlationId: "corr-1",
      organizationId: ORG, processId: PID,
    });
    expect(typeof event.ts).toBe("string");
    expect(JSON.stringify(event)).not.toContain(HUMAN);
    expect(JSON.stringify(event)).not.toContain("Maria Souza");
    expect(parseDFD(document.content).values["identificacao.responsavel"]).toBe("Maria Souza");
    expect(parseDFD(document.content).values["identificacao.unidade"]).toBe("Secretaria de Educação");
    const write = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls.at(-1)![1];
    expect(write.operation).toBe("dfd_context_reconcile");
    expect(procDb.getGeneratedDocumentByKind).toHaveBeenCalledWith(PID, ORG, "dfd");
    expect(vi.mocked(ctxSvc.resolveProcurementContext).mock.calls.at(-1)![0]).toMatchObject({ organizationId: ORG, processId: PID });
  });
});

/** Fixture "já existente": a criação do DFD não conta — os testes afirmam o que ESTA operação escreve (ou não). */
async function settledDFD() {
  const row = await createdDFD();
  vi.mocked(procDb.applyDraftContentMutationTx).mockClear();
  vi.mocked(procDb.recordProcessEvent).mockClear();
  vi.mocked(idem.checkIdempotency).mockClear();
  return row;
}

describe("SEM-058 — SUGESTÃO supervisionada de IA da justificativa (nada é gravado sem aceite humano)", () => {
  it("via AIExecutionEngine, contexto governado; devolve sugestão + texto atual + origem + explicabilidade e NÃO grava o DFD", async () => {
    const row = await settledDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    const r = await generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(row.content), idempotencyKey: "ai-1" });
    const call = vi.mocked(engine.executeCognitiveTask).mock.calls[0][0];
    expect(call).toMatchObject({ task: "GENERATE_DOCUMENT", tenantId: ORG, businessDomain: "processo_licitatorio", stage: "DFD", responseType: "text", actorUserId: 5 });
    expect(call.idempotencyKey).toBe("dfdj:ai-1");
    expect(call.query).not.toMatch(/R\$|450|Servidora/); // sem preços nem nome de pessoa
    expect(r.suggestion.text).toContain("necessita do mobiliário para o funcionamento das salas de aula");
    expect(r.suggestion.textHash).toBe(suggestionTextHash(r.suggestion.text));
    expect(r.current).toMatchObject({ origin: "empty", text: null, contentHash: draftContentHash(row.content) });
    expect(r.explanation).toMatchObject({ executionId: "exec-abc", provider: "mock", model: "mock-1", promptVersion: "dfd-justificativa/1", actorUserId: 5, correlationId: "corr-1" });
    expect(r.explanation.contextDigest).toBe(ctxWith().digest.slice(0, 16));
    // ZERO escrita no documento: nem mutação, nem ledger de edição, nem vínculo de proveniência a artefato.
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
    expect(prov.linkProvenanceArtifact).not.toHaveBeenCalled();
    // Só a timeline "sugestão gerada, não aceita" (ator humano, âncora do aceite posterior).
    const ev = vi.mocked(procDb.recordProcessEvent).mock.calls.map((c) => c[0]);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ eventType: "recommendation", actor: "5", refId: "exec-abc", correlationId: "corr-1" });
    expect(parseSuggestionEventHash(ev[0].summary)).toBe(r.suggestion.textHash);
    expect(ev[0].summary).toContain("NÃO aceita");
    expect(ev[0].summary).not.toContain("necessita do mobiliário"); // sem conteúdo na timeline
  });

  it("texto escrito por humano / importado: a geração NÃO exige confirmação, NÃO altera o texto e mostra a origem", async () => {
    const row = await settledDFD();
    const human = { ...row, content: row.content.replace(/Descrever a necessidade pública[\s\S]*?\[preencher\]/, "Texto escrito pelo servidor."), sources: ["edicao_manual", ...row.sources.slice(1)] };
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(human as any);
    const r = await generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(human.content), idempotencyKey: "ai-2" });
    expect(r.current).toMatchObject({ origin: "human_edited", text: "Texto escrito pelo servidor." });
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
    // importado: último registro do ledger = import_promote com o hash do conteúdo vigente
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue({ operation: "import_promote", actorUserId: 4, newContentHash: draftContentHash(human.content), createdAt: "" } as any);
    const imp = await generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(human.content), idempotencyKey: "ai-2b" });
    expect(imp.current.origin).toBe("imported");
    expect(imp.current.originLabel).toContain("importado");
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
  });

  it("rascunho mudou (hash) → CONFLICT sem chamar a IA; DFD aprovado → recusa", async () => {
    const row = await settledDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    await expect(generateDFDJustificationDraft({ ...base, expectedContentHash: "stale", idempotencyKey: "ai-4" })).rejects.toMatchObject({ code: "CONFLICT" });
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ ...row, status: "aprovado" } as any);
    await expect(generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(row.content), idempotencyKey: "ai-5" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(engine.executeCognitiveTask).not.toHaveBeenCalled();
  });

  it("cognição real sem proveniência registrada → fail-closed (nenhuma sugestão/evento persistido)", async () => {
    const row = await settledDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    vi.mocked(prov.listProvenanceByCorrelation).mockResolvedValue([]);
    await expect(generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(row.content), idempotencyKey: "ai-6" }))
      .rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(procDb.recordProcessEvent).not.toHaveBeenCalled();
    expect(idem.saveIdempotencyResult).not.toHaveBeenCalledWith("ai-6", expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it("replay (mesma chave concluída) devolve a sugestão cacheada SEM nova chamada de IA", async () => {
    const row = await settledDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    vi.mocked(idem.checkIdempotency).mockResolvedValue({ status: "completed", payloadMismatch: false, response: { suggestion: { text: "T", textHash: "h" }, current: { origin: "empty" }, explanation: { executionId: "exec-old" } } } as any);
    const r = await generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(row.content), idempotencyKey: "ai-7" });
    expect(r.replayed).toBe(true);
    expect(r.explanation.executionId).toBe("exec-old");
    expect(engine.executeCognitiveTask).not.toHaveBeenCalled();
    expect(procDb.recordProcessEvent).not.toHaveBeenCalled();
  });

  it("número não confirmado pelo processo vira [REVISAR: …] (IA não inventa quantidade/prazo/valor)", async () => {
    const row = await settledDFD();
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(row as any);
    vi.mocked(engine.executeCognitiveTask).mockResolvedValue({ response: { content: "Serão adquiridas 75 cadeiras em 90 dias.", provider: "mock", model: "m" }, context: { id: "e2" } } as any);
    const { suggestion, explanation } = await generateDFDJustificationDraft({ ...base, expectedContentHash: draftContentHash(row.content), idempotencyKey: "ai-8" });
    expect(suggestion.text).toContain("Serão adquiridas [REVISAR: 75] cadeiras em [REVISAR: 90] dias.");
    expect(explanation.unverifiedNumbers).toEqual(["75", "90"]);
  });
});

describe("SEM-058 — ACEITE humano da sugestão (único caminho que grava o texto da IA)", () => {
  const SUG = "A Secretaria de Educação necessita do mobiliário para o funcionamento das salas de aula.";
  const anchorEvent = (over: Partial<{ actor: string; correlationId: string; summary: string }> = {}) => [{
    id: "evt1", actor: "9", correlationId: "corr-gen", summary: suggestionEventSummary("exec-abc", suggestionTextHash(SUG)), ...over,
  }];
  const acceptArgs = (row: { content: string }, extra: Record<string, unknown> = {}) => ({
    ...base, expectedContentHash: draftContentHash(row.content), text: SUG, suggestionExecutionId: "exec-abc", idempotencyKey: "acc-1", ...extra,
  });
  async function importedRow() {
    const row = await settledDFD();
    const content = row.content.replace(/Descrever a necessidade pública[\s\S]*?\[preencher\]/, "Texto importado do ofício da Secretaria.");
    const imported = { ...row, content, sources: ["origem:import", ...row.sources.slice(1)] };
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(imported as any);
    vi.mocked(procDb.getLatestDraftEdit).mockResolvedValue({ operation: "import_promote", actorUserId: 4, newContentHash: draftContentHash(content), createdAt: "" } as any);
    vi.mocked(procDb.listProcessEventsByRef).mockResolvedValue(anchorEvent() as any);
    return imported;
  }

  it("aceita como está: texto vigente SUBSTITUÍDO só aqui; ledger dfd_ai_accept com linhagem (origem anterior = importado, ator da sugestão); ator = o humano", async () => {
    const row = await importedRow();
    const r = await acceptDFDJustificationSuggestion(acceptArgs(row) as any);
    expect(r).toMatchObject({ edited: false, previousOrigin: "imported", replayed: false });
    expect(r.document.content).toContain(SUG);
    expect(r.document.content).not.toContain("Texto importado do ofício");
    expect(readMarkers(r.document.sources).ai.justificativa).toMatchObject({ executionId: "exec-abc" }); // linhagem da IA preservada
    const write = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls.at(-1)![1] as any;
    expect(write.operation).toBe("dfd_ai_accept");
    expect(write.actorUserId).toBe(5);
    expect(write.expectedState).toEqual({ type: "present", contentHash: draftContentHash(row.content) });
    expect(JSON.parse(write.reason)).toMatchObject({ kind: "ai_suggestion_accepted", source: "ai_suggestion", executionId: "exec-abc", edited: false, previousOrigin: "imported", suggestionActor: "9" });
    // proveniência cognitiva (da correlação da GERAÇÃO) vinculada ao DFD na mesma transação
    expect(prov.linkProvenanceArtifact).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ organizationId: ORG, correlationId: "corr-gen", artifactKind: "dfd" }));
    // timeline: ator humano (nunca copiloto)
    const ev = vi.mocked(procDb.recordProcessEvent).mock.calls.map((c) => c[0]);
    expect(ev.at(-1)).toMatchObject({ eventType: "change", actor: "5" });
    expect(ev.at(-1)!.summary).toContain("importado");
    expect(engine.executeCognitiveTask).not.toHaveBeenCalled(); // aceite não chama IA
  });

  it("aceite com texto EDITADO: vira texto humano (sem marcador de IA) e registra edited=true", async () => {
    const row = await importedRow();
    const r = await acceptDFDJustificationSuggestion(acceptArgs(row, { text: `${SUG} Ajustado pelo servidor.` }) as any);
    expect(r.edited).toBe(true);
    expect(readMarkers(r.document.sources).ai.justificativa).toBeUndefined();
    expect(JSON.parse((vi.mocked(procDb.applyDraftContentMutationTx).mock.calls.at(-1)![1] as any).reason).edited).toBe(true);
  });

  it("sugestão inexistente NESTE órgão/processo (inclusive de outro tenant) ⇒ NOT_FOUND, zero escrita; busca escopada por (processo, órgão)", async () => {
    const row = await importedRow();
    vi.mocked(procDb.listProcessEventsByRef).mockResolvedValue([]);
    await expect(acceptDFDJustificationSuggestion(acceptArgs(row) as any)).rejects.toMatchObject({ code: "NOT_FOUND", message: expect.stringContaining("SUGGESTION_NOT_FOUND") });
    expect(procDb.listProcessEventsByRef).toHaveBeenCalledWith(PID, ORG, "recommendation", "exec-abc");
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
    expect(prov.linkProvenanceArtifact).not.toHaveBeenCalled();
    // evento sem a assinatura de sugestão (ex.: outra recomendação com o mesmo ref) também não vale
    vi.mocked(procDb.listProcessEventsByRef).mockResolvedValue(anchorEvent({ summary: "outra recomendação" }) as any);
    await expect(acceptDFDJustificationSuggestion(acceptArgs(row) as any)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("conteúdo mudou desde a comparação ⇒ CONFLICT; DFD aprovado ⇒ recusa; texto vazio ⇒ BAD_REQUEST — tudo sem escrita", async () => {
    const row = await importedRow();
    await expect(acceptDFDJustificationSuggestion(acceptArgs(row, { expectedContentHash: "stale" }) as any)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(acceptDFDJustificationSuggestion(acceptArgs(row, { text: "   " }) as any)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue({ ...row, status: "aprovado" } as any);
    await expect(acceptDFDJustificationSuggestion(acceptArgs(row) as any)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("DFD_APPROVED") });
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
  });

  it("execução real sem proveniência registrada ⇒ fail-closed (SUGGESTION_PROVENANCE_MISSING), sem escrita", async () => {
    const row = await importedRow();
    vi.mocked(prov.listProvenanceByCorrelation).mockResolvedValue([]);
    await expect(acceptDFDJustificationSuggestion(acceptArgs(row) as any)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("SUGGESTION_PROVENANCE_MISSING") });
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
  });

  it("replay idempotente (chave concluída): devolve o snapshot sem nova escrita nem novo vínculo", async () => {
    const row = await importedRow();
    vi.mocked(idem.checkIdempotency).mockResolvedValue({ status: "completed", payloadMismatch: false, response: { ...row, content: "snapshot" } } as any);
    const r = await acceptDFDJustificationSuggestion(acceptArgs(row) as any);
    expect(r.replayed).toBe(true);
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
    expect(prov.linkProvenanceArtifact).not.toHaveBeenCalled();
    // chave reutilizada com conteúdo diferente ⇒ CONFLICT
    vi.mocked(idem.checkIdempotency).mockResolvedValue({ status: "completed", payloadMismatch: true } as any);
    await expect(acceptDFDJustificationSuggestion(acceptArgs(row) as any)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

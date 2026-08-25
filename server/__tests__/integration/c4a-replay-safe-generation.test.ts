/**
 * C.4A — Replay-Safe Canonical Document Generation (UNITÁRIO, sem MySQL).
 *
 * Cobre o CONTRATO de replay-safety da geração documental canônica (DFD/ETP/TR/Edital) no
 * `procurementProcessService`, isolando a orquestração `runReplaySafeGeneration` das dependências:
 *   - `checkIdempotency` é controlado por teste (estados new/processing/completed/failed);
 *   - a persistência (db/procurement, documentEngine) e a cognição (orchestrateMultiCopilot) são espiões.
 * Verifica:
 *   - completed + mesmo payload  → resposta cacheada, SEM reexecutar cognição/persistência (replay);
 *   - completed + payload difere  → CONFLICT (nunca sobrescreve efeito com dados diferentes);
 *   - processing (em voo)         → CONFLICT;
 *   - new / failed                → executa; commit documental + save da idempotência na MESMA transação;
 *   - hash determinístico (independe da ordem das coleções; sensível a campos lógicos);
 *   - correspondência de linhagem determinística (org+processId+kind → generated id → lineage id).
 *
 * A concorrência real, o STRICT_TRANS_TABLES e o rollback físico têm cobertura no smoke MySQL C.4A.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Ordem de efeitos observada dentro da transação (prova de atomicidade commit+idempotência).
const effectOrder: string[] = [];
const fakeTx = { __tx: true };

vi.mock("../../services/kernelAccessService", () => ({
  assertKernelAccess: vi.fn(),
}));

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx),
  })),
}));

vi.mock("../../db/procurement", () => ({
  insertGeneratedDocument: vi.fn(async () => { effectOrder.push("generated"); }),
  recordProcessEvent: vi.fn(async () => { effectOrder.push("event"); }),
  listIntelligentItems: vi.fn(async () => []),
}));

vi.mock("../../services/documentEngineService", () => ({
  generateOfficialDocument: vi.fn(async () => { effectOrder.push("official"); return { id: "off-1", version: 1 }; }),
}));

vi.mock("../../services/workspaceOrchestratorService", () => ({
  orchestrateMultiCopilot: vi.fn(async () => {
    effectOrder.push("cognition");
    return {
      selectedCopilots: ["planejamento"],
      consolidated: { summary: "resumo", suggestions: ["s1"], legalBasis: ["art. 18"] },
    };
  }),
}));

// checkIdempotency controlado por teste; save/fail são espiões (registram ordem/tx).
const checkIdempotency = vi.fn();
const saveIdempotencyResult = vi.fn(async () => { effectOrder.push("idempotency-save"); });
const failIdempotencyKey = vi.fn(async () => { effectOrder.push("idempotency-fail"); });
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: (...a: unknown[]) => checkIdempotency(...a),
  saveIdempotencyResult: (...a: unknown[]) => saveIdempotencyResult(...a),
  failIdempotencyKey: (...a: unknown[]) => failIdempotencyKey(...a),
}));

import {
  generateDocument,
  generateNotice,
  generatePayloadHash,
  canonicalDocumentIdentity,
} from "../../services/procurementProcessService";
import * as procDb from "../../db/procurement";
import * as docEngine from "../../services/documentEngineService";
import * as orchestrator from "../../services/workspaceOrchestratorService";

const ORG = 42;
const PID = "proc-2026-0007";

beforeEach(() => {
  vi.clearAllMocks();
  effectOrder.length = 0;
});

describe("C.4A — generatePayloadHash (determinístico)", () => {
  it("mesmo pedido lógico → mesmo hash", () => {
    const a = generatePayloadHash({ organizationId: ORG, processId: PID, kind: "etp", object: "Material" });
    const b = generatePayloadHash({ organizationId: ORG, processId: PID, kind: "etp", object: "Material" });
    expect(a).toBe(b);
  });

  it("independe da ORDEM dos itens aprovados (coleção ordenada internamente)", () => {
    const a = generatePayloadHash({ organizationId: ORG, processId: PID, kind: "tr", object: "X", approvedItemIds: ["i3", "i1", "i2"] });
    const b = generatePayloadHash({ organizationId: ORG, processId: PID, kind: "tr", object: "X", approvedItemIds: ["i1", "i2", "i3"] });
    expect(a).toBe(b);
  });

  it("muda quando um campo lógico muda (objeto, kind, itens, modalidade/forma/plataforma)", () => {
    const base = generatePayloadHash({ organizationId: ORG, processId: PID, kind: "edital", object: "X", modality: "pregao", form: "eletronico", platform: "compras_gov" });
    expect(generatePayloadHash({ organizationId: ORG, processId: PID, kind: "edital", object: "Y", modality: "pregao", form: "eletronico", platform: "compras_gov" })).not.toBe(base);
    expect(generatePayloadHash({ organizationId: ORG, processId: PID, kind: "etp", object: "X", modality: "pregao", form: "eletronico", platform: "compras_gov" })).not.toBe(base);
    expect(generatePayloadHash({ organizationId: ORG, processId: PID, kind: "edital", object: "X", modality: "concorrencia", form: "eletronico", platform: "compras_gov" })).not.toBe(base);
    expect(generatePayloadHash({ organizationId: ORG, processId: PID, kind: "edital", object: "X", modality: "pregao", form: "presencial", platform: null })).not.toBe(base);
    expect(generatePayloadHash({ organizationId: ORG, processId: PID, kind: "edital", object: "X", modality: "pregao", form: "eletronico", platform: "bll" })).not.toBe(base);
  });

  it("isola por tenant e por processo", () => {
    const base = generatePayloadHash({ organizationId: ORG, processId: PID, kind: "etp", object: "X" });
    expect(generatePayloadHash({ organizationId: ORG + 1, processId: PID, kind: "etp", object: "X" })).not.toBe(base);
    expect(generatePayloadHash({ organizationId: ORG, processId: "outro", kind: "etp", object: "X" })).not.toBe(base);
  });
});

describe("C.4A — canonicalDocumentIdentity (linhagem determinística)", () => {
  it("mesma (org, processId, kind) → mesma identidade (generated + lineage)", () => {
    const a = canonicalDocumentIdentity({ organizationId: ORG, processId: PID, kind: "tr" });
    const b = canonicalDocumentIdentity({ organizationId: ORG, processId: PID, kind: "tr" });
    expect(a).toEqual(b);
    expect(a.generatedId).toHaveLength(20);
    expect(a.lineageId).toHaveLength(20);
    expect(a.generatedId).not.toBe(a.lineageId);
  });

  it("kind/processo/tenant distintos → identidades distintas", () => {
    const base = canonicalDocumentIdentity({ organizationId: ORG, processId: PID, kind: "tr" });
    expect(canonicalDocumentIdentity({ organizationId: ORG, processId: PID, kind: "etp" })).not.toEqual(base);
    expect(canonicalDocumentIdentity({ organizationId: ORG, processId: "outro", kind: "tr" })).not.toEqual(base);
    expect(canonicalDocumentIdentity({ organizationId: ORG + 1, processId: PID, kind: "tr" })).not.toEqual(base);
  });
});

describe("C.4A — replay-safe semantics (generateDocument, ETP/TR)", () => {
  const call = () => generateDocument({
    organizationId: ORG, processId: PID, kind: "etp", object: "Material de escritório",
    correlationId: "corr-1", idempotencyKey: "key-1", actorUserId: 7,
  });

  it("status new → executa cognição, comita documental e salva idempotência na MESMA transação", async () => {
    checkIdempotency.mockResolvedValue({ status: "new" });
    const { document, replayed } = await call();

    expect(replayed).toBe(false);
    expect(document.kind).toBe("etp");
    // Cognição fora da transação, ANTES da persistência; save da idempotência POR ÚLTIMO, junto do commit.
    expect(effectOrder).toEqual(["cognition", "generated", "official", "event", "idempotency-save"]);
    // Persistência recebe o MESMO executor (transação externa) — commit atômico.
    expect(vi.mocked(procDb.insertGeneratedDocument).mock.calls[0][1]).toBe(fakeTx);
    expect(vi.mocked(procDb.recordProcessEvent).mock.calls[0][1]).toBe(fakeTx);
    expect(vi.mocked(docEngine.generateOfficialDocument).mock.calls[0][1]).toBe(fakeTx);
    expect(saveIdempotencyResult.mock.calls[0][4]).toBe(fakeTx);
    expect(failIdempotencyKey).not.toHaveBeenCalled();
  });

  it("status completed + mesmo payload → replay cacheado, SEM reexecutar cognição nem persistir", async () => {
    const cached = { id: "gdoc-x", kind: "etp", title: "ETP — Material de escritório", content: "cacheado" };
    checkIdempotency.mockResolvedValue({ status: "completed", payloadMismatch: false, response: cached });

    const { document, replayed } = await call();
    expect(replayed).toBe(true);
    expect(document).toEqual(cached);
    expect(orchestrator.orchestrateMultiCopilot).not.toHaveBeenCalled();
    expect(procDb.insertGeneratedDocument).not.toHaveBeenCalled();
    expect(docEngine.generateOfficialDocument).not.toHaveBeenCalled();
    expect(saveIdempotencyResult).not.toHaveBeenCalled();
    expect(effectOrder).toEqual([]);
  });

  it("status completed + payload diferente → CONFLICT (nunca sobrescreve)", async () => {
    checkIdempotency.mockResolvedValue({ status: "completed", payloadMismatch: true, response: null });
    await expect(call()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(orchestrator.orchestrateMultiCopilot).not.toHaveBeenCalled();
    expect(procDb.insertGeneratedDocument).not.toHaveBeenCalled();
  });

  it("status processing (em voo) → CONFLICT, sem cognição nem persistência", async () => {
    checkIdempotency.mockResolvedValue({ status: "processing" });
    await expect(call()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(orchestrator.orchestrateMultiCopilot).not.toHaveBeenCalled();
    expect(procDb.insertGeneratedDocument).not.toHaveBeenCalled();
  });

  it("status failed → executa novamente (retry permitido após falha anterior)", async () => {
    checkIdempotency.mockResolvedValue({ status: "failed" });
    const { replayed } = await call();
    expect(replayed).toBe(false);
    expect(orchestrator.orchestrateMultiCopilot).toHaveBeenCalledTimes(1);
    expect(procDb.insertGeneratedDocument).toHaveBeenCalledTimes(1);
  });

  it("erro na persistência → marca a chave como failed (retry futuro) e propaga o erro", async () => {
    checkIdempotency.mockResolvedValue({ status: "new" });
    vi.mocked(procDb.insertGeneratedDocument).mockRejectedValueOnce(new Error("db down"));
    await expect(call()).rejects.toThrow(/db down/);
    expect(failIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(saveIdempotencyResult).not.toHaveBeenCalled();
  });
});

describe("C.4A — generateNotice (Edital)", () => {
  const valid = () => generateNotice({
    organizationId: ORG, processId: PID, object: "Registro de preços",
    modality: "pregao", form: "eletronico", platform: "compras_gov",
    correlationId: "corr-1", idempotencyKey: "key-edital", actorUserId: 7,
  });

  it("edital válido + status new → comita documental e salva idempotência atomicamente", async () => {
    checkIdempotency.mockResolvedValue({ status: "new" });
    const res = await valid();
    expect(res.validation.valid).toBe(true);
    expect(res.replayed).toBe(false);
    expect(effectOrder).toEqual(["generated", "official", "event", "idempotency-save"]);
    expect(saveIdempotencyResult.mock.calls[0][4]).toBe(fakeTx);
  });

  it("edital válido + completed → replay cacheado sem novos efeitos", async () => {
    const cached = { document: { id: "ed-1", kind: "edital", title: "Edital — X", content: "c" }, validation: { valid: true, violations: [] } };
    checkIdempotency.mockResolvedValue({ status: "completed", payloadMismatch: false, response: cached });
    const res = await valid();
    expect(res.replayed).toBe(true);
    expect(res.document).toEqual(cached.document);
    expect(effectOrder).toEqual([]);
    expect(saveIdempotencyResult).not.toHaveBeenCalled();
  });

  it("edital INVÁLIDO → nenhum efeito e NENHUMA reserva de idempotência (determinístico, retry livre)", async () => {
    // Eletrônico sem plataforma → inválido; não deve nem chamar checkIdempotency.
    const res = await generateNotice({
      organizationId: ORG, processId: PID, object: "X",
      modality: "pregao", form: "eletronico", platform: undefined,
      correlationId: "corr-1", idempotencyKey: "key-edital-invalid", actorUserId: 7,
    });
    expect(res.validation.valid).toBe(false);
    expect(res.replayed).toBe(false);
    expect(checkIdempotency).not.toHaveBeenCalled();
    expect(effectOrder).toEqual([]);
  });
});

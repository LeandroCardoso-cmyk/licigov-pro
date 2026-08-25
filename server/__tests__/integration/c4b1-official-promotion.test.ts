/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.4B.1 — Emissão oficial governada (UNITÁRIO, sem MySQL).
 *
 * Exercita o CONTRATO de promoção (rascunho → official `emitido`) isolando as dependências de
 * persistência/idempotência, mas usando a GOVERNANÇA REAL (assertInstitutionalDecisionRules +
 * orgRoleMeets — puras). Verifica:
 *   - segregação de deveres (autor não emite), ator humano obrigatório, papel mínimo (manager);
 *   - emissão válida cria UMA versão `emitido`; commit atômico (ledger + idempotency-save no mesmo tx);
 *   - replay (mesma chave+conteúdo) → cacheado, sem nova versão; chave+conteúdo diferente → CONFLICT;
 *   - processing → CONFLICT; failed → reexecuta; concorrência otimista (expectedContentHash);
 *   - hash determinístico; DFD fora do escopo.
 * A concorrência real, o rollback e a imutabilidade têm cobertura no smoke MySQL C.4B.1.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const effectOrder: string[] = [];
const fakeTx = { __tx: true };

// createDocument (lifecycle) espião: devolve uma versão oficial fake e registra o status recebido.
const createDocument = vi.fn(async (params: { status?: string }, _executor?: unknown) => {
  effectOrder.push("official");
  return { id: "off-emit-1", version: 2, status: params.status ?? "gerado", lineageId: "lin-1" };
});
vi.mock("../../services/officialDocumentLifecycleService", () => ({
  createDocument: (...a: unknown[]) => createDocument(a[0] as any, a[1]),
}));

const getGeneratedDocumentByKind = vi.fn();
vi.mock("../../db/procurement", () => ({
  getGeneratedDocumentByKind: (...a: unknown[]) => getGeneratedDocumentByKind(...a),
}));

const insertOfficialPromotion = vi.fn(async () => { effectOrder.push("ledger"); });
const getLatestOfficialPromotion = vi.fn(async () => null);
vi.mock("../../db/officialDocumentPromotions", () => ({
  insertOfficialPromotion: (...a: unknown[]) => insertOfficialPromotion(...a),
  getLatestOfficialPromotion: (...a: unknown[]) => getLatestOfficialPromotion(...a),
}));

const checkIdempotency = vi.fn();
const saveIdempotencyResult = vi.fn(async () => { effectOrder.push("idempotency-save"); });
const failIdempotencyKey = vi.fn(async () => { effectOrder.push("idempotency-fail"); });
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: (...a: unknown[]) => checkIdempotency(...a),
  saveIdempotencyResult: (...a: unknown[]) => saveIdempotencyResult(...a),
  failIdempotencyKey: (...a: unknown[]) => failIdempotencyKey(...a),
}));

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({ transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx) })),
}));

import { promoteOfficialDocument, draftContentHash } from "../../services/documentPromotionService";

const ORG = 77;
const PID = "proc-c4b1-1";
const DRAFT = { id: "gdoc-1", kind: "etp", title: "ETP — X", content: "conteúdo do rascunho ETP", status: "rascunho", authorUserId: 5, updatedAt: "2026-08-25T00:00:00.000Z" };

function base(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG, processId: PID, kind: "etp" as const,
    actorUserId: 7, actorRole: "manager" as const,
    idempotencyKey: "emit-key-1", correlationId: "corr-1",
    expectedContentHash: draftContentHash(DRAFT.content), // C.4B.1 — hash obrigatório da versão revisada
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  effectOrder.length = 0;
  getGeneratedDocumentByKind.mockResolvedValue({ ...DRAFT });
  checkIdempotency.mockResolvedValue({ status: "new" });
});

describe("C.4B.1 — draftContentHash (determinístico)", () => {
  it("mesmo conteúdo → mesmo hash; conteúdo diferente → hash diferente", () => {
    expect(draftContentHash("abc")).toBe(draftContentHash("abc"));
    expect(draftContentHash("abc")).not.toBe(draftContentHash("abcd"));
    expect(draftContentHash("abc")).toHaveLength(64);
  });
});

describe("C.4B.1 — governança humana / SoD / RBAC", () => {
  it("autor NÃO pode emitir o próprio documento (segregação de deveres)", async () => {
    await expect(promoteOfficialDocument(base({ actorUserId: 5 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createDocument).not.toHaveBeenCalled();
    expect(insertOfficialPromotion).not.toHaveBeenCalled();
    expect(failIdempotencyKey).toHaveBeenCalledTimes(1); // sem efeito parcial; retry permitido
  });

  it("ator não humano (id <= 0) é recusado (IA/sistema não emite)", async () => {
    await expect(promoteOfficialDocument(base({ actorUserId: 0 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("papel insuficiente (operator) é recusado — exige manager", async () => {
    await expect(promoteOfficialDocument(base({ actorRole: "operator" }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createDocument).not.toHaveBeenCalled();
  });
});

describe("C.4B.1 — emissão válida (commit atômico)", () => {
  it("cria UMA versão emitida; ledger + idempotency-save no MESMO tx; status 'emitido'", async () => {
    const res = await promoteOfficialDocument(base());
    expect(res.promoted).toBe(true);
    expect(res.replayed).toBe(false);
    expect(res.officialDocument.status).toBe("emitido");
    expect(res.officialDocument.contentHash).toBe(draftContentHash(DRAFT.content));
    // Ordem: versão oficial → ledger imutável → save da idempotência (tudo na mesma transação).
    expect(effectOrder).toEqual(["official", "ledger", "idempotency-save"]);
    // createDocument recebe status 'emitido' e o executor (tx externa).
    expect(createDocument.mock.calls[0][0].status).toBe("emitido");
    expect(createDocument.mock.calls[0][1]).toBe(fakeTx);
    expect(insertOfficialPromotion.mock.calls[0][1]).toBe(fakeTx);
    expect(saveIdempotencyResult.mock.calls[0][4]).toBe(fakeTx);
    expect(failIdempotencyKey).not.toHaveBeenCalled();
  });
});

describe("C.4B.1 — replay-safe semantics", () => {
  it("completed + mesmo payload → replay cacheado, sem nova versão", async () => {
    const cached = { officialDocument: { id: "off-emit-1", version: 2, status: "emitido", lineageId: "lin-1", contentHash: draftContentHash(DRAFT.content) } };
    checkIdempotency.mockResolvedValue({ status: "completed", payloadMismatch: false, response: cached });
    const res = await promoteOfficialDocument(base());
    expect(res.replayed).toBe(true);
    expect(res.promoted).toBe(false);
    expect(res.officialDocument).toEqual(cached.officialDocument);
    expect(createDocument).not.toHaveBeenCalled();
    expect(insertOfficialPromotion).not.toHaveBeenCalled();
    expect(effectOrder).toEqual([]);
  });

  it("completed + payload diferente → CONFLICT", async () => {
    checkIdempotency.mockResolvedValue({ status: "completed", payloadMismatch: true, response: null });
    await expect(promoteOfficialDocument(base())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("processing → CONFLICT", async () => {
    checkIdempotency.mockResolvedValue({ status: "processing" });
    await expect(promoteOfficialDocument(base())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("failed → reexecuta (retry após falha anterior)", async () => {
    checkIdempotency.mockResolvedValue({ status: "failed" });
    const res = await promoteOfficialDocument(base());
    expect(res.promoted).toBe(true);
    expect(createDocument).toHaveBeenCalledTimes(1);
  });

  it("erro na persistência → marca a chave failed e propaga", async () => {
    insertOfficialPromotion.mockRejectedValueOnce(new Error("db down"));
    await expect(promoteOfficialDocument(base())).rejects.toThrow(/db down/);
    expect(failIdempotencyKey).toHaveBeenCalledTimes(1);
  });
});

describe("C.4B.1 — integridade / escopo", () => {
  it("expectedContentHash divergente → CONFLICT (rascunho mudou desde a revisão), sem idempotência", async () => {
    await expect(promoteOfficialDocument(base({ expectedContentHash: "hash-antigo" }))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(checkIdempotency).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("rascunho inexistente/vazio → NOT_FOUND", async () => {
    getGeneratedDocumentByKind.mockResolvedValue(null);
    await expect(promoteOfficialDocument(base())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(checkIdempotency).not.toHaveBeenCalled();
  });

  it("DFD está fora do escopo de emissão (BAD_REQUEST)", async () => {
    await expect(promoteOfficialDocument(base({ kind: "dfd" as never }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(getGeneratedDocumentByKind).not.toHaveBeenCalled();
  });
});

describe("C.4B.1 — hardening de governança (fail-closed)", () => {
  it("expectedContentHash AUSENTE → PRECONDITION_FAILED (confirmação obrigatória)", async () => {
    await expect(promoteOfficialDocument(base({ expectedContentHash: "" }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(getGeneratedDocumentByKind).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("expectedContentHash correto → emite; divergente → CONFLICT (concorrência otimista)", async () => {
    checkIdempotency.mockResolvedValue({ status: "new" });
    const ok = await promoteOfficialDocument(base({ expectedContentHash: draftContentHash(DRAFT.content) }));
    expect(ok.promoted).toBe(true);
    vi.clearAllMocks(); effectOrder.length = 0;
    getGeneratedDocumentByKind.mockResolvedValue({ ...DRAFT });
    await expect(promoteOfficialDocument(base({ expectedContentHash: "outro-hash" }))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("autoria desconhecida (authorUserId null) → PRECONDITION_FAILED, nenhuma versão emitida", async () => {
    getGeneratedDocumentByKind.mockResolvedValue({ ...DRAFT, authorUserId: null });
    await expect(promoteOfficialDocument(base())).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(checkIdempotency).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("sem DB (persistência indisponível) → recusa fail-closed, nunca promoted", async () => {
    const conn = await import("../../db/connection");
    (conn.getDb as any).mockResolvedValueOnce(null);
    checkIdempotency.mockResolvedValue({ status: "new" });
    await expect(promoteOfficialDocument(base())).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(createDocument).not.toHaveBeenCalled();
    expect(failIdempotencyKey).toHaveBeenCalledTimes(1); // sem efeito; chave liberada para retry
  });
});

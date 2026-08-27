/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.4B.3A — SoD ESTENDIDA da emissão oficial (UNITÁRIO, sem MySQL).
 *
 * Fundação de proveniência: além de `emitter ≠ originador` (author, C.4B.1), o ÚLTIMO ator substantivo
 * do rascunho (quem fez a última alteração material) também NÃO pode emitir. Fail-closed, sem bypass.
 * Usa a governança REAL (assertInstitutionalDecisionRules + orgRoleMeets); persistência/idempotência
 * são espiões. A concorrência real/ledger/rollback têm cobertura no smoke MySQL C.4B.3A.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fakeTx = { __tx: true };

const createDocument = vi.fn(async (params: { status?: string; metadata?: any }, _e?: unknown) => ({
  id: "off-1", version: 1, status: params.status ?? "emitido", lineageId: "lin-1", __meta: params.metadata,
}));
vi.mock("../../services/officialDocumentLifecycleService", () => ({
  createDocument: (...a: unknown[]) => createDocument(a[0] as any, a[1]),
}));

const getGeneratedDocumentByKind = vi.fn();
vi.mock("../../db/procurement", () => ({
  getGeneratedDocumentByKind: (...a: unknown[]) => getGeneratedDocumentByKind(...a),
}));

const insertOfficialPromotion = vi.fn(async () => undefined);
const getLatestOfficialPromotion = vi.fn(async () => null);
vi.mock("../../db/officialDocumentPromotions", () => ({
  insertOfficialPromotion: (...a: unknown[]) => insertOfficialPromotion(...a),
  getLatestOfficialPromotion: (...a: unknown[]) => getLatestOfficialPromotion(...a),
}));

const checkIdempotency = vi.fn();
const saveIdempotencyResult = vi.fn(async () => undefined);
const failIdempotencyKey = vi.fn(async () => undefined);
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: (...a: unknown[]) => checkIdempotency(...a),
  saveIdempotencyResult: (...a: unknown[]) => saveIdempotencyResult(...a),
  failIdempotencyKey: (...a: unknown[]) => failIdempotencyKey(...a),
}));

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({ transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx) })),
}));

import { promoteOfficialDocument, draftContentHash } from "../../services/documentPromotionService";

const ORG = 88;
const PID = "proc-c4b3a-1";
// Originador = 5; último ator substantivo (ex.: editou/regenerou depois) = 9.
const DRAFT = {
  id: "gdoc-1", kind: "etp", title: "ETP — X", content: "conteúdo do rascunho",
  status: "rascunho", authorUserId: 5, lastSubstantiveActorUserId: 9,
  updatedAt: "2026-08-27T00:00:00.000Z",
};

function base(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORG, processId: PID, kind: "etp" as const,
    actorUserId: 7, actorRole: "manager" as const,
    idempotencyKey: "emit-key", correlationId: "corr-1",
    expectedContentHash: draftContentHash(DRAFT.content),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getGeneratedDocumentByKind.mockResolvedValue({ ...DRAFT });
  checkIdempotency.mockResolvedValue({ status: "new" });
});

describe("C.4B.3A — SoD estendida (emitter ≠ originador E ≠ último ator substantivo)", () => {
  it("emitter == originador (author) → FORBIDDEN", async () => {
    await expect(promoteOfficialDocument(base({ actorUserId: 5 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createDocument).not.toHaveBeenCalled();
    expect(insertOfficialPromotion).not.toHaveBeenCalled();
  });

  it("emitter == último ator substantivo (≠ author) → FORBIDDEN", async () => {
    await expect(promoteOfficialDocument(base({ actorUserId: 9 }))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(createDocument).not.toHaveBeenCalled();
    expect(insertOfficialPromotion).not.toHaveBeenCalled();
    expect(failIdempotencyKey).toHaveBeenCalledTimes(1); // sem efeito parcial; retry permitido
  });

  it("terceiro manager (≠ originador e ≠ último ator substantivo) → emite", async () => {
    const res = await promoteOfficialDocument(base({ actorUserId: 7 }));
    expect(res.promoted).toBe(true);
    expect(createDocument).toHaveBeenCalledTimes(1);
    expect(insertOfficialPromotion).toHaveBeenCalledTimes(1);
    // Evidência aditiva: o último ator substantivo vai na metadata da versão oficial.
    expect(createDocument.mock.calls[0][0].metadata.lastSubstantiveActorUserId).toBe(9);
    expect(createDocument.mock.calls[0][0].metadata.authorUserId).toBe(5);
  });

  it("author NULL → PRECONDITION_FAILED (mesmo com último ator substantivo definido)", async () => {
    getGeneratedDocumentByKind.mockResolvedValue({ ...DRAFT, authorUserId: null, lastSubstantiveActorUserId: 9 });
    await expect(promoteOfficialDocument(base({ actorUserId: 7 }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("sem último ator substantivo (null) → regra reduz a emitter ≠ originador (emite)", async () => {
    getGeneratedDocumentByKind.mockResolvedValue({ ...DRAFT, lastSubstantiveActorUserId: null });
    const res = await promoteOfficialDocument(base({ actorUserId: 7 }));
    expect(res.promoted).toBe(true);
  });
});

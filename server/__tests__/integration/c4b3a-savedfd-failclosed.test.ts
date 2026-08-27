/**
 * C.4B.3A (Blocker 1) — saveDFDDraft é FAIL-CLOSED sem persistência.
 *
 * Write governado: sem DB não há save/ledger/proveniência/idempotência concluída — NUNCA retornar
 * sucesso simulado. Deve recusar com INTERNAL_SERVER_ERROR.
 */
import { describe, it, expect, vi } from "vitest";

// getDb → null (persistência indisponível).
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => null) }));
// checkIdempotency sem DB devolve "new" (comportamento real); save/fail são no-ops.
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn(async () => ({ status: "new" })),
  saveIdempotencyResult: vi.fn(async () => undefined),
  failIdempotencyKey: vi.fn(async () => undefined),
}));

import { saveDFDDraft } from "../../services/procurementProcessService";

describe("C.4B.3A — saveDFDDraft fail-closed (Blocker 1)", () => {
  it("sem DB → INTERNAL_SERVER_ERROR (nenhum sucesso/replayed:false fictício)", async () => {
    await expect(saveDFDDraft({
      organizationId: 1, processId: "p1", object: "obj", content: "# DFD",
      actorUserId: 3, expectedContentHash: "a".repeat(64), idempotencyKey: "k1", correlationId: "c",
    })).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

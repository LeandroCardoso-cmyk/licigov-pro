/**
 * M8 REG-B — autoemissão: a política (autor/último editor ≠ emissor, papel mínimo, ator humano) é aplicada no SERVIÇO
 * (`promoteOfficialDocument`; ver c4b1/c4b3a). Aqui, na FRONTEIRA do router: a identidade e o papel do emissor vêm SEMPRE da sessão
 * e da membership verificadas no backend — um ator/papel enviado no input (rota direta, sem botão) é descartado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/procurement");
vi.mock("../../services/documentPromotionService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/documentPromotionService")>()),
  promoteOfficialDocument: vi.fn().mockResolvedValue({ promoted: true, replayed: false }),
}));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "manager", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: 1, userId: 1, role: "manager", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("t"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import * as procDb from "../../db/procurement";
import { promoteOfficialDocument } from "../../services/documentPromotionService";
import { makeContext, mockUser } from "../helpers/fixtures";

describe("REG-B — promoteOfficial: emissor = sessão + membership (nunca o input)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(procDb.getProcess).mockResolvedValue({ id: "p1", organizationId: 1, processNumber: "1/2026", object: "X" } as never);
  });

  it("ator, papel e organização forjados no input são ignorados", async () => {
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await caller.promoteOfficial({
      processId: "p1", kind: "tr", idempotencyKey: "k", expectedContentHash: "h".repeat(64),
      // tentativa de contornar a segregação por rota direta:
      actorUserId: 4242, actorRole: "owner", organizationId: 99, authorUserId: 4242,
    } as never);
    const arg = vi.mocked(promoteOfficialDocument).mock.calls[0][0];
    expect(arg.actorUserId).toBe(mockUser.id);
    expect(arg.actorRole).toBe("manager");
    expect(arg.organizationId).toBe(1);
    expect(arg).not.toHaveProperty("authorUserId");
  });

  it("processo de outro órgão ⇒ NOT_FOUND, sem chegar ao serviço", async () => {
    vi.mocked(procDb.getProcess).mockResolvedValue(null as never);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await expect(caller.promoteOfficial({ processId: "alheio", kind: "tr", idempotencyKey: "k", expectedContentHash: "h" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(promoteOfficialDocument).not.toHaveBeenCalled();
  });

  it("sem sessão ⇒ UNAUTHORIZED", async () => {
    await expect(procurementProcessRouter.createCaller(makeContext(null)).promoteOfficial({ processId: "p1", kind: "tr", idempotencyKey: "k", expectedContentHash: "h" }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(promoteOfficialDocument).not.toHaveBeenCalled();
  });
});

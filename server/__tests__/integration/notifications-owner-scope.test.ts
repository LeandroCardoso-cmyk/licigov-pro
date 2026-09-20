/**
 * IDOR cross-user (correção) — `notifications.markAsRead` deve ser ESCOPADO POR DONO.
 *
 * Prova que o router passa o `ctx.user.id` do contexto ao marcar como lida, de forma que a
 * atualização só afeta a PRÓPRIA notificação do usuário (a camada de dados filtra por
 * `notifications.userId`), fechando o IDOR em que um usuário marcava a notificação de outro.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue(null),
  getMembership: vi.fn().mockResolvedValue(null),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("t"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));
vi.mock("../../db");

import { notificationsRouter } from "../../routers/notificationsRouter";
import * as db from "../../db";
import { makeContext, mockUser } from "../helpers/fixtures";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("notifications.markAsRead — owner-scoped", () => {
  it("passa o userId do contexto (nunca marca a notificação de outro usuário)", async () => {
    vi.mocked(db.markNotificationAsRead).mockResolvedValue(undefined as never);

    const caller = notificationsRouter.createCaller(makeContext(mockUser));
    const r = await caller.markAsRead({ notificationId: 555 });

    expect(db.markNotificationAsRead).toHaveBeenCalledWith(555, mockUser.id);
    expect(r).toEqual({ success: true });
  });

  it("exige autenticação (anônimo é rejeitado antes de qualquer escrita)", async () => {
    await expect(notificationsRouter.createCaller(makeContext(null)).markAsRead({ notificationId: 1 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(db.markNotificationAsRead).not.toHaveBeenCalled();
  });
});

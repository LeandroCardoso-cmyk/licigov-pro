/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR B.2.4 — Contrato do ingestion.promoteSession (superfície, sem DB).
 *
 * Cobre: delegação ao serviço de promoção; fail-closed da feature flag; sessão inexistente;
 * escopo canônico (processo divergente → NOT_FOUND); e RBAC institucional (papel < manager → FORBIDDEN).
 * O comportamento transacional/idempotente é coberto pelo smoke MySQL real. Serviços mockados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "manager", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
}));
vi.mock("../../services/featureFlagService", () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn().mockResolvedValue({ status: "new" }),
  saveIdempotencyResult: vi.fn().mockResolvedValue(undefined),
  failIdempotencyKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/activityLogService", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../services/fileIngestionService", () => ({
  createImportSession: vi.fn(), getImportSession: vi.fn(),
  findActiveSessionByChecksum: vi.fn().mockResolvedValue(null),
  findResumableSessionForProcess: vi.fn().mockResolvedValue(null),
  updateSessionStatus: vi.fn().mockResolvedValue(undefined),
  attachStoredFile: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/importStagingService", () => ({
  getStagingItems: vi.fn().mockResolvedValue([]), getStagingItem: vi.fn(),
  reviewStagingItem: vi.fn(), bulkReviewStagingItems: vi.fn(),
  getStagingSummary: vi.fn().mockResolvedValue({ total: 0, pending: 0, approved: 0, rejected: 0, skipped: 0 }),
  correctStagingItem: vi.fn(),
}));
vi.mock("../../services/importQueueService", () => ({ enqueueImport: vi.fn() }));
vi.mock("../../services/importPromotionService", () => ({
  promoteApprovedSessionToDomain: vi.fn(),
}));

import { ingestionRouter } from "../../routers/ingestionRouter";
import { makeContext, mockUser } from "../helpers/fixtures";
import * as ingestion from "../../services/fileIngestionService";
import * as promo from "../../services/importPromotionService";
import * as flags from "../../services/featureFlagService";
import * as tenant from "../../services/tenantService";

const caller = () => ingestionRouter.createCaller(makeContext(mockUser) as any);
const session = (over: Record<string, unknown> = {}) => ({
  id: 100, organizationId: 1, importType: "price_research", parserType: "xlsx",
  status: "approved", procurementProcessId: "P-1", ...over,
});
const input = (over: Record<string, unknown> = {}) => ({ sessionId: 100, procurementProcessId: "P-1", idempotencyKey: "promo-key-0001", ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(flags.isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(tenant.resolveTenantForUser).mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "manager", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  } as any);
});

describe("ingestion.promoteSession — contrato", () => {
  it("manager promove: delega ao serviço com org/ator corretos e retorna o resultado", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(session() as any);
    vi.mocked(promo.promoteApprovedSessionToDomain).mockResolvedValue({
      sessionId: 100, idempotent: false, targetKind: "price_research", targetRef: "r1", itemsPromoted: 3,
    });
    const r = await caller().promoteSession(input());
    expect(r).toMatchObject({ targetRef: "r1", itemsPromoted: 3, idempotent: false });
    expect(promo.promoteApprovedSessionToDomain).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 100, organizationId: 1, procurementProcessId: "P-1", actorUserId: mockUser.id, idempotencyKey: "promo-key-0001",
    }));
  });

  it("feature flag desligada → FORBIDDEN (fail-closed)", async () => {
    vi.mocked(flags.isFeatureEnabled).mockResolvedValue(false);
    await expect(caller().promoteSession(input())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("sessão inexistente → NOT_FOUND", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(null as any);
    await expect(caller().promoteSession(input())).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(promo.promoteApprovedSessionToDomain).not.toHaveBeenCalled();
  });

  it("processo canônico divergente → NOT_FOUND (não vaza existência)", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(session({ procurementProcessId: "P-1" }) as any);
    await expect(caller().promoteSession(input({ procurementProcessId: "P-2" }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(promo.promoteApprovedSessionToDomain).not.toHaveBeenCalled();
  });

  it("papel institucional abaixo de manager → FORBIDDEN (segregação de deveres)", async () => {
    vi.mocked(tenant.resolveTenantForUser).mockResolvedValue({
      organizationId: 1,
      membership: { id: 1, organizationId: 1, userId: 1, role: "operator", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
    } as any);
    await expect(caller().promoteSession(input())).rejects.toBeInstanceOf(TRPCError);
    await expect(caller().promoteSession(input())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

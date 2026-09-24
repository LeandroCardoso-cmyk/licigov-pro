/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Pesquisa de Preços — revisão por ITEM LÓGICO na superfície tRPC (sem DB real; serviços de dados mockados):
 * DTO com contadores SEPARADOS (5 itens × 30 cotações), flag fail-closed, RBAC (viewer lê, não decide; operator
 * decide), tenant SEMPRE do contexto autenticado (nunca do input), processo/tipo validados e contrato de entrada
 * (groupKey/expectedRevision — nenhum ID de cotação aceito do browser).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const role = vi.hoisted(() => ({ value: "operator" as string }));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: role.value, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
vi.mock("../../services/featureFlagService", () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("../../services/activityLogService", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../services/fileIngestionService", () => ({
  createImportSession: vi.fn(), getImportSession: vi.fn(), findActiveSessionByChecksum: vi.fn(),
  findResumableSessionForProcess: vi.fn(), updateSessionStatus: vi.fn(), attachStoredFile: vi.fn(),
}));
vi.mock("../../services/importStagingService", () => ({
  getStagingItems: vi.fn(), getStagingItem: vi.fn(), reviewStagingItem: vi.fn(), bulkReviewStagingItems: vi.fn(),
  getStagingSummary: vi.fn(), correctStagingItem: vi.fn(),
}));
vi.mock("../../services/priceResearchReviewService", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../services/priceResearchReviewService")>();
  return { ...real, reviewPriceResearchGroups: vi.fn() };
});

import { ingestionRouter } from "../../routers/ingestionRouter";
import { makeContext, mockUser } from "../helpers/fixtures";
import * as ingestion from "../../services/fileIngestionService";
import * as staging from "../../services/importStagingService";
import * as review from "../../services/priceResearchReviewService";
import * as flags from "../../services/featureFlagService";
import { buildPriceResearchReviewProjection } from "../../domain/priceResearchReviewGroups";
import { buildReviewFixtureRows } from "../fixtures/priceResearchReviewFixture";

const caller = () => ingestionRouter.createCaller(makeContext(mockUser) as any);
const session = (over: Record<string, unknown> = {}) => ({
  id: 100, organizationId: 1, importType: "price_research", status: "awaiting_review", stage: "awaiting_review",
  procurementProcessId: "PROC-1", promotionStatus: "none", ...over,
});
const rows = () => buildReviewFixtureRows().map((r) => ({ ...r, importSessionId: 100, organizationId: 1, reviewedBy: null, reviewedAt: null, reviewNote: null, correctedAt: null, correctedByUserId: null }));

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "operator";
  (flags.isFeatureEnabled as any).mockResolvedValue(true);
  (ingestion.getImportSession as any).mockResolvedValue(session());
  (staging.getStagingItems as any).mockResolvedValue(rows());
});

describe("getPriceResearchReview — DTO item-cêntrico", () => {
  it("5 itens lógicos e 30 cotações, com contadores de itens e de cotações separados", async () => {
    const r = await caller().getPriceResearchReview({ sessionId: 100, procurementProcessId: "PROC-1" });
    expect(r.counts.logicalItems).toBe(5);
    expect(r.counts.quotes).toBe(30);
    expect(r.counts.items).toEqual({ pending: 5, partially_reviewed: 0, reviewed: 0, rejected: 0 });
    expect(r.counts.quoteStatus).toEqual({ pending: 30, approved: 0, rejected: 0, skipped: 0 });
    expect(r.groups).toHaveLength(5);
    expect(r.groups.map((g) => g.quotes.length)).toEqual([7, 7, 5, 5, 6]);
    // cada cotação carrega a linha de staging original (inspeção/correção pelo drawer existente)
    expect(r.groups[0].quotes[0].stagingItem).toMatchObject({ id: 101, rawUnitPrice: "R$ 750,31", reviewStatus: "pending" });
  });

  it("tenant vem do contexto autenticado: leitura escopada por organizationId do servidor", async () => {
    await caller().getPriceResearchReview({ sessionId: 100, procurementProcessId: "PROC-1" });
    expect(ingestion.getImportSession).toHaveBeenCalledWith(100, 1);
    expect(staging.getStagingItems).toHaveBeenCalledWith(100, 1);
    // organizationId no input é ignorado (zod remove chaves desconhecidas) — não atravessa tenants
    await caller().getPriceResearchReview({ sessionId: 100, procurementProcessId: "PROC-1", organizationId: 2 } as any);
    expect(staging.getStagingItems).toHaveBeenLastCalledWith(100, 1);
  });

  it("sessão de outro tenant ⇒ NOT_FOUND; processo errado ⇒ NOT_FOUND; tipo documental ⇒ BAD_REQUEST", async () => {
    (ingestion.getImportSession as any).mockResolvedValue(null);
    await expect(caller().getPriceResearchReview({ sessionId: 100, procurementProcessId: "PROC-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    (ingestion.getImportSession as any).mockResolvedValue(session({ procurementProcessId: "OUTRO" }));
    await expect(caller().getPriceResearchReview({ sessionId: 100, procurementProcessId: "PROC-1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    (ingestion.getImportSession as any).mockResolvedValue(session({ importType: "document_tr" }));
    await expect(caller().getPriceResearchReview({ sessionId: 100, procurementProcessId: "PROC-1" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(staging.getStagingItems).not.toHaveBeenCalled();
  });

  it("flag desligada ⇒ FORBIDDEN; viewer pode LER a revisão", async () => {
    role.value = "viewer";
    await expect(caller().getPriceResearchReview({ sessionId: 100, procurementProcessId: "PROC-1" })).resolves.toBeTruthy();
    (flags.isFeatureEnabled as any).mockResolvedValue(false);
    await expect(caller().getPriceResearchReview({ sessionId: 100, procurementProcessId: "PROC-1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("reviewPriceResearchGroups — decisão por item (RBAC e contrato)", () => {
  const projection = () => buildPriceResearchReviewProjection(rows() as any);
  const req = () => {
    const g = projection().groups[0];
    return { sessionId: 100, procurementProcessId: "PROC-1", action: "approved" as const, groups: [{ groupKey: g.groupKey, expectedRevision: g.revision }] };
  };

  it("operator decide: serviço recebe tenant do contexto, ator e correlação — nunca IDs de cotação", async () => {
    const after = projection();
    (review.reviewPriceResearchGroups as any).mockResolvedValue({ action: "approved", affectedQuoteCount: 7, groups: [{ groupKey: after.groups[0].groupKey, affectedQuoteIds: [101, 102, 103, 104, 105, 106, 107] }], projection: after, rows: rows() });
    const r = await caller().reviewPriceResearchGroups(req());
    expect(r.affectedQuoteCount).toBe(7);
    expect(r.review.counts.logicalItems).toBe(5);
    const call = (review.reviewPriceResearchGroups as any).mock.calls[0][0];
    expect(call).toMatchObject({ organizationId: 1, sessionId: 100, procurementProcessId: "PROC-1", actorUserId: mockUser.id, action: "approved" });
    expect(call.groups).toEqual(req().groups);
    expect(call).not.toHaveProperty("itemIds");
  });

  it("viewer ⇒ FORBIDDEN (nada decidido)", async () => {
    role.value = "viewer";
    await expect(caller().reviewPriceResearchGroups(req())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(review.reviewPriceResearchGroups).not.toHaveBeenCalled();
  });

  it("flag desligada ⇒ FORBIDDEN", async () => {
    (flags.isFeatureEnabled as any).mockResolvedValue(false);
    await expect(caller().reviewPriceResearchGroups(req())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(review.reviewPriceResearchGroups).not.toHaveBeenCalled();
  });

  it("entrada inválida (groupKey/revisão fora do formato, lista vazia) ⇒ BAD_REQUEST antes do serviço", async () => {
    await expect(caller().reviewPriceResearchGroups({ ...req(), groups: [] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller().reviewPriceResearchGroups({ ...req(), groups: [{ groupKey: "101", expectedRevision: "x" }] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(review.reviewPriceResearchGroups).not.toHaveBeenCalled();
  });

  it("promoção continua exigindo manager (operator não promove)", async () => {
    await expect(caller().promoteSession({ sessionId: 100, procurementProcessId: "PROC-1", idempotencyKey: "idem-key-0001" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

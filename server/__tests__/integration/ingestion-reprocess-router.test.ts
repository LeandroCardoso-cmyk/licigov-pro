/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Layout v2 — `ingestion.reprocessExtraction` (sem DB real; serviços mockados): flag fail-closed, RBAC (viewer
 * não; operator sim), escopo tenant + processo (NUNCA por sessionId sozinho), elegibilidade propagada, reserva +
 * enfileiramento com metadados seguros, corrida com processamento em voo (reserva devolvida) e motivo obrigatório.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

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
  getStagingItems: vi.fn().mockResolvedValue([]), getStagingItem: vi.fn(), reviewStagingItem: vi.fn(), bulkReviewStagingItems: vi.fn(),
  getStagingSummary: vi.fn().mockResolvedValue({ total: 10, pending: 10, approved: 0, rejected: 0, skipped: 0 }), correctStagingItem: vi.fn(),
}));
vi.mock("../../services/importQueueService", () => ({ enqueueImport: vi.fn().mockReturnValue("job_100_1") }));
vi.mock("../../services/importReprocessService", () => ({
  reserveReextraction: vi.fn(), releaseReextraction: vi.fn().mockResolvedValue(undefined),
  getReprocessEligibility: vi.fn().mockResolvedValue({ eligible: true, blockers: [], message: "ok", stagedCount: 10 }),
}));

import { ingestionRouter } from "../../routers/ingestionRouter";
import { makeContext, mockUser } from "../helpers/fixtures";
import * as ingestion from "../../services/fileIngestionService";
import * as queue from "../../services/importQueueService";
import * as reprocess from "../../services/importReprocessService";
import * as flags from "../../services/featureFlagService";

const caller = () => ingestionRouter.createCaller(makeContext(mockUser) as any);
const session = (over: Record<string, unknown> = {}) => ({
  id: 100, organizationId: 1, sourceFileId: "imports/1/mapa.pdf", importType: "price_research", status: "awaiting_review",
  stage: "awaiting_review", procurementProcessId: "PROC-1", parserVersion: "2.2.0", promotionStatus: "none", warnings: [], errors: [],
  extractionSummary: null, retryCount: 0, ...over,
});
const input = { sessionId: 100, procurementProcessId: "PROC-1", reason: "Layout v2: releitura da tabela" };

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "operator";
  (flags.isFeatureEnabled as any).mockResolvedValue(true);
  (ingestion.getImportSession as any).mockResolvedValue(session());
  (reprocess.reserveReextraction as any).mockResolvedValue({ previousStage: "awaiting_review", stagedCount: 10, session: session() });
  (queue.enqueueImport as any).mockReturnValue("job_100_1");
});

describe("reprocessExtraction — governança", () => {
  it("operator reprocessa: reserva + job de REEXTRAÇÃO (só metadados: ator, motivo, estágio anterior)", async () => {
    const r = await caller().reprocessExtraction(input);
    expect(r).toMatchObject({ sessionId: 100, status: "reprocessing", enqueued: true, previousStagedCount: 10 });
    expect(reprocess.reserveReextraction).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 100, organizationId: 1, reason: input.reason }));
    expect(queue.enqueueImport).toHaveBeenCalledWith(100, 1, "imports/1/mapa.pdf", expect.objectContaining({
      reextract: { actorUserId: mockUser.id, reason: input.reason, previousStage: "awaiting_review" },
    }));
  });
  it("viewer ⇒ FORBIDDEN (nada reservado)", async () => {
    role.value = "viewer";
    await expect(caller().reprocessExtraction(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(reprocess.reserveReextraction).not.toHaveBeenCalled();
  });
  it("flag desligada ⇒ FORBIDDEN", async () => {
    (flags.isFeatureEnabled as any).mockResolvedValue(false);
    await expect(caller().reprocessExtraction(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("sessão de OUTRO tenant (busca escopada por organizationId) ⇒ NOT_FOUND; processo errado ⇒ NOT_FOUND", async () => {
    (ingestion.getImportSession as any).mockResolvedValue(null);
    await expect(caller().reprocessExtraction(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(ingestion.getImportSession).toHaveBeenCalledWith(100, 1);
    (ingestion.getImportSession as any).mockResolvedValue(session({ procurementProcessId: "OUTRO" }));
    await expect(caller().reprocessExtraction(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(reprocess.reserveReextraction).not.toHaveBeenCalled();
  });
  it("inelegível (decisão humana) ⇒ erro do serviço propagado; nada enfileirado", async () => {
    (reprocess.reserveReextraction as any).mockRejectedValue(new TRPCError({ code: "PRECONDITION_FAILED", message: "REPROCESS_FORBIDDEN: Há itens já revisados" }));
    await expect(caller().reprocessExtraction(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(queue.enqueueImport).not.toHaveBeenCalled();
  });
  it("processamento já em voo ⇒ reserva DEVOLVIDA e CONFLICT", async () => {
    (queue.enqueueImport as any).mockReturnValue(null);
    await expect(caller().reprocessExtraction(input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(reprocess.releaseReextraction).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 100, organizationId: 1, previousStage: "awaiting_review", code: "ALREADY_IN_FLIGHT" }));
  });
  it("motivo obrigatório (mín. 10 caracteres)", async () => {
    await expect(caller().reprocessExtraction({ ...input, reason: "curto" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("getSessionStatus expõe a elegibilidade (a UI só mostra a ação quando elegível)", async () => {
    const r = await caller().getSessionStatus({ sessionId: 100, procurementProcessId: "PROC-1" });
    expect(r.reprocess).toMatchObject({ eligible: true, inProgress: false });
    (ingestion.getImportSession as any).mockResolvedValue(session({ status: "approved" }));
    expect((await caller().getSessionStatus({ sessionId: 100, procurementProcessId: "PROC-1" })).reprocess.eligible).toBe(false);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR B.2.1 — Testes do ingestionRouter (superfície canônica de ingestão).
 *
 * Cobre: feature flag fail-closed, isolamento/autorização por tenant e processo, idempotência
 * (chave e replay), dedup por checksum, replay-safety do enqueue, transições inválidas,
 * aprovação sem revisão (bloqueada), revisão idempotente/conflito, isolamento de itens entre
 * sessões, e emissão de audit log. Sem DB real — serviços existentes são mockados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";

// ── Mocks de infraestrutura de tenant/auth (para tenantProcedure) ──
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
}));

vi.mock("../../services/featureFlagService", () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn().mockResolvedValue({ status: "new" }),
  saveIdempotencyResult: vi.fn().mockResolvedValue(undefined),
  failIdempotencyKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/activityLogService", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/fileIngestionService", () => ({
  createImportSession: vi.fn(),
  getImportSession: vi.fn(),
  findActiveSessionByChecksum: vi.fn().mockResolvedValue(null),
  findResumableSessionForProcess: vi.fn().mockResolvedValue(null),
  updateSessionStatus: vi.fn().mockResolvedValue(undefined),
  attachStoredFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/importStagingService", () => ({
  getStagingItems: vi.fn().mockResolvedValue([]),
  getStagingItem: vi.fn(),
  reviewStagingItem: vi.fn().mockResolvedValue(undefined),
  bulkReviewStagingItems: vi.fn().mockResolvedValue(0),
  getStagingSummary: vi.fn().mockResolvedValue({ total: 0, pending: 0, approved: 0, rejected: 0, skipped: 0 }),
}));

vi.mock("../../services/importQueueService", () => ({
  enqueueImport: vi.fn().mockReturnValue("job_1_123"),
}));

// ── Imports (após os mocks) ──
import { ingestionRouter } from "../../routers/ingestionRouter";
import { makeContext, mockUser } from "../helpers/fixtures";
import * as ingestion from "../../services/fileIngestionService";
import * as staging from "../../services/importStagingService";
import * as queue from "../../services/importQueueService";
import * as idem from "../../services/idempotencyService";
import * as flags from "../../services/featureFlagService";
import * as audit from "../../services/activityLogService";

const caller = () => ingestionRouter.createCaller(makeContext(mockUser) as any);

function sessionRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 100, organizationId: 1, uploadedBy: 1,
    sourceFileId: "imports/1/20260804/abc-planilha.xlsx",
    sourceFileName: "planilha.xlsx",
    sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sourceSize: 10, checksum: "a".repeat(64), importType: "price_research",
    importPurpose: null, processId: null, parserType: "xlsx", parserVersion: "1.0.0",
    status: "uploaded", stage: "file_stored", progress: 3, confidenceScore: null,
    extractionSummary: null, warnings: [], errors: [], correlationId: null, retryCount: 0,
    startedAt: null, finishedAt: null, failedAt: null, createdAt: new Date(), updatedAt: new Date(),
    ...over,
  };
}

const validCreateInput = {
  importType: "price_research" as const,
  sourceFileName: "planilha.xlsx",
  sourceMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  sourceSize: 10,
  checksum: "a".repeat(64),
  idempotencyKey: "idem-key-123456",
  procurementProcessId: "PROC-CANON-01", // B.2.2 — vínculo canônico obrigatório
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(flags.isFeatureEnabled).mockResolvedValue(true);
  vi.mocked(idem.checkIdempotency).mockResolvedValue({ status: "new" });
  vi.mocked(ingestion.findActiveSessionByChecksum).mockResolvedValue(null);
  vi.mocked(ingestion.createImportSession).mockResolvedValue(sessionRow() as any);
});

describe("feature flag — fail-closed", () => {
  it("bloqueia (FORBIDDEN) quando a ingestão canônica está desabilitada", async () => {
    vi.mocked(flags.isFeatureEnabled).mockResolvedValue(false);
    await expect(caller().createSession(validCreateInput)).rejects.toThrowError(/não habilitada/i);
  });
});

describe("createSession", () => {
  it("cria sessão e retorna uploadPath server-side", async () => {
    const r = await caller().createSession(validCreateInput);
    expect(r.sessionId).toBe(100);
    expect(r.uploadPath).toBe("/api/ingestion/upload/100");
    expect(r.duplicate).toBe(false);
    expect(idem.saveIdempotencyResult).toHaveBeenCalled();
  });

  it("dedup por checksum: reutiliza sessão ativa existente", async () => {
    vi.mocked(ingestion.findActiveSessionByChecksum).mockResolvedValue(sessionRow({ id: 55 }) as any);
    const r = await caller().createSession(validCreateInput);
    expect(r.sessionId).toBe(55);
    expect(r.duplicate).toBe(true);
    expect(ingestion.createImportSession).not.toHaveBeenCalled();
  });

  it("idempotência: replay de chave concluída retorna resposta cacheada", async () => {
    vi.mocked(idem.checkIdempotency).mockResolvedValue({
      status: "completed", payloadMismatch: false,
      response: { sessionId: 77, uploadPath: "/api/ingestion/upload/77", duplicate: false },
    });
    const r = await caller().createSession(validCreateInput);
    expect(r.sessionId).toBe(77);
    expect(ingestion.createImportSession).not.toHaveBeenCalled();
  });

  it("idempotência: mesma chave com arquivo diferente → CONFLICT", async () => {
    vi.mocked(idem.checkIdempotency).mockResolvedValue({ status: "completed", payloadMismatch: true, response: {} });
    await expect(caller().createSession(validCreateInput)).rejects.toThrowError(/outro arquivo/i);
  });

  it("idempotência: requisição idêntica em andamento → CONFLICT", async () => {
    vi.mocked(idem.checkIdempotency).mockResolvedValue({ status: "processing" });
    await expect(caller().createSession(validCreateInput)).rejects.toThrowError(/em andamento/i);
  });

  it("MIME não suportado → erro", async () => {
    await expect(caller().createSession({ ...validCreateInput, sourceMimeType: "application/x-msdownload" }))
      .rejects.toThrowError(/não suportado/i);
  });

  it("processId de outro tenant → NOT_FOUND (validado no serviço createImportSession)", async () => {
    vi.mocked(ingestion.createImportSession).mockRejectedValue(
      new TRPCError({ code: "NOT_FOUND", message: "Processo não encontrado nesta organização." }),
    );
    await expect(caller().createSession({ ...validCreateInput, processId: 999 }))
      .rejects.toThrowError(/processo não encontrado/i);
  });

  it("processId válido do tenant → aceito", async () => {
    const r = await caller().createSession({ ...validCreateInput, processId: 5 });
    expect(r.sessionId).toBe(100);
    expect(ingestion.createImportSession).toHaveBeenCalledWith(
      expect.objectContaining({ processId: 5 }),
      expect.anything(),
    );
  });
});

describe("vínculo com processo canônico (B.2.2)", () => {
  it("createSession propaga procurementProcessId ao serviço", async () => {
    await caller().createSession(validCreateInput);
    expect(ingestion.createImportSession).toHaveBeenCalledWith(
      expect.objectContaining({ procurementProcessId: "PROC-CANON-01" }),
      expect.anything(),
    );
  });

  it("createSession com processo canônico de outro tenant / forjado → NOT_FOUND", async () => {
    vi.mocked(ingestion.createImportSession).mockRejectedValue(
      new TRPCError({ code: "NOT_FOUND", message: "Processo canônico não encontrado nesta organização." }),
    );
    await expect(caller().createSession({ ...validCreateInput, procurementProcessId: "FORJADO" }))
      .rejects.toThrowError(/processo canônico não encontrado/i);
  });

  it("sessionId válido usado no PROCESSO ERRADO → NOT_FOUND (status/staging/approve)", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ procurementProcessId: "P1" }) as any);
    await expect(caller().getSessionStatus({ sessionId: 100, procurementProcessId: "P2" }))
      .rejects.toThrowError(/não encontrada para este processo/i);
    await expect(caller().listStagingItems({ sessionId: 100, procurementProcessId: "P2" }))
      .rejects.toThrowError(/não encontrada para este processo/i);

    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ status: "awaiting_review", procurementProcessId: "P1" }) as any);
    await expect(caller().approveSession({ sessionId: 100, procurementProcessId: "P2" }))
      .rejects.toThrowError(/não encontrada para este processo/i);
  });

  it("reviewItem/reviewBulk validam o processo da sessão", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ procurementProcessId: "P1" }) as any);
    await expect(caller().reviewItem({ sessionId: 100, procurementProcessId: "P2", itemId: 1, action: "approved" }))
      .rejects.toThrowError(/não encontrada para este processo/i);
    await expect(caller().reviewBulk({ sessionId: 100, procurementProcessId: "P2", itemIds: [1], action: "approved" }))
      .rejects.toThrowError(/não encontrada para este processo/i);
  });

  it("mesmo processo → operações liberadas (status expõe o vínculo canônico)", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ procurementProcessId: "P1" }) as any);
    const r = await caller().getSessionStatus({ sessionId: 100, procurementProcessId: "P1" });
    expect(r.session.procurementProcessId).toBe("P1");
  });

  it("getActiveSession retorna a sessão resumível do processo, ou null", async () => {
    vi.mocked(ingestion.findResumableSessionForProcess).mockResolvedValue(sessionRow({ procurementProcessId: "P1" }) as any);
    const r = await caller().getActiveSession({ procurementProcessId: "P1" });
    expect(r.session?.id).toBe(100);

    vi.mocked(ingestion.findResumableSessionForProcess).mockResolvedValue(null);
    const r2 = await caller().getActiveSession({ procurementProcessId: "P1" });
    expect(r2.session).toBeNull();
  });
});

describe("getSessionStatus", () => {
  it("sessão inexistente/cross-tenant → NOT_FOUND", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(null);
    await expect(caller().getSessionStatus({ sessionId: 1 })).rejects.toThrowError(/não encontrada/i);
  });

  it("retorna status com erros sanitizados (apenas code+message)", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(
      sessionRow({ status: "failed", errors: [{ code: "PARSE_ERROR", message: "x", fatal: true, internalStack: "SECRET" }] }) as any,
    );
    const r = await caller().getSessionStatus({ sessionId: 100 });
    expect(r.session.errors[0]).toEqual({ code: "PARSE_ERROR", message: "x" });
    expect(JSON.stringify(r.session.errors)).not.toContain("SECRET");
  });
});

describe("enqueueProcessing — replay-safe", () => {
  it("não re-enfileira quando já em processamento", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ status: "parsing" }) as any);
    const r = await caller().enqueueProcessing({ sessionId: 100 });
    expect(r.enqueued).toBe(false);
    expect(r.alreadyInFlight).toBe(true);
    expect(queue.enqueueImport).not.toHaveBeenCalled();
  });

  it("estado terminal → CONFLICT", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ status: "approved" }) as any);
    await expect(caller().enqueueProcessing({ sessionId: 100 })).rejects.toThrowError(/terminal/i);
  });

  it("arquivo ainda não enviado → PRECONDITION", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ status: "uploaded", stage: "created" }) as any);
    await expect(caller().enqueueProcessing({ sessionId: 100 })).rejects.toThrowError(/ainda não enviado/i);
  });

  it("uploaded + file_stored → enfileira e audita", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ status: "uploaded", stage: "file_stored" }) as any);
    const r = await caller().enqueueProcessing({ sessionId: 100 });
    expect(r.enqueued).toBe(true);
    // Job carrega storageKey + metadados — NUNCA Buffer.
    const [sid, org, key, opts] = vi.mocked(queue.enqueueImport).mock.calls[0];
    expect(sid).toBe(100);
    expect(org).toBe(1);
    expect(key).toBe("imports/1/20260804/abc-planilha.xlsx");
    expect(Buffer.isBuffer(key)).toBe(false);
    expect(Buffer.isBuffer(opts)).toBe(false);
    expect(typeof opts).toBe("object");
    expect(audit.logActivity).toHaveBeenCalled();
  });
});

describe("reviewItem — idempotente e auditável", () => {
  it("item de outra sessão → NOT_FOUND", async () => {
    vi.mocked(staging.getStagingItem).mockResolvedValue({ id: 9, importSessionId: 999, organizationId: 1, reviewStatus: "pending" } as any);
    await expect(caller().reviewItem({ sessionId: 100, itemId: 9, action: "approved" }))
      .rejects.toThrowError(/não encontrado/i);
  });

  it("reaplicar a mesma ação é no-op idempotente", async () => {
    vi.mocked(staging.getStagingItem).mockResolvedValue({ id: 9, importSessionId: 100, organizationId: 1, reviewStatus: "approved" } as any);
    const r = await caller().reviewItem({ sessionId: 100, itemId: 9, action: "approved" });
    expect(r.idempotent).toBe(true);
    expect(staging.reviewStagingItem).not.toHaveBeenCalled();
  });

  it("já revisado com ação diferente → CONFLICT", async () => {
    vi.mocked(staging.getStagingItem).mockResolvedValue({ id: 9, importSessionId: 100, organizationId: 1, reviewStatus: "rejected" } as any);
    await expect(caller().reviewItem({ sessionId: 100, itemId: 9, action: "approved" }))
      .rejects.toThrowError(/já revisado/i);
  });

  it("revisa item pendente e audita", async () => {
    vi.mocked(staging.getStagingItem).mockResolvedValue({ id: 9, importSessionId: 100, organizationId: 1, reviewStatus: "pending" } as any);
    const r = await caller().reviewItem({ sessionId: 100, itemId: 9, action: "approved", note: "ok" });
    expect(r.idempotent).toBe(false);
    expect(staging.reviewStagingItem).toHaveBeenCalledWith(9, 1, 1, "approved", "ok");
    expect(audit.logActivity).toHaveBeenCalled();
  });
});

describe("reviewBulk — isolamento de itens", () => {
  it("itens fora da sessão → NOT_FOUND", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow() as any);
    vi.mocked(staging.getStagingItems).mockResolvedValue([{ id: 1 }, { id: 2 }] as any);
    await expect(caller().reviewBulk({ sessionId: 100, itemIds: [2, 3], action: "approved" }))
      .rejects.toThrowError(/não pertencem/i);
  });

  it("aplica em lote apenas itens da sessão", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow() as any);
    vi.mocked(staging.getStagingItems).mockResolvedValue([{ id: 1 }, { id: 2 }] as any);
    vi.mocked(staging.bulkReviewStagingItems).mockResolvedValue(2);
    const r = await caller().reviewBulk({ sessionId: 100, itemIds: [1, 2], action: "rejected" });
    expect(r.affected).toBe(2);
  });
});

describe("approveSession — exige revisão completa, sem promoção", () => {
  it("aprovação com itens pendentes → PRECONDITION (bloqueada)", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ status: "awaiting_review" }) as any);
    vi.mocked(staging.getStagingSummary).mockResolvedValue({ total: 3, pending: 2, approved: 1, rejected: 0, skipped: 0 });
    await expect(caller().approveSession({ sessionId: 100 })).rejects.toThrowError(/revisão incompleta/i);
  });

  it("status inválido (não awaiting_review) → PRECONDITION", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ status: "uploaded" }) as any);
    await expect(caller().approveSession({ sessionId: 100 })).rejects.toThrowError(/aguardando revisão/i);
  });

  it("aprova quando revisão está completa e não promove ao domínio", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ status: "awaiting_review" }) as any);
    vi.mocked(staging.getStagingSummary).mockResolvedValue({ total: 3, pending: 0, approved: 2, rejected: 1, skipped: 0 });
    const r = await caller().approveSession({ sessionId: 100 });
    expect(r.status).toBe("approved");
    expect(ingestion.updateSessionStatus).toHaveBeenCalledWith(100, 1, "approved", expect.any(Object));
    expect(audit.logActivity).toHaveBeenCalled();
  });

  it("aprovação idempotente quando já aprovada", async () => {
    vi.mocked(ingestion.getImportSession).mockResolvedValue(sessionRow({ status: "approved" }) as any);
    const r = await caller().approveSession({ sessionId: 100 });
    expect(r.idempotent).toBe(true);
  });
});

/**
 * SEC-037 (PR B) — Testes de integração do upload seguro de anexo de tarefa
 * (departmentTasksRouter.addAttachment).
 *
 * Cobre: upload autorizado (S3 + persistência tenant-scoped), rejeição de
 * arquivo inválido (magic-bytes), isolamento cross-tenant (sem gravar no S3) e
 * compensação (sem arquivo/registro órfão) quando a persistência falha.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────────────────
vi.mock("../../db");

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));

vi.mock("../../_core/sdk", () => ({
  sdk: {
    signSession: vi.fn().mockResolvedValue("fake-token"),
    authenticateRequest: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../../storage", () => ({
  assertStorageUsable: vi.fn(),
  storagePut: vi.fn().mockResolvedValue({
    key: "tasks/10/1700000000000_nota.pdf",
    url: "https://s3.example.com/tasks/10/1700000000000_nota.pdf",
  }),
  storageDelete: vi.fn().mockResolvedValue({ key: "tasks/10/1700000000000_nota.pdf", deleted: true }),
}));

vi.mock("../../services/activityLogService", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────
import { departmentTasksRouter } from "../../routers/departmentTasksRouter";
import * as db from "../../db";
import * as storageModule from "../../storage";
import { logActivity } from "../../services/activityLogService";
import { makeContext, mockUser } from "../helpers/fixtures";

const PDF_BASE64 = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]).toString("base64"); // "%PDF-1.4"
const mockTask = { id: 10, organizationId: 1, title: "Tarefa", assignedTo: 1, createdBy: 1 };

function validInput(overrides: Record<string, unknown> = {}) {
  return { taskId: 10, fileName: "nota.pdf", fileBase64: PDF_BASE64, mimeType: "application/pdf", ...overrides };
}

describe("SEC-037 · departmentTasks.addAttachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getTaskByIdForOrganization).mockResolvedValue(mockTask as any);
    vi.mocked(db.createTaskAttachmentForOrganization).mockResolvedValue(101 as any);
  });

  it("faz upload autorizado: grava no S3 (chave tasks/) e persiste tenant-scoped", async () => {
    const caller = departmentTasksRouter.createCaller(makeContext(mockUser));
    const result = await caller.addAttachment(validInput());

    expect(result).toMatchObject({ success: true, id: 101 });
    // Gravou no S3 com chave interna segura sob tasks/<taskId>/
    expect(storageModule.storagePut).toHaveBeenCalledTimes(1);
    const s3Key = vi.mocked(storageModule.storagePut).mock.calls[0][0];
    expect(s3Key).toMatch(/^tasks\/10\/\d+_nota\.pdf$/);
    // Persistiu de forma tenant-scoped, com a org do contexto
    expect(db.createTaskAttachmentForOrganization).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 10, fileName: "nota.pdf", uploadedBy: mockUser.id }),
      1,
    );
    // Auditou o evento
    expect(logActivity).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 1, action: expect.stringContaining("anexo"), entityId: 10 }),
    );
  });

  it("sanitiza o nome e previne path traversal na chave do S3", async () => {
    const caller = departmentTasksRouter.createCaller(makeContext(mockUser));
    await caller.addAttachment(validInput({ fileName: "nota final.pdf" }));
    const s3Key = vi.mocked(storageModule.storagePut).mock.calls[0][0];
    expect(s3Key).not.toContain("..");
    expect(s3Key.startsWith("tasks/10/")).toBe(true);
  });

  it("rejeita arquivo inválido (conteúdo ≠ MIME declarado) SEM gravar no S3", async () => {
    const notPdf = Buffer.from("<html>nao e pdf</html>", "utf8").toString("base64");
    const caller = departmentTasksRouter.createCaller(makeContext(mockUser));

    await expect(
      caller.addAttachment(validInput({ fileBase64: notPdf })),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(storageModule.storagePut).not.toHaveBeenCalled();
    expect(db.createTaskAttachmentForOrganization).not.toHaveBeenCalled();
  });

  it("rejeita MIME fora da allowlist (validação de input)", async () => {
    const caller = departmentTasksRouter.createCaller(makeContext(mockUser));
    await expect(
      caller.addAttachment(validInput({ mimeType: "application/x-msdownload" })),
    ).rejects.toBeTruthy();
    expect(storageModule.storagePut).not.toHaveBeenCalled();
  });

  it("bloqueia tarefa de outro tenant (NOT_FOUND) SEM gravar no S3", async () => {
    vi.mocked(db.getTaskByIdForOrganization).mockResolvedValue(undefined as any);
    const caller = departmentTasksRouter.createCaller(makeContext(mockUser));

    await expect(caller.addAttachment(validInput())).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(storageModule.storagePut).not.toHaveBeenCalled();
    expect(db.createTaskAttachmentForOrganization).not.toHaveBeenCalled();
  });

  it("compensa (remove o objeto do S3) se a persistência retornar null — sem órfão", async () => {
    vi.mocked(db.createTaskAttachmentForOrganization).mockResolvedValue(null as any);
    const caller = departmentTasksRouter.createCaller(makeContext(mockUser));

    await expect(caller.addAttachment(validInput())).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(storageModule.storagePut).toHaveBeenCalledTimes(1);
    expect(storageModule.storageDelete).toHaveBeenCalledTimes(1);
  });

  it("compensa (remove o objeto do S3) se a persistência lançar — sem órfão", async () => {
    vi.mocked(db.createTaskAttachmentForOrganization).mockRejectedValue(new Error("db down"));
    const caller = departmentTasksRouter.createCaller(makeContext(mockUser));

    await expect(caller.addAttachment(validInput())).rejects.toBeTruthy();

    expect(storageModule.storageDelete).toHaveBeenCalledTimes(1);
  });

  it("exige autenticação (UNAUTHORIZED) antes de qualquer gravação", async () => {
    await expect(
      departmentTasksRouter.createCaller(makeContext(null)).addAttachment(validInput()),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(storageModule.storagePut).not.toHaveBeenCalled();
  });
});

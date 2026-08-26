/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * C.4B.2 — Leitura canônica reload-safe do rascunho revisável (ROUTER `reviewableDraft`).
 *
 * Cobre: retorno do conteúdo EXATO persistido + hash (mesma primitive `draftContentHash` da promoção),
 * para ETP/TR/Edital; rascunho ausente/vazio → { draft: null }; isolamento cross-tenant (processo
 * inexistente no tenant → NOT_FOUND). Persistência mockada; o read/hash/tenant reais têm cobertura no
 * smoke MySQL C.4B.2.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/procurement");
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
  getMembership: vi.fn().mockResolvedValue({ id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../_core/sdk", () => ({
  sdk: { signSession: vi.fn().mockResolvedValue("fake-token"), authenticateRequest: vi.fn().mockResolvedValue(null) },
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import * as procDb from "../../db/procurement";
import { draftContentHash } from "../../services/documentPromotionService";
import { makeContext, mockUser } from "../helpers/fixtures";

const PID = "proc-c4b2-1";
const mockProcess = { id: PID, organizationId: 1, processNumber: "700/2026", object: "Aquisição X" };

function draftRow(kind: string, content: string) {
  return { id: `gd-${kind}`, kind, title: `${kind.toUpperCase()} — X`, content, status: "rascunho", authorUserId: 9, updatedAt: "2026-08-25T12:00:00.000Z" };
}

describe("C.4B.2 — reviewableDraft (leitura canônica reload-safe)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(procDb.getProcess).mockResolvedValue(mockProcess as any);
  });

  it.each(["etp", "tr", "edital"] as const)("%s: retorna conteúdo EXATO + hash (draftContentHash)", async (kind) => {
    const content = `# ${kind} conteúdo persistido\ndetalhe`;
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow(kind, content) as any);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const { draft } = await caller.reviewableDraft({ processId: PID, kind });

    expect(draft).not.toBeNull();
    expect(draft!.kind).toBe(kind);
    expect(draft!.content).toBe(content);
    expect(draft!.contentHash).toBe(draftContentHash(content)); // MESMA primitive da promoção
    expect(draft!.status).toBe("rascunho");
    expect(draft!.title).toBe(`${kind.toUpperCase()} — X`);
    expect(draft!.updatedAt).toBe("2026-08-25T12:00:00.000Z");
    // tenant-scoped: consulta usa o org do contexto (1), nunca do cliente.
    expect(vi.mocked(procDb.getGeneratedDocumentByKind).mock.calls[0][1]).toBe(1);
  });

  it("rascunho inexistente → { draft: null }", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(null as any);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const res = await caller.reviewableDraft({ processId: PID, kind: "etp" });
    expect(res.draft).toBeNull();
  });

  it("rascunho com conteúdo vazio → { draft: null } (não fabrica conteúdo)", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(draftRow("tr", "   ") as any);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const res = await caller.reviewableDraft({ processId: PID, kind: "tr" });
    expect(res.draft).toBeNull();
  });

  it("cross-tenant / processo inexistente no tenant → NOT_FOUND", async () => {
    vi.mocked(procDb.getProcess).mockResolvedValue(null as any);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await expect(caller.reviewableDraft({ processId: "outro", kind: "etp" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(procDb.getGeneratedDocumentByKind).not.toHaveBeenCalled();
  });

  it("exige autenticação (UNAUTHORIZED)", async () => {
    await expect(
      procurementProcessRouter.createCaller(makeContext(null)).reviewableDraft({ processId: PID, kind: "etp" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

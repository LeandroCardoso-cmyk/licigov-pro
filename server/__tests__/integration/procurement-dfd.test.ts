/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR B (homologação) — "Criar DFD do zero" no fluxo canônico.
 *
 * Cobre o ROUTER (generateDFD/saveDFD/loadDFD): criação do rascunho estruturado,
 * edição/salvamento, idempotência (id determinístico → retry não duplica),
 * isolamento cross-tenant (NOT_FOUND, sem gravar) e o construtor de domínio do
 * rascunho (art. 12 §1º). Persistência mockada; a persistência real é coberta pelo
 * smoke MySQL.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/procurement");
// C.4A — a persistência documental agora ocorre numa transação (getDb().transaction).
// Sem DATABASE_URL, getDb() real devolve null e a persistência (mockada em db/procurement)
// seria pulada; fornecemos um db transacional fake (persistência presente) e neutralizamos a
// idempotência aqui — a lógica replay/CONFLICT tem cobertura dedicada no teste unitário C.4A.
vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({ transaction: async (cb: (tx: unknown) => unknown) => cb({}) })),
}));
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn(async () => ({ status: "new" })),
  saveIdempotencyResult: vi.fn(async () => undefined),
  failIdempotencyKey: vi.fn(async () => undefined),
}));
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
import { buildDFDDraft } from "../../domain/generatedDocument";
import { makeContext, mockUser } from "../helpers/fixtures";

const PID = "proc-100-2026";
const mockProcess = { id: PID, organizationId: 1, processNumber: "100/2026", object: "Aquisição de Equipamentos de Informática" };

describe("procurementProcess — Criar DFD do zero (PR B)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(procDb.getProcess).mockResolvedValue(mockProcess as any);
    // C.4B.3A — a persistência do rascunho passou pelo primitive governado (proveniência + ledger).
    vi.mocked(procDb.applyDraftContentMutationTx).mockResolvedValue({ created: true, changed: true } as any);
    vi.mocked(procDb.recordProcessEvent).mockResolvedValue(undefined as any);
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(null as any);
  });

  it("generateDFD cria rascunho estruturado kind 'dfd' status 'rascunho'", async () => {
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const { document } = await caller.generateDFD({ processId: PID, idempotencyKey: "dfd-key-1" });

    expect(document.kind).toBe("dfd");
    expect(document.status).toBe("rascunho");
    expect(document.processId).toBe(PID);
    expect(document.content).toContain("Documento de Formalização da Demanda");
    expect(document.content).toContain("Aquisição de Equipamentos de Informática");
    // Persistiu via o primitive governado (tx, input.doc) + registrou evento.
    expect(procDb.applyDraftContentMutationTx).toHaveBeenCalledTimes(1);
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].doc.kind).toBe("dfd");
    expect(vi.mocked(procDb.applyDraftContentMutationTx).mock.calls[0][1].allowCreate).toBe(true);
    expect(procDb.recordProcessEvent).toHaveBeenCalledTimes(1);
  });

  it("id determinístico por (processo, kind) → retry NÃO duplica", async () => {
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const a = await caller.generateDFD({ processId: PID, idempotencyKey: "dfd-key-a" });
    const b = await caller.generateDFD({ processId: PID, idempotencyKey: "dfd-key-b" });
    expect(a.document.id).toBe(b.document.id);
  });

  it("saveDFD (write governado) atualiza o conteúdo do rascunho (mesmo documento)", async () => {
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const created = await caller.generateDFD({ processId: PID, idempotencyKey: "dfd-key-save" });
    const edited = "# DFD editado pelo servidor\nConteúdo revisado.";
    const { document } = await caller.saveDFD({
      processId: PID, content: edited, expectedContentHash: "a".repeat(64), idempotencyKey: "dfd-save-key",
    });

    expect(document.id).toBe(created.document.id); // mesmo documento (id determinístico)
    expect(document.content).toBe(edited);
    expect(document.kind).toBe("dfd");
    // Salvou via o primitive governado: exige rascunho existente (allowCreate=false), operação de edição.
    const saveCall = vi.mocked(procDb.applyDraftContentMutationTx).mock.calls.at(-1)!;
    expect(saveCall[1].allowCreate).toBe(false);
    expect(saveCall[1].operation).toBe("dfd_manual_edit");
    expect(saveCall[1].expectedContentHash).toBe("a".repeat(64));
  });

  it("loadDFD retorna o rascunho persistido (ou null)", async () => {
    vi.mocked(procDb.getGeneratedDocumentByKind).mockResolvedValue(
      { id: "d1", kind: "dfd", title: "DFD — X", content: "conteúdo", status: "rascunho", updatedAt: "2026-07-26T00:00:00.000Z" } as any,
    );
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    const res = await caller.loadDFD({ processId: PID });
    expect(res.document?.kind).toBe("dfd");
    expect(res.document?.content).toBe("conteúdo");
  });

  it("cross-tenant / processo inexistente → NOT_FOUND, sem gravar", async () => {
    vi.mocked(procDb.getProcess).mockResolvedValue(null as any);
    const caller = procurementProcessRouter.createCaller(makeContext(mockUser));
    await expect(caller.generateDFD({ processId: "outro", idempotencyKey: "dfd-key-x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.saveDFD({ processId: "outro", content: "x", expectedContentHash: "a".repeat(64), idempotencyKey: "k" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
  });

  it("exige autenticação (UNAUTHORIZED)", async () => {
    await expect(
      procurementProcessRouter.createCaller(makeContext(null)).generateDFD({ processId: PID }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("buildDFDDraft (domínio)", () => {
  it("estrutura as seções do art. 12 §1º e injeta o objeto", () => {
    const draft = buildDFDDraft("Aquisição de mobiliário");
    expect(draft).toContain("Art. 12, §1º");
    expect(draft).toContain("Justificativa da necessidade");
    expect(draft).toContain("Quantitativo estimado");
    expect(draft).toContain("Aquisição de mobiliário");
  });
  it("usa placeholder quando o objeto é vazio", () => {
    expect(buildDFDDraft("   ")).toContain("[descrever o objeto]");
  });
});

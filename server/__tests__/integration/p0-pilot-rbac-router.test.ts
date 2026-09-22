/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0 PILOTO — RBAC + tenant das superfícies novas (ingestão documental, ingestão de linhas, geração, itens).
 *
 * Sem DB: serviços mockados. Prova que:
 *   - viewer NÃO muta (upload/createSession, revisão/aprovação/promoção documental, geração ETP/TR, itens);
 *   - operator revisa/aprova/promove a RASCUNHO (não é emissão; a emissão segue manager + SoD);
 *   - promoção da Pesquisa ao domínio continua exigindo manager;
 *   - o organizationId vem SEMPRE do contexto autenticado (nunca do input);
 *   - leitura (getDocumentIntake) é permitida ao viewer e escopada ao tenant do contexto.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const role = vi.hoisted(() => ({ value: "viewer" as string, org: 1 }));

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: role.org,
    membership: { id: 1, organizationId: role.org, userId: 1, role: role.value, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
vi.mock("../../services/featureFlagService", () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(true) }));
vi.mock("../../services/activityLogService", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn().mockResolvedValue({ status: "new" }),
  saveIdempotencyResult: vi.fn().mockResolvedValue(undefined),
  failIdempotencyKey: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/fileIngestionService", () => ({
  createImportSession: vi.fn(async () => ({ id: 11 })),
  getImportSession: vi.fn(),
  findActiveSessionByChecksum: vi.fn().mockResolvedValue(null),
  findResumableSessionForProcess: vi.fn().mockResolvedValue(null),
  updateSessionStatus: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../services/importQueueService", () => ({ enqueueImport: vi.fn().mockReturnValue("job") }));

const intake = vi.hoisted(() => ({
  getDocumentIntake: vi.fn(async () => ({ staging: null, draft: { exists: false, contentHash: null, origin: null, title: null } })),
  saveDocumentReview: vi.fn(async () => ({ revision: 1, contentHash: "h", changed: true, status: "pending_review" })),
  approveDocumentStaging: vi.fn(async () => ({ status: "approved", approvedContentHash: "h", idempotent: false })),
  rejectDocumentStaging: vi.fn(async () => ({ status: "rejected", idempotent: false })),
  promoteDocumentToDraft: vi.fn(async () => ({ documentId: "d", kind: "tr", mode: "create", contentHash: "h", created: true, replaced: false, replayed: false })),
}));
vi.mock("../../services/documentIntakeService", () => intake);

import { ingestionRouter } from "../../routers/ingestionRouter";
import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import { makeContext, mockUser } from "../helpers/fixtures";
import * as ingestion from "../../services/fileIngestionService";

const ing = () => ingestionRouter.createCaller(makeContext(mockUser) as any);
const proc = () => procurementProcessRouter.createCaller(makeContext(mockUser) as any);
const H = "a".repeat(64);

async function code(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null; } catch (e: any) { return e?.code ?? "ERR"; }
}

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "viewer"; role.org = 1;
});

describe("P0 — RBAC da importação documental (DFD/ETP/TR)", () => {
  it("viewer NÃO revisa/aprova/descarta/promove; lê o intake do PRÓPRIO tenant", async () => {
    expect(await code(ing().saveDocumentReview({ procurementProcessId: "p1", stagingId: 1, expectedRevision: 0, content: "x" }))).toBe("FORBIDDEN");
    expect(await code(ing().approveDocument({ procurementProcessId: "p1", stagingId: 1, expectedContentHash: H }))).toBe("FORBIDDEN");
    expect(await code(ing().rejectDocument({ procurementProcessId: "p1", stagingId: 1 }))).toBe("FORBIDDEN");
    expect(await code(ing().promoteDocument({ procurementProcessId: "p1", stagingId: 1, mode: "create", idempotencyKey: "k".repeat(12) }))).toBe("FORBIDDEN");
    expect(intake.promoteDocumentToDraft).not.toHaveBeenCalled();
    await ing().getDocumentIntake({ procurementProcessId: "p1", kind: "tr" });
    expect(intake.getDocumentIntake).toHaveBeenCalledWith({ organizationId: 1, processId: "p1", kind: "tr" });
  });

  it("operator revisa, aprova e promove a rascunho — org SEMPRE do contexto", async () => {
    role.value = "operator"; role.org = 77;
    await ing().saveDocumentReview({ procurementProcessId: "p1", stagingId: 5, expectedRevision: 2, content: "novo" });
    expect(intake.saveDocumentReview).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 77, stagingId: 5, expectedRevision: 2 }));
    await ing().approveDocument({ procurementProcessId: "p1", stagingId: 5, expectedContentHash: H });
    expect(intake.approveDocumentStaging).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 77, expectedContentHash: H }));
    await ing().promoteDocument({ procurementProcessId: "p1", stagingId: 5, mode: "replace", expectedDraftContentHash: H, reason: "TR atualizado", idempotencyKey: "k".repeat(12) });
    expect(intake.promoteDocumentToDraft).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 77, mode: "replace", expectedDraftContentHash: H, reason: "TR atualizado" }));
  });

  it("createSession: viewer negado; tipo documental só aceita PDF/DOCX (.doc recusado)", async () => {
    const base = { sourceFileName: "tr.docx", sourceSize: 10, checksum: H, idempotencyKey: "k".repeat(12), procurementProcessId: "p1" };
    expect(await code(ing().createSession({ ...base, importType: "document_tr", sourceMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }))).toBe("FORBIDDEN");
    role.value = "operator";
    expect(await code(ing().createSession({ ...base, importType: "document_tr", sourceMimeType: "application/msword" }))).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(await code(ing().createSession({ ...base, importType: "document_tr", sourceMimeType: "text/csv" }))).toBe("UNSUPPORTED_MEDIA_TYPE");
    const ok = await ing().createSession({ ...base, importType: "document_tr", sourceMimeType: "application/pdf" });
    expect(ok.sessionId).toBe(11);
    // Dedup escopado por importType (sem adoção cruzada entre Pesquisa e TR).
    expect(vi.mocked(ingestion.findActiveSessionByChecksum)).toHaveBeenCalledWith(1, H, "p1", "document_tr");
  });

  it("approveSession de sessão documental é recusado (aprovação é do CONTEÚDO, por hash)", async () => {
    role.value = "operator";
    vi.mocked(ingestion.getImportSession).mockResolvedValue({ id: 3, organizationId: 1, procurementProcessId: "p1", importType: "document_etp", status: "awaiting_review" } as any);
    expect(await code(ing().approveSession({ sessionId: 3, procurementProcessId: "p1" }))).toBe("BAD_REQUEST");
  });

  it("promoção da Pesquisa ao domínio continua exigindo manager", async () => {
    role.value = "operator";
    expect(await code(ing().promoteSession({ sessionId: 1, procurementProcessId: "p1", idempotencyKey: "k".repeat(12) }))).toBe("FORBIDDEN");
  });
});

describe("P0 — RBAC da geração e dos Itens Inteligentes", () => {
  it("viewer não gera ETP/TR/Edital, não importa pesquisa e não aprova/rejeita item", async () => {
    expect(await code(proc().generateETP({ processId: "p1", object: "o", idempotencyKey: "k" }))).toBe("FORBIDDEN");
    expect(await code(proc().generateTR({ processId: "p1", object: "o", idempotencyKey: "k" }))).toBe("FORBIDDEN");
    expect(await code(proc().generateNotice({ processId: "p1", object: "o", modality: "pregao", form: "eletronico", platform: "compras_gov", idempotencyKey: "k" } as any))).toBe("FORBIDDEN");
    expect(await code(proc().importPriceResearch({ processId: "p1", source: "colar", text: "a;1;un;1,00" }))).toBe("FORBIDDEN");
    expect(await code(proc().approveItem({ itemId: "i1" }))).toBe("FORBIDDEN");
    expect(await code(proc().rejectItem({ itemId: "i1" }))).toBe("FORBIDDEN");
    expect(await code(proc().createProcess({ processNumber: "1", object: "o", startOption: "importar_tr" }))).toBe("FORBIDDEN");
  });
});

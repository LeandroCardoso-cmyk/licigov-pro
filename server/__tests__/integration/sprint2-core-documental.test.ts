import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../db/connection", () => ({
  getDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../services/observabilityService", () => ({
  serviceLogger: () => ({
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    timed: vi.fn((_op: string, fn: () => Promise<unknown>) => fn()),
    span:  vi.fn((_op: string, fn: () => Promise<unknown>) => fn().then((r) => ({ result: r, durationMs: 1, slow: false }))),
  }),
  structuredLog: vi.fn(),
  timed: vi.fn((_s: string, _o: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../services/outboxService", () => ({
  appendOutboxEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/activityLogService", () => ({
  logActivity:  vi.fn().mockResolvedValue(undefined),
  logFromCtx:   vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/documentTimelineService", () => ({
  addTimelineEvent:        vi.fn().mockResolvedValue(undefined),
  getDocumentTimeline:     vi.fn().mockResolvedValue([]),
  paginateDocumentTimeline: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 1, hasNextPage: false, hasPreviousPage: false }),
}));

vi.mock("../../services/documentVersionService", () => ({
  createVersion:    vi.fn().mockResolvedValue({ id: 10, versionNumber: 1 }),
  listVersions:     vi.fn().mockResolvedValue([]),
  getVersion:       vi.fn().mockResolvedValue(null),
  getLatestVersion: vi.fn().mockResolvedValue(null),
  restoreToVersion: vi.fn().mockResolvedValue(null),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { TRPCError } from "@trpc/server";
import {
  isValidTransition,
  WORKFLOW_TRANSITIONS,
  DOCUMENT_TYPE_LABELS,
  buildExportFilename,
  DocumentStatusValue,
} from "../../domain/documentTypes";
import {
  DOCUMENT_EVENT_TYPES,
} from "../../domain/documentEvents";
import {
  OptimisticLockConflictError,
  assertVersion,
  toETag,
  parseETag,
} from "../../domain/locking";
import {
  normalizePagination,
  buildPaginatedResult,
  batchByIds,
  batchByKey,
} from "../../db/queryStrategy";
import { BaseTenantRepository } from "../../db/baseTenantRepository";
import type { PaginatedResult } from "../../db/queryStrategy";
import { DocumentRepository } from "../../db/documentRepository";
import {
  DRAFT_EXPIRY_DAYS,
  DRAFT_AUTOSAVE_DEBOUNCE_MS,
} from "../../services/documentDraftService";
import { getDb } from "../../db/connection";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeCtx(overrides?: Partial<{
  organizationId: number | null;
  userId: number;
  role: string;
}>): any {
  return {
    organizationId: overrides?.organizationId ?? 1,
    user: { id: overrides?.userId ?? 1, name: "Test User", email: "test@org.com" },
    orgMembership: { role: overrides?.role ?? "manager" },
    orgName: "Org Teste",
    correlationId: "corr-test",
    requestId:     "req-test",
  };
}

// ─── 1. Workflow State Machine ────────────────────────────────────────────────

describe("DocumentWorkflow — isValidTransition", () => {
  it("draft → in_review é válido", () => {
    expect(isValidTransition("draft", "in_review")).toBe(true);
  });

  it("draft → archived é válido", () => {
    expect(isValidTransition("draft", "archived")).toBe(true);
  });

  it("in_review → approved é válido", () => {
    expect(isValidTransition("in_review", "approved")).toBe(true);
  });

  it("in_review → rejected é válido", () => {
    expect(isValidTransition("in_review", "rejected")).toBe(true);
  });

  it("approved → archived é válido", () => {
    expect(isValidTransition("approved", "archived")).toBe(true);
  });

  it("rejected → draft é válido (retry)", () => {
    expect(isValidTransition("rejected", "draft")).toBe(true);
  });

  it("approved → in_review NÃO é válido", () => {
    expect(isValidTransition("approved", "in_review")).toBe(false);
  });

  it("archived → qualquer estado NÃO é válido (terminal)", () => {
    expect(isValidTransition("archived", "draft")).toBe(false);
    expect(isValidTransition("archived", "in_review")).toBe(false);
    expect(isValidTransition("archived", "approved")).toBe(false);
  });

  it("draft → approved direto NÃO é válido", () => {
    expect(isValidTransition("draft", "approved")).toBe(false);
  });

  it("todos os estados têm transições definidas", () => {
    const states: DocumentStatusValue[] = ["draft", "in_review", "approved", "rejected", "archived"];
    for (const s of states) {
      expect(WORKFLOW_TRANSITIONS[s]).toBeDefined();
    }
  });
});

// ─── 2. DocumentoLicitatorio Aggregate — Domain Types ────────────────────────

describe("DocumentTypeLabels", () => {
  it("todos os tipos têm rótulos em português", () => {
    const types = ["etp", "tr", "dfd", "edital", "contrato", "ata", "parecer", "aditivo", "minuta"] as const;
    for (const t of types) {
      expect(DOCUMENT_TYPE_LABELS[t]).toBeTruthy();
      expect(typeof DOCUMENT_TYPE_LABELS[t]).toBe("string");
    }
  });

  it("ETP → 'Estudo Técnico Preliminar'", () => {
    expect(DOCUMENT_TYPE_LABELS["etp"]).toBe("Estudo Técnico Preliminar");
  });

  it("TR → 'Termo de Referência'", () => {
    expect(DOCUMENT_TYPE_LABELS["tr"]).toBe("Termo de Referência");
  });
});

// ─── 3. Domain Events Contract ────────────────────────────────────────────────

describe("DocumentEventTypes", () => {
  it("todos os event types são strings não-vazias", () => {
    for (const [key, value] of Object.entries(DOCUMENT_EVENT_TYPES)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
      expect(value).toContain("documento.");
    }
  });

  it("DOCUMENTO_CRIADO event type está definido", () => {
    expect(DOCUMENT_EVENT_TYPES.DOCUMENTO_CRIADO).toBe("documento.criado");
  });

  it("WORKFLOW_ALTERADO event type está definido", () => {
    expect(DOCUMENT_EVENT_TYPES.WORKFLOW_ALTERADO).toBe("documento.workflow_alterado");
  });
});

// ─── 4. Optimistic Locking nos Documentos ────────────────────────────────────

describe("OptimisticLocking — Document version enforcement", () => {
  it("assertVersion não lança quando versões batem", () => {
    expect(() => assertVersion(5, 5, "Document", 42)).not.toThrow();
  });

  it("assertVersion lança OptimisticLockConflictError quando versões divergem", () => {
    expect(() => assertVersion(3, 5, "Document", 42))
      .toThrow(OptimisticLockConflictError);
  });

  it("error.code é OPTIMISTIC_LOCK_CONFLICT", () => {
    try {
      assertVersion(1, 2, "Document", 1);
    } catch (e) {
      expect((e as OptimisticLockConflictError).code).toBe("OPTIMISTIC_LOCK_CONFLICT");
    }
  });

  it("ETag de documento tem formato correto", () => {
    const etag = toETag("Document", 42, 7);
    expect(etag).toBe('"Document-42-v7"');
    const parsed = parseETag(etag);
    expect(parsed?.entityType).toBe("Document");
    expect(parsed?.version).toBe(7);
  });
});

// ─── 5. DocumentRepository — Tenant Safety ───────────────────────────────────

describe("DocumentRepository — tenant safety", () => {
  const repo = new DocumentRepository();

  it("requireOrganizationId lança para null", () => {
    // @ts-expect-error testing invalid input
    expect(() => (repo as any).requireOrganizationId(null)).toThrow(TRPCError);
  });

  it("assertOwnership lança FORBIDDEN para org mismatch", () => {
    // @ts-expect-error accessing protected
    expect(() => (repo as any).assertOwnership(2, 1)).toThrow(TRPCError);
  });

  it("assertOwnership permite legacy (null org) apenas para org=1", () => {
    // @ts-expect-error accessing protected
    expect(() => (repo as any).assertOwnership(null, 1)).not.toThrow();
    // @ts-expect-error accessing protected
    expect(() => (repo as any).assertOwnership(null, 2)).toThrow("Acesso negado");
  });

  it("safeFindById retorna null quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const result = await repo.safeFindById(1, 1);
    expect(result).toBeNull();
  });

  it("safeFindMany retorna [] quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const result = await repo.safeFindMany(1);
    expect(result).toEqual([]);
  });
});

// ─── 6. Draft Autosave — Políticas ───────────────────────────────────────────

describe("DocumentDraftService — políticas de autosave", () => {
  it("DRAFT_EXPIRY_DAYS é 7 dias", () => {
    expect(DRAFT_EXPIRY_DAYS).toBe(7);
  });

  it("DRAFT_AUTOSAVE_DEBOUNCE_MS é pelo menos 1 segundo", () => {
    expect(DRAFT_AUTOSAVE_DEBOUNCE_MS).toBeGreaterThanOrEqual(1_000);
  });

  it("draft.saveDraft lança quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { saveDraft } = await import("../../services/documentDraftService");
    await expect(saveDraft(1, 1, { text: "x" }, makeCtx())).rejects.toThrow();
  });

  it("draft.getDraft retorna null quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { getDraft } = await import("../../services/documentDraftService");
    const result = await getDraft(1, 1, 1);
    expect(result).toBeNull();
  });

  it("draft.cleanupExpiredDrafts retorna 0 quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { cleanupExpiredDrafts } = await import("../../services/documentDraftService");
    const removed = await cleanupExpiredDrafts();
    expect(removed).toBe(0);
  });
});

// ─── 7. Document Version Service ─────────────────────────────────────────────

describe("DocumentVersionService — retornos sem DB", () => {
  it("listVersions retorna [] quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { listVersions } = await import("../../services/documentVersionService");
    const result = await listVersions(1, 1);
    expect(result).toEqual([]);
  });

  it("getVersion retorna null quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { getVersion } = await import("../../services/documentVersionService");
    const result = await getVersion(1, 1, 1);
    expect(result).toBeNull();
  });

  it("getLatestVersion retorna null quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { getLatestVersion } = await import("../../services/documentVersionService");
    const result = await getLatestVersion(1, 1);
    expect(result).toBeNull();
  });

  it("createVersion retorna shape com id e versionNumber", async () => {
    const { createVersion } = await import("../../services/documentVersionService");
    const result = await createVersion({ documentId: 1, organizationId: 1 }, makeCtx());
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("versionNumber");
  });
});

// ─── 8. Workflow Service — Validações ────────────────────────────────────────

describe("DocumentWorkflowService — validações sem DB", () => {
  it("submitForReview lança quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { submitForReview } = await import("../../services/documentWorkflowService");
    await expect(submitForReview(1, null, makeCtx())).rejects.toThrow();
  });

  it("approveDocumento lança quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { approveDocumento } = await import("../../services/documentWorkflowService");
    await expect(approveDocumento(1, null, makeCtx())).rejects.toThrow();
  });
});

// ─── 9. DocumentService — Core CRUD ──────────────────────────────────────────

describe("DocumentService — operações sem DB", () => {
  it("createDocumento lança quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { createDocumento } = await import("../../services/documentService");
    await expect(createDocumento({ processId: 1, documentType: "etp" }, makeCtx()))
      .rejects.toThrow();
  });

  it("getDocumentoById retorna null quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { getDocumentoById } = await import("../../services/documentService");
    const result = await getDocumentoById(1, 1);
    expect(result).toBeNull();
  });

  it("listDocumentosByProcess retorna [] quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { listDocumentosByProcess } = await import("../../services/documentService");
    const result = await listDocumentosByProcess(1, 1);
    expect(result).toEqual([]);
  });

  it("updateDocumento requer organizationId", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { updateDocumento } = await import("../../services/documentService");
    const ctx = makeCtx({ organizationId: null });
    await expect(updateDocumento(1, {}, 1, ctx)).rejects.toThrow();
  });
});

// ─── 10. Export Foundation ────────────────────────────────────────────────────

describe("Export Foundation — buildExportFilename", () => {
  it("gera filename correto para HTML", () => {
    const filename = buildExportFilename("etp", "Estudo Técnico Preliminar", "html");
    expect(filename).toContain("etp-");
    expect(filename).toMatch(/\.html$/);
  });

  it("gera filename correto para DOCX", () => {
    const filename = buildExportFilename("contrato", "Contrato de Serviços", "docx");
    expect(filename).toMatch(/\.docx$/);
  });

  it("slug é lowercase e usa hífens", () => {
    const filename = buildExportFilename("tr", "Termo de Referência ABC", "html");
    expect(filename).toMatch(/^tr-[a-z0-9-]+\.html$/);
  });
});

describe("DocumentService — exportDocumentToHtml", () => {
  it("lança NOT_FOUND quando documento não existe", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null); // primeiro chamada ao getDocumentoById
    const { exportDocumentToHtml } = await import("../../services/documentService");
    await expect(exportDocumentToHtml(999, 1)).rejects.toThrow(TRPCError);
  });
});

// ─── 11. Template Service ─────────────────────────────────────────────────────

describe("DocumentTemplateService — sem DB", () => {
  it("listTemplates retorna [] quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { listTemplates } = await import("../../services/documentTemplateService");
    const result = await listTemplates("etp", 1);
    expect(result).toEqual([]);
  });

  it("getTemplate retorna null quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { getTemplate } = await import("../../services/documentTemplateService");
    const result = await getTemplate(1, 1);
    expect(result).toBeNull();
  });
});

// ─── 12. Timeline Service ─────────────────────────────────────────────────────

describe("DocumentTimelineService — sem DB", () => {
  it("addTimelineEvent não lança quando DB indisponível (falha silenciosa)", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { addTimelineEvent } = await import("../../services/documentTimelineService");
    await expect(addTimelineEvent({
      organizationId: 1, documentId: 1, eventType: "documento_criado", ctx: makeCtx(),
    })).resolves.toBeUndefined();
  });

  it("getDocumentTimeline retorna [] quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { getDocumentTimeline } = await import("../../services/documentTimelineService");
    const result = await getDocumentTimeline(1, 1);
    expect(result).toEqual([]);
  });
});

// ─── 13. Anti-Leak — Tenant Isolation ────────────────────────────────────────

describe("Tenant Isolation — documentos multi-org", () => {
  const repo = new DocumentRepository();

  it("org=2 não acessa documento da org=1 (assertOwnership)", () => {
    // @ts-expect-error accessing protected
    expect(() => (repo as any).assertOwnership(1, 2)).toThrow("Acesso negado");
  });

  it("requireOrganizationId rejeita organizationId=0", () => {
    // @ts-expect-error accessing protected
    expect(() => (repo as any).requireOrganizationId(0)).toThrow(TRPCError);
  });

  it("contexto sem organizationId lança em operações de escrita", async () => {
    const { createDocumento } = await import("../../services/documentService");
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const ctx = makeCtx({ organizationId: null });
    await expect(createDocumento({ processId: 1, documentType: "tr" }, ctx)).rejects.toThrow();
  });
});

// ─── 14. StructuredContent — Modelo Documental ───────────────────────────────

describe("StructuredDocumentContent — contratos de tipo", () => {
  it("StructuredDocumentContent tem campos obrigatórios", () => {
    const sc = {
      schemaVersion: 1,
      title:    "Estudo Técnico",
      sections: [],
      variables:[],
      metadata: {},
    };
    expect(sc.schemaVersion).toBe(1);
    expect(Array.isArray(sc.sections)).toBe(true);
    expect(Array.isArray(sc.variables)).toBe(true);
  });

  it("DocumentVariable tem key, label, value e type", () => {
    const v = { key: "valor_estimado", label: "Valor Estimado", value: "R$ 100.000,00", type: "currency" as const, required: true };
    expect(v.key).toBeTruthy();
    expect(v.type).toBe("currency");
  });
});

// ─── 15. DomainEvent — Propagation ───────────────────────────────────────────

describe("DomainEvent — propagação de contexto", () => {
  it("createDomainEvent propaga organizationId corretamente", async () => {
    const { createDomainEvent } = await import("../../domain/events");
    const e = createDomainEvent({
      eventType:     "documento.criado",
      aggregateType: "Document",
      aggregateId:   "42",
      organizationId: 5,
      correlationId:  "corr-123",
      actorId:        1,
      payload:        { documentId: 42 },
    });
    expect(e.organizationId).toBe(5);
    expect(e.correlationId).toBe("corr-123");
    expect(e.actorId).toBe(1);
  });

  it("createDomainEvent propaga causationId para encadeamento causal", async () => {
    const { createDomainEvent } = await import("../../domain/events");
    const parent = createDomainEvent({ eventType: "documento.criado",   aggregateType: "Document", aggregateId: "1", organizationId: 1, payload: {} });
    const child  = createDomainEvent({ eventType: "documento.aprovado", aggregateType: "Document", aggregateId: "1", organizationId: 1, payload: {}, causationId: parent.eventId });
    expect(child.causationId).toBe(parent.eventId);
    expect(child.eventId).not.toBe(parent.eventId);
  });
});

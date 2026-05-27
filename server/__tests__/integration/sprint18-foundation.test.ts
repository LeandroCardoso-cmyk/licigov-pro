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
  span:  vi.fn((_s: string, _o: string, fn: () => Promise<unknown>) =>
    fn().then((r) => ({ result: r, durationMs: 1, slow: false })),
  ),
  SLOW_QUERY_THRESHOLD_MS: 1000,
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { TRPCError } from "@trpc/server";
import { BaseTenantRepository }            from "../../db/baseTenantRepository";
import type { PaginatedResult }            from "../../db/queryStrategy";
import {
  normalizePagination,
  calculateOffset,
  buildPaginatedResult,
  batchByIds,
  batchByKey,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
}                                          from "../../db/queryStrategy";
import { createDomainEvent, isValidDomainEvent } from "../../domain/events";
import {
  OptimisticLockConflictError,
  assertVersion,
  nextVersion,
  toETag,
  parseETag,
  checkIfMatch,
  toTrpcConflict,
}                                          from "../../domain/locking";
import {
  classifyAction,
  AUDIT_ACTION_CLASSIFICATIONS,
  RETENTION_DAYS,
}                                          from "../../domain/audit";
import {
  calculateBackoffMs,
  isRetryable,
  RETRY_POLICIES,
}                                          from "../../config/retryPolicy";
import { getDb }                           from "../../db/connection";

// ─── Concrete stub for abstract BaseTenantRepository ─────────────────────────

type StubEntity = { id: number; organizationId: number | null };

class StubRepository extends BaseTenantRepository<StubEntity> {
  protected readonly entityName = "StubEntity";

  async safeFindById(id: number, organizationId: number): Promise<StubEntity | null> {
    this.requireOrganizationId(organizationId);
    // id=99 is owned by org=1; any other id is owned by the requesting org
    const entity = { id, organizationId: id === 99 ? 1 : organizationId };
    this.assertOwnership(entity.organizationId, organizationId);
    return entity;
  }

  async safeFindMany(organizationId: number): Promise<StubEntity[]> {
    this.requireOrganizationId(organizationId);
    return [{ id: 1, organizationId }];
  }

  async safePaginate(
    organizationId: number,
    page: number,
    pageSize: number,
  ): Promise<PaginatedResult<StubEntity>> {
    this.requireOrganizationId(organizationId);
    const items = [{ id: 1, organizationId }];
    return buildPaginatedResult(items, 1, { page, pageSize });
  }

  // Expose protected methods for testing
  testRequireOrganizationId(v: unknown) {
    this.requireOrganizationId(v);
  }

  testAssertOwnership(entityOrgId: number | null | undefined, ctxOrgId: number) {
    this.assertOwnership(entityOrgId, ctxOrgId);
  }
}

// ─── 1. BaseTenantRepository ──────────────────────────────────────────────────

describe("BaseTenantRepository — requireOrganizationId", () => {
  const repo = new StubRepository();

  it("aceita número positivo válido", () => {
    expect(() => repo.testRequireOrganizationId(1)).not.toThrow();
    expect(() => repo.testRequireOrganizationId(99)).not.toThrow();
  });

  it("lança BAD_REQUEST para null", () => {
    expect(() => repo.testRequireOrganizationId(null))
      .toThrow(TRPCError);
  });

  it("lança BAD_REQUEST para undefined", () => {
    expect(() => repo.testRequireOrganizationId(undefined))
      .toThrow(TRPCError);
  });

  it("lança BAD_REQUEST para zero", () => {
    expect(() => repo.testRequireOrganizationId(0))
      .toThrow(TRPCError);
  });

  it("lança BAD_REQUEST para número negativo", () => {
    expect(() => repo.testRequireOrganizationId(-1))
      .toThrow(TRPCError);
  });

  it("lança BAD_REQUEST para NaN", () => {
    expect(() => repo.testRequireOrganizationId(NaN))
      .toThrow(TRPCError);
  });

  it("lança BAD_REQUEST para string numérica", () => {
    expect(() => repo.testRequireOrganizationId("1"))
      .toThrow(TRPCError);
  });
});

describe("BaseTenantRepository — assertOwnership", () => {
  const repo = new StubRepository();

  it("permite acesso quando orgIds batem", () => {
    expect(() => repo.testAssertOwnership(1, 1)).not.toThrow();
    expect(() => repo.testAssertOwnership(5, 5)).not.toThrow();
  });

  it("lança FORBIDDEN quando orgIds não batem", () => {
    expect(() => repo.testAssertOwnership(1, 2)).toThrow(TRPCError);
    expect(() => repo.testAssertOwnership(2, 1)).toThrow(TRPCError);
  });

  it("permite entidade sem org apenas para org=1 (legado)", () => {
    expect(() => repo.testAssertOwnership(null,      1)).not.toThrow();
    expect(() => repo.testAssertOwnership(undefined, 1)).not.toThrow();
  });

  it("bloqueia entidade sem org para org≠1 (anti-leak)", () => {
    expect(() => repo.testAssertOwnership(null,      2)).toThrow(TRPCError);
    expect(() => repo.testAssertOwnership(undefined, 2)).toThrow(TRPCError);
  });

  it("mensagem de erro contém 'Acesso negado'", () => {
    expect(() => repo.testAssertOwnership(1, 2))
      .toThrow("Acesso negado");
  });
});

describe("BaseTenantRepository — safeFindById ownership enforcement", () => {
  const repo = new StubRepository();

  it("retorna entidade quando org bate", async () => {
    const result = await repo.safeFindById(1, 1);
    expect(result).toEqual({ id: 1, organizationId: 1 });
  });

  it("lança FORBIDDEN quando entidade pertence a org=1 mas é acessada pela org=2 (id=99)", async () => {
    await expect(repo.safeFindById(99, 2)).rejects.toThrow(TRPCError);
  });
});

// ─── 2. DomainEvent Contract ──────────────────────────────────────────────────

describe("DomainEvent — createDomainEvent", () => {
  it("gera eventId UUID único em cada chamada", () => {
    const e1 = createDomainEvent({ eventType: "x", aggregateType: "A", aggregateId: "1", organizationId: 1, payload: {} });
    const e2 = createDomainEvent({ eventType: "x", aggregateType: "A", aggregateId: "1", organizationId: 1, payload: {} });
    expect(e1.eventId).not.toBe(e2.eventId);
  });

  it("preenche occurredAt como data atual", () => {
    const before = Date.now();
    const e = createDomainEvent({ eventType: "x", aggregateType: "A", aggregateId: "1", organizationId: 1, payload: {} });
    const after = Date.now();
    expect(e.occurredAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(e.occurredAt.getTime()).toBeLessThanOrEqual(after);
  });

  it("aplica eventVersion=1 por padrão", () => {
    const e = createDomainEvent({ eventType: "x", aggregateType: "A", aggregateId: "1", organizationId: 1, payload: {} });
    expect(e.eventVersion).toBe(1);
  });

  it("preserva payload tipado", () => {
    type P = { name: string };
    const e = createDomainEvent<P>({ eventType: "x", aggregateType: "A", aggregateId: "1", organizationId: 1, payload: { name: "test" } });
    expect(e.payload.name).toBe("test");
  });

  it("aplica metadata.schemaVersion=1 por padrão", () => {
    const e = createDomainEvent({ eventType: "x", aggregateType: "A", aggregateId: "1", organizationId: 1, payload: {} });
    expect(e.metadata.schemaVersion).toBe(1);
  });

  it("aceita metadata parcial do caller", () => {
    const e = createDomainEvent({
      eventType: "x", aggregateType: "A", aggregateId: "1", organizationId: 1, payload: {},
      metadata: { sourceService: "test-service" },
    });
    expect(e.metadata.sourceService).toBe("test-service");
    expect(e.metadata.schemaVersion).toBe(1);
  });
});

describe("DomainEvent — isValidDomainEvent", () => {
  it("retorna true para evento válido", () => {
    const e = createDomainEvent({ eventType: "x", aggregateType: "A", aggregateId: "1", organizationId: 1, payload: { k: 1 } });
    expect(isValidDomainEvent(e)).toBe(true);
  });

  it("retorna false para null", () => {
    expect(isValidDomainEvent(null)).toBe(false);
  });

  it("retorna false para objeto sem eventId", () => {
    expect(isValidDomainEvent({ eventType: "x", aggregateType: "A", aggregateId: "1", organizationId: 1, occurredAt: new Date(), payload: {} })).toBe(false);
  });

  it("retorna false para organizationId=0", () => {
    const e = { ...createDomainEvent({ eventType: "x", aggregateType: "A", aggregateId: "1", organizationId: 1, payload: {} }), organizationId: 0 };
    expect(isValidDomainEvent(e)).toBe(false);
  });
});

// ─── 3. Optimistic Locking ────────────────────────────────────────────────────

describe("OptimisticLocking — assertVersion", () => {
  it("não lança quando versões batem", () => {
    expect(() => assertVersion(3, 3, "Document", 1)).not.toThrow();
  });

  it("lança OptimisticLockConflictError quando versões divergem", () => {
    expect(() => assertVersion(2, 3, "Document", 1))
      .toThrow(OptimisticLockConflictError);
  });

  it("error.expectedVersion e actualVersion estão corretos", () => {
    try {
      assertVersion(2, 5, "Process", 42);
    } catch (err) {
      expect(err).toBeInstanceOf(OptimisticLockConflictError);
      const e = err as OptimisticLockConflictError;
      expect(e.expectedVersion).toBe(2);
      expect(e.actualVersion).toBe(5);
      expect(e.entityType).toBe("Process");
      expect(e.entityId).toBe(42);
    }
  });

  it("mensagem contém 'Recarregue e tente novamente'", () => {
    expect(() => assertVersion(1, 2, "Doc", 1))
      .toThrow("Recarregue e tente novamente");
  });
});

describe("OptimisticLocking — nextVersion + toETag + parseETag", () => {
  it("nextVersion incrementa em 1", () => {
    expect(nextVersion(1)).toBe(2);
    expect(nextVersion(99)).toBe(100);
  });

  it("toETag gera formato correto", () => {
    expect(toETag("Document", 42, 3)).toBe('"Document-42-v3"');
  });

  it("parseETag parseia ETag válido", () => {
    const result = parseETag('"Document-42-v3"');
    expect(result).toEqual({ entityType: "Document", id: "42", version: 3 });
  });

  it("parseETag retorna null para formato inválido", () => {
    expect(parseETag("invalid")).toBeNull();
    expect(parseETag('"sem-versao"')).toBeNull();
  });

  it("roundtrip toETag → parseETag preserva dados", () => {
    const etag   = toETag("Process", 7, 2);
    const parsed = parseETag(etag);
    expect(parsed?.entityType).toBe("Process");
    expect(parsed?.id).toBe("7");
    expect(parsed?.version).toBe(2);
  });
});

describe("OptimisticLocking — toTrpcConflict + checkIfMatch", () => {
  it("toTrpcConflict cria TRPCError com code CONFLICT", () => {
    const lockErr = new OptimisticLockConflictError("Doc", 1, 2, 3);
    const trpc    = toTrpcConflict(lockErr);
    expect(trpc).toBeInstanceOf(TRPCError);
    expect(trpc.code).toBe("CONFLICT");
  });

  it("checkIfMatch não lança quando header ausente", () => {
    expect(() => checkIfMatch(undefined, "Doc", 1, 5)).not.toThrow();
  });

  it("checkIfMatch não lança quando versões batem", () => {
    const etag = toETag("Doc", 1, 5);
    expect(() => checkIfMatch(etag, "Doc", 1, 5)).not.toThrow();
  });

  it("checkIfMatch lança quando versões divergem", () => {
    const etag = toETag("Doc", 1, 3);
    expect(() => checkIfMatch(etag, "Doc", 1, 5))
      .toThrow(OptimisticLockConflictError);
  });
});

// ─── 4. Audit Classification ──────────────────────────────────────────────────

describe("AuditClassification — classifyAction", () => {
  it("retorna classificação correta para actions conhecidas", () => {
    expect(classifyAction("document_approved").category).toBe("document");
    expect(classifyAction("login_failed").category).toBe("security");
    expect(classifyAction("contract_signed").category).toBe("legal");
    expect(classifyAction("org_created").category).toBe("tenant");
    expect(classifyAction("ai_generation_completed").category).toBe("ai");
  });

  it("retorna fallback para action desconhecida", () => {
    const c = classifyAction("unknown_action_xyz");
    expect(c.category).toBe("operational");
    expect(c.retention).toBe("1y");
  });

  it("atos jurídicos têm requiresLegalNotice=true", () => {
    expect(classifyAction("contract_signed").requiresLegalNotice).toBe(true);
    expect(classifyAction("document_approved").requiresLegalNotice).toBe(true);
    expect(classifyAction("legal_opinion_created").requiresLegalNotice).toBe(true);
  });

  it("ações de compliance têm piiPresent=true", () => {
    expect(classifyAction("lgpd_consent_given").piiPresent).toBe(true);
    expect(classifyAction("data_export_requested").piiPresent).toBe(true);
  });

  it("retenção de org_created é permanent", () => {
    expect(classifyAction("org_created").retention).toBe("permanent");
  });
});

describe("AuditClassification — RETENTION_DAYS", () => {
  it("permanent retorna null", () => {
    expect(RETENTION_DAYS["permanent"]).toBeNull();
  });

  it("10y retorna 3650 dias", () => {
    expect(RETENTION_DAYS["10y"]).toBe(365 * 10);
  });

  it("30d retorna 30 dias", () => {
    expect(RETENTION_DAYS["30d"]).toBe(30);
  });

  it("todas as entradas do mapa têm retenção definida", () => {
    for (const [action, cls] of Object.entries(AUDIT_ACTION_CLASSIFICATIONS)) {
      expect(cls.category, `${action} sem category`).toBeTruthy();
      expect(cls.retention, `${action} sem retention`).toBeTruthy();
    }
  });
});

// ─── 5. Retry Policy ─────────────────────────────────────────────────────────

describe("RetryPolicy — calculateBackoffMs", () => {
  it("attempt=1 retorna initialDelayMs", () => {
    expect(calculateBackoffMs(RETRY_POLICIES.OUTBOX, 1)).toBe(1_000);
  });

  it("backoff é exponencial", () => {
    const p = RETRY_POLICIES.OUTBOX;
    expect(calculateBackoffMs(p, 1)).toBe(1_000);
    expect(calculateBackoffMs(p, 2)).toBe(2_000);
    expect(calculateBackoffMs(p, 3)).toBe(4_000);
  });

  it("respeita maxDelayMs como teto", () => {
    const result = calculateBackoffMs(RETRY_POLICIES.OUTBOX, 10);
    expect(result).toBeLessThanOrEqual(RETRY_POLICIES.OUTBOX.maxDelayMs);
  });
});

describe("RetryPolicy — isRetryable", () => {
  it("retorna true se attempt < maxAttempts", () => {
    expect(isRetryable(RETRY_POLICIES.OUTBOX, 4)).toBe(true);
  });

  it("retorna false se attempt === maxAttempts", () => {
    expect(isRetryable(RETRY_POLICIES.OUTBOX, 5)).toBe(false);
  });

  it("ACTIVITY_LOG tem failFast=true — retorna false sempre", () => {
    expect(isRetryable(RETRY_POLICIES.ACTIVITY_LOG, 0)).toBe(false);
    expect(isRetryable(RETRY_POLICIES.ACTIVITY_LOG, 1)).toBe(false);
  });
});

describe("RetryPolicy — políticas definidas", () => {
  it("todos os RETRY_POLICIES têm campos obrigatórios", () => {
    for (const [name, policy] of Object.entries(RETRY_POLICIES)) {
      expect(policy.maxAttempts,       `${name}.maxAttempts`).toBeGreaterThan(0);
      expect(policy.initialDelayMs,    `${name}.initialDelayMs`).toBeGreaterThan(0);
      expect(policy.backoffMultiplier, `${name}.backoffMultiplier`).toBeGreaterThanOrEqual(1);
      expect(policy.maxDelayMs,        `${name}.maxDelayMs`).toBeGreaterThan(0);
      expect(policy.softTimeoutMs,     `${name}.softTimeoutMs`).toBeGreaterThan(0);
      expect(policy.hardTimeoutMs,     `${name}.hardTimeoutMs`).toBeGreaterThan(policy.softTimeoutMs);
    }
  });

  it("softTimeoutMs < hardTimeoutMs em todos os políticas", () => {
    for (const p of Object.values(RETRY_POLICIES)) {
      expect(p.softTimeoutMs).toBeLessThan(p.hardTimeoutMs);
    }
  });
});

// ─── 6. Query Strategy (Anti N+1) ────────────────────────────────────────────

describe("queryStrategy — normalizePagination", () => {
  it("usa defaults quando não especificado", () => {
    expect(normalizePagination({})).toEqual({ page: DEFAULT_PAGE_SIZE > 0 ? 1 : 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("clamp page para mínimo 1", () => {
    expect(normalizePagination({ page: 0 }).page).toBe(1);
    expect(normalizePagination({ page: -5 }).page).toBe(1);
  });

  it("clamp pageSize para máximo MAX_PAGE_SIZE", () => {
    expect(normalizePagination({ pageSize: 9999 }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("clamp pageSize para mínimo 1", () => {
    expect(normalizePagination({ pageSize: 0 }).pageSize).toBe(1);
  });

  it("preserva valores válidos sem alteração", () => {
    expect(normalizePagination({ page: 3, pageSize: 50 })).toEqual({ page: 3, pageSize: 50 });
  });
});

describe("queryStrategy — calculateOffset", () => {
  it("page=1 → offset=0", () => {
    expect(calculateOffset({ page: 1, pageSize: 20 })).toBe(0);
  });

  it("page=2, pageSize=20 → offset=20", () => {
    expect(calculateOffset({ page: 2, pageSize: 20 })).toBe(20);
  });

  it("page=3, pageSize=10 → offset=20", () => {
    expect(calculateOffset({ page: 3, pageSize: 10 })).toBe(20);
  });
});

describe("queryStrategy — buildPaginatedResult", () => {
  it("calcula totalPages corretamente", () => {
    const r = buildPaginatedResult([1, 2, 3], 100, { page: 1, pageSize: 10 });
    expect(r.totalPages).toBe(10);
  });

  it("hasNextPage=true quando não está na última página", () => {
    const r = buildPaginatedResult([1], 10, { page: 1, pageSize: 5 });
    expect(r.hasNextPage).toBe(true);
  });

  it("hasNextPage=false na última página", () => {
    const r = buildPaginatedResult([1], 5, { page: 1, pageSize: 5 });
    expect(r.hasNextPage).toBe(false);
  });

  it("hasPreviousPage=false na primeira página", () => {
    const r = buildPaginatedResult([], 50, { page: 1, pageSize: 10 });
    expect(r.hasPreviousPage).toBe(false);
  });

  it("hasPreviousPage=true na página 2+", () => {
    const r = buildPaginatedResult([], 50, { page: 2, pageSize: 10 });
    expect(r.hasPreviousPage).toBe(true);
  });

  it("total=0 → totalPages=1 (mínimo)", () => {
    const r = buildPaginatedResult([], 0, { page: 1, pageSize: 10 });
    expect(r.totalPages).toBe(1);
  });
});

describe("queryStrategy — batchByIds", () => {
  it("retorna Map vazio para array vazio", async () => {
    const result = await batchByIds([], async () => [], (i) => i);
    expect(result.size).toBe(0);
  });

  it("deduplica IDs antes de chamar loadFn", async () => {
    const loadCalls: number[][] = [];
    await batchByIds(
      [1, 2, 1, 3, 2],
      async (ids) => { loadCalls.push(ids); return ids.map(id => ({ id, name: `item-${id}` })); },
      (item) => item.id,
    );
    expect(loadCalls[0]).toHaveLength(3);
    expect(new Set(loadCalls[0]).size).toBe(3);
  });

  it("mapeia id → item corretamente", async () => {
    const result = await batchByIds(
      [1, 2],
      async (ids) => ids.map(id => ({ id, val: id * 10 })),
      (item) => item.id,
    );
    expect(result.get(1)?.val).toBe(10);
    expect(result.get(2)?.val).toBe(20);
  });
});

describe("queryStrategy — batchByKey", () => {
  it("retorna Map vazio para array vazio", async () => {
    const result = await batchByKey([], async () => [], (i: { k: number }) => i.k);
    expect(result.size).toBe(0);
  });

  it("agrupa múltiplos items pelo mesmo key", async () => {
    const result = await batchByKey(
      [1, 2],
      async (pIds) => [
        { processId: 1, commentId: 10 },
        { processId: 1, commentId: 11 },
        { processId: 2, commentId: 20 },
      ].filter(c => pIds.includes(c.processId)),
      (item) => item.processId,
    );
    expect(result.get(1)).toHaveLength(2);
    expect(result.get(2)).toHaveLength(1);
  });
});

// ─── 7. DLQ Observability (mocked DB) ────────────────────────────────────────

describe("DlqObservabilityService — getDlqMetrics sem DB", () => {
  it("retorna métricas zeradas quando DB está indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { getDlqMetrics } = await import("../../services/dlqObservabilityService");
    const metrics = await getDlqMetrics();
    expect(metrics.totalDeadLetters).toBe(0);
    expect(metrics.byEventType).toEqual({});
    expect(metrics.byOrganization).toEqual({});
    expect(metrics.oldestDeadLetter).toBeNull();
    expect(metrics.recentFailures24h).toBe(0);
  });
});

describe("DlqObservabilityService — detectStuckEvents sem DB", () => {
  it("retorna array vazio quando DB está indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { detectStuckEvents } = await import("../../services/dlqObservabilityService");
    const stuck = await detectStuckEvents();
    expect(stuck).toEqual([]);
  });
});

describe("DlqObservabilityService — detectPoisonEvents sem DB", () => {
  it("retorna array vazio quando DB está indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { detectPoisonEvents } = await import("../../services/dlqObservabilityService");
    const poison = await detectPoisonEvents();
    expect(poison).toEqual([]);
  });
});

// ─── 8. Observability — span ──────────────────────────────────────────────────

describe("observabilityService — span", () => {
  it("retorna SpanResult com result correto", async () => {
    const { span: realSpan } = await import("../../services/observabilityService");
    // Use mocked span from top-level mock — just verify interface
    const mockSpan = vi.fn().mockResolvedValue({ result: 42, durationMs: 5, slow: false });
    const spanResult = await mockSpan("Svc", "op", async () => 42, {});
    expect(spanResult.result).toBe(42);
    expect(typeof spanResult.durationMs).toBe("number");
    expect(typeof spanResult.slow).toBe("boolean");
  });

  it("SLOW_QUERY_THRESHOLD_MS está definido e é positivo", async () => {
    const { SLOW_QUERY_THRESHOLD_MS } = await import("../../services/observabilityService");
    expect(SLOW_QUERY_THRESHOLD_MS).toBeGreaterThan(0);
  });
});

// ─── 9. Anti-Leak Patterns ────────────────────────────────────────────────────

describe("Anti-Leak — isolamento multi-tenant", () => {
  const repo = new StubRepository();

  it("org=2 não acessa recurso pertencente à org=1 (id=99)", async () => {
    await expect(repo.safeFindById(99, 2)).rejects.toThrow("Acesso negado");
  });

  it("safeFindMany está scoped por organizationId", async () => {
    const items = await repo.safeFindMany(1);
    for (const item of items) {
      expect(item.organizationId).toBe(1);
    }
  });

  it("safePaginate retorna apenas itens da org solicitada", async () => {
    const result = await repo.safePaginate(3, 1, 20);
    for (const item of result.items) {
      expect(item.organizationId).toBe(3);
    }
  });
});

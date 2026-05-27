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
    span:  vi.fn((_op: string, fn: () => Promise<unknown>) =>
      fn().then((r) => ({ result: r, durationMs: 1, slow: false }))),
    timed: vi.fn((_op: string, fn: () => Promise<unknown>) => fn()),
  }),
  structuredLog: vi.fn(),
  timed: vi.fn((_s: string, _o: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("../../services/outboxService", () => ({
  appendOutboxEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/activityLogService", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
  logFromCtx:  vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/documentTimelineService", () => ({
  addTimelineEvent:         vi.fn().mockResolvedValue(undefined),
  getDocumentTimeline:      vi.fn().mockResolvedValue([]),
  paginateDocumentTimeline: vi.fn().mockResolvedValue({
    items: [], total: 0, page: 1, pageSize: 20, totalPages: 0, hasNextPage: false, hasPreviousPage: false,
  }),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import {
  evaluatePolicy,
  assertPolicy,
  evaluatePolicies,
} from "../../domain/documentPolicy";
import type { PolicyEvaluationContext, PolicyAction } from "../../domain/documentPolicy";

import {
  computeDiff,
  diffBlocks,
  diffSections,
  diffVariables,
  diffMetadata,
} from "../../domain/documentDiff";

import {
  getRetentionPolicy,
  computePurgeDate,
  isEligibleForPurge,
  applyLegalHold,
  RETENTION_POLICIES,
  DOCUMENT_TYPE_RETENTION,
} from "../../domain/documentRetention";

import {
  hashContent,
  computeSnapshotFingerprint,
  validateIntegrity,
  buildIntegrityRecord,
  computeRenderChecksum,
} from "../../domain/documentIntegrity";

import {
  isFormatSupported,
  SUPPORTED_FORMATS,
} from "../../services/documentRenderService";

import {
  detectAutosaveCollision,
} from "../../services/documentConcurrencyService";

import type { LockStatus } from "../../services/documentConcurrencyService";

import { getDb } from "../../db/connection";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDoc(overrides?: Partial<{
  organizationId: number;
  createdBy:      number;
  documentStatus: string;
  isLocked:       number;
  lockedBy:       number | null;
  lockExpiresAt:  Date | null;
  legalHold:      number;
}>) {
  return {
    organizationId: overrides?.organizationId ?? 1,
    createdBy:      overrides?.createdBy      ?? 10,
    documentStatus: (overrides?.documentStatus ?? "draft") as any,
    isLocked:       overrides?.isLocked       ?? 0,
    lockedBy:       overrides?.lockedBy       ?? null,
    lockExpiresAt:  overrides?.lockExpiresAt  ?? null,
    legalHold:      overrides?.legalHold      ?? 0,
  };
}

function makeCtxPolicy(overrides?: Partial<{
  actorId:        number;
  actorRole:      string;
  organizationId: number;
}>): PolicyEvaluationContext {
  return {
    actorId:        overrides?.actorId        ?? 1,
    actorRole:      (overrides?.actorRole     ?? "manager") as any,
    organizationId: overrides?.organizationId ?? 1,
    document:       makeDoc(),
  };
}

// ─── 1. DocumentPolicyEngine — evaluatePolicy ─────────────────────────────────

describe("DocumentPolicyEngine — evaluatePolicy", () => {

  it("nega tenant diferente em qualquer ação", () => {
    const ctx = makeCtxPolicy({ organizationId: 2 });
    // document.organizationId = 1, actorOrg = 2
    expect(evaluatePolicy("edit", ctx).allowed).toBe(false);
    expect(evaluatePolicy("edit", ctx).reason).toMatch(/outra organização/i);
  });

  it("viewer pode comentar em draft", () => {
    const ctx: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "viewer" }),
      document: makeDoc({ documentStatus: "draft" }),
    };
    expect(evaluatePolicy("comment", ctx).allowed).toBe(true);
  });

  it("viewer não pode editar", () => {
    const ctx: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "viewer" }),
      document: makeDoc({ documentStatus: "draft" }),
    };
    expect(evaluatePolicy("edit", ctx).allowed).toBe(false);
    expect(evaluatePolicy("edit", ctx).reason).toMatch(/operator/i);
  });

  it("operator pode editar draft", () => {
    const ctx: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "operator" }),
      document: makeDoc({ documentStatus: "draft" }),
    };
    expect(evaluatePolicy("edit", ctx).allowed).toBe(true);
  });

  it("ninguém pode editar documento arquivado", () => {
    const ctx: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "owner" }),
      document: makeDoc({ documentStatus: "archived" }),
    };
    expect(evaluatePolicy("edit", ctx).allowed).toBe(false);
    expect(evaluatePolicy("edit", ctx).reason).toMatch(/arquivado/i);
  });

  it("operator não pode editar documento aprovado", () => {
    const ctx: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "operator" }),
      document: makeDoc({ documentStatus: "approved" }),
    };
    expect(evaluatePolicy("edit", ctx).allowed).toBe(false);
  });

  it("admin pode editar documento aprovado", () => {
    const ctx: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "admin" }),
      document: makeDoc({ documentStatus: "approved" }),
    };
    expect(evaluatePolicy("edit", ctx).allowed).toBe(true);
  });

  it("documento bloqueado por outro nega edição", () => {
    const futureExp = new Date(Date.now() + 60_000);
    const ctx: PolicyEvaluationContext = {
      actorId:        1,
      actorRole:      "manager",
      organizationId: 1,
      document:       makeDoc({ isLocked: 1, lockedBy: 99, lockExpiresAt: futureExp }),
    };
    expect(evaluatePolicy("edit", ctx).allowed).toBe(false);
    expect(evaluatePolicy("edit", ctx).reason).toMatch(/bloqueado/i);
  });

  it("lock expirado não bloqueia edição", () => {
    const pastExp = new Date(Date.now() - 1000);
    const ctx: PolicyEvaluationContext = {
      actorId:        1,
      actorRole:      "operator",
      organizationId: 1,
      document:       makeDoc({ isLocked: 1, lockedBy: 99, lockExpiresAt: pastExp }),
    };
    expect(evaluatePolicy("edit", ctx).allowed).toBe(true);
  });

  it("somente manager+ pode aprovar in_review", () => {
    const ctxOp: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "operator" }),
      document: makeDoc({ documentStatus: "in_review" }),
    };
    const ctxMgr: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "manager" }),
      document: makeDoc({ documentStatus: "in_review" }),
    };
    expect(evaluatePolicy("approve", ctxOp).allowed).toBe(false);
    expect(evaluatePolicy("approve", ctxMgr).allowed).toBe(true);
  });

  it("somente manager+ pode arquivar", () => {
    const ctx: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "manager" }),
      document: makeDoc({ documentStatus: "draft" }),
    };
    expect(evaluatePolicy("archive", ctx).allowed).toBe(true);
  });

  it("documento com legalHold não pode ser arquivado", () => {
    const ctx: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "manager" }),
      document: makeDoc({ documentStatus: "draft", legalHold: 1 }),
    };
    expect(evaluatePolicy("archive", ctx).allowed).toBe(false);
    expect(evaluatePolicy("archive", ctx).reason).toMatch(/legal hold/i);
  });

  it("owner pode purgar; operador não pode", () => {
    const docCtx = makeDoc({ documentStatus: "archived", legalHold: 0 });
    const ctxOwner: PolicyEvaluationContext   = { actorId: 1, actorRole: "owner",   organizationId: 1, document: docCtx };
    const ctxOperator: PolicyEvaluationContext = { actorId: 1, actorRole: "operator", organizationId: 1, document: docCtx };
    expect(evaluatePolicy("purge", ctxOwner).allowed).toBe(true);
    expect(evaluatePolicy("purge", ctxOperator).allowed).toBe(false);
  });

  it("assertPolicy lança FORBIDDEN quando negado", () => {
    const ctx: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "viewer" }),
      document: makeDoc(),
    };
    expect(() => assertPolicy("edit", ctx)).toThrow(/FORBIDDEN|operator/i);
  });

  it("evaluatePolicies retorna mapa de resultados", () => {
    const ctx = makeCtxPolicy({ actorRole: "operator" });
    const actions: PolicyAction[] = ["edit", "approve", "export"];
    const results = evaluatePolicies(actions, { ...ctx, document: makeDoc({ documentStatus: "draft" }) });
    expect(results.edit.allowed).toBe(true);
    expect(results.approve.allowed).toBe(false);
    expect(results.export.allowed).toBe(true);
  });
});

// ─── 2. DocumentDiffEngine ────────────────────────────────────────────────────

describe("DocumentDiffEngine — computeDiff", () => {

  it("diff sem mudanças retorna severity=none e totalChanges=0", () => {
    const d = computeDiff(1, 1, 1, 2, "Mesmo texto", "Mesmo texto", null, null);
    expect(d.summary.severity).toBe("none");
    expect(d.summary.totalChanges).toBe(0);
    expect(d.textDiff.hasChanges).toBe(false);
  });

  it("mudança de texto atualiza textDiff", () => {
    const d = computeDiff(1, 1, 1, 2, "Texto A", "Texto B diferente mais longo", null, null);
    expect(d.textDiff.hasChanges).toBe(true);
    expect(d.textDiff.changeType).toBe("modified");
    expect(d.textDiff.addedChars).toBeGreaterThan(0);
  });

  it("block adicionado detectado em sectionDiffs", () => {
    const before = { sections: [{ id: "s1", title: "Seção", order: 0, blocks: [] }], variables: [], metadata: {} };
    const after  = {
      sections: [{
        id: "s1", title: "Seção", order: 0,
        blocks: [{ id: "b1", type: "paragraph" as const, content: "Novo bloco", order: 0 }],
      }],
      variables: [],
      metadata: {},
    };
    const d = computeDiff(1, 1, 1, 2, null, null, before as any, after as any);
    expect(d.structuredDiff.totalChangedBlocks).toBe(1);
    expect(d.structuredDiff.hasSectionChanges).toBe(true);
  });

  it("seção removida aparece como removed", () => {
    const before = { sections: [{ id: "s1", title: "A", order: 0, blocks: [] }], variables: [], metadata: {} };
    const after  = { sections: [], variables: [], metadata: {} };
    const d = computeDiff(1, 1, 1, 2, null, null, before as any, after as any);
    expect(d.structuredDiff.sectionDiffs.some(s => s.changeType === "removed")).toBe(true);
  });

  it("variáveis modificadas capturadas em variableDiffs", () => {
    const before = { sections: [], variables: [{ key: "objeto", label: "Objeto", value: "Anterior" }], metadata: {} };
    const after  = { sections: [], variables: [{ key: "objeto", label: "Objeto", value: "Posterior" }], metadata: {} };
    const d = computeDiff(1, 1, 1, 2, null, null, before as any, after as any);
    const varDiff = d.structuredDiff.variableDiffs.find(v => v.key === "objeto");
    expect(varDiff?.changeType).toBe("modified");
    expect(varDiff?.before).toBe("Anterior");
    expect(varDiff?.after).toBe("Posterior");
  });

  it("severity é major quando totalChanges > 10", () => {
    const before = { sections: [], variables: Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, value: "x" })), metadata: {} };
    const after  = { sections: [], variables: Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, label: `K${i}`, value: "y" })), metadata: {} };
    const d = computeDiff(1, 1, 1, 2, null, null, before as any, after as any);
    expect(d.summary.severity).toBe("major");
  });

  it("diffBlocks identifica block modificado", () => {
    const before = [{ id: "b1", type: "paragraph" as const, content: "Antes", order: 0 }];
    const after  = [{ id: "b1", type: "paragraph" as const, content: "Depois", order: 0 }];
    const diffs  = diffBlocks(before, after);
    expect(diffs[0].changeType).toBe("modified");
    expect(diffs[0].changedFields).toContain("content");
  });

  it("diffVariables detecta variável adicionada", () => {
    const before = [{ key: "a", label: "A", value: "1" }];
    const after  = [{ key: "a", label: "A", value: "1" }, { key: "b", label: "B", value: "2" }];
    const diffs  = diffVariables(before, after);
    expect(diffs.some(d => d.key === "b" && d.changeType === "added")).toBe(true);
  });

  it("diffMetadata detecta campo removido", () => {
    const before = { titulo: "ABC", ano: 2024 };
    const after  = { titulo: "ABC" };
    const diffs  = diffMetadata(before, after);
    expect(diffs.some(d => d.field === "ano" && d.changeType === "removed")).toBe(true);
  });
});

// ─── 3. Retention Policy ─────────────────────────────────────────────────────

describe("RetentionPolicy — classificação e ciclo de vida", () => {

  it("contrato → legal_permanent", () => {
    const p = getRetentionPolicy("contrato");
    expect(p.class).toBe("legal_permanent");
    expect(p.retentionDays).toBeNull();
    expect(p.legalHold).toBe(true);
  });

  it("aditivo → legal_permanent", () => {
    expect(getRetentionPolicy("aditivo").class).toBe("legal_permanent");
  });

  it("edital → legal_permanent", () => {
    expect(getRetentionPolicy("edital").class).toBe("legal_permanent");
  });

  it("parecer → legal_7years (2555 dias)", () => {
    const p = getRetentionPolicy("parecer");
    expect(p.class).toBe("legal_7years");
    expect(p.retentionDays).toBe(2555);
    expect(p.softDeleteOnly).toBe(true);
  });

  it("TR → operational_3years (1095 dias)", () => {
    const p = getRetentionPolicy("tr");
    expect(p.retentionDays).toBe(1095);
  });

  it("ETP → operational_3years", () => {
    expect(getRetentionPolicy("etp").class).toBe("operational_3years");
  });

  it("DFD → operational_3years", () => {
    expect(getRetentionPolicy("dfd").class).toBe("operational_3years");
  });

  it("tipo desconhecido → operational_3years", () => {
    expect(getRetentionPolicy("outro").class).toBe("operational_3years");
  });

  it("computePurgeDate retorna null para permanent", () => {
    expect(computePurgeDate(new Date(), null)).toBeNull();
  });

  it("computePurgeDate calcula data correta", () => {
    const base = new Date("2023-01-01"); // 2023 não é bissexto
    const d    = computePurgeDate(base, 365);
    expect(d?.getFullYear()).toBe(2024);
  });

  it("isEligibleForPurge false se legalHold=true", () => {
    const past = new Date(Date.now() - 1000);
    expect(isEligibleForPurge(past, true)).toBe(false);
  });

  it("isEligibleForPurge false se purgeAfter=null", () => {
    expect(isEligibleForPurge(null, false)).toBe(false);
  });

  it("isEligibleForPurge true quando prazo passou e sem hold", () => {
    const past = new Date(Date.now() - 1000);
    expect(isEligibleForPurge(past, false)).toBe(true);
  });

  it("applyLegalHold respeita política do tipo", () => {
    expect(applyLegalHold("contrato", false)).toBe(true); // política legalHold=true
    expect(applyLegalHold("tr",       false)).toBe(false);
    expect(applyLegalHold("tr",       true)).toBe(true);   // override explícito
  });
});

// ─── 4. Document Integrity ────────────────────────────────────────────────────

describe("DocumentIntegrity — hashes e fingerprints", () => {

  it("hashContent gera SHA-256 hex de 64 chars", () => {
    const h = hashContent("texto de teste");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it("hashContent é determinístico", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
  });

  it("hashContent muda com conteúdo diferente", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });

  it("computeSnapshotFingerprint é determinístico", () => {
    const fp1 = computeSnapshotFingerprint(1, 1, "conteúdo", null, 1);
    const fp2 = computeSnapshotFingerprint(1, 1, "conteúdo", null, 1);
    expect(fp1).toBe(fp2);
  });

  it("fingerprint muda ao alterar versão", () => {
    const fp1 = computeSnapshotFingerprint(1, 1, "x", null, 1);
    const fp2 = computeSnapshotFingerprint(1, 1, "x", null, 2);
    expect(fp1).not.toBe(fp2);
  });

  it("validateIntegrity retorna valid=true para dados íntegros", () => {
    const record = buildIntegrityRecord(1, 1, "texto", null, 1);
    const result = validateIntegrity(record, {
      content: "texto", structuredContent: null, documentId: 1, organizationId: 1, version: 1,
    });
    expect(result.valid).toBe(true);
    expect(result.contentHashMatch).toBe(true);
    expect(result.fingerprintMatch).toBe(true);
  });

  it("validateIntegrity detecta adulteração de conteúdo", () => {
    const record = buildIntegrityRecord(1, 1, "original", null, 1);
    const result = validateIntegrity(record, {
      content: "adulterado", structuredContent: null, documentId: 1, organizationId: 1, version: 1,
    });
    expect(result.valid).toBe(false);
    expect(result.contentHashMatch).toBe(false);
    expect(result.tamperedFields).toContain("content");
  });

  it("validateIntegrity detecta adulteração de fingerprint", () => {
    const record = buildIntegrityRecord(1, 1, "txt", null, 1);
    // altera versão para quebrar fingerprint mas não content hash
    const result = validateIntegrity(record, {
      content: "txt", structuredContent: null, documentId: 1, organizationId: 1, version: 99,
    });
    expect(result.valid).toBe(false);
    expect(result.fingerprintMatch).toBe(false);
  });

  it("computeRenderChecksum gera hex de 64 chars", () => {
    const cs = computeRenderChecksum("<html>teste</html>");
    expect(cs).toHaveLength(64);
    expect(cs).toMatch(/^[0-9a-f]+$/);
  });
});

// ─── 5. DocumentAttachmentService — sem DB ───────────────────────────────────

describe("DocumentAttachmentService — comportamento sem DB", () => {

  beforeEach(() => { vi.mocked(getDb).mockResolvedValue(null); });

  it("listAttachments retorna [] quando DB indisponível", async () => {
    const { listAttachments } = await import("../../services/documentAttachmentService");
    const result = await listAttachments(1, 1);
    expect(result).toEqual([]);
  });

  it("getAttachment retorna null quando DB indisponível", async () => {
    const { getAttachment } = await import("../../services/documentAttachmentService");
    const result = await getAttachment(1, 1);
    expect(result).toBeNull();
  });

  it("registerAttachment lança quando DB indisponível", async () => {
    const { registerAttachment } = await import("../../services/documentAttachmentService");
    await expect(registerAttachment(
      { documentId: 1, filename: "a.pdf", originalFilename: "a.pdf", mimeType: "application/pdf", fileSize: 100, storageKey: "key" },
      { organizationId: 1, user: { id: 1, name: "X", email: "x@x.com" }, orgMembership: { role: "operator" } } as any,
    )).rejects.toThrow();
  });

  it("softDeleteAttachment lança quando DB indisponível", async () => {
    const { softDeleteAttachment } = await import("../../services/documentAttachmentService");
    await expect(softDeleteAttachment(1, 1, { organizationId: 1, user: { id: 1 } } as any))
      .rejects.toThrow();
  });
});

// ─── 6. DocumentRenderService ─────────────────────────────────────────────────

describe("DocumentRenderService — formatos e cache", () => {

  it("SUPPORTED_FORMATS inclui html, docx e pdf", () => {
    expect(SUPPORTED_FORMATS).toContain("html");
    expect(SUPPORTED_FORMATS).toContain("docx");
    expect(SUPPORTED_FORMATS).toContain("pdf");
  });

  it("isFormatSupported reconhece formatos válidos", () => {
    expect(isFormatSupported("html")).toBe(true);
    expect(isFormatSupported("pdf")).toBe(true);
    expect(isFormatSupported("xlsx")).toBe(false);
    expect(isFormatSupported("")).toBe(false);
  });

  it("renderDocument lança quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { renderDocument } = await import("../../services/documentRenderService");
    await expect(renderDocument(1, 1, "html")).rejects.toThrow();
  });

  it("invalidateRenderCache é silencioso quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { invalidateRenderCache } = await import("../../services/documentRenderService");
    await expect(invalidateRenderCache(1, 1)).resolves.toBeUndefined();
  });
});

// ─── 7. DocumentConcurrencyService ───────────────────────────────────────────

describe("DocumentConcurrencyService — detecção de colisão", () => {

  function makeLockStatus(overrides?: Partial<LockStatus>): LockStatus {
    return {
      isLocked:      overrides?.isLocked      ?? false,
      lockedBy:      overrides?.lockedBy      ?? null,
      lockType:      overrides?.lockType      ?? null,
      lockReason:    overrides?.lockReason    ?? null,
      lockExpiresAt: overrides?.lockExpiresAt ?? null,
      isExpired:     overrides?.isExpired     ?? false,
      isOwnLock:     overrides?.isOwnLock     ?? false,
    };
  }

  it("sem lock → sem colisão", () => {
    const r = detectAutosaveCollision(makeLockStatus({ isLocked: false }), 1);
    expect(r.hasCollision).toBe(false);
  });

  it("lock próprio → sem colisão", () => {
    const r = detectAutosaveCollision(makeLockStatus({ isLocked: true, lockedBy: 1, isOwnLock: true }), 1);
    expect(r.hasCollision).toBe(false);
  });

  it("lock expirado → sem colisão", () => {
    const r = detectAutosaveCollision(makeLockStatus({ isLocked: true, lockedBy: 2, isExpired: true }), 1);
    expect(r.hasCollision).toBe(false);
  });

  it("soft lock de outro → colisão override possível", () => {
    const r = detectAutosaveCollision(makeLockStatus({ isLocked: true, lockedBy: 2, lockType: "soft" }), 1);
    expect(r.hasCollision).toBe(true);
    expect(r.canOverride).toBe(true);
  });

  it("hard lock de outro → colisão bloqueante", () => {
    const r = detectAutosaveCollision(makeLockStatus({ isLocked: true, lockedBy: 2, lockType: "hard" }), 1);
    expect(r.hasCollision).toBe(true);
    expect(r.canOverride).toBe(false);
  });

  it("getLockStatus retorna isLocked=false quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { getLockStatus } = await import("../../services/documentConcurrencyService");
    const s = await getLockStatus(1, 1, 1);
    expect(s.isLocked).toBe(false);
  });

  it("cleanupExpiredLocks retorna 0 quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { cleanupExpiredLocks } = await import("../../services/documentConcurrencyService");
    expect(await cleanupExpiredLocks()).toBe(0);
  });
});

// ─── 8. DocumentIntegrityService — sem DB ────────────────────────────────────

describe("DocumentIntegrityService — comportamento sem DB", () => {

  it("computeAndStoreIntegrity lança quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { computeAndStoreIntegrity } = await import("../../services/documentIntegrityService");
    await expect(computeAndStoreIntegrity(1, 1)).rejects.toThrow();
  });

  it("validateDocumentIntegrity lança quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { validateDocumentIntegrity } = await import("../../services/documentIntegrityService");
    await expect(validateDocumentIntegrity(1, 1)).rejects.toThrow();
  });

  it("isIntegrityComputed retorna false quando hashes ausentes", async () => {
    const { isIntegrityComputed } = await import("../../services/documentIntegrityService");
    expect(isIntegrityComputed({ contentHash: null, snapshotFingerprint: null })).toBe(false);
    expect(isIntegrityComputed({ contentHash: "abc", snapshotFingerprint: null })).toBe(false);
  });

  it("isIntegrityComputed retorna true quando ambos hashes presentes", async () => {
    const { isIntegrityComputed } = await import("../../services/documentIntegrityService");
    expect(isIntegrityComputed({ contentHash: "abc", snapshotFingerprint: "def" })).toBe(true);
  });
});

// ─── 9. DocumentDiffService — sem DB ─────────────────────────────────────────

describe("DocumentDiffService — comportamento sem DB", () => {

  it("getStoredDiff retorna null quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { getStoredDiff } = await import("../../services/documentDiffService");
    expect(await getStoredDiff(1, 1, 1)).toBeNull();
  });

  it("diffVersions lança quando DB indisponível", async () => {
    vi.mocked(getDb).mockResolvedValueOnce(null);
    const { diffVersions } = await import("../../services/documentDiffService");
    await expect(diffVersions(1, 1, 1, 2)).rejects.toThrow();
  });
});

// ─── 10. Anti-tampering ───────────────────────────────────────────────────────

describe("Anti-tampering — detectar adulteração", () => {

  it("mesmo conteúdo → valid=true", () => {
    const content = "Contrato de prestação de serviços referente ao processo 2024/001.";
    const record  = buildIntegrityRecord(42, 1, content, null, 3);
    expect(validateIntegrity(record, { content, structuredContent: null, documentId: 42, organizationId: 1, version: 3 }).valid).toBe(true);
  });

  it("conteúdo adulterado → valid=false com tamperedFields", () => {
    const content  = "Contrato original.";
    const tampered = "Contrato adulterado!";
    const record   = buildIntegrityRecord(42, 1, content, null, 3);
    const result   = validateIntegrity(record, { content: tampered, structuredContent: null, documentId: 42, organizationId: 1, version: 3 });
    expect(result.valid).toBe(false);
    expect(result.tamperedFields).toBeDefined();
    expect(result.tamperedFields!.length).toBeGreaterThan(0);
  });

  it("troca de tenant (organizationId) quebra fingerprint", () => {
    const record = buildIntegrityRecord(1, 1, "texto", null, 1);
    const result = validateIntegrity(record, { content: "texto", structuredContent: null, documentId: 1, organizationId: 999, version: 1 });
    expect(result.fingerprintMatch).toBe(false);
  });

  it("fingerprints de versões diferentes são únicos", () => {
    const fp1 = computeSnapshotFingerprint(1, 1, "x", null, 1);
    const fp2 = computeSnapshotFingerprint(1, 1, "x", null, 2);
    const fp3 = computeSnapshotFingerprint(1, 1, "x", null, 3);
    expect(new Set([fp1, fp2, fp3]).size).toBe(3);
  });
});

// ─── 11. Sprint 3 Readiness ───────────────────────────────────────────────────

describe("Sprint 3 Readiness — ItemTR/CATMAT/IA", () => {

  it("policy engine suporta manage_attachments (readiness para ItemTR)", () => {
    const ctx: PolicyEvaluationContext = {
      ...makeCtxPolicy({ actorRole: "operator" }),
      document: makeDoc({ documentStatus: "draft" }),
    };
    expect(evaluatePolicy("manage_attachments", ctx).allowed).toBe(true);
  });

  it("retention TR é 3 anos (adequado para ciclo de licitação)", () => {
    const p = getRetentionPolicy("tr");
    expect(p.retentionDays).toBe(1095);
    expect(p.archivable).toBe(true);
  });

  it("diff engine suporta StructuredDocumentContent com variáveis (base para IA)", () => {
    const before = { sections: [], variables: [{ key: "valor_total", label: "Valor", value: "100000" }], metadata: {} };
    const after  = { sections: [], variables: [{ key: "valor_total", label: "Valor", value: "150000" }], metadata: {} };
    const d = computeDiff(1, 1, 1, 2, null, null, before as any, after as any);
    expect(d.structuredDiff.variableDiffs).toHaveLength(1);
    expect(d.structuredDiff.variableDiffs[0].key).toBe("valor_total");
  });

  it("formatos html/docx/pdf suportados (base para exportação)", () => {
    expect(isFormatSupported("html")).toBe(true);
    expect(isFormatSupported("docx")).toBe(true);
    expect(isFormatSupported("pdf")).toBe(true);
  });
});

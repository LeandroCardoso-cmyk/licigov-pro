/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Institutional Templates — Lane B (serviço): composição governada pelo Document Engine + emissão com revalidação
 * canônica e M2 na transação da promoção. Sem MySQL: os ports são fakes em memória e o banco é um fake TRANSACIONAL
 * (grava só no commit; deadlock injetado desfaz a tentativa inteira), para provar o retry do SEM-084 sem efeito parcial.
 * A persistência física (tabelas/FKs da HD-26) é da Lane A e será exercitada em MySQL real na integração.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../domain/canonicalJson";
import type { TemplateBinding } from "../../domain/institutionalTemplates";
import type { GenerationManifest } from "../../domain/institutionalTemplates/manifest";
import type { AiNarrativeAcceptance, HumanEditLink } from "../../domain/institutionalTemplates/revalidation";
import {
  ORG_A, ORG_B, canonicalSources, catalog, identity, narrative, publishedRevision, trPin,
} from "../helpers/institutionalTemplatesFixture";
import { identity2, publishedRevision2 } from "../helpers/institutionalTemplatesV2Fixture";

// ─── Banco fake transacional ───────────────────────────────────────────────────────────────────────────────────────
type Row = { table: string; row: any };
const committed: Row[] = [];
let txAttempts = 0;
const deadlockOnAttempt = new Set<number>();
const deadlock = () => Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), { code: "ER_LOCK_DEADLOCK", errno: 1213, sqlState: "40001" });
const fakeDb = {
  transaction: async (cb: (tx: any) => Promise<unknown>) => {
    txAttempts += 1;
    const tx = { staged: [] as Row[], attempt: txAttempts };
    const out = await cb(tx);
    if (deadlockOnAttempt.has(txAttempts)) throw deadlock(); // InnoDB desfaz a tentativa INTEIRA
    committed.push(...tx.staged);
    return out;
  },
};
const stage = (tx: any, table: string, row: any) => { tx.staged.push({ table, row }); };
const rows = (table: string) => committed.filter((r) => r.table === table).map((r) => r.row);

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => fakeDb) }));

// Document Engine: ponto ÚNICO de geração oficial (espião; grava na transação recebida).
const generateOfficialDocument = vi.fn(async (params: any, executor: any) => {
  stage(executor, "official", { status: params.status, documentType: params.documentType, origin: params.origin, metadata: params.metadata, content: params.content });
  return { id: `odoc_gen_${executor.attempt}`, version: 1, lineageId: "odln_gen", status: params.status };
});
vi.mock("../../services/documentEngineService", () => ({ generateOfficialDocument: (...a: any[]) => generateOfficialDocument(a[0], a[1]) }));

// Promoção (C.4B.1) — dependências isoladas como no teste unitário da promoção.
const createDocument = vi.fn(async (params: any, executor: any) => {
  stage(executor, "official", { status: params.status, metadata: params.metadata, content: params.content });
  return { id: `odoc_emit_${executor.attempt}`, version: 2, status: params.status, lineageId: "odln_emit" };
});
vi.mock("../../services/officialDocumentLifecycleService", () => ({ createDocument: (...a: any[]) => createDocument(a[0], a[1]) }));
const getGeneratedDocumentByKind = vi.fn();
vi.mock("../../db/procurement", () => ({
  getGeneratedDocumentByKind: (...a: unknown[]) => getGeneratedDocumentByKind(...a),
  getProcess: vi.fn(async () => ({ processNumber: "2026/0001", object: "Objeto do processo" })),
}));
vi.mock("../../services/institutionalIdentityService", () => ({
  snapshotInstitutionalIdentity: vi.fn(async () => ({ snapshot: { organizationName: "Órgão Sintético" }, fingerprint: "fp-identity-1" })),
}));
vi.mock("../../db/officialDocumentPromotions", () => ({
  insertOfficialPromotion: vi.fn(async (p: any, tx: any) => { stage(tx, "ledger", p); }),
  getLatestOfficialPromotion: vi.fn(async () => null),
}));
const checkIdempotency = vi.fn();
const failIdempotencyKey = vi.fn(async () => {});
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: (...a: unknown[]) => checkIdempotency(...a),
  saveIdempotencyResult: vi.fn(async (_k: string, _u: number, _o: number, result: unknown, tx: any) => { stage(tx, "idempotency", result); }),
  failIdempotencyKey: (...a: unknown[]) => failIdempotencyKey(...(a as [])),
}));
vi.mock("../../services/procurementProcessService", () => ({
  getAuthoringSourceState: vi.fn(async () => ({ state: "current", changedSources: [] })),
  getEditalSourceState: vi.fn(async () => ({ state: "current", changedSources: [] })),
}));
vi.mock("../../db/officialDocuments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/officialDocuments")>()),
  getLatestEmittedByOrigin: vi.fn(async () => ({ content: "TR emitido", version: 2 })),
}));

import {
  createTemplateIssuanceHook, createTemplateTransactionPort, generateTemplatedDocument, TEMPLATE_REVIEW_NOTICE,
  type GenerateTemplatedDocumentParams,
} from "../../services/institutionalTemplates/templateCompositionService";
import { createUnavailableTemplatePorts, type TemplatePorts } from "../../services/institutionalTemplates/ports";
import { promoteOfficialDocument } from "../../services/documentPromotionService";

// ─── Ports fake (tenant-scoped, insert-only) ───────────────────────────────────────────────────────────────────────
const revision = publishedRevision();
const binding = (over: Partial<TemplateBinding> = {}): TemplateBinding => ({
  id: "tplb_1", organizationId: ORG_A, documentKind: "edital", scope: { modality: "pregao" }, identityId: identity.id,
  pinnedRevisionId: revision.id, active: true, effectiveFrom: "2026-10-01T00:00:00Z", ...over,
});

interface FakeState {
  enabled: Set<number>;
  bindings: TemplateBinding[];
  sources: ReturnType<typeof canonicalSources>;
  docs: ReturnType<typeof trPin>;
  fingerprint: string;
  aiOutputs: ReturnType<typeof narrative>[];
  acceptances: AiNarrativeAcceptance[];
  edits: HumanEditLink[];
}
let state: FakeState;
const calls: string[] = [];

function makePorts(): TemplatePorts {
  const m1s = () => rows("m1") as GenerationManifest[];
  return {
    enablement: { isEnabled: async (org) => state.enabled.has(org) },
    repository: {
      getIdentity: async (org, id) => (org === identity.organizationId && id === identity.id ? identity : null),
      getRevision: async (org, revId) => (org === revision.organizationId && revId === revision.id ? revision : null),
      listRevisions: async () => [revision],
      listBindings: async () => { calls.push("bindings"); return state.bindings; },
    },
    catalog: { current: () => catalog, byVersion: (v) => (v === catalog.version ? catalog : null) },
    canonical: {
      resolveSources: async (_org, _subject, keys) => Object.fromEntries(keys.filter((k) => state.sources[k]).map((k) => [k, state.sources[k]])),
      resolveOfficialDocuments: async () => state.docs,
      pinOfficialDocuments: async () => state.docs,
      identityFingerprint: async () => state.fingerprint,
    },
    drafts: {
      reserveDraftId: async () => "gdoc_lb_1",
      writeDraft: async (d, tx) => { calls.push("writeDraft"); stage(tx, "draft", d); },
    },
    manifests: {
      getManifest: async (org, id) => m1s().find((m) => m.organizationId === org && m.id === id) ?? null,
      findGenerationManifestForDraft: async (org, draftId) => [...m1s()].reverse().find((m) => m.organizationId === org && m.generatedDocumentId === draftId) ?? null,
      insertGenerationManifest: async (m, pctx, tx) => { stage(tx, "m1", m); stage(tx, "m1_ctx", pctx); return { created: true }; },
      insertIssuanceManifest: async (m, link, pctx, tx) => { stage(tx, "m2", m); stage(tx, "m2_link", link); stage(tx, "m2_ctx", pctx); },
    },
    review: {
      loadAiOutputs: async (_org, ids) => state.aiOutputs.filter((o) => ids.includes(o.executionId)),
      listAiAcceptances: async () => state.acceptances,
      listDeviationAcknowledgments: async () => [],
      listHumanEdits: async () => state.edits,
    },
    clock: { now: () => "2026-10-06T12:00:00.000Z" },
    transactions: createTemplateTransactionPort(),
  };
}

const genParams = (over: Partial<GenerateTemplatedDocumentParams> = {}): GenerateTemplatedDocumentParams => ({
  organizationId: ORG_A, subjectId: "proc_lb_1", documentKind: "edital", documentType: "edital", scope: { modality: "pregao" },
  asOf: "2026-10-06T00:00:00Z", title: "Edital — sintético", actorUserId: 5, correlationId: "corr-lb", aiNarratives: [narrative()], ...over,
});

const err = async (p: Promise<unknown>): Promise<any> => p.then(() => null, (e) => e);

beforeEach(() => {
  vi.clearAllMocks();
  committed.length = 0;
  calls.length = 0;
  txAttempts = 0;
  deadlockOnAttempt.clear();
  state = {
    enabled: new Set([ORG_A]), bindings: [binding()], sources: canonicalSources(), docs: trPin(), fingerprint: "fp-identity-1",
    aiOutputs: [narrative()], acceptances: [], edits: [],
  };
  checkIdempotency.mockResolvedValue({ status: "new" });
});

// ─── Geração ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Lane B — geração governada (fail-closed)", () => {
  it("organização não habilitada ⇒ TEMPLATE_COMPOSITION_DISABLED, sem leitura de binding e sem transação", async () => {
    state.enabled.clear();
    const e = await err(generateTemplatedDocument(genParams(), makePorts()));
    expect(e?.message).toMatch(/^TEMPLATE_COMPOSITION_DISABLED/);
    expect(calls).toEqual([]);
    expect(txAttempts).toBe(0);
  });

  it("ports sem backing (estado atual) ⇒ desabilitado; forçando a habilitação, falha fechada de persistência", async () => {
    const unavailable = createUnavailableTemplatePorts();
    expect((await err(generateTemplatedDocument(genParams(), unavailable)))?.message).toMatch(/^TEMPLATE_COMPOSITION_DISABLED/);
    const forced = { ...unavailable, enablement: { isEnabled: async () => true } };
    expect((await err(generateTemplatedDocument(genParams(), forced)))?.message).toMatch(/^TEMPLATE_PERSISTENCE_UNAVAILABLE/);
    expect(txAttempts).toBe(0);
    expect(generateOfficialDocument).not.toHaveBeenCalled();
  });

  it("binding ambíguo ⇒ CONFLICT; sem pin ⇒ BINDING_REVISION_NOT_PINNED; sem vínculo ⇒ NOT_BOUND; de outro tenant ⇒ recusado", async () => {
    state.bindings = [binding(), binding({ id: "tplb_2" })];
    const amb = await err(generateTemplatedDocument(genParams(), makePorts()));
    expect(amb?.code).toBe("CONFLICT");
    expect(amb?.message).toMatch(/^TEMPLATE_BINDING_AMBIGUOUS/);
    state.bindings = [binding({ pinnedRevisionId: undefined })];
    expect((await err(generateTemplatedDocument(genParams(), makePorts())))?.message).toBe("TEMPLATE_BINDING_INVALID: BINDING_REVISION_NOT_PINNED");
    state.bindings = [];
    expect((await err(generateTemplatedDocument(genParams(), makePorts())))?.message).toMatch(/^TEMPLATE_NOT_BOUND/);
    state.bindings = [binding({ organizationId: ORG_B })];
    expect((await err(generateTemplatedDocument(genParams(), makePorts())))?.message).toBe("TEMPLATE_BINDING_INVALID: CROSS_TENANT_REFERENCE");
    expect(txAttempts).toBe(0);
  });

  it("fonte canônica de outro tenant ⇒ TEMPLATE_COMPOSITION_FAILED (CROSS_TENANT_REFERENCE), sem escrita", async () => {
    state.sources = { ...canonicalSources(), TR: { organizationId: ORG_B, data: { object: "x" } } };
    expect((await err(generateTemplatedDocument(genParams(), makePorts())))?.message).toBe("TEMPLATE_COMPOSITION_FAILED: CROSS_TENANT_REFERENCE");
    expect(txAttempts).toBe(0);
  });

  it("revisão `tpl-ast/2` vinculada cujo catálogo v2 não é resolvível ⇒ TEMPLATE_COMPOSITION_FAILED (falha fechada, sem escrita; o caminho v2 positivo é provado em MySQL real)", async () => {
    const id2 = { ...identity2, id: identity.id, organizationId: ORG_A };
    const rev2 = publishedRevision2({ identity: id2 });
    state.bindings = [binding({ pinnedRevisionId: rev2.id })];
    const ports = makePorts();
    const v2Ports: TemplatePorts = {
      ...ports,
      repository: { ...ports.repository, getRevision: async () => rev2, listRevisions: async () => [rev2] },
    };
    expect((await err(generateTemplatedDocument(genParams(), v2Ports)))?.message).toMatch(/^TEMPLATE_COMPOSITION_FAILED.*CATALOG_VERSION_MISMATCH/);
    expect(txAttempts).toBe(0);
    expect(generateOfficialDocument).not.toHaveBeenCalled();
  });

  it("tipo oficial incompatível ou ator ausente ⇒ BAD_REQUEST", async () => {
    expect((await err(generateTemplatedDocument(genParams({ documentType: "tr" }), makePorts())))?.code).toBe("BAD_REQUEST");
    expect((await err(generateTemplatedDocument(genParams({ actorUserId: 0 }), makePorts())))?.code).toBe("BAD_REQUEST");
  });

  it("compõe e grava rascunho + versão `gerado` (pelo Document Engine) + M1 na MESMA transação", async () => {
    const r = await generateTemplatedDocument(genParams(), makePorts());
    expect(r.replayed).toBe(false);
    expect(r.reviewNotice).toBe(TEMPLATE_REVIEW_NOTICE);
    expect(txAttempts).toBe(1);
    expect(generateOfficialDocument).toHaveBeenCalledTimes(1);
    const [params, executor] = generateOfficialDocument.mock.calls[0];
    expect(params).toMatchObject({ status: "gerado", businessDomain: "processo_licitatorio", documentType: "edital", origin: "proc_lb_1", content: r.content });
    expect(params.metadata).toMatchObject({ templateGenerationManifestId: r.generationManifest.id, composedOutputHash: r.composedOutputHash, aiNarrativesPendingAcceptance: 1 });
    expect(executor).toHaveProperty("staged");
    expect(rows("draft")).toHaveLength(1);
    expect(rows("draft")[0]).toMatchObject({ id: "gdoc_lb_1", generationManifestId: r.generationManifest.id, content: r.content });
    expect(rows("official")).toHaveLength(1);
    expect(rows("m1")).toEqual([r.generationManifest]);
    expect(rows("m1_ctx")).toEqual([{ actorUserId: 5, correlationId: "corr-lb" }]); // M1 não carrega a versão oficial (A: officialDocumentId só no M2)
    expect(r.composedOutputHash).toBe(sha256Hex(r.content));
  });

  it("replay: as mesmas entradas canônicas ⇒ mesmo M1, nenhuma escrita nova (sem nova versão oficial)", async () => {
    const first = await generateTemplatedDocument(genParams(), makePorts());
    const second = await generateTemplatedDocument(genParams(), makePorts());
    expect(second.replayed).toBe(true);
    expect(second.generationManifest.id).toBe(first.generationManifest.id);
    expect(second.composedOutputHash).toBe(first.composedOutputHash);
    expect(generateOfficialDocument).toHaveBeenCalledTimes(1);
    expect(rows("m1")).toHaveLength(1);
    expect(rows("official")).toHaveLength(1);
    expect(rows("draft")).toHaveLength(1);
  });

  it("SEM-084: deadlock na 1ª tentativa ⇒ a transação INTEIRA é repetida; um rascunho, uma versão, um M1", async () => {
    deadlockOnAttempt.add(1);
    const r = await generateTemplatedDocument(genParams(), makePorts());
    expect(txAttempts).toBe(2);
    expect(generateOfficialDocument).toHaveBeenCalledTimes(2); // repetida inteira; a 1ª foi desfeita
    expect(rows("draft")).toHaveLength(1);
    expect(rows("official")).toHaveLength(1);
    expect(rows("m1")).toEqual([r.generationManifest]);
    expect(rows("m1_ctx")).toEqual([{ actorUserId: 5, correlationId: "corr-lb" }]);
  });
});

// ─── Emissão ───────────────────────────────────────────────────────────────────────────────────────────────────────
async function composedDraft() {
  const g = await generateTemplatedDocument(genParams(), makePorts());
  committed.splice(0, committed.length, ...committed.filter((r) => r.table === "m1")); // só o M1 persiste para a emissão
  calls.length = 0;
  vi.clearAllMocks();
  checkIdempotency.mockResolvedValue({ status: "new" });
  txAttempts = 0;
  getGeneratedDocumentByKind.mockResolvedValue({
    id: "gdoc_lb_1", kind: "edital", title: "Edital — sintético", content: g.content, status: "rascunho", authorUserId: 5, updatedAt: "2026-10-06T12:00:00.000Z",
  });
  return g;
}

function accept(m1: GenerationManifest): AiNarrativeAcceptance[] {
  return m1.aiNarratives.map((n) => ({ organizationId: ORG_A, manifestId: m1.id, slotKey: n.slotKey, executionId: n.executionId, outputHash: n.outputHash, acceptedByUserId: 9 }));
}

const promoteParams = (content: string, over: Record<string, unknown> = {}) => ({
  organizationId: ORG_A, processId: "proc_lb_1", kind: "edital" as const, actorUserId: 7, actorRole: "manager" as const,
  idempotencyKey: "emit-lb-1", correlationId: "corr-emit", expectedContentHash: sha256Hex(content), ...over,
});

/** O texto composto tem um aiSlot aceito e nenhuma marca [REVISAR]: emitível. */
describe("Lane B — emissão: revalidação canônica + M2 na transação da promoção", () => {
  it("sem hook: a promoção existente é idêntica (nenhum M2, nenhum metadado de template)", async () => {
    const g = await composedDraft();
    const r = await promoteOfficialDocument(promoteParams(g.content));
    expect(r.promoted).toBe(true);
    expect(rows("m2")).toEqual([]);
    expect(Object.keys(rows("official")[0].metadata).filter((k) => k.startsWith("template"))).toEqual([]);
  });

  it("rascunho não composto por template: o hook devolve null e a promoção segue sem M2", async () => {
    const g = await composedDraft();
    getGeneratedDocumentByKind.mockResolvedValue({ id: "gdoc_outro", kind: "edital", title: "x", content: g.content, status: "rascunho", authorUserId: 5 });
    const r = await promoteOfficialDocument({ ...promoteParams(g.content), templateIssuance: createTemplateIssuanceHook(makePorts()) });
    expect(r.promoted).toBe(true);
    expect(rows("m2")).toEqual([]);
  });

  it("fontes atuais + IA aceita ⇒ emite; M2 derivado do M1 gravado na MESMA transação da versão emitida e do ledger", async () => {
    const g = await composedDraft();
    state.acceptances = accept(g.generationManifest);
    const r = await promoteOfficialDocument({ ...promoteParams(g.content), templateIssuance: createTemplateIssuanceHook(makePorts()) });
    expect(r.promoted).toBe(true);
    expect(txAttempts).toBe(1);
    const [m2] = rows("m2");
    expect(m2).toMatchObject({ stage: "ISSUANCE", derivedFromManifestId: g.generationManifest.id, documentContentHash: g.composedOutputHash });
    expect(m2.canonicalRevalidation.status).toBe("PASSED");
    expect(m2.aiNarratives.every((n: any) => n.humanAccepted)).toBe(true);
    expect(rows("m2_link")).toEqual([{ officialDocumentId: "odoc_emit_1", officialVersion: 2 }]);
    expect(rows("official")[0].metadata).toMatchObject({ templateGenerationManifestId: g.generationManifest.id, templateIssuanceManifestId: m2.id, templateManifestHash: m2.manifestHash });
    expect(rows("ledger")).toHaveLength(1);
    expect(rows("idempotency")).toHaveLength(1);
    expect(rows("m1")).toEqual([g.generationManifest]); // M1 intacto
  });

  it("SEM-084: deadlock na 1ª tentativa da promoção ⇒ repetida INTEIRA; uma versão emitida, um ledger, um M2", async () => {
    const g = await composedDraft();
    state.acceptances = accept(g.generationManifest);
    deadlockOnAttempt.add(1);
    const r = await promoteOfficialDocument({ ...promoteParams(g.content), templateIssuance: createTemplateIssuanceHook(makePorts()) });
    expect(r.promoted).toBe(true);
    expect(txAttempts).toBe(2);
    expect(createDocument).toHaveBeenCalledTimes(2);
    expect(rows("official")).toHaveLength(1);
    expect(rows("ledger")).toHaveLength(1);
    expect(rows("idempotency")).toHaveLength(1);
    expect(rows("m2")).toHaveLength(1);
    expect(rows("m2_link")).toEqual([{ officialDocumentId: "odoc_emit_2", officialVersion: 2 }]);
  });

  it("SOURCE_CHANGED bloqueia a emissão: nada é emitido, regenerado ou mutado", async () => {
    const g = await composedDraft();
    state.acceptances = accept(g.generationManifest);
    state.sources = canonicalSources(ORG_A, { TR: { object: "Objeto alterado depois da composição" } });
    const before = JSON.stringify(committed);
    const e = await err(promoteOfficialDocument({ ...promoteParams(g.content), templateIssuance: createTemplateIssuanceHook(makePorts()) }));
    expect(e?.code).toBe("PRECONDITION_FAILED");
    expect(e?.message).toMatch(/^TEMPLATE_ISSUANCE_BLOCKED: SOURCE_CHANGED/);
    expect(txAttempts).toBe(0);
    expect(createDocument).not.toHaveBeenCalled();
    expect(generateOfficialDocument).not.toHaveBeenCalled();
    expect(calls).not.toContain("writeDraft");
    expect(JSON.stringify(committed)).toBe(before);
    expect(failIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it("narrativa de IA sem aceite, ou com saída auditável divergente ⇒ emissão bloqueada", async () => {
    const g = await composedDraft();
    const e1 = await err(promoteOfficialDocument({ ...promoteParams(g.content), templateIssuance: createTemplateIssuanceHook(makePorts()) }));
    expect(e1?.message).toMatch(/^TEMPLATE_ISSUANCE_BLOCKED: AI_NARRATIVE_NOT_ACCEPTED/);
    state.acceptances = accept(g.generationManifest);
    state.aiOutputs = [narrative("Texto de IA trocado depois")];
    const e2 = await err(promoteOfficialDocument({ ...promoteParams(g.content), templateIssuance: createTemplateIssuanceHook(makePorts()) }));
    expect(e2?.message).toMatch(/^TEMPLATE_ISSUANCE_BLOCKED: AI_NARRATIVE_NOT_ACCEPTED/);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("edição humana com linhagem explícita é emitida; sem linhagem é bloqueada", async () => {
    const g = await composedDraft();
    state.acceptances = accept(g.generationManifest);
    const edited = g.content.replace("Justificativa sintética", "Justificativa sintética revisada");
    getGeneratedDocumentByKind.mockResolvedValue({ id: "gdoc_lb_1", kind: "edital", title: "x", content: edited, status: "rascunho", authorUserId: 5 });
    const blocked = await err(promoteOfficialDocument({ ...promoteParams(edited), templateIssuance: createTemplateIssuanceHook(makePorts()) }));
    expect(blocked?.message).toMatch(/^TEMPLATE_ISSUANCE_BLOCKED: HUMAN_EDIT_LINEAGE_INVALID/);
    state.edits = [{ editRef: "edit_1", previousContentHash: g.composedOutputHash, resultingContentHash: sha256Hex(edited), editorUserId: 11 }];
    checkIdempotency.mockResolvedValue({ status: "failed" });
    const r = await promoteOfficialDocument({ ...promoteParams(edited), templateIssuance: createTemplateIssuanceHook(makePorts()) });
    expect(r.promoted).toBe(true);
    expect(rows("m2")[0]).toMatchObject({ documentContentHash: sha256Hex(edited), humanEditRefs: [{ editRef: "edit_1", resultingContentHash: sha256Hex(edited) }] });
  });

  it("organização desabilitada com hook ⇒ falha fechada (nenhuma emissão por template sem habilitação)", async () => {
    const g = await composedDraft();
    state.enabled.clear();
    const e = await err(promoteOfficialDocument({ ...promoteParams(g.content), templateIssuance: createTemplateIssuanceHook(makePorts()) }));
    expect(e?.message).toMatch(/^TEMPLATE_COMPOSITION_DISABLED/);
    expect(createDocument).not.toHaveBeenCalled();
  });
});

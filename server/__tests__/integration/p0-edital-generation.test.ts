/**
 * P0 EDITAL — Geração contextual do Edital (integração, sem MySQL; DB e idempotência mockados).
 *
 * Exercita o CAMINHO VIVO real (`generateNotice` → Context Builder real → `generateEditalAuthoring` real
 * via seam `invoke`), provando:
 *   A) o contexto de geração REAPROVEITA DFD/ETP/TR/itens do processo;
 *   B) o prazo do TR (15 dias) chega ao payload de geração;
 *   C) retry com o mesmo input NÃO reexecuta cognição nem duplica (replay);
 *   D) falha do provider → nenhum rascunho falso, chave marcada failed, retry possível;
 *   E) isolamento multi-tenant: documento-base de outro tenant não vaza (vira [REVISAR]);
 *   F) SOURCE_CHANGED: alterar o TR após a geração é detectável (getEditalSourceState).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ORG = 42;
const OTHER_ORG = 99;
const PID = "proc-2026-0007";
const fakeTx = { __tx: true };

vi.mock("../../services/kernelAccessService", () => ({ assertKernelAccess: vi.fn() }));

// Processo LEGADO (sem Itens da contratação): o gate canônico compartilhado de ETP/TR/Edital lê a lista
// (vazia ⇒ modo legado inalterado).
vi.mock("../../db/procurementItems", () => ({ listProcurementItems: vi.fn(async () => []) }));

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => ({ transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(fakeTx) })),
}));

// DB tenant-scoped: docs-base existem apenas para ORG. Outro tenant → null (sem vazamento).
const TR_CONTENT = "TR: objeto de aquisição de material; prazo de execução: 15 dias; obrigações da contratada e critérios de aceitação.";
const ETP_CONTENT = "ETP: descrição da necessidade e solução escolhida (registro de preços).";
const DFD_CONTENT = "DFD: formalização da demanda por material de expediente.";
let editalStored: { content: string; sources: string[] } | null = null;

const getGeneratedDocumentByKind = vi.fn(async (_pid: string, orgId: number, kind: string) => {
  if (orgId !== ORG) return null; // isolamento: outro tenant não enxerga os documentos-base
  if (kind === "dfd") return { id: "d", kind, title: "DFD", content: DFD_CONTENT, status: "aprovado", sources: [], authorUserId: 1, lastSubstantiveActorUserId: 1, updatedAt: "2026-01-01T00:00:00Z" };
  if (kind === "etp") return { id: "e", kind, title: "ETP", content: ETP_CONTENT, status: "aprovado", sources: [], authorUserId: 1, lastSubstantiveActorUserId: 1, updatedAt: "2026-01-01T00:00:00Z" };
  if (kind === "tr") return { id: "t", kind, title: "TR", content: TR_CONTENT, status: "aprovado", sources: [], authorUserId: 1, lastSubstantiveActorUserId: 1, updatedAt: "2026-01-01T00:00:00Z" };
  if (kind === "edital") return editalStored ? { id: "ed", kind, title: "Edital", content: editalStored.content, status: "rascunho", sources: editalStored.sources, authorUserId: 1, lastSubstantiveActorUserId: 1, updatedAt: "2026-02-01T00:00:00Z" } : null;
  return null;
});

vi.mock("../../db/procurement", () => ({
  getProcess: vi.fn(async (_id: string, orgId: number) => (orgId === ORG ? { id: PID, organizationId: ORG, object: "Aquisição de material", processNumber: "2026/0007", modality: "pregao", currentStage: "NOTICE", status: "em_edital" } : null)),
  getGeneratedDocumentByKind: (...a: unknown[]) => getGeneratedDocumentByKind(...(a as [string, number, string])),
  // P0 piloto — averagePrice em REAIS (contrato monetário; o antigo 2550 casava com o bug `/100`).
  listIntelligentItems: vi.fn(async (_pid: string, orgId: number) => (orgId === ORG ? [{ id: "i1", description: "Papel A4", quantity: 100, unit: "resma", averagePrice: 25.5, suggestedCATMAT: "12345", status: "aprovado", averagePriceCents: 2550, suppliers: [], quoteCount: 0, enrichmentStatus: "done", sourceResearchId: "r1" }] : [])),
  applyDraftContentMutationTx: vi.fn(async (_tx: unknown, input: { doc: unknown }) => ({ created: true, changed: true, document: input.doc })),
  recordProcessEvent: vi.fn(async () => {}),
}));

// P0 piloto — classificação CONFIRMADA vem do ledger catmat_decisions (nova dependência do Context Builder).
vi.mock("../../db/catmatGovernance", () => ({
  getLatestCatmatDecisionsForItems: vi.fn(async () => new Map()),
}));

vi.mock("../../services/documentEngineService", () => ({
  generateOfficialDocument: vi.fn(async () => ({ id: "off-1", version: 1, lineageId: "lin-1" })),
}));
vi.mock("../../db/cognitiveProvenance", () => ({
  linkProvenanceArtifact: vi.fn(async () => ({ linked: 1 })),
}));

const checkIdempotency = vi.fn();
const saveIdempotencyResult = vi.fn(async () => {});
const failIdempotencyKey = vi.fn(async () => {});
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: (...a: unknown[]) => checkIdempotency(...a),
  saveIdempotencyResult: (...a: unknown[]) => saveIdempotencyResult(...a),
  failIdempotencyKey: (...a: unknown[]) => failIdempotencyKey(...a),
}));

import { generateNotice, getEditalSourceState } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import * as procDb from "../../db/procurement";

let capturedPrompt = "";
const invoke = vi.fn(async (prompt: string) => { capturedPrompt = prompt; return buildMockProviderAuthoring("edital"); });

const gen = (over: Partial<Parameters<typeof generateNotice>[0]> = {}) => generateNotice({
  organizationId: ORG, processId: PID, object: "Aquisição de material",
  modality: "pregao", form: "eletronico", platform: "compras_gov",
  correlationId: "corr-1", idempotencyKey: "key-edital", actorUserId: 7, invoke,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  capturedPrompt = "";
  editalStored = null;
});

describe("P0 — generateNotice contextual (caminho vivo)", () => {
  it("A) o contexto de geração reaproveita DFD, ETP e TR e os itens do processo", async () => {
    checkIdempotency.mockResolvedValue({ status: "new" });
    const res = await gen();
    expect(res.validation.valid).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(capturedPrompt).toContain("DFD:");
    expect(capturedPrompt).toContain("ETP:");
    expect(capturedPrompt).toContain("TR:");
    expect(capturedPrompt).toContain("Papel A4");
    // O rascunho gerado é uma minuta estruturada (não o placeholder de 1 linha), com aviso de revisão.
    expect(res.document.content).toContain("Edital de Licitação");
    expect(res.document.content.toLowerCase()).toContain("revis");
    // Lineage nas sources (grounding + digest das fontes).
    expect(res.document.sources.some((s) => s.startsWith("grounding:"))).toBe(true);
    expect(res.document.sources.some((s) => s.startsWith("srcdigest:"))).toBe(true);
  });

  it("B) o prazo do TR (15 dias) chega ao payload de geração", async () => {
    checkIdempotency.mockResolvedValue({ status: "new" });
    await gen();
    expect(capturedPrompt).toContain("15 dias");
  });

  it("C) retry com o mesmo input → replay (sem reexecutar cognição, sem duplicar)", async () => {
    const cached = { document: { id: "ed", kind: "edital", title: "Edital — X", content: "cacheado" }, validation: { valid: true, violations: [] } };
    checkIdempotency.mockResolvedValue({ status: "completed", payloadMismatch: false, response: cached });
    const res = await gen();
    expect(res.replayed).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
    expect(saveIdempotencyResult).not.toHaveBeenCalled();
  });

  it("D) falha do provider → nenhum rascunho falso, chave marcada failed, retry possível", async () => {
    checkIdempotency.mockResolvedValue({ status: "new" });
    invoke.mockRejectedValueOnce(new Error("provider indisponível"));
    await expect(gen()).rejects.toThrow(/provider indispon/);
    expect(procDb.applyDraftContentMutationTx).not.toHaveBeenCalled();
    expect(saveIdempotencyResult).not.toHaveBeenCalled();
    expect(failIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it("E) isolamento multi-tenant: documento-base de outro tenant não vaza (vira [REVISAR])", async () => {
    checkIdempotency.mockResolvedValue({ status: "new" });
    await gen({ organizationId: OTHER_ORG });
    // O TR do ORG não pode aparecer no contexto de OUTRO tenant; a seção base vira [REVISAR].
    expect(capturedPrompt).not.toContain("obrigações da contratada e critérios de aceitação");
    expect(capturedPrompt).toContain("[REVISAR:");
  });

  it("edital INVÁLIDO (eletrônico sem plataforma) → sem cognição e sem idempotência", async () => {
    const res = await generateNotice({
      organizationId: ORG, processId: PID, object: "X", modality: "pregao", form: "eletronico",
      platform: undefined, correlationId: "c", idempotencyKey: "k-inv", actorUserId: 7, invoke,
    });
    expect(res.validation.valid).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
    expect(checkIdempotency).not.toHaveBeenCalled();
  });
});

describe("P0 — getEditalSourceState (F: SOURCE_CHANGED)", () => {
  it("never_generated quando não há edital", async () => {
    editalStored = null;
    const st = await getEditalSourceState({ organizationId: ORG, processId: PID, object: "Aquisição de material", modality: "pregao", form: "eletronico", platform: "compras_gov" });
    expect(st.state).toBe("never_generated");
  });

  it("current quando o digest gravado corresponde às fontes atuais; source_changed após alterar o TR", async () => {
    // Gera o edital de verdade para capturar o digest atual das fontes.
    checkIdempotency.mockResolvedValue({ status: "new" });
    const res = await gen();
    const stored = res.document.sources.find((s) => s.startsWith("srcdigest:"))!;
    editalStored = { content: res.document.content, sources: res.document.sources };

    const same = await getEditalSourceState({ organizationId: ORG, processId: PID, object: "Aquisição de material", modality: "pregao", form: "eletronico", platform: "compras_gov" });
    expect(same.state).toBe("current");
    expect(`srcdigest:${same.storedDigest}`).toBe(stored);

    // Altera o conteúdo do TR (nova versão) → o digest atual diverge → source_changed.
    getGeneratedDocumentByKind.mockImplementation(async (_pid: string, orgId: number, kind: string) => {
      if (orgId !== ORG) return null;
      if (kind === "tr") return { id: "t", kind, title: "TR", content: TR_CONTENT + " ALTERAÇÃO POSTERIOR: prazo 30 dias.", status: "aprovado", sources: [], authorUserId: 1, lastSubstantiveActorUserId: 1, updatedAt: "2026-03-01T00:00:00Z" };
      if (kind === "etp") return { id: "e", kind, title: "ETP", content: ETP_CONTENT, status: "aprovado", sources: [], authorUserId: 1, lastSubstantiveActorUserId: 1, updatedAt: "x" };
      if (kind === "dfd") return { id: "d", kind, title: "DFD", content: DFD_CONTENT, status: "aprovado", sources: [], authorUserId: 1, lastSubstantiveActorUserId: 1, updatedAt: "x" };
      if (kind === "edital") return editalStored ? { id: "ed", kind, title: "Edital", content: editalStored.content, status: "rascunho", sources: editalStored.sources, authorUserId: 1, lastSubstantiveActorUserId: 1, updatedAt: "x" } : null;
      return null;
    });
    const changed = await getEditalSourceState({ organizationId: ORG, processId: PID, object: "Aquisição de material", modality: "pregao", form: "eletronico", platform: "compras_gov" });
    expect(changed.state).toBe("source_changed");
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0.1/P0.3 — geração do TR e do Edital com Itens da contratação: FAIL-CLOSED (guarda compartilhada) antes de
 * reservar idempotência ou chamar o provider quando falta quantidade PREVISTA (PLANNED_QUANTITY_REQUIRED) ou há
 * Item Inteligente aprovado sem vínculo (PRICE_RESEARCH_ITEM_UNLINKED). Nunca cai para a quantidade da cotação.
 * O ETP não bloqueia (exibe "[a definir]") — segue para a idempotência normalmente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/procurement");
vi.mock("../../services/idempotencyService", () => ({
  checkIdempotency: vi.fn(async () => ({ status: "new" })), saveIdempotencyResult: vi.fn(), failIdempotencyKey: vi.fn(),
}));
vi.mock("../../services/authoring/authoringContext", async (orig) => ({
  ...(await orig<typeof import("../../services/authoring/authoringContext")>()),
  resolveDocumentAuthoringContext: vi.fn(),
}));
vi.mock("../../services/authoring/structuredAuthoringService", async (orig) => ({
  ...(await orig<typeof import("../../services/authoring/structuredAuthoringService")>()),
  generateStructuredAuthoring: vi.fn(),
  generateEditalAuthoring: vi.fn(),
}));
vi.mock("../../services/authoring/editalContext", async (orig) => ({
  ...(await orig<typeof import("../../services/authoring/editalContext")>()),
  resolveEditalSources: vi.fn(),
}));

import * as procDb from "../../db/procurement";
import * as idem from "../../services/idempotencyService";
import * as authoring from "../../services/authoring/authoringContext";
import * as structured from "../../services/authoring/structuredAuthoringService";
import * as edital from "../../services/authoring/editalContext";
import { generateDocument, generateNotice } from "../../services/procurementProcessService";

const ctxWith = (canonical: any) => ({
  sourcesDigest: "d".repeat(64), lineageMarkers: [], usedSources: [], missing: [], canonical,
  quantitySource: canonical ? "canonical_planned" : "legacy",
} as any);
const runEdital = () => generateNotice({ organizationId: 7, processId: "p1", object: "Limpeza", modality: "pregao", form: "eletronico", platform: "compras_gov", correlationId: "c", idempotencyKey: "k", actorUserId: 5, invoke: async () => "{}" } as any);
const run = () => generateDocument({ organizationId: 7, processId: "p1", kind: "tr", object: "Limpeza", correlationId: "c", idempotencyKey: "k", actorUserId: 5, invoke: async () => "{}" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(procDb.listIntelligentItems).mockResolvedValue([] as any);
});

describe("TR — guarda do Contexto Canônico", () => {
  it("sem quantidade prevista ⇒ PLANNED_QUANTITY_REQUIRED, sem reservar idempotência nem chamar o provider", async () => {
    vi.mocked(authoring.resolveDocumentAuthoringContext).mockResolvedValue(ctxWith({ contextDigest: "x", missingPlannedQuantity: [{ id: "a", description: "Detergente" }], unlinkedApprovedItemCount: 0 }));
    await expect(run()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("PLANNED_QUANTITY_REQUIRED: Defina a quantidade prevista do item antes de gerar o Termo de Referência") });
    expect(idem.checkIdempotency).not.toHaveBeenCalled();
    expect(structured.generateStructuredAuthoring).not.toHaveBeenCalled();
  });

  it("Item Inteligente aprovado sem vínculo ⇒ PRICE_RESEARCH_ITEM_UNLINKED (sem vínculo silencioso)", async () => {
    vi.mocked(authoring.resolveDocumentAuthoringContext).mockResolvedValue(ctxWith({ contextDigest: "x", missingPlannedQuantity: [], unlinkedApprovedItemCount: 2 }));
    await expect(run()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("PRICE_RESEARCH_ITEM_UNLINKED") });
    expect(idem.checkIdempotency).not.toHaveBeenCalled();
  });
});

describe("Edital — MESMA guarda do Contexto Canônico", () => {
  it("5 itens canônicos, 1 sem quantidade prevista ⇒ PLANNED_QUANTITY_REQUIRED (nunca 4 canônicos + 1 da Pesquisa)", async () => {
    vi.mocked(edital.resolveEditalSources).mockResolvedValue(ctxWith({ contextDigest: "x", missingPlannedQuantity: [{ id: "e", description: "Escova" }], unlinkedApprovedItemCount: 0 }));
    await expect(runEdital()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("PLANNED_QUANTITY_REQUIRED: Defina a quantidade prevista dos itens antes de gerar o Edital.") });
    expect(idem.checkIdempotency).not.toHaveBeenCalled();
    expect(structured.generateEditalAuthoring).not.toHaveBeenCalled();
  });

  it("Item Inteligente aprovado sem vínculo ⇒ PRICE_RESEARCH_ITEM_UNLINKED", async () => {
    vi.mocked(edital.resolveEditalSources).mockResolvedValue(ctxWith({ contextDigest: "x", missingPlannedQuantity: [], unlinkedApprovedItemCount: 1 }));
    await expect(runEdital()).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("PRICE_RESEARCH_ITEM_UNLINKED") });
    expect(idem.checkIdempotency).not.toHaveBeenCalled();
  });
});

describe("ETP — quantidade prevista ausente NÃO bloqueia (o prompt diz \"[a definir]\")", () => {
  it("segue para a idempotência (nenhum PLANNED_QUANTITY_REQUIRED)", async () => {
    vi.mocked(authoring.resolveDocumentAuthoringContext).mockResolvedValue(ctxWith({ contextDigest: "x", missingPlannedQuantity: [{ id: "a", description: "Detergente" }], unlinkedApprovedItemCount: 1 }));
    const r = await generateDocument({ organizationId: 7, processId: "p1", kind: "etp", object: "Limpeza", correlationId: "c", idempotencyKey: "k", actorUserId: 5, invoke: async () => "{}" }).catch((e) => e);
    expect(String(r?.message ?? "")).not.toMatch(/PLANNED_QUANTITY_REQUIRED|PRICE_RESEARCH_ITEM_UNLINKED/);
    expect(idem.checkIdempotency).toHaveBeenCalled();
  });
});

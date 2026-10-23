/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR-04 (SEM-005) — `procurementProcess.importPriceResearch` (caminho legado de gravação direta) pelo ROUTER real.
 *
 * Sem DB: serviços mockados. Prova que:
 *   - flag `FF_CANONICAL_INGESTION` LIGADA para o órgão ⇒ PRECONDITION_FAILED explicativo ANTES de qualquer escrita
 *     (o serviço de importação nunca é chamado), inclusive em chamada direta à API;
 *   - a flag é consultada com o organizationId do CONTEXTO (nunca do input);
 *   - flag DESLIGADA ⇒ comportamento legado preservado (delegação ao serviço, confirmReplace=false por padrão);
 *   - substituição de cotações já registradas ⇒ CONFLICT com o código estável; `confirmReplace` é repassado.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const role = vi.hoisted(() => ({ value: "operator" as string, org: 7 }));
const flags = vi.hoisted(() => ({ isFeatureEnabled: vi.fn(async (..._a: unknown[]) => false) }));
const svc = vi.hoisted(() => ({ importManualPriceResearch: vi.fn() }));

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: role.org,
    membership: { id: 1, organizationId: role.org, userId: 1, role: role.value, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
vi.mock("../../services/featureFlagService", () => flags);
vi.mock("../../services/activityLogService", () => ({ logActivity: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../services/itemMaterializationService", async (orig) => ({
  ...(await orig<typeof import("../../services/itemMaterializationService")>()),
  importManualPriceResearch: svc.importManualPriceResearch,
}));
vi.mock("../../db/procurement", async (orig) => ({
  ...(await orig<typeof import("../../db/procurement")>()),
  getProcess: vi.fn(async (id: string, org: number) => (id === "p1" && org === role.org ? { id, organizationId: org } : null)),
  listIntelligentItems: vi.fn(async () => []),
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import { CANONICAL_INGESTION_FLAG } from "../../services/ingestionUploadService";
import { PriceQuoteReplacementRequiresConfirmationError } from "../../domain/priceResearch";
import { makeContext, mockUser } from "../helpers/fixtures";

const proc = () => procurementProcessRouter.createCaller(makeContext(mockUser) as any);
const TEXT = "Notebook;10;un;R$ 4.000,00;Fornecedor A";
const OK = {
  research: { id: "r", processId: "p1", organizationId: 7, source: "colar", itemCount: 1, correlationId: "c", createdAt: "x" },
  quoteCount: 1, synthetic: false,
  result: { items: [], created: [], updated: [], unchanged: [], preserved: [], sourceChanged: [], reconciled: [], reviewRequired: [] },
};

async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try { await p; return null; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
}

beforeEach(() => {
  role.value = "operator";
  flags.isFeatureEnabled.mockReset().mockResolvedValue(false);
  svc.importManualPriceResearch.mockReset().mockResolvedValue(OK);
});

describe("PR-04 · flag FF_CANONICAL_INGESTION LIGADA ⇒ gravação direta legada recusada sem efeito", () => {
  it("PRECONDITION_FAILED explicativo; serviço de importação nunca chamado; flag lida no tenant do contexto", async () => {
    flags.isFeatureEnabled.mockResolvedValue(true);
    const e = await err(proc().importPriceResearch({ processId: "p1", source: "colar", text: TEXT }));
    expect(e?.code).toBe("PRECONDITION_FAILED");
    expect(e?.message).toMatch(/^LEGACY_PRICE_IMPORT_DISABLED:/);
    expect(e?.message).toContain("ingestão supervisionada");
    expect(e?.message).toContain("Nenhuma cotação foi gravada");
    expect(svc.importManualPriceResearch).not.toHaveBeenCalled();
    expect(flags.isFeatureEnabled).toHaveBeenCalledWith(CANONICAL_INGESTION_FLAG, 7);
  });

  it("nem confirmReplace contorna a recusa", async () => {
    flags.isFeatureEnabled.mockResolvedValue(true);
    const e = await err(proc().importPriceResearch({ processId: "p1", source: "manual", text: TEXT, confirmReplace: true }));
    expect(e?.code).toBe("PRECONDITION_FAILED");
    expect(svc.importManualPriceResearch).not.toHaveBeenCalled();
  });

  it("processo de outro órgão continua NOT_FOUND (sem vazar estado da flag)", async () => {
    flags.isFeatureEnabled.mockResolvedValue(true);
    expect((await err(proc().importPriceResearch({ processId: "outro", source: "colar", text: TEXT })))?.code).toBe("NOT_FOUND");
  });

  it("viewer segue FORBIDDEN antes de qualquer consulta", async () => {
    role.value = "viewer";
    expect((await err(proc().importPriceResearch({ processId: "p1", source: "colar", text: TEXT })))?.code).toBe("FORBIDDEN");
    expect(svc.importManualPriceResearch).not.toHaveBeenCalled();
  });
});

describe("PR-04 · flag DESLIGADA ⇒ caminho legado preservado, substituição só com confirmação", () => {
  it("importação normal delega ao serviço com confirmReplace=false e devolve o resultado", async () => {
    const r = await proc().importPriceResearch({ processId: "p1", source: "colar", text: TEXT });
    expect(r.research.id).toBe("r");
    expect(svc.importManualPriceResearch).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 7, processId: "p1", confirmReplace: false }));
  });

  it("substituição sem confirmação ⇒ CONFLICT com código estável (nada gravado pelo serviço)", async () => {
    svc.importManualPriceResearch.mockRejectedValue(new PriceQuoteReplacementRequiresConfirmationError([
      { id: "q", description: "Notebook", before: { supplier: "A", valueCents: 400000 }, after: { supplier: "D", valueCents: 420000 } },
    ]));
    const e = await err(proc().importPriceResearch({ processId: "p1", source: "colar", text: TEXT }));
    expect(e?.code).toBe("CONFLICT");
    expect(e?.message).toMatch(/^QUOTE_REPLACEMENT_CONFIRMATION_REQUIRED:/);
  });

  it("confirmReplace=true é repassado ao serviço", async () => {
    await proc().importPriceResearch({ processId: "p1", source: "colar", text: TEXT, confirmReplace: true });
    expect(svc.importManualPriceResearch).toHaveBeenCalledWith(expect.objectContaining({ confirmReplace: true }));
  });
});

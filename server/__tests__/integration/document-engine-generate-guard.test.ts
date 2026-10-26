/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * `documentEngine.generate` (endpoint genérico do pipeline único): antes era `tenantProcedure` — qualquer membro, até
 * viewer, anexava versões `gerado` a QUALQUER linhagem, inclusive depois da emissão, deslocando a numeração oficial.
 * Agora: manager+; nunca em linhagem governada (DFD/ETP/TR/Edital do Processo Licitatório) nem em linhagem com
 * versão emitida. Serviços mockados (sem DB).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const role = vi.hoisted(() => ({ value: "manager" as string }));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: role.value, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
vi.mock("../../services/documentEngineService", async (orig) => ({
  ...(await orig<typeof import("../../services/documentEngineService")>()),
  generateOfficialDocument: vi.fn(async () => ({ id: "doc-1", version: 1 })),
}));
vi.mock("../../db/officialDocuments", async (orig) => ({
  ...(await orig<typeof import("../../db/officialDocuments")>()),
  getLatestEmittedByOrigin: vi.fn(async () => null),
}));

import { documentEngineRouter, isGovernedLineage } from "../../routers/documentEngineRouter";
import { makeContext, mockUser } from "../helpers/fixtures";
import * as engine from "../../services/documentEngineService";
import * as officialDocs from "../../db/officialDocuments";

const caller = () => documentEngineRouter.createCaller(makeContext(mockUser) as any);
const input = (over: Record<string, unknown> = {}) => ({
  businessDomain: "contratos" as const, documentType: "contrato" as const, origin: "ws-1", title: "Contrato", content: "texto", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  role.value = "manager";
  (officialDocs.getLatestEmittedByOrigin as any).mockResolvedValue(null);
});

describe("documentEngine.generate · guarda", () => {
  it("viewer e operator recebem FORBIDDEN e nada é gerado", async () => {
    for (const r of ["viewer", "operator"]) {
      role.value = r;
      await expect(caller().generate(input())).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(engine.generateOfficialDocument).not.toHaveBeenCalled();
  });
  it("linhagem governada do Processo Licitatório é recusada mesmo para manager", async () => {
    for (const t of ["dfd", "etp", "tr", "edital"] as const) {
      await expect(caller().generate(input({ businessDomain: "processo_licitatorio", documentType: t, origin: "p1" })))
        .rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("GOVERNED_LINEAGE") });
    }
    expect(engine.generateOfficialDocument).not.toHaveBeenCalled();
    expect(isGovernedLineage("contratos", "contrato")).toBe(false);
  });
  it("linhagem com versão emitida é recusada (numeração oficial imutável)", async () => {
    (officialDocs.getLatestEmittedByOrigin as any).mockResolvedValue({ id: "x", version: 2, status: "emitido" });
    await expect(caller().generate(input())).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("LINEAGE_HAS_EMITTED_VERSION") });
    expect(officialDocs.getLatestEmittedByOrigin).toHaveBeenCalledWith(1, "contratos", "ws-1", "contrato");
    expect(engine.generateOfficialDocument).not.toHaveBeenCalled();
  });
  it("manager em linhagem não governada e sem emissão: gera normalmente", async () => {
    const r = await caller().generate(input());
    expect(r.document).toMatchObject({ id: "doc-1" });
    expect(engine.generateOfficialDocument).toHaveBeenCalledTimes(1);
  });
});

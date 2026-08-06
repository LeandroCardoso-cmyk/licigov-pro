/**
 * PR B.2.2 — ingestion.getCapabilities (gating da UI + matriz de capacidades REAL).
 *
 * Verifica: fail-closed (flag desligada ⇒ enabled=false, sem lançar), e que `supported` é DERIVADO
 * do parserRegistry — CSV/XLSX/XLS reais (supported=true) e PDF/DOCX stub (supported=false). Assim a
 * UI nunca apresenta como funcional um formato cujo parser é stub. Serviços de tenant/flag mockados.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn().mockResolvedValue({
    organizationId: 1,
    membership: { id: 1, organizationId: 1, userId: 1, role: "owner", invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  }),
}));

vi.mock("../../services/featureFlagService", () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));

import { ingestionRouter } from "../../routers/ingestionRouter";
import { makeContext, mockUser } from "../helpers/fixtures";
import * as flags from "../../services/featureFlagService";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const caller = () => ingestionRouter.createCaller(makeContext(mockUser) as any);

function bykey(formats: Array<{ key: string; supported: boolean }>, key: string) {
  return formats.find(f => f.key === key);
}

describe("ingestion.getCapabilities — capacidade real e fail-closed", () => {
  beforeEach(() => {
    vi.mocked(flags.isFeatureEnabled).mockResolvedValue(true);
  });

  it("flag LIGADA: enabled=true e informa o limite de tamanho", async () => {
    const caps = await caller().getCapabilities();
    expect(caps.enabled).toBe(true);
    expect(caps.maxFileSizeBytes).toBe(50 * 1024 * 1024);
  });

  it("flag DESLIGADA: enabled=false (fail-closed) sem lançar", async () => {
    vi.mocked(flags.isFeatureEnabled).mockResolvedValue(false);
    const caps = await caller().getCapabilities();
    expect(caps.enabled).toBe(false);
  });

  it("CSV/XLSX/XLS são suportados (parser real)", async () => {
    const caps = await caller().getCapabilities();
    expect(bykey(caps.formats, "csv")?.supported).toBe(true);
    expect(bykey(caps.formats, "xlsx")?.supported).toBe(true);
    expect(bykey(caps.formats, "xls")?.supported).toBe(true);
  });

  it("PDF/DOCX NÃO são suportados (parser stub) — nunca apresentados como funcionais", async () => {
    const caps = await caller().getCapabilities();
    expect(bykey(caps.formats, "pdf")?.supported).toBe(false);
    expect(bykey(caps.formats, "docx")?.supported).toBe(false);
    // supportedFormats só contém formatos com parser real.
    expect(caps.supportedFormats.map(f => f.key).sort()).toEqual(["csv", "xls", "xlsx"]);
    expect(caps.supportedFormats.some(f => f.key === "pdf" || f.key === "docx")).toBe(false);
  });
});

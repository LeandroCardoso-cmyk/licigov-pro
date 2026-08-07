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

function bykey(formats: Array<{ key: string; supported: boolean; limitations?: string[] }>, key: string) {
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

  it("PDF/DOCX passam a ser suportados na B.2.3 (extração real) com limitações declaradas", async () => {
    const caps = await caller().getCapabilities();
    expect(bykey(caps.formats, "pdf")?.supported).toBe(true);
    expect(bykey(caps.formats, "docx")?.supported).toBe(true);
    // supportedFormats agora inclui pdf/docx; nenhum stub é apresentado como funcional.
    expect(caps.supportedFormats.map(f => f.key).sort()).toEqual(["csv", "docx", "pdf", "xls", "xlsx"]);
    // Limitações reais (ex.: OCR não suportado no PDF) são expostas para o operador.
    expect((bykey(caps.formats, "pdf")?.limitations ?? []).some(l => /OCR/i.test(l))).toBe(true);
  });
});

/**
 * DATA-039 — FAIL-CLOSED das operações AUTORITATIVAS compostas quando o banco está indisponível.
 *
 * LiciGov Pro prioriza fail-closed para criação/mutação autoritativa: a API NUNCA deve aparentar
 * sucesso ("sucesso fantasma") quando nada foi persistido — isso quebraria auditabilidade,
 * determinismo e rastreabilidade. Aqui o `getDb` é mockado para indisponível (determinístico,
 * independente de DATABASE_URL): os helpers autoritativos devem LANÇAR, não retornar sucesso.
 * A mensagem é genérica (sem infraestrutura/secret); a tradução institucional/sanitização é do router.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => undefined) }));

import { createProcessWithInitialEvent, insertResearchWithItems } from "../../db/procurement";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { createPriceResearchWorkspace } from "../../domain/priceResearch";

describe("DATA-039 — fail-closed sem banco (operação autoritativa não finge sucesso)", () => {
  it("createProcessWithInitialEvent LANÇA quando o banco está indisponível", async () => {
    const p = createProcurementWorkspace({
      organizationId: 1, processNumber: "FC/2026", object: "objeto fail-closed",
      startOption: "criar_dfd", responsibleUser: 1, correlationId: "fc",
    });
    await expect(createProcessWithInitialEvent(p, {
      eventType: "workspace_created", actor: "1", summary: "s", refId: p.id, correlationId: "fc",
    })).rejects.toThrow(/indispon[ií]vel/i);
  });

  it("insertResearchWithItems LANÇA quando o banco está indisponível", async () => {
    const r = createPriceResearchWorkspace({ processId: "p", organizationId: 1, source: "manual", correlationId: "fc" });
    await expect(insertResearchWithItems({ ...r, itemCount: 0 }, [])).rejects.toThrow(/indispon[ií]vel/i);
  });

  it("a mensagem de erro NÃO vaza infraestrutura/secret (genérica)", async () => {
    const r = createPriceResearchWorkspace({ processId: "p", organizationId: 1, source: "manual", correlationId: "fc" });
    const err = await insertResearchWithItems({ ...r, itemCount: 0 }, []).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).not.toMatch(/mysql:\/\/|password|senha|DATABASE_URL|@|:3306/i);
  });
});

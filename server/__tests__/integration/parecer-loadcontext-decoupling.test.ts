/**
 * V1 STABILIZATION — Desacoplamento de Reasoning & Explainability do caminho de
 * ABERTURA do Parecer (regressão de performance).
 *
 * Prova, de forma determinística e SEM banco/LLM real, que:
 *
 *  - `loadWorkspaceContext` (conteúdo operacional que o Procurador precisa para
 *    trabalhar) NÃO faz nenhuma chamada cognitiva: zero `orchestrateMultiCopilot`
 *    (Kernel → RAG → LLM) e zero `assertKernelAccess` das portas cognitivas.
 *    → o round-trip de IA foi REMOVIDO do caminho crítico de abertura;
 *  - `loadWorkspaceReasoning` (apoio à decisão), esse sim, atravessa a porta do
 *    Kernel (institutional_rag + copilot_infrastructure + explainability) e chama
 *    `orchestrateMultiCopilot` exatamente uma vez, preservando correlationId e tenant;
 *  - o isolamento multi-tenant é preservado: o organizationId do chamador é
 *    propagado à orquestração (nunca um tenant global/compartilhado).
 *
 * Este é o núcleo da correção: antes, TODA abertura/refresh do workspace bloqueava
 * no LLM; agora o LLM só ocorre na consulta separada de reasoning.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Intercepta a orquestração cognitiva e a porta do Kernel ANTES de importar o serviço.
const orchestrateSpy = vi.fn(async (params: { organizationId: number; correlationId: string }) => ({
  request: "x",
  selectedCopilots: ["juridico"],
  perCopilot: [],
  consolidated: {
    summary: `reasoning para tenant ${params.organizationId} / corr ${params.correlationId}`,
    suggestions: ["Rever art. 72 da Lei 14.133/2021."],
    legalBasis: ["Lei 14.133/2021, art. 72"],
    confidence: 0.8,
  },
  conflicts: [],
  contextPackage: {},
}));
const assertKernelAccessSpy = vi.fn(() => undefined);

vi.mock("../../services/workspaceOrchestratorService", () => ({
  orchestrateMultiCopilot: (p: never) => orchestrateSpy(p),
}));
vi.mock("../../services/kernelAccessService", () => ({
  assertKernelAccess: (...a: unknown[]) => assertKernelAccessSpy(...(a as [])),
}));

import {
  loadWorkspaceContext, loadWorkspaceReasoning,
} from "../../services/legalOpinionWorkspaceService";

const ORG = 771001;
const ORG_OTHER = 771002;
const CORR = "corr-decoupling";

describe("V1 · Parecer — Reasoning desacoplado da abertura do workspace", () => {
  beforeEach(() => {
    orchestrateSpy.mockClear();
    assertKernelAccessSpy.mockClear();
  });

  it("loadWorkspaceContext NÃO chama orchestrateMultiCopilot nem as portas cognitivas do Kernel", async () => {
    const ctx = await loadWorkspaceContext({ workspaceId: "ws-x", organizationId: ORG, correlationId: CORR });
    // Sem banco, degrada graciosamente — mas o ponto é: nada de LLM/Kernel cognitivo.
    expect(ctx.workspace).toBeNull();
    expect(orchestrateSpy).not.toHaveBeenCalled();
    expect(assertKernelAccessSpy).not.toHaveBeenCalled();
    // E o bundle operacional não expõe campos de reasoning (contrato do split).
    expect(ctx).not.toHaveProperty("reasoning");
    expect(ctx).not.toHaveProperty("confidence");
  });

  it("loadWorkspaceReasoning atravessa a porta do Kernel e chama a orquestração 1x", async () => {
    const r = await loadWorkspaceReasoning({ workspaceId: "ws-x", organizationId: ORG, correlationId: CORR });
    expect(orchestrateSpy).toHaveBeenCalledTimes(1);
    // As três portas cognitivas são verificadas (institutional_rag, copilot_infrastructure, explainability).
    expect(assertKernelAccessSpy).toHaveBeenCalledTimes(3);
    const ports = assertKernelAccessSpy.mock.calls.map((c) => (c as unknown[])[1]);
    expect(ports).toContain("institutional_rag");
    expect(ports).toContain("copilot_infrastructure");
    expect(ports).toContain("explainability");
    expect(typeof r.reasoning.summary).toBe("string");
    expect(r.confidence).toBeGreaterThan(0);
  });

  it("isolamento multi-tenant: o organizationId do chamador é propagado à orquestração", async () => {
    await loadWorkspaceReasoning({ workspaceId: "ws-a", organizationId: ORG, correlationId: CORR });
    await loadWorkspaceReasoning({ workspaceId: "ws-b", organizationId: ORG_OTHER, correlationId: CORR });
    const orgs = orchestrateSpy.mock.calls.map((c) => (c[0] as { organizationId: number }).organizationId);
    expect(orgs).toEqual([ORG, ORG_OTHER]);
    // correlationId preservado (proveniência da execução).
    expect((orchestrateSpy.mock.calls[0][0] as { correlationId: string }).correlationId).toBe(CORR);
  });
});

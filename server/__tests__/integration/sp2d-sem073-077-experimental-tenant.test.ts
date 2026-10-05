/**
 * SP2-D / SEM-073 + SEM-077 — com o opt-in de desenvolvimento LIGADO (LEG-028 aberto), as APIs experimentais em
 * memória NÃO confiam em `organizationId`/aprovador vindos do cliente.
 *
 * SEM-073: `exports.*`, `structuredExports.exportItemTRs/exportAuditTrail`, `itemAnalytics.getDashboard` e
 * `reviewWorkspace.*` derivam a organização do CONTEXTO autenticado (`tenantProcedure`); `organizationId` do input é
 * só compatibilidade — divergente ⇒ FORBIDDEN `ORGANIZATION_INPUT_MISMATCH` antes de ler/escrever o estado em memória.
 * SEM-077: aprovação com tenant na escrita, aprovador = usuário autenticado (nunca o input), mesmo aprovador conta
 * uma vez, workflow resolvido não reabre; agentes nunca marcam saída simulada como `completed`.
 *
 * Sem banco (mocks de tenant). Os módulos são recarregados sob APP_ENV=development + opt-in (a capability é avaliada no load).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- callers dinâmicos de teste */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// user 42/44 → org 7 · user 43 → org 8 (dois usuários no mesmo tenant para testar designação)
const ORG_OF_USER: Record<number, number> = { 42: 7, 44: 7, 43: 8 };
const tenantSpy = vi.hoisted(() => vi.fn());

vi.mock("../../services/tenantService", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveTenantForUser: tenantSpy,
}));

const ENV_KEYS = ["APP_ENV", "EXPERIMENTAL_IN_MEMORY_APIS_ENABLED", "JWT_SECRET", "ADMIN_PASSWORD"] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeEach(() => { vi.spyOn(console, "info").mockImplementation(() => undefined); });
afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = ORIGINAL_ENV[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
  vi.resetModules();
});

function ctxFor(userId: number) {
  return {
    user: { id: userId, role: "user", name: `U${userId}`, email: `user${userId}@example.gov.br` },
    organizationId: null,
    orgMembership: null,
    correlationId: `sp2d-corr-${userId}`,
    requestId: `sp2d-req-${userId}`,
    req: { headers: {}, ip: "203.0.113.50" },
    res: { setHeader: () => undefined },
  };
}

type Caller = Record<string, (input?: unknown) => Promise<any>>;
let routers: Record<string, { createCaller: (ctx: unknown) => Caller }>;
let audit: typeof import("../../services/operationalAuditService");
let agentEngine: typeof import("../../services/agentExecutionEngine");

async function loadOpenGate() {
  process.env.APP_ENV = "development";
  process.env.EXPERIMENTAL_IN_MEMORY_APIS_ENABLED = "true";
  process.env.JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32 ? process.env.JWT_SECRET : "x".repeat(40);
  process.env.ADMIN_PASSWORD = "admin-super-secret-123";
  vi.resetModules();
  tenantSpy.mockImplementation(async (userId: number) => ({
    organizationId: ORG_OF_USER[userId],
    membership: {
      id: 1, organizationId: ORG_OF_USER[userId], userId, role: "owner", invitedBy: null, ativo: true,
      createdAt: new Date(), updatedAt: new Date(),
    },
  }));
  const config = await import("../../config/experimentalApis");
  expect(config.EXPERIMENTAL_API_CONFIG.allowed).toBe(true);
  routers = {
    exports: (await import("../../routers/exportRouter")).exportRouter as never,
    structuredExports: (await import("../../routers/structuredExportRouter")).structuredExportRouter as never,
    itemAnalytics: (await import("../../routers/itemAnalyticsRouter")).itemAnalyticsRouter as never,
    reviewWorkspace: (await import("../../routers/reviewWorkspaceRouter")).reviewWorkspaceRouter as never,
    approvalWorkflow: (await import("../../routers/approvalWorkflowRouter")).approvalWorkflowRouter as never,
  };
  audit = await import("../../services/operationalAuditService");
  agentEngine = await import("../../services/agentExecutionEngine");
}

const call = (mount: string, userId: number): Caller => routers[mount].createCaller(ctxFor(userId));

describe("SEM-073 — organização do contexto, não do cliente (opt-in dev LIGADO)", () => {
  it("exports: A gera e só A vê; B com o organizationId de A é recusado; sem organizationId usa o do contexto", async () => {
    await loadOpenGate();
    const gen = await call("exports", 42).generate({ processId: 11, organizationId: 7, format: "docx" });
    expect(gen.exportId).toBeTruthy();
    await expect(call("exports", 43).getHistory({ organizationId: 7 })).rejects.toMatchObject({
      code: "FORBIDDEN", message: expect.stringContaining("ORGANIZATION_INPUT_MISMATCH"),
    });
    expect(await call("exports", 43).getHistory({})).toEqual([]);
    const mine = await call("exports", 42).getHistory({});
    expect(mine).toHaveLength(1);
    expect(mine[0].organizationId).toBe(7);
  });

  it("exports.generate com organizationId de OUTRO tenant: FORBIDDEN e ZERO escrita no histórico de qualquer org", async () => {
    await loadOpenGate();
    await expect(call("exports", 42).generate({ processId: 12, organizationId: 8, format: "pdf" })).rejects.toMatchObject({
      code: "FORBIDDEN", message: expect.stringContaining("ORGANIZATION_INPUT_MISMATCH"),
    });
    expect(await call("exports", 42).getHistory({})).toEqual([]);
    expect(await call("exports", 43).getHistory({})).toEqual([]);
  });

  it("exports.getPreview: organizationId divergente é recusado; ausente/coincidente responde", async () => {
    await loadOpenGate();
    await expect(call("exports", 42).getPreview({ processId: 1, organizationId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call("exports", 42).getPreview({ processId: 1 })).resolves.toMatchObject({ itemCount: 2 });
    await expect(call("exports", 42).getPreview({ processId: 1, organizationId: 7 })).resolves.toMatchObject({ itemCount: 2 });
  });

  it("structuredExports.exportAuditTrail: trilha de A nunca sai para B; divergente ⇒ FORBIDDEN", async () => {
    await loadOpenGate();
    audit.recordAuditEvent({
      organizationId: 7, category: "export", action: "export", actorId: 42, actorRole: "owner", targetType: "process",
      targetId: "A-ONLY", before: null, after: null, justification: null, correlationId: "c", occurredAt: new Date().toISOString(),
    });
    const own = await call("structuredExports", 42).exportAuditTrail({});
    expect(JSON.stringify(own)).toContain("A-ONLY");
    await expect(call("structuredExports", 43).exportAuditTrail({ organizationId: 7 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const theirs = await call("structuredExports", 43).exportAuditTrail({});
    expect(JSON.stringify(theirs)).not.toContain("A-ONLY");
  });

  it("structuredExports.exportItemTRs: divergente ⇒ FORBIDDEN; coincidente/ausente ⇒ usa a org do contexto", async () => {
    await loadOpenGate();
    await expect(call("structuredExports", 42).exportItemTRs({ processId: 1, organizationId: 8, format: "json" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(call("structuredExports", 42).exportItemTRs({ processId: 1, format: "json" })).resolves.toBeDefined();
  });

  it("itemAnalytics.getDashboard: snapshot é SEMPRE da org do contexto; divergente ⇒ FORBIDDEN", async () => {
    await loadOpenGate();
    await expect(call("itemAnalytics", 42).getDashboard({ organizationId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const dash = await call("itemAnalytics", 43).getDashboard({});
    expect(dash.kpis.snapshot.organizationId).toBe(8);
  });

  it("reviewWorkspace: fila/histórico/resumo usam o store da org do contexto; divergente ⇒ FORBIDDEN", async () => {
    await loadOpenGate();
    for (const [proc, input] of [
      ["getQueue", { organizationId: 8 }],
      ["getSummary", { organizationId: 8 }],
      ["getReviewHistory", { itemId: "x", organizationId: 8 }],
    ] as const) {
      await expect(call("reviewWorkspace", 42)[proc](input), proc).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const queueA = await call("reviewWorkspace", 42).getQueue({});
    const queueB = await call("reviewWorkspace", 43).getQueue({});
    expect(queueA.length).toBeGreaterThan(0);
    expect(queueA.every((i: any) => i.organizationId === 7)).toBe(true);
    expect(queueB.every((i: any) => i.organizationId === 8)).toBe(true);
    const idsA = new Set(queueA.map((i: any) => i.id));
    expect(queueB.some((i: any) => idsA.has(i.id))).toBe(false);
  });

  it("freeze: os 4 routers não usam o builder protegido e toda leitura de input.organizationId passa por organizationFromContext", () => {
    for (const f of ["exportRouter", "structuredExportRouter", "itemAnalyticsRouter", "reviewWorkspaceRouter"]) {
      const src = readFileSync(path.join(process.cwd(), `server/routers/${f}.ts`), "utf8");
      expect(src, f).not.toContain("experimentalProtectedProcedure");
      const reads = src.match(/input\.organizationId/g) ?? [];
      const guarded = src.match(/organizationFromContext\(ctx, input\.organizationId/g) ?? [];
      expect(reads.length, f).toBe(guarded.length);
      expect(reads.length, f).toBeGreaterThan(0);
    }
  });
});

describe("SEM-077 — workflow de aprovação: tenant na escrita, aprovador autenticado, 1 voto por aprovador", () => {
  async function createWorkflow(userId: number, requiredApprovers: string[]) {
    const created = await call("approvalWorkflow", userId).createApproval({ sessionId: "s", approvalType: "execution", requiredApprovers });
    return created.workflow.id as string;
  }

  it("aprovador gravado é o usuário autenticado: o `approver` do input é ignorado", async () => {
    await loadOpenGate();
    const wf = await createWorkflow(42, ["user42@example.gov.br"]);
    const updated = await call("approvalWorkflow", 42).approveExecution({ workflowId: wf, approver: "ceo@prefeitura.gov.br", justification: "ok" });
    expect(updated.decisions).toHaveLength(1);
    expect(updated.decisions[0].approver).toBe("user:42");
    expect(JSON.stringify(updated)).not.toContain("ceo@prefeitura.gov.br");
    expect(updated.status).toBe("approved");
  });

  it("o MESMO aprovador não fecha um workflow de 2 aprovadores aprovando N vezes (idempotente, 1 decisão)", async () => {
    await loadOpenGate();
    const wf = await createWorkflow(42, ["user42@example.gov.br", "user44@example.gov.br"]);
    let last: any;
    for (let i = 0; i < 3; i++) {
      last = await call("approvalWorkflow", 42).approveExecution({ workflowId: wf, justification: `voto ${i}` });
    }
    expect(last.status).toBe("pending");
    expect(last.decisions).toHaveLength(1);
    const closed = await call("approvalWorkflow", 44).approveExecution({ workflowId: wf, justification: "segundo" });
    expect(closed.status).toBe("approved");
    expect(closed.decisions.map((d: any) => d.approver)).toEqual(["user:42", "user:44"]);
  });

  it("aprovador não designado é recusado (FORBIDDEN) e nada é gravado", async () => {
    await loadOpenGate();
    const wf = await createWorkflow(42, ["user44@example.gov.br"]);
    await expect(call("approvalWorkflow", 42).approveExecution({ workflowId: wf, justification: "intruso" })).rejects.toMatchObject({
      code: "FORBIDDEN", message: expect.stringContaining("APPROVER_NOT_DESIGNATED"),
    });
    const pending = await call("approvalWorkflow", 42).listApprovals({});
    expect(pending.find((w: any) => w.id === wf).decisions).toHaveLength(0);
  });

  it("cross-tenant: org 8 não aprova/rejeita/escala nem enxerga o workflow da org 7 (NOT_FOUND idêntico ao inexistente)", async () => {
    await loadOpenGate();
    const wf = await createWorkflow(42, []);
    const messages: string[] = [];
    for (const [proc, input] of [
      ["approveExecution", { workflowId: wf, justification: "x" }],
      ["rejectExecution", { workflowId: wf, justification: "x" }],
      ["escalateExecution", { workflowId: wf, escalateTo: "alguem", reason: "x" }],
    ] as const) {
      const e = await call("approvalWorkflow", 43)[proc](input).then(() => null, (x: any) => x);
      expect(e?.code, proc).toBe("NOT_FOUND");
      messages.push(e?.message);
    }
    const ghost = await call("approvalWorkflow", 43).approveExecution({ workflowId: "inexistente", justification: "x" }).then(() => null, (x: any) => x);
    expect(ghost.code).toBe("NOT_FOUND");
    expect(new Set([...messages, ghost.message]).size).toBe(1);
    const mine = await call("approvalWorkflow", 42).listApprovals({});
    const w = mine.find((x: any) => x.id === wf);
    expect(w.status).toBe("pending");
    expect(w.decisions).toHaveLength(0);
    expect(await call("approvalWorkflow", 43).listApprovals({})).toEqual([]);
    expect(await call("approvalWorkflow", 43).inspectApproval({})).toEqual([]);
  });

  it("workflow resolvido não reabre: rejeição tardia ⇒ CONFLICT e o status permanece approved", async () => {
    await loadOpenGate();
    const wf = await createWorkflow(42, []);
    const approved = await call("approvalWorkflow", 42).approveExecution({ workflowId: wf, justification: "ok" });
    expect(approved.status).toBe("approved");
    await expect(call("approvalWorkflow", 44).rejectExecution({ workflowId: wf, justification: "tarde" })).rejects.toMatchObject({
      code: "CONFLICT", message: expect.stringContaining("APPROVAL_WORKFLOW_ALREADY_RESOLVED"),
    });
    await expect(call("approvalWorkflow", 42).escalateExecution({ workflowId: wf, escalateTo: "x", reason: "tarde" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("escalar registra o usuário autenticado como ator (não 'system')", async () => {
    await loadOpenGate();
    const wf = await createWorkflow(42, ["user44@example.gov.br"]);
    const esc = await call("approvalWorkflow", 42).escalateExecution({ workflowId: wf, escalateTo: "chefia", reason: "prazo" });
    expect(esc.status).toBe("escalated");
    expect(esc.decisions.at(-1).approver).toBe("user:42");
  });
});

describe("SEM-077 — domínio humanApproval: aprovadores distintos", () => {
  it("N aprovações do mesmo aprovador contam 1; sem aprovadores exigidos o limiar é 1 (delegar/escalar não aprova)", async () => {
    const d = await import("../../domain/humanApproval");
    let wf = d.createApprovalWorkflow({ organizationId: 7, approvalType: "t", requiredApprovers: ["a", "b"] });
    for (let i = 0; i < 5; i++) wf = d.recordApprovalDecision(wf, { approver: "user:1", decision: "approve", justification: "x" });
    expect(wf.status).toBe("pending");
    expect(wf.decisions).toHaveLength(1);
    expect(d.getApprovalSummary(wf).approved).toBe(1);
    expect(() => d.recordApprovalDecision(wf, { approver: "user:1", decision: "reject", justification: "x" })).toThrow(/APPROVER_ALREADY_DECIDED/);
    wf = d.recordApprovalDecision(wf, { approver: "user:2", decision: "approve", justification: "x" });
    expect(wf.status).toBe("approved");

    const open = d.createApprovalWorkflow({ organizationId: 7, approvalType: "t", requiredApprovers: [] });
    const delegated = d.recordApprovalDecision(open, { approver: "user:9", decision: "delegate", justification: "x" });
    expect(delegated.status).toBe("pending");
  });
});

describe("SEM-077 — agentes: saída simulada nunca é 'completed'/aprovada", () => {
  it("etapas simuladas ⇒ 'simulated'; execução 'simulated' sem completedAt; checkpoint não é ponto de rollback", async () => {
    await loadOpenGate();
    const out = agentEngine.runAgentExecution({
      organizationId: 7, sessionId: "sim-1", agentType: "legal",
      stages: [{ name: "fetch_data", input: { q: 1 } }, { name: "analyze", input: {} }],
    });
    expect(out.execution.stages).toHaveLength(2);
    for (const s of out.execution.stages) expect(s.status).toBe("simulated");
    expect(out.execution.status).toBe("simulated");
    expect(out.execution.completedAt).toBeNull();
    for (const [name, output] of Object.entries(out.stageOutputs)) expect(output.simulated, name).toBe(true);
    expect(out.execution.checkpoints.every((c) => c.isRollbackPoint === false)).toBe(true);
  });

  it("domínio: etapa 'awaiting_approval' domina o status da execução e não tem completedAt; falha domina tudo", async () => {
    const d = await import("../../domain/agentExecution");
    let exec = d.createAgentExecution({ organizationId: 7, sessionId: "s", agentType: "a", stageNames: ["x", "y"] });
    exec = d.advanceExecutionStage(exec, "x", {}, "completed");
    expect(exec.status).toBe("completed");
    exec = d.advanceExecutionStage(exec, "y", { status: "awaiting_approval" }, "awaiting_approval");
    expect(exec.status).toBe("awaiting_approval");
    expect(exec.stages.at(-1)?.completedAt).toBeNull();
    exec = d.advanceExecutionStage(exec, "z", {}, "failed");
    expect(exec.status).toBe("failed");
  });
});

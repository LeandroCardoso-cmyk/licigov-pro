/**
 * R2 / LEG-028 — APIs experimentais EM MEMÓRIA desligadas de forma governada (decisão humana: DISABLE EM PRODUÇÃO).
 *
 * Contrato comprovado:
 *  - capability única (`server/config/experimentalApis.ts`), fail-closed: production/staging ⇒ sempre desligada
 *    (nem o opt-in liga); development ⇒ desligada por padrão, liga só com `EXPERIMENTAL_IN_MEMORY_APIS_ENABLED=true`;
 *  - com a capability desligada, TODA procedure dos 12 routers recusa com `FORBIDDEN` + `LEGACY_ENDPOINT_DISABLED`,
 *    de forma determinística, ANTES de auth/tenant, da validação de input e do handler — nenhum serviço/domínio
 *    que mantém o estado em memória é chamado (tripwire) e nenhuma resolução de tenant (banco) acontece;
 *  - com opt-in em development ⇒ comportamento existente preservado (positivo de controle do tripwire);
 *  - freeze: lista dos routers gated, montagem em `server/routers.ts`, contagem de procedures e ausência de builder
 *    não-gated nesses arquivos.
 *
 * Nota: nenhum teste pré-existente exercita esses routers via tRPC (`sprint31-review-routers.test.ts` testa as
 * funções de domínio/serviço diretamente, que NÃO passam pelo gate), então nenhum setup existente precisou de opt-in.
 * Os módulos são recarregados (`vi.resetModules`) por ambiente, como em `ai-015-mock-fallback-policy.test.ts`,
 * porque a capability é avaliada uma única vez no boot.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─── Tripwire: registra toda chamada aos módulos que guardam/derivam o estado em memória ─────────────────────
const trip = vi.hoisted(() => {
  const calls: string[] = [];
  const wrap = (name: string, mod: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(mod)) {
      out[key] =
        typeof value === "function" && !/^[A-Z]/.test(key)
          ? (...args: unknown[]) => {
              calls.push(`${name}.${key}`);
              return (value as (...a: unknown[]) => unknown)(...args);
            }
          : value;
    }
    return out;
  };
  return { calls, wrap };
});

const tenantSpy = vi.hoisted(() =>
  vi.fn(async () => ({
    organizationId: 7,
    membership: {
      id: 1,
      organizationId: 7,
      userId: 42,
      role: "owner",
      invitedBy: null,
      ativo: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  })),
);

vi.mock("../../services/tenantService", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  resolveTenantForUser: tenantSpy,
}));
vi.mock("../../domain/itemTR", async (orig) => trip.wrap("itemTR", await orig()));
vi.mock("../../domain/itemReviewWorkflow", async (orig) => trip.wrap("itemReviewWorkflow", await orig()));
vi.mock("../../services/itemAnalyticsService", async (orig) => trip.wrap("itemAnalyticsService", await orig()));
vi.mock("../../services/trIntelligenceEngine", async (orig) => trip.wrap("trIntelligenceEngine", await orig()));
vi.mock("../../domain/collaboration", async (orig) => trip.wrap("collaboration", await orig()));
vi.mock("../../services/webhookService", async (orig) => trip.wrap("webhookService", await orig()));
vi.mock("../../domain/pilotOrganization", async (orig) => trip.wrap("pilotOrganization", await orig()));
vi.mock("../../services/pilotReadinessService", async (orig) => trip.wrap("pilotReadinessService", await orig()));
vi.mock("../../services/humanApprovalService", async (orig) => trip.wrap("humanApprovalService", await orig()));
vi.mock("../../domain/clauseIntelligence", async (orig) => trip.wrap("clauseIntelligence", await orig()));
vi.mock("../../services/officialExportEngine", async (orig) => trip.wrap("officialExportEngine", await orig()));
vi.mock("../../domain/trComposition", async (orig) => trip.wrap("trComposition", await orig()));
vi.mock("../../services/structuredExportService", async (orig) => trip.wrap("structuredExportService", await orig()));
vi.mock("../../services/operationalAuditService", async (orig) => trip.wrap("operationalAuditService", await orig()));

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Nome de montagem → [arquivo do router, export, nº de procedures, builder]. */
const GATED: Record<string, { file: string; exportName: string; procedures: number; builder: "protected" | "tenant" }> = {
  itemTr: { file: "itemTrRouter", exportName: "itemTrRouter", procedures: 9, builder: "protected" },
  reviewWorkspace: { file: "reviewWorkspaceRouter", exportName: "reviewWorkspaceRouter", procedures: 3, builder: "tenant" },
  trComposition: { file: "trCompositionRouter", exportName: "trCompositionRouter", procedures: 2, builder: "protected" },
  approvalWorkflow: { file: "approvalWorkflowRouter", exportName: "approvalWorkflowRouter", procedures: 6, builder: "tenant" },
  collaborationComments: { file: "collaborationCommentsRouter", exportName: "collaborationCommentsRouter", procedures: 4, builder: "protected" },
  exports: { file: "exportRouter", exportName: "exportRouter", procedures: 3, builder: "tenant" },
  structuredExports: { file: "structuredExportRouter", exportName: "structuredExportRouter", procedures: 3, builder: "tenant" },
  webhooks: { file: "webhookRouter", exportName: "webhookRouter", procedures: 4, builder: "protected" },
  clauses: { file: "clauseRouter", exportName: "clauseRouter", procedures: 3, builder: "protected" },
  pilotReadiness: { file: "pilotReadinessRouter", exportName: "pilotReadinessRouter", procedures: 5, builder: "protected" },
  productionReadiness: { file: "productionReadinessRouter", exportName: "productionReadinessRouter", procedures: 3, builder: "protected" },
  itemAnalytics: { file: "itemAnalyticsRouter", exportName: "itemAnalyticsRouter", procedures: 1, builder: "tenant" },
};
const MOUNT_NAMES = Object.keys(GATED);

type AnyRouter = {
  _def: { procedures: Record<string, unknown> };
  createCaller: (ctx: unknown) => Record<string, (input?: unknown) => Promise<unknown>>;
};

const ENV_KEYS = ["APP_ENV", "EXPERIMENTAL_IN_MEMORY_APIS_ENABLED", "JWT_SECRET", "ADMIN_PASSWORD"] as const;
const ORIGINAL_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = ORIGINAL_ENV[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

/** Recarrega config + gate + os 12 routers sob o ambiente dado (a capability é avaliada no load). */
async function loadUnder(appEnv: "development" | "staging" | "production", optIn: string | undefined) {
  process.env.APP_ENV = appEnv;
  if (optIn === undefined) delete process.env.EXPERIMENTAL_IN_MEMORY_APIS_ENABLED;
  else process.env.EXPERIMENTAL_IN_MEMORY_APIS_ENABLED = optIn;
  process.env.JWT_SECRET = process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32 ? process.env.JWT_SECRET : "x".repeat(40);
  process.env.ADMIN_PASSWORD = "admin-super-secret-123";
  vi.resetModules();
  const config = await import("../../config/experimentalApis");
  const guard = await import("../../services/legacyEndpointGuard");
  const routers: Record<string, AnyRouter> = {};
  for (const [mount, meta] of Object.entries(GATED)) {
    const mod = (await import(`../../routers/${meta.file}.ts`)) as Record<string, AnyRouter>;
    routers[mount] = mod[meta.exportName];
  }
  return { config, token: guard.LEGACY_ENDPOINT_DISABLED, routers };
}

function ctxFor(user: { id: number; role: string } | null) {
  return {
    user: user ? { ...user, name: "Tester", email: "t@example.gov.br" } : null,
    organizationId: null,
    orgMembership: null,
    correlationId: "leg028-corr",
    requestId: "leg028-req",
    req: { headers: {}, ip: "203.0.113.28" },
    res: { setHeader: () => undefined },
  };
}

const PROBE_INPUTS: unknown[] = [undefined, {}, { organizationId: 1, processId: 1, entityId: "x", workflowId: "w" }];

async function expectAllRefused(
  routers: Record<string, AnyRouter>,
  token: string,
  user: { id: number; role: string } | null,
) {
  let refused = 0;
  for (const mount of MOUNT_NAMES) {
    const r = routers[mount];
    const caller = r.createCaller(ctxFor(user));
    for (const proc of Object.keys(r._def.procedures)) {
      for (const input of PROBE_INPUTS) {
        const err = await caller[proc](input).then(
          () => null,
          (e: unknown) => e as { code?: string; message?: string },
        );
        expect(err, `${mount}.${proc} deveria recusar`).not.toBeNull();
        expect(err?.code, `${mount}.${proc}`).toBe("FORBIDDEN");
        expect(err?.message, `${mount}.${proc}`).toContain(token);
        refused++;
      }
    }
  }
  return refused;
}

const TOTAL_PROCEDURES = Object.values(GATED).reduce((n, m) => n + m.procedures, 0);

// ─── 1. Capability pura ──────────────────────────────────────────────────────
describe("LEG-028 — capability (server/config/experimentalApis.ts)", () => {
  it("opt-in só com 'true' explícito (case-insensitive); default false", async () => {
    const { resolveExperimentalInMemoryApisOptIn: r } = await import("../../config/experimentalApis");
    expect(r({})).toBe(false);
    expect(r({ EXPERIMENTAL_IN_MEMORY_APIS_ENABLED: "" })).toBe(false);
    expect(r({ EXPERIMENTAL_IN_MEMORY_APIS_ENABLED: "1" })).toBe(false);
    expect(r({ EXPERIMENTAL_IN_MEMORY_APIS_ENABLED: "yes" })).toBe(false);
    expect(r({ EXPERIMENTAL_IN_MEMORY_APIS_ENABLED: "false" })).toBe(false);
    expect(r({ EXPERIMENTAL_IN_MEMORY_APIS_ENABLED: "true" })).toBe(true);
    expect(r({ EXPERIMENTAL_IN_MEMORY_APIS_ENABLED: " TRUE " })).toBe(true);
  });

  it("matriz ambiente × opt-in: só development + opt-in libera", async () => {
    const { experimentalInMemoryApisAllowed: allowed } = await import("../../config/experimentalApis");
    expect(allowed({ appEnv: "production", optIn: true })).toBe(false);
    expect(allowed({ appEnv: "production", optIn: false })).toBe(false);
    expect(allowed({ appEnv: "staging", optIn: true })).toBe(false);
    expect(allowed({ appEnv: "staging", optIn: false })).toBe(false);
    expect(allowed({ appEnv: "development", optIn: false })).toBe(false);
    expect(allowed({ appEnv: "development", optIn: true })).toBe(true);
  });

  it("a suíte roda fechada por padrão (APP_ENV=development, sem opt-in)", async () => {
    const { EXPERIMENTAL_API_CONFIG } = await import("../../config/experimentalApis");
    expect(EXPERIMENTAL_API_CONFIG.allowed).toBe(false);
    expect(Object.isFrozen(EXPERIMENTAL_API_CONFIG)).toBe(true);
  });
});

// ─── 2. Recusa determinística (capability desligada) ────────────────────────
describe("LEG-028 — capability desligada ⇒ toda procedure recusa antes de qualquer lógica", () => {
  const cases: Array<[string, "development" | "staging" | "production", string | undefined]> = [
    ["production", "production", undefined],
    ["production COM opt-in (flag não liga em produção)", "production", "true"],
    ["staging COM opt-in", "staging", "true"],
    ["development sem opt-in", "development", undefined],
    ["development com opt-in inválido ('1')", "development", "1"],
  ];

  for (const [label, appEnv, optIn] of cases) {
    it(`${label}: ${TOTAL_PROCEDURES} procedures × ${PROBE_INPUTS.length} inputs ⇒ FORBIDDEN + LEGACY_ENDPOINT_DISABLED; tripwire e tenant intocados`, async () => {
      const { config, token, routers } = await loadUnder(appEnv, optIn);
      expect(config.EXPERIMENTAL_API_CONFIG.allowed).toBe(false);
      trip.calls.length = 0;
      tenantSpy.mockClear();

      const refused = await expectAllRefused(routers, token, { id: 42, role: "user" });
      expect(refused).toBe(TOTAL_PROCEDURES * PROBE_INPUTS.length);
      // Nenhum serviço/domínio que lê ou escreve o estado em memória foi tocado …
      expect(trip.calls).toEqual([]);
      // … e nenhuma resolução de tenant (banco) aconteceu para approvalWorkflow (tenantProcedure).
      expect(tenantSpy).not.toHaveBeenCalled();
    }, 120_000);
  }

  it("production: gate roda antes da autenticação (anônimo ⇒ FORBIDDEN, não UNAUTHORIZED) e do admin cross-tenant", async () => {
    const { token, routers } = await loadUnder("production", undefined);
    trip.calls.length = 0;
    tenantSpy.mockClear();
    await expectAllRefused(routers, token, null);
    // admin de plataforma sem X-Organization-Id receberia BAD_REQUEST do resolveTenant — o gate vem antes.
    await expectAllRefused(routers, token, { id: 1, role: "admin" });
    expect(trip.calls).toEqual([]);
    expect(tenantSpy).not.toHaveBeenCalled();
  }, 120_000);

  it("via appRouter montado (config padrão da suíte): as 46 procedures qualificadas recusam", async () => {
    vi.resetModules();
    const { appRouter } = await import("../../routers");
    const { LEGACY_ENDPOINT_DISABLED } = await import("../../services/legacyEndpointGuard");
    const all = Object.keys((appRouter as unknown as AnyRouter)._def.procedures);
    const gatedKeys = all.filter((k) => MOUNT_NAMES.includes(k.split(".")[0]));
    expect(gatedKeys).toHaveLength(TOTAL_PROCEDURES);
    trip.calls.length = 0;
    tenantSpy.mockClear();
    const caller = appRouter.createCaller(ctxFor({ id: 42, role: "user" }) as unknown as Parameters<typeof appRouter.createCaller>[0]);
    for (const key of gatedKeys) {
      const [mount, proc] = key.split(".");
      const fn = (caller as unknown as Record<string, Record<string, (i?: unknown) => Promise<unknown>>>)[mount][proc];
      await expect(fn({}), key).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining(LEGACY_ENDPOINT_DISABLED),
      });
    }
    expect(trip.calls).toEqual([]);
    expect(tenantSpy).not.toHaveBeenCalled();
  }, 180_000);

  it("organizationId vindo do input não muda nada (sem vazamento/escrita cross-tenant)", async () => {
    const { token, routers } = await loadUnder("production", "true");
    trip.calls.length = 0;
    const webhooks = routers.webhooks.createCaller(ctxFor({ id: 42, role: "user" }));
    await expect(
      webhooks.registerEndpoint({ organizationId: 999, url: "https://example.org/hook", events: ["tr.approved"], secret: "12345678" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(token) });
    const approvals = routers.approvalWorkflow.createCaller(ctxFor({ id: 42, role: "user" }));
    await expect(
      approvals.approveExecution({ workflowId: "wf-other-org", approver: "x", justification: "y" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(token) });
    expect(trip.calls).toEqual([]);
  }, 120_000);
});

// ─── 3. Opt-in explícito em development ⇒ comportamento existente ────────────
describe("LEG-028 — development + opt-in explícito ⇒ comportamento existente preservado", () => {
  it("nenhuma procedure recusa com LEGACY_ENDPOINT_DISABLED (erros restantes são os de validação/negócio de sempre)", async () => {
    const { config, token, routers } = await loadUnder("development", "true");
    expect(config.EXPERIMENTAL_API_CONFIG.allowed).toBe(true);
    for (const mount of MOUNT_NAMES) {
      const r = routers[mount];
      const caller = r.createCaller(ctxFor({ id: 42, role: "user" }));
      for (const proc of Object.keys(r._def.procedures)) {
        const err = await caller[proc](undefined).then(
          () => null,
          (e: unknown) => e as { message?: string },
        );
        if (err) expect(err.message ?? "", `${mount}.${proc}`).not.toContain(token);
      }
    }
  }, 120_000);

  it("webhooks: registerEndpoint → getStats funciona em memória (tripwire registra — controle positivo)", async () => {
    const { routers } = await loadUnder("development", "true");
    trip.calls.length = 0;
    const caller = routers.webhooks.createCaller(ctxFor({ id: 42, role: "user" }));
    const ep = (await caller.registerEndpoint({
      organizationId: 5,
      url: "https://example.org/hook",
      events: ["tr.approved"],
      secret: "12345678",
    })) as { id: string; organizationId: number };
    expect(ep.organizationId).toBe(5);
    const stats = await caller.getStats({ organizationId: 5 });
    expect(stats).toBeDefined();
    expect(trip.calls).toContain("webhookService.createEndpoint");
  }, 120_000);

  it("collaborationComments: createComment → getThreads devolve o thread criado", async () => {
    const { routers } = await loadUnder("development", "true");
    const caller = routers.collaborationComments.createCaller(ctxFor({ id: 42, role: "user" }));
    await caller.createComment({
      entityId: "item-1",
      entityType: "item_tr",
      organizationId: 5,
      content: "Comentário de teste",
      actorUserId: 42,
    });
    const threads = (await caller.getThreads({ entityId: "item-1", entityType: "item_tr", organizationId: 5 })) as unknown[];
    expect(threads.length).toBe(1);
    expect(trip.calls.some((c) => c.startsWith("collaboration."))).toBe(true);
  }, 120_000);

  it("approvalWorkflow (tenantProcedure): passa pelo gate, resolve tenant e cria aprovação em memória", async () => {
    const { routers } = await loadUnder("development", "true");
    tenantSpy.mockClear();
    const caller = routers.approvalWorkflow.createCaller(ctxFor({ id: 42, role: "user" }));
    const created = (await caller.createApproval({
      sessionId: "s-1",
      approvalType: "execution",
      requiredApprovers: ["a@example.gov.br"],
    })) as { workflow: { organizationId: number } };
    expect(created.workflow.organizationId).toBe(7);
    expect(tenantSpy).toHaveBeenCalled();
    expect(trip.calls).toContain("humanApprovalService.createApprovalRequest");
  }, 120_000);

  it("itemAnalytics (mock) e productionReadiness respondem normalmente", async () => {
    const { routers } = await loadUnder("development", "true");
    const ctx = ctxFor({ id: 42, role: "user" });
    // SEM-073 — a organização vem do CONTEXTO (tenantSpy ⇒ 7): `organizationId` do input é só compatibilidade e, se divergir, é recusado.
    await expect(routers.itemAnalytics.createCaller(ctx).getDashboard({ organizationId: 7 })).resolves.toBeDefined();
    await expect(routers.itemAnalytics.createCaller(ctx).getDashboard({})).resolves.toBeDefined();
    await expect(routers.itemAnalytics.createCaller(ctx).getDashboard({ organizationId: 5 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(routers.productionReadiness.createCaller(ctx).getSystemHealth({ organizationId: 5 })).resolves.toBeDefined();
  }, 120_000);
});

// ─── 4. Freeze estrutural ────────────────────────────────────────────────────
describe("LEG-028 — freeze dos routers gated", () => {
  it("LEG028_GATED_ROUTERS é exatamente a lista decidida (12 routers)", async () => {
    const { LEG028_GATED_ROUTERS, LEG028_SURFACE_ID } = await import("../../services/experimentalApiGate");
    expect([...LEG028_GATED_ROUTERS]).toEqual(MOUNT_NAMES);
    expect(LEG028_GATED_ROUTERS).toHaveLength(12);
    expect(LEG028_SURFACE_ID).toBe("LEG-028");
  });

  it("cada router continua montado em server/routers.ts com o mesmo nome", () => {
    const ROUTERS = read("server/routers.ts");
    for (const [mount, meta] of Object.entries(GATED)) {
      expect(ROUTERS, mount).toMatch(new RegExp(`\\b${mount}:\\s*${meta.exportName}\\b`));
      expect(ROUTERS, mount).toContain(`from "./routers/${meta.file}"`);
    }
  });

  it("cada arquivo usa SÓ o builder gated (nenhum protected/tenant/public/admin Procedure cru) e a contagem não mudou", () => {
    for (const [mount, meta] of Object.entries(GATED)) {
      const src = read(`server/routers/${meta.file}.ts`);
      const gated = meta.builder === "tenant" ? "experimentalTenantProcedure" : "experimentalProtectedProcedure";
      expect(src, mount).toContain(`import { ${gated} } from "../services/experimentalApiGate";`);
      expect(src, mount).not.toMatch(/\b(protectedProcedure|tenantProcedure|publicProcedure|adminProcedure|orgRoleProcedure)\b/);
      const count = (src.match(new RegExp(`^\\s+\\w+: ${gated}$`, "gm")) ?? []).length;
      expect(count, mount).toBe(meta.procedures);
    }
  });

  it("os routers gated continuam sem acesso a banco (estado só em memória/mock)", () => {
    for (const [mount, meta] of Object.entries(GATED)) {
      const src = read(`server/routers/${meta.file}.ts`);
      expect(src, mount).not.toMatch(/from "\.\.\/db|getDb\(|drizzle/);
    }
  });

  it("o gate vem ANTES de protectedProcedure/tenantProcedure e lê a capability de server/config", () => {
    const GATE = read("server/services/experimentalApiGate.ts");
    expect(GATE).toContain("publicProcedure.use(experimentalApiGate).concat(protectedProcedure)");
    expect(GATE).toContain("publicProcedure.use(experimentalApiGate).concat(tenantProcedure)");
    expect(GATE).toContain('from "../config/experimentalApis"');
    expect(GATE).not.toContain("process.env");
  });
});

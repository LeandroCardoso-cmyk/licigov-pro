/**
 * RC-SEC-PR-A — Congelamento arquitetural do Bloco A (Segurança e Isolamento).
 *
 * Impede regressão dos controles introduzidos na PR A: se um router institucional
 * voltar a `protectedProcedure`/`publicProcedure`, se uma consulta global por ID
 * reaparecer, se o fallback org=1 ou a senha default forem reintroduzidos, ou se
 * `.env` voltar a ser rastreado, o CI falha.
 *
 * Estratégia: leitura de fonte + verificações estruturais (não contagem frágil de
 * linha), no mesmo espírito de rc-c01a1-contracts-legacy-freeze e
 * rc-legal-sec-001-legal-opinions-freeze.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import { execSync } from "child_process";

const read = (f: string) => fs.readFileSync(f, "utf-8");

// Routers institucionais que DEVEM usar tenantProcedure (nunca protectedProcedure
// para operar recursos de órgão).
const TENANT_ROUTERS = [
  "server/routers/processesRouter.ts",
  "server/routers/taskRouter.ts",
  "server/routers/departmentTasksRouter.ts",
  "server/routers/activitiesRouter.ts",
  "server/routers/commentsRouter.ts",
  "server/routers/documentsRouter.ts",
  "server/routers/aiAssistantRouter.ts",
  "server/routers/directContractsRouter.ts",
];

describe("RC-SEC-PR-A — Congelamento de isolamento e autorização (Bloco A)", () => {
  // ── 1. Routers institucionais não voltam a protectedProcedure ──────────────
  it("routers institucionais do núcleo não usam protectedProcedure", () => {
    const offenders = TENANT_ROUTERS.filter(f => /\bprotectedProcedure\b/.test(read(f)));
    expect(offenders, `voltaram a protectedProcedure: ${offenders.join(", ")}`).toEqual([]);
  });

  it("routers institucionais do núcleo usam tenantProcedure", () => {
    const missing = TENANT_ROUTERS.filter(f => !/\btenantProcedure\b/.test(read(f)));
    expect(missing, `sem tenantProcedure: ${missing.join(", ")}`).toEqual([]);
  });

  // ── 2. deployment / stability não são públicos ─────────────────────────────
  it("deploymentRouter e stabilityRouter não usam publicProcedure", () => {
    for (const f of ["server/routers/deploymentRouter.ts", "server/routers/stabilityRouter.ts"]) {
      const src = read(f);
      expect(src, `${f} não pode usar publicProcedure`).not.toMatch(/\bpublicProcedure\b/);
      expect(src, `${f} deve usar adminProcedure`).toMatch(/\badminProcedure\b/);
    }
  });

  // ── 3. catmat não volta a ser público ──────────────────────────────────────
  it("catmatRouter usa tenantProcedure com rate limit, não publicProcedure", () => {
    const src = read("server/routers/catmatRouter.ts");
    expect(src).not.toMatch(/\bpublicProcedure\b/);
    expect(src).toContain("tenantProcedure");
    expect(src).toContain("rateLimitMiddleware");
  });

  // ── 4. onboarding não permite autoelevação ─────────────────────────────────
  it("onboarding.grantDepartmentPermission exige papel admin e não deriva org/ator do input", () => {
    const src = read("server/routers/onboardingRouter.ts");
    // grantDepartmentPermission deve estar sob orgRoleProcedure('admin').
    expect(src).toMatch(/grantDepartmentPermission:\s*orgRoleProcedure\("admin"\)/);
    // organizationId e grantedBy NÃO podem vir do input Zod desta procedure.
    const block = src.slice(src.indexOf("grantDepartmentPermission:"));
    const grantInput = block.slice(0, block.indexOf(".mutation"));
    expect(grantInput, "organizationId não pode ser input de grant").not.toMatch(/organizationId:\s*z\./);
    expect(grantInput, "grantedBy não pode ser input de grant").not.toMatch(/grantedBy:\s*z\./);
    // Escopo global exige admin de plataforma.
    expect(src).toMatch(/scope === "global"/);
  });

  // ── 5. Consultas globais por ID não reaparecem nos routers corrigidos ──────
  it("processesRouter não usa getProcessById global (só *ForOrganization)", () => {
    const src = read("server/routers/processesRouter.ts");
    expect(src).not.toMatch(/db\.getProcessById\(/);
    expect(src).toContain("getProcessByIdForOrganization");
  });

  it("documentsRouter não usa getDocumentById/getProcessById globais", () => {
    const src = read("server/routers/documentsRouter.ts");
    expect(src).not.toMatch(/db\.getDocumentById\(/);
    expect(src).not.toMatch(/db\.getProcessById\(/);
    expect(src).toContain("getDocumentByIdForOrganization");
  });

  it("aiAssistantRouter não carrega processo global (usa *ForOrganization)", () => {
    const src = read("server/routers/aiAssistantRouter.ts");
    expect(src).not.toMatch(/db\.getProcessById\(/);
    expect(src).toContain("getProcessByIdForOrganization");
  });

  it("taskRouter/departmentTasksRouter não usam listTasks/getAllTasks globais", () => {
    for (const f of ["server/routers/taskRouter.ts", "server/routers/departmentTasksRouter.ts"]) {
      const src = read(f);
      expect(src, `${f} não pode chamar listTasks global`).not.toMatch(/db\.listTasks\(/);
      expect(src, `${f} não pode chamar getAllTasks global`).not.toMatch(/db\.getAllTasks\(/);
    }
  });

  it("directContractsRouter: analytics e leituras usam variantes *ForOrganization", () => {
    const src = read("server/routers/directContractsRouter.ts");
    expect(src).not.toMatch(/\bgetDirectContractById\b(?!ForOrganization)/);
    expect(src).toContain("getDirectContractsOverviewForOrganization");
    expect(src).toContain("listDirectContractsForOrganization");
  });

  // ── 6. Sem fallback org=1 no tenantService ─────────────────────────────────
  it("tenantService não associa usuário sem membership à organização 1", () => {
    const src = read("server/services/tenantService.ts");
    expect(src).not.toMatch(/organizationId:\s*1/);
    expect(src).not.toMatch(/buildDefaultMembership/);
    expect(src).toContain("NO_ORGANIZATION_MEMBERSHIP");
  });

  // ── 7. Registro fail-closed e sem membership automático ────────────────────
  it("authRouter fecha registro público por flag e usa TTL de sessão configurável", () => {
    const src = read("server/routers/authRouter.ts");
    expect(src).toContain("ALLOW_PUBLIC_REGISTRATION");
    expect(src).toContain("SESSION_TTL_MS");
    expect(src, "não pode usar expiração de 1 ano no cookie").not.toMatch(/ONE_YEAR_MS/);
  });

  // ── 8. Bootstrap não reintroduz senha default de produção ──────────────────
  it("bootstrap não contém a senha default Admin@123", () => {
    const src = read("server/bootstrap.ts");
    expect(src).not.toContain("Admin@123");
  });

  it("config/auth exige ADMIN_PASSWORD em produção e TTL seguro", () => {
    const src = read("server/config/auth.ts");
    expect(src).toContain("ADMIN_PASSWORD");
    expect(src).toContain("SESSION_TTL_HOURS");
    expect(src).not.toContain("Admin@123");
  });

  // ── 9. Cookie same-origin e rate limit sem confiança cega em header ─────────
  it("cookie usa sameSite lax (não none)", () => {
    const src = read("server/_core/cookies.ts");
    expect(src).toMatch(/sameSite:\s*"lax"/);
    expect(src).not.toMatch(/sameSite:\s*"none"/);
  });

  it("rate limiter não usa x-forwarded-for cru como identificador primário", () => {
    const src = read("server/services/rateLimiter.ts");
    expect(src).toContain("resolveRateLimitIdentifier");
    // O identificador é resolvido por função dedicada; o header cru não pode ser
    // a fonte primária no middleware.
    const mwStart = src.indexOf("rateLimitMiddleware");
    const mw = src.slice(mwStart, mwStart + 500);
    expect(mw).not.toMatch(/x-forwarded-for/);
  });

  // ── 10. .env não é mais rastreado pelo Git ─────────────────────────────────
  it(".env não é um arquivo rastreado pelo Git", () => {
    const tracked = execSync("git ls-files .env", { cwd: process.cwd() }).toString().trim();
    expect(tracked, ".env não pode estar no índice do Git").toBe("");
  });
});

/**
 * V1 PRE-PILOT CLOSURE — PR 0 (Security Emergency Closure) — guardas arquiteturais
 * de regressão (varredura de fonte, sem DB — coerente com o padrão do projeto, ver
 * `ingestion-canonical-guard.test.ts`). Comprovam estruturalmente que:
 *
 *  1. `commercial.generateDocuments` foi removido da superfície pública (ZIP com
 *     documentos empresariais autorizado só por `proposalId` sequencial);
 *  2. `commercial.create` permanece público, mas com CNPJ real, rate limit e sem
 *     transição de status fabricada;
 *  3. o frontend não chama mais o router inexistente `proposals.*`;
 *  4. `collaboration.listMembers`/`checkPermission` resolvem o processo dentro do
 *     tenant do chamador;
 *  5. `templates.getById` respeita a mesma regra de propriedade de `update`/`delete`;
 *  6. o bootstrap de admin de plataforma não roda mais no boot normal do servidor;
 *  7. o admin de plataforma não cai mais em organização 1 por default.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

/** Remove linhas de comentário (// ou * de bloco) — as asserções negativas checam
 *  CÓDIGO, não prosa explicativa que legitimamente cite o padrão antigo por contraste. */
const stripComments = (src: string) =>
  src
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return !(trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/**"));
    })
    .join("\n");

const COMMERCIAL_ROUTER = read("server/routers/commercialRouter.ts");
const SOLICITAR_PROPOSTA = read("client/src/pages/SolicitarProposta.tsx");
const COLLABORATION_ROUTER = read("server/routers/collaborationRouter.ts");
const TEMPLATES_ROUTER = read("server/routers/templatesRouter.ts");
const BOOTSTRAP = read("server/bootstrap.ts");
const BOOTSTRAP_ADMIN_CLI = read("scripts/bootstrap-admin.ts");
const TRPC_CORE = read("server/_core/trpc.ts");
const RATE_LIMITER = read("server/services/rateLimiter.ts");

describe("PR 0 — commercial: ZIP de documentos empresariais removido da superfície pública", () => {
  it("generateDocuments não existe mais no router", () => {
    expect(COMMERCIAL_ROUTER).not.toMatch(/generateDocuments\s*:/);
    expect(COMMERCIAL_ROUTER).not.toContain("generateProposalZip");
  });

  it("create permanece publicProcedure (captação comercial pública legítima)", () => {
    const createBlock = COMMERCIAL_ROUTER.slice(
      COMMERCIAL_ROUTER.indexOf("create:"),
      COMMERCIAL_ROUTER.indexOf("list:")
    );
    expect(createBlock).toContain("publicProcedure");
    expect(createBlock).not.toContain("tenantProcedure");
  });

  it("create é protegido por rate limit dedicado", () => {
    expect(COMMERCIAL_ROUTER).toContain('rateLimitMiddleware("commercial")');
    expect(RATE_LIMITER).toMatch(/commercial\s*:\s*{/);
  });

  it("create valida CNPJ com dígitos verificadores (não só min/max)", () => {
    expect(COMMERCIAL_ROUTER).toContain("validateCNPJ");
  });

  it("create tem honeypot anti-bot", () => {
    expect(COMMERCIAL_ROUTER).toContain("website");
  });

  it("create NÃO fabrica mais a transição para documents_sent", () => {
    expect(COMMERCIAL_ROUTER).not.toMatch(/updateProposalRequestStatus\(proposalId,\s*"documents_sent"\)/);
  });
});

describe("PR 0 — frontend: sem call morto ao router inexistente 'proposals'", () => {
  it("não referencia proposals.* nem cast (trpc as any)", () => {
    expect(SOLICITAR_PROPOSTA).not.toContain("proposals.create");
    expect(SOLICITAR_PROPOSTA).not.toContain("proposals.generateDocuments");
    expect(SOLICITAR_PROPOSTA).not.toContain("trpc as any");
  });

  it("usa o router real (commercial.create)", () => {
    expect(SOLICITAR_PROPOSTA).toContain("trpc.commercial.create.useMutation");
  });

  it("não tenta mais baixar um ZIP inexistente", () => {
    expect(SOLICITAR_PROPOSTA).not.toContain("handleDownloadDocuments");
    expect(SOLICITAR_PROPOSTA).not.toContain("generateDocumentsMutation");
  });
});

describe("PR 0 — collaboration: listMembers/checkPermission tenant-scoped", () => {
  it("listMembers usa tenantProcedure e delega ao boundary compartilhado authorizeProcessAccess", () => {
    const listMembersBlock = COLLABORATION_ROUTER.slice(
      COLLABORATION_ROUTER.indexOf("listMembers:"),
      COLLABORATION_ROUTER.indexOf("checkPermission:")
    );
    expect(listMembersBlock).toContain("tenantProcedure");
    expect(listMembersBlock).toContain("authorizeProcessAccess");

    const checkPermissionBlock = COLLABORATION_ROUTER.slice(
      COLLABORATION_ROUTER.indexOf("checkPermission:"),
      COLLABORATION_ROUTER.indexOf("updateFunctionalRole:")
    );
    expect(checkPermissionBlock).toContain("tenantProcedure");
    expect(checkPermissionBlock).toContain("getProcessByIdForOrganization");
    expect(checkPermissionBlock).toMatch(/ctx\.organizationId/);
  });

  it("authorizeProcessAccess (usado por listMembers) exige autorização (owner/membro/admin) antes de retornar dados", () => {
    const helperBlock = COLLABORATION_ROUTER.slice(
      COLLABORATION_ROUTER.indexOf("async function authorizeProcessAccess"),
      COLLABORATION_ROUTER.indexOf("export const collaborationRouter")
    );
    expect(helperBlock).toContain("getProcessByIdForOrganization");
    expect(helperBlock).toContain("NOT_FOUND");
    expect(helperBlock).toMatch(/isOwner/);
  });
});

describe("PR 0 — templates.getById: mesma regra de propriedade de update/delete", () => {
  it("getById checa template.userId === ctx.user.id", () => {
    const getByIdBlock = TEMPLATES_ROUTER.slice(
      TEMPLATES_ROUTER.indexOf("getById:"),
      TEMPLATES_ROUTER.indexOf("getDefault:")
    );
    expect(getByIdBlock).toMatch(/template\.userId\s*!==\s*ctx\.user\.id/);
    expect(getByIdBlock).toContain("NOT_FOUND");
  });
});

describe("PR 0 — bootstrap de admin de plataforma: explícito, não roda no boot normal", () => {
  it("bootstrap.ts não cria/promove admin nem seta membership automática", () => {
    const code = stripComments(BOOTSTRAP);
    expect(code).not.toContain("seedAdmin");
    expect(code).not.toContain("seedDefaultOrgMembership");
    expect(code).not.toContain("cardosomsales@gmail.com");
    expect(code).not.toMatch(/ADMIN_EMAIL/);
  });

  it("comando explícito exige confirmação + credenciais, sem defaults inseguros", () => {
    expect(BOOTSTRAP_ADMIN_CLI).toContain("ADMIN_BOOTSTRAP_CONFIRM");
    expect(BOOTSTRAP_ADMIN_CLI).toContain("ADMIN_BOOTSTRAP_EMAIL");
    expect(BOOTSTRAP_ADMIN_CLI).toContain("ADMIN_BOOTSTRAP_PASSWORD");
    expect(BOOTSTRAP_ADMIN_CLI).not.toContain("cardosomsales@gmail.com");
    expect(BOOTSTRAP_ADMIN_CLI).not.toContain('?? "');
  });

  it("comando não associa o admin a nenhuma organização (org 1 ou outra)", () => {
    expect(BOOTSTRAP_ADMIN_CLI).not.toContain("organizationMembers");
    expect(BOOTSTRAP_ADMIN_CLI).not.toMatch(/organizationId:\s*1\b/);
  });

  it("comando só executa diretamente (import não dispara main())", () => {
    expect(BOOTSTRAP_ADMIN_CLI).toMatch(/isDirectExecution/);
    expect(BOOTSTRAP_ADMIN_CLI).toMatch(/export (async )?function main/);
  });

  it("package.json expõe o comando", () => {
    const pkg = read("package.json");
    expect(pkg).toContain('"admin:bootstrap"');
  });
});

describe("PR 0 — platform admin: sem default de organização 1", () => {
  it("trpc.ts não tem mais o fallback 'parseInt(...) : 1'", () => {
    expect(stripComments(TRPC_CORE)).not.toMatch(/orgIdHeader\s*\?\s*parseInt\([^)]*\)\s*:\s*1/);
  });

  it("valida o header com parser estrito e organização real", () => {
    expect(TRPC_CORE).toContain("parsePlatformAdminOrganizationId");
    expect(TRPC_CORE).toContain("getOrganizationById");
    expect(TRPC_CORE).toMatch(/Number\.isInteger/);
  });

  it("audita o acesso cross-tenant do admin de plataforma", () => {
    expect(TRPC_CORE).toContain("platform_admin_tenant_access");
    expect(TRPC_CORE).toContain("createAuditLog");
    expect(TRPC_CORE).toContain("ctx.correlationId");
  });
});

// ── Correções finais (rodada 2) ────────────────────────────────────────────────

describe("PR 0 (correção final) — collaboration.getStageAssignments tenant-scoped", () => {
  it("usa tenantProcedure e o mesmo boundary de autorização de listMembers", () => {
    const block = COLLABORATION_ROUTER.slice(
      COLLABORATION_ROUTER.indexOf("getStageAssignments:"),
      COLLABORATION_ROUTER.length
    );
    expect(block).toContain("tenantProcedure");
    expect(block).toContain("authorizeProcessAccess");
  });

  it("authorizeProcessAccess resolve o processo pelo tenant e exige owner/membro/admin de plataforma", () => {
    const helperBlock = COLLABORATION_ROUTER.slice(
      COLLABORATION_ROUTER.indexOf("async function authorizeProcessAccess"),
      COLLABORATION_ROUTER.indexOf("export const collaborationRouter")
    );
    expect(helperBlock).toContain("getProcessByIdForOrganization");
    expect(helperBlock).toContain("NOT_FOUND");
    expect(helperBlock).toMatch(/isOwner/);
    expect(helperBlock).toMatch(/isPlatformAdmin/);
  });

  it("não seleciona mais e-mail do responsável (assignedUserEmail) — consumidor só usa o nome", () => {
    const COLLABORATION_DB = read("server/db/collaboration.ts");
    const stageAssignmentsStart = COLLABORATION_DB.indexOf("export async function getStageAssignments");
    const stageAssignmentsBlock = COLLABORATION_DB.slice(
      stageAssignmentsStart,
      COLLABORATION_DB.indexOf("export async function getProcessMember(processId: number, userId: number)", stageAssignmentsStart)
    );
    expect(stripComments(stageAssignmentsBlock)).not.toContain("assignedUserEmail");
    expect(stageAssignmentsBlock).toContain("assignedUserName");

    const PANEL = read("client/src/components/document-flow/StageAssignmentPanel.tsx");
    expect(PANEL).not.toContain("assignedUserEmail");
  });
});

describe("PR 0 (correção final) — auditoria privilegiada fail-closed", () => {
  it("resolveTenant não engole mais a falha de auditoria com console.warn + continuar", () => {
    const adminBlockStart = TRPC_CORE.indexOf("if (ctx.user.role === 'admin')");
    const block = TRPC_CORE.slice(
      adminBlockStart,
      TRPC_CORE.indexOf("return next({", adminBlockStart)
    );
    expect(block).not.toContain("console.warn");
    // A falha de auditoria precisa propagar como erro (nunca só logar e seguir).
    expect(block).toMatch(/catch \(auditError\) \{\s*throw/);
  });

  it("bootstrap-admin.ts grava a criação/promoção e o audit_log na MESMA transação", () => {
    expect(BOOTSTRAP_ADMIN_CLI).toContain("db.transaction");
    expect(BOOTSTRAP_ADMIN_CLI).toMatch(/tx\.insert\(auditLogs\)/);
    expect(BOOTSTRAP_ADMIN_CLI).toMatch(/tx\.insert\(users\)|tx\.update\(users\)/);
  });

  it("bootstrap-admin.ts não repete o e-mail no details do audit (targetUserId já identifica o alvo)", () => {
    const auditCallBlock = BOOTSTRAP_ADMIN_CLI.slice(
      BOOTSTRAP_ADMIN_CLI.indexOf("tx.insert(auditLogs)"),
      BOOTSTRAP_ADMIN_CLI.indexOf("});", BOOTSTRAP_ADMIN_CLI.indexOf("tx.insert(auditLogs)"))
    );
    expect(auditCallBlock).not.toContain("email");
  });
});

describe("PR 0 (correção final) — política de senha do bootstrap-admin.ts", () => {
  it("reutiliza validatePasswordStrength() em vez de checar só o comprimento", () => {
    expect(BOOTSTRAP_ADMIN_CLI).toContain("validatePasswordStrength");
    expect(stripComments(BOOTSTRAP_ADMIN_CLI)).not.toMatch(/password\.length\s*<\s*(MIN_PASSWORD_LENGTH|8)/);
  });
});

describe("PR 0 (2ª correção final) — bootstrap-admin.ts: promoção de conta existente exige confirmação explícita", () => {
  it("promoção de usuário existente não-admin exige ADMIN_BOOTSTRAP_ALLOW_PROMOTE=yes (fail-closed)", () => {
    expect(BOOTSTRAP_ADMIN_CLI).toContain("ADMIN_BOOTSTRAP_ALLOW_PROMOTE");
    expect(BOOTSTRAP_ADMIN_CLI).toContain("ConfigError");
  });

  it("promoção deliberada troca o passwordHash e revoga sessões via bumpTokenVersion — não só a role", () => {
    const promoteBlock = BOOTSTRAP_ADMIN_CLI.slice(
      BOOTSTRAP_ADMIN_CLI.indexOf("if (isExistingNonAdmin) {"),
      BOOTSTRAP_ADMIN_CLI.indexOf("} else {")
    );
    expect(promoteBlock).toContain("passwordHash");
    expect(promoteBlock).toContain("bumpTokenVersion");
    expect(promoteBlock).toMatch(/role:\s*"admin"/);
  });

  it("já-admin permanece idempotente: o caminho already_admin não entra na transação de escrita", () => {
    const alreadyAdminBlock = BOOTSTRAP_ADMIN_CLI.slice(
      BOOTSTRAP_ADMIN_CLI.indexOf('role === "admin") {'),
      BOOTSTRAP_ADMIN_CLI.indexOf("isExistingNonAdmin")
    );
    expect(alreadyAdminBlock).toContain("already_admin");
    expect(alreadyAdminBlock).not.toContain("db.transaction");
  });
});

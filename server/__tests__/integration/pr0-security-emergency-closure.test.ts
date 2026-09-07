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
  it("usam tenantProcedure e resolvem o processo dentro do tenant do chamador", () => {
    const listMembersBlock = COLLABORATION_ROUTER.slice(
      COLLABORATION_ROUTER.indexOf("listMembers:"),
      COLLABORATION_ROUTER.indexOf("checkPermission:")
    );
    expect(listMembersBlock).toContain("tenantProcedure");
    expect(listMembersBlock).toContain("getProcessByIdForOrganization");
    expect(listMembersBlock).toMatch(/ctx\.organizationId/);

    const checkPermissionBlock = COLLABORATION_ROUTER.slice(
      COLLABORATION_ROUTER.indexOf("checkPermission:"),
      COLLABORATION_ROUTER.indexOf("updateFunctionalRole:")
    );
    expect(checkPermissionBlock).toContain("tenantProcedure");
    expect(checkPermissionBlock).toContain("getProcessByIdForOrganization");
  });

  it("listMembers exige autorização (owner ou membro) antes de retornar a lista", () => {
    const listMembersBlock = COLLABORATION_ROUTER.slice(
      COLLABORATION_ROUTER.indexOf("listMembers:"),
      COLLABORATION_ROUTER.indexOf("checkPermission:")
    );
    expect(listMembersBlock).toContain("NOT_FOUND");
    expect(listMembersBlock).toMatch(/isOwner/);
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

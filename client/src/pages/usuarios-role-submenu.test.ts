/**
 * fix(users) — Guarda de fonte do submenu "Alterar papel" (padrão do projeto: varredura de fonte,
 * vitest env "node", sem jsdom). Prova o contrato de UI que corrige o "nada acontece":
 *   - owner NÃO usa um SubTrigger mudo desabilitado — mostra um item explicativo;
 *   - para membros não-owner o submenu abre com as roles atribuíveis (owner nunca é atribuível);
 *   - a role atual é marcada e não-clicável;
 *   - selecionar uma role chama a mutation canônica updateMemberRole({ userId, role });
 *   - a gestão de usuários permanece restrita a admin/owner (backend orgRoleProcedure("admin")).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = readFileSync(path.join(ROOT, "client/src/pages/Usuarios.tsx"), "utf8");
const ROUTER = readFileSync(path.join(ROOT, "server/routers/organizationsRouter.ts"), "utf8");

describe("Usuarios · submenu Alterar papel", () => {
  it("owner tem feedback explícito (não um SubTrigger mudo), sem expor 'owner'/'proprietário'", () => {
    expect(SRC).toMatch(/isOwner \?\s*\(\s*<DropdownMenuItem disabled/);
    expect(SRC).toContain("O papel deste administrador não pode ser alterado nesta tela");
    // Copy institucional: não expõe o termo técnico nem "Proprietário" (decisão de domínio).
    expect(SRC).not.toMatch(/proprietári/i);
  });

  it("membros não-owner têm submenu com SubTrigger + SubContent funcional", () => {
    expect(SRC).toContain("<DropdownMenuSub>");
    expect(SRC).toContain("<DropdownMenuSubTrigger");
    expect(SRC).toContain("<DropdownMenuSubContent>");
    // o SubTrigger não é mais desabilitado por isOwner (só durante a mutation em voo)
    expect(SRC).not.toMatch(/DropdownMenuSubTrigger disabled=\{isOwner/);
    expect(SRC).toMatch(/DropdownMenuSubTrigger disabled=\{updateRoleMutation\.isPending\}/);
  });

  it("só roles atribuíveis (sem owner) e a atual marcada/desabilitada", () => {
    expect(SRC).toMatch(/const ASSIGNABLE_ROLES: AssignableRole\[\] = \["admin", "manager", "operator", "viewer"\]/);
    expect(SRC).toMatch(/type AssignableRole = Exclude<OrgRole, "owner">/);
    expect(SRC).toMatch(/disabled=\{m\.role === role/);
    expect(SRC).toContain("atual");
  });

  it("selecionar role chama a mutation canônica updateMemberRole({ userId, role })", () => {
    expect(SRC).toContain("trpc.organizations.updateMemberRole.useMutation");
    expect(SRC).toMatch(/updateRoleMutation\.mutate\(\{ userId: m\.userId, role \}\)/);
  });

  it("backend protege: admin-only, owner intocável, último admin e auditoria", () => {
    expect(ROUTER).toMatch(/updateMemberRole: orgRoleProcedure\("admin"\)/);
    expect(ROUTER).toContain("O papel de owner não pode ser alterado por esta API.");
    expect(ROUTER).toContain("assertNotLastActiveAdmin");
    expect(ROUTER).toContain("org.member_role_updated");
    // role de entrada nunca inclui owner (não é possível promover a owner por esta API)
    expect(ROUTER).toMatch(/role: z\.enum\(\["admin", "manager", "operator", "viewer"\]\)/);
  });
});

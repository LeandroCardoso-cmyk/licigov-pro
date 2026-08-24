/**
 * C.3A-OPS.1 — Guardas estruturais (scan de código-fonte) da superfície de UI.
 *
 * O ambiente de teste é node (sem DOM/testing-library), então as invariantes de arquitetura da UI
 * são verificadas por inspeção do fonte — mesmo padrão dos guards de fronteira (rc352/rc401):
 *   - único writer = trpc.featureFlagAdmin.setTenantFlag; leitura = trpc.featureFlagAdmin.getTenantFlag;
 *   - nenhuma chamada direta a DB/service (sem import de server/*);
 *   - somente a flag FF_DIRECT_CONTRACT_SHADOW (sem input de nome de flag arbitrário);
 *   - RBAC no cliente (defesa em profundidade) + a página é admin-only;
 *   - sem persistência de estado da flag no browser (localStorage) e sem ENV/Railway.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, "../..");

const dialogSrc = readFileSync(resolve(CLIENT_SRC, "components/admin/FeatureFlagShadowDialog.tsx"), "utf8");
const pageSrc = readFileSync(resolve(CLIENT_SRC, "pages/AdminOrganizacoes.tsx"), "utf8");

/** Remove comentários (bloco e linha) para checar USO real no código, não a documentação. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
const dialogCode = stripComments(dialogSrc);

describe("C.3A-OPS.1 — writer/leitura únicos via tRPC governado", () => {
  it("usa getTenantFlag para leitura e setTenantFlag para escrita", () => {
    expect(dialogSrc).toContain("featureFlagAdmin.getTenantFlag.useQuery");
    expect(dialogSrc).toContain("featureFlagAdmin.setTenantFlag.useMutation");
  });
  it("setTenantFlag é o ÚNICO writer da UI (nenhum outro caminho de escrita de flag)", () => {
    const setWriters = dialogSrc.match(/featureFlagAdmin\.setTenantFlag/g) ?? [];
    // Aparições: import/useMutation + as duas chamadas .mutate — todas apontam para o mesmo writer.
    expect(setWriters.length).toBeGreaterThan(0);
    expect(dialogCode).not.toMatch(/tenant_feature_flags/); // sem SQL/tabela no cliente
    expect(dialogCode).not.toMatch(/db\.|getDb\(|drizzle/); // sem acesso a banco
  });
});

describe("C.3A-OPS.1 — sem chamada direta a DB/service", () => {
  it("o diálogo não importa nada do backend (server/*) nem serviço de flags", () => {
    expect(dialogCode).not.toMatch(/from\s+["'].*server\//);
    expect(dialogCode).not.toMatch(/featureFlagAdminService|featureFlagService/);
  });
});

describe("C.3A-OPS.1 — somente FF_DIRECT_CONTRACT_SHADOW", () => {
  it("usa a constante SHADOW_FLAG e não expõe input de nome de flag arbitrário", () => {
    expect(dialogSrc).toContain("SHADOW_FLAG");
    // Não há campo de texto para o usuário digitar um flagName.
    expect(dialogSrc).not.toMatch(/flagName:\s*[a-zA-Z]+State/); // sem flagName vindo de state livre
    expect(dialogSrc).not.toMatch(/setFlagName|flagNameInput/);
  });
  it("não referencia outras flags FF_* além da governável", () => {
    const otherFlags = (dialogCode.match(/FF_[A-Z_]+/g) ?? []).filter((f) => f !== "FF_DIRECT_CONTRACT_SHADOW");
    expect(otherFlags).toEqual([]);
  });
});

describe("C.3A-OPS.1 — RBAC (defesa em profundidade)", () => {
  it("o diálogo gate por user.role admin", () => {
    expect(dialogSrc).toMatch(/role\s*===\s*["']admin["']/);
  });
  it("a página de organizações é admin-only", () => {
    expect(pageSrc).toMatch(/role\s*!==\s*["']admin["']/);
    expect(pageSrc).toContain("FeatureFlagShadowDialog");
  });
});

describe("C.3A-OPS.1 — sem persistência no browser e sem ENV/Railway", () => {
  it("não usa localStorage/sessionStorage para o estado da flag", () => {
    expect(dialogCode).not.toMatch(/localStorage|sessionStorage/);
  });
  it("não referencia ENV/Railway/Signals/set-variable no código", () => {
    expect(dialogCode).not.toMatch(/process\.env|import\.meta\.env|railway|Signal|set-variable/i);
  });
  it("gera idempotencyKey única por operação (crypto.randomUUID)", () => {
    expect(dialogSrc).toContain("crypto.randomUUID()");
  });
  it("guarda contra double-submit (desabilita durante a mutation)", () => {
    expect(dialogSrc).toMatch(/disabled=\{busy\}/);
    expect(dialogSrc).toMatch(/if\s*\(!organizationId\s*\|\|\s*!pending\s*\|\|\s*busy\)/);
  });
});

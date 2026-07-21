/**
 * RC-LEGAL-SEC-001 — Congelamento arquitetural do `legalOpinionsRouter` legado
 * após o isolamento multi-tenant completo. Mesmo padrão de
 * `rc-c01a1-contracts-legacy-freeze.test.ts`.
 *
 * Estratégia de allowlist (snapshot 2026-07-21): redução é sempre permitida;
 * qualquer item NOVO fora do baseline quebra o CI.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

const CLIENT_SRC = walk("client/src").filter(f => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
const read = (f: string) => fs.readFileSync(f, "utf-8");

// ─── Baselines congelados ──────────────────────────────────────────────────────

const LEGAL_OPINIONS_CONSUMERS_BASELINE: readonly string[] = [
  "client/src/components/SetSignaturePasswordDialog.tsx",
  "client/src/pages/NewLegalOpinion.tsx",
  "client/src/pages/LegalOpinionDetails.tsx",
  "client/src/pages/LegalOpinions.tsx",
  "client/src/pages/LegalOpinionsAnalytics.tsx",
];

// As 15 procedures do router.
const LEGAL_OPINIONS_ROUTER_ENDPOINTS_BASELINE: readonly string[] = [
  "list", "getById", "getBySource", "create", "update", "delete",
  "exportPDF", "exportDOCX", "generateOpinion", "sign", "verifySignature",
  "getAnalytics", "setSignaturePassword", "hasSignaturePassword", "getSignatureHistory",
];

// Funções exportadas por server/db/legalOpinions.ts que NÃO exigem organizationId,
// com justificativa documentada (mesma abordagem de contracts.ts):
//  - createLegalOpinion: recebe `data: InsertLegalOpinion` (campo organizationId
//    setado pelo router via tenantProcedure antes da chamada);
//  - createDigitalSignature/getDigitalSignatureById/getDigitalSignatureByDocument/
//    invalidateDigitalSignature: tabela digital_signatures sem coluna organizationId;
//    órfãs/inalcançáveis em produção (opinion.signatureId não existe no schema) —
//    auditadas e documentadas em server/db/legalOpinions.ts, não corrigidas
//    (nenhuma leitura cross-tenant alcançável por este caminho);
//  - setSignaturePassword/validateSignaturePassword/hasSignaturePassword: escopo é
//    o próprio usuário (ctx.user.id), não dado organizacional — sem vazamento
//    cross-tenant possível.
const LEGAL_REPOSITORY_UNSAFE_ALLOWLIST: readonly string[] = [
  "createLegalOpinion",
  "createDigitalSignature", "getDigitalSignatureById", "getDigitalSignatureByDocument", "invalidateDigitalSignature",
  "setSignaturePassword", "validateSignaturePassword", "hasSignaturePassword",
];

describe("RC-LEGAL-SEC-001 — Congelamento do legalOpinionsRouter legado (pós-isolamento)", () => {
  // ── 1. novo consumer de trpc.legalOpinions.* ────────────────────────────────
  it("nenhum novo consumidor de trpc.legalOpinions.* além do baseline congelado", () => {
    const consumers = CLIENT_SRC.filter(f => read(f).includes("trpc.legalOpinions."));
    const novos = consumers.filter(f => !LEGAL_OPINIONS_CONSUMERS_BASELINE.includes(f));
    expect(novos, `novo(s) consumidor(es): ${novos.join(", ")}`).toEqual([]);
  });

  // ── 2. nova procedure no router ─────────────────────────────────────────────
  it("o legalOpinionsRouter não ganha novas procedures além das 15 do baseline", () => {
    const src = read("server/routers/legalOpinionsRouter.ts");

    const ausentes = LEGAL_OPINIONS_ROUTER_ENDPOINTS_BASELINE.filter(name =>
      !new RegExp(`\\b${name}:\\s*(tenantProcedure|protectedProcedure)\\b`).test(src)
    );
    expect(ausentes, `procedure(s) do baseline não encontrada(s): ${ausentes.join(", ")}`).toEqual([]);

    const totalDeclared =
      (src.match(/:\s*tenantProcedure\b/g) ?? []).length +
      (src.match(/:\s*protectedProcedure\b/g) ?? []).length;
    expect(totalDeclared, "número de procedures cresceu além do baseline (15)").toBeLessThanOrEqual(LEGAL_OPINIONS_ROUTER_ENDPOINTS_BASELINE.length);
  });

  // ── 3. função de repository de parecer sem organizationId ───────────────────
  it("toda função exportada de server/db/legalOpinions.ts (exceto exceções documentadas) exige organizationId", () => {
    const src = read("server/db/legalOpinions.ts");
    const fnMatches = [...src.matchAll(/export async function (\w+)\(([^)]*)\)/g)];
    expect(fnMatches.length).toBeGreaterThan(0);

    const semOrganizationId = fnMatches
      .filter(m => !LEGAL_REPOSITORY_UNSAFE_ALLOWLIST.includes(m[1]))
      .filter(m => !/organizationId/.test(m[2]))
      .map(m => m[1]);

    expect(semOrganizationId, `função(ões) nova(s)/alterada(s) sem organizationId: ${semOrganizationId.join(", ")}`).toEqual([]);
  });

  // ── 4. query de parecer por ID sem organizationId no router ─────────────────
  it("o router não usa mais getContractById nem funções antigas sem organizationId (getLegalOpinionById/updateLegalOpinion/deleteLegalOpinion/etc.)", () => {
    const src = read("server/routers/legalOpinionsRouter.ts");
    expect(src).not.toMatch(/\bgetContractById\b/);
    expect(src).not.toMatch(/\bgetLegalOpinionById\(/);
    expect(src).not.toMatch(/\bupdateLegalOpinion\(/);
    expect(src).not.toMatch(/\bdeleteLegalOpinion\(/);
    expect(src).not.toMatch(/\bgetLegalOpinions\(/);
    expect(src).not.toMatch(/\bgetLegalOpinionsBySource\(/);
  });

  // ── 5. código canônico importar router/service legado ──────────────────────
  it("legalOpinionWorkspaceRouter (canônico) não importa legalOpinionsRouter nem db/legalOpinions.ts", () => {
    const src = read("server/routers/legalOpinionWorkspaceRouter.ts");
    expect(src).not.toMatch(/routers\/legalOpinionsRouter|db\/legalOpinions["']/);
  });

  // ── 6. Business Domain apontar para rota legada ─────────────────────────────
  it("nenhum Business Domain declara /parecer-juridico como path canônico", () => {
    const src = read("client/src/config/businessDomains.ts");
    const blockRegex = /\{\s*id:\s*"([^"]+)"[\s\S]*?\n\s*\},/g;
    const blocks = [...src.matchAll(blockRegex)];
    const offenders = blocks
      .map(b => ({ id: b[1], body: b[0] }))
      .filter(b => /path:\s*"\/parecer-juridico(\/|")/.test(b.body))
      .map(b => b.id);
    expect(offenders, `domínio(s) apontando path canônico para /parecer-juridico: ${offenders.join(", ")}`).toEqual([]);
  });

  // ── 7. LEGACY_INVENTORY.md continua classificando Parecer Jurídico legado ──
  it("LEGACY_INVENTORY.md continua classificando LegalOpinions como Classe 3 e registra o isolamento RC-LEGAL-SEC-001", () => {
    const inv = read("docs/architecture/LEGACY_INVENTORY.md");
    expect(inv).toMatch(/### LegalOpinions\s+→ substituído por \*\*Legal Opinion Workspace\*\*/);
    expect(inv).toContain("RC-LEGAL-SEC-001");
  });

  // ── 8. allowlist cresceu ─────────────────────────────────────────────────────
  it("os baselines desta suíte não excedem os tamanhos congelados — redução permitida, crescimento não", () => {
    expect(LEGAL_OPINIONS_CONSUMERS_BASELINE.length).toBe(5);
    expect(LEGAL_OPINIONS_ROUTER_ENDPOINTS_BASELINE.length).toBe(15);
  });
});

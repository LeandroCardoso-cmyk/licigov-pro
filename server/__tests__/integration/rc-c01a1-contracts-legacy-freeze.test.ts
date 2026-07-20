/**
 * RC-C0.1A.1 — Congelamento arquitetural do `contractsRouter` legado após o
 * isolamento multi-tenant completo. Estende `rc-c01a-legacy-freeze.test.ts`
 * (que já congela documentsRouter/processesRouter/gemini.ts) para o domínio de
 * Contratos: nenhum novo endpoint, nenhuma nova função de repository insegura,
 * nenhum novo consumidor, nenhuma promoção acidental a canônico.
 *
 * Estratégia de allowlist (snapshot 2026-07-20, Sprint C0.1A.1): redução é
 * sempre permitida; qualquer item NOVO fora do baseline quebra o CI. Atualizar
 * a allowlist só em migração autorizada (ver LEGACY_INVENTORY.md, critério de
 * saída de Contratos).
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
const SERVER_SRC = walk("server").filter(f => !f.includes("__tests__") && !f.endsWith(".test.ts"));
const read = (f: string) => fs.readFileSync(f, "utf-8");

// ─── Baselines congelados ──────────────────────────────────────────────────────

const CONTRACTS_CONSUMERS_BASELINE: readonly string[] = [
  "client/src/components/NewAmendmentModal.tsx",
  "client/src/components/NewApostilleModal.tsx",
  "client/src/pages/Contracts.tsx",
  "client/src/pages/ContractAlerts.tsx",
  "client/src/pages/Admin.tsx",
  "client/src/pages/NewContract.tsx",
  "client/src/pages/ContractDetails.tsx",
  "client/src/pages/ModuleSelectionDashboard.tsx",
  "client/src/pages/NewLegalOpinion.tsx",
];

// As 23 procedures folha do router — nome qualificado por namespace onde há colisão.
const CONTRACTS_ROUTER_ENDPOINTS_BASELINE: readonly string[] = [
  "create", "getById", "list", "update",
  "amendments.create", "amendments.list",
  "apostilles.create", "apostilles.list",
  "documents.create", "documents.list", "documents.update",
  "audit.getLogs", "audit.getLogsByAction",
  "analytics.getOverview", "analytics.getRecent",
  "generation.generateMinuta", "generation.generateAmendment", "generation.generateApostille", "generation.generateRescission",
  "notifications.checkExpirations", "notifications.getSummary",
  "reports.exportAlertsExcel", "reports.exportAuditExcel",
];

// Toda função exportada por server/db/contracts.ts que ler/gravar dados de contrato
// deve exigir organizationId. Exceções documentadas e explicadas:
//  - getContractById: INSEGURA de propósito, mantida só para legalOpinionsRouter.ts
//    (fora do escopo desta sprint).
//  - createContract: recebe `data: InsertContract`, cujo campo organizationId é
//    setado pelo router (tenantProcedure) antes da chamada — o parâmetro é um
//    objeto tipado, não um argumento nomeado, por isso o regex de assinatura não
//    o capta textualmente; a exigência é garantida pelo tipo `InsertContract`.
//  - createContractAuditLog: `contract_audit_logs` não tem coluna organizationId
//    (mesma limitação de schema das demais tabelas auxiliares) — só é chamada
//    depois que o router já verificou o contrato-pai dentro da organização.
const REPOSITORY_UNSAFE_ALLOWLIST: readonly string[] = ["getContractById", "createContract", "createContractAuditLog"];

// Únicos arquivos autorizados a importar as tabelas legadas de contrato diretamente.
const LEGACY_CONTRACT_TABLE_ALLOWLIST: readonly string[] = [
  "server/db/contracts.ts",
  "server/services/contractNotifications.ts",
  "server/services/contractReports.ts",
];

describe("RC-C0.1A.1 — Congelamento do contractsRouter legado (pós-isolamento)", () => {
  // ── 1. novo consumer de trpc.contracts.* ─────────────────────────────────────
  it("nenhum novo consumidor de trpc.contracts.* além do baseline congelado", () => {
    const consumers = CLIENT_SRC.filter(f => read(f).includes("trpc.contracts."));
    const novos = consumers.filter(f => !CONTRACTS_CONSUMERS_BASELINE.includes(f));
    expect(novos, `novo(s) consumidor(es) de trpc.contracts.* fora do baseline: ${novos.join(", ")}`).toEqual([]);
  });

  // ── 2. novo endpoint no contractsRouter ──────────────────────────────────────
  it("o contractsRouter não ganha novos endpoints além dos 23 do baseline (checado por símbolo, não só contagem)", () => {
    const src = read("server/routers/contractsRouter.ts");

    // Cada endpoint do baseline precisa existir nominalmente no source.
    const ausentes = CONTRACTS_ROUTER_ENDPOINTS_BASELINE.filter(name => {
      const leaf = name.split(".").pop()!;
      return !new RegExp(`\\b${leaf}:\\s*tenantProcedure\\b`).test(src);
    });
    expect(ausentes, `endpoint(s) do baseline não encontrado(s): ${ausentes.join(", ")}`).toEqual([]);

    // Nenhuma procedure nova: total de declarações "<nome>: tenantProcedure" não excede o baseline.
    const totalDeclared = (src.match(/:\s*tenantProcedure\b/g) ?? []).length;
    expect(totalDeclared, "número de procedures do router cresceu além do baseline (23)").toBeLessThanOrEqual(CONTRACTS_ROUTER_ENDPOINTS_BASELINE.length);

    // Nenhuma procedure voltou a usar protectedProcedure (regressão de segurança).
    expect(src).not.toMatch(/\bprotectedProcedure\b/);
  });

  // ── 3/4/5. nova função de repository sem organizationId / query ou mutation sem tenant ─
  it("toda função exportada de server/db/contracts.ts (exceto a exceção documentada) exige organizationId", () => {
    const src = read("server/db/contracts.ts");
    const fnMatches = [...src.matchAll(/export async function (\w+)\(([^)]*)\)/g)];
    expect(fnMatches.length).toBeGreaterThan(0);

    const semOrganizationId = fnMatches
      .filter(m => !REPOSITORY_UNSAFE_ALLOWLIST.includes(m[1]))
      .filter(m => !/organizationId/.test(m[2]))
      .map(m => m[1]);

    expect(semOrganizationId, `função(ões) nova(s)/alterada(s) sem organizationId: ${semOrganizationId.join(", ")}`).toEqual([]);
  });

  // ── 6. nova chamada direta às tabelas legadas fora da allowlist ──────────────
  it("apenas os arquivos do baseline importam as tabelas legadas de contrato diretamente", () => {
    const offenders = SERVER_SRC.filter(f => {
      if (LEGACY_CONTRACT_TABLE_ALLOWLIST.includes(f)) return false;
      const src = read(f);
      return /\bcontractAmendments\b|\bcontractApostilles\b|\bcontractAuditLogs\b|\bcontractDocuments\b/.test(src)
        && /from ["']\.\.\/\.\.\/drizzle\/schema["']|from ["']\.\.\/db\/contracts["']/.test(src);
    });
    expect(offenders, `arquivo(s) novo(s) acessando tabelas legadas fora da allowlist: ${offenders.join(", ")}`).toEqual([]);
  });

  // ── 7. código canônico importar contractsRouter ─────────────────────────────
  it("nenhum arquivo de CANONICAL_NOT_YET_WIRED nem Business Domain oficial importa contractsRouter/db/contracts.ts", async () => {
    const { CANONICAL_NOT_YET_WIRED, BUSINESS_DOMAIN_SERVICES } = await import("../../kernel/architecture/legacyBoundaries");
    const canonicalPaths = [...CANONICAL_NOT_YET_WIRED, ...BUSINESS_DOMAIN_SERVICES].filter(p => fs.existsSync(p) && p.endsWith(".ts"));
    const offenders = canonicalPaths.filter(p => /routers\/contractsRouter|db\/contracts["']/.test(read(p)));
    expect(offenders, `código canônico importando o legado: ${offenders.join(", ")}`).toEqual([]);
  });

  // ── 8. Business Domain apontar para /contracts ───────────────────────────────
  it("nenhum Business Domain declara /contracts (ou subrotas) como path canônico", () => {
    const src = read("client/src/config/businessDomains.ts");
    const blockRegex = /\{\s*id:\s*"([^"]+)"[\s\S]*?\n\s*\},/g;
    const blocks = [...src.matchAll(blockRegex)];
    const offenders = blocks
      .map(b => ({ id: b[1], body: b[0] }))
      .filter(b => /path:\s*"\/contracts(\/|")/.test(b.body))
      .map(b => b.id);
    expect(offenders, `domínio(s) apontando path canônico para /contracts: ${offenders.join(", ")}`).toEqual([]);
  });

  // ── 9. endpoint legado promovido a canônico ──────────────────────────────────
  it("LEGACY_INVENTORY.md continua classificando Contracts como Classe 3 (não promovido a canônico)", () => {
    const inv = read("docs/architecture/LEGACY_INVENTORY.md");
    expect(inv).toMatch(/### Contracts\s+→ substituído por \*\*Contract Workspace\*\*/);
    expect(inv).toMatch(/\*\*Classe:\*\*\s*3/);
  });

  // ── 10. allowlist cresceu ────────────────────────────────────────────────────
  it("os 3 baselines desta suíte (consumers/endpoints/tabelas) não excedem os tamanhos congelados — redução permitida, crescimento não", () => {
    expect(CONTRACTS_CONSUMERS_BASELINE.length).toBe(9);
    expect(CONTRACTS_ROUTER_ENDPOINTS_BASELINE.length).toBe(23);
    expect(LEGACY_CONTRACT_TABLE_ALLOWLIST.length).toBe(3);
  });
});

/**
 * RC-C0.1A — Isolamento multi-tenant de `contracts.analytics.getOverview` —
 * smoke contra MySQL REAL. Só roda quando DATABASE_URL está definido.
 *
 * Cobre a correção do vazamento confirmado na Sprint C0/C0.1A: o endpoint
 * agregava globalmente, sem filtro de organização (server/db/contracts.ts
 * `getContractsOverview`, consumido por Admin.tsx e ModuleSelectionDashboard.tsx
 * via contractsRouter.ts `analytics.getOverview`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { getContractsOverview } from "../../db/contracts";

const DB = process.env.DATABASE_URL;
const ORG_A = 900101;
const ORG_B = 900102;
const ORG_EMPTY = 900103; // nenhum contrato — prova de não-vazamento cruzado

describe.skipIf(!DB)("contracts.analytics.getOverview — isolamento multi-tenant (MySQL real)", () => {
  let conn: mysql.Connection;
  let userA: number;
  let userB: number;
  let userNoOrg: number;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);

    async function insertUser(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`,
        [`test-tenant-iso-${tag}-${Date.now()}`, `Usuário ${tag}`, `tenant-iso-${tag}-${Date.now()}@teste.local`]
      );
      return r.insertId;
    }

    userA = await insertUser("a");
    userB = await insertUser("b");
    userNoOrg = await insertUser("noorg");

    await conn.execute(
      `INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`,
      [ORG_A, userA]
    );
    await conn.execute(
      `INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`,
      [ORG_B, userB]
    );
    // userNoOrg: propositalmente SEM linha em organization_members.

    // 3 contratos na ORG_A: 2 ativos (100000+200000 centavos), 1 expirado.
    await insertContract(ORG_A, "CT-ISO-A-001", "active", 100_000, userA);
    await insertContract(ORG_A, "CT-ISO-A-002", "active", 200_000, userA);
    await insertContract(ORG_A, "CT-ISO-A-003", "expired", 50_000, userA);

    // 1 contrato na ORG_B: valor bem diferente, para detectar qualquer mistura.
    await insertContract(ORG_B, "CT-ISO-B-001", "active", 9_000_000, userB);

    async function insertContract(orgId: number, number_: string, status: string, value: number, createdBy: number) {
      await conn.execute(
        `INSERT INTO contracts
           (organizationId, number, year, object, type, contractorName, value, currentValue,
            startDate, endDate, status, createdBy)
         VALUES (?, ?, 2026, 'Objeto de teste isolamento', 'servico', 'Fornecedor Teste', ?, ?,
                 NOW(), DATE_ADD(NOW(), INTERVAL 1 YEAR), ?, ?)`,
        [orgId, number_, value, value, status, createdBy]
      );
    }
  }, 60_000);

  afterAll(async () => {
    if (conn) {
      await conn.execute(`DELETE FROM contracts WHERE organizationId IN (?, ?, ?)`, [ORG_A, ORG_B, ORG_EMPTY]).catch(() => {});
      await conn.execute(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM users WHERE id IN (?, ?, ?)`, [userA, userB, userNoOrg]).catch(() => {});
      await conn.end();
    }
  });

  // ── Itens 1-8: isolamento repository-level, direto em db.getContractsOverview ──

  it("1-5. ORG_A vê só seus 3 contratos (2 ativos + 1 expirado), não os da ORG_B", async () => {
    const overview = await getContractsOverview(ORG_A);
    expect(overview!.total).toBe(3);
    expect(overview!.active).toBe(2);
    expect(overview!.expired).toBe(1);
    // SUM(currentValue) volta como string do driver mysql2 (comportamento
    // pré-existente, não alterado por esta correção de segurança) — coagir.
    expect(Number(overview!.totalValue)).toBe(100_000 + 200_000 + 50_000);
  });

  it("6-7. ORG_B vê só seu 1 contrato, não os 3 da ORG_A", async () => {
    const overview = await getContractsOverview(ORG_B);
    expect(overview!.total).toBe(1);
    expect(overview!.active).toBe(1);
    expect(Number(overview!.totalValue)).toBe(9_000_000);
  });

  it("8. valores e contagens não se misturam entre as duas organizações", async () => {
    const a = await getContractsOverview(ORG_A);
    const b = await getContractsOverview(ORG_B);
    // Antes da correção, ambas as chamadas retornariam o MESMO total global
    // (4 contratos, valor somado 9.350.000) — a asserção abaixo falharia.
    expect(a!.total).not.toBe(b!.total);
    expect(a!.totalValue).not.toBe(b!.totalValue);
    expect(a!.totalValue + b!.totalValue).not.toBe(a!.totalValue); // sanidade: não são o mesmo objeto/valor
  });

  it("uma organização sem nenhum contrato não enxerga dados de outras (prova direta de não-vazamento)", async () => {
    const overview = await getContractsOverview(ORG_EMPTY);
    expect(overview!.total).toBe(0);
    expect(overview!.active).toBe(0);
    expect(overview!.totalValue).toBe(0);
  });

  // ── Itens 9-11: nível de router (tenantProcedure), via appRouter.createCaller ──

  async function callGetOverview(userId: number, headers: Record<string, string> = {}) {
    const { appRouter } = await import("../../routers");
    const caller = appRouter.createCaller({
      user: { id: userId, role: "user" } as any,
      req: { headers } as any,
      res: {} as any,
      correlationId: "test-tenant-iso",
    } as any);
    return caller.contracts.analytics.getOverview();
  }

  it("9. usuário da ORG_A não consegue trocar de tenant enviando header X-Organization-Id de uma org onde não é membro", async () => {
    await expect(
      callGetOverview(userA, { "x-organization-id": String(ORG_B) })
    ).rejects.toThrow(/acesso/i);
  }, 30_000); // 1ª chamada a appRouter.createCaller paga o custo de cold-import de routers.ts

  it("9b. usuário da ORG_A, sem header, resolve para a própria ORG_A (não aceita tenant do payload — não há input algum no procedure)", async () => {
    const result = await callGetOverview(userA);
    expect(result!.total).toBe(3);
  }, 30_000);

  it("10. usuário sem nenhuma organização é bloqueado (fail-closed) — nunca agregação global nem fallback org 1", async () => {
    // RC-SEC-PR-A (SEC-017): o fallback determinístico para org=1 foi REMOVIDO.
    // Usuário sem membership recebe FORBIDDEN/NO_ORGANIZATION_MEMBERSHIP e nunca
    // vê agregação de nenhuma organização.
    await expect(callGetOverview(userNoOrg)).rejects.toThrow(/NO_ORGANIZATION_MEMBERSHIP|acesso|organiza/i);
  }, 30_000);

  it("11. admin de plataforma só enxerga a org selecionada via header (mesmo mecanismo de qualquer tenantProcedure) — não existe rota que devolva visão global neste endpoint", async () => {
    const { appRouter } = await import("../../routers");
    const callerAdmin = appRouter.createCaller({
      user: { id: userA, role: "admin" } as any,
      req: { headers: { "x-organization-id": String(ORG_A) } } as any,
      res: {} as any,
      correlationId: "test-tenant-iso-admin",
    } as any);
    const result = await callerAdmin.contracts.analytics.getOverview();
    expect(result!.total).toBe(3); // igual ao escopo da ORG_A — não é global (seria 4: 3+1)
  }, 30_000);

  // 12. A query antiga sem filtro (getContractsOverview() sem argumento) não compila mais —
  //     organizationId é parâmetro obrigatório (TypeScript), reforçado pelo typecheck do
  //     projeto e pelas asserções de isolamento acima, que fariam esta suíte falhar caso
  //     o filtro fosse removido.
  // 13. Regressão visual dos dashboards consumidores (Admin.tsx, ModuleSelectionDashboard.tsx)
  //     não é exercitável neste teste (sem renderização de browser); o contrato de resposta
  //     ({ total, byType, byStatus, totalValue, active, expired, expiringSoon }) foi
  //     preservado integralmente e validado pelo typecheck completo do projeto.
});

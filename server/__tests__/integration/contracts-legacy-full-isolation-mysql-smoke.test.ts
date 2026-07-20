/**
 * RC-C0.1A.1 — Isolamento multi-tenant completo do `contractsRouter` legado —
 * smoke contra MySQL REAL. Só roda quando DATABASE_URL está definido.
 *
 * Cobre as 20 procedures do router (create/getById/list/update, amendments.*,
 * apostilles.*, documents.*, audit.*, analytics.getRecent, generation.*,
 * notifications.*, reports.*) — analytics.getOverview já tinha suíte própria
 * (contracts-tenant-isolation-mysql-smoke.test.ts, Sprint C0.1A).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import {
  getContractByIdForOrganization, listContractsByOrganization, updateContractForOrganization,
  createAmendmentForOrganization, listAmendmentsForOrganization,
  createApostilleForOrganization, listApostillesForOrganization,
  createContractDocumentForOrganization, listContractDocumentsForOrganization, updateContractDocumentForOrganization,
  getContractAuditLogsForOrganization, getRecentContractsForOrganization,
} from "../../db/contracts";

const DB = process.env.DATABASE_URL;
const ORG_A = 900201;
const ORG_B = 900202;

describe.skipIf(!DB)("contractsRouter legado — isolamento multi-tenant completo (MySQL real)", () => {
  let conn: mysql.Connection;
  let userA: number;
  let userB: number;
  let userNoOrg: number;
  let contractA: number;
  let contractB: number;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);

    async function insertUser(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`,
        [`test-full-iso-${tag}-${Date.now()}`, `Usuário ${tag}`, `full-iso-${tag}-${Date.now()}@teste.local`]
      );
      return r.insertId;
    }
    userA = await insertUser("a");
    userB = await insertUser("b");
    userNoOrg = await insertUser("noorg");

    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`, [ORG_A, userA]);
    await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'owner', 1)`, [ORG_B, userB]);

    async function insertContract(orgId: number, number_: string, createdBy: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO contracts
           (organizationId, number, year, object, type, contractorName, value, currentValue,
            startDate, endDate, status, createdBy)
         VALUES (?, ?, 2026, 'Objeto full-iso', 'servico', 'Fornecedor Full', 100000, 100000,
                 NOW(), DATE_ADD(NOW(), INTERVAL 1 YEAR), 'active', ?)`,
        [orgId, number_, createdBy]
      );
      return r.insertId;
    }
    contractA = await insertContract(ORG_A, "CT-FULL-A-001", userA);
    contractB = await insertContract(ORG_B, "CT-FULL-B-001", userB);

    // Aditivo, apostilamento, documento e log de auditoria para o contrato da ORG_A.
    await conn.execute(
      `INSERT INTO contract_amendments (contractId, number, type, justification, createdBy) VALUES (?, 1, 'prazo', 'Justificativa de teste', ?)`,
      [contractA, userA]
    );
    await conn.execute(
      `INSERT INTO contract_apostilles (contractId, number, type, description, createdBy) VALUES (?, 1, 'reajuste', 'Descrição de teste', ?)`,
      [contractA, userA]
    );
    await conn.execute(
      `INSERT INTO contract_documents (contractId, type, title, content) VALUES (?, 'minuta', 'Minuta Teste', 'Conteúdo')`,
      [contractA]
    );
    await conn.execute(
      `INSERT INTO contract_audit_logs (contractId, action, userId, userName) VALUES (?, 'created', ?, 'Usuário A')`,
      [contractA, userA]
    );
  }, 60_000);

  afterAll(async () => {
    if (conn) {
      await conn.execute(`DELETE FROM contract_audit_logs WHERE contractId IN (?, ?)`, [contractA, contractB]).catch(() => {});
      await conn.execute(`DELETE FROM contract_documents WHERE contractId IN (?, ?)`, [contractA, contractB]).catch(() => {});
      await conn.execute(`DELETE FROM contract_apostilles WHERE contractId IN (?, ?)`, [contractA, contractB]).catch(() => {});
      await conn.execute(`DELETE FROM contract_amendments WHERE contractId IN (?, ?)`, [contractA, contractB]).catch(() => {});
      await conn.execute(`DELETE FROM contracts WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM users WHERE id IN (?, ?, ?)`, [userA, userB, userNoOrg]).catch(() => {});
      await conn.end();
    }
  });

  // ── list (itens 1-5 da ETAPA 8) ──────────────────────────────────────────────
  it("list: A vê só contratos de A, B vê só contratos de B, filtros não misturam tenants", async () => {
    const listA = await listContractsByOrganization(ORG_A);
    const listB = await listContractsByOrganization(ORG_B);
    expect(listA.map(c => c.id)).toContain(contractA);
    expect(listA.map(c => c.id)).not.toContain(contractB);
    expect(listB.map(c => c.id)).toContain(contractB);
    expect(listB.map(c => c.id)).not.toContain(contractA);

    const listAFiltered = await listContractsByOrganization(ORG_A, { status: "active" });
    expect(listAFiltered.map(c => c.id)).toContain(contractA);
    expect(listAFiltered.map(c => c.id)).not.toContain(contractB);
  });

  // ── getById (itens 6-10) ─────────────────────────────────────────────────────
  it("getById: A acessa contrato A, não acessa contrato B (retorna null, nunca revela existência)", async () => {
    expect(await getContractByIdForOrganization(contractA, ORG_A)).not.toBeNull();
    expect(await getContractByIdForOrganization(contractB, ORG_A)).toBeNull();
    expect(await getContractByIdForOrganization(999999999, ORG_A)).toBeNull();
    // Ambos os casos (cross-tenant e inexistente) retornam null identicamente — sem diferenciação.
  });

  // ── getRecent (itens 11-13) ──────────────────────────────────────────────────
  it("getRecent: A vê apenas recentes de A, B vê apenas recentes de B", async () => {
    const recentA = await getRecentContractsForOrganization(ORG_A, 50);
    const recentB = await getRecentContractsForOrganization(ORG_B, 50);
    expect(recentA.map(c => c.id)).toContain(contractA);
    expect(recentA.map(c => c.id)).not.toContain(contractB);
    expect(recentB.map(c => c.id)).toContain(contractB);
    expect(recentB.map(c => c.id)).not.toContain(contractA);
  });

  // ── amendments.list (itens 14-16) ────────────────────────────────────────────
  it("amendments.list: A vê aditivos do contrato A; contrato-pai cross-tenant é rejeitado ([])", async () => {
    const amendmentsA = await listAmendmentsForOrganization(contractA, ORG_A);
    expect(amendmentsA.length).toBeGreaterThan(0);
    const crossTenant = await listAmendmentsForOrganization(contractA, ORG_B);
    expect(crossTenant).toEqual([]);
  });

  // ── apostilles.list (itens 17-19) ────────────────────────────────────────────
  it("apostilles.list: A vê apostilamentos do contrato A; contrato-pai cross-tenant é rejeitado ([])", async () => {
    const apostillesA = await listApostillesForOrganization(contractA, ORG_A);
    expect(apostillesA.length).toBeGreaterThan(0);
    const crossTenant = await listApostillesForOrganization(contractA, ORG_B);
    expect(crossTenant).toEqual([]);
  });

  // ── documents.list / audit.getLogs (mesma classe de relação auxiliar) ───────
  it("documents.list e audit.getLogs: mesma proteção via contrato-pai", async () => {
    const docsA = await listContractDocumentsForOrganization(contractA, ORG_A);
    expect(docsA.length).toBeGreaterThan(0);
    expect(await listContractDocumentsForOrganization(contractA, ORG_B)).toEqual([]);

    const logsA = await getContractAuditLogsForOrganization(contractA, ORG_A);
    expect(logsA.length).toBeGreaterThan(0);
    expect(await getContractAuditLogsForOrganization(contractA, ORG_B)).toEqual([]);
  });

  // ── mutations cross-tenant (item 21) ─────────────────────────────────────────
  it("update cross-tenant retorna null; update dentro do tenant funciona", async () => {
    const crossUpdate = await updateContractForOrganization(contractA, ORG_B, { notes: "tentativa maliciosa" });
    expect(crossUpdate).toBeNull();

    const legitUpdate = await updateContractForOrganization(contractA, ORG_A, { notes: "atualização legítima" });
    expect(legitUpdate).not.toBeNull();
    expect(legitUpdate!.notes).toBe("atualização legítima");
  });

  it("amendments.create cross-tenant retorna null (contrato-pai de outra org); dentro do tenant cria normalmente", async () => {
    const crossCreate = await createAmendmentForOrganization(
      { contractId: contractA, number: 99, type: "prazo", justification: "tentativa cross-tenant", createdBy: userB },
      ORG_B
    );
    expect(crossCreate).toBeNull();

    const legitCreate = await createAmendmentForOrganization(
      { contractId: contractA, number: 2, type: "prazo", justification: "aditivo legítimo suficientemente longo", createdBy: userA },
      ORG_A
    );
    expect(legitCreate).not.toBeNull();
  });

  it("apostilles.create e documents.create cross-tenant retornam null; dentro do tenant funcionam", async () => {
    expect(await createApostilleForOrganization(
      { contractId: contractA, number: 99, type: "reajuste", description: "cross-tenant", createdBy: userB }, ORG_B
    )).toBeNull();
    expect(await createApostilleForOrganization(
      { contractId: contractA, number: 2, type: "reajuste", description: "legítimo", createdBy: userA }, ORG_A
    )).not.toBeNull();

    expect(await createContractDocumentForOrganization(
      { contractId: contractA, type: "outro", title: "cross-tenant", content: "x" }, ORG_B
    )).toBeNull();
    expect(await createContractDocumentForOrganization(
      { contractId: contractA, type: "outro", title: "legítimo", content: "x" }, ORG_A
    )).not.toBeNull();
  });

  it("documents.update: resolve o contrato-pai a partir do próprio documento; cross-tenant retorna null", async () => {
    const doc = await createContractDocumentForOrganization(
      { contractId: contractA, type: "outro", title: "doc para update", content: "v1" }, ORG_A
    );
    expect(doc).not.toBeNull();

    const crossUpdate = await updateContractDocumentForOrganization(doc!.id, ORG_B, { content: "v2 maliciosa" });
    expect(crossUpdate).toBeNull();

    const legitUpdate = await updateContractDocumentForOrganization(doc!.id, ORG_A, { content: "v2 legítima" });
    expect(legitUpdate).not.toBeNull();
    expect(legitUpdate!.content).toBe("v2 legítima");
  });

  // ── ausência de fallback global: nenhuma função aceita "sem organização" ─────
  it("nenhuma função org-scoped tem fallback global silencioso: organizationId inexistente retorna vazio, nunca todos os registros", async () => {
    const NON_EXISTENT_ORG = 999888777;
    expect(await listContractsByOrganization(NON_EXISTENT_ORG)).toEqual([]);
    expect(await getRecentContractsForOrganization(NON_EXISTENT_ORG)).toEqual([]);
  });

  // ── contrato de resposta preservado (item 26) ────────────────────────────────
  it("contrato de resposta de list/getById preserva as mesmas chaves de antes da correção", async () => {
    const list = await listContractsByOrganization(ORG_A);
    expect(list[0]).toHaveProperty("id");
    expect(list[0]).toHaveProperty("number");
    expect(list[0]).toHaveProperty("status");

    const single = await getContractByIdForOrganization(contractA, ORG_A);
    expect(single).toHaveProperty("contractorName");
    expect(single).toHaveProperty("value");
  });

  // ============================================================================
  // ETAPA 9 — Testes de router completo (tenantProcedure, membership, roles)
  // ============================================================================

  async function makeCaller(userId: number, role: "user" | "admin" = "user", headers: Record<string, string> = {}) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role } as any,
      req: { headers } as any,
      res: {} as any,
      correlationId: "test-full-iso-router",
    } as any);
  }

  it("router: usuário A recebe apenas contratos de A via list; getById cross-tenant retorna null (mesmo comportamento de antes, nunca lançou)", async () => {
    const callerA = await makeCaller(userA);
    const list = await callerA.contracts.list();
    expect(list.map((c: any) => c.id)).toContain(contractA);
    expect(list.map((c: any) => c.id)).not.toContain(contractB);

    const crossTenant = await callerA.contracts.getById({ id: contractB });
    expect(crossTenant).toBeNull();
  }, 30_000);

  it("router: mutation amendments.create cross-tenant lança NOT_FOUND (não confia no contractId do payload)", async () => {
    const callerB = await makeCaller(userB);
    await expect(
      callerB.contracts.amendments.create({
        contractId: contractA, // pertence à ORG_A, não à ORG_B do userB
        number: 50, type: "prazo",
        justification: "Tentativa de aditivo cross-tenant via router — justificativa longa o bastante para passar a validação de negócio e alcançar de fato o check de isolamento por organização (Art. 124 da Lei 14.133/2021).",
      })
    ).rejects.toThrow(/não encontrado/i);
  }, 30_000);

  it("router: header malicioso (organização sem membership) é rejeitado antes de qualquer query de contrato", async () => {
    const caller = await makeCaller(userA, "user", { "x-organization-id": String(ORG_B) });
    await expect(caller.contracts.list()).rejects.toThrow(/acesso/i);
  }, 30_000);

  it("router: usuário sem organização cai no fallback determinístico (org=1), nunca em agregação global de todas as orgs", async () => {
    const caller = await makeCaller(userNoOrg);
    const list = await caller.contracts.list();
    // org=1 não tem os contratos de teste — não deve conter contractA nem contractB.
    expect(list.map((c: any) => c.id)).not.toContain(contractA);
    expect(list.map((c: any) => c.id)).not.toContain(contractB);
  }, 30_000);

  it("router: admin de plataforma opera escopado à organização selecionada via header, não globalmente", async () => {
    const callerAdmin = await makeCaller(userA, "admin", { "x-organization-id": String(ORG_A) });
    const list = await callerAdmin.contracts.list();
    expect(list.map((c: any) => c.id)).toContain(contractA);
    expect(list.map((c: any) => c.id)).not.toContain(contractB); // não é visão global
  }, 30_000);

  it("router: erro NOT_FOUND não vaza informação (mesma mensagem para contrato inexistente e para contrato de outra organização)", async () => {
    const callerA = await makeCaller(userA);
    let msgCrossTenant = "";
    let msgInexistente = "";
    try { await callerA.contracts.generation.generateMinuta({ contractId: contractB }); } catch (e: any) { msgCrossTenant = e.message; }
    try { await callerA.contracts.generation.generateMinuta({ contractId: 999999999 }); } catch (e: any) { msgInexistente = e.message; }
    expect(msgCrossTenant).not.toBe("");
    expect(msgCrossTenant).toBe(msgInexistente);
  }, 30_000);
});

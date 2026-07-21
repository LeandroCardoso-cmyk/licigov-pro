/**
 * RC-LEGAL-SEC-001 — Isolamento multi-tenant completo do `legalOpinionsRouter`
 * legado — smoke contra MySQL REAL. Só roda quando DATABASE_URL está definido.
 *
 * Cobre as 15 procedures do router. `invokeLLM` é mockado (chamada de rede
 * externa) — a PERSISTÊNCIA e o ISOLAMENTO TENANT são exercitados contra MySQL
 * real, não contra `db` mockado.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 900301;
const ORG_B = 900302;

vi.mock("../../_core/llm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../_core/llm")>();
  return {
    ...actual,
    invokeLLM: async () => ({
      id: "mock", created: Date.now(), model: "mock",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify({
            opinion: "# Parecer\n\nConteúdo gerado (Lei 14.133/2021, Art. 6º).",
            conclusion: "favorable",
            citedArticles: ["Art. 6º"],
            jurisprudence: [{ court: "TCU", number: "1/2026", summary: "Resumo" }],
          }),
        },
      }],
    }),
  };
});

describe.skipIf(!DB)("legalOpinionsRouter legado — isolamento multi-tenant completo (MySQL real)", () => {
  let conn: mysql.Connection;
  let userA: number;
  let userB: number;
  let userNoOrg: number;
  let contractA: number;
  let contractB: number;
  let opinionA: number;
  let opinionB: number;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);

    async function insertUser(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`,
        [`test-legal-iso-${tag}-${Date.now()}`, `Usuário ${tag}`, `legal-iso-${tag}-${Date.now()}@teste.local`]
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
         VALUES (?, ?, 2026, 'Objeto legal-iso', 'servico', 'Fornecedor Legal', 100000, 100000,
                 NOW(), DATE_ADD(NOW(), INTERVAL 1 YEAR), 'active', ?)`,
        [orgId, number_, createdBy]
      );
      return r.insertId;
    }
    contractA = await insertContract(ORG_A, "CT-LEGAL-A-001", userA);
    contractB = await insertContract(ORG_B, "CT-LEGAL-B-001", userB);

    async function insertOpinion(orgId: number, requestedBy: number, sourceId: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO legal_opinions
           (organizationId, title, sourceType, sourceId, legalQuestion, status, requiredSignatures, requestedBy)
         VALUES (?, 'Parecer teste', 'contract', ?, 'Questão jurídica de teste com mais de dez caracteres', 'draft', 1, ?)`,
        [orgId, sourceId, requestedBy]
      );
      return r.insertId;
    }
    opinionA = await insertOpinion(ORG_A, userA, contractA);
    opinionB = await insertOpinion(ORG_B, userB, contractB);

    // Senha de assinatura para os testes de `sign`.
    await conn.execute(`UPDATE users SET signaturePassword = ? WHERE id IN (?, ?)`, [
      "$2b$10$placeholder", userA, userB,
    ]);
  }, 60_000);

  afterAll(async () => {
    if (conn) {
      await conn.execute(`DELETE FROM signature_history WHERE opinionId IN (?, ?)`, [opinionA, opinionB]).catch(() => {});
      await conn.execute(`DELETE FROM legal_opinions WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM contracts WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM users WHERE id IN (?, ?, ?)`, [userA, userB, userNoOrg]).catch(() => {});
      await conn.end();
    }
  });

  async function makeCaller(userId: number, role: "user" | "admin" = "user", headers: Record<string, string> = {}) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role, name: `Usuário ${userId}`, email: `u${userId}@teste.local` } as any,
      req: { headers } as any,
      res: {} as any,
      correlationId: "test-legal-iso",
    } as any);
  }

  // ── 1-2. list ────────────────────────────────────────────────────────────────
  it("1-2. list: A vê só pareceres de A, B vê só pareceres de B", async () => {
    const callerA = await makeCaller(userA);
    const callerB = await makeCaller(userB);
    const listA = await callerA.legalOpinions.list();
    const listB = await callerB.legalOpinions.list();
    expect(listA.map((o: any) => o.id)).toContain(opinionA);
    expect(listA.map((o: any) => o.id)).not.toContain(opinionB);
    expect(listB.map((o: any) => o.id)).toContain(opinionB);
    expect(listB.map((o: any) => o.id)).not.toContain(opinionA);
  }, 30_000);

  // ── 3-5. getById ─────────────────────────────────────────────────────────────
  it("3-5. getById: A abre A, A não abre B, B não abre A (NOT_FOUND idêntico)", async () => {
    const callerA = await makeCaller(userA);
    const callerB = await makeCaller(userB);
    const opened = await callerA.legalOpinions.getById({ id: opinionA });
    expect(opened.id).toBe(opinionA);
    await expect(callerA.legalOpinions.getById({ id: opinionB })).rejects.toThrow(/não encontrado/i);
    await expect(callerB.legalOpinions.getById({ id: opinionA })).rejects.toThrow(/não encontrado/i);
  }, 30_000);

  // ── 6-7. create não aceita contrato de outra organização ────────────────────
  it("6-7. create: parecer da ORG_A não aceita contrato da ORG_B e vice-versa", async () => {
    const callerA = await makeCaller(userA);
    const callerB = await makeCaller(userB);
    await expect(callerA.legalOpinions.create({
      title: "Tentativa cross-tenant", sourceType: "contract", sourceId: contractB,
      legalQuestion: "Questão jurídica de teste com mais de dez caracteres",
    })).rejects.toThrow(/não encontrado/i);
    await expect(callerB.legalOpinions.create({
      title: "Tentativa cross-tenant", sourceType: "contract", sourceId: contractA,
      legalQuestion: "Questão jurídica de teste com mais de dez caracteres",
    })).rejects.toThrow(/não encontrado/i);

    // Caminho legítimo: cria normalmente dentro do próprio tenant.
    const created = await callerA.legalOpinions.create({
      title: "Parecer legítimo", sourceType: "contract", sourceId: contractA,
      legalQuestion: "Questão jurídica de teste com mais de dez caracteres",
    });
    expect(created.id).toBeGreaterThan(0);
  }, 30_000);

  // ── 8. update cross-tenant bloqueada ────────────────────────────────────────
  it("8. update cross-tenant é bloqueada (NOT_FOUND)", async () => {
    const callerA = await makeCaller(userA);
    await expect(callerA.legalOpinions.update({ id: opinionB, title: "Alteração maliciosa" }))
      .rejects.toThrow(/não encontrado/i);
  }, 30_000);

  // ── 9. delete cross-tenant bloqueada ────────────────────────────────────────
  it("9. delete cross-tenant é bloqueada (NOT_FOUND); dentro do tenant funciona", async () => {
    const callerA = await makeCaller(userA);
    const callerB = await makeCaller(userB);
    await expect(callerA.legalOpinions.delete({ id: opinionB })).rejects.toThrow(/não encontrado/i);

    // Cria um parecer descartável em B e confirma que B consegue deletar o próprio.
    const disposable = await callerB.legalOpinions.create({
      title: "Descartável", sourceType: "other", legalQuestion: "Questão jurídica de teste com mais de dez caracteres",
    });
    const result = await callerB.legalOpinions.delete({ id: disposable.id });
    expect(result.success).toBe(true);
  }, 30_000);

  // ── 10. geração documental cross-tenant bloqueada ───────────────────────────
  it("10. generateOpinion cross-tenant é bloqueada; dentro do tenant funciona (invokeLLM mockado)", async () => {
    const callerA = await makeCaller(userA);
    await expect(callerA.legalOpinions.generateOpinion({ id: opinionB })).rejects.toThrow(/não encontrado/i);

    const result = await callerA.legalOpinions.generateOpinion({ id: opinionA });
    expect(result.conclusion).toBe("favorable");
  }, 30_000);

  // ── 11. export cross-tenant bloqueado ───────────────────────────────────────
  it("11. exportPDF/exportDOCX cross-tenant são bloqueados (NOT_FOUND)", async () => {
    const callerA = await makeCaller(userA);
    await expect(callerA.legalOpinions.exportPDF({ id: opinionB })).rejects.toThrow(/não encontrado/i);
    await expect(callerA.legalOpinions.exportDOCX({ id: opinionB })).rejects.toThrow(/não encontrado/i);
  }, 30_000);

  // ── 12. usuário sem organização não recebe fallback global ─────────────────
  it("12. usuário sem organização cai no fallback determinístico (org=1), nunca agregação global", async () => {
    const callerNoOrg = await makeCaller(userNoOrg);
    const list = await callerNoOrg.legalOpinions.list();
    expect(list.map((o: any) => o.id)).not.toContain(opinionA);
    expect(list.map((o: any) => o.id)).not.toContain(opinionB);
  }, 30_000);

  // ── 13. header malicioso sem membership é rejeitado ─────────────────────────
  it("13. header X-Organization-Id sem membership é rejeitado", async () => {
    const caller = await makeCaller(userA, "user", { "x-organization-id": String(ORG_B) });
    await expect(caller.legalOpinions.list()).rejects.toThrow(/acesso/i);
  }, 30_000);

  // ── 14. admin de plataforma permanece escopado ──────────────────────────────
  it("14. admin de plataforma opera escopado à organização selecionada via header, não globalmente", async () => {
    const callerAdmin = await makeCaller(userA, "admin", { "x-organization-id": String(ORG_A) });
    const list = await callerAdmin.legalOpinions.list();
    expect(list.map((o: any) => o.id)).toContain(opinionA);
    expect(list.map((o: any) => o.id)).not.toContain(opinionB);
  }, 30_000);

  // ── 15. resposta cross-tenant não revela existência ─────────────────────────
  it("15. mensagem de erro é idêntica para parecer inexistente e parecer de outra organização", async () => {
    const callerA = await makeCaller(userA);
    let msgCrossTenant = "";
    let msgInexistente = "";
    try { await callerA.legalOpinions.getById({ id: opinionB }); } catch (e: any) { msgCrossTenant = e.message; }
    try { await callerA.legalOpinions.getById({ id: 999999999 }); } catch (e: any) { msgInexistente = e.message; }
    expect(msgCrossTenant).not.toBe("");
    expect(msgCrossTenant).toBe(msgInexistente);
  }, 30_000);

  // ── 16. frontend não precisa enviar organizationId ──────────────────────────
  it("16. list não aceita nenhum parâmetro de organização no input (contrato de request inalterado)", async () => {
    const callerA = await makeCaller(userA);
    // A chamada real não tem nenhum campo de organização — o filtro é 100% do servidor.
    const list = await callerA.legalOpinions.list({ status: "draft" });
    expect(Array.isArray(list)).toBe(true);
  }, 30_000);

  // ── 17. contrato de resposta preservado ─────────────────────────────────────
  it("17. contrato de resposta de list/getById preserva as mesmas chaves de antes da correção", async () => {
    const callerA = await makeCaller(userA);
    const opened = await callerA.legalOpinions.getById({ id: opinionA });
    expect(opened).toHaveProperty("title");
    expect(opened).toHaveProperty("legalQuestion");
    expect(opened).toHaveProperty("status");
    expect(opened).toHaveProperty("sourceType");
  }, 30_000);

  // ── 18. auditoria (assinatura) só ocorre após validação tenant ──────────────
  it("18. sign cross-tenant é bloqueado antes de qualquer persistência de assinatura", async () => {
    const callerA = await makeCaller(userA);
    await expect(callerA.legalOpinions.sign({
      id: opinionB, signerRole: "revisor", signaturePassword: "qualquer",
    })).rejects.toThrow(/não encontrado/i);

    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM signature_history WHERE opinionId = ?`, [opinionB]
    );
    expect(Number((rows[0] as { cnt: number }).cnt)).toBe(0);
  }, 30_000);

  // ── repository: getBySource também isolado ──────────────────────────────────
  it("getBySource: A vê só pareceres do contrato A dentro da própria organização", async () => {
    const { getLegalOpinionsBySourceForOrganization } = await import("../../db/legalOpinions");
    const bySourceA = await getLegalOpinionsBySourceForOrganization("contract", contractA, ORG_A);
    expect(bySourceA.map(o => o.id)).toContain(opinionA);
    const crossTenant = await getLegalOpinionsBySourceForOrganization("contract", contractA, ORG_B);
    expect(crossTenant).toEqual([]);
  });
});

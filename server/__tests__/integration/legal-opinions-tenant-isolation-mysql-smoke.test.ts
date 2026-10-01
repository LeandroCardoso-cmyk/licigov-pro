/**
 * RC-LEGAL-SEC-001 — Isolamento multi-tenant completo do `legalOpinionsRouter`
 * legado — smoke contra MySQL REAL. Só roda quando DATABASE_URL está definido.
 *
 * Cobre as 15 procedures do router.
 *
 * R2 / PR-03 (LEG-012; SEM-016/017): as 6 mutações (create, update, delete, generateOpinion, sign,
 * setSignaturePassword) foram desligadas de forma governada (LEGACY_ENDPOINT_DISABLED). Os testes que
 * exercitavam a escrita legítima/cross-tenant dessas mutações foram SUBSTITUÍDOS pelo contrato mais forte:
 * recusa idêntica para o próprio órgão, outro órgão e id inexistente, com ZERO alteração em `legal_opinions`,
 * `signature_history` e `users.signaturePassword` e ZERO chamada ao Cognitive Kernel. As leituras (HISTORICAL_READ)
 * continuam cobertas com o isolamento multi-tenant original.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 900301;
const ORG_B = 900302;

// A3 — generateLegalOpinion agora solicita a Cognitive Task LEGAL_ANALYSIS ao Kernel.
// Mockamos executeCognitiveTask para devolver um parecer estruturado válido (structured
// output no `response.content`), sem depender de provider/rede.
const kernelCalls = { count: 0 };
vi.mock("../../services/aiExecutionEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/aiExecutionEngine")>();
  const content = JSON.stringify({
    opinion: "# Parecer\n\nConteúdo gerado (Lei 14.133/2021, Art. 6º).",
    conclusion: "favorable",
    citedArticles: ["Art. 6º"],
    jurisprudence: [{ court: "TCU", number: "1/2026", summary: "Resumo" }],
  });
  return {
    ...actual,
    executeCognitiveTask: (async () => {
      kernelCalls.count++;
      return { response: { content } };
    }) as unknown as typeof actual.executeCognitiveTask,
  };
});

describe.skipIf(!DB)("legalOpinionsRouter legado — isolamento multi-tenant completo (MySQL real)", () => {
  let conn: mysql.Connection;
  let userA: number;
  let userB: number;
  let userNoOrg: number;
  let contractA: number;
  let contractB: number;
  let processA: number;
  let processB: number;
  let directContractA: number;
  let directContractB: number;
  let legalArticleId: number;
  let opinionA: number;
  let opinionB: number;
  let opinionProcessA: number;
  let opinionProcessB: number;
  let opinionDirectA: number;
  let opinionDirectB: number;
  let opinionACrossProcess: number;
  let opinionACrossDirect: number;

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

    // PR 0 (Security Emergency Closure): resolveTenant agora valida a organização do admin
    // de plataforma contra `organizations` (fail-closed).
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A ${ORG_A}`, `org-${ORG_A}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B ${ORG_B}`, `org-${ORG_B}`]);

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

    async function insertProcess(orgId: number, ownerId: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO processes (organizationId, name, object, ownerId) VALUES (?, 'Processo legal-iso', 'Objeto teste', ?)`,
        [orgId, ownerId]
      );
      return r.insertId;
    }
    processA = await insertProcess(ORG_A, userA);
    processB = await insertProcess(ORG_B, userB);

    const [articleResult] = await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO direct_contract_legal_articles (type, article, description, summary) VALUES ('dispensa', 'Art. 75, I', 'Descrição legal de teste', 'Resumo de teste')`
    );
    legalArticleId = articleResult.insertId;

    async function insertDirectContract(orgId: number, number_: string, createdBy: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO direct_contracts
           (organizationId, number, year, type, legalArticleId, object, justification, value, createdBy)
         VALUES (?, ?, 2026, 'dispensa', ?, 'Objeto teste', 'Justificativa de teste', 100000, ?)`,
        [orgId, number_, legalArticleId, createdBy]
      );
      return r.insertId;
    }
    directContractA = await insertDirectContract(ORG_A, "DC-LEGAL-A-001", userA);
    directContractB = await insertDirectContract(ORG_B, "DC-LEGAL-B-001", userB);

    async function insertOpinion(orgId: number, requestedBy: number, sourceType: string, sourceId: number): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO legal_opinions
           (organizationId, title, sourceType, sourceId, legalQuestion, status, requiredSignatures, requestedBy)
         VALUES (?, 'Parecer teste', ?, ?, 'Questão jurídica de teste com mais de dez caracteres', 'draft', 1, ?)`,
        [orgId, sourceType, sourceId, requestedBy]
      );
      return r.insertId;
    }
    opinionA = await insertOpinion(ORG_A, userA, "contract", contractA);
    opinionB = await insertOpinion(ORG_B, userB, "contract", contractB);
    opinionProcessA = await insertOpinion(ORG_A, userA, "process", processA);
    opinionProcessB = await insertOpinion(ORG_B, userB, "process", processB);
    opinionDirectA = await insertOpinion(ORG_A, userA, "direct_contract", directContractA);
    opinionDirectB = await insertOpinion(ORG_B, userB, "direct_contract", directContractB);

    // Pareceres que PERTENCEM à ORG_A mas referenciam fonte da ORG_B — inseridos
    // diretamente via SQL (bypass de `create`) para simular um registro legado/
    // inconsistente e testar a revalidação de fonte em profundidade dentro de
    // `generateOpinion`, independente da checagem de nível-parecer.
    opinionACrossProcess = await insertOpinion(ORG_A, userA, "process", processB);
    opinionACrossDirect = await insertOpinion(ORG_A, userA, "direct_contract", directContractB);

    // Senha de assinatura para os testes de `sign`.
    await conn.execute(`UPDATE users SET signaturePassword = ? WHERE id IN (?, ?)`, [
      "$2b$10$placeholder", userA, userB,
    ]);
  }, 60_000);

  afterAll(async () => {
    if (conn) {
      await conn.execute(`DELETE FROM signature_history WHERE opinionId IN (?, ?, ?, ?, ?, ?)`, [opinionA, opinionB, opinionProcessA, opinionProcessB, opinionDirectA, opinionDirectB]).catch(() => {});
      await conn.execute(`DELETE FROM direct_contracts WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM direct_contract_legal_articles WHERE id = ?`, [legalArticleId]).catch(() => {});
      await conn.execute(`DELETE FROM processes WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM legal_opinions WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM contracts WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
      await conn.execute(`DELETE FROM users WHERE id IN (?, ?, ?)`, [userA, userB, userNoOrg]).catch(() => {});
      await conn.end();
    }
  });

  async function makeCaller(userId: number, role: "user" | "admin" = "user", headers: Record<string, string> = {}) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role, name: `Usuário ${userId}`, email: `u${userId}@teste.local` },
      req: { headers },
      res: {},
      correlationId: "test-legal-iso",
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }

  // ── 1-2. list ────────────────────────────────────────────────────────────────
  it("1-2. list: A vê só pareceres de A, B vê só pareceres de B", async () => {
    const callerA = await makeCaller(userA);
    const callerB = await makeCaller(userB);
    const listA = await callerA.legalOpinions.list();
    const listB = await callerB.legalOpinions.list();
    expect(listA.map((o: { id: number }) => o.id)).toContain(opinionA);
    expect(listA.map((o: { id: number }) => o.id)).not.toContain(opinionB);
    expect(listB.map((o: { id: number }) => o.id)).toContain(opinionB);
    expect(listB.map((o: { id: number }) => o.id)).not.toContain(opinionA);
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

  // ── 11. export cross-tenant bloqueado ───────────────────────────────────────
  it("11. exportPDF/exportDOCX cross-tenant são bloqueados (NOT_FOUND)", async () => {
    const callerA = await makeCaller(userA);
    await expect(callerA.legalOpinions.exportPDF({ id: opinionB })).rejects.toThrow(/não encontrado/i);
    await expect(callerA.legalOpinions.exportDOCX({ id: opinionB })).rejects.toThrow(/não encontrado/i);
  }, 30_000);

  // ── 12. usuário sem organização é bloqueado (fail-closed) ───────────────────
  // RC-SEC-PR-A (SEC-017): o fallback determinístico para org=1 foi REMOVIDO.
  // Usuário sem membership não ingressa em organização alguma — recebe erro
  // estável FORBIDDEN/NO_ORGANIZATION_MEMBERSHIP e nunca vê agregação global.
  it("12. usuário sem organização é bloqueado (fail-closed), nunca cai na org 1", async () => {
    const callerNoOrg = await makeCaller(userNoOrg);
    await expect(callerNoOrg.legalOpinions.list()).rejects.toThrow(/NO_ORGANIZATION_MEMBERSHIP|acesso|organiza/i);
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
    expect(list.map((o: { id: number }) => o.id)).toContain(opinionA);
    expect(list.map((o: { id: number }) => o.id)).not.toContain(opinionB);
  }, 30_000);

  // ── 15. resposta cross-tenant não revela existência ─────────────────────────
  it("15. mensagem de erro é idêntica para parecer inexistente e parecer de outra organização", async () => {
    const callerA = await makeCaller(userA);
    let msgCrossTenant = "";
    let msgInexistente = "";
    try { await callerA.legalOpinions.getById({ id: opinionB }); } catch (e) { msgCrossTenant = e instanceof Error ? e.message : String(e); }
    try { await callerA.legalOpinions.getById({ id: 999999999 }); } catch (e) { msgInexistente = e instanceof Error ? e.message : String(e); }
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

  // ── repository: getBySource também isolado ──────────────────────────────────
  it("getBySource: A vê só pareceres do contrato A dentro da própria organização", async () => {
    const { getLegalOpinionsBySourceForOrganization } = await import("../../db/legalOpinions");
    const bySourceA = await getLegalOpinionsBySourceForOrganization("contract", contractA, ORG_A);
    expect(bySourceA.map(o => o.id)).toContain(opinionA);
    const crossTenant = await getLegalOpinionsBySourceForOrganization("contract", contractA, ORG_B);
    expect(crossTenant).toEqual([]);
  });

  // ============================================================================
  // R2 / PR-03 — MUTATION_DISABLED (LEG-012): recusa governada, idêntica e sem efeito
  // ============================================================================

  async function snapshot() {
    const [ops] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT id, organizationId, title, status, opinion, conclusion, sourceType, sourceId, updatedAt
         FROM legal_opinions WHERE organizationId IN (?, ?) ORDER BY id`, [ORG_A, ORG_B]);
    const [sigs] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM signature_history WHERE opinionId IN (SELECT id FROM legal_opinions WHERE organizationId IN (?, ?))`,
      [ORG_A, ORG_B]);
    const [pw] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT id, signaturePassword FROM users WHERE id IN (?, ?) ORDER BY id`, [userA, userB]);
    return JSON.stringify({ ops, sigs, pw });
  }

  const QUESTION = "Questão jurídica de teste com mais de dez caracteres";
  type Caller = Awaited<ReturnType<typeof makeCaller>>;
  const MUTATIONS: ReadonlyArray<[string, (c: Caller, id: number) => Promise<unknown>]> = [
    ["create (contrato)", (c) => c.legalOpinions.create({ title: "Novo", sourceType: "contract", sourceId: contractA, legalQuestion: QUESTION })],
    ["create (processo de outro órgão)", (c) => c.legalOpinions.create({ title: "Novo", sourceType: "process", sourceId: processB, legalQuestion: QUESTION })],
    ["update (aprovar)", (c, id) => c.legalOpinions.update({ id, status: "approved", reviewedBy: userA })],
    ["update (conteúdo/conclusão)", (c, id) => c.legalOpinions.update({ id, opinion: "sobrescrita", conclusion: "unfavorable" })],
    ["delete", (c, id) => c.legalOpinions.delete({ id })],
    ["generateOpinion", (c, id) => c.legalOpinions.generateOpinion({ id })],
    ["sign", (c, id) => c.legalOpinions.sign({ id, signerRole: "revisor", signaturePassword: "qualquer" })],
    ["setSignaturePassword", (c) => c.legalOpinions.setSignaturePassword({ password: "nova-senha-123" })],
  ];

  // Inclui os pareceres da ORG_A que referenciam FONTE da ORG_B (registro legado inconsistente): antes, só a
  // revalidação de fonte em generateOpinion os barrava; agora nenhuma mutação chega a resolver a fonte.
  it("PR-03: as 6 mutações legadas recusam com LEGACY_ENDPOINT_DISABLED — próprio órgão, outro órgão e inexistente", async () => {
    const callerA = await makeCaller(userA);
    const callerB = await makeCaller(userB);
    const before = await snapshot();
    const kernelBefore = kernelCalls.count;
    const messages = new Set<string>();
    for (const [label, call] of MUTATIONS) {
      for (const [caller, id] of [[callerA, opinionA], [callerA, opinionB], [callerB, opinionA], [callerA, opinionACrossProcess], [callerA, opinionACrossDirect], [callerA, 999999999]] as const) {
        let err: unknown = null;
        try { await call(caller, id); } catch (e) { err = e; }
        expect(err, `${label} (id ${id}) deveria recusar`).toBeInstanceOf(Error);
        expect((err as { code?: string }).code, label).toBe("FORBIDDEN");
        expect((err as Error).message, label).toMatch(/LEGACY_ENDPOINT_DISABLED/);
        expect((err as Error).message, label).toMatch(/\/parecer/);
        messages.add(`${label.split(" ")[0]}:${(err as Error).message}`);
      }
    }
    // mesma mensagem por procedure, qualquer que seja o órgão/id (anti-enumeração)
    expect(messages.size).toBe(6);
    expect(await snapshot()).toBe(before);
    expect(kernelCalls.count).toBe(kernelBefore);
  }, 60_000);

  it("PR-03: parecer assinado/aprovado não é editado, excluído, re-gerado nem re-assinado pela API legada", async () => {
    await conn.execute(`UPDATE legal_opinions SET status = 'approved', opinion = 'Conteúdo aprovado', conclusion = 'favorable' WHERE id = ?`, [opinionProcessA]);
    const callerA = await makeCaller(userA);
    const before = await snapshot();
    await expect(callerA.legalOpinions.update({ id: opinionProcessA, opinion: "IA sobrescreve", conclusion: "unfavorable" })).rejects.toThrow(/LEGACY_ENDPOINT_DISABLED/);
    await expect(callerA.legalOpinions.generateOpinion({ id: opinionProcessA })).rejects.toThrow(/LEGACY_ENDPOINT_DISABLED/);
    await expect(callerA.legalOpinions.delete({ id: opinionProcessA })).rejects.toThrow(/LEGACY_ENDPOINT_DISABLED/);
    await expect(callerA.legalOpinions.sign({ id: opinionProcessA, signerRole: "gestor", signaturePassword: "x" })).rejects.toThrow(/LEGACY_ENDPOINT_DISABLED/);
    expect(await snapshot()).toBe(before);
    // HISTORICAL_READ: o conteúdo aprovado continua legível no próprio órgão
    const opened = await callerA.legalOpinions.getById({ id: opinionProcessA });
    expect(opened.opinion).toBe("Conteúdo aprovado");
    expect(opened.status).toBe("approved");
  }, 30_000);

  it("PR-03: leituras históricas seguem tenant-scoped (getSignatureHistory/verifySignature/hasSignaturePassword)", async () => {
    const callerA = await makeCaller(userA);
    expect(await callerA.legalOpinions.getSignatureHistory({ id: opinionA })).toEqual([]);
    expect(await callerA.legalOpinions.getSignatureHistory({ id: opinionB })).toEqual([]);
    expect(await callerA.legalOpinions.verifySignature({ id: opinionB })).toEqual({ signed: false, valid: false });
    expect(typeof (await callerA.legalOpinions.hasSignaturePassword())).toBe("boolean");
  }, 30_000);

  // ── repository: novas funções org-scoped de processo/contratação direta ─────
  it("getProcessByIdForOrganization / getDirectContractByIdForOrganization: isolamento direto no repository", async () => {
    const { getProcessByIdForOrganization } = await import("../../db/processes");
    const { getDirectContractByIdForOrganization } = await import("../../db/directContracts");

    expect(await getProcessByIdForOrganization(processA, ORG_A)).toBeDefined();
    expect(await getProcessByIdForOrganization(processB, ORG_A)).toBeUndefined();

    expect(await getDirectContractByIdForOrganization(directContractA, ORG_A)).not.toBeNull();
    expect(await getDirectContractByIdForOrganization(directContractB, ORG_A)).toBeNull();
  });
});

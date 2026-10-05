/**
 * SP2-D — smoke MySQL REAL (SEM-034/046/078/079/086/088). Só roda com DATABASE_URL. Fixture própria (duas organizações
 * reais em `organizations`), re-executável; o afterAll remove só o que criou.
 *
 *  - SEM-086: `downloads.*` / `platforms.<por processo>` exigem MEMBERSHIP ATIVA no tenant do contexto E autoria:
 *    membro removido, dono de outro tenant e membro não-autor recebem o MESMO erro e nada é gravado.
 *  - SEM-046: relatório de atividades traz `userName`/`description` reais, só da organização do contexto, e os logs de
 *    download levam o `organizationId` do contexto.
 *  - SEM-078/079: `createDocument` legado é fail-closed (organizationId + processo da mesma organização); documento
 *    APROVADO não é alterado por `updateDocumento`/`publishDraft`/`restoreToVersion` (zero escrita).
 *  - SEM-034: helpers `…ForOrganization` de itens/sugestões CATMAT não escrevem por id de OUTRO tenant.
 *  - SEM-088: a varredura lê o banco de verdade (deltas exatos sobre linhas semeadas) e não escreve nada.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;

describe.skipIf(!DB)("SP2-D — legado/misc (MySQL real)", { timeout: 90_000 }, () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  let orgA = 0;
  let orgB = 0;
  let ownerA = 0;
  let removedA = 0; // dono de processo em A, membership revogada
  let memberA = 0; // membro ativo de A, NÃO é o autor
  let ownerB = 0;
  let procA = 0; // autor ownerA
  let procRemoved = 0; // autor removedA
  let procB = 0;
  let itemA = 0;
  let suggestionA = 0;
  let approvedDoc = 0;
  const tracked = { users: [] as number[], processes: [] as number[], orgs: [] as number[] };

  async function exec(sql: string, p: unknown[] = []) {
    const [r] = await conn.execute<mysql.ResultSetHeader>(sql, p as never);
    return r;
  }
  async function rows(sql: string, p: unknown[] = []) {
    const [r] = await conn.query<mysql.RowDataPacket[]>(sql, p as never);
    return r;
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    const org = async (tag: string) => {
      const r = await exec(`INSERT INTO organizations (nome, slug) VALUES (?, ?)`, [`Org ${tag}`, `sp2d-${tag}-${stamp}`]);
      tracked.orgs.push(r.insertId);
      return r.insertId;
    };
    orgA = await org("a");
    orgB = await org("b");
    const user = async (tag: string) => {
      const r = await exec(`INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`, [`sp2d-${tag}-${stamp}`, `Usuário ${tag}`, `sp2d-${tag}-${stamp}@teste.local`]);
      tracked.users.push(r.insertId);
      return r.insertId;
    };
    ownerA = await user("ownerA");
    removedA = await user("removedA");
    memberA = await user("memberA");
    ownerB = await user("ownerB");
    const member = (o: number, u: number, role: string, ativo: number) =>
      exec(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, ?)`, [o, u, role, ativo]);
    await member(orgA, ownerA, "owner", 1);
    await member(orgA, removedA, "owner", 0);
    await member(orgA, memberA, "operator", 1);
    await member(orgB, ownerB, "owner", 1);
    const proc = async (o: number, owner: number, name: string) => {
      const r = await exec(`INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (?, ?, 'Objeto', ?, 'em_etp')`, [o, name, owner]);
      tracked.processes.push(r.insertId);
      return r.insertId;
    };
    procA = await proc(orgA, ownerA, "Processo A");
    procRemoved = await proc(orgA, removedA, "Processo do removido");
    procB = await proc(orgB, ownerB, "Processo B");
    const item = await exec(`INSERT INTO process_items (processId, itemType, description, unit, quantity) VALUES (?, 'material', 'Descrição HUMANA do item', 'UN', 3)`, [procA]);
    itemA = item.insertId;
    const sug = await exec(
      `INSERT INTO catmat_suggestions (processItemId, catmatCode, description, confidenceScore, reasoning, status) VALUES (?, '424242', 'Descrição da IA', 90, 'x', 'pending')`,
      [itemA],
    );
    suggestionA = sug.insertId;
    const doc = await exec(
      `INSERT INTO documents (organizationId, processId, type, content, sourceType, version, createdBy, documentStatus) VALUES (?, ?, 'etp', 'CONTEUDO APROVADO', 'ai', 1, ?, 'approved')`,
      [orgA, procA, ownerA],
    );
    approvedDoc = doc.insertId;
  }, 60_000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.query(sql, p as never).catch(() => {}); };
    await del(`DELETE FROM activity_logs WHERE userId IN (?)`, [tracked.users]);
    await del(`DELETE FROM document_drafts WHERE documentId = ?`, [approvedDoc]);
    await del(`DELETE FROM document_versions WHERE documentId = ?`, [approvedDoc]);
    await del(`DELETE FROM catmat_suggestions WHERE processItemId = ?`, [itemA]);
    await del(`DELETE FROM process_items WHERE processId IN (?)`, [tracked.processes]);
    await del(`DELETE FROM documents WHERE processId IN (?)`, [tracked.processes]);
    await del(`DELETE FROM processes WHERE id IN (?)`, [tracked.processes]);
    await del(`DELETE FROM organization_members WHERE userId IN (?)`, [tracked.users]);
    await del(`DELETE FROM users WHERE id IN (?)`, [tracked.users]);
    await del(`DELETE FROM organizations WHERE id IN (?)`, [tracked.orgs]);
    await conn.end();
  });

  async function makeCaller(userId: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Usuário ${userId}`, email: `u${userId}@teste.local` },
      req: { headers: { "x-organization-id": undefined }, ip: "203.0.113.9" },
      res: {},
      correlationId: "sp2d-corr",
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  async function errOf(p: () => Promise<unknown>): Promise<{ code?: string; message?: string }> {
    try { await p(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message }; }
    return { code: "RESOLVED", message: "" };
  }
  const logCount = async (processId: number) =>
    Number((await rows(`SELECT COUNT(*) AS n FROM activity_logs WHERE processId = ?`, [processId]))[0].n);

  // ─── SEM-086 ──────────────────────────────────────────────────────────────
  it("SEM-086: membro REMOVIDO do órgão não exporta mais o pacote do processo que criou; nada é gravado", async () => {
    const removed = await makeCaller(removedA);
    const before = await logCount(procRemoved);
    for (const [name, fn] of [
      ["downloads.itemsSpreadsheet", () => removed.downloads.itemsSpreadsheet({ processId: procRemoved })],
      ["downloads.publicationPackage", () => removed.downloads.publicationPackage({ processId: procRemoved })],
      ["downloads.processReport", () => removed.downloads.processReport({ processId: procRemoved })],
      ["platforms.generatePublicationPackage", () => removed.platforms.generatePublicationPackage({ processId: procRemoved })],
      ["platforms.getPublications", () => removed.platforms.getPublications({ processId: procRemoved })],
    ] as const) {
      const err = await errOf(fn);
      expect(err.code, name).toBe("FORBIDDEN");
      expect(err.message, name).toContain("NO_ORGANIZATION_MEMBERSHIP");
    }
    expect(await logCount(procRemoved)).toBe(before);
  });

  it("SEM-086: dono de OUTRO tenant e membro NÃO-autor recebem o MESMO erro do processo inexistente; zero log", async () => {
    const before = await logCount(procA);
    const callers = [await makeCaller(ownerB), await makeCaller(memberA)];
    const errs: Array<{ code?: string; message?: string }> = [];
    for (const c of callers) {
      errs.push(await errOf(() => c.downloads.itemsSpreadsheet({ processId: procA })));
      errs.push(await errOf(() => c.platforms.generatePublicationPackage({ processId: procA })));
      errs.push(await errOf(() => c.platforms.updateProcessPlatform({ processId: procA, platformId: null })));
    }
    const ghost = await errOf(() => (callers[1]).downloads.itemsSpreadsheet({ processId: 999_999_991 }));
    for (const e of errs) expect(e).toEqual(ghost);
    expect(ghost.code).toBe("NOT_FOUND");
    expect(await logCount(procA)).toBe(before);
  });

  it("SEM-086: o autor com membership ativa continua funcionando (pacote) e o log de download leva o organizationId do contexto (SEM-046)", async () => {
    const owner = await makeCaller(ownerA);
    const pkg = await owner.platforms.generatePublicationPackage({ processId: procA });
    expect(pkg.process.id).toBe(procA);
    await owner.downloads.itemsSpreadsheet({ processId: procA });
    const logs = await rows(`SELECT organizationId, userId, action FROM activity_logs WHERE processId = ? AND action = 'baixou planilha de itens'`, [procA]);
    expect(logs).toHaveLength(1);
    expect(Number(logs[0].organizationId)).toBe(orgA);
    expect(Number(logs[0].userId)).toBe(ownerA);
  });

  // ─── SEM-046 ──────────────────────────────────────────────────────────────
  it("SEM-046: relatório de atividades — ator e descrição reais, só da organização do contexto", async () => {
    await exec(`DELETE FROM activity_logs WHERE userId IN (?)`.replace("(?)", `(${tracked.users.join(",")})`));
    const ins = (o: number | null, proc: number | null, user: number, action: string, details: string | null, actorName: string | null) =>
      exec(`INSERT INTO activity_logs (organizationId, processId, userId, action, details, actorName) VALUES (?, ?, ?, ?, ?, ?)`, [o, proc, user, action, details, actorName]);
    await ins(orgA, procA, ownerA, "log-snapshot", "texto simples", "Nome Snapshot");
    await ins(orgA, null, memberA, "log-org-level", JSON.stringify({ filename: "x.zip", n: 2 }), null); // sem processo, nome vem de users
    await ins(null, procA, ownerA, "log-legado-sem-org", null, null); // legado: NULL org, processo de A
    await ins(orgB, procA, ownerB, "log-org-diferente-no-processo-de-A", "NAO DEVE APARECER", null); // org B apontando p/ processo de A
    await ins(orgB, procB, ownerB, "log-de-B", "NAO DEVE APARECER", null);

    const rowsA = await (await makeCaller(ownerA)).processes.getActivityLogs();
    const byAction = Object.fromEntries(rowsA.map((r: { action: string }) => [r.action, r]));
    expect(Object.keys(byAction).sort()).toEqual(["log-legado-sem-org", "log-org-level", "log-snapshot"]);
    expect(byAction["log-snapshot"]).toMatchObject({ userName: "Nome Snapshot", description: "texto simples" });
    expect(byAction["log-org-level"]).toMatchObject({ userName: "Usuário memberA", description: "filename: x.zip; n: 2" });
    expect(byAction["log-legado-sem-org"]).toMatchObject({ userName: "Usuário ownerA", description: null });
    expect(JSON.stringify(rowsA)).not.toContain("NAO DEVE APARECER");

    const rowsB = await (await makeCaller(ownerB)).processes.getActivityLogs();
    expect(rowsB.map((r: { action: string }) => r.action).sort()).toEqual(["log-de-B", "log-org-diferente-no-processo-de-A"]);
  });

  // ─── SEM-078 / SEM-079 ────────────────────────────────────────────────────
  it("SEM-079: createDocument legado é fail-closed — sem organizationId ou com processo de outro tenant ⇒ erro e ZERO linha", async () => {
    const { createDocument } = await import("../../db/processes");
    const count = async () => Number((await rows(`SELECT COUNT(*) AS n FROM documents WHERE processId IN (?)`, [tracked.processes]))[0].n);
    const before = await count();
    const base = { processId: procA, type: "dfd" as const, content: "x", createdBy: ownerA };
    await expect(createDocument({ ...base } as never)).rejects.toThrow(/LEGACY_DOCUMENT_ORGANIZATION_REQUIRED/);
    await expect(createDocument({ ...base, organizationId: null } as never)).rejects.toThrow(/LEGACY_DOCUMENT_ORGANIZATION_REQUIRED/);
    await expect(createDocument({ ...base, organizationId: 0 })).rejects.toThrow(/LEGACY_DOCUMENT_ORGANIZATION_REQUIRED/);
    await expect(createDocument({ ...base, organizationId: orgB })).rejects.toThrow(/LEGACY_DOCUMENT_PROCESS_ORGANIZATION_MISMATCH/);
    expect(await count()).toBe(before);
    await createDocument({ ...base, organizationId: orgA });
    expect(await count()).toBe(before + 1);
    const [row] = await rows(`SELECT organizationId FROM documents WHERE processId = ? AND type = 'dfd' ORDER BY id DESC LIMIT 1`, [procA]);
    expect(Number(row.organizationId)).toBe(orgA);
  });

  it("SEM-078: documento APROVADO não muda por updateDocumento/publishDraft/restoreToVersion (zero escrita, zero versão)", async () => {
    const { updateDocumento } = await import("../../services/documentService");
    const { publishDraft } = await import("../../services/documentDraftService");
    const { restoreToVersion } = await import("../../services/documentVersionService");
    await exec(
      `INSERT INTO document_drafts (organizationId, documentId, userId, contentDraft, expiresAt) VALUES (?, ?, ?, 'RASCUNHO NOVO', DATE_ADD(NOW(), INTERVAL 1 DAY))`,
      [orgA, approvedDoc, ownerA],
    );
    const ctx = { organizationId: orgA, user: { id: ownerA, name: "Owner", email: "o@x" }, correlationId: "c", requestId: "r", orgMembership: { role: "owner" as const } };
    const snap = async () => ({
      doc: (await rows(`SELECT content, version, documentStatus, updatedBy FROM documents WHERE id = ?`, [approvedDoc]))[0],
      versions: Number((await rows(`SELECT COUNT(*) AS n FROM document_versions WHERE documentId = ?`, [approvedDoc]))[0].n),
      drafts: Number((await rows(`SELECT COUNT(*) AS n FROM document_drafts WHERE documentId = ?`, [approvedDoc]))[0].n),
    });
    const before = await snap();
    const errs = await Promise.all([
      errOf(() => updateDocumento(approvedDoc, { content: "ALTERADO" }, 1, ctx)),
      errOf(() => publishDraft(approvedDoc, ownerA, 1, null, ctx)),
      errOf(() => restoreToVersion(approvedDoc, 1, ctx)),
    ]);
    for (const e of errs) {
      expect(e.code).toBe("PRECONDITION_FAILED");
      expect(e.message).toContain("DOCUMENT_APPROVED_IMMUTABLE");
    }
    expect(await snap()).toEqual(before);
    expect(before.doc).toMatchObject({ content: "CONTEUDO APROVADO", documentStatus: "approved" });
  });

  // ─── SEM-034 ──────────────────────────────────────────────────────────────
  it("SEM-034: helpers ForOrganization não aplicam código/sugestão/descrição por id de OUTRO tenant (zero escrita)", async () => {
    const items = await import("../../db/processItems");
    const snap = async () => ({
      item: (await rows(`SELECT * FROM process_items WHERE id = ?`, [itemA]))[0],
      sug: (await rows(`SELECT * FROM catmat_suggestions WHERE id = ?`, [suggestionA]))[0],
    });
    const before = await snap();
    expect(await items.updateProcessItemForOrganization(itemA, orgB, { description: "Descrição da IA", catmatCode: 424242 })).toBe(false);
    expect(await items.deleteProcessItemForOrganization(itemA, orgB)).toBe(false);
    expect(await items.updateCatmatSuggestionForOrganization(suggestionA, orgB, { status: "approved" })).toBe(false);
    expect(await items.rejectOtherSuggestionsForOrganization(itemA, suggestionA, orgB)).toBe(false);
    expect(await items.createCatmatSuggestionForOrganization({ processItemId: itemA, catmatCode: "1", description: "x", confidenceScore: 1, reasoning: "x" }, orgB)).toBeNull();
    expect(await items.saveProcessItemsForOrganization(procA, orgB, [{ itemType: "material", description: "x", unit: "UN" }])).toBe(false);
    expect(await snap()).toEqual(before);
    // escritores não-escopados não são mais exportáveis
    for (const fn of ["saveProcessItems", "updateProcessItem", "deleteProcessItem", "createCatmatSuggestion", "updateCatmatSuggestion", "rejectOtherSuggestions"]) {
      expect((items as Record<string, unknown>)[fn], fn).toBeUndefined();
    }
  });

  // ─── SEM-088 ──────────────────────────────────────────────────────────────
  it("SEM-088: a varredura lê o BANCO (deltas exatos) e não escreve nada", async () => {
    const { sweepTenantScopedTables } = await import("../../services/tenantIsolationSweepService");
    const base = await sweepTenantScopedTables();
    expect(base.coverage).toBe("database_sweep");
    expect(base.available).toBe(true);
    expect(base.tablesCovered).toEqual(expect.arrayContaining(["processes", "documents", "activity_logs"]));
    const t = (r: typeof base, n: string) => r.tables.find((x) => x.table === n)!;

    // semeia: processo NULL-org, processo com org inexistente, documento com org DIVERGENTE da do processo
    const nullProc = await exec(`INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (NULL, 'sweep-null', 'o', ?, 'em_dfd')`, [ownerA]);
    const danglingProc = await exec(`INSERT INTO processes (organizationId, name, object, ownerId, status) VALUES (987654321, 'sweep-dangling', 'o', ?, 'em_dfd')`, [ownerA]);
    tracked.processes.push(nullProc.insertId, danglingProc.insertId);
    await exec(`INSERT INTO documents (organizationId, processId, type, content, sourceType, version, createdBy, documentStatus) VALUES (?, ?, 'dfd', 'x', 'ai', 1, ?, 'draft')`, [orgB, procA, ownerA]);

    const counts = async () => ({
      p: Number((await rows(`SELECT COUNT(*) AS n FROM processes`))[0].n),
      d: Number((await rows(`SELECT COUNT(*) AS n FROM documents`))[0].n),
    });
    const beforeSweep = await counts();
    const after = await sweepTenantScopedTables();
    expect(await counts()).toEqual(beforeSweep); // somente leitura
    expect(t(after, "processes").nullOrganization - t(base, "processes").nullOrganization).toBe(1);
    expect(t(after, "processes").danglingOrganization - t(base, "processes").danglingOrganization).toBe(1);
    expect((t(after, "documents").parentMismatch ?? 0) - (t(base, "documents").parentMismatch ?? 0)).toBe(1);
    expect(after.healthy).toBe(false); // há cross-tenant crítico
    expect(after.findings.some((f) => f.type === "cross_tenant" && f.severity === "critical" && f.affectedEntity === "documents")).toBe(true);
  });

  it("SEM-088: sem banco ⇒ fail-closed (available=false, healthy=false), nunca 'saudável por ausência de dados'", async () => {
    const { sweepTenantScopedTables } = await import("../../services/tenantIsolationSweepService");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = await sweepTenantScopedTables({ db: null });
    expect(r).toMatchObject({ coverage: "database_sweep", available: false, healthy: false, tables: [] });
  });
});

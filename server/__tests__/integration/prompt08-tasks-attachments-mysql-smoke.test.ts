/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PROMPT 08 / D-1 + D-3 — tarefas do departamento e anexos contra MySQL REAL (descartável), router real, tenant SINTÉTICO.
 * Só roda com DATABASE_URL. Storage simulado em memória (mecanismo; não é homologação do S3 real).
 *
 *  D-1  criação com prazo (data local) / sem prazo / prazo inválido (erro controlado, sem registro) / RBAC / tenant / persistência
 *  D-3  upload guarda a CHAVE (não URL pública); listagem não expõe URL; download só por URL ASSINADA de curta duração após
 *       autorização; anexo legado com URL pública resolve a chave da PRÓPRIA tarefa; nunca assina/apaga objeto de outro recurso;
 *       remoção consistente (falha do S3 mantém o registro e audita; replay seguro); exclusão da tarefa remove os objetos.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const STORED = new Map<string, Buffer>();
const SIGNED: Array<{ key: string; ttl: number }> = [];
const DELETED: string[] = [];
let failNextDelete = false;
vi.mock("../../storage", async (orig) => ({
  ...(await orig<typeof import("../../storage")>()),
  assertStorageUsable: () => undefined,
  storagePut: async (key: string, data: Buffer | Uint8Array | string) => { STORED.set(key, Buffer.from(data as any)); return { key, url: `https://bucket.s3.sa-east-1.amazonaws.com/${key}` }; },
  storageSignedUrl: async (key: string, ttl = 3600) => { SIGNED.push({ key, ttl }); return { key, url: `https://signed.example/${key}?X-Amz-Expires=${ttl}` }; },
  storageDelete: async (key: string) => {
    if (failNextDelete) { failNextDelete = false; throw Object.assign(new Error("S3 indisponível (simulado)"), { name: "ServiceUnavailable" }); }
    DELETED.push(key); STORED.delete(key); return { key, deleted: true };
  },
  // PROMPT 09 — o download confere a existência do objeto antes de assinar.
  storageExists: async (key: string) => STORED.has(key),
}));

const DB = process.env.DATABASE_URL;
const ORG = 996811;
const ORG_B = 996812;
const RUN = Date.now();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe.skipIf(!DB)("PROMPT 08 — tarefas e anexos (MySQL real)", { timeout: 60_000 }, () => {
  let conn: mysql.Connection;
  const U: Record<string, number> = {};
  const q = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> => ((await conn.execute(sql, p))[0]) as T[];
  const caller = async (userId: number, org = ORG) => {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `U${userId}`, email: `p08-${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {}, correlationId: `p08-${userId}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  };
  const err = async (p: Promise<unknown>) => { try { await p; return null; } catch (e: any) { return { code: e?.code as string, message: String(e?.message ?? "") }; } };

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    for (const [id, tag] of [[ORG, "a"], [ORG_B, "b"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)", [id, `Org sintética P08 ${tag} ${RUN}`, `p08-${tag}-${RUN}`]);
    }
    for (const [tag, org, role] of [["operator", ORG, "operator"], ["viewer", ORG, "viewer"], ["colleague", ORG, "operator"], ["operatorB", ORG_B, "operator"]] as const) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')", [`p08-${tag}-${RUN}`, `U ${tag}`, `p08-${tag}-${RUN}@teste.local`]);
      U[tag] = r.insertId;
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, U[tag], role]);
    }
  });

  afterAll(async () => {
    if (!conn) return;
    const del = async (s: string, p: unknown[]) => { await conn.execute(s, p).catch(() => {}); };
    await del("DELETE ta FROM task_attachments ta JOIN tasks t ON t.id = ta.taskId WHERE t.organizationId IN (?, ?)", [ORG, ORG_B]);
    await del("DELETE FROM tasks WHERE organizationId IN (?, ?)", [ORG, ORG_B]);
    await del("DELETE FROM activity_logs WHERE organizationId IN (?, ?)", [ORG, ORG_B]);
    await del("DELETE FROM organization_members WHERE organizationId IN (?, ?)", [ORG, ORG_B]);
    const ids = Object.values(U);
    if (ids.length) await del(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
    await del("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]);
    await conn.end();
  });

  const count = async (org = ORG) => Number((await q<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE organizationId = ?", [org]))[0].n);

  describe("D-1 — criação de tarefas", () => {
    it("prazo como data local (AAAA-MM-DD) ⇒ persiste no fim do dia de Brasília; aparece na listagem", async () => {
      const op = await caller(U.operator);
      const { taskId } = await op.departmentTasks.create({ title: "Conferir documentação (sintético)", deadline: "2026-12-10", priority: "alta" });
      expect(taskId).toBeGreaterThan(0);
      const row = (await q("SELECT deadline, assignedTo, createdBy, status FROM tasks WHERE id = ?", [taskId]))[0];
      expect(new Date(row.deadline).toISOString()).toBe("2026-12-11T02:59:59.000Z");
      expect(row).toMatchObject({ assignedTo: U.operator, createdBy: U.operator, status: "pendente" });
      const list = await op.departmentTasks.list();
      expect(list.some((t: any) => t.id === taskId)).toBe(true);
    });

    it("Date (superjson) e ausência de prazo funcionam; coluna do Kanban define o status inicial", async () => {
      const op = await caller(U.operator);
      const withDate = await op.departmentTasks.create({ title: "Com Date", deadline: new Date("2026-12-20T15:00:00.000Z") });
      const noDeadline = await op.departmentTasks.create({ title: "Sem prazo", status: "em_andamento" });
      expect((await q("SELECT deadline FROM tasks WHERE id = ?", [withDate.taskId]))[0].deadline).toBeTruthy();
      expect((await q("SELECT deadline, status FROM tasks WHERE id = ?", [noDeadline.taskId]))[0]).toMatchObject({ deadline: null, status: "em_andamento" });
    });

    it("prazo inválido ⇒ BAD_REQUEST controlado (não 500) e nenhum registro parcial", async () => {
      const op = await caller(U.operator);
      const before = await count();
      for (const deadline of ["2026-02-30", "amanhã", "1999-12-31", "2026-13-01"]) {
        const e = await err(op.departmentTasks.create({ title: "Inválida", deadline }));
        expect(e?.code).toBe("BAD_REQUEST");
        expect(e?.message).toMatch(/Prazo inválido/);
      }
      expect(await count()).toBe(before);
    });

    it("RBAC e tenant: viewer não cria; responsável de outro órgão recusado; outro órgão não vê a tarefa", async () => {
      expect((await err((await caller(U.viewer)).departmentTasks.create({ title: "Viewer" })))?.code).toBe("FORBIDDEN");
      expect((await err((await caller(U.operator)).departmentTasks.create({ title: "Resp. externo", assignedTo: U.operatorB })))?.code).toBe("BAD_REQUEST");
      const ok = await (await caller(U.operator)).departmentTasks.create({ title: "Atribuída a colega", assignedTo: U.colleague });
      expect((await q("SELECT assignedTo FROM tasks WHERE id = ?", [ok.taskId]))[0].assignedTo).toBe(U.colleague);
      const listB = await (await caller(U.operatorB, ORG_B)).departmentTasks.list();
      expect(listB.some((t: any) => t.id === ok.taskId)).toBe(false);
      // update com prazo inválido também é controlado
      expect((await err((await caller(U.operator)).departmentTasks.update({ id: ok.taskId, deadline: "xx" })))?.code).toBe("BAD_REQUEST");
      await (await caller(U.operator)).departmentTasks.update({ id: ok.taskId, deadline: "2026-12-31" });
      expect(new Date((await q("SELECT deadline FROM tasks WHERE id = ?", [ok.taskId]))[0].deadline).toISOString()).toBe("2027-01-01T02:59:59.000Z");
    });
  });

  describe("D-3 — anexos (bucket privado)", () => {
    let taskId = 0;
    let attId = 0;
    let key = "";

    it("upload guarda a CHAVE; listagem não expõe URL; download só por URL assinada (TTL curto) após autorização", async () => {
      const op = await caller(U.operator);
      taskId = (await op.departmentTasks.create({ title: "Com anexo" })).taskId;
      const up = await op.departmentTasks.addAttachment({ taskId, fileName: "evidencia.png", fileBase64: PNG.toString("base64"), mimeType: "image/png" });
      attId = up.id as number;
      const row = (await q("SELECT fileUrl FROM task_attachments WHERE id = ?", [attId]))[0];
      expect(row.fileUrl).toMatch(new RegExp(`^tasks/${taskId}/\\d+_[0-9a-f]{8}_evidencia\\.png$`)); // PROMPT 09: sufixo aleatório
      key = row.fileUrl;
      const list = await (await caller(U.viewer)).departmentTasks.listAttachments({ taskId });
      expect(list[0]).toMatchObject({ id: attId, downloadable: true });
      expect(JSON.stringify(list)).not.toMatch(/amazonaws|fileUrl/);
      const dl = await (await caller(U.viewer)).departmentTasks.getAttachmentDownloadUrl({ attachmentId: attId });
      expect(dl.expiresInSeconds).toBe(300);
      expect(SIGNED.at(-1)).toEqual({ key, ttl: 300 });
      expect((await err((await caller(U.operatorB, ORG_B)).departmentTasks.getAttachmentDownloadUrl({ attachmentId: attId })))?.code).toBe("NOT_FOUND");
    });

    it("anexo LEGADO com URL pública resolve a chave da própria tarefa; chave de OUTRO recurso nunca é assinada", async () => {
      const legacyKey = `tasks/${taskId}/123_antigo.pdf`;
      STORED.set(legacyKey, Buffer.from("%PDF-1.4"));
      const [l] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO task_attachments (taskId, fileName, fileUrl, fileSize, uploadedBy) VALUES (?, 'antigo.pdf', ?, 10, ?)",
        [taskId, `https://bucket.s3.sa-east-1.amazonaws.com/${legacyKey}`, U.operator]);
      await (await caller(U.operator)).departmentTasks.getAttachmentDownloadUrl({ attachmentId: l.insertId });
      expect(SIGNED.at(-1)?.key).toBe(legacyKey);
      const [foreign] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO task_attachments (taskId, fileName, fileUrl, fileSize, uploadedBy) VALUES (?, 'alheio.pdf', ?, 10, ?)",
        [taskId, "https://bucket.s3.sa-east-1.amazonaws.com/tasks/999999/1_alheio.pdf", U.operator]);
      expect((await err((await caller(U.operator)).departmentTasks.getAttachmentDownloadUrl({ attachmentId: foreign.insertId })))?.code).toBe("PRECONDITION_FAILED");
      // Remoção do registro alheio: o objeto de OUTRO recurso NÃO é apagado; o registro sai e a decisão fica auditada.
      const deletedBefore = DELETED.length;
      await (await caller(U.operator)).departmentTasks.deleteAttachment({ id: foreign.insertId });
      expect(DELETED.length).toBe(deletedBefore);
      expect((await q("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND action = 'task.attachment_deleted' AND details LIKE '%storage_key_unresolved%'", [ORG]))[0].n).toBe(1);
    });

    it("remoção: falha do S3 mantém o registro e audita; nova tentativa remove objeto e registro; replay seguro", async () => {
      const op = await caller(U.operator);
      failNextDelete = true;
      const e = await err(op.departmentTasks.deleteAttachment({ id: attId }));
      expect(e?.code).toBe("INTERNAL_SERVER_ERROR");
      expect((await q("SELECT COUNT(*) n FROM task_attachments WHERE id = ?", [attId]))[0].n).toBe(1);
      expect(STORED.has(key)).toBe(true);
      expect((await q("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND action = 'task.attachment_delete_failed'", [ORG]))[0].n).toBe(1);
      expect((await err((await caller(U.viewer)).departmentTasks.deleteAttachment({ id: attId })))?.code).toBe("FORBIDDEN");
      expect((await err((await caller(U.operatorB, ORG_B)).departmentTasks.deleteAttachment({ id: attId })))?.code).toBe("NOT_FOUND");
      await op.departmentTasks.deleteAttachment({ id: attId });
      expect(STORED.has(key)).toBe(false);
      expect((await q("SELECT COUNT(*) n FROM task_attachments WHERE id = ?", [attId]))[0].n).toBe(0);
      expect((await err(op.departmentTasks.deleteAttachment({ id: attId })))?.code).toBe("NOT_FOUND");
    });

    it("exclusão da tarefa remove os objetos dos anexos (só chaves da própria tarefa)", async () => {
      const op = await caller(U.operator);
      const t = (await op.departmentTasks.create({ title: "Tarefa a excluir" })).taskId;
      await op.departmentTasks.addAttachment({ taskId: t, fileName: "a.png", fileBase64: PNG.toString("base64"), mimeType: "image/png" });
      const k = (await q("SELECT fileUrl FROM task_attachments WHERE taskId = ?", [t]))[0].fileUrl;
      failNextDelete = true;
      expect((await err(op.departmentTasks.delete({ id: t })))?.code).toBe("INTERNAL_SERVER_ERROR");
      expect((await q("SELECT COUNT(*) n FROM tasks WHERE id = ?", [t]))[0].n).toBe(1);
      await op.departmentTasks.delete({ id: t });
      expect(STORED.has(k)).toBe(false);
      expect((await q("SELECT COUNT(*) n FROM tasks WHERE id = ?", [t]))[0].n).toBe(0);
    });

    // ─── PROMPT 09 / Frente D ─────────────────────────────────────────────────────────────────────────────────────────
    it("registro apontando para objeto INDISPONÍVEL ⇒ NOT_FOUND claro no download (nenhuma URL assinada para objeto ausente)", async () => {
      const op = await caller(U.operator);
      const t = (await op.departmentTasks.create({ title: "Objeto ausente" })).taskId;
      const up = await op.departmentTasks.addAttachment({ taskId: t, fileName: "x.png", fileBase64: PNG.toString("base64"), mimeType: "image/png" });
      const k = (await q("SELECT fileUrl FROM task_attachments WHERE id = ?", [up.id]))[0].fileUrl;
      STORED.delete(k); // objeto removido fora do fluxo (ex.: retenção/limpeza do bucket)
      const signedBefore = SIGNED.length;
      const e = await err(op.departmentTasks.getAttachmentDownloadUrl({ attachmentId: up.id as number }));
      expect(e).toMatchObject({ code: "NOT_FOUND", message: expect.stringContaining("não está mais disponível") });
      expect(SIGNED.length).toBe(signedBefore);
    });

    it("upload CONCORRENTE com a exclusão da tarefa: nunca sobra registro pendurado nem objeto sem tratamento", async () => {
      const op = await caller(U.operator);
      for (let i = 0; i < 6; i++) {
        const t = (await op.departmentTasks.create({ title: `Corrida ${i}` })).taskId;
        await op.departmentTasks.addAttachment({ taskId: t, fileName: "base.png", fileBase64: PNG.toString("base64"), mimeType: "image/png" });
        const [up, del] = await Promise.allSettled([
          (await caller(U.colleague)).departmentTasks.addAttachment({ taskId: t, fileName: "novo.png", fileBase64: PNG.toString("base64"), mimeType: "image/png" }),
          op.departmentTasks.delete({ id: t }),
        ]);
        expect(del.status).toBe("fulfilled");
        if (up.status === "rejected") expect((up.reason as { code?: string }).code).toBe("NOT_FOUND"); // tarefa já excluída
        expect((await q("SELECT COUNT(*) n FROM tasks WHERE id = ?", [t]))[0].n).toBe(0);
        expect((await q("SELECT COUNT(*) n FROM task_attachments WHERE taskId = ?", [t]))[0].n).toBe(0);
        const leftovers = [...STORED.keys()].filter((k) => k.startsWith(`tasks/${t}/`));
        const inventoried = await q<{ details: string }>("SELECT details FROM activity_logs WHERE organizationId = ? AND action = 'task.attachment_storage_orphan' AND entityId = ?", [ORG, t]);
        expect(leftovers.every((k) => inventoried.some((r) => String(r.details).includes(k)))).toBe(true);
        expect(leftovers).toEqual([]); // com o S3 disponível, nada sobra
      }
    }, 120_000);

    it("objeto que não pôde ser removido nem ficou referenciado ⇒ inventário DURÁVEL (activity_log), nunca silencioso", async () => {
      const { compensateUnreferencedObject } = await import("../../services/taskAttachmentStorageService");
      const k = `tasks/424242/${Date.now()}_deadbeef_orfao.png`;
      STORED.set(k, PNG);
      failNextDelete = true;
      await compensateUnreferencedObject({ organizationId: ORG, userId: U.operator, taskId: 424242, s3Key: k, reason: "attachment_insert_failed" });
      expect(STORED.has(k)).toBe(true);
      const rows = await q<{ details: string }>("SELECT details FROM activity_logs WHERE organizationId = ? AND action = 'task.attachment_storage_orphan' AND entityId = 424242", [ORG]);
      expect(rows.map((r) => String(r.details))).toEqual([expect.stringContaining(k)]);
      STORED.delete(k);
    });

    it("exclusão da tarefa com registro legado de OUTRO recurso: objeto alheio intocado, registro inventariado", async () => {
      const op = await caller(U.operator);
      const t = (await op.departmentTasks.create({ title: "Legado alheio" })).taskId;
      await conn.execute("INSERT INTO task_attachments (taskId, fileName, fileUrl, fileSize, uploadedBy) VALUES (?, 'alheio.pdf', ?, 10, ?)",
        [t, "https://bucket.s3.sa-east-1.amazonaws.com/tasks/999998/1_alheio.pdf", U.operator]);
      const deletedBefore = DELETED.length;
      await op.departmentTasks.delete({ id: t });
      expect(DELETED.length).toBe(deletedBefore);
      expect((await q("SELECT COUNT(*) n FROM activity_logs WHERE organizationId = ? AND action = 'task.attachment_storage_orphan' AND entityId = ? AND details LIKE '%storage_key_unresolved_on_task_delete%'", [ORG, t]))[0].n).toBe(1);
    });
  });
});

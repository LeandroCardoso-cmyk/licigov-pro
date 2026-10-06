/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * NEW-016 — IMUTABILIDADE da versão oficial contra MySQL/MariaDB REAL (modo ESTRITO, REPEATABLE READ).
 *
 * Defeito reproduzido na main `5924b4a`: `createDocument` liberava o GET_LOCK ANTES do commit da
 * transação externa; um 2º escritor contava as versões sem ver a linha não commitada, calculava a
 * MESMA versão (mesmo id determinístico) e o `onDuplicateKeyUpdate` SOBRESCREVIA `content`/`status`/
 * `metadata` — uma versão `emitido` virava `gerado` com o conteúdo do outro escritor (linha híbrida:
 * `author` do emissor, conteúdo da regeneração) e a timeline ficava com dois eventos `event_order=0`.
 *
 * Invariante provada aqui: uma versão oficial criada é IMUTÁVEL. Concorrência ⇒ serialização até o
 * commit (a versão seguinte é alocada) ou FALHA FECHADA (CONFLICT), nunca overwrite.
 *
 *   T1  emissão normal                          T8  contentHash permanece correspondente
 *   T2  segunda versão normal                   T9  official_document_promotions consistente
 *   T3  N escritores concorrentes               T10 timeline não falsifica overwrite
 *   T4  writer com transação EXTERNA aberta     T11 GET_LOCK indisponível ⇒ fail closed
 *   T5  emissão × regeneração (fluxos reais)    T12 isolamento de tenant
 *   T6  colisão não altera a linha existente    T13 retry seguro
 *   T7  `emitido` permanece `emitido`
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode. Nenhum provider real (invoke determinístico).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";
import { runMigrations } from "../../bootstrap";
import { getDb } from "../../db/connection";
import { createDocument, OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE } from "../../services/officialDocumentLifecycleService";
import { insertOfficialDocument, OFFICIAL_DOCUMENT_VERSION_CONFLICT } from "../../db/officialDocuments";
import { computeLineageId, createOfficialDocument } from "../../domain/officialDocument";
import { generateDocument, canonicalDocumentIdentity } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { promoteOfficialDocument, draftContentHash } from "../../services/documentPromotionService";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991601;
const ORG2 = 991602;
const AUTHOR = 5;
const EMITTER = 7;
const DOMAIN = "processo_licitatorio" as const;

let conn: mysql.Connection;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function base(org: number, origin: string) {
  return { organizationId: org, businessDomain: DOMAIN, documentType: "etp" as const, origin, title: "ETP NEW-016", correlationId: "new016-smoke" };
}
function lineageOf(org: number, origin: string) {
  return computeLineageId({ tenantId: org, businessDomain: DOMAIN, documentType: "etp", origin });
}

async function versions(org: number, origin: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT id, version, status, author, CAST(content AS CHAR) AS content, metadata FROM official_documents WHERE tenant_id = ? AND lineage_id = ? ORDER BY version",
    [org, lineageOf(org, origin)],
  );
  return rows as Array<{ id: string; version: number; status: string; author: string; content: string; metadata: string }>;
}
async function timeline(org: number, origin: string) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT event_order, event_type, actor, document_id, summary FROM official_document_timeline WHERE tenant_id = ? AND lineage_id = ? ORDER BY event_order, id",
    [org, lineageOf(org, origin)],
  );
  return rows as Array<{ event_order: number; event_type: string; actor: string; document_id: string; summary: string }>;
}

/** Invariantes estruturais de uma linhagem: versões 1..n contíguas, timeline 0..n-1 sem duplicata,
 *  1 evento de criação por versão com o MESMO ator da versão (nenhuma linha híbrida). */
async function assertLineageIntegrity(org: number, origin: string, expectedCount?: number) {
  const vs = await versions(org, origin);
  const tl = await timeline(org, origin);
  if (expectedCount !== undefined) expect(vs.length).toBe(expectedCount);
  expect(vs.map(v => v.version)).toEqual(vs.map((_, i) => i + 1));
  expect(tl.map(t => t.event_order)).toEqual(tl.map((_, i) => i));
  const creation = tl.filter(t => ["documento_criado", "nova_versao", "documento_emitido"].includes(t.event_type));
  expect(creation.length).toBe(vs.length);
  for (const v of vs) {
    const ev = creation.filter(t => t.document_id === v.id);
    expect(ev.length, `evento de criação da v${v.version}`).toBe(1);
    expect(ev[0].actor, `ator do evento da v${v.version}`).toBe(v.author);
    expect(ev[0].event_type === "documento_emitido", `tipo do evento da v${v.version}`).toBe(v.status === "emitido");
  }
  return { vs, tl };
}

async function seedDraft(org: number, processId: string, object: string, key: string) {
  const generated = await generateDocument({
    organizationId: org, processId, kind: "etp", object,
    correlationId: "new016-smoke", idempotencyKey: key,
    actorUserId: AUTHOR, invoke: async () => buildMockProviderAuthoring("etp"),
  });
  // R9 / SEM-080 (reescrito): sem Itens aprovados a estimativa sai com [REVISAR] (redigida pelo sistema) e a emissão
  // exige conteúdo sem marcadores (SEM-057) — fixture da revisão humana do rascunho.
  await conn.execute("UPDATE generated_documents SET content = REPLACE(content, '[REVISAR', '[REVISADO') WHERE organization_id = ? AND process_id = ? AND kind = 'etp'", [org, processId]);
  return generated;
}
async function currentDraftHash(org: number, processId: string): Promise<string> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT CAST(content AS CHAR) AS c FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'etp' LIMIT 1",
    [org, processId],
  );
  return draftContentHash(rows.length ? String((rows[0] as any).c) : "");
}
async function emit(org: number, processId: string, key: string) {
  return promoteOfficialDocument({
    organizationId: org, processId, kind: "etp", actorUserId: EMITTER, actorRole: "manager",
    idempotencyKey: key, correlationId: "new016-smoke", expectedContentHash: await currentDraftHash(org, processId),
  });
}

async function cleanup() {
  for (const org of [ORG, ORG2]) {
    await conn.execute("DELETE FROM official_document_promotions WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM official_document_timeline WHERE tenant_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM official_documents WHERE tenant_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM process_timeline WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM generated_document_edits WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM generated_documents WHERE organization_id = ?", [org]).catch(() => {});
    await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [org]).catch(() => {});
  }
}

describe.skipIf(!DB)("NEW-016 — imutabilidade da versão oficial (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    for (const [id, slug] of [[ORG, "new016-org"], [ORG2, "new016-org-2"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `NEW-016 ${id}`, slug]).catch(() => {});
    }
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG2]).catch(() => {});
    await conn.end();
  });

  it("T1) emissão normal cria v1 `emitido` com evento documento_emitido", async () => {
    const doc = await createDocument({ ...base(ORG, "t1"), content: "EMITIDO T1", author: "emissor", status: "emitido" });
    expect(doc.version).toBe(1);
    const { vs, tl } = await assertLineageIntegrity(ORG, "t1", 1);
    expect(vs[0]).toMatchObject({ status: "emitido", content: "EMITIDO T1", author: "emissor" });
    expect(tl[0].event_type).toBe("documento_emitido");
  }, 30_000);

  it("T2) segunda versão normal é v2 e não toca a v1", async () => {
    await createDocument({ ...base(ORG, "t2"), content: "V1", author: "a1", status: "emitido" });
    const d2 = await createDocument({ ...base(ORG, "t2"), content: "V2", author: "a2" });
    expect(d2.version).toBe(2);
    const { vs } = await assertLineageIntegrity(ORG, "t2", 2);
    expect(vs[0]).toMatchObject({ version: 1, status: "emitido", content: "V1", author: "a1" });
    expect(vs[1]).toMatchObject({ version: 2, status: "gerado", content: "V2", author: "a2" });
  }, 30_000);

  it("T3) N escritores concorrentes (transação própria) ⇒ N versões distintas, nenhuma perdida/híbrida", async () => {
    const N = 8;
    const results = await Promise.allSettled(Array.from({ length: N }, (_, i) =>
      createDocument({ ...base(ORG, "t3"), content: `C${i}`, author: `w${i}` })));
    const ok = results.filter(r => r.status === "fulfilled");
    const rejected = results.filter(r => r.status === "rejected") as PromiseRejectedResult[];
    // Serializa (todos ok) OU falha fechada com token estável — nunca corrompe.
    for (const r of rejected) expect(String(r.reason?.message)).toMatch(new RegExp(`${OFFICIAL_DOCUMENT_VERSION_CONFLICT}|${OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE}`));
    const { vs } = await assertLineageIntegrity(ORG, "t3", ok.length);
    for (const v of vs) expect(v.content).toBe(`C${v.author.slice(1)}`); // conteúdo e autor do MESMO escritor
    expect(ok.length).toBe(N);
  }, 60_000);

  it("T4) writer com transação EXTERNA aberta após o RELEASE_LOCK ⇒ 2º escritor recebe v2; v1 `emitido` intacta", async () => {
    const db = (await getDb())!;
    const tx1 = db.transaction(async (tx) => {
      const d = await createDocument({ ...base(ORG, "t4"), content: "EMITIDO TX1", author: "emissor1", status: "emitido" }, tx);
      expect(d.version).toBe(1);
      await sleep(1500); // a transação externa segue aberta DEPOIS do RELEASE_LOCK (cenário do defeito)
    });
    await sleep(200);
    let v2 = 0;
    const tx2 = db.transaction(async (tx) => {
      const d = await createDocument({ ...base(ORG, "t4"), content: "CONTEUDO DA TX2", author: "gerador2" }, tx);
      v2 = d.version;
    });
    await Promise.all([tx1, tx2]);
    expect(v2).toBe(2);
    const { vs } = await assertLineageIntegrity(ORG, "t4", 2);
    expect(vs[0]).toMatchObject({ version: 1, status: "emitido", author: "emissor1", content: "EMITIDO TX1" });
    expect(vs[1]).toMatchObject({ version: 2, status: "gerado", author: "gerador2", content: "CONTEUDO DA TX2" });
  }, 30_000);

  it("T4b) snapshot REPEATABLE READ ANTIGO na transação externa (leitura antes do commit concorrente) ⇒ ainda v2", async () => {
    const db = (await getDb())!;
    let release!: () => void;
    const tx1Committed = new Promise<void>(r => { release = r; });
    const tx2 = db.transaction(async (tx) => {
      // estabelece o snapshot ANTES da v1 existir (como applyDraftContentMutationTx faz na regeneração)
      await tx.execute(sql`SELECT COUNT(*) FROM official_documents WHERE tenant_id = ${ORG}`);
      await tx1Committed;
      const d = await createDocument({ ...base(ORG, "t4b"), content: "TX2 SNAPSHOT ANTIGO", author: "gerador2" }, tx);
      expect(d.version).toBe(2);
    });
    await sleep(100);
    await createDocument({ ...base(ORG, "t4b"), content: "EMITIDO", author: "emissor1", status: "emitido" });
    release();
    await tx2;
    const { vs } = await assertLineageIntegrity(ORG, "t4b", 2);
    expect(vs[0]).toMatchObject({ status: "emitido", content: "EMITIDO", author: "emissor1" });
  }, 30_000);

  it("T5) emissão × regeneração concorrentes (fluxos reais) ⇒ versões distintas; emitida imutável e consistente com o ledger", async () => {
    for (let round = 0; round < 4; round++) {
      const pid = `n016-t5-${round}`;
      await seedDraft(ORG, pid, `Material ${round}`, `gen-${pid}-0`);
      const [e, g] = await Promise.allSettled([
        emit(ORG, pid, `emit-${pid}`),
        seedDraft(ORG, pid, `Material ${round} revisto`, `gen-${pid}-1`),
      ]);
      expect(e.status, `emissão r${round}: ${(e as any).reason?.message}`).toBe("fulfilled");
      if (g.status === "rejected") expect(String((g as PromiseRejectedResult).reason?.message)).not.toMatch(/Duplicate entry|ER_DUP_ENTRY/);
      const { lineageId } = canonicalDocumentIdentity({ organizationId: ORG, processId: pid, kind: "etp" });
      const [vs] = await conn.execute<mysql.RowDataPacket[]>(
        "SELECT id, version, status, CAST(content AS CHAR) AS content FROM official_documents WHERE tenant_id = ? AND lineage_id = ? ORDER BY version", [ORG, lineageId]);
      expect((vs as any[]).map(v => v.version)).toEqual((vs as any[]).map((_, i) => i + 1));
      const emitted = (vs as any[]).filter(v => v.status === "emitido");
      expect(emitted.length).toBe(1);
      const [ledger] = await conn.execute<mysql.RowDataPacket[]>(
        "SELECT official_document_id, version, content_hash FROM official_document_promotions WHERE organization_id = ? AND process_id = ?", [ORG, pid]);
      expect(ledger.length).toBe(1);
      expect((ledger[0] as any).official_document_id).toBe(emitted[0].id);
      expect(Number((ledger[0] as any).version)).toBe(Number(emitted[0].version));
      expect(draftContentHash(emitted[0].content)).toBe((ledger[0] as any).content_hash);
    }
  }, 180_000);

  it("T6) colisão direta de id (INSERT de versão existente) ⇒ CONFLICT estável e a linha existente NÃO muda", async () => {
    const orig = await createDocument({ ...base(ORG, "t6"), content: "ORIGINAL EMITIDO", author: "emissor", status: "emitido" });
    const clash = createOfficialDocument({
      tenantId: ORG, businessDomain: DOMAIN, documentType: "etp", origin: "t6", title: "X",
      content: "TENTATIVA DE SOBRESCRITA", version: orig.version, author: "invasor", status: "gerado", correlationId: "c",
      metadata: { hijack: true },
    });
    expect(clash.id).toBe(orig.id);
    await expect(insertOfficialDocument(clash)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining(OFFICIAL_DOCUMENT_VERSION_CONFLICT) });
    const { vs } = await assertLineageIntegrity(ORG, "t6", 1);
    expect(vs[0]).toMatchObject({ status: "emitido", content: "ORIGINAL EMITIDO", author: "emissor" });
    expect(vs[0].metadata).not.toContain("hijack");
  }, 30_000);

  it("T7) `emitido` permanece `emitido` após rajada de regenerações concorrentes com transação externa", async () => {
    const db = (await getDb())!;
    await createDocument({ ...base(ORG, "t7"), content: "EMITIDO T7", author: "emissor", status: "emitido" });
    await Promise.all(Array.from({ length: 5 }, (_, i) => db.transaction(async (tx) => {
      await createDocument({ ...base(ORG, "t7"), content: `REGEN ${i}`, author: `r${i}` }, tx);
      await sleep(150);
    })));
    const { vs } = await assertLineageIntegrity(ORG, "t7", 6);
    expect(vs[0]).toMatchObject({ version: 1, status: "emitido", content: "EMITIDO T7", author: "emissor" });
    expect(vs.slice(1).every(v => v.status === "gerado")).toBe(true);
  }, 60_000);

  it("T8) contentHash registrado na versão emitida continua correspondendo ao conteúdo persistido", async () => {
    const pid = "n016-t8";
    await seedDraft(ORG, pid, "Material T8", `gen-${pid}-0`);
    const r = await emit(ORG, pid, `emit-${pid}`);
    // Regeneração posterior: na main é aceita (nova versão `gerado`); com a PR-09 um documento já EMITIDO
    // não é regenerado diretamente (PRECONDITION_FAILED). Nos dois casos a versão emitida fica intacta.
    await seedDraft(ORG, pid, "Material T8 revisto", `gen-${pid}-1`).catch((e: { code?: string }) => {
      if (e?.code !== "PRECONDITION_FAILED") throw e;
    });
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT status, CAST(content AS CHAR) AS content, metadata FROM official_documents WHERE id = ? AND tenant_id = ?", [r.officialDocument.id, ORG]);
    const row = rows[0] as any;
    expect(row.status).toBe("emitido");
    expect(draftContentHash(row.content)).toBe(r.officialDocument.contentHash);
    expect(JSON.parse(row.metadata).contentHash).toBe(r.officialDocument.contentHash);
  }, 60_000);

  it("T9) official_document_promotions: cada linha aponta para versão `emitido` com mesma versão e hash", async () => {
    // Sem JOIN entre as tabelas: no MySQL 8 `official_documents.id` (utf8mb4_unicode_ci, explícita na 0280) e
    // `official_document_promotions.official_document_id` (default do servidor, utf8mb4_0900_ai_ci — a 0295 não
    // fixa collation) não são comparáveis (ER_CANT_AGGREGATE_2COLLATIONS). Divergência preexistente de schema,
    // fora do escopo da NEW-016. Cada promoção é conferida contra a versão oficial por consulta própria.
    const [ledger] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT organization_id, official_document_id, lineage_id, version, content_hash FROM official_document_promotions WHERE organization_id = ?", [ORG]);
    expect(ledger.length).toBeGreaterThan(0);
    for (const p of ledger as any[]) {
      const [docs] = await conn.execute<mysql.RowDataPacket[]>(
        "SELECT id, tenant_id, lineage_id, version, status, CAST(content AS CHAR) AS content FROM official_documents WHERE tenant_id = ? AND id = ?",
        [p.organization_id, p.official_document_id]);
      expect(docs.length, `versão oficial da promoção ${p.official_document_id}`).toBe(1); // nenhuma promoção órfã
      const d = docs[0] as any;
      expect(Number(d.tenant_id)).toBe(Number(p.organization_id));
      expect(d.id).toBe(p.official_document_id);
      expect(d.lineage_id).toBe(p.lineage_id);
      expect(d.status).toBe("emitido");
      expect(Number(d.version)).toBe(Number(p.version));
      expect(draftContentHash(d.content)).toBe(p.content_hash);
    }
  }, 30_000);

  it("T10) timeline não falsifica overwrite: ordens únicas e um evento por versão com o ator verdadeiro", async () => {
    for (const origin of ["t1", "t2", "t3", "t4", "t4b", "t6", "t7"]) await assertLineageIntegrity(ORG, origin);
    const [dups] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT lineage_id, event_order, COUNT(*) n FROM official_document_timeline WHERE tenant_id = ? GROUP BY lineage_id, event_order HAVING n > 1", [ORG]);
    expect(dups.length).toBe(0);
  }, 30_000);

  it("T11) GET_LOCK indisponível (lock nomeado mantido por outra sessão) ⇒ fail closed, nada gravado", async () => {
    const lockKey = `odoc:${ORG}:${lineageOf(ORG, "t11")}`.slice(0, 60);
    const holder = await mysql.createConnection(DB!);
    try {
      const [got] = await holder.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 0) AS ok", [lockKey]);
      expect(Number((got[0] as any).ok)).toBe(1);
      await expect(createDocument({ ...base(ORG, "t11"), content: "NAO DEVE GRAVAR", author: "x", status: "emitido" }))
        .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining(OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE) });
      expect((await versions(ORG, "t11")).length).toBe(0);
      expect((await timeline(ORG, "t11")).length).toBe(0);
    } finally {
      await holder.query("SELECT RELEASE_LOCK(?)", [lockKey]);
      await holder.end();
    }
  }, 40_000);

  it("T12) isolamento de tenant: mesma origem em outro tenant = linhagem própria, sem bloqueio cruzado", async () => {
    const db = (await getDb())!;
    const t0 = Date.now();
    let bElapsed = 0;
    await Promise.all([
      db.transaction(async (tx) => {
        await createDocument({ ...base(ORG, "t12"), content: "A", author: "a", status: "emitido" }, tx);
        await sleep(1500);
      }),
      (async () => {
        await sleep(150);
        const d = await createDocument({ ...base(ORG2, "t12"), content: "B", author: "b" });
        bElapsed = Date.now() - t0;
        expect(d.version).toBe(1);
      })(),
    ]);
    expect(bElapsed).toBeLessThan(1400); // tenant B não esperou o commit do tenant A
    const a = await assertLineageIntegrity(ORG, "t12", 1);
    const b = await assertLineageIntegrity(ORG2, "t12", 1);
    expect(a.vs[0]).toMatchObject({ status: "emitido", content: "A" });
    expect(b.vs[0]).toMatchObject({ status: "gerado", content: "B" });
    expect(a.vs[0].id).not.toBe(b.vs[0].id);
  }, 30_000);

  it("T13) retry seguro: após uma recusa fail-closed, a nova tentativa cria a próxima versão sem resíduo", async () => {
    const lockKey = `odoc:${ORG}:${lineageOf(ORG, "t13")}`.slice(0, 60);
    await createDocument({ ...base(ORG, "t13"), content: "EMITIDO", author: "emissor", status: "emitido" });
    const holder = await mysql.createConnection(DB!);
    await holder.query("SELECT GET_LOCK(?, 0)", [lockKey]);
    await expect(createDocument({ ...base(ORG, "t13"), content: "TENTATIVA 1", author: "r" })).rejects.toMatchObject({ code: "CONFLICT" });
    await holder.query("SELECT RELEASE_LOCK(?)", [lockKey]);
    await holder.end();
    const retry = await createDocument({ ...base(ORG, "t13"), content: "TENTATIVA 2", author: "r" });
    expect(retry.version).toBe(2);
    const { vs } = await assertLineageIntegrity(ORG, "t13", 2);
    expect(vs[0]).toMatchObject({ status: "emitido", content: "EMITIDO" });
    expect(vs.map(v => v.content)).not.toContain("TENTATIVA 1");
    // retry idempotente da EMISSÃO (mesma chave) ⇒ replay, nenhuma versão nova
    const pid = "n016-t13";
    await seedDraft(ORG, pid, "Material T13", `gen-${pid}-0`);
    const first = await emit(ORG, pid, `emit-${pid}`);
    const again = await emit(ORG, pid, `emit-${pid}`);
    expect(again.replayed).toBe(true);
    expect(again.officialDocument.id).toBe(first.officialDocument.id);
    const [cnt] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM official_document_promotions WHERE organization_id = ? AND process_id = ?", [ORG, pid]);
    expect(Number((cnt[0] as any).n)).toBe(1);
  }, 60_000);
});

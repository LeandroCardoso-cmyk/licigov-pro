/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * M8 — EMENDA DE INTEGRIDADE (PR #312, P1-A): concorrência entre a mudança de proveniência de uma cotação e a EMISSÃO
 * oficial, contra MySQL REAL (banco isolado; órgãos sintéticos 991921/991922 — nunca a organização 1).
 *
 * Interleavings DETERMINÍSTICOS por barreira (`__setEmissionHookForTests`), sem `sleep` como mecanismo:
 *  A) ALTERAÇÃO VENCE — a emissão passa as pré-condições e PARA; a reimportação declara a cotação fictícia e COMMITA;
 *     a emissão retoma ⇒ recusa EMISSION_FICTITIOUS_PRICES (sem versão oficial, sem ledger, sem idempotência COMPLETED).
 *  B) EMISSÃO VENCE — a emissão trava as fontes (FOR SHARE) e PARA dentro da transação; a reimportação ESPERA o lock
 *     (observado em performance_schema.data_lock_waits); a emissão commita; a reimportação conclui depois; o documento
 *     oficial não muda e a referência/a próxima emissão já observam a fonte fictícia.
 *  C) FALHA E REPLAY — rollback por falha forçada dentro da transação ⇒ nada emitido e a mesma chave reexecuta; replay
 *     da emissão concluída converge; mesma chave + conteúdo diferente ⇒ CONFLICT; duas emissões concorrentes do mesmo
 *     conteúdo com chaves diferentes ⇒ versões distintas e coerentes (contrato existente); lock wait timeout no escritor ⇒
 *     erro explícito, nada parcial.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { generateDocument } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { __setEmissionHookForTests, promoteOfficialDocument, type EmissionHookPhase } from "../../services/documentPromotionService";
import { insertResearchItem } from "../../db/procurement";
import { createPriceResearchItem } from "../../domain/priceResearch";
import { draftContentHash } from "../../domain/generatedDocument";
import { getDb } from "../../db/connection";

const DB = process.env.DATABASE_URL;
const ORG = 991921;
const ORG_B = 991922;
const OBJ = "Material de expediente (M8 corrida da emissão)";
const REAL_TEXT = "Lápis HB;20;UN;R$ 0,90;Papelaria Alfa\nLápis HB;20;UN;R$ 1,10;Comercial Beta";
const stamp = Date.now();
const K = (t: string) => `m8race-${t}-${stamp}`;
const U: Record<string, number> = {};
let conn: mysql.Connection;

async function caller(user: number, org: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: user, role: "user", name: `M8R ${user}`, email: `m8race-${user}@teste.local` },
    req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {},
    correlationId: `m8race-${Math.random().toString(36).slice(2, 10)}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}
const rows = async (q: string, p: unknown[] = []) => (await conn.execute<mysql.RowDataPacket[]>(q, p))[0];
const errOf = async (fn: () => Promise<unknown>) => {
  try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code ?? "ERR", message: x.message ?? "" }; }
  return { code: "RESOLVED", message: "" };
};

/** Barreira: a emissão PARA na fase pedida até `release()`; `entered` resolve quando ela chega lá. */
function pauseAt(phase: EmissionHookPhase) {
  let enter!: () => void; let release!: () => void; let used = false;
  const entered = new Promise<void>((r) => { enter = r; });
  const gate = new Promise<void>((r) => { release = r; });
  __setEmissionHookForTests(async (p) => { if (p !== phase || used) return; used = true; enter(); await gate; });
  return { entered, release };
}

/** Processo legado com fonte REAL aprovada e ETP revisado (sem [REVISAR]) pronto para emissão. */
async function readyProcess(tag: string): Promise<{ pid: string; hash: string }> {
  const c = await caller(U.owner, ORG);
  const { process } = await c.procurementProcess.createProcess({ processNumber: `M8R-${tag}-${stamp}`, object: OBJ, startOption: "iniciar_pesquisa" });
  await c.procurementProcess.importPriceResearch({ processId: process.id, source: "colar", text: REAL_TEXT });
  for (const it of (await c.procurementProcess.listItems({ processId: process.id })).items) await c.procurementProcess.approveItem({ itemId: it.id });
  await generateDocument({
    organizationId: ORG, processId: process.id, kind: "etp", object: OBJ, correlationId: K(`gen-${tag}`), idempotencyKey: K(`gen-${tag}`),
    actorUserId: U.owner, invoke: async () => buildMockProviderAuthoring("etp"),
  });
  const draft = await c.procurementProcess.reviewableDraft({ processId: process.id, kind: "etp" }) as any;
  const content = String(draft.draft.content);
  const edited = content.replace(/\[REVISAR\b/g, "[NOTA");
  await c.procurementProcess.saveReviewableDraft({ processId: process.id, kind: "etp", content: edited, expectedContentHash: draftContentHash(content), idempotencyKey: K(`edit-${tag}`) });
  return { pid: process.id, hash: draftContentHash(edited) };
}

/** Reimportação (upsert por id) que DECLARA fictícia a cotação "Papelaria Alfa" do processo. */
async function declareFictitious(pid: string): Promise<void> {
  const [q] = await rows("SELECT id, research_id r, value v FROM price_research_items WHERE organization_id = ? AND process_id = ? AND supplier = 'Papelaria Alfa'", [ORG, pid]);
  const db = (await getDb())!;
  await db.transaction(async (tx) => {
    await insertResearchItem({
      ...createPriceResearchItem({ researchId: String(q.r), processId: pid, organizationId: ORG, description: "Lápis HB", unit: "UN", quantity: 20, value: Number(q.v), supplier: "Papelaria Alfa", provenanceKind: "ficticia", source: "colar" }),
      id: String(q.id),
    }, tx);
  });
}
const emit = (pid: string, hash: string, key: string) => promoteOfficialDocument({
  organizationId: ORG, processId: pid, kind: "etp", actorUserId: U.emitter, actorRole: "manager",
  idempotencyKey: key, correlationId: K(`c-${key}`), expectedContentHash: hash,
});
const officialState = async (pid: string) => ({
  docs: Number((await rows("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND origin = ? AND status = 'emitido'", [ORG, pid]))[0].n),
  promotions: Number((await rows("SELECT COUNT(*) n FROM official_document_promotions WHERE organization_id = ? AND process_id = ?", [ORG, pid]))[0].n),
});
const keyStatus = async (key: string) => String((await rows("SELECT status FROM idempotency_keys WHERE `key` = ? AND organizationId = ?", [key, ORG]))[0]?.status ?? "none");
const kindOf = async (pid: string) => String((await rows("SELECT provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ? AND supplier = 'Papelaria Alfa'", [ORG, pid]))[0].k);

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    for (const [t, col] of [
      ["official_document_promotions", "organization_id"], ["official_document_timeline", "tenant_id"], ["official_documents", "tenant_id"],
      ["generated_document_edits", "organization_id"], ["generated_documents", "organization_id"], ["process_timeline", "organization_id"],
      ["item_risks", "organization_id"], ["item_recommendations", "organization_id"], ["catmat_matches", "organization_id"],
      ["intelligent_item_identity_aliases", "organization_id"], ["intelligent_items", "organization_id"],
      ["price_research_items", "organization_id"], ["price_research", "organization_id"], ["procurement_context_facts", "organization_id"],
      ["procurement_processes", "organization_id"], ["idempotency_keys", "organizationId"], ["activity_logs", "organizationId"],
      ["organization_members", "organizationId"],
    ] as const) {
      await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
    }
  }
}

describe.skipIf(!DB)("M8 — corrida proveniência × emissão oficial (MySQL real, barreiras determinísticas)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    for (const [id, nome] of [[ORG, "Prefeitura Sintética M8 Corrida"], [ORG_B, "Outra Prefeitura Sintética M8 Corrida"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, nome, `m8race-${id}-${stamp}`]);
    }
    for (const tag of ["owner", "emitter", "ownerB"]) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')", [`m8race-${tag}-${stamp}`, `M8R ${tag}`, `m8race-${tag}-${stamp}@teste.local`]);
      U[tag] = r.insertId;
    }
    for (const [org, u, role] of [[ORG, U.owner, "owner"], [ORG, U.emitter, "manager"], [ORG_B, U.ownerB, "owner"]] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
  }, 300_000);

  afterAll(async () => {
    __setEmissionHookForTests(null);
    if (!conn) return;
    await cleanup().catch(() => {});
    const ids = Object.values(U).filter(Boolean);
    if (ids.length) await conn.execute(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("A) alteração vence: fonte vira fictícia DEPOIS das pré-condições e ANTES do commit ⇒ emissão recusada, nada oficial", { timeout: 120_000 }, async () => {
    const { pid, hash } = await readyProcess("a");
    const bar = pauseAt("after_preconditions");
    const key = K("emit-a");
    const pending = errOf(() => emit(pid, hash, key));
    await bar.entered;                       // a emissão já passou pelas pré-condições (fonte real naquele instante)
    await declareFictitious(pid);            // a reimportação commita a declaração fictícia
    expect(await kindOf(pid)).toBe("ficticia");
    bar.release();
    const e = await pending;
    __setEmissionHookForTests(null);
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(e.message).toContain("EMISSION_FICTITIOUS_PRICES");
    expect(await officialState(pid)).toEqual({ docs: 0, promotions: 0 });
    expect(await keyStatus(key)).not.toBe("completed");
    // A mesma chave reexecuta e continua recusada (estado efetivo da fonte), sem sucesso institucional.
    expect((await errOf(() => emit(pid, hash, key))).message).toContain("EMISSION_FICTITIOUS_PRICES");
    expect(await officialState(pid)).toEqual({ docs: 0, promotions: 0 });
  });

  it("B) emissão vence: com as fontes travadas, a reimportação ESPERA; o oficial fica imutável e o próximo ciclo vê a fictícia", { timeout: 120_000 }, async () => {
    const { pid, hash } = await readyProcess("b");
    const bar = pauseAt("after_source_locks");
    const pending = emit(pid, hash, K("emit-b"));
    await bar.entered;                                   // dentro da transação, fontes travadas (FOR SHARE)
    let writerDone = false;
    const writer = declareFictitious(pid).then(() => { writerDone = true; });
    // O escritor fica BLOQUEADO no lock (prova objetiva no MySQL, sem sleep como mecanismo).
    // Observação (não ordenação): espera até o MySQL registrar a espera de lock do escritor (prazo de 20 s).
    let waits = 0;
    for (const deadline = Date.now() + 20_000; waits === 0 && Date.now() < deadline;) {
      waits = Number((await rows("SELECT COUNT(*) n FROM performance_schema.data_lock_waits"))[0].n);
      if (waits === 0) await new Promise((r) => setTimeout(r, 25));
    }
    expect(waits).toBeGreaterThan(0);
    expect(writerDone).toBe(false);
    bar.release();
    const ok = await pending;
    __setEmissionHookForTests(null);
    await writer;
    expect(ok.promoted).toBe(true);
    expect(await kindOf(pid)).toBe("ficticia");          // a alteração posterior foi aplicada…
    const [doc] = await rows("SELECT CAST(content AS CHAR) c, status FROM official_documents WHERE id = ?", [ok.officialDocument.id]);
    expect(doc.status).toBe("emitido");                  // …sem modificar retroativamente o documento oficial
    // A referência e a próxima emissão já observam a proveniência modificada.
    const c = await caller(U.owner, ORG);
    const draft = await c.procurementProcess.reviewableDraft({ processId: pid, kind: "etp" }) as any;
    const content = String(draft.draft.content);
    await c.procurementProcess.saveReviewableDraft({ processId: pid, kind: "etp", content: `${content}\n\nAjuste.`, expectedContentHash: draftContentHash(content), idempotencyKey: K("edit-b2") });
    expect((await errOf(() => emit(pid, draftContentHash(`${content}\n\nAjuste.`), K("emit-b2")))).message).toContain("EMISSION_FICTITIOUS_PRICES");
    expect(await officialState(pid)).toEqual({ docs: 1, promotions: 1 });
  });

  it("C) falha e replay: rollback dentro da transação, replay convergente, payload divergente e emissões concorrentes", { timeout: 180_000 }, async () => {
    const { pid, hash } = await readyProcess("c");
    // Falha forçada DEPOIS dos locks e ANTES de qualquer escrita oficial ⇒ rollback integral; a chave fica reexecutável.
    __setEmissionHookForTests(async (p) => { if (p === "after_source_locks") throw new Error("falha forçada (teste)"); });
    const key = K("emit-c");
    expect((await errOf(() => emit(pid, hash, key))).message).toContain("falha forçada");
    __setEmissionHookForTests(null);
    expect(await officialState(pid)).toEqual({ docs: 0, promotions: 0 });
    expect(await keyStatus(key)).toBe("failed");
    const first = await emit(pid, hash, key);            // reenvio com a mesma chave
    expect(first.promoted).toBe(true);
    const replay = await emit(pid, hash, key);           // replay ⇒ converge, sem nova versão
    expect(replay).toMatchObject({ replayed: true, promoted: false, officialDocument: { id: first.officialDocument.id } });
    expect(await officialState(pid)).toEqual({ docs: 1, promotions: 1 });
    // Mesma chave + conteúdo diferente ⇒ CONFLICT.
    const c = await caller(U.owner, ORG);
    const d1 = String(((await c.procurementProcess.reviewableDraft({ processId: pid, kind: "etp" })) as any).draft.content);
    await c.procurementProcess.saveReviewableDraft({ processId: pid, kind: "etp", content: `${d1}\n\nNova seção.`, expectedContentHash: draftContentHash(d1), idempotencyKey: K("edit-c2") });
    const h2 = draftContentHash(`${d1}\n\nNova seção.`);
    expect((await errOf(() => emit(pid, h2, key))).code).toBe("CONFLICT");
    // Duas emissões concorrentes do MESMO conteúdo com chaves diferentes: ambas passam pela mesma fronteira
    // (locks compartilhados entre si) e o contrato existente de versões (GET_LOCK por linhagem) as serializa.
    const both = await Promise.all([emit(pid, h2, K("emit-c3")), emit(pid, h2, K("emit-c4"))].map((p) => p.then((r) => r, (e) => e)));
    const promoted = both.filter((r: any) => r && r.promoted === true);
    expect(promoted.length).toBeGreaterThanOrEqual(1);
    const versions = (await rows("SELECT version FROM official_documents WHERE tenant_id = ? AND origin = ? AND status = 'emitido' ORDER BY version", [ORG, pid])).map((r) => Number(r.version));
    expect(new Set(versions).size).toBe(versions.length);  // nenhuma versão duplicada
    expect(Number((await rows("SELECT COUNT(*) n FROM official_document_promotions WHERE organization_id = ? AND process_id = ?", [ORG, pid]))[0].n)).toBe(versions.length);
  });

  it("C') lock wait timeout no escritor: com a emissão segurando as fontes, a reimportação falha explicitamente e nada fica parcial", { timeout: 120_000 }, async () => {
    const { pid, hash } = await readyProcess("t");
    const bar = pauseAt("after_source_locks");
    const pending = emit(pid, hash, K("emit-t"));
    await bar.entered;
    const w = await mysql.createConnection(DB!);
    try {
      await w.query("SET SESSION innodb_lock_wait_timeout = 1");
      await w.beginTransaction();
      const [q] = await rows("SELECT id FROM price_research_items WHERE organization_id = ? AND process_id = ? AND supplier = 'Papelaria Alfa'", [ORG, pid]);
      const code = await w.query("UPDATE price_research_items SET provenance_kind = 'ficticia' WHERE id = ?", [String(q.id)]).then(() => "OK", (e) => (e as { code?: string }).code);
      await w.rollback();
      expect(code).toBe("ER_LOCK_WAIT_TIMEOUT");
    } finally { await w.end(); }
    bar.release();
    expect((await pending).promoted).toBe(true);
    __setEmissionHookForTests(null);
    expect(await kindOf(pid)).toBe("declarada");          // nada parcial do escritor que expirou
  });

  it("isolamento: a trava de fontes é por (órgão, processo) — outro órgão importa normalmente durante a emissão", { timeout: 120_000 }, async () => {
    const { pid, hash } = await readyProcess("iso");
    const bar = pauseAt("after_source_locks");
    const pending = emit(pid, hash, K("emit-iso"));
    await bar.entered;
    const b = await caller(U.ownerB, ORG_B);
    const { process } = await b.procurementProcess.createProcess({ processNumber: `M8R-B-${stamp}`, object: OBJ, startOption: "iniciar_pesquisa" });
    await b.procurementProcess.importPriceResearch({ processId: process.id, source: "colar", text: REAL_TEXT });
    expect((await b.procurementProcess.listItems({ processId: process.id })).items.length).toBe(1);
    bar.release();
    expect((await pending).promoted).toBe(true);
    __setEmissionHookForTests(null);
  });
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SEM-084 (K1) — remediação de concorrência e replay contra MySQL REAL. Só roda com DATABASE_URL.
 *
 *  SEM084-A  deadlock (ER_LOCK_DEADLOCK 1213) na fronteira DONA da transação ⇒ a transação INTEIRA é repetida
 *            (no máximo 3 tentativas, esperas fixas); outros erros NÃO são repetidos. O deadlock é injetado DENTRO de
 *            uma transação real (as escritas acontecem e o rollback as desfaz, como faz o InnoDB).
 *     A  1213 injetado ⇒ retry ⇒ UM documento, UMA versão, sem evento de timeline duplicado;
 *     B  erro ≠ 1213 ⇒ sem retry, erro original propagado, nada gravado;
 *     C  3 deadlocks consecutivos ⇒ falha limitada e observável (DEADLOCK_RETRY_EXHAUSTED), nada gravado.
 *  SEM084-B  replay do COMANDO de criação de aditivo/apostilamento pela chave de idempotência:
 *     D  aditivo gravado + termo FALHOU + o MESMO comando repetido ⇒ o MESMO aditivo; o termo é retomado (v1);
 *     E  mesma chave + payload diferente ⇒ CONFLICT, nada gravado/alterado;
 *     F  requisições CONCORRENTES com a mesma chave ⇒ um único aditivo, um único termo, uma única entrada de timeline;
 *     G  a chave é escopada por órgão (e usuário): outro órgão com a mesma chave ⇒ namespace independente.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const ORG_A = 995401;
const ORG_B = 995402;
const RUN = Date.now().toString(36);
let keySeq = 0;
const newKey = () => `sem084-${RUN}-${++keySeq}`;

/** Erro com a forma do mysql2 para ER_LOCK_DEADLOCK. */
const deadlock = () => Object.assign(new Error("Deadlock found when trying to get lock; try restarting transaction"), { code: "ER_LOCK_DEADLOCK", errno: 1213, sqlState: "40001" });

describe.skipIf(!DB)("SEM-084 — retry de deadlock (SEM084-A) e replay do comando de instrumento (SEM084-B) — MySQL real", () => {
  let conn: mysql.Connection;
  const U = { manager: 0, owner: 0, ownerB: 0 };
  let seq = 0;

  async function caller(userId: number, org: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `sem084-${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {},
      correlationId: `corr-sem084-${userId}-${++seq}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
    try { await p; return null; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
  }
  const rows = async <T = mysql.RowDataPacket>(sql: string, p: unknown[] = []): Promise<T[]> => ((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0]) as unknown as T[];
  const n = async (sql: string, p: unknown[] = []) => Number((await rows<{ n: number }>(sql, p))[0].n);

  async function seedContract(tag: string, org = ORG_A, createdBy = U.owner) {
    const { createManualContract } = await import("../../services/contractService");
    const ws = await createManualContract({
      organizationId: org, contractNumber: `CT-S084-${tag}-${RUN}`, contractor: "Fornecedor S084", object: `Objeto ${tag}`,
      value: 1000, term: "12 meses", manager: "Gestor", inspector: "Fiscal", correlationId: "s084-seed", createdBy,
    });
    await conn.execute("UPDATE contract_workspaces SET status = 'vigente' WHERE id = ? AND organization_id = ?", [ws.id, org]);
    return ws.id;
  }
  /** Tudo que uma recusa NÃO pode mexer. */
  async function snapshot(contractId: string) {
    return JSON.stringify({
      c: await rows("SELECT status, updated_at FROM contract_workspaces WHERE id = ?", [contractId]),
      a: await rows("SELECT id, sequence, status, justification FROM contract_addenda WHERE contract_id = ? ORDER BY sequence", [contractId]),
      p: await rows("SELECT id, sequence, kind FROM contract_ws_apostilles WHERE contract_id = ? ORDER BY sequence", [contractId]),
      d: await n("SELECT COUNT(*) n FROM contract_ws_documents WHERE contract_id = ?", [contractId]),
      o: await rows("SELECT lineage_id, version FROM official_documents WHERE origin = ? ORDER BY lineage_id, version", [contractId]),
      t: await n("SELECT COUNT(*) n FROM process_timeline WHERE process_id = ?", [contractId]),
    });
  }
  async function instrumentLineage(org: number, contractId: string, kind: "aditivo" | "apostilamento", instrumentId: string) {
    const { computeLineageId } = await import("../../domain/officialDocument");
    return computeLineageId({ tenantId: org, businessDomain: "contratos", documentType: kind, origin: contractId, instrumentId });
  }

  /** Injeta erro DENTRO de transações reais: o corpo roda e grava; o erro lançado ao final faz o rollback. */
  async function injectIntoTransactions(decide: (call: number) => Error | null) {
    const { getDb } = await import("../../db/connection");
    const db = (await getDb())!;
    const original = db.transaction.bind(db);
    let call = 0;
    const spy = vi.spyOn(db, "transaction").mockImplementation(((cb: (tx: unknown) => Promise<unknown>, cfg?: unknown) => {
      const thisCall = ++call;
      return (original as any)(async (tx: unknown) => {
        const out = await cb(tx);
        const e = decide(thisCall);
        if (e) throw e;
        return out;
      }, cfg);
    }) as any);
    return { spy, calls: () => call };
  }

  async function cleanup() {
    for (const t of ["contract_addenda", "contract_ws_apostilles", "contract_ws_documents", "process_timeline", "contract_workspaces"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
    }
    for (const t of ["official_document_timeline", "official_documents"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE tenant_id IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
    }
    await conn.query("DELETE FROM idempotency_keys WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.query("DELETE FROM organization_members WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await cleanup();
    for (const org of [ORG_A, ORG_B]) {
      await conn.query("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1", [org, `Org S084 ${org}`, `s084-${org}`]);
    }
    for (const k of Object.keys(U) as Array<keyof typeof U>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`s084-${k}-${RUN}`, `S084 ${k}`, `s084-${k}-${RUN}@teste.local`]);
      U[k] = r.insertId;
    }
    for (const [org, u, role] of [[ORG_A, U.manager, "manager"], [ORG_A, U.owner, "owner"], [ORG_B, U.ownerB, "owner"]] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
  }, 120_000);

  afterEach(() => { vi.restoreAllMocks(); });

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE openId LIKE ?", [`s084-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.end();
  });

  // ─── SEM084-A ──────────────────────────────────────────────────────────────────
  it("A — 1213 injetado na transação do documento oficial ⇒ retry da transação INTEIRA: um documento, versão 1, um evento de timeline", async () => {
    const { createDocument } = await import("../../services/officialDocumentLifecycleService");
    const instrumentId = `a-${RUN}`;
    const inj = await injectIntoTransactions((call) => (call === 1 ? deadlock() : null));
    const doc = await createDocument({
      organizationId: ORG_A, businessDomain: "contratos", documentType: "aditivo", origin: `orig-a-${RUN}`, instrumentId,
      title: "Termo A", content: "conteúdo", author: "user:1", correlationId: "corr-a",
    });
    expect(inj.calls()).toBe(2);
    expect(doc.version).toBe(1);
    const docs = await rows<{ id: string; version: number }>("SELECT id, version FROM official_documents WHERE tenant_id = ? AND lineage_id = ?", [ORG_A, doc.lineageId]);
    expect(docs).toEqual([{ id: doc.id, version: 1 }]);
    const ev = await rows<{ event_type: string }>("SELECT event_type FROM official_document_timeline WHERE tenant_id = ? AND lineage_id = ?", [ORG_A, doc.lineageId]);
    expect(ev.map((e) => e.event_type)).toEqual(["documento_criado"]);
  }, 60_000);

  it("A — 1213 injetado UMA vez em CADA transação do comando de aditivo (instrumento e termo) ⇒ um aditivo, um termo v1, um evento", async () => {
    const id = await seedContract("a2");
    const api = await caller(U.manager, ORG_A);
    const inj = await injectIntoTransactions((call) => (call % 2 === 1 ? deadlock() : null));
    const r = await api.contractWorkspace.createAddendum({ idempotencyKey: newKey(), contractId: id, addendumType: "prazo", justification: "Prorrogação A2", newTerm: "18 meses" });
    inj.spy.mockRestore();
    expect(inj.calls()).toBeGreaterThanOrEqual(4); // instrumento: 2 tentativas; termo: 2 tentativas
    const a = await rows<{ id: string; sequence: number }>("SELECT id, sequence FROM contract_addenda WHERE contract_id = ?", [id]);
    expect(a).toEqual([{ id: r.addendum.id, sequence: 1 }]);
    const lineage = await instrumentLineage(ORG_A, id, "aditivo", r.addendum.id);
    expect((await rows("SELECT version FROM official_documents WHERE tenant_id = ? AND lineage_id = ?", [ORG_A, lineage])).map((x) => x.version)).toEqual([1]);
    expect(await n("SELECT COUNT(*) n FROM official_document_timeline WHERE tenant_id = ? AND lineage_id = ?", [ORG_A, lineage])).toBe(1);
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND event_type = 'change'", [id])).toBe(1);
    expect(await n("SELECT COUNT(*) n FROM contract_ws_documents WHERE contract_id = ? AND kind = 'aditivo'", [id])).toBe(1);
    expect((await rows("SELECT status FROM contract_workspaces WHERE id = ?", [id]))[0].status).toBe("aditado");
  }, 120_000);

  it("B — erro que NÃO é deadlock (1205 lock wait timeout) ⇒ sem retry, erro original propagado, nada gravado", async () => {
    const { createDocument } = await import("../../services/officialDocumentLifecycleService");
    const original = Object.assign(new Error("Lock wait timeout exceeded; try restarting transaction"), { code: "ER_LOCK_WAIT_TIMEOUT", errno: 1205 });
    const inj = await injectIntoTransactions(() => original);
    const caught = await createDocument({
      organizationId: ORG_A, businessDomain: "contratos", documentType: "aditivo", origin: `orig-b-${RUN}`, instrumentId: `b-${RUN}`,
      title: "Termo B", content: "conteúdo", author: "user:1", correlationId: "corr-b",
    }).then(() => null, (e: unknown) => e);
    expect(caught).toBe(original);
    expect(inj.calls()).toBe(1);
    expect(await n("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND origin = ?", [ORG_A, `orig-b-${RUN}`])).toBe(0);
    expect(await n("SELECT COUNT(*) n FROM official_document_timeline WHERE tenant_id = ? AND summary LIKE ?", [ORG_A, "%Termo B%"])).toBe(0);
  }, 60_000);

  it("C — 3 deadlocks consecutivos ⇒ falha LIMITADA (3 tentativas) e observável; nada gravado", async () => {
    const { createDocument } = await import("../../services/officialDocumentLifecycleService");
    const { DeadlockRetryExhaustedError } = await import("../../services/transactionDeadlockRetry");
    const inj = await injectIntoTransactions(() => deadlock());
    const caught = await createDocument({
      organizationId: ORG_A, businessDomain: "contratos", documentType: "aditivo", origin: `orig-c-${RUN}`, instrumentId: `c-${RUN}`,
      title: "Termo C", content: "conteúdo", author: "user:1", correlationId: "corr-c",
    }).then(() => null, (e: unknown) => e);
    expect(caught).toBeInstanceOf(DeadlockRetryExhaustedError);
    expect((caught as Error).message).toMatch(/^DEADLOCK_RETRY_EXHAUSTED/);
    expect(inj.calls()).toBe(3);
    expect(await n("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND origin = ?", [ORG_A, `orig-c-${RUN}`])).toBe(0);
  }, 60_000);

  // ─── SEM084-B ──────────────────────────────────────────────────────────────────
  it("D — aditivo gravado, termo FALHOU (linhagem ocupada) ⇒ o MESMO comando repetido devolve o MESMO aditivo e retoma o termo (v1); depois, replay puro", async () => {
    const { instrumentIdForCommand } = await import("../../domain/contractInstruments");
    const id = await seedContract("d");
    const api = await caller(U.manager, ORG_A);
    const key = newKey();
    const input = { idempotencyKey: key, contractId: id, addendumType: "prazo" as const, justification: "Prorrogação D", newTerm: "18 meses" };
    // O termo falha de verdade: outra sessão segura o lock nomeado da linhagem PRÓPRIA do instrumento (fail-closed do NEW-016).
    const instrumentId = instrumentIdForCommand("aditivo", { organizationId: ORG_A, contractId: id, actorUserId: U.manager, idempotencyKey: key });
    const lineage = await instrumentLineage(ORG_A, id, "aditivo", instrumentId);
    const holder = await mysql.createConnection(DB!);
    try {
      const [[got]] = await holder.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?, 5) AS ok", [`odoc:${ORG_A}:${lineage}`.slice(0, 60)]);
      expect(Number(got.ok)).toBe(1);
      const first = await err(api.contractWorkspace.createAddendum(input));
      expect(first?.message).toContain("OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE");
    } finally {
      await holder.query("SELECT RELEASE_LOCK(?)", [`odoc:${ORG_A}:${lineage}`.slice(0, 60)]).catch(() => {});
      await holder.end().catch(() => {});
    }
    // Estado parcial: o aditivo (com o id derivado da chave) existe; o termo não.
    expect((await rows("SELECT id FROM contract_addenda WHERE contract_id = ?", [id])).map((r) => r.id)).toEqual([instrumentId]);
    expect(await n("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND lineage_id = ?", [ORG_A, lineage])).toBe(0);
    const before = await rows("SELECT * FROM contract_addenda WHERE id = ?", [instrumentId]);

    // Repetição do MESMO comando ⇒ mesmo aditivo, nenhum novo; o termo é gerado agora.
    const second = await api.contractWorkspace.createAddendum(input);
    expect(second.addendum.id).toBe(instrumentId);
    expect(second.resumed).toBe(true);
    expect(await rows("SELECT * FROM contract_addenda WHERE id = ?", [instrumentId])).toEqual(before); // aditivo já gravado NÃO é alterado
    expect(await n("SELECT COUNT(*) n FROM contract_addenda WHERE contract_id = ?", [id])).toBe(1);
    expect((await rows("SELECT version FROM official_documents WHERE tenant_id = ? AND lineage_id = ?", [ORG_A, lineage])).map((r) => r.version)).toEqual([1]);
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND event_type = 'change'", [id])).toBe(1);
    expect(await n("SELECT COUNT(*) n FROM contract_ws_documents WHERE contract_id = ? AND kind = 'aditivo'", [id])).toBe(1);

    // Terceira vez ⇒ replay do comando concluído: mesmo resultado, nada novo.
    const snap = await snapshot(id);
    const third = await api.contractWorkspace.createAddendum(input);
    expect(third.addendum.id).toBe(instrumentId);
    expect(await snapshot(id)).toBe(snap);
  }, 120_000);

  it("D — apostilamento: mesma retomada (o termo falhou; repetir o comando não cria um 2º apostilamento)", async () => {
    const { instrumentIdForCommand } = await import("../../domain/contractInstruments");
    const id = await seedContract("d2");
    const api = await caller(U.manager, ORG_A);
    const key = newKey();
    const input = { idempotencyKey: key, contractId: id, kind: "reajuste" as const, description: "Reajuste D2", newValue: 1100 };
    const instrumentId = instrumentIdForCommand("apostilamento", { organizationId: ORG_A, contractId: id, actorUserId: U.manager, idempotencyKey: key });
    const lineage = await instrumentLineage(ORG_A, id, "apostilamento", instrumentId);
    const holder = await mysql.createConnection(DB!);
    try {
      await holder.query("SELECT GET_LOCK(?, 5)", [`odoc:${ORG_A}:${lineage}`.slice(0, 60)]);
      expect((await err(api.contractWorkspace.createApostille(input)))?.message).toContain("OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE");
    } finally {
      await holder.query("SELECT RELEASE_LOCK(?)", [`odoc:${ORG_A}:${lineage}`.slice(0, 60)]).catch(() => {});
      await holder.end().catch(() => {});
    }
    const again = await api.contractWorkspace.createApostille(input);
    expect(again.apostille.id).toBe(instrumentId);
    expect(await n("SELECT COUNT(*) n FROM contract_ws_apostilles WHERE contract_id = ?", [id])).toBe(1);
    expect((await rows("SELECT version FROM official_documents WHERE tenant_id = ? AND lineage_id = ?", [ORG_A, lineage])).map((r) => r.version)).toEqual([1]);
  }, 120_000);

  it("E — mesma chave + payload DIFERENTE ⇒ CONFLICT (após conclusão e após falha parcial); nada gravado ou alterado", async () => {
    const id = await seedContract("e");
    const api = await caller(U.manager, ORG_A);
    const key = newKey();
    await api.contractWorkspace.createAddendum({ idempotencyKey: key, contractId: id, addendumType: "prazo", justification: "Original", newTerm: "18 meses" });
    const snap = await snapshot(id);
    for (const changed of [
      { addendumType: "prazo" as const, justification: "Outra justificativa", newTerm: "18 meses" },
      { addendumType: "prazo" as const, justification: "Original", newTerm: "24 meses" },
      { addendumType: "qualitativo" as const, justification: "Original", newTerm: "18 meses" },
    ]) {
      const e = await err(api.contractWorkspace.createAddendum({ idempotencyKey: key, contractId: id, ...changed }));
      expect(e?.code).toBe("CONFLICT");
      expect(e?.message).toContain("INSTRUMENT_COMMAND_PAYLOAD_MISMATCH");
    }
    expect(await snapshot(id)).toBe(snap);

    // Falha parcial (chave `failed`, aditivo gravado): payload diferente com a mesma chave ⇒ CONFLICT contra o REGISTRADO.
    const key2 = newKey();
    const { instrumentIdForCommand } = await import("../../domain/contractInstruments");
    const instrumentId = instrumentIdForCommand("aditivo", { organizationId: ORG_A, contractId: id, actorUserId: U.manager, idempotencyKey: key2 });
    const lineage = await instrumentLineage(ORG_A, id, "aditivo", instrumentId);
    const holder = await mysql.createConnection(DB!);
    try {
      await holder.query("SELECT GET_LOCK(?, 5)", [`odoc:${ORG_A}:${lineage}`.slice(0, 60)]);
      await err(api.contractWorkspace.createAddendum({ idempotencyKey: key2, contractId: id, addendumType: "prazo", justification: "Parcial", newTerm: "12 meses" }));
    } finally {
      await holder.query("SELECT RELEASE_LOCK(?)", [`odoc:${ORG_A}:${lineage}`.slice(0, 60)]).catch(() => {});
      await holder.end().catch(() => {});
    }
    const partial = await snapshot(id);
    const e2 = await err(api.contractWorkspace.createAddendum({ idempotencyKey: key2, contractId: id, addendumType: "prazo", justification: "Parcial ALTERADA", newTerm: "12 meses" }));
    expect(e2?.code).toBe("CONFLICT");
    expect(e2?.message).toContain("INSTRUMENT_COMMAND_PAYLOAD_MISMATCH");
    expect(await snapshot(id)).toBe(partial);
    expect((await rows("SELECT justification FROM contract_addenda WHERE id = ?", [instrumentId]))[0].justification).toBe("Parcial");
  }, 120_000);

  // ─── SEM084-B — apostilamento: `expectedUpdatedAt` é PRÉ-CONDIÇÃO (CAS) da 1ª gravação, NÃO payload idempotente ───
  it("E2 — apostilamento CONCLUÍDO + mesma chave + mesmos dados semânticos + expectedUpdatedAt DIFERENTE ⇒ mesmo apostilamento, nenhuma escrita, sem CONFLICT", async () => {
    const id = await seedContract("e2");
    const api = await caller(U.manager, ORG_A);
    const loaded = await api.contractWorkspace.loadContract({ contractId: id });
    const key = newKey();
    const semantic = { contractId: id, kind: "gestor" as const, description: "Designação E2", newManager: "Gestora E2" };
    const first = (await api.contractWorkspace.createApostille({ idempotencyKey: key, ...semantic, expectedUpdatedAt: loaded.workspace!.updatedAt })).apostille;
    const snap = await snapshot(id);
    // A revisão que o cliente viu mudou (o próprio apostilamento avançou o contrato) — ou o cliente mandou outra/nenhuma:
    for (const expectedUpdatedAt of ["2020-01-01T00:00:00.000Z", (await api.contractWorkspace.loadContract({ contractId: id })).workspace!.updatedAt, undefined]) {
      const again = (await api.contractWorkspace.createApostille({ idempotencyKey: key, ...semantic, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) })).apostille;
      expect(again.id).toBe(first.id);
    }
    expect(await snapshot(id)).toBe(snap); // nenhuma escrita: contrato, instrumentos, termos e timeline intactos
    expect(await n("SELECT COUNT(*) n FROM contract_ws_apostilles WHERE contract_id = ?", [id])).toBe(1);
  }, 120_000);

  it("E3 — apostilamento GRAVADO + termo FALHOU + mesma chave + mesmos dados semânticos + expectedUpdatedAt DIFERENTE ⇒ mesmo apostilamento; só o termo faltante é gerado", async () => {
    const { instrumentIdForCommand } = await import("../../domain/contractInstruments");
    const id = await seedContract("e3");
    const api = await caller(U.manager, ORG_A);
    const loaded = await api.contractWorkspace.loadContract({ contractId: id });
    const key = newKey();
    const semantic = { contractId: id, kind: "fiscal" as const, description: "Designação E3", newInspector: "Fiscal E3" };
    const instrumentId = instrumentIdForCommand("apostilamento", { organizationId: ORG_A, contractId: id, actorUserId: U.manager, idempotencyKey: key });
    const lineage = await instrumentLineage(ORG_A, id, "apostilamento", instrumentId);
    const holder = await mysql.createConnection(DB!);
    try {
      await holder.query("SELECT GET_LOCK(?, 5)", [`odoc:${ORG_A}:${lineage}`.slice(0, 60)]);
      const first = await err(api.contractWorkspace.createApostille({ idempotencyKey: key, ...semantic, expectedUpdatedAt: loaded.workspace!.updatedAt }));
      expect(first?.message).toContain("OFFICIAL_DOCUMENT_LOCK_UNAVAILABLE");
    } finally {
      await holder.query("SELECT RELEASE_LOCK(?)", [`odoc:${ORG_A}:${lineage}`.slice(0, 60)]).catch(() => {});
      await holder.end().catch(() => {});
    }
    // Estado parcial: apostilamento + designação + status gravados; termo ausente.
    expect((await rows("SELECT id FROM contract_ws_apostilles WHERE contract_id = ?", [id])).map((r) => r.id)).toEqual([instrumentId]);
    expect(await n("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND lineage_id = ?", [ORG_A, lineage])).toBe(0);
    const contractBefore = await rows("SELECT * FROM contract_workspaces WHERE id = ?", [id]);
    const apostilleBefore = await rows("SELECT * FROM contract_ws_apostilles WHERE id = ?", [instrumentId]);
    const changeEventsBefore = await n("SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND event_type = 'change'", [id]);
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND event_type = 'recommendation'", [id])).toBe(0);
    // A revisão original ficou VELHA (a 1ª tentativa avançou o contrato): a retomada não reaplica o CAS.
    const again = (await api.contractWorkspace.createApostille({ idempotencyKey: key, ...semantic, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" })).apostille;
    expect(again.id).toBe(instrumentId);
    expect(await n("SELECT COUNT(*) n FROM contract_ws_apostilles WHERE contract_id = ?", [id])).toBe(1);
    expect(await rows("SELECT * FROM contract_ws_apostilles WHERE id = ?", [instrumentId])).toEqual(apostilleBefore);
    expect(await rows("SELECT * FROM contract_workspaces WHERE id = ?", [id])).toEqual(contractBefore); // contrato NÃO regravado
    // Nenhum novo evento do INSTRUMENTO; exatamente um evento da geração do termo que faltava.
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND event_type = 'change'", [id])).toBe(changeEventsBefore);
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND event_type = 'recommendation'", [id])).toBe(1);
    expect((await rows("SELECT version FROM official_documents WHERE tenant_id = ? AND lineage_id = ?", [ORG_A, lineage])).map((r) => r.version)).toEqual([1]);
    expect(await n("SELECT COUNT(*) n FROM contract_ws_documents WHERE contract_id = ? AND kind = 'apostilamento'", [id])).toBe(1);
  }, 120_000);

  it("E4 — apostilamento: mesma chave mudando QUALQUER campo semântico (kind, description, newValue, newManager, newInspector) ⇒ CONFLICT; nada alterado", async () => {
    const api = await caller(U.manager, ORG_A);
    const cases: Array<{ tag: string; base: Record<string, unknown>; changed: Record<string, unknown>[] }> = [
      { tag: "e4r", base: { kind: "reajuste", description: "Reajuste E4", newValue: 1100 },
        changed: [{ kind: "reajuste", description: "Outra descrição", newValue: 1100 }, { kind: "reajuste", description: "Reajuste E4", newValue: 1200 }, { kind: "legal", description: "Reajuste E4", newValue: 1100 }] },
      { tag: "e4g", base: { kind: "gestor", description: "G", newManager: "Gestora A" }, changed: [{ kind: "gestor", description: "G", newManager: "Gestora B" }] },
      { tag: "e4f", base: { kind: "fiscal", description: "F", newInspector: "Fiscal A" }, changed: [{ kind: "fiscal", description: "F", newInspector: "Fiscal B" }] },
    ];
    for (const c of cases) {
      const id = await seedContract(c.tag);
      const key = newKey();
      await api.contractWorkspace.createApostille({ idempotencyKey: key, contractId: id, ...(c.base as any) });
      const snap = await snapshot(id);
      for (const changed of c.changed) {
        const e = await err(api.contractWorkspace.createApostille({ idempotencyKey: key, contractId: id, ...(changed as any) }));
        expect(e?.code, JSON.stringify(changed)).toBe("CONFLICT");
        expect(e?.message).toContain("INSTRUMENT_COMMAND_PAYLOAD_MISMATCH");
      }
      expect(await snapshot(id)).toBe(snap);
    }
  }, 180_000);

  it("F — 6 requisições CONCORRENTES com a MESMA chave ⇒ um aditivo, um termo v1, um evento; as demais devolvem o mesmo aditivo ou CONFLICT 'em andamento'", async () => {
    const id = await seedContract("f");
    const api = await caller(U.manager, ORG_A);
    const input = { idempotencyKey: newKey(), contractId: id, addendumType: "prazo" as const, justification: "Concorrente F", newTerm: "18 meses" };
    const settled = await Promise.allSettled(Array.from({ length: 6 }, () => api.contractWorkspace.createAddendum(input)));
    const ok = settled.filter((s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof api.contractWorkspace.createAddendum>>> => s.status === "fulfilled");
    const rejected = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
    expect(ok.length).toBeGreaterThanOrEqual(1);
    for (const r of rejected) {
      expect((r.reason as any)?.code).toBe("CONFLICT");
      expect(String((r.reason as Error).message)).toContain("INSTRUMENT_COMMAND_IN_PROGRESS");
    }
    const a = await rows<{ id: string }>("SELECT id FROM contract_addenda WHERE contract_id = ?", [id]);
    expect(a).toHaveLength(1);
    expect(new Set(ok.map((r) => r.value.addendum.id))).toEqual(new Set([a[0].id]));
    const lineage = await instrumentLineage(ORG_A, id, "aditivo", a[0].id);
    expect((await rows("SELECT version FROM official_documents WHERE tenant_id = ? AND lineage_id = ?", [ORG_A, lineage])).map((r) => r.version)).toEqual([1]);
    expect(await n("SELECT COUNT(*) n FROM process_timeline WHERE process_id = ? AND event_type = 'change'", [id])).toBe(1);
    // Depois da corrida, a mesma chave converge para o mesmo aditivo.
    expect((await api.contractWorkspace.createAddendum(input)).addendum.id).toBe(a[0].id);
    expect(await n("SELECT COUNT(*) n FROM contract_addenda WHERE contract_id = ?", [id])).toBe(1);
  }, 120_000);

  it("G — a mesma chave em OUTRO órgão é namespace independente; o contrato de A segue inacessível a B (NOT_FOUND), sem efeito", async () => {
    const idA = await seedContract("ga");
    const idB = await seedContract("gb", ORG_B, U.ownerB);
    const key = newKey();
    const apiA = await caller(U.manager, ORG_A);
    const apiB = await caller(U.ownerB, ORG_B);
    const ra = await apiA.contractWorkspace.createAddendum({ idempotencyKey: key, contractId: idA, addendumType: "prazo", justification: "Órgão A", newTerm: "18 meses" });
    const rb = await apiB.contractWorkspace.createAddendum({ idempotencyKey: key, contractId: idB, addendumType: "prazo", justification: "Órgão B (outro payload)", newTerm: "6 meses" });
    expect(ra.addendum.id).not.toBe(rb.addendum.id);
    expect((await rows("SELECT organization_id FROM contract_addenda WHERE id = ?", [ra.addendum.id]))[0].organization_id).toBe(ORG_A);
    expect((await rows("SELECT organization_id FROM contract_addenda WHERE id = ?", [rb.addendum.id]))[0].organization_id).toBe(ORG_B);
    // B tentando o contrato de A, com a MESMA chave ⇒ NOT_FOUND; nada muda em A.
    const snapA = await snapshot(idA);
    expect((await err(apiB.contractWorkspace.createAddendum({ idempotencyKey: key, contractId: idA, addendumType: "prazo", justification: "Órgão A", newTerm: "18 meses" })))?.code).toBe("NOT_FOUND");
    expect(await snapshot(idA)).toBe(snapA);
    // Outro USUÁRIO do mesmo órgão com a mesma chave ⇒ outra tentativa lógica (namespace por usuário).
    const apiOwner = await caller(U.owner, ORG_A);
    const ro = await apiOwner.contractWorkspace.createAddendum({ idempotencyKey: key, contractId: idA, addendumType: "prazo", justification: "Órgão A", newTerm: "18 meses" });
    expect(ro.addendum.id).not.toBe(ra.addendum.id);
    expect((await rows("SELECT sequence FROM contract_addenda WHERE contract_id = ? ORDER BY sequence", [idA])).map((r) => r.sequence)).toEqual([1, 2]);
  }, 120_000);
});

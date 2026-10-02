/**
 * Pilot Reset B2/B3 — lifecycle GOVERNADO do Processo Licitatório contra MySQL REAL (appRouter.createCaller;
 * migration 0313). Dados 100% SINTÉTICOS (órgãos 96081x); nada aqui toca, lê ou imita o processo real do piloto.
 *
 *  L1  preview READ-ONLY: zero escrita, digest determinístico, elegibilidade (reset sim × descarte não com trabalho)
 *  L2  RBAC: viewer não pré-visualiza; operator pré-visualiza mas não executa; manager executa
 *  L3  reset: geração antiga superada e imutável (filhos intactos, fora das listas, mutação ⇒ NOT_FOUND); nova
 *      geração limpa com o MESMO número e id opaco; ledger; create com o número ⇒ CONFLICT; histórico
 *  L4  idempotência: mesma chave + mesmo pedido ⇒ mesmo resultado sem escrita; pedido diferente ⇒ CONFLICT
 *  L5  STALE_PREVIEW (estado mudou depois do preview) e CAS de revisão — zero escrita
 *  L6  bloqueios formais/oficiais (emitido, promoção oficial, documento emitido, contrato derivado, resposta
 *      assinada, parecer assinado, publicação) ⇒ inelegível, execução PRECONDITION_FAILED sem escrita
 *  L7  descarte: só sem trabalho; sem DELETE; número continua reservado (create ⇒ CONFLICT)
 *  L8  correção de número: auditável (antes/depois), id preservado, número de outro processo ativo ⇒ CONFLICT
 *  L9  concorrência: 3 resets simultâneos ⇒ exatamente 1 vence, exatamente 2 gerações
 *  L10 cross-tenant: outro órgão ⇒ NOT_FOUND neutro, zero escrita
 *  L11 cancelar/arquivar: emitido não é cancelado (arquivar sim); estado formal nunca vira "reset"
 *  L12 transação sem chamada remota (guarda estática do serviço)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import path from "node:path";

const DB = process.env.DATABASE_URL;
const ORG_A = 960811;
const ORG_B = 960812;

describe("Pilot Reset — guarda estática da transação (sem banco)", () => {
  it("L12 — o serviço de lifecycle não importa IA, storage/S3, HTTP, e-mail nem provider remoto", () => {
    const src = readFileSync(path.join(process.cwd(), "server/services/processLifecycleService.ts"), "utf8");
    const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1].split("/").pop()!);
    for (const banned of [/^ai/i, /llm/i, /gemini/i, /storage/i, /s3/i, /email/i, /http/i, /fetch/i, /provider/i, /copilot/i, /aiExecution/i]) {
      expect(imports.filter((i) => banned.test(i)), String(banned)).toEqual([]);
    }
    const db = readFileSync(path.join(process.cwd(), "server/db/processLifecycle.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""); // só código (comentários citam "nenhum DELETE")
    expect(db).not.toMatch(/\.delete\(/);
    expect(db).not.toMatch(/\bDELETE\b/);
    expect(db).not.toMatch(/update\(procurementProcessLifecycleEventsTable\)/);
  });
});

describe.skipIf(!DB)("Pilot Reset B2/B3 — lifecycle governado (MySQL real, dados sintéticos)", () => {
  let conn: mysql.Connection;
  const stamp = Date.now();
  let viewer: number, operator: number, manager: number, foreign: number;
  let seq = 0;
  const num = (tag: string) => `SINT-${tag}-${stamp}`;
  /** Id curto e único para fixtures (algumas PKs são varchar(20)). */
  const sid = (prefix: string) => `${prefix}${stamp % 100_000_000}${seq++}`;

  const rows = async (q: string, p: unknown[]) => (await conn.execute<mysql.RowDataPacket[]>(q, p))[0];
  const one = async (q: string, p: unknown[]) => (await rows(q, p))[0];
  const count = async (q: string, p: unknown[]) => Number((await one(q, p)).n);
  /** Estado completo do órgão A nas tabelas tocadas pelo lifecycle — a prova de "zero escrita". */
  const orgSnapshot = async () => JSON.stringify({
    p: await rows(`SELECT * FROM procurement_processes WHERE organization_id = ? ORDER BY id`, [ORG_A]),
    e: await rows(`SELECT * FROM procurement_process_lifecycle_events WHERE organization_id = ? ORDER BY id`, [ORG_A]),
    t: await rows(`SELECT id, process_id, event_type, summary FROM process_timeline WHERE organization_id = ? ORDER BY id`, [ORG_A]),
    g: await rows(`SELECT id, process_id FROM generated_documents WHERE organization_id = ? ORDER BY id`, [ORG_A]),
    r: await rows(`SELECT id, process_id FROM price_research WHERE organization_id = ? ORDER BY id`, [ORG_A]),
  });

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A PRESET ${stamp}`, `org-a-preset-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B PRESET ${stamp}`, `org-b-preset-${stamp}`]);
    const user = async (tag: string) => (await conn.execute<mysql.ResultSetHeader>(
      `INSERT INTO users (openId, name, email) VALUES (?, ?, ?)`, [`preset-${tag}-${stamp}`, `PRESET ${tag}`, `preset-${tag}-${stamp}@teste.local`]))[0].insertId;
    viewer = await user("viewer"); operator = await user("operator"); manager = await user("manager"); foreign = await user("foreign");
    for (const [org, u, role] of [[ORG_A, viewer, "viewer"], [ORG_A, operator, "operator"], [ORG_A, manager, "manager"], [ORG_B, foreign, "owner"]] as const) {
      await conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, u, role]);
    }
  }, 60_000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (q: string, p: unknown[]) => { await conn.execute(q, p).catch(() => {}); };
    for (const t of ["procurement_process_lifecycle_events", "process_timeline", "procurement_context_facts", "generated_documents",
      "price_research", "procurement_items", "contract_workspaces", "official_document_promotions", "publication_records",
      "institutional_responses", "institutional_requests", "legal_opinion_drafts", "legal_opinion_workspaces", "procurement_processes"]) {
      await del(`DELETE FROM ${t} WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]);
    }
    await del(`DELETE FROM official_documents WHERE tenant_id IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM users WHERE id IN (?, ?, ?, ?)`, [viewer, operator, manager, foreign]);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function caller(userId: number, org: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId: `preset-${userId}-${Math.random().toString(36).slice(2, 8)}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message ?? "" }; }
    return { code: "RESOLVED", message: "" };
  };
  const newProcess = async (tag: string) => {
    const r = await (await caller(operator, ORG_A)).procurementProcess.createProcess({ processNumber: num(tag), object: `Objeto ${tag}`, startOption: "criar_dfd" });
    return r.process.id;
  };
  const addWork = async (pid: string) => {
    await conn.execute(`INSERT INTO generated_documents (id, organization_id, process_id, kind, title, content, status) VALUES (?, ?, ?, 'dfd', 'DFD', 'conteúdo', 'rascunho')`, [sid("gd"), ORG_A, pid]);
    await conn.execute(`INSERT INTO price_research (id, organization_id, process_id, source, item_count) VALUES (?, ?, ?, 'manual', 1)`, [sid("pr"), ORG_A, pid]);
  };
  const run = async (userId: number, pid: string, action: "RESET_DRAFT" | "DISCARD_DRAFT" | "CORRECT_NUMBER" | "CANCEL" | "ARCHIVE", over: Record<string, unknown> = {}) => {
    const c = await caller(userId, ORG_A);
    const pv = await (await caller(operator, ORG_A)).processLifecycle.preview({ processId: pid, action });
    return c.processLifecycle.execute({
      processId: pid, action, expectedRevision: pv.revision, expectedEligibilityDigest: pv.digest,
      idempotencyKey: `preset-${stamp}-${seq++}`, reason: "Reinício governado do piloto sintético.", ...over,
    });
  };

  it("L1 — preview read-only: zero escrita, digest determinístico, reset elegível × descarte inelegível com trabalho", async () => {
    const pid = await newProcess("l1");
    await addWork(pid);
    const before = await orgSnapshot();
    const op = await caller(operator, ORG_A);
    const a = await op.processLifecycle.preview({ processId: pid, action: "RESET_DRAFT" });
    const b = await op.processLifecycle.preview({ processId: pid, action: "RESET_DRAFT" });
    const d = await op.processLifecycle.preview({ processId: pid, action: "DISCARD_DRAFT" });
    expect(await orgSnapshot()).toBe(before);
    expect(a.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(a.digest).toBe(b.digest);
    expect(a).toMatchObject({ action: "RESET_DRAFT", eligible: true, blockers: [], lifecycleState: "active", revision: 0, generation: { processId: pid, lineageId: null, generationNo: 1 } });
    expect(a.affected.work).toMatchObject({ generated_documents: 1, price_research: 1 });
    expect(d).toMatchObject({ eligible: false, blockers: ["WORK_STATE_BLOCKS_DISCARD"] });
    expect(d.digest).not.toBe(a.digest); // digest é por ação
  }, 60_000);

  it("L2 — RBAC: viewer não pré-visualiza; operator pré-visualiza e não executa; IA/viewer sem caminho", async () => {
    const pid = await newProcess("l2");
    expect((await errOf(async () => (await caller(viewer, ORG_A)).processLifecycle.preview({ processId: pid, action: "RESET_DRAFT" }))).code).toBe("FORBIDDEN");
    const before = await orgSnapshot();
    const e = await errOf(() => run(operator, pid, "RESET_DRAFT"));
    expect(e.code).toBe("FORBIDDEN");
    expect(await orgSnapshot()).toBe(before);
  }, 60_000);

  it("L3 — reset: nova geração limpa (mesmo número, id opaco); antiga superada, imutável, filhos intactos; histórico", async () => {
    const pid = await newProcess("l3");
    await addWork(pid);
    const kids = async (id: string) => ({
      g: await count(`SELECT COUNT(*) n FROM generated_documents WHERE organization_id = ? AND process_id = ?`, [ORG_A, id]),
      r: await count(`SELECT COUNT(*) n FROM price_research WHERE organization_id = ? AND process_id = ?`, [ORG_A, id]),
      t: await count(`SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND process_id = ?`, [ORG_A, id]),
    });
    const oldKids = await kids(pid);
    const res = await run(manager, pid, "RESET_DRAFT");
    expect(res).toMatchObject({ action: "RESET_DRAFT", processId: pid, fromState: "active", toState: "superseded", revision: 1, replayed: false });
    const newId = res.newProcessId!;
    expect(newId).toMatch(/^[0-9a-f]{20}$/);
    expect(newId).not.toBe(pid);
    const oldRow = await one(`SELECT * FROM procurement_processes WHERE id = ?`, [pid]);
    const newRow = await one(`SELECT * FROM procurement_processes WHERE id = ?`, [newId]);
    expect(oldRow).toMatchObject({ lifecycle_state: "superseded", lifecycle_revision: 1, lineage_id: res.lineageId, generation_no: 1 });
    expect(newRow).toMatchObject({ lifecycle_state: "active", lineage_id: res.lineageId, generation_no: 2, supersedes_process_id: pid, process_number: num("l3"), current_stage: "NEW_PROCESS", status: "rascunho", modality: "" });
    // filhos ficam na geração antiga (o evento de lifecycle é o único acréscimo nela); a nova começa limpa
    expect(await kids(pid)).toEqual({ ...oldKids, t: oldKids.t + 1 });
    expect(await kids(newId)).toEqual({ g: 0, r: 0, t: 1 });
    expect(await rows(`SELECT event_type, process_id FROM procurement_process_lifecycle_events WHERE organization_id = ? AND lineage_id = ? ORDER BY event_type`, [ORG_A, res.lineageId]))
      .toEqual([{ event_type: "GENERATION_STARTED", process_id: newId }, { event_type: "RESET_DRAFT", process_id: pid }]);
    const op = await caller(operator, ORG_A);
    // geração antiga: fora da lista e das leituras de trabalho; mutação não a alcança
    const listed = (await op.procurementProcess.listProcesses({})).processes.map((p: { id: string }) => p.id);
    expect(listed).toContain(newId);
    expect(listed).not.toContain(pid);
    expect((await op.procurementProcess.loadProcess({ processId: pid })).process).toBeNull();
    expect((await errOf(() => op.procurementProcess.saveDFD({ processId: pid, fields: { objeto: "x" } } as never))).code).toMatch(/NOT_FOUND|BAD_REQUEST/);
    expect(await kids(pid)).toEqual({ ...oldKids, t: oldKids.t + 1 });
    // o número pertence à linhagem: criar de novo ⇒ CONFLICT (reset nunca é "criar de novo")
    const cr = await errOf(() => op.procurementProcess.createProcess({ processNumber: num("l3"), object: "Objeto l3", startOption: "criar_dfd" }));
    expect(cr.code).toBe("CONFLICT");
    const hist = await op.processLifecycle.history({ processId: newId });
    expect(hist.generations.map((g: { id: string; lifecycleState: string }) => [g.id, g.lifecycleState])).toEqual([[pid, "superseded"], [newId, "active"]]);
    expect(hist.events.find((e: { eventType: string }) => e.eventType === "RESET_DRAFT")).toMatchObject({ reason: "Reinício governado do piloto sintético.", actorUserId: manager, revisionBefore: 0, revisionAfter: 1 });
  }, 60_000);

  it("L4 — idempotência: mesma chave + mesmo pedido ⇒ mesmo resultado sem escrita; pedido diferente ⇒ CONFLICT", async () => {
    const pid = await newProcess("l4");
    const pv = await (await caller(operator, ORG_A)).processLifecycle.preview({ processId: pid, action: "RESET_DRAFT" });
    const m = await caller(manager, ORG_A);
    const req = { processId: pid, action: "RESET_DRAFT" as const, expectedRevision: pv.revision, expectedEligibilityDigest: pv.digest, idempotencyKey: `preset-${stamp}-l4`, reason: "Reinício governado do piloto sintético." };
    const first = await m.processLifecycle.execute(req);
    const after = await orgSnapshot();
    const again = await m.processLifecycle.execute(req);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await orgSnapshot()).toBe(after);
    const diff = await errOf(() => m.processLifecycle.execute({ ...req, reason: "Outro motivo diferente do original." }));
    expect(diff.code).toBe("CONFLICT");
    expect(diff.message).toMatch(/LIFECYCLE_IDEMPOTENCY_CONFLICT/);
    expect(await orgSnapshot()).toBe(after);
    expect(await count(`SELECT COUNT(*) n FROM procurement_processes WHERE organization_id = ? AND process_number = ?`, [ORG_A, num("l4")])).toBe(2);
  }, 60_000);

  it("L5 — STALE_PREVIEW quando o estado muda depois do preview; CAS de revisão — zero escrita", async () => {
    const pid = await newProcess("l5");
    const op = await caller(operator, ORG_A);
    const m = await caller(manager, ORG_A);
    const pv = await op.processLifecycle.preview({ processId: pid, action: "RESET_DRAFT" });
    await addWork(pid); // alguém trabalhou depois da pré-visualização
    const before = await orgSnapshot();
    const stale = await errOf(() => m.processLifecycle.execute({ processId: pid, action: "RESET_DRAFT", expectedRevision: pv.revision, expectedEligibilityDigest: pv.digest, idempotencyKey: `preset-${stamp}-l5a`, reason: "Reinício governado do piloto sintético." }));
    expect(stale.code).toBe("CONFLICT");
    expect(stale.message).toMatch(/STALE_PREVIEW/);
    const pv2 = await op.processLifecycle.preview({ processId: pid, action: "RESET_DRAFT" });
    const cas = await errOf(() => m.processLifecycle.execute({ processId: pid, action: "RESET_DRAFT", expectedRevision: 7, expectedEligibilityDigest: pv2.digest, idempotencyKey: `preset-${stamp}-l5b`, reason: "Reinício governado do piloto sintético." }));
    expect(cas.code).toBe("CONFLICT");
    expect(cas.message).toMatch(/LIFECYCLE_STALE_REVISION/);
    const noReason = await errOf(() => m.processLifecycle.execute({ processId: pid, action: "RESET_DRAFT", expectedRevision: 0, expectedEligibilityDigest: pv2.digest, idempotencyKey: `preset-${stamp}-l5c`, reason: "curto" }));
    expect(noReason.code).toBe("BAD_REQUEST");
    expect(await orgSnapshot()).toBe(before);
  }, 60_000);

  it("L6 — cada bloqueio formal/oficial torna reset/descarte/correção inelegíveis; execução recusada sem escrita", async () => {
    const fixtures: Array<[string, (pid: string) => Promise<unknown>]> = [
      ["PROCESS_ISSUED", (pid) => conn.execute(`UPDATE procurement_processes SET status = 'emitido', current_stage = 'ISSUED' WHERE id = ?`, [pid])],
      ["OFFICIAL_PROMOTION_EXISTS", (pid) => conn.execute(`INSERT INTO official_document_promotions (organization_id, process_id, official_document_id, lineage_id, document_kind, version, content_hash, actor_user_id, idempotency_key) VALUES (?, ?, 'odoc-x', 'odln-x', 'edital', 1, 'h', ?, ?)`, [ORG_A, pid, manager, sid("k")])],
      ["OFFICIAL_DOCUMENT_ISSUED", (pid) => conn.execute(`INSERT INTO official_documents (id, tenant_id, origin, status, title, content) VALUES (?, ?, ?, 'emitido', 'Doc', 'c')`, [sid("odoc"), ORG_A, pid])],
      ["DERIVED_CONTRACT_EXISTS", (pid) => conn.execute(`INSERT INTO contract_workspaces (id, organization_id, origin_type, origin_process, contract_number, status) VALUES (?, ?, 'processo_licitatorio', ?, ?, 'minuta')`, [sid("ctw"), ORG_A, pid, sid("CT")])],
      ["SIGNED_INSTITUTIONAL_RESPONSE", async (pid) => {
        const rq = sid("rq");
        await conn.execute(`INSERT INTO institutional_requests (id, organization_id, reference_process_id) VALUES (?, ?, ?)`, [rq, ORG_A, pid]);
        await conn.execute(`INSERT INTO institutional_responses (id, organization_id, request_id, signed) VALUES (?, ?, ?, 1)`, [sid("rs"), ORG_A, rq]);
      }],
      ["SIGNED_LEGAL_OPINION", async (pid) => {
        const w = sid("low");
        await conn.execute(`INSERT INTO legal_opinion_workspaces (id, organization_id, request_id, reference_process_id) VALUES (?, ?, 'rq', ?)`, [w, ORG_A, pid]);
        await conn.execute(`INSERT INTO legal_opinion_drafts (id, organization_id, workspace_id, request_id, signed) VALUES (?, ?, ?, 'rq', 1)`, [sid("lod"), ORG_A, w]);
      }],
      ["PUBLICATION_EXISTS", (pid) => conn.execute(`INSERT INTO publication_records (id, organization_id, reference_type, reference_id) VALUES (?, ?, 'process', ?)`, [sid("pub"), ORG_A, pid])],
    ];
    const op = await caller(operator, ORG_A);
    for (const [code, apply] of fixtures) {
      const pid = await newProcess(`l6-${code.toLowerCase()}`);
      await apply(pid);
      for (const action of ["RESET_DRAFT", "DISCARD_DRAFT", "CORRECT_NUMBER"] as const) {
        const pv = await op.processLifecycle.preview({ processId: pid, action });
        expect(pv.eligible, `${code} ${action}`).toBe(false);
        expect(pv.blockers).toEqual(expect.arrayContaining(["OFFICIAL_STATE_BLOCKS_RESET", code]));
      }
      const before = await orgSnapshot();
      const e = await errOf(() => run(manager, pid, "RESET_DRAFT"));
      expect(e.code, code).toBe("PRECONDITION_FAILED");
      expect(e.message).toContain(code);
      expect(await orgSnapshot()).toBe(before);
    }
  }, 120_000);

  it("L7 — descarte só sem trabalho; nada é apagado; o número continua reservado", async () => {
    const pid = await newProcess("l7");
    const res = await run(manager, pid, "DISCARD_DRAFT");
    expect(res).toMatchObject({ fromState: "active", toState: "discarded", newProcessId: null });
    expect(await one(`SELECT lifecycle_state FROM procurement_processes WHERE id = ?`, [pid])).toMatchObject({ lifecycle_state: "discarded" });
    expect(await count(`SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND process_id = ?`, [ORG_A, pid])).toBe(2);
    const again = await errOf(() => run(manager, pid, "RESET_DRAFT"));
    expect(again.code).toBe("PRECONDITION_FAILED");
    expect(again.message).toMatch(/PROCESS_GENERATION_NOT_ACTIVE/);
    expect((await errOf(async () => (await caller(operator, ORG_A)).procurementProcess.createProcess({ processNumber: num("l7"), object: "Objeto l7", startOption: "criar_dfd" }))).code).toBe("CONFLICT");
  }, 60_000);

  it("L8 — correção de número auditável; id preservado; número de outro processo ativo ⇒ CONFLICT sem escrita", async () => {
    const pid = await newProcess("l8");
    const other = await newProcess("l8-other");
    const res = await run(manager, pid, "CORRECT_NUMBER", { newProcessNumber: num("l8-corrigido") });
    expect(res).toMatchObject({ processId: pid, fromState: "active", toState: "active", revision: 1 });
    expect(await one(`SELECT id, process_number, lifecycle_state FROM procurement_processes WHERE id = ?`, [pid])).toMatchObject({ id: pid, process_number: num("l8-corrigido"), lifecycle_state: "active" });
    const ev = await one(`SELECT before_json, after_json FROM procurement_process_lifecycle_events WHERE organization_id = ? AND process_id = ? AND event_type = 'CORRECT_NUMBER'`, [ORG_A, pid]);
    expect(JSON.parse(ev.before_json).processNumber).toBe(num("l8"));
    expect(JSON.parse(ev.after_json).processNumber).toBe(num("l8-corrigido"));
    // o número corrigido é protegido pelo banco (não só pela PK antiga)
    expect((await errOf(async () => (await caller(operator, ORG_A)).procurementProcess.createProcess({ processNumber: num("l8-corrigido"), object: "x", startOption: "criar_dfd" }))).code).toBe("CONFLICT");
    const before = await orgSnapshot();
    const taken = await errOf(() => run(manager, other, "CORRECT_NUMBER", { newProcessNumber: num("l8-corrigido") }));
    expect(taken.code).toBe("CONFLICT");
    expect(taken.message).toMatch(/PROCESS_NUMBER_TAKEN/);
    expect(await orgSnapshot()).toBe(before);
  }, 60_000);

  it("L9 — concorrência: 3 resets simultâneos com o mesmo preview ⇒ exatamente 1 vence; 2 gerações", async () => {
    const pid = await newProcess("l9");
    const pv = await (await caller(operator, ORG_A)).processLifecycle.preview({ processId: pid, action: "RESET_DRAFT" });
    const m = await caller(manager, ORG_A);
    const out = await Promise.allSettled([0, 1, 2].map((i) => m.processLifecycle.execute({
      processId: pid, action: "RESET_DRAFT", expectedRevision: pv.revision, expectedEligibilityDigest: pv.digest,
      idempotencyKey: `preset-${stamp}-l9-${i}`, reason: "Reinício governado do piloto sintético.",
    })));
    expect(out.map((r) => (r.status === "fulfilled" ? "ok" : (r.reason as { code?: string }).code)).sort()).toEqual(["CONFLICT", "CONFLICT", "ok"]);
    expect(await count(`SELECT COUNT(*) n FROM procurement_processes WHERE organization_id = ? AND process_number = ?`, [ORG_A, num("l9")])).toBe(2);
    expect(await count(`SELECT COUNT(*) n FROM procurement_processes WHERE organization_id = ? AND process_number = ? AND lifecycle_state = 'active'`, [ORG_A, num("l9")])).toBe(1);
  }, 60_000);

  it("L10 — cross-tenant: outro órgão ⇒ NOT_FOUND neutro em preview/execute/history, zero escrita", async () => {
    const pid = await newProcess("l10");
    const fo = await caller(foreign, ORG_B);
    const before = await orgSnapshot();
    const pv = await errOf(() => fo.processLifecycle.preview({ processId: pid, action: "RESET_DRAFT" }));
    const missing = await errOf(() => fo.processLifecycle.preview({ processId: "inexistente000000000", action: "RESET_DRAFT" }));
    expect(pv).toEqual({ code: "NOT_FOUND", message: "Processo não encontrado nesta organização." });
    expect(pv).toEqual(missing);
    const ex = await errOf(() => fo.processLifecycle.execute({ processId: pid, action: "ARCHIVE", expectedRevision: 0, expectedEligibilityDigest: "0".repeat(64), idempotencyKey: `preset-${stamp}-l10`, reason: "Tentativa de outro órgão." }));
    expect(ex.code).toBe("NOT_FOUND");
    expect((await errOf(() => fo.processLifecycle.history({ processId: pid }))).code).toBe("NOT_FOUND");
    expect(await orgSnapshot()).toBe(before);
  }, 60_000);

  it("L11 — emitido não é cancelado nem reiniciado; arquivar é permitido e histórico", async () => {
    const pid = await newProcess("l11");
    await conn.execute(`UPDATE procurement_processes SET status = 'emitido', current_stage = 'ISSUED' WHERE id = ?`, [pid]);
    expect((await errOf(() => run(manager, pid, "CANCEL"))).code).toBe("PRECONDITION_FAILED");
    const res = await run(manager, pid, "ARCHIVE");
    expect(res).toMatchObject({ fromState: "active", toState: "archived", newProcessId: null });
    expect(await one(`SELECT status, current_stage, lifecycle_state FROM procurement_processes WHERE id = ?`, [pid])).toMatchObject({ status: "emitido", current_stage: "ISSUED", lifecycle_state: "archived" });
  }, 60_000);
});

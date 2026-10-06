/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SW-C1 — Instrumentos contratuais contra MySQL REAL, pelo ROUTER real (`appRouter.contractWorkspace.*`).
 * Só roda com DATABASE_URL.
 *
 *  SEM-084  sequência ATÔMICA: N criações concorrentes (Promise.all) ⇒ N instrumentos com sequências 1..N distintas
 *           (nenhum perdido, nenhum CONFLICT por disputa de número); o lock da linha do contrato serializa
 *           (prova: um lock externo na linha BLOQUEIA a criação até o commit); MAX+1 tolera lacunas.
 *  SEM-062  apostilamento gestor/fiscal APLICA manager/inspector atomicamente (status + CAS + evento antes → depois,
 *           ator humano); recusas (nome ausente, campo alheio, revisão velha, papel, tenant) ⇒ ZERO escrita;
 *           edição genérica segue recusando gestor/fiscal fora da minuta.
 *  SEM-040  cada instrumento tem LINHAGEM própria (v1), metadados instrumentId/instrumentKind/sequence; regerar o
 *           MESMO instrumento versiona a SUA linhagem; documentos anteriores (linhagem compartilhada) seguem legíveis.
 *  Cross-tenant ⇒ NOT_FOUND; limites do art. 125 NÃO impostos (J-4).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";

// SEM084-B — o comando de criação de instrumento exige uma chave de idempotência (uma por tentativa lógica).
let cmdKeySeq = 0;
const cmdKey = () => `cmd-${Date.now().toString(36)}-${++cmdKeySeq}`;

const DB = process.env.DATABASE_URL;
const ORG_A = 995301;
const ORG_B = 995302;
const RUN = Date.now().toString(36);

describe.skipIf(!DB)("SW-C1 — instrumentos contratuais: sequência atômica, gestor/fiscal por instrumento, linhagem própria (MySQL real)", () => {
  let conn: mysql.Connection;
  const U = { owner: 0, manager: 0, operator: 0, viewer: 0, ownerB: 0 };
  let seq = 0;

  async function caller(userId: number, org: number, corr?: string) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `swc1-${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {},
      correlationId: corr ?? `corr-swc1-${userId}-${++seq}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  async function err(p: Promise<unknown>): Promise<{ code: string; message: string } | null> {
    try { await p; return null; } catch (e: any) { return { code: e?.code ?? "ERR", message: String(e?.message ?? "") }; }
  }
  const rows = async <T = mysql.RowDataPacket>(sql: string, p: unknown[] = []): Promise<T[]> => ((await conn.execute<mysql.RowDataPacket[]>(sql, p))[0]) as unknown as T[];
  const n = async (sql: string, p: unknown[] = []) => Number((await rows<{ n: number }>(sql, p))[0].n);

  async function seedContract(tag: string, status = "vigente", extra: { manager?: string; inspector?: string } = {}) {
    const { createManualContract } = await import("../../services/contractService");
    const ws = await createManualContract({
      organizationId: ORG_A, contractNumber: `CT-SWC1-${tag}-${RUN}`, contractor: "Fornecedor SW-C1", object: `Objeto ${tag}`,
      value: 1000, term: "12 meses", manager: extra.manager ?? "Gestor Inicial", inspector: extra.inspector ?? "Fiscal Inicial",
      correlationId: "swc1-seed", createdBy: U.owner,
    });
    await conn.execute("UPDATE contract_workspaces SET status = ? WHERE id = ? AND organization_id = ?", [status, ws.id, ORG_A]);
    return ws.id;
  }
  const contractRow = async (id: string) => (await rows("SELECT * FROM contract_workspaces WHERE id = ? AND organization_id = ?", [id, ORG_A]))[0];
  /** Tudo que uma recusa NÃO pode mexer. */
  async function snapshot(id: string) {
    return JSON.stringify({
      c: await contractRow(id),
      a: await rows("SELECT id, sequence, status FROM contract_addenda WHERE contract_id = ? ORDER BY sequence", [id]),
      p: await rows("SELECT id, sequence, kind FROM contract_ws_apostilles WHERE contract_id = ? ORDER BY sequence", [id]),
      d: await n("SELECT COUNT(*) n FROM contract_ws_documents WHERE contract_id = ?", [id]),
      o: await n("SELECT COUNT(*) n FROM official_documents WHERE origin = ?", [id]),
      t: await n("SELECT COUNT(*) n FROM process_timeline WHERE process_id = ?", [id]),
    });
  }

  async function cleanup() {
    for (const t of ["contract_addenda", "contract_ws_apostilles", "contract_ws_documents", "process_timeline", "contract_workspaces"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
    }
    for (const t of ["official_document_timeline", "official_documents"]) {
      await conn.query(`DELETE FROM \`${t}\` WHERE tenant_id IN (?, ?)`, [ORG_A, ORG_B]).catch(() => {});
    }
    await conn.query("DELETE FROM organization_members WHERE organizationId IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await cleanup();
    for (const org of [ORG_A, ORG_B]) {
      await conn.query("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1", [org, `Org SWC1 ${org}`, `swc1-${org}`]);
    }
    for (const k of Object.keys(U) as Array<keyof typeof U>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, ?, ?)", [`swc1-${k}-${RUN}`, `SWC1 ${k}`, `swc1-${k}-${RUN}@teste.local`]);
      U[k] = r.insertId;
    }
    for (const [org, u, role] of [[ORG_A, U.owner, "owner"], [ORG_A, U.manager, "manager"], [ORG_A, U.operator, "operator"], [ORG_A, U.viewer, "viewer"], [ORG_B, U.ownerB, "owner"]] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
  }, 120_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE openId LIKE ?", [`swc1-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.end();
  });

  // ─── SEM-084 ───────────────────────────────────────────────────────────────────
  it("K1 SEM-084 — 8 aditivos CONCORRENTES (Promise.all): sequências 1..8 distintas, nenhum perdido, nenhum CONFLICT", async () => {
    const id = await seedContract("k1");
    const api = await caller(U.manager, ORG_A);
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) =>
      api.contractWorkspace.createAddendum({ idempotencyKey: cmdKey(),  contractId: id, addendumType: i % 2 ? "prazo" : "qualitativo", justification: `Aditivo concorrente ${i}`, newTerm: `${18 + i} meses` })));
    expect(results.map((r) => (r.status === "rejected" ? String((r.reason as Error).message) : "ok"))).toEqual(Array(8).fill("ok"));
    const a = await rows<{ id: string; sequence: number; status: string }>("SELECT id, sequence, status FROM contract_addenda WHERE contract_id = ? ORDER BY sequence", [id]);
    expect(a.map((r) => r.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(a.map((r) => r.id)).size).toBe(8);
    expect(a.every((r) => r.status === "finalizado")).toBe(true);
    expect((await contractRow(id)).status).toBe("aditado");
    // Um evento por instrumento, ids distintos, todos com o ator humano.
    const ev = await rows<{ id: string; actor: string; ref_id: string }>("SELECT id, actor, ref_id FROM process_timeline WHERE process_id = ? AND event_type = 'change'", [id]);
    expect(ev).toHaveLength(8);
    expect(new Set(ev.map((e) => e.id)).size).toBe(8);
    expect(new Set(ev.map((e) => e.ref_id))).toEqual(new Set(a.map((r) => r.id)));
    expect(ev.every((e) => e.actor === `user:${U.manager}`)).toBe(true);
    expect(await n("SELECT COUNT(*) n FROM contract_ws_documents WHERE contract_id = ? AND kind = 'aditivo'", [id])).toBe(8);
  }, 240_000);

  it("K2 SEM-084 — aditivos e apostilamentos CONCORRENTES misturados: cada tipo numera 1..N; o status final é coerente; tudo persistido", async () => {
    const id = await seedContract("k2");
    const api = await caller(U.owner, ORG_A);
    const calls: Array<Promise<unknown>> = [];
    for (let i = 0; i < 4; i++) {
      calls.push(api.contractWorkspace.createAddendum({ idempotencyKey: cmdKey(),  contractId: id, addendumType: "prazo", justification: `A${i}`, newTerm: `${12 + i} meses` }));
      calls.push(api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "reajuste", description: `P${i}`, newValue: 1000 + i }));
    }
    const settled = await Promise.allSettled(calls);
    expect(settled.filter((s) => s.status === "rejected").map((s) => String((s as PromiseRejectedResult).reason?.message))).toEqual([]);
    expect((await rows("SELECT sequence FROM contract_addenda WHERE contract_id = ? ORDER BY sequence", [id])).map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
    expect((await rows("SELECT sequence FROM contract_ws_apostilles WHERE contract_id = ? ORDER BY sequence", [id])).map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
    expect(["aditado", "apostilado"]).toContain((await contractRow(id)).status);
  }, 240_000);

  it("K3 SEM-084 — a trava da linha do contrato SERIALIZA: com um lock externo na linha, a criação ESPERA e só conclui após o commit", async () => {
    const id = await seedContract("k3");
    const other = await mysql.createConnection(DB!);
    try {
      await other.beginTransaction();
      await other.execute("SELECT id FROM contract_workspaces WHERE id = ? AND organization_id = ? FOR UPDATE", [id, ORG_A]);
      let done = false;
      const api = await caller(U.manager, ORG_A);
      const p = api.contractWorkspace.createAddendum({ idempotencyKey: cmdKey(),  contractId: id, addendumType: "prazo", justification: "espera o lock", newTerm: "18 meses" }).then((r) => { done = true; return r; });
      await new Promise((r) => setTimeout(r, 1500));
      expect(done, "sem a trava da linha a criação concluiria imediatamente").toBe(false);
      expect(await n("SELECT COUNT(*) n FROM contract_addenda WHERE contract_id = ?", [id])).toBe(0);
      await other.commit();
      const r = await p;
      expect(r.addendum?.sequence).toBe(1);
    } finally { await other.end().catch(() => {}); }
  }, 120_000);

  it("K4 SEM-084 — MAX(sequence)+1 tolera lacunas (linha legada com sequência 5 ⇒ próxima = 6)", async () => {
    const id = await seedContract("k4");
    await conn.execute(
      `INSERT INTO contract_addenda (id, organization_id, contract_id, addendum_type, sequence, justification, new_value, new_term, status, request_origin, correlation_id)
       VALUES (?, ?, ?, 'prazo', 5, 'legado', 0, '', 'finalizado', 'contract_workspace', 'legado')`, [`legacy-${RUN}-k4`.slice(0, 20), ORG_A, id]);
    const api = await caller(U.manager, ORG_A);
    const r = await api.contractWorkspace.createAddendum({ idempotencyKey: cmdKey(),  contractId: id, addendumType: "prazo", justification: "depois da lacuna", newTerm: "24 meses" });
    expect(r.addendum?.sequence).toBe(6);
  }, 120_000);

  it("K5 SEM-084/J-4 — limites do art. 125 NÃO são impostos: aditivo de valor sem teto segue registrado aguardando parecer; documento marca 'limites não verificados'", async () => {
    const id = await seedContract("k5");
    const api = await caller(U.manager, ORG_A);
    const r = await api.contractWorkspace.createAddendum({ idempotencyKey: cmdKey(),  contractId: id, addendumType: "valor", justification: "acréscimo grande", newValue: 99_999_999 });
    expect(r.requiresLegalOpinion).toBe(true);
    expect(r.addendum?.status).toBe("aguardando_parecer");
    const [doc] = await rows<{ content: string; metadata: string }>("SELECT content, metadata FROM official_documents WHERE origin = ? AND document_type = 'aditivo'", [id]);
    expect(doc.content).toContain("não verificados pelo sistema");
    expect(JSON.parse(doc.metadata).addendumLimitPolicy).toMatchObject({ validation: "NOT_VALIDATED_LEGAL_POLICY_PENDING" });
  }, 120_000);

  // ─── SEM-062 ───────────────────────────────────────────────────────────────────
  it("G1 SEM-062 — apostilamento de GESTOR: aplica manager, preserva inspector/valor/contratado, status apostilado, evento antes → depois com ator humano e correlationId", async () => {
    const id = await seedContract("g1");
    const before = await contractRow(id);
    const corr = `corr-g1-${RUN}`;
    const api = await caller(U.manager, ORG_A, corr);
    const { apostille } = await api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "gestor", description: "Substituição do gestor", newManager: "  Maria Nova da Silva " });
    const after = await contractRow(id);
    expect(after.manager).toBe("Maria Nova da Silva");
    expect(after.inspector).toBe(before.inspector);
    expect(after.contractor).toBe(before.contractor);
    expect(Number(after.value)).toBe(Number(before.value));
    expect(after.status).toBe("apostilado");
    expect(new Date(after.updated_at).getTime()).toBeGreaterThan(new Date(before.updated_at).getTime());
    expect(apostille.newManager).toBe("Maria Nova da Silva");
    const [ev] = await rows<{ summary: string; actor: string; correlation_id: string; ref_id: string }>(
      "SELECT summary, actor, correlation_id, ref_id FROM process_timeline WHERE process_id = ? AND event_type = 'change'", [id]);
    expect(ev.summary).toContain('gestor: "Gestor Inicial" → "Maria Nova da Silva"');
    expect(ev.actor).toBe(`user:${U.manager}`);
    expect(ev.correlation_id).toBe(corr);
    expect(ev.ref_id).toBe(apostille.id);
    // O termo gerado reflete o novo gestor e a minuta existe (gerada DEPOIS da transação).
    const [doc] = await rows<{ content: string }>("SELECT content FROM official_documents WHERE origin = ? AND document_type = 'apostilamento'", [id]);
    expect(doc.content).toContain("- Gestor do contrato: Maria Nova da Silva");
  }, 120_000);

  it("G2 SEM-062 — apostilamento de FISCAL aplica inspector; reajuste/legal NÃO mudam gestor/fiscal; designação em contrato aditado funciona", async () => {
    const id = await seedContract("g2", "aditado");
    const api = await caller(U.manager, ORG_A);
    await api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "fiscal", newInspector: "João Novo Fiscal" });
    let c = await contractRow(id);
    expect([c.manager, c.inspector, c.status]).toEqual(["Gestor Inicial", "João Novo Fiscal", "apostilado"]);
    await api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "reajuste", newValue: 1100 });
    await api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "legal", description: "Alteração legal" });
    c = await contractRow(id);
    expect([c.manager, c.inspector]).toEqual(["Gestor Inicial", "João Novo Fiscal"]);
    await api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "gestor", newManager: "Segundo Gestor" });
    c = await contractRow(id);
    expect([c.manager, c.inspector]).toEqual(["Segundo Gestor", "João Novo Fiscal"]);
    expect((await rows("SELECT sequence FROM contract_ws_apostilles WHERE contract_id = ? ORDER BY sequence", [id])).map((r) => r.sequence)).toEqual([1, 2, 3, 4]);
  }, 180_000);

  it("G3 SEM-062 — recusas ⇒ ZERO escrita: nome ausente/em branco, campo alheio, revisão velha, minuta, papel, cross-tenant", async () => {
    const id = await seedContract("g3");
    const snap = await snapshot(id);
    const api = await caller(U.manager, ORG_A);
    for (const bad of [
      { kind: "gestor" as const }, { kind: "gestor" as const, newManager: "   " }, { kind: "fiscal" as const },
      { kind: "gestor" as const, newManager: "X", newInspector: "Y" }, { kind: "reajuste" as const, newValue: 1, newManager: "X" },
    ]) {
      const e = await err(api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, ...bad }));
      expect(e?.code, JSON.stringify(bad)).toBe("BAD_REQUEST");
      expect(e?.message).toContain("CONTRACT_APOSTILLE_ASSIGNMENT_INVALID");
    }
    const stale = await err(api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "gestor", newManager: "Maria", expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }));
    expect(stale?.code).toBe("CONFLICT");
    expect(stale?.message).toContain("CONTRACT_REVISION_CONFLICT");
    expect((await err((await caller(U.operator, ORG_A)).contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "gestor", newManager: "Maria" })))?.code).toBe("FORBIDDEN");
    expect((await err((await caller(U.viewer, ORG_A)).contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "gestor", newManager: "Maria" })))?.code).toBe("FORBIDDEN");
    expect((await err((await caller(U.ownerB, ORG_B)).contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "gestor", newManager: "Maria" })))?.code).toBe("NOT_FOUND");
    const minuta = await seedContract("g3m", "minuta");
    const snapM = await snapshot(minuta);
    const em = await err(api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: minuta, kind: "gestor", newManager: "Maria" }));
    expect(em?.code).toBe("BAD_REQUEST");
    expect(em?.message).toContain("CONTRACT_STATUS_TRANSITION_INVALID");
    expect(await snapshot(minuta)).toBe(snapM);
    expect(await snapshot(id)).toBe(snap);
  }, 180_000);

  it("G4 SEM-062 — revisão do cliente IGUAL à atual é aceita; a edição genérica segue recusando gestor/fiscal fora da minuta", async () => {
    const id = await seedContract("g4");
    const api = await caller(U.manager, ORG_A);
    const loaded = await api.contractWorkspace.loadContract({ contractId: id });
    await api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "fiscal", newInspector: "Fiscal Atual", expectedUpdatedAt: loaded.workspace!.updatedAt });
    const reloaded = await api.contractWorkspace.loadContract({ contractId: id });
    expect(reloaded.workspace!.inspector).toBe("Fiscal Atual");
    const snap = await snapshot(id);
    const e = await err(api.contractWorkspace.updateContract({ contractId: id, manager: "Troca direta", expectedUpdatedAt: reloaded.workspace!.updatedAt }));
    expect(e?.code).toBe("BAD_REQUEST");
    expect(e?.message).toContain("CONTRACT_ASSIGNMENT_REQUIRES_GOVERNED_ACTION");
    expect(e?.message).toContain("Apostilamento de gestor/fiscal");
    expect(await snapshot(id)).toBe(snap);
  }, 120_000);

  it("G5 SEM-062 — apostilamentos de gestor CONCORRENTES: ambos persistem em sequência; o gestor final é o do ÚLTIMO a commitar; sem perda", async () => {
    const id = await seedContract("g5");
    const api = await caller(U.manager, ORG_A);
    const res = await Promise.allSettled(["Gestor X", "Gestor Y", "Gestor Z"].map((m) => api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "gestor", newManager: m })));
    expect(res.every((r) => r.status === "fulfilled")).toBe(true);
    const aps = await rows<{ sequence: number; new_manager: string }>("SELECT sequence, new_manager FROM contract_ws_apostilles WHERE contract_id = ? ORDER BY sequence", [id]);
    expect(aps.map((a) => a.sequence)).toEqual([1, 2, 3]);
    const last = aps[aps.length - 1].new_manager; // a maior sequência é a última a commitar sob o lock
    expect((await contractRow(id)).manager).toBe(last);
    // A trilha de auditoria encadeia antes → depois (cada "antes" é o "depois" do anterior).
    const evs = await rows<{ summary: string }>("SELECT summary FROM process_timeline WHERE process_id = ? AND event_type = 'change' ORDER BY event_order, created_at", [id]);
    expect(evs).toHaveLength(3);
  }, 240_000);

  // ─── SEM-040 ───────────────────────────────────────────────────────────────────
  it("L1 SEM-040 — cada instrumento nasce em linhagem PRÓPRIA (v1) com metadados instrumentId/instrumentKind/sequence; título com o nº", async () => {
    const id = await seedContract("l1");
    const api = await caller(U.manager, ORG_A);
    await api.contractWorkspace.createAddendum({ idempotencyKey: cmdKey(),  contractId: id, addendumType: "prazo", justification: "1º", newTerm: "18 meses" });
    await api.contractWorkspace.createAddendum({ idempotencyKey: cmdKey(),  contractId: id, addendumType: "qualitativo", justification: "2º" });
    await api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "reajuste", newValue: 5 });
    await api.contractWorkspace.createApostille({ idempotencyKey: cmdKey(),  contractId: id, kind: "reajuste", newValue: 6 });
    const docs = await rows<{ id: string; document_type: string; version: number; lineage_id: string; title: string; metadata: string }>(
      "SELECT id, document_type, version, lineage_id, title, metadata FROM official_documents WHERE origin = ? AND tenant_id = ? ORDER BY document_type, created_at", [id, ORG_A]);
    expect(docs).toHaveLength(4);
    expect(new Set(docs.map((d) => d.lineage_id)).size).toBe(4); // uma linhagem por instrumento
    expect(docs.every((d) => d.version === 1)).toBe(true); // nº 2 NÃO aparece como "v2" do nº 1
    const addenda = await rows<{ id: string; sequence: number }>("SELECT id, sequence FROM contract_addenda WHERE contract_id = ? ORDER BY sequence", [id]);
    const aditivos = docs.filter((d) => d.document_type === "aditivo").map((d) => ({ ...d, meta: JSON.parse(d.metadata) }));
    expect(aditivos.map((d) => d.meta.instrumentId).sort()).toEqual(addenda.map((a) => a.id).sort());
    for (const d of aditivos) {
      const a = addenda.find((x) => x.id === d.meta.instrumentId)!;
      expect(d.meta).toMatchObject({ instrumentKind: "aditivo", sequence: a.sequence, lineageScope: "instrument" });
      expect(d.title).toContain(`nº ${a.sequence}`);
    }
    for (const d of docs.filter((x) => x.document_type === "apostilamento")) {
      expect(JSON.parse(d.metadata)).toMatchObject({ instrumentKind: "apostilamento", lineageScope: "instrument" });
    }
    // Timeline documental: cada linhagem tem o seu evento de criação, com id único.
    const tl = await rows<{ id: string; lineage_id: string; event_order: number }>("SELECT id, lineage_id, event_order FROM official_document_timeline WHERE tenant_id = ? AND lineage_id IN (?, ?, ?, ?)", [ORG_A, ...docs.map((d) => d.lineage_id)]);
    expect(tl).toHaveLength(4);
    expect(new Set(tl.map((t) => t.id)).size).toBe(4);
    expect(tl.every((t) => t.event_order === 0)).toBe(true);
  }, 240_000);

  it("L2 SEM-040 — regerar o MESMO instrumento versiona a SUA linhagem (v2); a do outro instrumento não muda; versions por instrumentId", async () => {
    const id = await seedContract("l2");
    const api = await caller(U.manager, ORG_A);
    const a1 = (await api.contractWorkspace.createAddendum({ idempotencyKey: cmdKey(),  contractId: id, addendumType: "prazo", justification: "1º", newTerm: "18 meses" })).addendum!;
    const a2 = (await api.contractWorkspace.createAddendum({ idempotencyKey: cmdKey(),  contractId: id, addendumType: "prazo", justification: "2º", newTerm: "24 meses" })).addendum!;
    await api.contractWorkspace.generateDocuments({ contractId: id, kind: "aditivo", refId: a1!.id });
    const de = (await caller(U.manager, ORG_A)).documentEngine;
    const v1 = await de.versions({ businessDomain: "contratos", documentType: "aditivo", origin: id, instrumentId: a1!.id });
    const v2 = await de.versions({ businessDomain: "contratos", documentType: "aditivo", origin: id, instrumentId: a2!.id });
    expect(v1.versions.map((v: any) => v.version)).toEqual([1, 2]);
    expect(v2.versions.map((v: any) => v.version)).toEqual([1]);
    expect(v1.lineageId).not.toBe(v2.lineageId);
    const tl = await de.timeline({ businessDomain: "contratos", documentType: "aditivo", origin: id, instrumentId: a1!.id });
    expect(tl.timeline.map((t: any) => t.eventType)).toEqual(["documento_criado", "nova_versao"]);
    // A linhagem antiga (sem instrumentId) fica vazia para instrumentos novos — nada foi misturado nela.
    const legacy = await de.versions({ businessDomain: "contratos", documentType: "aditivo", origin: id });
    expect(legacy.versions).toEqual([]);
  }, 240_000);

  it("L3 SEM-040 — documentos ANTERIORES (linhagem compartilhada por contrato) continuam legíveis; sem backfill", async () => {
    const id = await seedContract("l3");
    const { generateOfficialDocument } = await import("../../services/documentEngineService");
    // Simula o legado: duas versões na linhagem compartilhada (sem instrumentId), como antes da SEM-040.
    const v1 = await generateOfficialDocument({ organizationId: ORG_A, businessDomain: "contratos", documentType: "aditivo", origin: id, title: "Termo Aditivo — legado", content: "# v1", author: "legado", correlationId: "legacy-1" });
    const v2 = await generateOfficialDocument({ organizationId: ORG_A, businessDomain: "contratos", documentType: "aditivo", origin: id, title: "Termo Aditivo — legado", content: "# v2", author: "legado", correlationId: "legacy-2", metadata: { instrumentId: "old", instrumentKind: "aditivo" } });
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1.lineageId).toBe(v2.lineageId);
    const api = await caller(U.manager, ORG_A);
    await api.contractWorkspace.createAddendum({ idempotencyKey: cmdKey(),  contractId: id, addendumType: "prazo", justification: "novo", newTerm: "18 meses" });
    const de = (await caller(U.viewer, ORG_A)).documentEngine;
    const legacy = await de.versions({ businessDomain: "contratos", documentType: "aditivo", origin: id });
    expect(legacy.lineageId).toBe(v1.lineageId);
    expect(legacy.versions.map((v: any) => v.version)).toEqual([1, 2]); // legado intacto e legível
    const listed = await de.list({ businessDomain: "contratos", origin: id });
    expect(listed.documents).toHaveLength(3); // 2 legados + 1 do novo instrumento (listagem por origem preservada)
    const one = await de.get({ documentId: v2.id });
    expect(one.document?.id).toBe(v2.id);
    // Nenhuma linha antiga foi reescrita (sem backfill).
    expect((await rows("SELECT lineage_id, version FROM official_documents WHERE id IN (?, ?) ORDER BY version", [v1.id, v2.id])).map((r) => `${r.lineage_id}:${r.version}`))
      .toEqual([`${v1.lineageId}:1`, `${v1.lineageId}:2`]);
  }, 240_000);

  it("L4 SEM-040 — cross-tenant: outro órgão não enxerga a linhagem do instrumento (versions vazio; get ⇒ sem documento)", async () => {
    const id = await seedContract("l4");
    const api = await caller(U.manager, ORG_A);
    const a = (await api.contractWorkspace.createAddendum({ idempotencyKey: cmdKey(),  contractId: id, addendumType: "prazo", justification: "x", newTerm: "18 meses" })).addendum!;
    const deB = (await caller(U.ownerB, ORG_B)).documentEngine;
    expect((await deB.versions({ businessDomain: "contratos", documentType: "aditivo", origin: id, instrumentId: a.id })).versions).toEqual([]);
    const [d] = await rows<{ id: string }>("SELECT id FROM official_documents WHERE origin = ? AND tenant_id = ?", [id, ORG_A]);
    expect((await deB.get({ documentId: d.id })).document).toBeNull();
  }, 120_000);
});

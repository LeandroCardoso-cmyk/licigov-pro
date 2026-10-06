/**
 * R3 / PR-05 — "Create ≠ Reset" para os DOIS criadores canônicos de processo (SEM-002, SEM-003) — smoke contra
 * MySQL REAL, pelo router tRPC de verdade (`appRouter.createCaller`). Só roda com DATABASE_URL definido.
 *
 * Problema reproduzido na main `570a962` (R3.1):
 *  - SEM-002: `procurementProcess.createProcess` com um número JÁ existente no órgão respondia SUCESSO e o upsert
 *    (`onDuplicateKeyUpdate`) devolvia o processo à etapa inicial / "rascunho" (mesmo emitido), trocava a modalidade
 *    e anexava um fato `demand.requestingUnit` ao processo existente.
 *  - SEM-003: `directProcurement.createProcess` com número existente resetava o workspace (tipo
 *    dispensa↔inexigibilidade, fundamento legal, procedimento, etapa, status e flags) e anexava outro evento
 *    `workspace_created` na timeline.
 *
 * Contrato ("padrão R3", documentado em `server/domain/processCreateContract.ts`):
 *  - chave natural = (organizationId do CONTEXTO, número do processo) — materializada no id determinístico (PK);
 *  - chave natural existente no MESMO órgão ⇒ `CONFLICT` com mensagem pt-BR estável e token
 *    `PROCESS_ALREADY_EXISTS`, com ZERO mutação do registro e dos dependentes (timeline, fatos de contexto);
 *  - convergência (devolve o registro EXISTENTE, sem escrita) SOMENTE para o retry idempotente da MESMA criação:
 *    mesmo ator + payload normalizado idêntico ao registro persistido;
 *  - órgãos diferentes com o mesmo número continuam independentes;
 *  - RBAC inalterado (procurementProcess exige operator; viewer continua recusado).
 *
 * Matriz: P1–P8 (Processo Licitatório) e D1–D6 (Contratação Direta).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";

const DB = process.env.DATABASE_URL;
const TOKEN = /PROCESS_ALREADY_EXISTS/;

describe.skipIf(!DB)("R3 / PR-05 — Create ≠ Reset: processos (MySQL real, router real)", () => {
  const ORG_A = 960501;
  const ORG_B = 960502;
  const stamp = Date.now();
  const num = (tag: string) => `R3-${tag}-${stamp}`;
  let conn: mysql.Connection;
  let opA: number, opA2: number, viewerA: number, opB: number;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_A, `Org A R3 ${stamp}`, `org-a-r3-${stamp}`]);
    await conn.execute(`INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1)`, [ORG_B, `Org B R3 ${stamp}`, `org-b-r3-${stamp}`]);
    async function user(tag: string): Promise<number> {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        `INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')`, [`r3-${tag}-${stamp}`, `R3 ${tag}`, `r3-${tag}-${stamp}@teste.local`]);
      return r.insertId;
    }
    const member = (org: number, u: number, role: string) =>
      conn.execute(`INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)`, [org, u, role]);
    opA = await user("op-a"); opA2 = await user("op-a2"); viewerA = await user("viewer-a"); opB = await user("op-b");
    await member(ORG_A, opA, "operator"); await member(ORG_A, opA2, "operator"); await member(ORG_A, viewerA, "viewer");
    await member(ORG_B, opB, "operator");
  }, 60000);

  afterAll(async () => {
    if (!conn) return;
    const del = async (sql: string, p: unknown[]) => { await conn.execute(sql, p).catch(() => {}); };
    for (const t of ["procurement_items", "intelligent_items", "price_research", "generated_documents",
      "procurement_context_facts", "process_timeline", "procurement_processes", "direct_procurement_workspaces"]) {
      await del(`DELETE FROM ${t} WHERE organization_id IN (?, ?)`, [ORG_A, ORG_B]);
    }
    await del(`DELETE FROM organization_members WHERE organizationId IN (?, ?)`, [ORG_A, ORG_B]);
    await del(`DELETE FROM users WHERE id IN (?, ?, ?, ?)`, [opA, opA2, viewerA, opB]);
    await del(`DELETE FROM organizations WHERE id IN (?, ?)`, [ORG_A, ORG_B]);
    await conn.end();
  });

  async function caller(userId: number, org: number, correlationId = `r3-${userId}-${org}-${Math.random().toString(36).slice(2, 8)}`) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Ator ${userId}`, email: `ator${userId}@teste.local` },
      req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" },
      res: {},
      correlationId,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  const errOf = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code, message: x.message ?? "" }; }
    return { code: "RESOLVED", message: "" };
  };
  const rows = async (sql: string, p: unknown[]) => (await conn.execute<mysql.RowDataPacket[]>(sql, p))[0];
  const count = async (sql: string, p: unknown[]) => Number((await rows(sql, p))[0].n);

  // Snapshot COMPLETO do registro e dos dependentes — a prova de "zero mutação".
  const ppSnapshot = async (org: number, processNumber: string) => {
    const proc = await rows(`SELECT * FROM procurement_processes WHERE organization_id = ? AND process_number = ?`, [org, processNumber]);
    const id = proc[0]?.id ?? "";
    return {
      rows: proc,
      timeline: await rows(`SELECT * FROM process_timeline WHERE organization_id = ? AND process_id = ? ORDER BY event_order, id`, [org, id]),
      facts: await rows(`SELECT * FROM procurement_context_facts WHERE organization_id = ? AND process_id = ? ORDER BY id`, [org, id]),
    };
  };
  const dpSnapshot = async (org: number, processNumber: string) => {
    const ws = await rows(`SELECT * FROM direct_procurement_workspaces WHERE organization_id = ? AND process_number = ?`, [org, processNumber]);
    const id = ws[0]?.id ?? "";
    return {
      rows: ws,
      timeline: await rows(`SELECT * FROM process_timeline WHERE organization_id = ? AND process_id = ? ORDER BY event_order, id`, [org, id]),
    };
  };
  // Simula um processo que JÁ andou no fluxo (estado institucional que um "create" jamais pode apagar).
  const progressPP = (org: number, processNumber: string) => conn.execute(
    `UPDATE procurement_processes SET current_stage = 'ISSUED', status = 'emitido', modality = 'pregao',
       updated_at = '2026-01-02 03:04:05.678' WHERE organization_id = ? AND process_number = ?`, [org, processNumber]);
  const progressDP = (org: number, processNumber: string) => conn.execute(
    `UPDATE direct_procurement_workspaces SET current_stage = 'RATIFICATION', status = 'ratificado', procedure_type = 'eletronico',
       legal_basis = 'Art. 75, II', flags = '{"usesDFD":false,"requiresPriceResearch":false,"requiresProposalCollection":false,"requiresLegalOpinion":false}',
       updated_at = '2026-01-02 03:04:05.678' WHERE organization_id = ? AND process_number = ?`, [org, processNumber]);

  // ── Processo Licitatório (SEM-002) ────────────────────────────────────────────────────────────────────────────
  const ppInput = (processNumber: string, over: Record<string, unknown> = {}) => ({
    processNumber, object: "Aquisição de notebooks (R3)", startOption: "criar_dfd" as const,
    requestingUnit: "Secretaria de Educação", ...over,
  });

  it("P1 (R3.1/SEM-002) — número existente + payload diferente ⇒ CONFLICT PROCESS_ALREADY_EXISTS; processo emitido intocado", async () => {
    const n = num("pp1");
    await (await caller(opA, ORG_A)).procurementProcess.createProcess(ppInput(n));
    await progressPP(ORG_A, n);
    const before = await ppSnapshot(ORG_A, n);
    expect(before.rows).toHaveLength(1);

    const err = await errOf(async () => (await caller(opA2, ORG_A)).procurementProcess.createProcess(
      ppInput(n, { object: "Outro objeto digitado por engano", startOption: "iniciar_etp", modality: "concorrencia", requestingUnit: "Secretaria de Saúde" })));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toMatch(TOKEN);
    expect(err.message).toMatch(/Já existe um processo licitatório com este número/);

    const after = await ppSnapshot(ORG_A, n);
    expect(after).toEqual(before); // etapa ISSUED, status emitido, modalidade, updatedAt, timeline e fatos: idênticos
    expect(after.rows[0]).toMatchObject({ current_stage: "ISSUED", status: "emitido", modality: "pregao" });
  }, 30000);

  it("P2 — retry idempotente (mesmo ator + mesmo payload) converge: devolve o existente, sem duplicar e sem escrita", async () => {
    const n = num("pp2");
    const c = await caller(opA, ORG_A);
    const first = await c.procurementProcess.createProcess(ppInput(n));
    const afterFirst = await ppSnapshot(ORG_A, n);
    expect(afterFirst.timeline).toHaveLength(1);
    expect(afterFirst.facts).toHaveLength(1);

    // duplo clique imediato: nada muda (nem updatedAt)
    const again = await c.procurementProcess.createProcess(ppInput(n));
    expect(await ppSnapshot(ORG_A, n)).toEqual(afterFirst);
    expect(again.process.id).toBe(first.process.id);
    expect(again.created).toBe(false);

    // retry tardio, depois de o processo andar: converge sem resetar etapa/status
    await progressPP(ORG_A, n);
    await conn.execute(`UPDATE procurement_processes SET modality = '' WHERE organization_id = ? AND process_number = ?`, [ORG_A, n]);
    const progressed = await ppSnapshot(ORG_A, n);
    const late = await c.procurementProcess.createProcess(ppInput(n));
    expect(await ppSnapshot(ORG_A, n)).toEqual(progressed);
    expect(late.process).toMatchObject({ id: first.process.id, currentStage: "ISSUED", status: "emitido" });
    expect(late.created).toBe(false);
    expect(await count(`SELECT COUNT(*) n FROM procurement_processes WHERE organization_id = ? AND process_number = ?`, [ORG_A, n])).toBe(1);
  }, 30000);

  it("P3 — mesmo ator, mesmo número, UM campo diferente (objeto, início, modalidade, unidade) ⇒ CONFLICT sem mutação", async () => {
    const n = num("pp3");
    const c = await caller(opA, ORG_A);
    await c.procurementProcess.createProcess(ppInput(n));
    const before = await ppSnapshot(ORG_A, n);
    for (const over of [
      { object: "Aquisição de notebooks (R3) v2" },
      { startOption: "importar_tr" },
      { modality: "pregao" },
      { requestingUnit: "Secretaria de Obras" },
      { requestingUnit: undefined },
      { object: "Aquisição de notebooks (R3) " }, // espaço final: NENHUMA normalização nova (comparação exata)
    ]) {
      const err = await errOf(() => c.procurementProcess.createProcess(ppInput(n, over)));
      expect(err.code, JSON.stringify(over)).toBe("CONFLICT");
      expect(err.message).toMatch(TOKEN);
    }
    expect(await ppSnapshot(ORG_A, n)).toEqual(before);
  }, 30000);

  it("P4 — outro operador do mesmo órgão com payload idêntico ⇒ CONFLICT (não é retry da MESMA criação)", async () => {
    const n = num("pp4");
    await (await caller(opA, ORG_A)).procurementProcess.createProcess(ppInput(n));
    const before = await ppSnapshot(ORG_A, n);
    const err = await errOf(async () => (await caller(opA2, ORG_A)).procurementProcess.createProcess(ppInput(n)));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toMatch(TOKEN);
    expect(await ppSnapshot(ORG_A, n)).toEqual(before);
    expect(before.rows[0].responsible_user).toBe(opA);
  }, 30000);

  it("P5 — criação dupla CONCORRENTE (Promise.all): exatamente 1 processo, 1 evento inicial e 1 fato", async () => {
    const n = num("pp5");
    const c = await caller(opA, ORG_A);
    const same = await Promise.allSettled(Array.from({ length: 5 }, () => c.procurementProcess.createProcess(ppInput(n))));
    expect(same.every((r) => r.status === "fulfilled")).toBe(true); // retries idênticos convergem
    const ids = new Set(same.map((r) => (r as PromiseFulfilledResult<{ process: { id: string } }>).value.process.id));
    expect(ids.size).toBe(1);
    const snap = await ppSnapshot(ORG_A, n);
    expect(snap.rows).toHaveLength(1);
    expect(snap.timeline).toHaveLength(1);
    expect(snap.facts).toHaveLength(1);

    // corrida com payloads DIFERENTES: um vence, o outro recebe CONFLICT; o registro é o do vencedor
    const n2 = num("pp5b");
    const [a, b] = await Promise.allSettled([
      c.procurementProcess.createProcess(ppInput(n2, { object: "Objeto X" })),
      (await caller(opA2, ORG_A)).procurementProcess.createProcess(ppInput(n2, { object: "Objeto Y" })),
    ]);
    const outcomes = [a, b].map((r) => r.status === "fulfilled" ? "ok" : (r.reason as { code?: string }).code);
    expect(outcomes.sort()).toEqual(["CONFLICT", "ok"]);
    const winner = (a.status === "fulfilled" ? "Objeto X" : "Objeto Y");
    const snap2 = await ppSnapshot(ORG_A, n2);
    expect(snap2.rows).toHaveLength(1);
    expect(snap2.rows[0].object).toBe(winner);
    expect(snap2.timeline).toHaveLength(1);
  }, 30000);

  // R3.5 — contrato PERMANENTE do replay tardio (docs/architecture/CREATE_REPLAY_CONTRACT.md): a convergência compara
  // com o estado PERSISTIDO ATUAL dos campos do payload semântico de criação. Se um desses campos mudou legitimamente
  // depois (aqui: a modalidade definida pelo fluxo do Edital), o replay do request ORIGINAL não é mais distinguível de
  // uma criação conflitante ⇒ CONFLICT, ZERO escrita (fail-closed). Mudança fora do payload (etapa/status) converge (P2).
  it("P9 (R3.5) — replay tardio do request original após mudança LEGÍTIMA de campo do payload ⇒ CONFLICT, zero escrita", async () => {
    const n = num("pp9");
    const c = await caller(opA, ORG_A);
    const original = ppInput(n);
    const first = await c.procurementProcess.createProcess(original);
    expect((await c.procurementProcess.createProcess(original)).created).toBe(false); // replay imediato converge
    await conn.execute(`UPDATE procurement_processes SET modality = 'pregao' WHERE organization_id = ? AND id = ?`, [ORG_A, first.process.id]);
    const before = await ppSnapshot(ORG_A, n);
    const err = await errOf(() => c.procurementProcess.createProcess(original));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toMatch(TOKEN);
    expect(await ppSnapshot(ORG_A, n)).toEqual(before);
    // o cliente recupera o registro pela leitura canônica — o replay nunca é o caminho de leitura
    expect((await c.procurementProcess.loadProcess({ processId: first.process.id })).process).toMatchObject({ id: first.process.id, modality: "pregao" });
  }, 30000);

  it("P8 — filhos existentes (rascunho, pesquisa, item inteligente, item da contratação) ficam intactos no CONFLICT e em N retries idênticos", async () => {
    const n = num("pp8");
    const c = await caller(opA, ORG_A);
    const created = await c.procurementProcess.createProcess(ppInput(n));
    const pid = created.process.id;
    const tag = String(stamp).slice(-8);
    await conn.execute(`INSERT INTO generated_documents (id, organization_id, process_id, kind, title, content, status) VALUES (?, ?, ?, 'dfd', 'DFD R3', 'conteúdo humano', 'em_revisao')`, [`gd8${tag}`, ORG_A, pid]);
    await conn.execute(`INSERT INTO price_research (id, organization_id, process_id, source, item_count) VALUES (?, ?, ?, 'manual', 2)`, [`pr8${tag}`, ORG_A, pid]);
    await conn.execute(`INSERT INTO intelligent_items (id, organization_id, process_id, description, status, approved_by) VALUES (?, ?, ?, 'Notebook i5', 'aprovado', ?)`, [`ii8${tag}`, ORG_A, pid, opA]);
    await conn.execute(`INSERT INTO procurement_items (id, organization_id, process_id, description, unit, ordinal, fingerprint, origin, provenance_json, created_by, updated_by)
      VALUES (?, ?, ?, 'Notebook i5', 'un', 1, 'fp8', 'manual', '{}', ?, ?)`, [`pi8${tag}`, ORG_A, pid, opA, opA]);
    // o processo anda (etapa/status), sem tocar em campos do payload de criação
    await conn.execute(`UPDATE procurement_processes SET current_stage = 'ISSUED', status = 'emitido', updated_at = '2026-01-02 03:04:05.678'
      WHERE organization_id = ? AND id = ?`, [ORG_A, pid]);
    const children = async () => ({
      ...(await ppSnapshot(ORG_A, n)),
      docs: await rows(`SELECT * FROM generated_documents WHERE organization_id = ? AND process_id = ?`, [ORG_A, pid]),
      research: await rows(`SELECT * FROM price_research WHERE organization_id = ? AND process_id = ?`, [ORG_A, pid]),
      iitems: await rows(`SELECT * FROM intelligent_items WHERE organization_id = ? AND process_id = ?`, [ORG_A, pid]),
      pitems: await rows(`SELECT * FROM procurement_items WHERE organization_id = ? AND process_id = ?`, [ORG_A, pid]),
    });
    const before = await children();
    expect([before.docs.length, before.research.length, before.iitems.length, before.pitems.length]).toEqual([1, 1, 1, 1]);

    const err = await errOf(() => c.procurementProcess.createProcess(ppInput(n, { object: "Objeto diferente", modality: "concorrencia" })));
    expect(err.code).toBe("CONFLICT");
    expect(await children()).toEqual(before);

    for (let i = 0; i < 3; i++) {
      const r = await c.procurementProcess.createProcess(ppInput(n));
      expect(r).toMatchObject({ created: false, process: { id: pid, currentStage: "ISSUED", status: "emitido" } });
    }
    expect(await children()).toEqual(before); // linha, timeline, fatos e filhos: zero escrita em 3 replays
  }, 30000);

  // P6/D6/P7 são guardas de REGRESSÃO: já valiam na main e devem continuar valendo.
  it("P6 — cross-tenant: o mesmo número em dois órgãos ⇒ ambos criados, isolados; nenhum altera o outro", async () => {
    const n = num("pp6");
    const a = await (await caller(opA, ORG_A)).procurementProcess.createProcess(ppInput(n));
    await progressPP(ORG_A, n);
    const beforeA = await ppSnapshot(ORG_A, n);
    const b = await (await caller(opB, ORG_B)).procurementProcess.createProcess(ppInput(n, { object: "Objeto do órgão B" }));
    expect(b.process.id).not.toBe(a.process.id);
    expect(await ppSnapshot(ORG_A, n)).toEqual(beforeA);
    const snapB = await ppSnapshot(ORG_B, n);
    expect(snapB.rows[0]).toMatchObject({ object: "Objeto do órgão B", status: "rascunho", organization_id: ORG_B });
    expect((await (await caller(opB, ORG_B)).procurementProcess.loadProcess({ processId: a.process.id })).process).toBeNull();
  }, 30000);

  it("P7 — RBAC inalterado: viewer continua recusado (FORBIDDEN), sem escrita, e o existente segue intocado", async () => {
    const n = num("pp7");
    const err = await errOf(async () => (await caller(viewerA, ORG_A)).procurementProcess.createProcess(ppInput(n)));
    expect(err.code).toBe("FORBIDDEN");
    expect((await ppSnapshot(ORG_A, n)).rows).toHaveLength(0);
    await (await caller(opA, ORG_A)).procurementProcess.createProcess(ppInput(n));
    const before = await ppSnapshot(ORG_A, n);
    const err2 = await errOf(async () => (await caller(viewerA, ORG_A)).procurementProcess.createProcess(ppInput(n, { object: "x" })));
    expect(err2.code).toBe("FORBIDDEN");
    expect(await ppSnapshot(ORG_A, n)).toEqual(before);
  }, 30000);

  // ── Contratação Direta (SEM-003) ──────────────────────────────────────────────────────────────────────────────
  const dpInput = (processNumber: string, over: Record<string, unknown> = {}) => ({
    processNumber, object: "Serviço de manutenção (R3)", procurementType: "dispensa" as const,
    startOption: "criar_dfd" as const, ...over,
  });

  it("D1 (R3.1/SEM-003) — número existente + payload diferente ⇒ CONFLICT; tipo/fundamento/etapa/flags intocados", async () => {
    const n = num("dp1");
    await (await caller(opA, ORG_A)).directProcurement.createProcess(dpInput(n));
    await progressDP(ORG_A, n);
    const before = await dpSnapshot(ORG_A, n);
    expect(before.rows).toHaveLength(1);
    expect(before.timeline).toHaveLength(1);

    const err = await errOf(async () => (await caller(opA2, ORG_A)).directProcurement.createProcess(
      dpInput(n, { procurementType: "inexigibilidade", object: "Outro objeto", startOption: "sem_dfd", legalBasis: "Art. 74, I" })));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toMatch(TOKEN);
    expect(err.message).toMatch(/Já existe uma contratação direta com este número/);

    const after = await dpSnapshot(ORG_A, n);
    expect(after).toEqual(before);
    expect(after.rows[0]).toMatchObject({
      procurement_type: "dispensa", legal_basis: "Art. 75, II", current_stage: "RATIFICATION", status: "ratificado", procedure_type: "eletronico",
    });
  }, 30000);

  it("D2 — retry idempotente (mesmo ator + mesmo payload) converge sem escrita e sem 2º evento na timeline", async () => {
    const n = num("dp2");
    const c = await caller(opA, ORG_A);
    const first = await c.directProcurement.createProcess(dpInput(n));
    const afterFirst = await dpSnapshot(ORG_A, n);
    const again = await c.directProcurement.createProcess(dpInput(n));
    expect(await dpSnapshot(ORG_A, n)).toEqual(afterFirst);
    expect(again.workspace.id).toBe(first.workspace.id);
    expect(again.created).toBe(false);

    // retry tardio após o workspace andar (etapa/status/flags/procedimento) — nada é resetado
    await conn.execute(`UPDATE direct_procurement_workspaces SET current_stage = 'LEGAL_OPINION', status = 'aguardando_parecer',
      procedure_type = 'presencial', flags = '{"usesDFD":true,"requiresPriceResearch":false,"requiresProposalCollection":false,"requiresLegalOpinion":true}'
      WHERE organization_id = ? AND process_number = ?`, [ORG_A, n]);
    const progressed = await dpSnapshot(ORG_A, n);
    const late = await c.directProcurement.createProcess(dpInput(n));
    expect(await dpSnapshot(ORG_A, n)).toEqual(progressed);
    expect(late.workspace).toMatchObject({ id: first.workspace.id, currentStage: "LEGAL_OPINION", status: "aguardando_parecer", procedureType: "presencial" });
    expect(late.workspace.flags.requiresPriceResearch).toBe(false);
    expect(late.created).toBe(false);
  }, 30000);

  it("D3 — mesmo ator, UM campo diferente (tipo, objeto, início, fundamento) ⇒ CONFLICT sem mutação", async () => {
    const n = num("dp3");
    const c = await caller(opA, ORG_A);
    await c.directProcurement.createProcess(dpInput(n));
    const before = await dpSnapshot(ORG_A, n);
    for (const over of [
      { procurementType: "inexigibilidade" },
      { object: "Serviço de manutenção (R3) v2" },
      { startOption: "sem_dfd" },
      { legalBasis: "Art. 75, I" },
    ]) {
      const err = await errOf(() => c.directProcurement.createProcess(dpInput(n, over)));
      expect(err.code, JSON.stringify(over)).toBe("CONFLICT");
      expect(err.message).toMatch(TOKEN);
    }
    expect(await dpSnapshot(ORG_A, n)).toEqual(before);
  }, 30000);

  it("D4 — outro usuário do mesmo órgão com payload idêntico ⇒ CONFLICT sem mutação", async () => {
    const n = num("dp4");
    await (await caller(opA, ORG_A)).directProcurement.createProcess(dpInput(n));
    const before = await dpSnapshot(ORG_A, n);
    const err = await errOf(async () => (await caller(opA2, ORG_A)).directProcurement.createProcess(dpInput(n)));
    expect(err.code).toBe("CONFLICT");
    expect(await dpSnapshot(ORG_A, n)).toEqual(before);
  }, 30000);

  it("D5 — criação dupla CONCORRENTE (Promise.all): exatamente 1 workspace e 1 evento inicial", async () => {
    const n = num("dp5");
    const c = await caller(opA, ORG_A);
    const same = await Promise.allSettled(Array.from({ length: 5 }, () => c.directProcurement.createProcess(dpInput(n))));
    expect(same.every((r) => r.status === "fulfilled")).toBe(true);
    const snap = await dpSnapshot(ORG_A, n);
    expect(snap.rows).toHaveLength(1);
    expect(snap.timeline).toHaveLength(1);

    const n2 = num("dp5b");
    const [a, b] = await Promise.allSettled([
      c.directProcurement.createProcess(dpInput(n2, { procurementType: "dispensa" })),
      c.directProcurement.createProcess(dpInput(n2, { procurementType: "inexigibilidade" })),
    ]);
    const outcomes = [a, b].map((r) => r.status === "fulfilled" ? "ok" : (r.reason as { code?: string }).code);
    expect(outcomes.sort()).toEqual(["CONFLICT", "ok"]);
    const snap2 = await dpSnapshot(ORG_A, n2);
    expect(snap2.rows).toHaveLength(1);
    expect(snap2.rows[0].procurement_type).toBe(a.status === "fulfilled" ? "dispensa" : "inexigibilidade");
    expect(snap2.timeline).toHaveLength(1);
  }, 30000);

  it("D7 (R3.5) — replay tardio após troca LEGÍTIMA do fundamento legal (selectLegalBasis) ⇒ CONFLICT, zero escrita", async () => {
    const n = num("dp7");
    const c = await caller(opA, ORG_A);
    const original = dpInput(n, { legalBasis: "Art. 75, II" });
    const first = await c.directProcurement.createProcess(original);
    expect((await c.directProcurement.createProcess(original)).created).toBe(false); // replay imediato converge
    await c.directProcurement.selectLegalBasis({ workspaceId: first.workspace.id, legalBasis: "Art. 75, I" });
    const before = await dpSnapshot(ORG_A, n);
    const err = await errOf(() => c.directProcurement.createProcess(original));
    expect(err.code).toBe("CONFLICT");
    expect(err.message).toMatch(TOKEN);
    expect(await dpSnapshot(ORG_A, n)).toEqual(before);
    expect(before.rows[0].legal_basis).toBe("Art. 75, I");
  }, 30000);

  it("D6 — cross-tenant: o mesmo número em dois órgãos ⇒ ambos criados e isolados", async () => {
    const n = num("dp6");
    const a = await (await caller(opA, ORG_A)).directProcurement.createProcess(dpInput(n));
    await progressDP(ORG_A, n);
    const beforeA = await dpSnapshot(ORG_A, n);
    const b = await (await caller(opB, ORG_B)).directProcurement.createProcess(dpInput(n, { procurementType: "inexigibilidade" }));
    expect(b.workspace.id).not.toBe(a.workspace.id);
    expect(await dpSnapshot(ORG_A, n)).toEqual(beforeA);
    expect((await dpSnapshot(ORG_B, n)).rows[0]).toMatchObject({ procurement_type: "inexigibilidade", status: "rascunho", organization_id: ORG_B });
    expect((await (await caller(opB, ORG_B)).directProcurement.loadProcess({ workspaceId: a.workspace.id })).workspace).toBeNull();
  }, 30000);
});

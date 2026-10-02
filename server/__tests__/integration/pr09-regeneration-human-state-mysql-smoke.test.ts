/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PR-09 (SEM-014 / SEM-009) — R5.6 contra MySQL REAL (modo ESTRITO):
 *   1. regerar TR sobre EDIÇÃO HUMANA sem `confirmReplace` (ROUTER real) ⇒ CONFLICT HUMAN_EDIT_WOULD_BE_OVERWRITTEN
 *      com ZERO chamadas ao AIExecutionEngine e ZERO writes (rascunho, ledger, idempotência, timeline, oficial);
 *   2. `confirmReplace: true` ⇒ regenera e o conteúdo humano anterior fica RECUPERÁVEL no ledger
 *      (`generated_document_edits.previous_content`, operação ai_regenerate, motivo confirm_replace);
 *   3. rascunho só de IA regenera sem confirmação (inalterado); após a substituição confirmada o conteúdo
 *      volta a ser IA e dispensa nova confirmação;
 *   4. isolamento multi-tenant: edição humana do tenant B não bloqueia/vaza para o tenant A (mesmo processId);
 *   5. Edital: parâmetros persistidos → recarga (reviewableDraft pelo ROUTER) hidrata → "Gerar edital" sem
 *      proposta usa os PERSISTIDOS; proposta divergente sem troca explícita ⇒ CONFLICT; staleness contra os
 *      persistidos; sem parâmetros ⇒ PRECONDITION_FAILED (sem padrão silencioso).
 *   6. R5.B — documento com versão OFICIAL emitida: regenerar (router real, mesmo com confirmReplace) ⇒
 *      PRECONDITION_FAILED OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE, zero IA e zero writes; a UI recebe
 *      `regenerationBlock`; versão oficial e rascunho intactos;
 *   7. R5.C — critério de julgamento / regime de execução persistidos (0311): 1ª decisão grava as colunas,
 *      recarga hidrata, regeneração SEM proposta usa os persistidos no prompt (sem [REVISAR]); linha antiga
 *      (colunas NULL) segue NULL e o prompt mantém [REVISAR];
 *   8. R5 — migração 0311: colunas nullable sem default; reaplicar os statements = no-op; ledger único.
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

let aiEngineCalls = 0;
vi.mock("../../services/aiExecutionEngine", async (orig) => {
  const mod = await orig<Record<string, unknown>>();
  return Object.fromEntries(Object.entries(mod).map(([k, v]) => [k, typeof v === "function"
    ? (...a: unknown[]) => { aiEngineCalls++; return (v as (...x: unknown[]) => unknown)(...a); }
    : v]));
});

import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import {
  generateDocument, generateNotice, saveReviewableDraft, getEditalSourceState,
} from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { getGeneratedDocumentByKind, getLatestDraftEdit, insertProcess } from "../../db/procurement";
import { draftContentHash } from "../../domain/generatedDocument";
import { createProcurementWorkspace } from "../../domain/procurementProcess";
import { promoteOfficialDocument } from "../../services/documentPromotionService";
import { readFileSync } from "node:fs";
import path from "node:path";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991401;
const ORG2 = 991402;
const A = 5;  // originador (gera)
const B = 9;  // jurista (edita)

let conn: mysql.Connection;
let seq = 0;
let routerUserId = 0;
let invokeCalls = 0;
let lastPrompt = "";
const invokeFor = (kind: "etp" | "tr" | "edital") => async (prompt?: string) => { invokeCalls++; lastPrompt = prompt ?? ""; return buildMockProviderAuthoring(kind); };
const EMITTER = 77; // terceiro revisor/emissor (≠ originador A, ≠ editor B) — SoD

async function newProcess(org: number, object: string): Promise<string> {
  const p = createProcurementWorkspace({ organizationId: org, processNumber: `PR09-${Date.now()}-${++seq}`, object, startOption: "iniciar_tr", responsibleUser: A, correlationId: "pr09" });
  await insertProcess(p);
  return p.id;
}

const genTR = (org: number, pid: string, key: string, actor: number, extra: Record<string, unknown> = {}) => generateDocument({
  organizationId: org, processId: pid, kind: "tr", object: "Serviço de limpeza", correlationId: "pr09-smoke",
  idempotencyKey: key, actorUserId: actor, invoke: invokeFor("tr"), ...extra,
} as any);

async function humanEdit(org: number, pid: string, kind: "etp" | "tr" | "edital", content: string, key: string) {
  const before = await getGeneratedDocumentByKind(pid, org, kind);
  return saveReviewableDraft({
    organizationId: org, processId: pid, kind, content, actorUserId: B,
    expectedContentHash: draftContentHash(before!.content), idempotencyKey: key, correlationId: "pr09-edit",
  });
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params);
  return Number((rows[0] as any).n);
}

/** Fotografia de TODOS os efeitos persistentes de uma geração para (org, processo). */
async function effects(org: number, pid: string) {
  const [gd] = await conn.execute<mysql.RowDataPacket[]>(
    "SELECT CAST(content AS CHAR) AS c, last_substantive_actor_user_id AS l, updated_at AS u FROM generated_documents WHERE organization_id = ? AND process_id = ? ORDER BY kind", [org, pid]);
  return {
    drafts: gd.map((r: any) => `${draftContentHash(String(r.c))}:${r.l}:${String(r.u)}`),
    edits: await count("SELECT COUNT(*) n FROM generated_document_edits WHERE organization_id = ? AND process_id = ?", [org, pid]),
    idem: await count("SELECT COUNT(*) n FROM idempotency_keys WHERE organizationId = ?", [org]),
    timeline: await count("SELECT COUNT(*) n FROM process_timeline WHERE organization_id = ? AND process_id = ?", [org, pid]),
    official: await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND origin = ?", [org, pid]),
  };
}

async function cleanup() {
  const tables: Array<[string, string]> = [
    ["generated_document_edits", "organization_id"], ["generated_documents", "organization_id"],
    ["official_document_timeline", "tenant_id"], ["official_document_promotions", "organization_id"], ["official_documents", "tenant_id"],
    ["process_timeline", "organization_id"], ["procurement_processes", "organization_id"], ["idempotency_keys", "organizationId"],
    ["organization_members", "organizationId"],
  ];
  for (const org of [ORG, ORG2]) for (const [t, c] of tables) await conn.query(`DELETE FROM \`${t}\` WHERE \`${c}\` = ?`, [org]).catch(() => {});
}

async function caller() {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({ user: { id: routerUserId, role: "user" }, req: { headers: {} }, res: {}, correlationId: "pr09-router" } as any);
}

describe.skipIf(!DB)("PR-09 — regerar sem perder edição humana + parâmetros do Edital (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    for (const o of [ORG, ORG2]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [o, `PR09 ${o}`, `pr09-${o}`]).catch(() => {});
    }
    await cleanup();
    const [u] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email) VALUES (?, 'PR09', ?)", [`pr09-${Date.now()}`, `pr09-${Date.now()}@teste.local`]);
    routerUserId = u.insertId;
    await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, 'operator', 1)", [ORG, routerUserId]);
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    if (routerUserId) await conn.execute("DELETE FROM users WHERE id = ?", [routerUserId]).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG2]).catch(() => {});
    await conn.end();
  });

  it("R5.6 — regerar TR sobre edição humana SEM confirmação (router real) ⇒ recusa, zero IA e zero writes", async () => {
    const pid = await newProcess(ORG, "Serviço de limpeza");
    await genTR(ORG, pid, `seed-${pid}`, A);
    const human = "# TR\n5. Obrigações — reescritas pelo jurista (edição humana).";
    await humanEdit(ORG, pid, "tr", human, `edit-${pid}`);

    const snapshot = await effects(ORG, pid);
    aiEngineCalls = 0; invokeCalls = 0;
    const api = await caller();
    await expect(api.procurementProcess.generateTR({ processId: pid, object: "Serviço de limpeza", idempotencyKey: `regen-${pid}` }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^HUMAN_EDIT_WOULD_BE_OVERWRITTEN:/) });
    // Também com confirmReplace explícito = false e com o hash visto (ainda sem confirmação).
    await expect(api.procurementProcess.generateTR({ processId: pid, object: "Serviço de limpeza", idempotencyKey: `regen2-${pid}`, confirmReplace: false, expectedContentHash: draftContentHash(human) }))
      .rejects.toMatchObject({ code: "CONFLICT" });

    expect(aiEngineCalls).toBe(0);
    expect(invokeCalls).toBe(0);
    expect(await effects(ORG, pid)).toEqual(snapshot); // nada gravado (nem reserva de idempotência)
    expect((await getGeneratedDocumentByKind(pid, ORG, "tr"))!.content).toBe(human);

    // A leitura reload-safe expõe a proveniência humana para a UI pedir confirmação.
    const read = await api.procurementProcess.reviewableDraft({ processId: pid, kind: "tr" });
    expect(read.draft!.humanEdit).toMatchObject({ reason: "human_edit", operation: "human_edit", actorUserId: B });
  }, 120_000);

  it("confirmReplace: true ⇒ regenera e o conteúdo humano anterior fica RECUPERÁVEL no ledger; depois volta a ser IA", async () => {
    const pid = await newProcess(ORG, "Serviço de limpeza");
    await genTR(ORG, pid, `seed-${pid}`, A);
    const human = "# TR\nTexto humano que precisa ser recuperável.";
    await humanEdit(ORG, pid, "tr", human, `edit-${pid}`);

    invokeCalls = 0;
    const res = await genTR(ORG, pid, `regen-${pid}`, A, { confirmReplace: true, expectedContentHash: draftContentHash(human) });
    expect(invokeCalls).toBe(1);
    expect(res.document.content).not.toBe(human);

    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT operation AS op, CAST(previous_content AS CHAR) AS pc, previous_content_hash AS ph, reason, actor_user_id AS actor FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND kind = 'tr' ORDER BY id",
      [ORG, pid]);
    const last = rows[rows.length - 1] as any;
    expect(last.op).toBe("ai_regenerate");
    expect(String(last.pc)).toBe(human);                  // conteúdo humano EXATO preservado
    expect(String(last.ph)).toBe(draftContentHash(human));
    expect(String(last.reason)).toBe("confirm_replace:human_edit:human_edit");
    expect(Number(last.actor)).toBe(A);
    expect((rows as any[]).map((r) => r.op)).toEqual(["human_edit", "ai_regenerate"]);

    // O conteúdo vigente agora é de IA: nova regeneração (conteúdo diferente) dispensa confirmação.
    expect((await getLatestDraftEdit(pid, ORG, "tr"))!.operation).toBe("ai_regenerate");
    await expect(generateDocument({
      organizationId: ORG, processId: pid, kind: "tr", object: "Serviço de limpeza hospitalar", correlationId: "pr09-smoke",
      idempotencyKey: `regen3-${pid}`, actorUserId: A, invoke: invokeFor("tr"),
    })).resolves.toBeTruthy();
  }, 120_000);

  it("rascunho só de IA regenera SEM confirmação (comportamento inalterado)", async () => {
    const pid = await newProcess(ORG, "Aquisição de papel");
    await generateDocument({ organizationId: ORG, processId: pid, kind: "etp", object: "Aquisição de papel", correlationId: "pr09", idempotencyKey: `e1-${pid}`, actorUserId: A, invoke: invokeFor("etp") });
    const r = await generateDocument({ organizationId: ORG, processId: pid, kind: "etp", object: "Aquisição de papel reciclado", correlationId: "pr09", idempotencyKey: `e2-${pid}`, actorUserId: B, invoke: invokeFor("etp") });
    expect(r.replayed).toBe(false);
    const [rows] = await conn.execute<mysql.RowDataPacket[]>("SELECT operation AS op, reason FROM generated_document_edits WHERE organization_id = ? AND process_id = ? AND kind = 'etp'", [ORG, pid]);
    expect((rows as any[]).map((x) => x.op)).toEqual(["ai_regenerate"]);
    expect((rows[0] as any).reason).toBeNull();
  }, 120_000);

  it("isolamento multi-tenant: edição humana do tenant B não bloqueia nem vaza para o tenant A (mesmo processId)", async () => {
    const pid = "pr09-x-tenant";
    await genTR(ORG2, pid, `seed-b-${pid}`, A);
    await humanEdit(ORG2, pid, "tr", "# TR do tenant B editado", `edit-b-${pid}`);
    await genTR(ORG, pid, `seed-a-${pid}`, A);

    expect((await getLatestDraftEdit(pid, ORG, "tr"))).toBeNull();          // A não vê o ledger de B
    expect((await getLatestDraftEdit(pid, ORG2, "tr"))!.operation).toBe("human_edit");
    // A (só IA) regenera sem confirmação; B continua protegido.
    await expect(generateDocument({ organizationId: ORG, processId: pid, kind: "tr", object: "Outro objeto A", correlationId: "pr09", idempotencyKey: `regen-a-${pid}`, actorUserId: A, invoke: invokeFor("tr") })).resolves.toBeTruthy();
    const bBefore = await effects(ORG2, pid);
    await expect(genTR(ORG2, pid, `regen-b-${pid}`, A)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^HUMAN_EDIT_WOULD_BE_OVERWRITTEN:/) });
    expect(await effects(ORG2, pid)).toEqual(bBefore);
    expect((await getGeneratedDocumentByKind(pid, ORG2, "tr"))!.content).toBe("# TR do tenant B editado");
  }, 120_000);

  it("Edital: parâmetros persistidos → recarga hidrata → gerar SEM proposta usa os persistidos; divergência exige troca explícita", async () => {
    const pid = await newProcess(ORG, "Obra de reforma");
    const api = await caller();
    // Sem parâmetros definidos ⇒ recusa clara (nenhum padrão), zero IA/writes.
    const empty = await effects(ORG, pid);
    aiEngineCalls = 0;
    await expect(api.procurementProcess.generateNotice({ processId: pid, object: "Obra de reforma", idempotencyKey: `ed0-${pid}` }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/^EDITAL_PARAMETERS_REQUIRED:/) });
    expect(aiEngineCalls).toBe(0);
    expect(await effects(ORG, pid)).toEqual(empty);

    // 1ª decisão humana: concorrência / presencial (persistida no rascunho canônico do Edital).
    await generateNotice({
      organizationId: ORG, processId: pid, object: "Obra de reforma", modality: "concorrencia", form: "presencial",
      correlationId: "pr09-ed", idempotencyKey: `ed1-${pid}`, actorUserId: A, invoke: invokeFor("edital"),
    });

    // "Recarga": a leitura reload-safe devolve os parâmetros persistidos (hidratação do formulário).
    const read = await api.procurementProcess.reviewableDraft({ processId: pid, kind: "edital" });
    // R5 (0311) — contrato aditivo: critério/regime presentes (null = requer revisão; nunca inventados).
    expect(read.draft!.parameters).toEqual({ modality: "concorrencia", form: "presencial", platform: null, judgmentCriterion: null, executionRegime: null });
    expect(read.draft!.regenerationBlock).toBeNull();
    expect(read.draft!.humanEdit).toBeNull();

    // Staleness calculada contra os PERSISTIDOS: a proposta (antigo padrão da UI) não acende o alerta.
    const st = await getEditalSourceState({ organizationId: ORG, processId: pid, object: "Obra de reforma", modality: "pregao", form: "eletronico", platform: "compras_gov" });
    expect(st.state).toBe("current");
    expect(st.parameters).toEqual({ persisted: { modality: "concorrencia", form: "presencial", platform: null, judgmentCriterion: null, executionRegime: null }, proposedDiffers: true });

    // O antigo padrão pregão/eletrônico sem troca explícita ⇒ CONFLICT, zero efeitos.
    const before = await effects(ORG, pid);
    invokeCalls = 0;
    await expect(generateNotice({
      organizationId: ORG, processId: pid, object: "Obra de reforma", modality: "pregao", form: "eletronico", platform: "compras_gov",
      correlationId: "pr09-ed", idempotencyKey: `ed2-${pid}`, actorUserId: A, invoke: invokeFor("edital"),
    })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^EDITAL_PARAMETERS_CHANGED:/) });
    expect(invokeCalls).toBe(0);
    expect(await effects(ORG, pid)).toEqual(before);

    // Gerar SEM proposta (objeto diferente ⇒ conteúdo novo) usa os PERSISTIDOS lidos no servidor.
    await generateNotice({
      organizationId: ORG, processId: pid, object: "Obra de reforma do prédio sede",
      correlationId: "pr09-ed", idempotencyKey: `ed3-${pid}`, actorUserId: A, invoke: invokeFor("edital"),
    });
    const row = await getGeneratedDocumentByKind(pid, ORG, "edital");
    expect({ modality: row!.modality, form: row!.form, platform: row!.platform }).toEqual({ modality: "concorrencia", form: "presencial", platform: null });

    // Troca EXPLÍCITA confirmada ⇒ aplicada e persistida; timeline registra atual → proposto.
    await generateNotice({
      organizationId: ORG, processId: pid, object: "Obra de reforma do prédio sede", modality: "pregao", form: "eletronico", platform: "bll",
      confirmParameterChange: true, correlationId: "pr09-ed", idempotencyKey: `ed4-${pid}`, actorUserId: A, invoke: invokeFor("edital"),
    });
    const changed = await getGeneratedDocumentByKind(pid, ORG, "edital");
    expect({ modality: changed!.modality, form: changed!.form, platform: changed!.platform }).toEqual({ modality: "pregao", form: "eletronico", platform: "bll" });
    const [tl] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT summary FROM process_timeline WHERE organization_id = ? AND process_id = ? AND summary LIKE '%Parâmetros trocados explicitamente%'", [ORG, pid]);
    expect(String((tl[0] as any).summary)).toContain("concorrencia/presencial → pregao/eletronico/bll");

    // Edição humana do Edital preserva os parâmetros (content-only) e protege contra regeneração silenciosa.
    await humanEdit(ORG, pid, "edital", "# Edital revisado pela comissão", `ed-edit-${pid}`);
    const edited = await api.procurementProcess.reviewableDraft({ processId: pid, kind: "edital" });
    expect(edited.draft!.parameters).toEqual({ modality: "pregao", form: "eletronico", platform: "bll", judgmentCriterion: null, executionRegime: null });
    await expect(api.procurementProcess.generateNotice({ processId: pid, object: "Obra de reforma do prédio sede", idempotencyKey: `ed5-${pid}` }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^HUMAN_EDIT_WOULD_BE_OVERWRITTEN:/) });
  }, 180_000);

  // ─── R5 ─────────────────────────────────────────────────────────────────────────────────────

  it("R5.B — versão OFICIAL emitida: regenerar (router real) ⇒ OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE, zero IA/writes", async () => {
    const pid = await newProcess(ORG, "Serviço de vigilância");
    await genTR(ORG, pid, `seed-${pid}`, A);
    const tr = (await getGeneratedDocumentByKind(pid, ORG, "tr"))!;
    const emission = await promoteOfficialDocument({
      organizationId: ORG, processId: pid, kind: "tr", actorUserId: EMITTER, actorRole: "manager",
      idempotencyKey: `emit-${pid}`, correlationId: "pr09-emit", expectedContentHash: draftContentHash(tr.content),
    });
    const v = emission.officialDocument.version; // versão na linhagem oficial (snapshots `gerado` também numeram)
    const [off] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT id, CAST(content AS CHAR) AS c FROM official_documents WHERE tenant_id = ? AND origin = ? AND status = 'emitido'", [ORG, pid]);
    expect(off).toHaveLength(1);

    const snapshot = await effects(ORG, pid);
    aiEngineCalls = 0; invokeCalls = 0;
    const api = await caller();
    for (const extra of [{}, { confirmReplace: true, expectedContentHash: draftContentHash(tr.content) }]) {
      await expect(api.procurementProcess.generateTR({ processId: pid, object: "Serviço de vigilância armada", idempotencyKey: `regen-${pid}`, ...extra }))
        .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining(`OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE: o TR já possui versão OFICIAL emitida (v${v})`) });
    }
    // Serviço direto (mesmo caminho do Edital/ETP) também recusa, antes de qualquer cognição.
    await expect(genTR(ORG, pid, `regen-svc-${pid}`, A, { confirmReplace: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(aiEngineCalls).toBe(0);
    expect(invokeCalls).toBe(0);
    expect(await effects(ORG, pid)).toEqual(snapshot); // rascunho, ledger, idempotência, timeline e oficial intactos
    const [off2] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT id, CAST(content AS CHAR) AS c FROM official_documents WHERE tenant_id = ? AND origin = ? AND status = 'emitido'", [ORG, pid]);
    expect(off2).toEqual(off);

    // A UI recebe o bloqueio (e explica o novo ciclo); outro tenant com o MESMO processId não é afetado.
    const read = await api.procurementProcess.reviewableDraft({ processId: pid, kind: "tr" });
    expect(read.draft!.regenerationBlock).toMatchObject({ reason: "official_emitted", officialVersion: v });
    await genTR(ORG2, pid, `seed-b-${pid}`, A);
    await expect(generateDocument({ organizationId: ORG2, processId: pid, kind: "tr", object: "Outro objeto B", correlationId: "pr09", idempotencyKey: `regen-b-${pid}`, actorUserId: A, invoke: invokeFor("tr") })).resolves.toBeTruthy();
  }, 180_000);

  it("R5.B — Edital oficial: nem troca de parâmetros confirmada nem confirmReplace regeneram (router real)", async () => {
    const pid = await newProcess(ORG, "Aquisição de merenda");
    await generateNotice({
      organizationId: ORG, processId: pid, object: "Aquisição de merenda", modality: "pregao", form: "eletronico", platform: "bll",
      correlationId: "pr09-ed", idempotencyKey: `ed1-${pid}`, actorUserId: A, invoke: invokeFor("edital"),
    });
    const ed = (await getGeneratedDocumentByKind(pid, ORG, "edital"))!;
    await promoteOfficialDocument({
      organizationId: ORG, processId: pid, kind: "edital", actorUserId: EMITTER, actorRole: "manager",
      idempotencyKey: `emit-ed-${pid}`, correlationId: "pr09-emit", expectedContentHash: draftContentHash(ed.content),
    });
    const snapshot = await effects(ORG, pid);
    aiEngineCalls = 0;
    const api = await caller();
    await expect(api.procurementProcess.generateNotice({
      processId: pid, object: "Aquisição de merenda", modality: "concorrencia", form: "presencial", confirmParameterChange: true,
      judgmentCriterion: "Menor preço", confirmReplace: true, idempotencyKey: `ed2-${pid}`,
    })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringMatching(/^OFFICIAL_DOCUMENT_REQUIRES_NEW_VERSION_CYCLE: o Edital/) });
    expect(aiEngineCalls).toBe(0);
    expect(await effects(ORG, pid)).toEqual(snapshot);
    const row = (await getGeneratedDocumentByKind(pid, ORG, "edital"))!;
    expect({ m: row.modality, f: row.form, jc: row.judgmentCriterion }).toEqual({ m: "pregao", f: "eletronico", jc: null });
  }, 180_000);

  it("R5.C — critério/regime: 1ª decisão persiste → recarga hidrata → regenerar SEM proposta usa os persistidos no prompt", async () => {
    const pid = await newProcess(ORG, "Reforma da escola");
    const api = await caller();
    // Entrada do router: texto bounded (100) — acima disso é rejeitado pelo contrato (antes de qualquer efeito).
    await expect(api.procurementProcess.generateNotice({
      processId: pid, object: "Reforma da escola", modality: "concorrencia", form: "presencial",
      judgmentCriterion: "x".repeat(101), idempotencyKey: `edx-${pid}`,
    })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await generateNotice({
      organizationId: ORG, processId: pid, object: "Reforma da escola", modality: "concorrencia", form: "presencial",
      judgmentCriterion: "  Menor preço  ", executionRegime: "Empreitada por preço global",
      correlationId: "pr09-ed", idempotencyKey: `ed1-${pid}`, actorUserId: A, invoke: invokeFor("edital"),
    });
    const [cols] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT judgment_criterion AS jc, execution_regime AS er FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [ORG, pid]);
    expect(cols[0]).toMatchObject({ jc: "Menor preço", er: "Empreitada por preço global" });
    expect(lastPrompt).toContain("Critério de julgamento: Menor preço");

    // Recarga (router) hidrata os fatos institucionais.
    const read = await api.procurementProcess.reviewableDraft({ processId: pid, kind: "edital" });
    expect(read.draft!.parameters).toEqual({
      modality: "concorrencia", form: "presencial", platform: null, judgmentCriterion: "Menor preço", executionRegime: "Empreitada por preço global",
    });
    const st = await api.procurementProcess.editalSourceState({ processId: pid, object: "Reforma da escola" });
    expect(st.state).toBe("current");
    expect(st.missing).not.toContain("criterio_julgamento");

    // Regenerar SEM proposta (objeto novo) ⇒ servidor lê os PERSISTIDOS: prompt sem [REVISAR] de critério/regime.
    lastPrompt = "";
    await generateNotice({
      organizationId: ORG, processId: pid, object: "Reforma da escola municipal",
      correlationId: "pr09-ed", idempotencyKey: `ed2-${pid}`, actorUserId: A, invoke: invokeFor("edital"),
    });
    expect(lastPrompt).toContain("Critério de julgamento: Menor preço");
    expect(lastPrompt).toContain("Regime de contratação/execução: Empreitada por preço global");
    expect(lastPrompt).not.toContain("[REVISAR: definir critério de julgamento");
    expect(lastPrompt).not.toContain("[REVISAR: definir regime de execução");
    const [off] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT metadata FROM official_documents WHERE tenant_id = ? AND origin = ? ORDER BY created_at DESC LIMIT 1", [ORG, pid]);
    const meta = typeof (off[0] as any).metadata === "string" ? JSON.parse((off[0] as any).metadata) : (off[0] as any).metadata;
    expect(meta).toMatchObject({ judgmentCriterion: "Menor preço", executionRegime: "Empreitada por preço global", parametersSource: "persisted" });

    // Sobrescrever o critério decidido sem troca explícita ⇒ CONFLICT (zero efeitos); edição humana preserva.
    const before = await effects(ORG, pid);
    await expect(generateNotice({
      organizationId: ORG, processId: pid, object: "Reforma da escola municipal", judgmentCriterion: "Técnica e preço",
      correlationId: "pr09-ed", idempotencyKey: `ed3-${pid}`, actorUserId: A, invoke: invokeFor("edital"),
    })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^EDITAL_PARAMETERS_CHANGED:/) });
    expect(await effects(ORG, pid)).toEqual(before);
    await humanEdit(ORG, pid, "edital", "# Edital revisado — critério mantido", `ed-edit-${pid}`);
    const edited = (await getGeneratedDocumentByKind(pid, ORG, "edital"))!;
    expect({ jc: edited.judgmentCriterion, er: edited.executionRegime }).toEqual({ jc: "Menor preço", er: "Empreitada por preço global" });
  }, 180_000);

  it("R5.C — linha ANTIGA (colunas NULL): segue NULL (sem valor inventado) e o prompt mantém [REVISAR]", async () => {
    const pid = await newProcess(ORG, "Compra de uniformes");
    // Simula um Edital gravado antes da 0311 (INSERT sem as colunas novas).
    await conn.execute(
      "INSERT INTO generated_documents (id, organization_id, process_id, kind, title, content, status, sources, modality, form, platform, legal_justification, author_user_id, correlation_id) VALUES (?, ?, ?, 'edital', 'Edital — antigo', '', 'rascunho', '[]', 'pregao', 'eletronico', 'compras_gov', '', ?, 'legacy')",
      [`old${pid}`.slice(0, 20), ORG, pid, A]);
    const [cols] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT judgment_criterion AS jc, execution_regime AS er FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [ORG, pid]);
    expect(cols[0]).toMatchObject({ jc: null, er: null });
    lastPrompt = "";
    await generateNotice({
      organizationId: ORG, processId: pid, object: "Compra de uniformes",
      correlationId: "pr09-ed", idempotencyKey: `ed1-${pid}`, actorUserId: A, invoke: invokeFor("edital"),
    });
    expect(lastPrompt).toContain("[REVISAR: definir critério de julgamento");
    expect(lastPrompt).toContain("[REVISAR: definir regime de execução");
    const row = (await getGeneratedDocumentByKind(pid, ORG, "edital"))!;
    expect({ m: row.modality, jc: row.judgmentCriterion, er: row.executionRegime }).toEqual({ m: "pregao", jc: null, er: null });
  }, 180_000);

  it("R5 — migração 0311: colunas nullable sem default; reaplicar os statements = no-op; registrada uma vez", async () => {
    const [c] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COLUMN_NAME AS n, IS_NULLABLE AS nul, COLUMN_DEFAULT AS d, CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'generated_documents' AND COLUMN_NAME IN ('judgment_criterion','execution_regime') ORDER BY COLUMN_NAME", []);
    expect((c as any[]).map((r) => ({ n: r.n, nul: r.nul, len: Number(r.len), d: r.d === "NULL" ? null : r.d }))).toEqual([
      { n: "execution_regime", nul: "YES", len: 100, d: null },
      { n: "judgment_criterion", nul: "YES", len: 100, d: null },
    ]);
    const sql = readFileSync(path.join(process.cwd(), "drizzle/0311_edital_institutional_parameters.sql"), "utf8");
    const statements = sql.split("--> statement-breakpoint").map((x) => x.trim()).filter((x) => x && !/^(--[^\n]*\n?)+$/.test(x));
    for (let i = 0; i < 2; i++) for (const st of statements) await conn.query(st); // replay manual (sem ledger) ⇒ no-op
    const [c2] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'generated_documents' AND COLUMN_NAME IN ('judgment_criterion','execution_regime')", []);
    expect(Number((c2[0] as any).n)).toBe(2);
    const [procs] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) n FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME LIKE 'licigov_0311%'", []);
    expect(Number((procs[0] as any).n)).toBe(0); // procedure auxiliar removida
    await runMigrations(conn); // 2ª migração pelo ledger ⇒ no-op
    const [led] = await conn.execute<mysql.RowDataPacket[]>("SELECT COUNT(*) n FROM __drizzle_migrations", []);
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"));
    expect(Number((led[0] as any).n)).toBe(journal.entries.length);
    // Por TAG (não por posição): a 0311 não precisa ser a última migration do journal.
    expect(journal.entries.find((e: { tag: string }) => e.tag === "0311_edital_institutional_parameters")).toMatchObject({ idx: 311 });
  }, 180_000);
});

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
const invokeFor = (kind: "etp" | "tr" | "edital") => async () => { invokeCalls++; return buildMockProviderAuthoring(kind); };

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
    expect(read.draft!.parameters).toEqual({ modality: "concorrencia", form: "presencial", platform: null });
    expect(read.draft!.humanEdit).toBeNull();

    // Staleness calculada contra os PERSISTIDOS: a proposta (antigo padrão da UI) não acende o alerta.
    const st = await getEditalSourceState({ organizationId: ORG, processId: pid, object: "Obra de reforma", modality: "pregao", form: "eletronico", platform: "compras_gov" });
    expect(st.state).toBe("current");
    expect(st.parameters).toEqual({ persisted: { modality: "concorrencia", form: "presencial", platform: null }, proposedDiffers: true });

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
    expect(edited.draft!.parameters).toEqual({ modality: "pregao", form: "eletronico", platform: "bll" });
    await expect(api.procurementProcess.generateNotice({ processId: pid, object: "Obra de reforma do prédio sede", idempotencyKey: `ed5-${pid}` }))
      .rejects.toMatchObject({ code: "CONFLICT", message: expect.stringMatching(/^HUMAN_EDIT_WOULD_BE_OVERWRITTEN:/) });
  }, 180_000);
});

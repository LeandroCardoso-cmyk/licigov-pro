/**
 * NEW-007 — Autoridade CONTEXTUAL do Parecer Jurídico — smoke contra MySQL REAL pelo ROUTER REAL
 * (`appRouter.legalOpinionWorkspace.*`, resolveTenant/orgRoleProcedure reais). Só roda com DATABASE_URL.
 *
 * Problema na main pré-fix: todas as mutações do workspace canônico eram `tenantProcedure` — um VIEWER recebia a
 * solicitação, elaborava/editava e ASSINAVA o parecer (versão oficial `emitido` em seu nome), devolvia e arquivava;
 * e o recebimento por UPSERT trocava o procurador silenciosamente em corrida.
 *
 * Matriz: viewer (receive/create/update/sign/return/archive) negado; operator NÃO designado negado; manager/owner
 * NÃO designados não assinam; admin de plataforma sem atribuição não assina nem se autoatribui; cross-tenant ⇒
 * NOT_FOUND idêntico ao inexistente; receive retry (sem duplicar) e receive por outro ator ⇒ CONFLICT; designado
 * cria/edita/assina; retry de assinatura (mesma key ⇒ replay; key reutilizada c/ payload diferente ⇒ CONFLICT);
 * concorrência (dois receives, duas assinaturas em Promise.all); parecer assinado imutável; ZERO escrita/evento/
 * notificação/chave de idempotência em TODA recusa; nenhuma chamada de IA; logs de recusa com correlationId.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

// Nenhum caminho deste router pode acionar IA (nem nas recusas): espiões que FALHAM o teste se chamados.
const aiCalls = vi.hoisted(() => ({ llm: 0, kernel: 0 }));
vi.mock("../../_core/llm", async (orig) => {
  const actual = await orig<typeof import("../../_core/llm")>();
  return { ...actual, invokeLLM: (async () => { aiCalls.llm++; throw new Error("IA proibida neste smoke"); }) as typeof actual.invokeLLM };
});
vi.mock("../../services/aiExecutionEngine", async (orig) => {
  const actual = await orig<typeof import("../../services/aiExecutionEngine")>();
  return { ...actual, executeCognitiveTask: (async () => { aiCalls.kernel++; throw new Error("IA proibida neste smoke"); }) as typeof actual.executeCognitiveTask };
});

import { requestInstitutionalReview } from "../../services/institutionalRequestService";
import {
  LEGAL_OPINION_ASSIGNMENT_REQUIRED, LEGAL_OPINION_ALREADY_ASSIGNED, LEGAL_OPINION_MEMBERSHIP_REQUIRED,
} from "../../services/legalOpinionAuthorityService";

const DB = process.env.DATABASE_URL;
const ORG_A = 990701;
const ORG_B = 990702;
const RUN = Date.now().toString(36);

const ORG_TABLES: Array<[string, string]> = [
  ["legal_opinion_workspaces", "organization_id"], ["legal_opinion_drafts", "organization_id"],
  ["legal_opinion_versions", "organization_id"], ["legal_opinion_history", "organization_id"],
  ["lawyer_assignments", "organization_id"], ["institutional_requests", "organization_id"],
  ["institutional_responses", "organization_id"], ["request_timelines", "organization_id"],
  ["request_notifications", "organization_id"], ["request_assignments", "organization_id"],
  ["document_references", "organization_id"], ["official_documents", "tenant_id"],
  ["official_document_timeline", "tenant_id"], ["idempotency_keys", "organizationId"],
];

describe.skipIf(!DB)("NEW-007 — legalOpinionWorkspace: autoridade por ATRIBUIÇÃO (MySQL real, router real)", () => {
  let conn: mysql.Connection;
  const U: Record<"lawyer" | "lawyer2" | "viewer" | "manager" | "owner" | "platformAdmin" | "memberB", number> = {
    lawyer: 0, lawyer2: 0, viewer: 0, manager: 0, owner: 0, platformAdmin: 0, memberB: 0,
  };
  let seq = 0;
  let requestA = "";
  let wsA = "";
  let signedKey = "";

  async function makeCaller(userId: number, platformRole: "user" | "admin" = "user", org?: number) {
    const { appRouter } = await import("../../routers");
    const headers: Record<string, string> = org ? { "x-organization-id": String(org) } : {};
    return appRouter.createCaller({
      user: { id: userId, role: platformRole, name: `Usuário ${userId}`, email: `u${userId}@teste.local` },
      req: { headers, ip: "127.0.0.1" }, res: {}, correlationId: `corr-new007-${userId}-${++seq}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  const lo = async (userId: number, platformRole: "user" | "admin" = "user", org?: number) => (await makeCaller(userId, platformRole, org)).legalOpinionWorkspace;

  async function newRequest(org: number): Promise<string> {
    const n = ++seq;
    const { request } = await requestInstitutionalReview({
      organizationId: org, sourceDomain: "processo_licitatorio", destinationDomain: "parecer_juridico",
      requestType: "LEGAL_OPINION_INITIAL", referenceProcessId: `n7-${RUN}-${n}`.slice(0, 20), title: `Parecer NEW-007 ${n}`,
      priority: "alta", requestedBy: U.owner || 1, correlationId: `corr-new007-req-${n}`,
    });
    return request.id;
  }

  /** Estado COMPLETO das tabelas do domínio no tenant + contadores globais (notifications/audit_logs). */
  async function snapshot(org: number): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [t, col] of ORG_TABLES) {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT * FROM \`${t}\` WHERE \`${col}\` = ? ORDER BY 1`, [org]);
      out[t] = JSON.stringify(rows);
    }
    for (const t of ["notifications", "audit_logs"]) {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS n, COALESCE(MAX(id), 0) AS m FROM \`${t}\``);
      out[t] = JSON.stringify(rows[0]);
    }
    return out;
  }
  async function expectDenied(run: () => Promise<unknown>, code: string, token?: string, orgs: number[] = [ORG_A, ORG_B], allowAudit = false) {
    const before = await Promise.all(orgs.map(snapshot));
    const err = await run().then(() => null, (e: { code?: string; message?: string }) => e);
    expect(err, "a chamada deveria ter sido recusada").not.toBeNull();
    expect(err!.code).toBe(code);
    if (token) expect(err!.message).toContain(token);
    const after = await Promise.all(orgs.map(snapshot));
    for (let i = 0; i < orgs.length; i++) {
      const b = { ...before[i] }, a = { ...after[i] };
      if (allowAudit) { delete b.audit_logs; delete a.audit_logs; }
      expect(a).toEqual(b); // ZERO escrita/evento/notificação/chave de idempotência
    }
    return err!;
  }
  async function one<T = mysql.RowDataPacket>(sql: string, params: unknown[]): Promise<T[]> {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(sql, params);
    return rows as unknown as T[];
  }
  const emitidoCount = async (ws: string) => Number((await one<{ n: number }>(
    "SELECT COUNT(*) AS n FROM official_documents WHERE tenant_id = ? AND origin = ? AND status = 'emitido'", [ORG_A, ws]))[0].n);

  async function cleanup() {
    for (const org of [ORG_A, ORG_B]) {
      for (const [t, col] of ORG_TABLES) await conn.query(`DELETE FROM \`${t}\` WHERE \`${col}\` = ?`, [org]).catch(() => {});
      await conn.query("DELETE FROM organization_members WHERE organizationId = ?", [org]).catch(() => {});
    }
  }

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await cleanup();
    for (const org of [ORG_A, ORG_B]) {
      await conn.query("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1", [org, `Org NEW-007 ${org}`, `new007-${org}`]);
    }
    for (const k of Object.keys(U) as Array<keyof typeof U>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>(
        "INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, ?)",
        [`new007-${k}-${RUN}`, `NEW-007 ${k}`, `new007-${k}-${RUN}@teste.local`, k === "platformAdmin" ? "admin" : "user"]);
      U[k] = r.insertId;
    }
    const members: Array<[number, number, string]> = [
      [ORG_A, U.lawyer, "operator"], [ORG_A, U.lawyer2, "operator"], [ORG_A, U.viewer, "viewer"],
      [ORG_A, U.manager, "manager"], [ORG_A, U.owner, "owner"], [ORG_B, U.memberB, "owner"],
    ];
    for (const [org, u, role] of members) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
    requestA = await newRequest(ORG_A);
  }, 120_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query(`DELETE FROM users WHERE openId LIKE ?`, [`new007-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.end();
    expect(aiCalls).toEqual({ llm: 0, kernel: 0 });
  });

  // ── Recebimento ────────────────────────────────────────────────────────────────
  it("R1 viewer NÃO recebe (FORBIDDEN, papel mínimo operator) — zero escrita", async () => {
    await expectDenied(async () => (await lo(U.viewer)).receiveRequest({ requestId: requestA }), "FORBIDDEN", "operator");
  }, 30_000);

  it("R2 admin de plataforma sem membership real NÃO se autoatribui — só a auditoria PR-0 do acesso é gravada", async () => {
    const auditBefore = (await snapshot(ORG_A)).audit_logs;
    await expectDenied(async () => (await lo(U.platformAdmin, "admin", ORG_A)).receiveRequest({ requestId: requestA }),
      "FORBIDDEN", LEGAL_OPINION_MEMBERSHIP_REQUIRED, [ORG_A, ORG_B], true);
    const audit = JSON.parse((await snapshot(ORG_A)).audit_logs) as { n: number };
    expect(audit.n).toBe((JSON.parse(auditBefore) as { n: number }).n + 1); // platform_admin_tenant_access (fail-closed PR-0)
  }, 30_000);

  it("R3 cross-tenant: membro de B recebendo solicitação de A ⇒ NOT_FOUND idêntico ao inexistente, zero escrita", async () => {
    const e1 = await expectDenied(async () => (await lo(U.memberB)).receiveRequest({ requestId: requestA }), "NOT_FOUND");
    const e2 = await expectDenied(async () => (await lo(U.memberB)).receiveRequest({ requestId: "naoexiste000000" }), "NOT_FOUND");
    expect(e1.message).toBe(e2.message);
  }, 30_000);

  it("R4 operator recebe ⇒ vira o procurador designado (workspace + lawyer_assignments auditável + Engine + histórico)", async () => {
    const { workspace } = await (await lo(U.lawyer)).receiveRequest({ requestId: requestA });
    wsA = workspace.id;
    expect(workspace).toMatchObject({ assignedLawyer: U.lawyer, currentStage: "UNDER_ANALYSIS", organizationId: ORG_A });
    const assignments = await one<{ lawyer_id: number; correlation_id: string }>("SELECT lawyer_id, correlation_id FROM lawyer_assignments WHERE organization_id = ? AND workspace_id = ?", [ORG_A, wsA]);
    expect(assignments).toHaveLength(1);
    expect(assignments[0].lawyer_id).toBe(U.lawyer);
    expect(assignments[0].correlation_id).toMatch(/^corr-new007-/);
    const req = await one<{ status: string; assigned_to: number }>("SELECT status, assigned_to FROM institutional_requests WHERE id = ? AND organization_id = ?", [requestA, ORG_A]);
    expect(req[0]).toMatchObject({ status: "IN_PROGRESS", assigned_to: U.lawyer });
    const hist = await one<{ event_type: string; actor: string }>("SELECT event_type, actor FROM legal_opinion_history WHERE organization_id = ? AND workspace_id = ? ORDER BY event_order", [ORG_A, wsA]);
    expect(hist.map(h => h.event_type)).toEqual(["workspace_created", "received", "under_analysis"]);
    expect(new Set(hist.map(h => h.actor))).toEqual(new Set([String(U.lawyer)]));
  }, 30_000);

  it("R5 retry do MESMO procurador ⇒ mesmo workspace, NENHUMA escrita (sem duplicar atribuição/eventos)", async () => {
    const before = await snapshot(ORG_A);
    const { workspace } = await (await lo(U.lawyer)).receiveRequest({ requestId: requestA });
    expect(workspace.id).toBe(wsA);
    expect(await snapshot(ORG_A)).toEqual(before);
  }, 30_000);

  it("R6 OUTRO operator tentando receber workspace já atribuído ⇒ CONFLICT estável, nunca sobrescreve", async () => {
    await expectDenied(async () => (await lo(U.lawyer2)).receiveRequest({ requestId: requestA }), "CONFLICT", LEGAL_OPINION_ALREADY_ASSIGNED);
    await expectDenied(async () => (await lo(U.owner)).receiveRequest({ requestId: requestA }), "CONFLICT", LEGAL_OPINION_ALREADY_ASSIGNED);
    const ws = await one<{ assigned_lawyer: number }>("SELECT assigned_lawyer FROM legal_opinion_workspaces WHERE id = ?", [wsA]);
    expect(ws[0].assigned_lawyer).toBe(U.lawyer);
  }, 30_000);

  // ── Elaboração ────────────────────────────────────────────────────────────────
  it("C1 viewer NÃO cria/edita/assina/devolve/arquiva (FORBIDDEN) — zero escrita", async () => {
    const c = await lo(U.viewer);
    await expectDenied(() => c.createDraft({ workspaceId: wsA, opinionType: "LEGAL_OPINION_INITIAL", report: "viewer" }), "FORBIDDEN");
    await expectDenied(() => c.updateOpinion({ workspaceId: wsA, report: "viewer" }), "FORBIDDEN");
    await expectDenied(() => c.signOpinion({ workspaceId: wsA, method: "manual", idempotencyKey: `vw-${RUN}-0001` }), "FORBIDDEN");
    await expectDenied(() => c.returnOpinion({ workspaceId: wsA }), "FORBIDDEN");
    await expectDenied(() => c.archiveOpinion({ workspaceId: wsA }), "FORBIDDEN");
  }, 60_000);

  it("C2 operator NÃO designado: create/update/sign/return/archive ⇒ FORBIDDEN token estável — zero escrita", async () => {
    const c = await lo(U.lawyer2);
    await expectDenied(() => c.createDraft({ workspaceId: wsA, opinionType: "LEGAL_OPINION_INITIAL", report: "x" }), "FORBIDDEN", LEGAL_OPINION_ASSIGNMENT_REQUIRED);
    await expectDenied(() => c.updateOpinion({ workspaceId: wsA, report: "x" }), "FORBIDDEN", LEGAL_OPINION_ASSIGNMENT_REQUIRED);
    await expectDenied(() => c.signOpinion({ workspaceId: wsA, idempotencyKey: `op2-${RUN}-0001` }), "FORBIDDEN", LEGAL_OPINION_ASSIGNMENT_REQUIRED);
    await expectDenied(() => c.returnOpinion({ workspaceId: wsA }), "FORBIDDEN", LEGAL_OPINION_ASSIGNMENT_REQUIRED);
    await expectDenied(() => c.archiveOpinion({ workspaceId: wsA }), "FORBIDDEN", LEGAL_OPINION_ASSIGNMENT_REQUIRED);
  }, 60_000);

  it("C3 cross-tenant: membro (owner) de B em workspace de A ⇒ NOT_FOUND idêntico ao inexistente — zero escrita", async () => {
    const c = await lo(U.memberB);
    const e1 = await expectDenied(() => c.createDraft({ workspaceId: wsA, opinionType: "LEGAL_OPINION_INITIAL" }), "NOT_FOUND");
    const e2 = await expectDenied(() => c.signOpinion({ workspaceId: wsA, idempotencyKey: `b-${RUN}-00001` }), "NOT_FOUND");
    const e3 = await expectDenied(() => c.signOpinion({ workspaceId: "naoexiste0000000000", idempotencyKey: `b-${RUN}-00002` }), "NOT_FOUND");
    expect(new Set([e1.message, e2.message, e3.message]).size).toBe(1);
  }, 30_000);

  it("C4 procurador designado cria e edita o parecer (v1 → v2)", async () => {
    const c = await lo(U.lawyer);
    const created = await c.createDraft({
      workspaceId: wsA, opinionType: "LEGAL_OPINION_INITIAL", report: "Relatório.", foundation: "Art. 53 da Lei 14.133/2021.",
      conclusion: "Pela regularidade.", conclusionType: "favoravel",
    });
    expect(created.draft).toMatchObject({ author: U.lawyer, version: 1, signed: false });
    const { draft } = await c.updateOpinion({ workspaceId: wsA, report: "Relatório revisado." });
    expect(draft).toMatchObject({ version: 2, report: "Relatório revisado.", signed: false });
  }, 30_000);

  // ── Assinatura ────────────────────────────────────────────────────────────────
  it("S1 NÃO assinam sem atribuição: viewer, operator, manager, owner e admin de plataforma — zero escrita", async () => {
    const key = `nosig-${RUN}-001`;
    await expectDenied(async () => (await lo(U.viewer)).signOpinion({ workspaceId: wsA, idempotencyKey: key }), "FORBIDDEN");
    for (const u of [U.lawyer2, U.manager, U.owner]) {
      await expectDenied(async () => (await lo(u)).signOpinion({ workspaceId: wsA, idempotencyKey: key }), "FORBIDDEN", LEGAL_OPINION_ASSIGNMENT_REQUIRED);
    }
    await expectDenied(async () => (await lo(U.platformAdmin, "admin", ORG_A)).signOpinion({ workspaceId: wsA, idempotencyKey: key }),
      "FORBIDDEN", LEGAL_OPINION_ASSIGNMENT_REQUIRED, [ORG_A, ORG_B], true);
    expect(await emitidoCount(wsA)).toBe(0);
  }, 60_000);

  it("S2 procurador designado assina ⇒ 1 versão oficial emitido, histórico 'signed', idempotência registrada", async () => {
    signedKey = `sig-${RUN}-0001`;
    const r = await (await lo(U.lawyer)).signOpinion({ workspaceId: wsA, method: "manual", idempotencyKey: signedKey });
    expect(r.replayed).toBe(false);
    expect(r.draft).toMatchObject({ signed: true, signedBy: U.lawyer, signatureMethod: "manual" });
    expect(r.workspace.currentStage).toBe("SIGNED");
    expect(await emitidoCount(wsA)).toBe(1);
    // SEM-083 ("assinante = designado"): pelo router real, quem assina É o procurador designado (assignedLawyer) e o
    // snapshot da versão emitida registra exatamente esse signatário (id + autor do documento).
    const [assigned] = await one<{ assigned_lawyer: number }>("SELECT assigned_lawyer FROM legal_opinion_workspaces WHERE id = ? AND organization_id = ?", [wsA, ORG_A]);
    expect(assigned.assigned_lawyer).toBe(U.lawyer);
    const [emitido] = await one<{ author: string; metadata: string }>("SELECT author, metadata FROM official_documents WHERE tenant_id = ? AND origin = ? AND status = 'emitido'", [ORG_A, wsA]);
    const meta = JSON.parse(emitido.metadata);
    expect(meta.signatureSnapshot).toMatchObject({ signed: true, signerUserId: assigned.assigned_lawyer });
    expect(meta.signedBy).toBe(assigned.assigned_lawyer);
    expect(emitido.author).toBe(String(assigned.assigned_lawyer));
    const hist = await one<{ event_type: string; actor: string }>("SELECT event_type, actor FROM legal_opinion_history WHERE workspace_id = ? AND event_type = 'signed'", [wsA]);
    expect(hist).toEqual([{ event_type: "signed", actor: String(U.lawyer) }]);
    const keys = await one<{ n: number }>("SELECT COUNT(*) AS n FROM idempotency_keys WHERE organizationId = ? AND userId = ? AND `key` = ?", [ORG_A, U.lawyer, signedKey]);
    expect(Number(keys[0].n)).toBe(1);
  }, 30_000);

  it("S3 retry: mesma key + mesmo payload ⇒ replay sem escrita; mesma key + payload diferente ⇒ CONFLICT", async () => {
    const c = await lo(U.lawyer);
    const before = await snapshot(ORG_A);
    const r = await c.signOpinion({ workspaceId: wsA, method: "manual", idempotencyKey: signedKey });
    expect(r.replayed).toBe(true);
    expect(r.draft).toMatchObject({ signed: true, signedBy: U.lawyer });
    expect(await snapshot(ORG_A)).toEqual(before);
    await expectDenied(() => c.signOpinion({ workspaceId: wsA, method: "icp_brasil", idempotencyKey: signedKey }), "CONFLICT", "payload diferente");
    // key nova, mesmo signatário ⇒ converge (sem 2ª emissão)
    const r2 = await c.signOpinion({ workspaceId: wsA, method: "manual", idempotencyKey: `sig-${RUN}-0002` });
    expect(r2.draft.signed).toBe(true);
    expect(await emitidoCount(wsA)).toBe(1);
  }, 30_000);

  it("S4 parecer assinado é IMUTÁVEL: nem o procurador edita; ninguém mais assina", async () => {
    const [draftBefore] = await one("SELECT * FROM legal_opinion_drafts WHERE workspace_id = ? AND organization_id = ?", [wsA, ORG_A]);
    await expect((await lo(U.lawyer)).updateOpinion({ workspaceId: wsA, report: "tentativa pós-assinatura" })).rejects.toThrow(/imutável|assinado/i);
    await expectDenied(async () => (await lo(U.lawyer2)).signOpinion({ workspaceId: wsA, idempotencyKey: `sig2-${RUN}-001` }), "FORBIDDEN", LEGAL_OPINION_ASSIGNMENT_REQUIRED);
    const [draftAfter] = await one("SELECT * FROM legal_opinion_drafts WHERE workspace_id = ? AND organization_id = ?", [wsA, ORG_A]);
    expect(draftAfter).toEqual(draftBefore);
    expect(await emitidoCount(wsA)).toBe(1);
  }, 30_000);

  it("S5 devolver/arquivar: não designado recusado (zero escrita); designado devolve", async () => {
    await expectDenied(async () => (await lo(U.owner)).returnOpinion({ workspaceId: wsA }), "FORBIDDEN", LEGAL_OPINION_ASSIGNMENT_REQUIRED);
    await expectDenied(async () => (await lo(U.manager)).archiveOpinion({ workspaceId: wsA }), "FORBIDDEN", LEGAL_OPINION_ASSIGNMENT_REQUIRED);
    const r = await (await lo(U.lawyer)).returnOpinion({ workspaceId: wsA });
    expect(r.status).toBe("RETURNED");
  }, 30_000);

  it("S6 procurador designado REBAIXADO a viewer perde a autoridade (zero escrita)", async () => {
    const req = await newRequest(ORG_A);
    const { workspace } = await (await lo(U.lawyer2)).receiveRequest({ requestId: req });
    await conn.execute("UPDATE organization_members SET role = 'viewer' WHERE organizationId = ? AND userId = ?", [ORG_A, U.lawyer2]);
    try {
      await expectDenied(async () => (await lo(U.lawyer2)).createDraft({ workspaceId: workspace.id, opinionType: "LEGAL_OPINION_INITIAL" }), "FORBIDDEN");
    } finally {
      await conn.execute("UPDATE organization_members SET role = 'operator' WHERE organizationId = ? AND userId = ?", [ORG_A, U.lawyer2]);
    }
  }, 30_000);

  // ── Concorrência ──────────────────────────────────────────────────────────────
  it("K1 dois receives de atores DIFERENTES em Promise.all ⇒ exatamente um vence; o outro CONFLICT; 1 atribuição, 1 recebimento", async () => {
    const req = await newRequest(ORG_A);
    const [a, b] = await Promise.allSettled([
      (async () => (await lo(U.lawyer)).receiveRequest({ requestId: req }))(),
      (async () => (await lo(U.owner)).receiveRequest({ requestId: req }))(),
    ]);
    const ok = [a, b].filter(x => x.status === "fulfilled") as Array<PromiseFulfilledResult<{ workspace: { id: string; assignedLawyer: number | null } }>>;
    const ko = [a, b].filter(x => x.status === "rejected") as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(ko).toHaveLength(1);
    expect(ko[0].reason).toMatchObject({ code: "CONFLICT" });
    expect(String(ko[0].reason.message)).toContain(LEGAL_OPINION_ALREADY_ASSIGNED);
    const winner = ok[0].value.workspace.assignedLawyer;
    const wsId = ok[0].value.workspace.id;
    const ws = await one<{ assigned_lawyer: number }>("SELECT assigned_lawyer FROM legal_opinion_workspaces WHERE id = ?", [wsId]);
    expect(ws[0].assigned_lawyer).toBe(winner);
    const asg = await one<{ lawyer_id: number }>("SELECT lawyer_id FROM lawyer_assignments WHERE workspace_id = ? AND organization_id = ?", [wsId, ORG_A]);
    expect(asg.map(x => x.lawyer_id)).toEqual([winner]);
    const received = await one<{ n: number }>("SELECT COUNT(*) AS n FROM request_timelines WHERE request_id = ? AND organization_id = ? AND event_type = 'received'", [req, ORG_A]);
    expect(Number(received[0].n)).toBe(1);
    const reqRow = await one<{ assigned_to: number }>("SELECT assigned_to FROM institutional_requests WHERE id = ?", [req]);
    expect(reqRow[0].assigned_to).toBe(winner);
  }, 60_000);

  it("K2 dois receives do MESMO ator em Promise.all ⇒ ambos ok, mesmo workspace, sem duplicar atribuição/eventos", async () => {
    const req = await newRequest(ORG_A);
    const [a, b] = await Promise.all([
      (async () => (await lo(U.lawyer)).receiveRequest({ requestId: req }))(),
      (async () => (await lo(U.lawyer)).receiveRequest({ requestId: req }))(),
    ]);
    expect(a.workspace.id).toBe(b.workspace.id);
    const asg = await one<{ n: number }>("SELECT COUNT(*) AS n FROM lawyer_assignments WHERE workspace_id = ?", [a.workspace.id]);
    expect(Number(asg[0].n)).toBe(1);
    const hist = await one<{ event_type: string }>("SELECT event_type FROM legal_opinion_history WHERE workspace_id = ? ORDER BY event_order", [a.workspace.id]);
    expect(hist.map(h => h.event_type)).toEqual(["workspace_created", "received", "under_analysis"]);
    const received = await one<{ n: number }>("SELECT COUNT(*) AS n FROM request_timelines WHERE request_id = ? AND event_type = 'received'", [req]);
    expect(Number(received[0].n)).toBe(1);
  }, 60_000);

  it("K3 duas assinaturas em Promise.all (mesma key, designado) + uma do não designado ⇒ 1 emissão, não designado FORBIDDEN", async () => {
    const req = await newRequest(ORG_A);
    const c = await lo(U.lawyer);
    const { workspace } = await c.receiveRequest({ requestId: req });
    await c.createDraft({ workspaceId: workspace.id, opinionType: "LEGAL_OPINION_INITIAL", report: "R", conclusion: "C", conclusionType: "favoravel" });
    const key = `sigk3-${RUN}-001`;
    const results = await Promise.allSettled([
      c.signOpinion({ workspaceId: workspace.id, method: "manual", idempotencyKey: key }),
      c.signOpinion({ workspaceId: workspace.id, method: "manual", idempotencyKey: key }),
      (async () => (await lo(U.owner)).signOpinion({ workspaceId: workspace.id, method: "manual", idempotencyKey: key }))(),
    ]);
    const lawyerResults = results.slice(0, 2);
    expect(lawyerResults.filter(r => r.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    for (const r of lawyerResults) if (r.status === "rejected") expect(r.reason).toMatchObject({ code: "CONFLICT" }); // "em processamento"
    expect(results[2]).toMatchObject({ status: "rejected", reason: { code: "FORBIDDEN" } });
    expect(await emitidoCount(workspace.id)).toBe(1);
    const signedRows = await one<{ signed: number; signed_by: number }>("SELECT signed, signed_by FROM legal_opinion_drafts WHERE workspace_id = ?", [workspace.id]);
    expect(signedRows).toEqual([{ signed: 1, signed_by: U.lawyer }]);
    const ownerKeys = await one<{ n: number }>("SELECT COUNT(*) AS n FROM idempotency_keys WHERE organizationId = ? AND userId = ?", [ORG_A, U.owner]);
    expect(Number(ownerKeys[0].n)).toBe(0); // recusa não consome/grava chave
  }, 60_000);
});

/**
 * NEW-007 — integridade da autoridade jurídica (revisão independente do PR #329) em MySQL REAL, routers reais
 * (`appRouter.institutionalRequest`, `legalOpinionWorkspace`, `contractWorkspace`, `directProcurement`). Só roda com DATABASE_URL
 * (banco local isolado; tenants sintéticos 996731/996732 — nunca a organização 1).
 *
 *  - criação incoerente (`LEGAL_OPINION_*` → controle_interno) ⇒ BAD_REQUEST, zero escrita;
 *  - registro LEGADO incoerente (gravado antes do patch, com resposta `signed=1`) ⇒ genérico recusa toda mutação (zero escrita),
 *    consumidores NÃO o exibem como parecer, e a linha original continua intacta;
 *  - fluxo governado do procurador designado ⇒ consumidor de Contratos recebe GOVERNED_LEGAL_OPINION;
 *  - pedido técnico ao Controle Interno segue funcionando pelo genérico; leitura cross-tenant não vê nada.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const aiCalls = vi.hoisted(() => ({ llm: 0 }));
vi.mock("../../_core/llm", async (orig) => {
  const actual = await orig<typeof import("../../_core/llm")>();
  return { ...actual, invokeLLM: (async () => { aiCalls.llm++; throw new Error("IA proibida neste smoke"); }) as typeof actual.invokeLLM };
});

import { requestInstitutionalReview } from "../../services/institutionalRequestService";
import { createInstitutionalRequest } from "../../domain/institutionalRequest";
import { createInstitutionalResponse, signResponse } from "../../domain/institutionalResponse";
import { insertRequest, insertResponse } from "../../db/institutionalRequests";

const DB = process.env.DATABASE_URL;
const ORG_A = 996731;
const ORG_B = 996732;
const RUN = Date.now().toString(36);
const ORG_TABLES: Array<[string, string]> = [
  ["legal_opinion_workspaces", "organization_id"], ["legal_opinion_drafts", "organization_id"], ["legal_opinion_versions", "organization_id"],
  ["legal_opinion_history", "organization_id"], ["lawyer_assignments", "organization_id"], ["institutional_requests", "organization_id"],
  ["institutional_responses", "organization_id"], ["request_timelines", "organization_id"], ["request_notifications", "organization_id"],
  ["request_assignments", "organization_id"], ["document_references", "organization_id"], ["official_documents", "tenant_id"],
  ["official_document_timeline", "tenant_id"], ["idempotency_keys", "organizationId"],
];

describe.skipIf(!DB)("NEW-007 — roteamento jurídico e proveniência do parecer (MySQL real, routers reais)", () => {
  let conn: mysql.Connection;
  const U = { operator: 0, lawyer: 0, manager: 0, viewer: 0, memberB: 0 };
  let seq = 0;
  const LEGACY = `legacy${RUN}`.slice(0, 20);

  async function caller(userId: number) {
    const { appRouter } = await import("../../routers");
    return appRouter.createCaller({
      user: { id: userId, role: "user", name: `Usuário ${userId}`, email: `u${userId}@teste.local` },
      req: { headers: {}, ip: "127.0.0.1" }, res: {}, correlationId: `corr-n7r-${userId}-${++seq}`,
    } as unknown as Parameters<typeof appRouter.createCaller>[0]);
  }
  async function snapshot(): Promise<string> {
    const out: string[] = [];
    for (const org of [ORG_A, ORG_B]) for (const [t, col] of ORG_TABLES) {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT * FROM \`${t}\` WHERE \`${col}\` = ? ORDER BY 1`, [org]);
      out.push(JSON.stringify(rows));
    }
    return out.join("\n");
  }
  async function expectDenied(run: () => Promise<unknown>, code: string, token: string) {
    const before = await snapshot();
    const err = await run().then(() => null, (e: { code?: string; message?: string }) => e);
    expect(err, "deveria ter sido recusada").not.toBeNull();
    expect(err).toMatchObject({ code, message: expect.stringContaining(token) });
    expect(await snapshot()).toBe(before); // ZERO escrita
  }
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
      await conn.query("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE ativo = 1", [org, `Org sintética N7R ${org}`, `n7r-sintetica-${org}`]);
    }
    for (const k of Object.keys(U) as Array<keyof typeof U>) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')", [`n7r-${k}-${RUN}`, `N7R ${k}`, `n7r-${k}-${RUN}@teste.local`]);
      U[k] = r.insertId;
    }
    for (const [org, u, role] of [[ORG_A, U.operator, "operator"], [ORG_A, U.lawyer, "operator"], [ORG_A, U.manager, "manager"], [ORG_A, U.viewer, "viewer"], [ORG_B, U.memberB, "owner"]] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
    // Registro LEGADO incoerente, gravado como seria antes do patch (resposta genérica marcada como assinada).
    const legacy = { ...createInstitutionalRequest({ organizationId: ORG_A, sourceDomain: "contratos", destinationDomain: "controle_interno", requestType: "LEGAL_OPINION_INITIAL", referenceProcessId: `ctw-${RUN}`.slice(0, 20), title: "Parecer legado", requestedBy: U.operator, correlationId: `legacy-${RUN}` }), id: LEGACY, status: "RETURNED" as const };
    await insertRequest(legacy);
    await insertResponse(signResponse(createInstitutionalResponse({ requestId: LEGACY, organizationId: ORG_A, responder: U.operator, responseType: "parecer", responseStatus: "favoravel", comments: "Favorável.", correlationId: `legacy-${RUN}` }), "manual", "2026-10-01T00:00:00.000Z"));
  }, 120_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.query("DELETE FROM users WHERE openId LIKE ?", [`n7r-%-${RUN}`]).catch(() => {});
    await conn.query("DELETE FROM organizations WHERE id IN (?, ?)", [ORG_A, ORG_B]).catch(() => {});
    await conn.end();
    expect(aiCalls.llm).toBe(0);
  });

  it("criação LEGAL_OPINION_INITIAL/FINAL → controle_interno pelo router genérico ⇒ BAD_REQUEST, zero escrita", async () => {
    for (const requestType of ["LEGAL_OPINION_INITIAL", "LEGAL_OPINION_FINAL"] as const) {
      await expectDenied(async () => (await caller(U.operator)).institutionalRequest.createRequest({
        sourceDomain: "contratos", destinationDomain: "controle_interno", requestType, referenceProcessId: "ctw-x", title: "Parecer?" }), "BAD_REQUEST", "LEGAL_OPINION_ROUTING_INVALID");
    }
  }, 60_000);

  it("legado incoerente: receber/responder/devolver/arquivar pelo genérico ⇒ FORBIDDEN, zero escrita; consumidores não o tratam como parecer", async () => {
    const c = (await caller(U.manager)).institutionalRequest;
    await expectDenied(() => c.respond({ requestId: LEGACY, responseType: "parecer", responseStatus: "favoravel", sign: "manual" }), "FORBIDDEN", "LEGAL_OPINION_GOVERNED_FLOW");
    await expectDenied(() => c.receiveRequest({ requestId: LEGACY }), "FORBIDDEN", "LEGAL_OPINION_GOVERNED_FLOW");
    await expectDenied(() => c.archive({ requestId: LEGACY }), "FORBIDDEN", "LEGAL_OPINION_GOVERNED_FLOW");
    const before = await snapshot();
    const contract = await (await caller(U.viewer)).contractWorkspace.getLegalOpinion({ requestId: LEGACY });
    expect(contract).toMatchObject({ response: null, legalOpinion: { status: "NOT_GOVERNED", reason: "LEGAL_OPINION_ROUTING_INVALID" }, institutionalResponse: { governedLegalOpinion: false, signed: true } });
    const direct = await (await caller(U.viewer)).directProcurement.getLegalOpinion({ requestId: LEGACY });
    expect(direct).toMatchObject({ response: null, legalOpinion: { status: "NOT_GOVERNED", reason: "SOURCE_DOMAIN_MISMATCH" } });
    expect(await snapshot()).toBe(before); // leitura não corrige nem apaga o histórico
    const [rows] = await conn.query<mysql.RowDataPacket[]>("SELECT signed, response_type FROM institutional_responses WHERE organization_id = ? AND request_id = ?", [ORG_A, LEGACY]);
    expect(rows).toEqual([{ signed: 1, response_type: "parecer" }]);
  }, 60_000);

  it("fluxo governado: procurador designado recebe → elabora → assina → devolve ⇒ Contratos recebe GOVERNED_LEGAL_OPINION", async () => {
    const { request } = await requestInstitutionalReview({
      organizationId: ORG_A, sourceDomain: "contratos", destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_INITIAL",
      referenceProcessId: `ctw-${RUN}`.slice(0, 20), title: "Parecer — Contrato sintético", priority: "alta", requestedBy: U.operator, correlationId: `gov-${RUN}`,
    });
    const pending = await (await caller(U.viewer)).contractWorkspace.getLegalOpinion({ requestId: request.id });
    expect(pending.legalOpinion).toMatchObject({ status: "PENDING" });
    // O genérico continua sem tocar a solicitação ao Parecer.
    await expectDenied(async () => (await caller(U.manager)).institutionalRequest.respond({ requestId: request.id, responseType: "parecer", responseStatus: "favoravel", sign: "manual" }), "FORBIDDEN", "LEGAL_OPINION_GOVERNED_FLOW");
    const lo = (await caller(U.lawyer)).legalOpinionWorkspace;
    const { workspace } = await lo.receiveRequest({ requestId: request.id });
    await lo.createDraft({ workspaceId: workspace.id, opinionType: "LEGAL_OPINION_INITIAL", report: "Relatório.", foundation: "Art. 53 da Lei 14.133/2021.", conclusion: "Pela regularidade.", conclusionType: "favoravel" });
    await lo.signOpinion({ workspaceId: workspace.id, method: "manual", idempotencyKey: `n7r-sig-${RUN}` });
    await lo.returnOpinion({ workspaceId: workspace.id });
    for (let i = 0; i < 2; i++) {
      const r = await (await caller(U.viewer)).contractWorkspace.getLegalOpinion({ requestId: request.id });
      expect(r.legalOpinion).toMatchObject({ status: "GOVERNED_LEGAL_OPINION", signedBy: U.lawyer, signatureMethod: "manual" });
      expect(r.response).toMatchObject({ responseType: "parecer", responseStatus: "favoravel", responder: U.lawyer, governedLegalOpinion: true });
    }
    // Contratação Direta não aceita o parecer de Contratos como seu; outro tenant não vê nada.
    expect((await (await caller(U.viewer)).directProcurement.getLegalOpinion({ requestId: request.id })).legalOpinion).toMatchObject({ status: "NOT_GOVERNED", reason: "SOURCE_DOMAIN_MISMATCH" });
    expect(await (await caller(U.memberB)).contractWorkspace.getLegalOpinion({ requestId: request.id })).toMatchObject({ response: null, institutionalResponse: null, legalOpinion: { reason: "REQUEST_NOT_FOUND" } });
  }, 120_000);

  it("pedido técnico legítimo ao Controle Interno segue pelo genérico (criar → receber → responder ⇒ RETURNED)", async () => {
    const c = (await caller(U.operator)).institutionalRequest;
    const { request } = await c.createRequest({ sourceDomain: "contratos", destinationDomain: "controle_interno", requestType: "CONTROL_REVIEW", referenceProcessId: `ctw-${RUN}`.slice(0, 20), title: "Revisão do Controle Interno" });
    await c.receiveRequest({ requestId: request.id });
    const r = await c.respond({ requestId: request.id, responseType: "revisao", responseStatus: "com_ressalvas", comments: "Ressalvas técnicas." });
    expect(r.request.status).toBe("RETURNED");
    await expectDenied(async () => (await caller(U.viewer)).institutionalRequest.archive({ requestId: request.id }), "FORBIDDEN", "operator");
  }, 60_000);
});

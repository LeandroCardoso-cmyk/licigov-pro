/**
 * NEW-007 — integridade da autoridade jurídica no Institutional Request Engine (revisão independente do PR #329).
 *
 * Contorno reproduzido: um operator criava `LEGAL_OPINION_INITIAL` destinada a `controle_interno` (a guarda do router só olhava
 * `destinationDomain === "parecer_juridico"`), recebia e respondia pelo router genérico com `responseType=parecer`, `favoravel`,
 * `sign=manual` ⇒ resposta `signed:true`, solicitação `RETURNED`, e Contratos/Contratação Direta a exibiam como parecer.
 *
 * Invariantes agora (router + serviço + consumidores reais; persistência em memória, contando escritas):
 *  - criação: tipo `LEGAL_OPINION_*` só com destino `parecer_juridico` (`LEGAL_OPINION_ROUTING_INVALID`, zero escrita);
 *  - resposta/recebimento/designação/devolução/arquivo: solicitação juridicamente tipificada OU destinada ao Parecer só pelo fluxo
 *    governado (`LEGAL_OPINION_GOVERNED_FLOW`, zero escrita) — inclusive registros legados incoerentes;
 *  - consumidores: só exibem como parecer a resposta com origem governada comprovada (workspace do Parecer + parecer assinado +
 *    resposta do procurador designado); o resto é `NOT_GOVERNED` (histórico preservado, nunca promovido).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { makeContext } from "../helpers/fixtures";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const m = vi.hoisted(() => ({
  ORG: 82001, OTHER_ORG: 82002,
  roleByUser: new Map<number, string>(),
  requests: new Map<string, Row>(), responses: new Map<string, Row>(), timeline: [] as Row[],
  workspaces: new Map<string, Row>(), drafts: new Map<string, Row>(),
  writes: 0,
}));

vi.mock("../../services/tenantService", () => ({
  getMembership: vi.fn(async (userId: number, orgId: number) => (orgId === m.ORG && m.roleByUser.has(userId) ? { id: userId, organizationId: orgId, userId, role: m.roleByUser.get(userId), ativo: true } : null)),
  resolveTenantForUser: vi.fn(async (userId: number) => {
    const role = m.roleByUser.get(userId);
    if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "sem membership" });
    return { organizationId: m.ORG, membership: { id: userId, organizationId: m.ORG, userId, role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() } };
  }),
}));

vi.mock("../../db/institutionalRequests", () => {
  const key = (id: string, org: number) => `${org}:${id}`;
  return {
    insertRequest: vi.fn(async (r: Row) => { m.writes++; m.requests.set(key(r.id, r.organizationId), { ...r }); return r; }),
    getRequest: vi.fn(async (id: string, org: number) => { const r = m.requests.get(key(id, org)); return r ? { ...r } : null; }),
    updateRequestStatus: vi.fn(async (id: string, org: number, status: string, assignedTo: number | null, updatedAt: string, from?: string) => {
      const r = m.requests.get(key(id, org)); if (!r) return false;
      if (from && r.status !== from) return false;
      m.writes++; Object.assign(r, { status, assignedTo, updatedAt }); return true;
    }),
    insertResponse: vi.fn(async (resp: Row) => { m.writes++; m.responses.set(key(resp.requestId, resp.organizationId), { ...resp }); return resp; }),
    getResponseForRequest: vi.fn(async (requestId: string, org: number) => {
      const r = m.responses.get(key(requestId, org));
      return r ? { id: r.id, responder: r.responder, responseType: r.responseType, responseStatus: r.responseStatus, comments: r.comments, signed: r.signed, signatureMethod: r.signatureMethod } : null;
    }),
    insertAssignment: vi.fn(async (a: Row) => { m.writes++; return a; }),
    insertRequestTimelineEntry: vi.fn(async (e: Row) => { m.writes++; m.timeline.push(e); return e; }),
    countTimeline: vi.fn(async (requestId: string) => m.timeline.filter((e) => e.requestId === requestId).length),
    listRequestTimeline: vi.fn(async (requestId: string, org: number) => m.timeline.filter((e) => e.requestId === requestId && e.organizationId === org)),
    insertNotification: vi.fn(async (n: Row) => { m.writes++; return n; }),
    insertDocumentReference: vi.fn(async (d: Row) => { m.writes++; return d; }),
    listDocumentReferences: vi.fn(async () => []),
    listPendingForDomain: vi.fn(async () => []),
    listCompletedForDomain: vi.fn(async () => []),
  };
});

vi.mock("../../db/legalOpinionWorkspace", async (orig) => ({
  ...(await orig<typeof import("../../db/legalOpinionWorkspace")>()),
  getLegalOpinionWorkspaceByRequest: vi.fn(async (requestId: string, org: number) => [...m.workspaces.values()].find((w) => w.requestId === requestId && w.organizationId === org) ?? null),
  getLegalOpinionWorkspace: vi.fn(async (id: string, org: number) => { const w = m.workspaces.get(id); return w && w.organizationId === org ? { ...w } : null; }),
  getLegalOpinionDraftByWorkspace: vi.fn(async (wsId: string, org: number) => { const d = m.drafts.get(wsId); return d && d.organizationId === org ? { ...d } : null; }),
  updateLegalOpinionWorkspaceStage: vi.fn(async (id: string, _org: number, currentStage: string, status: string, assignedLawyer: number | null, updatedAt: string) => {
    m.writes++; Object.assign(m.workspaces.get(id)!, { currentStage, status, assignedLawyer, updatedAt }); return true;
  }),
  countLegalOpinionHistory: vi.fn(async () => 0),
  insertLegalOpinionHistory: vi.fn(async (e: Row) => { m.writes++; return e; }),
}));

import { institutionalRequestRouter } from "../../routers/institutionalRequestRouter";
import { getContractLegalOpinion } from "../../services/contractService";
import { getLegalOpinionResult } from "../../services/directProcurementService";
import { returnOpinion } from "../../services/legalOpinionWorkspaceService";
import { respondRequest } from "../../services/institutionalRequestService";

const OPERATOR = 2, VIEWER = 1, MANAGER = 3, LAWYER = 7, OUTSIDER = 99;
const user = (id: number) => ({ id, role: "user" as const, openId: `u${id}`, name: `U${id}`, email: `u${id}@x`, theme: "light" as const, loginMethod: "email", passwordHash: null, signaturePassword: null, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() });
let seq = 0;
const as = (id: number) => institutionalRequestRouter.createCaller({ ...makeContext(user(id) as never), correlationId: `corr-${++seq}` } as never);

/** Registro persistido (inclusive legado) — escrito direto no "banco", como um dado antigo anterior ao patch. */
function seedRequest(p: { id: string; sourceDomain: string; destinationDomain: string; requestType: string; status?: string; org?: number }): Row {
  const r = { organizationId: p.org ?? m.ORG, referenceProcessId: "proc-1", referenceDocumentId: "", title: p.id, description: "", priority: "alta",
    status: p.status ?? "PENDING", requestedBy: OPERATOR, assignedTo: null, correlationId: `seed-${p.id}`, createdAt: "2026-10-27T00:00:00.000Z", updatedAt: "2026-10-27T00:00:00.000Z", ...p };
  m.requests.set(`${r.organizationId}:${r.id}`, r);
  return r;
}
function seedResponse(requestId: string, p: Partial<Row> = {}, org = m.ORG): void {
  m.responses.set(`${org}:${requestId}`, { id: `resp-${requestId}`, requestId, organizationId: org, responder: OPERATOR, responseType: "parecer", responseStatus: "favoravel", comments: "Favorável.", signed: true, signatureMethod: "manual", ...p });
}
/** Fluxo governado já percorrido pelo procurador designado: workspace do Parecer + parecer assinado. */
function seedGovernedWorkspace(requestId: string, stage = "SIGNED"): void {
  const wsId = `ws-${requestId}`;
  m.workspaces.set(wsId, { id: wsId, organizationId: m.ORG, requestId, sourceDomain: "contratos", referenceProcessId: "proc-1", requestType: "LEGAL_OPINION_INITIAL", currentStage: stage, status: "assinado", assignedLawyer: LAWYER, responsibleSector: "", priority: "alta", correlationId: "c", createdAt: "x", updatedAt: "x" });
  m.drafts.set(wsId, { id: `d-${requestId}`, organizationId: m.ORG, workspaceId: wsId, requestId, opinionType: "LEGAL_OPINION_INITIAL", report: "r", foundation: "f", conclusion: "Favorável ao prosseguimento.", conclusionType: "favoravel", recommendations: [], reservations: [], attachments: [], status: "assinado", version: 2, signed: true, signatureMethod: "manual", signedBy: LAWYER, signedAt: "2026-10-27T10:00:00.000Z", author: LAWYER, correlationId: "c", createdAt: "x", updatedAt: "x" });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.roleByUser.clear(); m.requests.clear(); m.responses.clear(); m.timeline.length = 0; m.workspaces.clear(); m.drafts.clear(); m.writes = 0;
  for (const [id, role] of [[VIEWER, "viewer"], [OPERATOR, "operator"], [MANAGER, "manager"], [LAWYER, "operator"]] as const) m.roleByUser.set(id, role);
});

describe("NEW-007 — criação: tipo jurídico só com destino Parecer Jurídico", () => {
  it.each([
    ["LEGAL_OPINION_INITIAL", "contratos", "controle_interno"],
    ["LEGAL_OPINION_FINAL", "contratos", "controle_interno"],
    ["LEGAL_OPINION_INITIAL", "processo_licitatorio", "gestao_departamento"],
    ["LEGAL_OPINION_FINAL", "parecer_juridico", "contratos"],
  ] as const)("%s %s → %s ⇒ BAD_REQUEST LEGAL_OPINION_ROUTING_INVALID, zero escrita (repetido: idem)", async (requestType, sourceDomain, destinationDomain) => {
    for (let i = 0; i < 2; i++) {
      await expect(as(OPERATOR).createRequest({ sourceDomain, destinationDomain, requestType, referenceProcessId: "proc-1", title: "Parecer?" }))
        .rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/^LEGAL_OPINION_ROUTING_INVALID:/) });
    }
    expect(m.writes).toBe(0);
  });
  it("viewer ⇒ FORBIDDEN antes da validação de rota (zero escrita)", async () => {
    await expect(as(VIEWER).createRequest({ sourceDomain: "contratos", destinationDomain: "controle_interno", requestType: "LEGAL_OPINION_INITIAL", referenceProcessId: "proc-1", title: "x" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(m.writes).toBe(0);
  });
  it("positivo: solicitação de parecer ao Parecer Jurídico pelo fluxo de origem continua aceita (PENDING); repetição converge no mesmo id", async () => {
    const input = { sourceDomain: "contratos", destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_INITIAL", referenceProcessId: "proc-1", title: "Parecer — Contrato" } as const;
    const c = institutionalRequestRouter.createCaller({ ...makeContext(user(OPERATOR) as never), correlationId: "corr-fixed" } as never);
    const a = await c.createRequest(input);
    const b = await c.createRequest(input);
    expect(a.request).toMatchObject({ status: "PENDING", destinationDomain: "parecer_juridico" });
    expect(b.request.id).toBe(a.request.id);
  });
  it("positivo: pedidos técnicos legítimos ao Controle Interno (CONTROL_REVIEW/TECHNICAL_REVIEW/DOCUMENT_REVIEW/INFORMATION_REQUEST)", async () => {
    for (const requestType of ["CONTROL_REVIEW", "TECHNICAL_REVIEW", "DOCUMENT_REVIEW", "INFORMATION_REQUEST"] as const) {
      await expect(as(OPERATOR).createRequest({ sourceDomain: "contratos", destinationDomain: "controle_interno", requestType, referenceProcessId: "proc-1", title: `Análise ${requestType}` }))
        .resolves.toMatchObject({ request: { status: "PENDING", requestType } });
    }
  });
  it("serviço (defesa em profundidade): chamada interna incoerente também é recusada antes de gravar", async () => {
    const { requestInstitutionalReview } = await import("../../services/institutionalRequestService");
    await expect(requestInstitutionalReview({ organizationId: m.ORG, sourceDomain: "contratos", destinationDomain: "controle_interno", requestType: "LEGAL_OPINION_FINAL", referenceProcessId: "p", title: "t", requestedBy: OPERATOR, correlationId: "c" }))
      .rejects.toThrow(/^LEGAL_OPINION_ROUTING_INVALID:/);
    expect(m.writes).toBe(0);
  });
});

describe("NEW-007 — resposta pelo caminho genérico", () => {
  it("reprodução do contorno: LEGAL_OPINION_INITIAL→controle_interno respondida como parecer assinado ⇒ recusada em todas as fronteiras", async () => {
    await expect(as(OPERATOR).createRequest({ sourceDomain: "contratos", destinationDomain: "controle_interno", requestType: "LEGAL_OPINION_INITIAL", referenceProcessId: "proc-1", title: "Parecer — contorno" }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    // Mesmo que o registro exista (legado anterior ao patch), receber/responder/devolver/arquivar/designar pelo genérico é recusado.
    seedRequest({ id: "legacy-1", sourceDomain: "contratos", destinationDomain: "controle_interno", requestType: "LEGAL_OPINION_INITIAL" });
    const ops = [
      () => as(OPERATOR).receiveRequest({ requestId: "legacy-1" }),
      () => as(OPERATOR).respond({ requestId: "legacy-1", responseType: "parecer", responseStatus: "favoravel", sign: "manual" }),
      () => as(MANAGER).respond({ requestId: "legacy-1", responseType: "informacao", responseStatus: "informativo" }),
      () => as(MANAGER).assignRequest({ requestId: "legacy-1", userId: OPERATOR }),
      () => as(MANAGER).returnRequest({ requestId: "legacy-1" }),
      () => as(MANAGER).archive({ requestId: "legacy-1" }),
    ];
    for (const op of ops) await expect(op()).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/^LEGAL_OPINION_GOVERNED_FLOW:/) });
    expect(m.writes).toBe(0);
    expect(m.requests.get(`${m.ORG}:legacy-1`)).toMatchObject({ status: "PENDING", assignedTo: null });
    expect(m.responses.size).toBe(0);
  });
  it("serviço respondRequest (defesa em profundidade): solicitação jurídica sem a autoridade do fluxo governado ⇒ recusa sem escrita", async () => {
    seedRequest({ id: "lo-2", sourceDomain: "contratos", destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_FINAL", status: "IN_PROGRESS" });
    seedRequest({ id: "legacy-2", sourceDomain: "contratos", destinationDomain: "controle_interno", requestType: "LEGAL_OPINION_FINAL", status: "IN_PROGRESS" });
    for (const id of ["lo-2", "legacy-2"]) {
      await expect(respondRequest({ id, organizationId: m.ORG, responder: OPERATOR, responseType: "parecer", responseStatus: "favoravel", sign: "manual", correlationId: "c" }))
        .rejects.toThrow(/^LEGAL_OPINION_GOVERNED_FLOW:/);
    }
    expect(m.writes).toBe(0);
  });
  it("positivo: Controle Interno responde tecnicamente (inclusive manifestação 'parecer' técnico) e a origem recebe RETURNED", async () => {
    seedRequest({ id: "ci-1", sourceDomain: "contratos", destinationDomain: "controle_interno", requestType: "CONTROL_REVIEW" });
    await as(OPERATOR).receiveRequest({ requestId: "ci-1" });
    const r = await as(OPERATOR).respond({ requestId: "ci-1", responseType: "parecer", responseStatus: "com_ressalvas", comments: "Manifestação técnica do Controle Interno.", sign: "manual" });
    expect(r.request.status).toBe("RETURNED");
    seedRequest({ id: "doc-1", sourceDomain: "processo_licitatorio", destinationDomain: "gestao_departamento", requestType: "DOCUMENT_REVIEW" });
    await as(OPERATOR).receiveRequest({ requestId: "doc-1" });
    await expect(as(OPERATOR).respond({ requestId: "doc-1", responseType: "revisao", responseStatus: "concluido" })).resolves.toMatchObject({ request: { status: "RETURNED" } });
    seedRequest({ id: "info-1", sourceDomain: "contratos", destinationDomain: "gestao_departamento", requestType: "INFORMATION_REQUEST" });
    await as(OPERATOR).receiveRequest({ requestId: "info-1" });
    await expect(as(OPERATOR).respond({ requestId: "info-1", responseType: "informacao", responseStatus: "informativo" })).resolves.toMatchObject({ request: { status: "RETURNED" } });
  });
  it("tenant alheio: solicitação de outra organização não é encontrada (NOT_FOUND, zero escrita)", async () => {
    seedRequest({ id: "foreign-1", sourceDomain: "contratos", destinationDomain: "controle_interno", requestType: "CONTROL_REVIEW", org: m.OTHER_ORG });
    await expect(as(OPERATOR).respond({ requestId: "foreign-1", responseType: "parecer", responseStatus: "favoravel", sign: "manual" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(m.writes).toBe(0);
  });
  it("usuário sem membership ⇒ FORBIDDEN", async () => {
    await expect(as(OUTSIDER).respond({ requestId: "x", responseType: "parecer", responseStatus: "favoravel" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("NEW-007 — consumidores (Contratos e Contratação Direta) só exibem parecer de origem governada", () => {
  const consumers = [
    ["Contratos", (id: string, org = m.ORG) => getContractLegalOpinion(id, org), "contratos"],
    ["Contratação Direta", (id: string, org = m.ORG) => getLegalOpinionResult(id, org), "contratacao_direta"],
  ] as const;

  it.each(consumers)("%s: registro legado incoerente (LEGAL_OPINION_INITIAL→controle_interno, signed:true) NÃO é parecer", async (_n, read, source) => {
    seedRequest({ id: "legacy-3", sourceDomain: source, destinationDomain: "controle_interno", requestType: "LEGAL_OPINION_INITIAL", status: "RETURNED" });
    seedResponse("legacy-3");
    const r = await read("legacy-3");
    expect(r.response).toBeNull();
    expect(r.legalOpinion).toMatchObject({ status: "NOT_GOVERNED", reason: "LEGAL_OPINION_ROUTING_INVALID" });
    // Histórico preservado e diferenciado (nunca apagado nem promovido).
    expect(r.institutionalResponse).toMatchObject({ id: "resp-legacy-3", governedLegalOpinion: false });
    expect(m.responses.get(`${m.ORG}:legacy-3`)).toMatchObject({ signed: true });
    expect(m.writes).toBe(0);
  });
  it.each(consumers)("%s: destino Parecer mas resposta SEM workspace governado (gravada pelo genérico antes do patch) NÃO é parecer", async (_n, read, source) => {
    seedRequest({ id: "pre-1", sourceDomain: source, destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_INITIAL", status: "RETURNED" });
    seedResponse("pre-1");
    const r = await read("pre-1");
    expect(r.response).toBeNull();
    expect(r.legalOpinion).toMatchObject({ status: "NOT_GOVERNED", reason: "NO_GOVERNED_WORKSPACE" });
  });
  it.each(consumers)("%s: workspace existe mas a resposta não é do procurador designado ⇒ NOT_GOVERNED", async (_n, read, source) => {
    seedRequest({ id: "mix-1", sourceDomain: source, destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_INITIAL", status: "RETURNED" });
    seedGovernedWorkspace("mix-1", "RETURNED");
    seedResponse("mix-1", { responder: OPERATOR });
    expect((await read("mix-1")).legalOpinion).toMatchObject({ status: "NOT_GOVERNED", reason: "RESPONDER_NOT_DESIGNATED_LAWYER" });
  });
  it.each(consumers)("%s: resposta técnica de outro domínio (CONTROL_REVIEW) lida como parecer ⇒ NOT_GOVERNED", async (_n, read, source) => {
    seedRequest({ id: "ci-2", sourceDomain: source, destinationDomain: "controle_interno", requestType: "CONTROL_REVIEW", status: "RETURNED" });
    seedResponse("ci-2");
    expect((await read("ci-2")).legalOpinion).toMatchObject({ status: "NOT_GOVERNED", reason: "NOT_LEGAL_OPINION_REQUEST" });
  });
  it.each(consumers)("%s: aguardando o procurador ⇒ PENDING (sem resposta)", async (_n, read, source) => {
    seedRequest({ id: "wait-1", sourceDomain: source, destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_INITIAL" });
    expect(await read("wait-1")).toMatchObject({ response: null, institutionalResponse: null, legalOpinion: { status: "PENDING" } });
  });
  it.each(consumers)("%s: outra organização ⇒ nada (response null)", async (_n, read, source) => {
    seedRequest({ id: "iso-1", sourceDomain: source, destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_INITIAL", status: "RETURNED" });
    seedGovernedWorkspace("iso-1", "RETURNED");
    seedResponse("iso-1", { responder: LAWYER, signed: false, signatureMethod: null });
    const r = await read("iso-1", m.OTHER_ORG);
    expect(r).toMatchObject({ response: null, institutionalResponse: null, legalOpinion: { status: "NOT_GOVERNED", reason: "REQUEST_NOT_FOUND" } });
  });

  it("positivo ponta a ponta: devolução pelo fluxo governado do procurador ⇒ GOVERNED_LEGAL_OPINION nos dois consumidores (idempotente)", async () => {
    for (const [, read, source] of consumers) {
      const id = `gov-${source}`;
      seedRequest({ id, sourceDomain: source, destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_INITIAL", status: "IN_PROGRESS" });
      seedGovernedWorkspace(id);
      const ret = await returnOpinion({ workspaceId: `ws-${id}`, organizationId: m.ORG, responder: LAWYER, correlationId: `c-${id}` });
      expect(ret.workspace.currentStage).toBe("RETURNED");
      expect(m.requests.get(`${m.ORG}:${id}`)!.status).toBe("RETURNED");
      for (let i = 0; i < 2; i++) {
        const r = await read(id);
        expect(r.legalOpinion).toMatchObject({ status: "GOVERNED_LEGAL_OPINION", reason: "GOVERNED", signedBy: LAWYER, signatureMethod: "manual" });
        expect(r.response).toMatchObject({ responseType: "parecer", responseStatus: "favoravel", responder: LAWYER, governedLegalOpinion: true });
        expect(r.institutionalResponse).toBeNull();
      }
    }
  });
  it("retomada: Engine já devolveu (RETURNED) mas o workspace ficou SIGNED ⇒ returnOpinion converge sem regravar a resposta", async () => {
    seedRequest({ id: "part-1", sourceDomain: "contratos", destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_INITIAL", status: "RETURNED" });
    seedGovernedWorkspace("part-1", "SIGNED");
    seedResponse("part-1", { responder: LAWYER, signed: false, signatureMethod: null });
    expect((await getContractLegalOpinion("part-1", m.ORG)).legalOpinion).toMatchObject({ reason: "WORKSPACE_NOT_RETURNED" });
    const ret = await returnOpinion({ workspaceId: "ws-part-1", organizationId: m.ORG, responder: LAWYER, correlationId: "c-retry" });
    expect(ret).toMatchObject({ responseId: "resp-part-1", workspace: { currentStage: "RETURNED" } });
    expect(m.responses.get(`${m.ORG}:part-1`)).toMatchObject({ id: "resp-part-1", responder: LAWYER });
    expect(m.timeline.filter((e) => e.requestId === "part-1")).toEqual([]); // nenhum evento duplicado no Engine
    expect((await getContractLegalOpinion("part-1", m.ORG)).legalOpinion).toMatchObject({ status: "GOVERNED_LEGAL_OPINION" });
  });
  it("respondRequest em estado incompatível (ARCHIVED) ⇒ falha ANTES de gravar a resposta", async () => {
    seedRequest({ id: "arch-1", sourceDomain: "contratos", destinationDomain: "controle_interno", requestType: "CONTROL_REVIEW", status: "ARCHIVED" });
    await expect(respondRequest({ id: "arch-1", organizationId: m.ORG, responder: OPERATOR, responseType: "revisao", responseStatus: "concluido", correlationId: "c" })).rejects.toThrow(/Transição/);
    expect(m.writes).toBe(0);
  });
  it("consumidor de Contratos não aceita parecer governado de OUTRA origem (Contratação Direta) como seu", async () => {
    seedRequest({ id: "gov-x", sourceDomain: "contratacao_direta", destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_INITIAL", status: "RETURNED" });
    seedGovernedWorkspace("gov-x", "RETURNED");
    seedResponse("gov-x", { responder: LAWYER, signed: false, signatureMethod: null });
    expect((await getContractLegalOpinion("gov-x", m.ORG)).legalOpinion).toMatchObject({ status: "NOT_GOVERNED", reason: "SOURCE_DOMAIN_MISMATCH" });
    expect((await getLegalOpinionResult("gov-x", m.ORG)).legalOpinion).toMatchObject({ status: "GOVERNED_LEGAL_OPINION" });
  });
  it("leitura genérica (getTimeline) diferencia resposta institucional de parecer governado", async () => {
    seedRequest({ id: "legacy-4", sourceDomain: "contratos", destinationDomain: "controle_interno", requestType: "LEGAL_OPINION_INITIAL", status: "RETURNED" });
    seedResponse("legacy-4");
    const t = await as(VIEWER).getTimeline({ requestId: "legacy-4" });
    expect(t.response).toMatchObject({ responseType: "parecer", signed: true });
    expect(t.legalOpinion).toMatchObject({ status: "NOT_GOVERNED" });
  });
});

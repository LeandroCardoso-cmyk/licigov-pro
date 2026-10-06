/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * F1 — `openWorkspaceFromRequest`: RETRY MUST CONVERGE.
 *
 * O recebimento é uma sequência de etapas (claim → Engine PENDING→RECEIVED→IN_PROGRESS → workspace INBOX→RECEIVED→
 * UNDER_ANALYSIS + histórico). Antes: se o claim já estava persistido e uma etapa posterior falhasse, o retry do MESMO
 * procurador achava `existing.assignedLawyer === lawyerId` e devolvia o workspace preso em INBOX. Agora: o retry INSPECIONA
 * a solicitação (Engine real) e o workspace e executa SOMENTE o que falta — sem retry cego, sem duplicar histórico, sem
 * tocar a atribuição; estado/ator incompatível ⇒ falha fechada com erro estável.
 *
 * O Engine (`institutionalRequestService`) é o REAL; só a persistência é um fake em memória com injeção de falhas.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Req = { id: string; organizationId: number; destinationDomain: string; sourceDomain: string; referenceProcessId: string; requestType: string; priority: string; status: string; assignedTo: number | null; correlationId: string; createdAt: string; updatedAt: string; title: string; description: string; referenceDocumentId: string; requestedBy: number };
type Hist = { id: string; order: number; eventType: string; actor: string; summary: string; refId: string; createdAt: string; uniqueKey?: string };

const store = vi.hoisted(() => ({
  req: null as any, timeline: [] as any[], ws: null as any, history: [] as any[], assignments: 0,
  counters: { reqStatusUpdates: 0, wsStageUpdates: 0, historyInserts: 0, timelineInserts: 0, claims: 0 },
  failOnce: new Set<string>(),
}));
const boom = (key: string) => { if (store.failOnce.delete(key)) throw new Error(`injected:${key}`); };

vi.mock("../../db/institutionalRequests", () => ({
  getRequest: vi.fn(async (id: string, org: number) => (store.req && store.req.id === id && store.req.organizationId === org ? { ...store.req } : null)),
  updateRequestStatus: vi.fn(async (_id: string, _org: number, status: string, assignedTo: number | null, updatedAt: string, expectedStatus?: string) => {
    boom(`req.status:${status}`);
    if (expectedStatus && store.req.status !== expectedStatus) return false; // CAS
    store.counters.reqStatusUpdates++; store.req = { ...store.req, status, assignedTo, updatedAt }; return true;
  }),
  insertRequestTimelineEntry: vi.fn(async (e: any) => {
    boom(`timeline:${e.eventType}`);
    store.counters.timelineInserts++; if (!store.timeline.some((x) => x.id === e.id)) store.timeline.push(e); return e;
  }),
  countTimeline: vi.fn(async () => store.timeline.length),
  listRequestTimeline: vi.fn(async (_id: string, org: number) => (store.req?.organizationId === org ? store.timeline.map((e) => ({ ...e })) : [])),
  listDocumentReferences: vi.fn(async () => []),
  insertRequest: vi.fn(), insertResponse: vi.fn(), insertAssignment: vi.fn(), insertNotification: vi.fn(), insertDocumentReference: vi.fn(),
}));

vi.mock("../../db/legalOpinionAssignment", () => ({
  getLawyerAssignmentForWorkspace: vi.fn(),
  claimLegalOpinionWorkspaceForLawyer: vi.fn(async (candidate: any, lawyerId: number) => {
    store.counters.claims++;
    if (!store.ws) { store.ws = { ...candidate }; store.assignments++; return { status: "claimed", created: true }; }
    if (store.ws.assignedLawyer === lawyerId) return { status: "already_assigned_to_actor" };
    return { status: "assigned_to_other" };
  }),
}));

vi.mock("../../db/legalOpinionWorkspace", async (orig) => {
  const actual = await orig<typeof import("../../db/legalOpinionWorkspace")>();
  return {
    ...actual,
    getLegalOpinionWorkspace: vi.fn(async (id: string, org: number) => (store.ws && store.ws.id === id && store.ws.organizationId === org ? { ...store.ws } : null)),
    getLegalOpinionWorkspaceByRequest: vi.fn(async (requestId: string, org: number) => (store.ws && store.ws.requestId === requestId && store.ws.organizationId === org ? { ...store.ws } : null)),
    updateLegalOpinionWorkspaceStage: vi.fn(async (_id: string, _org: number, stage: string, status: string, assignedLawyer: number | null, updatedAt: string, expectedStage?: string) => {
      boom(`ws.stage:${stage}`);
      if (expectedStage && store.ws.currentStage !== expectedStage) return false; // CAS
      store.counters.wsStageUpdates++; store.ws = { ...store.ws, currentStage: stage, status, assignedLawyer, updatedAt }; return true;
    }),
    countLegalOpinionHistory: vi.fn(async () => store.history.length),
    listLegalOpinionHistory: vi.fn(async (_ws: string, org: number) => (store.ws?.organizationId === org ? store.history.map((h) => ({ ...h })) : [])),
    insertLegalOpinionHistory: vi.fn(async (e: any) => {
      boom(`history:${e.eventType}`);
      store.counters.historyInserts++;
      const key = e.uniqueKey ?? `${e.order}:${e.eventType}`;
      if (store.history.some((h: Hist) => (h.uniqueKey ?? `${h.order}:${h.eventType}`) === key)) return; // PK idempotente
      store.history.push({ id: key, order: e.order, eventType: e.eventType, actor: e.actor, summary: e.summary, refId: e.refId ?? "", createdAt: "x", uniqueKey: e.uniqueKey });
    }),
  };
});

import { openWorkspaceFromRequest } from "../../services/legalOpinionWorkspaceService";
import { LEGAL_OPINION_ALREADY_ASSIGNED, LEGAL_OPINION_RECEIVE_RESUME_UNSAFE } from "../../services/legalOpinionAuthorityService";

const ORG = 81001;
const OTHER_ORG = 81002;
const baseReq = (over: Partial<Req> = {}): Req => ({
  id: "req-f1", organizationId: ORG, destinationDomain: "parecer_juridico", sourceDomain: "processo_licitatorio", referenceProcessId: "p1",
  requestType: "LEGAL_OPINION_INITIAL", priority: "media", status: "PENDING", assignedTo: null, correlationId: "c", createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z", title: "t", description: "d", referenceDocumentId: "", requestedBy: 1, ...over,
});
const open = (lawyerId: number, org = ORG) => openWorkspaceFromRequest({ requestId: "req-f1", organizationId: org, lawyerId, correlationId: "corr" });
const snapshot = () => JSON.stringify({ c: store.counters, req: store.req, ws: store.ws, h: store.history, t: store.timeline.length });
const histTypes = () => store.history.map((h: Hist) => h.eventType);
const tlTypes = () => store.timeline.map((e) => e.eventType);

beforeEach(() => {
  store.req = baseReq(); store.timeline = []; store.ws = null; store.history = []; store.assignments = 0; store.failOnce.clear();
  store.counters = { reqStatusUpdates: 0, wsStageUpdates: 0, historyInserts: 0, timelineInserts: 0, claims: 0 };
});

describe("F1 — recebimento do parecer: execução normal e replay", () => {
  it("F1-A — execução normal: unassigned → claim → Engine RECEIVED/IN_PROGRESS → workspace UNDER_ANALYSIS", async () => {
    const ws = await open(7);
    expect(ws).toMatchObject({ currentStage: "UNDER_ANALYSIS", assignedLawyer: 7 });
    expect(store.req).toMatchObject({ status: "IN_PROGRESS", assignedTo: 7 });
    expect(tlTypes()).toEqual(["received", "in_progress"]);
    expect(histTypes()).toEqual(["workspace_created", "received", "under_analysis"]);
    expect(store.assignments).toBe(1);
  });

  it("F1-B — retry após conclusão (mesmo ator): nenhuma escrita, sem duplicar transições/histórico, mesmo workspace", async () => {
    const first = await open(7);
    const before = snapshot();
    const again = await open(7);
    expect(again).toMatchObject({ id: first.id, currentStage: "UNDER_ANALYSIS", assignedLawyer: 7 });
    expect(snapshot()).toBe(before);
    expect(store.assignments).toBe(1);
  });
});

describe("F1 — retomada após falha parcial (o retry CONVERGE)", () => {
  it("F1-C — falha após o claim e ANTES do Engine ⇒ retry retoma e converge para UNDER_ANALYSIS", async () => {
    store.failOnce.add("req.status:RECEIVED");
    await expect(open(7)).rejects.toThrow(/injected:req\.status:RECEIVED/);
    expect(store.ws).toMatchObject({ currentStage: "INBOX", assignedLawyer: 7 }); // claim persistido, workspace preso
    expect(store.req.status).toBe("PENDING");

    const ws = await open(7);
    expect(ws).toMatchObject({ currentStage: "UNDER_ANALYSIS", assignedLawyer: 7 });
    expect(store.req).toMatchObject({ status: "IN_PROGRESS", assignedTo: 7 });
    expect(tlTypes()).toEqual(["received", "in_progress"]);
    expect(histTypes()).toEqual(["workspace_created", "received", "under_analysis"]);
    expect(store.assignments).toBe(1); // atribuição preservada, nunca recriada
  });

  it("F1-C' — Engine parou entre RECEIVED e IN_PROGRESS ⇒ retoma só o que falta", async () => {
    store.failOnce.add("req.status:IN_PROGRESS");
    await expect(open(7)).rejects.toThrow(/injected:req\.status:IN_PROGRESS/);
    expect(store.req.status).toBe("RECEIVED");
    const updatesBefore = store.counters.reqStatusUpdates;

    await open(7);
    expect(store.counters.reqStatusUpdates - updatesBefore).toBe(1); // só RECEIVED → IN_PROGRESS
    expect(store.req).toMatchObject({ status: "IN_PROGRESS", assignedTo: 7 });
    expect(tlTypes()).toEqual(["received", "in_progress"]); // sem 'received' duplicado
    expect(store.ws.currentStage).toBe("UNDER_ANALYSIS");
  });

  it("F1-D — falha APÓS o Engine e ANTES da transição do workspace ⇒ não reaplica a transição do Engine; retoma o workspace", async () => {
    store.failOnce.add("ws.stage:RECEIVED");
    await expect(open(7)).rejects.toThrow(/injected:ws\.stage:RECEIVED/);
    expect(store.req.status).toBe("IN_PROGRESS");
    expect(store.ws.currentStage).toBe("INBOX");
    const engine = { updates: store.counters.reqStatusUpdates, timeline: store.counters.timelineInserts };

    const ws = await open(7);
    expect(ws.currentStage).toBe("UNDER_ANALYSIS");
    expect(store.counters.reqStatusUpdates).toBe(engine.updates);   // Engine NÃO foi reaplicado
    expect(store.counters.timelineInserts).toBe(engine.timeline);   // nem a timeline
    expect(histTypes()).toEqual(["workspace_created", "received", "under_analysis"]);
  });

  it("F1-E — falha entre RECEIVED e UNDER_ANALYSIS ⇒ retoma SOMENTE a transição restante", async () => {
    store.failOnce.add("ws.stage:UNDER_ANALYSIS");
    await expect(open(7)).rejects.toThrow(/injected:ws\.stage:UNDER_ANALYSIS/);
    expect(store.ws.currentStage).toBe("RECEIVED");
    expect(histTypes()).toEqual(["workspace_created", "received"]);
    const stageUpdates = store.counters.wsStageUpdates;

    const ws = await open(7);
    expect(ws.currentStage).toBe("UNDER_ANALYSIS");
    expect(store.counters.wsStageUpdates - stageUpdates).toBe(1);   // só RECEIVED → UNDER_ANALYSIS
    expect(histTypes()).toEqual(["workspace_created", "received", "under_analysis"]); // sem duplicar
  });

  it("F1-E' — transição RECEIVED persistida mas histórico 'received' ausente ⇒ retry grava o histórico UMA vez", async () => {
    store.failOnce.add("history:received");
    await expect(open(7)).rejects.toThrow(/injected:history:received/);
    expect(store.ws.currentStage).toBe("RECEIVED");
    expect(histTypes()).toEqual(["workspace_created"]);

    await open(7);
    expect(store.ws.currentStage).toBe("UNDER_ANALYSIS");
    expect(histTypes()).toEqual(["workspace_created", "received", "under_analysis"]);
    await open(7); // e um terceiro retry não muda nada
    expect(histTypes()).toEqual(["workspace_created", "received", "under_analysis"]);
  });

  it("F1-E'' — claim persistido mas histórico 'workspace_created' ausente ⇒ retry o grava (histórico vazio)", async () => {
    store.failOnce.add("history:workspace_created");
    await expect(open(7)).rejects.toThrow(/injected:history:workspace_created/);
    expect(histTypes()).toEqual([]);
    await open(7);
    expect(histTypes()).toEqual(["workspace_created", "received", "under_analysis"]);
  });

  it("retries repetidos após a conclusão ⇒ replay sem escrita (não regride nem duplica histórico)", async () => {
    await open(7);
    // simula retomada concorrente que ficou com o workspace já adiante: o retry vê UNDER_ANALYSIS ⇒ replay sem escrita
    const before = snapshot();
    await open(7); await open(7);
    expect(snapshot()).toBe(before);
  });
});

describe("F1 — exclusividade, tenant e falha fechada", () => {
  it("F1-F — outro procurador ⇒ CONFLICT LEGAL_OPINION_ALREADY_ASSIGNED, mesmo com o recebimento parcial; nada é escrito", async () => {
    store.failOnce.add("req.status:RECEIVED");
    await expect(open(7)).rejects.toThrow(/injected/);
    const before = snapshot();
    await expect(open(8)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining(LEGAL_OPINION_ALREADY_ASSIGNED) });
    expect(snapshot()).toBe(before);
    expect(store.ws.assignedLawyer).toBe(7); // atribuição intacta
  });

  it("F1-G — cross-tenant ⇒ NOT_FOUND neutro (idêntico ao inexistente), sem enumeração e sem escrita", async () => {
    await open(7);
    const before = snapshot();
    const cross = await open(7, OTHER_ORG).catch((e) => e);
    store.req = null; // solicitação realmente inexistente
    const missing = await open(7).catch((e) => e);
    expect(cross).toMatchObject({ code: "NOT_FOUND", message: "Solicitação não encontrada." });
    expect(missing).toMatchObject({ code: "NOT_FOUND", message: cross.message });
    store.req = baseReq({ status: "IN_PROGRESS", assignedTo: 7 });
    expect(JSON.stringify({ c: store.counters, ws: store.ws, h: store.history })).toBe(JSON.stringify({ c: JSON.parse(before).c, ws: JSON.parse(before).ws, h: JSON.parse(before).h }));
  });

  it("estado do Engine incompatível com a retomada ⇒ FAIL CLOSED estável (LEGAL_OPINION_RECEIVE_RESUME_UNSAFE), sem escrita", async () => {
    store.failOnce.add("req.status:RECEIVED");
    await expect(open(7)).rejects.toThrow(/injected/);
    store.req = { ...store.req, status: "WAITING_INFORMATION" }; // solicitação seguiu por outro caminho
    const before = snapshot();
    await expect(open(7)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining(LEGAL_OPINION_RECEIVE_RESUME_UNSAFE) });
    expect(snapshot()).toBe(before);
    expect(store.ws.currentStage).toBe("INBOX"); // workspace e atribuição intocados
  });

  it("solicitação já atribuída (Engine) a OUTRO usuário ⇒ FAIL CLOSED, sem escrita", async () => {
    store.failOnce.add("ws.stage:RECEIVED");
    await expect(open(7)).rejects.toThrow(/injected/);
    store.req = { ...store.req, assignedTo: 99 };
    const before = snapshot();
    await expect(open(7)).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining(LEGAL_OPINION_RECEIVE_RESUME_UNSAFE) });
    expect(snapshot()).toBe(before);
  });

  it("decisão institucional/estado já persistido do Engine nunca é alterado pela retomada (IN_PROGRESS permanece, assignedTo preservado)", async () => {
    store.failOnce.add("ws.stage:RECEIVED");
    await expect(open(7)).rejects.toThrow(/injected/);
    const reqBefore = JSON.stringify(store.req);
    await open(7);
    expect(JSON.stringify(store.req)).toBe(reqBefore);
  });
});

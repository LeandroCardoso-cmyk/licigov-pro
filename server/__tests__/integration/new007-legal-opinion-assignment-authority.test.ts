/**
 * NEW-007 — Autoridade CONTEXTUAL do Parecer Jurídico (router canônico `legalOpinionWorkspace`) — MOCKADO.
 *
 * Antes: TODAS as mutações eram `tenantProcedure` — qualquer membro (inclusive viewer) recebia solicitações,
 * elaborava, editava, ASSINAVA, devolvia e arquivava pareceres de qualquer workspace do órgão.
 *
 * Contrato (regra aprovada pelo owner):
 *  - leituras tenant-scoped; toda mutação exige operator+ (viewer ⇒ FORBIDDEN antes de tocar em qualquer coisa);
 *  - ações próprias do procurador exigem ATRIBUIÇÃO válida (assigned_lawyer + lawyer_assignments + membership real);
 *  - owner/admin/manager e admin de plataforma NÃO têm autoridade jurídica sem atribuição;
 *  - receber exige membership REAL operator+ (a projeção owner sintética do admin de plataforma não basta);
 *  - recusas: FORBIDDEN com token estável, sem chamar o serviço (zero escrita/evento/IA), com log correlacionado.
 * O smoke MySQL (`new007-legal-opinion-assignment-rbac-mysql-smoke`) cobre o mesmo contrato ponta a ponta.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Role = "viewer" | "operator" | "manager" | "admin" | "owner";
const ORG = 70701;
const membershipOf = (userId: number, role: Role) => ({
  id: userId, organizationId: ORG, userId, role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date(),
});
// userId → papel REAL no órgão (ausente = sem membership real)
const ROLES = new Map<number, Role>();

vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async (userId: number) => {
    const role = ROLES.get(userId);
    return { organizationId: ORG, membership: role ? membershipOf(userId, role) : null };
  }),
  getMembership: vi.fn(async (userId: number) => {
    const role = ROLES.get(userId);
    return role ? membershipOf(userId, role) : null;
  }),
  NO_ORGANIZATION_MEMBERSHIP: "NO_ORGANIZATION_MEMBERSHIP",
}));
vi.mock("../../db", () => ({
  getOrganizationById: vi.fn(async (id: number) => (id === ORG ? { id: ORG } : null)),
  createAuditLog: vi.fn(async () => undefined),
}));
vi.mock("../../db/legalOpinionWorkspace", () => ({
  getLegalOpinionWorkspace: vi.fn(),
  listLegalOpinionWorkspaces: vi.fn(async () => []),
  listLawyerAssignments: vi.fn(async () => []),
}));
vi.mock("../../db/legalOpinionAssignment", () => ({
  getLawyerAssignmentForWorkspace: vi.fn(),
}));
vi.mock("../../db/institutionalRequests", () => ({ listPendingForDomain: vi.fn(async () => []) }));
vi.mock("../../services/legalOpinionWorkspaceService", () => ({
  openWorkspaceFromRequest: vi.fn(async () => ({ id: "ws-1", requestId: "req-1" })),
  loadWorkspaceContext: vi.fn(),
  loadWorkspaceReasoning: vi.fn(),
  createOpinionDraft: vi.fn(async () => ({ workspace: { id: "ws-1" }, draft: { id: "d-1" } })),
  updateOpinionDraft: vi.fn(async () => ({ id: "d-1" })),
  signOpinion: vi.fn(async () => ({ workspace: { id: "ws-1" }, draft: { id: "d-1", signed: true }, replayed: false })),
  returnOpinion: vi.fn(async () => ({ workspace: { id: "ws-1" }, responseId: "resp-1" })),
  archiveWorkspace: vi.fn(async () => ({ id: "ws-1" })),
}));

import { legalOpinionWorkspaceRouter } from "../../routers/legalOpinionWorkspaceRouter";
import * as wsDb from "../../db/legalOpinionWorkspace";
import * as asgDb from "../../db/legalOpinionAssignment";
import * as svc from "../../services/legalOpinionWorkspaceService";
import * as rootDb from "../../db";
import {
  LEGAL_OPINION_ASSIGNMENT_REQUIRED, LEGAL_OPINION_MEMBERSHIP_REQUIRED,
} from "../../services/legalOpinionAuthorityService";

const LAWYER = 11, OTHER_OPERATOR = 12, VIEWER = 13, MANAGER = 14, OWNER = 15, ORG_ADMIN = 16, PLATFORM_ADMIN = 99;

function caller(userId: number, platformRole: "user" | "admin" = "user") {
  return legalOpinionWorkspaceRouter.createCaller({
    user: { id: userId, role: platformRole, name: `u${userId}`, email: `u${userId}@t.local` },
    req: { headers: platformRole === "admin" ? { "x-organization-id": String(ORG) } : {}, ip: "127.0.0.1" },
    res: {},
    correlationId: `corr-new007-${userId}`,
  } as never);
}

const WS = {
  id: "ws-1", organizationId: ORG, requestId: "req-1", sourceDomain: "processo_licitatorio", referenceProcessId: "p1",
  requestType: "LEGAL_OPINION_INITIAL", currentStage: "UNDER_ANALYSIS", status: "em_analise", assignedLawyer: LAWYER,
  responsibleSector: "", priority: "media", correlationId: "c", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

const MUTATING_SERVICES = [
  svc.openWorkspaceFromRequest, svc.createOpinionDraft, svc.updateOpinionDraft, svc.signOpinion, svc.returnOpinion, svc.archiveWorkspace,
] as const;

const LAWYER_ACTIONS: Array<[string, (c: ReturnType<typeof caller>) => Promise<unknown>]> = [
  ["createDraft", c => c.createDraft({ workspaceId: "ws-1", opinionType: "LEGAL_OPINION_INITIAL", report: "r" })],
  ["updateOpinion", c => c.updateOpinion({ workspaceId: "ws-1", report: "r2" })],
  ["signOpinion", c => c.signOpinion({ workspaceId: "ws-1", method: "manual", idempotencyKey: "key-new007-0001" })],
  ["returnOpinion", c => c.returnOpinion({ workspaceId: "ws-1" })],
  ["archiveOpinion", c => c.archiveOpinion({ workspaceId: "ws-1" })],
];

beforeEach(() => {
  vi.clearAllMocks();
  ROLES.clear();
  ROLES.set(LAWYER, "operator").set(OTHER_OPERATOR, "operator").set(VIEWER, "viewer")
    .set(MANAGER, "manager").set(OWNER, "owner").set(ORG_ADMIN, "admin");
  vi.mocked(wsDb.getLegalOpinionWorkspace).mockImplementation(async (id: string, orgId: number) => (id === "ws-1" && orgId === ORG ? { ...WS } as never : null));
  vi.mocked(asgDb.getLawyerAssignmentForWorkspace).mockImplementation(async (wsId: string, orgId: number, lawyerId: number) =>
    (wsId === "ws-1" && orgId === ORG && lawyerId === LAWYER ? { id: "las-1", lawyerId, assignedAt: "2026-01-01 00:00:00.000" } : null));
});

function expectNoServiceCall() {
  for (const fn of MUTATING_SERVICES) expect(fn).not.toHaveBeenCalled();
}

describe("NEW-007 — piso de papel: viewer nunca muta", () => {
  it("viewer: receiveRequest ⇒ FORBIDDEN (papel mínimo operator), serviço não é chamado", async () => {
    await expect(caller(VIEWER).receiveRequest({ requestId: "req-1" })).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/operator/) });
    expectNoServiceCall();
  });

  it.each(LAWYER_ACTIONS)("viewer: %s ⇒ FORBIDDEN antes de qualquer leitura de workspace/serviço", async (_n, run) => {
    await expect(run(caller(VIEWER))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(wsDb.getLegalOpinionWorkspace).not.toHaveBeenCalled();
    expectNoServiceCall();
  });

  it("viewer continua LENDO (tenant-scoped): listInbox/listWorkspaces/lawyerDashboard", async () => {
    await expect(caller(VIEWER).listInbox({})).resolves.toMatchObject({ total: 0 });
    await expect(caller(VIEWER).listWorkspaces({})).resolves.toMatchObject({ total: 0 });
    await expect(caller(VIEWER).lawyerDashboard()).resolves.toMatchObject({ total: 0 });
  });
});

describe("NEW-007 — ações do procurador exigem ATRIBUIÇÃO (papel não substitui)", () => {
  for (const [who, userId] of [["operator não designado", OTHER_OPERATOR], ["manager não designado", MANAGER], ["owner não designado", OWNER], ["admin do órgão não designado", ORG_ADMIN]] as const) {
    it.each(LAWYER_ACTIONS)(`${who}: %s ⇒ FORBIDDEN ${LEGAL_OPINION_ASSIGNMENT_REQUIRED}`, async (_n, run) => {
      await expect(run(caller(userId))).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(LEGAL_OPINION_ASSIGNMENT_REQUIRED) });
      expectNoServiceCall();
    });
  }

  it.each(LAWYER_ACTIONS)("admin de PLATAFORMA (owner sintético, sem atribuição): %s ⇒ FORBIDDEN", async (_n, run) => {
    await expect(run(caller(PLATFORM_ADMIN, "admin"))).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(LEGAL_OPINION_ASSIGNMENT_REQUIRED) });
    expectNoServiceCall();
    expect(rootDb.createAuditLog).toHaveBeenCalledTimes(1); // só a auditoria PR-0 do acesso cross-tenant
  });

  it("admin de PLATAFORMA sem membership real não pode se autoatribuir (receiveRequest ⇒ FORBIDDEN)", async () => {
    await expect(caller(PLATFORM_ADMIN, "admin").receiveRequest({ requestId: "req-1" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(LEGAL_OPINION_MEMBERSHIP_REQUIRED) });
    expectNoServiceCall();
  });

  it.each(LAWYER_ACTIONS)("procurador designado (operator): %s ⇒ permitido, serviço chamado com o ator", async (name, run) => {
    await expect(run(caller(LAWYER))).resolves.toBeDefined();
    const called = MUTATING_SERVICES.filter(fn => vi.mocked(fn).mock.calls.length > 0);
    expect(called).toHaveLength(1);
    const args = vi.mocked(called[0]).mock.calls[0][0] as Record<string, unknown>;
    const actorField = { createDraft: "author", updateOpinion: "author", signOpinion: "signedBy", returnOpinion: "responder", archiveOpinion: "userId" }[name as "createDraft"];
    expect(args[actorField]).toBe(LAWYER);
    expect(args.organizationId).toBe(ORG);
  });

  it("designado sem registro em lawyer_assignments (linha legada/inconsistente) ⇒ FORBIDDEN (fail-closed)", async () => {
    vi.mocked(asgDb.getLawyerAssignmentForWorkspace).mockResolvedValue(null);
    await expect(caller(LAWYER).signOpinion({ workspaceId: "ws-1", idempotencyKey: "key-new007-0002" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(LEGAL_OPINION_ASSIGNMENT_REQUIRED) });
    expectNoServiceCall();
  });

  it("procurador designado REBAIXADO a viewer perde a autoridade (piso de papel)", async () => {
    ROLES.set(LAWYER, "viewer");
    await expect(caller(LAWYER).signOpinion({ workspaceId: "ws-1", idempotencyKey: "key-new007-0003" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expectNoServiceCall();
  });

  it("workspace sem procurador (assigned_lawyer NULL) ⇒ ninguém assina (nem owner)", async () => {
    vi.mocked(wsDb.getLegalOpinionWorkspace).mockResolvedValue({ ...WS, assignedLawyer: null } as never);
    for (const u of [LAWYER, OWNER]) {
      await expect(caller(u).signOpinion({ workspaceId: "ws-1", idempotencyKey: "key-new007-0004" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expectNoServiceCall();
  });

  it("workspace de OUTRO tenant/inexistente ⇒ NOT_FOUND idêntico (sem vazar existência), antes da autoridade", async () => {
    const errs = [];
    for (const id of ["ws-outro-tenant", "ws-inexistente"]) {
      errs.push(await caller(LAWYER).signOpinion({ workspaceId: id, idempotencyKey: "key-new007-0005" }).catch(e => e));
    }
    expect(errs.map(e => [e.code, e.message])).toEqual([
      ["NOT_FOUND", "Workspace de parecer não encontrado nesta organização."],
      ["NOT_FOUND", "Workspace de parecer não encontrado nesta organização."],
    ]);
    expect(asgDb.getLawyerAssignmentForWorkspace).not.toHaveBeenCalled();
    expectNoServiceCall();
  });

  it("operator com membership real recebe; o serviço recebe o PRÓPRIO ator como procurador", async () => {
    await caller(OTHER_OPERATOR).receiveRequest({ requestId: "req-1" });
    expect(svc.openWorkspaceFromRequest).toHaveBeenCalledWith(expect.objectContaining({ requestId: "req-1", organizationId: ORG, lawyerId: OTHER_OPERATOR, correlationId: `corr-new007-${OTHER_OPERATOR}` }));
  });
});

describe("NEW-007 — arquitetura do router", () => {
  it("toda mutação é operator+ (nenhuma mutação em tenantProcedure puro) e as ações do procurador passam por requireAssignedLawyer", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/routers/legalOpinionWorkspaceRouter.ts", "utf8");
    for (const m of ["receiveRequest", "createDraft", "updateOpinion", "signOpinion", "returnOpinion", "archiveOpinion"]) {
      expect(src).toMatch(new RegExp(`\\b${m}: legalMutationProcedure\\b`));
    }
    expect(src).toMatch(/const legalMutationProcedure = orgRoleProcedure\("operator"\)/);
    for (const a of ["create_draft", "update_opinion", "sign_opinion", "return_opinion", "archive_opinion"]) {
      expect(src).toContain(`"${a}");`);
    }
    const procs = legalOpinionWorkspaceRouter._def.procedures as Record<string, { _def: { type: string } }>;
    const mutations = Object.entries(procs).filter(([, p]) => p._def.type === "mutation").map(([k]) => k).sort();
    expect(mutations).toEqual(["archiveOpinion", "createDraft", "receiveRequest", "returnOpinion", "signOpinion", "updateOpinion"]);
  });
});

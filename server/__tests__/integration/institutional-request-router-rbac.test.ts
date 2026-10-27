/**
 * M8 pós-homologação — RBAC do `institutionalRequestRouter` (mockado, sem DB).
 *
 * Achado da auditoria: as mutações eram `tenantProcedure` puro — um VIEWER podia criar/designar/receber/"responder com assinatura"
 * (o contrato lê essa resposta como parecer), devolver ou arquivar solicitações, contornando a NEW-007. Agora: mutações exigem
 * operator+ (recusa FORBIDDEN ANTES de qualquer leitura/escrita), leituras continuam abertas ao tenant. Matriz congelada.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { makeContext } from "../helpers/fixtures";

const h = vi.hoisted(() => ({ ORG: 81001, roleByUser: new Map<number, string>() }));

vi.mock("../../services/tenantService", () => ({
  getMembership: vi.fn(async (userId: number, orgId: number) => (userId === 9 && orgId === 81001 ? { id: 9, organizationId: orgId, userId, role: "operator", ativo: true } : null)),
  resolveTenantForUser: vi.fn(async (userId: number) => {
    const role = h.roleByUser.get(userId);
    if (!role) throw new TRPCError({ code: "FORBIDDEN", message: "sem membership" });
    return { organizationId: h.ORG, membership: { id: userId, organizationId: h.ORG, userId, role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() } };
  }),
}));
const req = { id: "req-1", organizationId: 81001, destinationDomain: "controle_interno", status: "PENDING", assignedTo: null, updatedAt: "2026-10-27T00:00:00.000Z" };
const legalReq = { ...req, id: "req-lo", destinationDomain: "parecer_juridico" };
vi.mock("../../services/institutionalRequestService", () => ({
  requestInstitutionalReview: vi.fn(async () => ({ request: req })),
  receiveRequest: vi.fn(async () => req),
  respondRequest: vi.fn(async () => ({ response: { id: "resp-1" } })),
  archiveRequest: vi.fn(async () => req),
}));
vi.mock("../../db/institutionalRequests", () => ({
  getRequest: vi.fn(async (id: string) => (id === "req-lo" ? legalReq : req)),
  updateRequestStatus: vi.fn(async () => undefined),
  insertAssignment: vi.fn(async () => undefined),
  listPendingForDomain: vi.fn(async () => []),
  listCompletedForDomain: vi.fn(async () => []),
  listRequestTimeline: vi.fn(async () => []),
  listDocumentReferences: vi.fn(async () => []),
  getResponseForRequest: vi.fn(async () => null),
}));

import { institutionalRequestRouter } from "../../routers/institutionalRequestRouter";
import * as svc from "../../services/institutionalRequestService";
import * as reqDb from "../../db/institutionalRequests";

const user = (id: number) => ({ id, role: "user" as const, openId: `u${id}`, name: `U${id}`, email: `u${id}@x`, theme: "light" as const, loginMethod: "email", passwordHash: null, signaturePassword: null, tokenVersion: 0, createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() });
const as = (role: string) => { const id = { viewer: 1, operator: 2, manager: 3, admin: 4, owner: 5 }[role]!; h.roleByUser.set(id, role); return institutionalRequestRouter.createCaller(makeContext(user(id) as never) as never); };

const MUTATIONS: Record<string, (c: ReturnType<typeof as>) => Promise<unknown>> = {
  createRequest: (c) => c.createRequest({ sourceDomain: "contratos", destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_INITIAL", referenceProcessId: "ctw-1", title: "Parecer — Contrato X" }),
  assignRequest: (c) => c.assignRequest({ requestId: "req-1", userId: 9 }),
  receiveRequest: (c) => c.receiveRequest({ requestId: "req-1" }),
  respond: (c) => c.respond({ requestId: "req-1", responseType: "parecer", responseStatus: "favoravel", sign: "manual" }),
  returnRequest: (c) => c.returnRequest({ requestId: "req-1" }),
  archive: (c) => c.archive({ requestId: "req-1" }),
};

beforeEach(() => { vi.clearAllMocks(); h.roleByUser.clear(); });

describe("institutionalRequestRouter — mutações exigem operator+", () => {
  it.each(Object.keys(MUTATIONS))("viewer ⇒ FORBIDDEN em %s, sem tocar serviço nem banco", async (name) => {
    await expect(MUTATIONS[name](as("viewer"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    for (const fn of Object.values(svc)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    expect(reqDb.getRequest).not.toHaveBeenCalled();
    expect(reqDb.updateRequestStatus).not.toHaveBeenCalled();
    expect(reqDb.insertAssignment).not.toHaveBeenCalled();
  });
  it.each(Object.keys(MUTATIONS))("operator e manager passam pelo papel em %s", async (name) => {
    await expect(MUTATIONS[name](as("operator"))).resolves.toBeDefined();
    await expect(MUTATIONS[name](as("manager"))).resolves.toBeDefined();
  });
  it("leituras continuam disponíveis ao viewer do tenant", async () => {
    const c = as("viewer");
    await expect(c.listPending({ domain: "parecer_juridico" })).resolves.toMatchObject({ total: 0 });
    await expect(c.listCompleted({ domain: "parecer_juridico" })).resolves.toMatchObject({ total: 0 });
  });
  it("matriz congelada: nenhuma mutação volta a ser tenantProcedure puro", () => {
    const src = fs.readFileSync(path.join(__dirname, "../../routers/institutionalRequestRouter.ts"), "utf8");
    for (const name of Object.keys(MUTATIONS)) expect(src).toMatch(new RegExp(`\\n  ${name}: requestMutationProcedure\\n`));
    expect(src).toContain('const requestMutationProcedure = orgRoleProcedure("operator");');
  });
});

describe("institutionalRequestRouter — NEW-007: parecer só pelo fluxo governado", () => {
  const LO: Record<string, (c: ReturnType<typeof as>) => Promise<unknown>> = {
    assignRequest: (c) => c.assignRequest({ requestId: "req-lo", userId: 9 }),
    receiveRequest: (c) => c.receiveRequest({ requestId: "req-lo" }),
    respond: (c) => c.respond({ requestId: "req-lo", responseType: "parecer", responseStatus: "favoravel", sign: "manual" }),
    returnRequest: (c) => c.returnRequest({ requestId: "req-lo" }),
    archive: (c) => c.archive({ requestId: "req-lo" }),
  };
  it.each(Object.keys(LO))("solicitação destinada ao Parecer Jurídico ⇒ FORBIDDEN em %s (mesmo manager), sem escrita", async (name) => {
    await expect(LO[name](as("manager"))).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringMatching(/^LEGAL_OPINION_GOVERNED_FLOW:/) });
    for (const fn of Object.values(svc)) if (vi.isMockFunction(fn)) expect(fn).not.toHaveBeenCalled();
    expect(reqDb.updateRequestStatus).not.toHaveBeenCalled();
    expect(reqDb.insertAssignment).not.toHaveBeenCalled();
  });
  it("criar a solicitação ao Parecer continua permitido (operator) — quem trata é o fluxo do Parecer", async () => {
    await expect(MUTATIONS.createRequest(as("operator"))).resolves.toBeDefined();
  });
  it("designação só para membro ativo desta organização (usuário de fora ⇒ BAD_REQUEST, sem escrita)", async () => {
    await expect(as("manager").assignRequest({ requestId: "req-1", userId: 777 })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(reqDb.insertAssignment).not.toHaveBeenCalled();
  });
});

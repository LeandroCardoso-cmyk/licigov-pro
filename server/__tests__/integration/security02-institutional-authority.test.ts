/**
 * SECURITY-02 — separação entre ACESSO TÉCNICO da plataforma e AUTORIDADE INSTITUCIONAL do órgão.
 *
 * Contrato: o admin de plataforma (users.role='admin' + X-Organization-Id) recebe do `resolveTenant` uma projeção sintética
 * `owner` (id 0) — escopo técnico, nunca prova de vínculo. Atos institucionais (`institutionalProcedure` /
 * `requireInstitutionalAuthority`) exigem membership REAL, ativa, do mesmo órgão e com papel ≥ piso, relida da fonte
 * autoritativa a cada ato (fail-closed). O ledger eletrônico nunca rotula o acesso técnico como função do órgão.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAuthorityFixture } from "../helpers/institutionalAuthorityFixture";

const authority = createAuthorityFixture();
const tenant = vi.hoisted(() => ({ role: "manager" as string }));

vi.mock("../../services/tenantService", () => ({
  getMembership: (u: number, o: number) => authority.getMembership(u, o),
  resolveTenantForUser: vi.fn(async (userId: number) => ({
    organizationId: 2,
    membership: { id: 1, organizationId: 2, userId, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
vi.mock("../../db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db")>()),
  getOrganizationById: vi.fn(async (id: number) => ({ id, nome: "Órgão Sintético", slug: "homologacao-sintetica" })),
  createAuditLog: vi.fn(async () => undefined),
}));

import * as db from "../../db";
import { router, institutionalProcedure, orgRoleProcedure, hasOrgRoleAtLeast } from "../../_core/trpc";
import { requireInstitutionalAuthority } from "../../services/institutionalAuthorityService";
import {
  evaluateInstitutionalAuthority, roleRankAtLeast, INSTITUTIONAL_AUTHORITY_REQUIRED, type PersistedMembership,
} from "../../domain/institutionalAuthority";
import { electronicAuthority, PLATFORM_TECHNICAL_ROLE_LABEL } from "../../services/institutionalTemplates/electronicAuthority";
import type { OrgRole } from "../../../drizzle/schema";

const ROLES: OrgRole[] = ["viewer", "operator", "manager", "admin", "owner"];
const mem = (o: Partial<PersistedMembership> = {}): PersistedMembership => ({ id: 10, organizationId: 2, userId: 7, role: "manager", ativo: true, ...o });

beforeEach(() => {
  vi.clearAllMocks();
  authority.reset();
  tenant.role = "manager";
});

describe("domínio — evaluateInstitutionalAuthority (puro)", () => {
  const exp = { userId: 7, organizationId: 2, minRole: "manager" as OrgRole };
  it("recusa: ausente, sintética (id 0), outro usuário, outro órgão, inativa, papel desconhecido e papel insuficiente", () => {
    expect(evaluateInstitutionalAuthority(null, exp)).toBe("membership_required");
    expect(evaluateInstitutionalAuthority(mem({ id: 0, role: "owner" }), exp)).toBe("membership_invalid");
    expect(evaluateInstitutionalAuthority(mem({ userId: 8 }), exp)).toBe("membership_invalid");
    expect(evaluateInstitutionalAuthority(mem({ organizationId: 1 }), exp)).toBe("organization_mismatch");
    expect(evaluateInstitutionalAuthority(mem({ ativo: false }), exp)).toBe("membership_inactive");
    expect(evaluateInstitutionalAuthority(mem({ role: "superuser" as OrgRole }), exp)).toBe("membership_invalid");
    expect(evaluateInstitutionalAuthority(mem({ role: "operator" }), exp)).toBe("role_insufficient");
  });
  it("autoriza membership real, ativa, do órgão, com papel ≥ piso", () => {
    expect(evaluateInstitutionalAuthority(mem(), exp)).toBeNull();
    expect(evaluateInstitutionalAuthority(mem({ role: "owner" }), exp)).toBeNull();
  });
  it("ranking idêntico ao ORG_ROLE_RANK do _core (paridade)", () => {
    for (const a of ROLES) for (const b of ROLES) expect(roleRankAtLeast(a, b), `${a}≥${b}`).toBe(hasOrgRoleAtLeast(a, b));
  });
});

describe("serviço — requireInstitutionalAuthority (fonte autoritativa, fail-closed)", () => {
  it("sem membership ⇒ FORBIDDEN com código estável", async () => {
    authority.deny(7);
    await expect(requireInstitutionalAuthority({ userId: 7, organizationId: 2, minRole: "operator", operation: "t" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(INSTITUTIONAL_AUTHORITY_REQUIRED) });
  });
  it("falha de consulta ⇒ FORBIDDEN (nunca libera)", async () => {
    authority.state.failLookup = true;
    await expect(requireInstitutionalAuthority({ userId: 7, organizationId: 2, minRole: "viewer", operation: "t" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("ids inválidos (inclui o id sintético 0) ⇒ FORBIDDEN sem consultar", async () => {
    await expect(requireInstitutionalAuthority({ userId: 0, organizationId: 2, minRole: "viewer", operation: "t" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireInstitutionalAuthority({ userId: 7, organizationId: 0, minRole: "viewer", operation: "t" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(authority.state.lastLookup).toBeNull();
  });
  it("papel rebaixado ⇒ recusa; papel suficiente ⇒ devolve o papel PERSISTIDO", async () => {
    authority.setRole(7, "operator");
    await expect(requireInstitutionalAuthority({ userId: 7, organizationId: 2, minRole: "manager", operation: "t" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    authority.setRole(7, "admin");
    await expect(requireInstitutionalAuthority({ userId: 7, organizationId: 2, minRole: "manager", operation: "t" }))
      .resolves.toMatchObject({ userId: 7, organizationId: 2, role: "admin" });
  });
  it("com executor (transação) relê a membership com trava FOR SHARE, filtrando o órgão", async () => {
    const forSpy = vi.fn(async () => [mem({ userId: 7, organizationId: 2, role: "manager" })]);
    const tx = { select: () => ({ from: () => ({ where: () => ({ limit: () => ({ for: forSpy }) }) }) }) };
    await expect(requireInstitutionalAuthority({ userId: 7, organizationId: 2, minRole: "manager", operation: "t", executor: tx as never }))
      .resolves.toMatchObject({ role: "manager" });
    expect(forSpy).toHaveBeenCalledWith("share");
    const forInactive = vi.fn(async () => [mem({ ativo: false })]);
    const tx2 = { select: () => ({ from: () => ({ where: () => ({ limit: () => ({ for: forInactive }) }) }) }) };
    await expect(requireInstitutionalAuthority({ userId: 7, organizationId: 2, minRole: "manager", operation: "t", executor: tx2 as never })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("router — institutionalProcedure × admin de plataforma", () => {
  const act = vi.fn();
  const testRouter = router({
    officialAct: institutionalProcedure("manager").mutation(({ ctx }) => { act(); return { role: ctx.institutionalAuthority.role, platform: ctx.platformAdminAccess }; }),
    technical: orgRoleProcedure("manager").query(({ ctx }) => ({ role: ctx.orgMembership?.role, platform: ctx.platformAdminAccess })),
  });
  const caller = (platformAdmin: boolean, id = 7) => testRouter.createCaller({
    user: { id, role: platformAdmin ? "admin" : "user", name: "Ator", email: "ator@teste.local" },
    req: { headers: platformAdmin ? { "x-organization-id": "2" } : {}, ip: "127.0.0.1" }, res: {}, correlationId: "corr-s02",
  } as never);

  it("admin de plataforma SEM vínculo: ato institucional recusado; handler não executa; acesso auditado", async () => {
    authority.deny(7);
    await expect(caller(true).officialAct()).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(INSTITUTIONAL_AUTHORITY_REQUIRED) });
    expect(act).not.toHaveBeenCalled();
    const details = vi.mocked(db.createAuditLog).mock.calls.map((c) => JSON.parse(String((c[0] as { details: string }).details)));
    expect(details.some((d) => d.event === "platform_admin_tenant_access" && d.correlationId === "corr-s02")).toBe(true);
  });

  it("admin de plataforma mantém o acesso técnico (piso de papel do contexto) e é marcado como acesso de plataforma", async () => {
    authority.deny(7);
    await expect(caller(true).technical()).resolves.toEqual({ role: "owner", platform: true });
  });

  it("admin de plataforma COM vínculo real manager no órgão: autorizado com o papel PERSISTIDO (não o owner sintético)", async () => {
    authority.setRole(7, "manager");
    await expect(caller(true).officialAct()).resolves.toEqual({ role: "manager", platform: true });
  });

  it("membro real: manager passa; operator real é barrado pelo piso; membership rebaixada após a resolução do tenant é recusada", async () => {
    await expect(caller(false).officialAct()).resolves.toEqual({ role: "manager", platform: false });
    tenant.role = "operator";
    await expect(caller(false).officialAct()).rejects.toMatchObject({ code: "FORBIDDEN" });
    tenant.role = "manager";
    authority.setRole(7, "viewer"); // fonte autoritativa diverge do contexto ⇒ vale a fonte
    await expect(caller(false).officialAct()).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining(INSTITUTIONAL_AUTHORITY_REQUIRED) });
  });
});

describe("ledger eletrônico — nunca atribui função municipal ao acesso técnico", () => {
  it("acesso técnico de plataforma ⇒ rótulo explícito, sem 'Titular do órgão'", () => {
    const a = electronicAuthority({ userId: 7, userName: "Admin", userEmail: null, orgRole: null, platformTechnicalAccess: true, today: "2026-10-29", action: "Registro de modelo" });
    expect(a.decidedByRole).toBe(PLATFORM_TECHNICAL_ROLE_LABEL);
    expect(a.decidedByRole).not.toMatch(/Titular|do órgão \(/);
    expect(a.decidedByUserId).toBe(7);
  });
  it("membro real ⇒ papel persistido rotulado como função do órgão", () => {
    const a = electronicAuthority({ userId: 7, userName: "Gestora", userEmail: null, orgRole: "manager", today: "2026-10-29", action: "x" });
    expect(a.decidedByRole).toBe("Gestor do órgão (manager)");
  });
});

// ─── Rotas de autoridade: recusa ponta a ponta do admin de plataforma (appRouter real, sem banco) ──────────────
import { appRouter } from "../../routers";

describe("appRouter — admin de plataforma SEM vínculo é recusado em todo ato institucional (antes do handler)", () => {
  const platformCaller = () => appRouter.createCaller({
    user: { id: 7, role: "admin", name: "Admin Plataforma", email: "admin@plataforma.local" },
    req: { headers: { "x-organization-id": "2" }, ip: "127.0.0.1" }, res: {}, correlationId: "corr-s02-app",
  } as never);
  const WS = "ws-s02"; const K = "s02-key-0001";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const CASES: Array<[string, (c: any) => Promise<unknown>]> = [
    ["procurementProcess.issueProcess", (c) => c.procurementProcess.issueProcess({ processId: "P1" })],
    ["directProcurement.ratify", (c) => c.directProcurement.ratify({ workspaceId: WS, decision: "ratificado", decidedByName: "X", decidedByRole: "Y", decidedAt: "2026-10-29", basisReference: "Z", justification: "J", expectedRevision: 0, idempotencyKey: K })],
    ["directProcurement.publish", (c) => c.directProcurement.publish({ workspaceId: WS })],
    ["directProcurement.configureFlags", (c) => c.directProcurement.configureFlags({ workspaceId: WS, requiresLegalOpinion: false })],
    ["contractWorkspace.createAddendum", (c) => c.contractWorkspace.createAddendum({ contractId: "c1", addendumType: "prazo", justification: "j", idempotencyKey: K })],
    ["contractWorkspace.createApostille", (c) => c.contractWorkspace.createApostille({ contractId: "c1", kind: "reajuste", idempotencyKey: K })],
    ["contractWorkspace.registerInForceContract", (c) => c.contractWorkspace.registerInForceContract({ idempotencyKey: K, contractNumber: "1", contractor: "F", object: "O", term: "12 meses" })],
    ["ingestion.promoteSession", (c) => c.ingestion.promoteSession({ sessionId: 1, procurementProcessId: "P1", idempotencyKey: K })],
    ["workspace.approveDecision", (c) => c.workspace.approveDecision({ workspaceId: WS, decisionId: "d1" })],
    ["operationRecord.setPublication", (c) => c.operationRecord.setPublication({ referenceType: "processo", referenceId: "P1", channel: "pncp", status: "publicado" })],
    ["contracts.generation.generateRescission", (c) => c.contracts.generation.generateRescission({ contractId: 1, type: "unilateral", reason: "r", effectiveDate: new Date() })],
    ["contracts.amendments.create", (c) => c.contracts.amendments.create({ contractId: 1, type: "prazo", justification: "j" })],
    ["contracts.documents.create", (c) => c.contracts.documents.create({ contractId: 1, type: "minuta", content: "x", status: "final" })],
    ["directContracts.update", (c) => c.directContracts.update({ id: 1, data: { status: "approved" } })],
    ["directContracts.documents.create", (c) => c.directContracts.documents.create({ directContractId: 1, type: "termo_dispensa", content: "x", status: "final" })],
    ["organizations.updateMemberRole", (c) => c.organizations.updateMemberRole({ userId: 10, role: "manager" })],
    ["invitations.create", (c) => c.invitations.create({ email: "terceiro@x.com", role: "manager" })],
  ];

  for (const [name, call] of CASES) {
    it(`${name} ⇒ FORBIDDEN INSTITUTIONAL_AUTHORITY_REQUIRED`, async () => {
      authority.deny(7);
      const e = await call(platformCaller()).then(() => null, (x: unknown) => x as { code?: string; message?: string });
      expect(e?.code, name).toBe("FORBIDDEN");
      expect(e?.message, name).toMatch(/INSTITUTIONAL_AUTHORITY_REQUIRED/);
    });
  }

  it("processLifecycle.execute: CANCEL/ARCHIVE/CORRECT_NUMBER exigem vínculo real; descartar rascunho segue técnico (não é recusado pela autoridade)", async () => {
    authority.deny(7);
    const base = { processId: "P1", expectedRevision: 0, expectedEligibilityDigest: "a".repeat(64), idempotencyKey: K, reason: "motivo" };
    for (const action of ["CANCEL", "ARCHIVE", "CORRECT_NUMBER"] as const) {
      const e = await platformCaller().processLifecycle.execute({ ...base, action, newProcessNumber: "1/2026" }).then(() => null, (x: unknown) => x as { code?: string; message?: string });
      expect(e?.message, action).toMatch(/INSTITUTIONAL_AUTHORITY_REQUIRED/);
    }
    const e = await platformCaller().processLifecycle.execute({ ...base, action: "DISCARD_DRAFT" }).then(() => null, (x: unknown) => x as { code?: string; message?: string });
    expect(e?.message ?? "").not.toMatch(/INSTITUTIONAL_AUTHORITY_REQUIRED/);
  });
});

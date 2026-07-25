/**
 * PR A.1 — services/tenantOnboardingService.ts. `createInvitation` é mockado (já testado
 * isoladamente em invitation-service.test.ts) — foco na idempotência (mesma entrada retorna o
 * resumo existente; entrada diferente colidindo com o slug é conflito real) e na tradução de
 * ER_DUP_ENTRY.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Organization, InstitutionalInvitation } from "../../../drizzle/schema";

vi.mock("../../db/connection", () => ({ getDb: vi.fn() }));
vi.mock("../../db/organizations", () => ({ getOrganizationBySlug: vi.fn() }));
vi.mock("../../services/invitationService", () => ({ createInvitation: vi.fn() }));
vi.mock("../../services/activityLogService", () => ({ logActivity: vi.fn() }));

import { getDb } from "../../db/connection";
import { getOrganizationBySlug } from "../../db/organizations";
import { createInvitation } from "../../services/invitationService";
import { logActivity } from "../../services/activityLogService";
import { onboardTenant } from "../../services/tenantOnboardingService";

const getDbMock = vi.mocked(getDb);
const getOrganizationBySlugMock = vi.mocked(getOrganizationBySlug);
const createInvitationMock = vi.mocked(createInvitation);
const logActivityMock = vi.mocked(logActivity);

function makeOrg(overrides: Partial<Organization> = {}): Organization {
  return {
    id: 700099, nome: "Prefeitura de Moreira Sales", cnpj: null, slug: "moreira-sales",
    esfera: "municipal", uf: "PR", municipio: "Moreira Sales", ativo: true,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as Organization;
}

function makeInvitation(): InstitutionalInvitation {
  return { id: 55 } as InstitutionalInvitation;
}

const BASE_INPUT = {
  nome: "Prefeitura de Moreira Sales", slug: "moreira-sales", esfera: "municipal" as const,
  firstAdminName: "Ana Silva", firstAdminEmail: "ana@moreirasales.pr.gov.br", actorUserId: 1,
};

function makeFakeDb() {
  const insertValuesCalls: unknown[] = [];
  const insertAwaitable = Object.assign(Promise.resolve([{ insertId: 700099 }]));
  const db = {
    insert: vi.fn(() => ({ values: vi.fn((v: unknown) => { insertValuesCalls.push(v); return insertAwaitable; }) })),
  };
  return { db, insertValuesCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
  createInvitationMock.mockResolvedValue(makeInvitation());
});

describe("tenantOnboardingService · idempotência", () => {
  it("slug já existe com a MESMA entrada (nome+cnpj) → retorna o resumo existente, sem criar nada novo", async () => {
    getOrganizationBySlugMock.mockResolvedValue(makeOrg({ nome: BASE_INPUT.nome, cnpj: null }));
    const result = await onboardTenant(BASE_INPUT);
    expect(result.alreadyExisted).toBe(true);
    expect(result.organizationId).toBe(700099);
    expect(createInvitationMock).not.toHaveBeenCalled();
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("slug já existe com entrada DIFERENTE (nome não bate) → CONFLICT/TENANT_ALREADY_EXISTS", async () => {
    getOrganizationBySlugMock.mockResolvedValue(makeOrg({ nome: "Outro Nome" }));
    await expect(onboardTenant(BASE_INPUT)).rejects.toMatchObject({ message: "TENANT_ALREADY_EXISTS" });
    expect(createInvitationMock).not.toHaveBeenCalled();
  });
});

describe("tenantOnboardingService · caminho feliz", () => {
  it("cria a organização, convida o 1º admin como owner, audita tenant.onboarded", async () => {
    getOrganizationBySlugMock.mockResolvedValue(null);
    const { db, insertValuesCalls } = makeFakeDb();
    getDbMock.mockResolvedValue(db as never);

    const result = await onboardTenant(BASE_INPUT);

    expect(result.alreadyExisted).toBe(false);
    expect(result.organizationId).toBe(700099);
    expect(result.invitationId).toBe(55);

    const inserted = insertValuesCalls[0] as Record<string, unknown>;
    expect(inserted.nome).toBe(BASE_INPUT.nome);
    expect(inserted.slug).toBe(BASE_INPUT.slug);
    expect(inserted.ativo).toBe(true);

    expect(createInvitationMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 700099, email: BASE_INPUT.firstAdminEmail, role: "owner" })
    );
    expect(logActivityMock).toHaveBeenCalledWith(expect.objectContaining({ action: "tenant.onboarded", organizationId: 700099 }));
  });

  it("ER_DUP_ENTRY no insert (corrida rara) → CONFLICT/TENANT_ALREADY_EXISTS, não erro cru", async () => {
    getOrganizationBySlugMock.mockResolvedValue(null);
    const db = { insert: vi.fn(() => ({ values: vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" })) })) };
    getDbMock.mockResolvedValue(db as never);
    await expect(onboardTenant(BASE_INPUT)).rejects.toMatchObject({ message: "TENANT_ALREADY_EXISTS" });
    expect(createInvitationMock).not.toHaveBeenCalled();
  });
});

/**
 * PR A.1 — services/invitationService.ts.
 *
 * `db/users`, `db/organizations`, `email/*`, `activityLogService` são mockados — foco na
 * ORQUESTRAÇÃO: supersede atômico ao criar/reenviar, elegibilidade de aceite (domain já testado
 * em domain-invitations.test.ts), isolamento por organizationId, e o caminho "conta nova vs.
 * conta existente" do aceite.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { User, InstitutionalInvitation } from "../../../drizzle/schema";

vi.mock("../../db/connection", () => ({ getDb: vi.fn() }));
vi.mock("../../db/users", () => ({ getUserByEmail: vi.fn() }));
vi.mock("../../db/organizations", () => ({ getMembersOfOrg: vi.fn(), getOrganizationById: vi.fn(), getOrganizationBySlug: vi.fn() }));
vi.mock("../../services/email/emailOutboxService", () => ({ enqueueEmail: vi.fn() }));
vi.mock("../../services/email/emailDispatcher", () => ({ kick: vi.fn() }));
vi.mock("../../services/activityLogService", () => ({ logActivity: vi.fn() }));
vi.mock("../../services/passwordSecurity", () => ({ hashPassword: vi.fn().mockResolvedValue("$2b$12$fixed-hash") }));
vi.mock("../../config/email", () => ({
  EMAIL_CONFIG: { provider: "fake", enabled: true, brevoApiKey: "", senderEmail: "no-reply@x.com", senderName: "LiciGov Pro", appBaseUrl: "https://licigovpro.com.br", maxAttempts: 5, dispatchIntervalMs: 30000 },
}));

import { getDb } from "../../db/connection";
import { getUserByEmail } from "../../db/users";
import { getMembersOfOrg, getOrganizationById } from "../../db/organizations";
import { enqueueEmail } from "../../services/email/emailOutboxService";
import { kick } from "../../services/email/emailDispatcher";
import { logActivity } from "../../services/activityLogService";
import {
  createInvitation,
  resendInvitation,
  cancelInvitation,
  validateInvitationToken,
  acceptInvitation,
  acceptExistingInvitation,
} from "../../services/invitationService";

const getDbMock = vi.mocked(getDb);
const getUserByEmailMock = vi.mocked(getUserByEmail);
const getMembersOfOrgMock = vi.mocked(getMembersOfOrg);
const getOrganizationByIdMock = vi.mocked(getOrganizationById);
const enqueueEmailMock = vi.mocked(enqueueEmail);
const kickMock = vi.mocked(kick);
const logActivityMock = vi.mocked(logActivity);

function makeInvitation(overrides: Partial<InstitutionalInvitation> = {}): InstitutionalInvitation {
  return {
    id: 1, organizationId: 700001, emailNormalized: "convidado@x.com", role: "operator",
    status: "pending", tokenHash: "a".repeat(64), activeKey: "700001:convidado@x.com",
    invitedName: "Convidado", expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
    acceptedAt: null, cancelledAt: null, createdByUserId: 1, acceptedByUserId: null,
    resendCount: 0, lastSentAt: null, correlationId: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as InstitutionalInvitation;
}

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1, openId: "oid1", name: "Fulano", email: "fulano@x.com", loginMethod: "email",
    role: "user", theme: "light", passwordHash: "hash", signaturePassword: null, tokenVersion: 0,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    ...overrides,
  } as User;
}

function makeFakeDb(opts: { selectResult?: unknown[] } = {}) {
  const updateSetCalls: unknown[] = [];
  const insertValuesCalls: unknown[] = [];
  let selectResult = opts.selectResult ?? [];

  const selectChain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn(() => Promise.resolve(selectResult)) };
  const updateChain = { set: vi.fn((v: unknown) => { updateSetCalls.push(v); return updateChain; }), where: vi.fn(() => Promise.resolve([{ affectedRows: 1 }])) };
  const insertChain = { values: vi.fn((v: unknown) => { insertValuesCalls.push(v); return { onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) }; }) };
  // insert().values() sem onDuplicateKeyUpdate() é awaited direto (institutionalInvitations) — precisa também resolver como Promise com [{insertId}]
  const insertChainAwaitable = Object.assign(Promise.resolve([{ insertId: 999 }]), { onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined) });

  const db = {
    select: vi.fn(() => { selectChain.limit = vi.fn(() => Promise.resolve(selectResult)); return selectChain; }),
    update: vi.fn(() => updateChain),
    insert: vi.fn(() => ({
      values: vi.fn((v: unknown) => { insertValuesCalls.push(v); return insertChainAwaitable; }),
    })),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => cb(db)),
  };
  return { db, updateSetCalls, insertValuesCalls, setSelectResult: (rows: unknown[]) => { selectResult = rows; } };
}

beforeEach(() => {
  vi.clearAllMocks();
  getOrganizationByIdMock.mockResolvedValue({ id: 700001, nome: "Prefeitura de Moreira Sales" } as never);
  getMembersOfOrgMock.mockResolvedValue([]);
  getUserByEmailMock.mockResolvedValue(undefined);
});

describe("invitationService · createInvitation", () => {
  it("MEMBER_ALREADY_EXISTS quando o e-mail já é membro ativo da organização", async () => {
    getUserByEmailMock.mockResolvedValue(makeUser({ id: 5 }));
    getMembersOfOrgMock.mockResolvedValue([{ userId: 5, organizationId: 700001, role: "operator", ativo: true } as never]);
    await expect(
      createInvitation({ organizationId: 700001, email: "fulano@x.com", role: "operator", createdByUserId: 1 })
    ).rejects.toMatchObject({ message: "MEMBER_ALREADY_EXISTS" });
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("supersede o convite pending anterior (mesmo org+e-mail) e insere um novo, na mesma transação", async () => {
    const { db, updateSetCalls, insertValuesCalls } = makeFakeDb({ selectResult: [makeInvitation({ id: 999 })] });
    getDbMock.mockResolvedValue(db as never);

    await createInvitation({ organizationId: 700001, email: "  Convidado@X.com  ", role: "manager", invitedName: "Convidado", createdByUserId: 1, correlationId: "corr-1" });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(updateSetCalls[0]).toMatchObject({ status: "superseded", activeKey: null });
    expect(insertValuesCalls).toHaveLength(1);
    const inserted = insertValuesCalls[0] as Record<string, unknown>;
    expect(inserted.organizationId).toBe(700001);
    expect(inserted.emailNormalized).toBe("convidado@x.com"); // normalizado
    expect(inserted.role).toBe("manager");
    expect(inserted.status).toBe("pending");
    expect(inserted.activeKey).toBe("700001:convidado@x.com");

    expect(enqueueEmailMock).toHaveBeenCalledTimes(1);
    const enqueueArg = enqueueEmailMock.mock.calls[0][0];
    expect(enqueueArg.templateKey).toBe("invitation");
    expect((enqueueArg.payload as Record<string, unknown>).organizationName).toBe("Prefeitura de Moreira Sales");
    expect((enqueueArg.payload as Record<string, unknown>).acceptUrl).toMatch(/^https:\/\/licigovpro\.com\.br\/convite\?token=/);

    expect(kickMock).toHaveBeenCalledTimes(1);
    expect(logActivityMock).toHaveBeenCalledWith(expect.objectContaining({ action: "invitation.created", organizationId: 700001 }));
  });

  it("ER_DUP_ENTRY na transação é traduzido para CONFLICT (nunca vaza erro cru do MySQL)", async () => {
    const { db } = makeFakeDb();
    db.transaction = vi.fn().mockRejectedValue(Object.assign(new Error("Duplicate"), { code: "ER_DUP_ENTRY" }));
    getDbMock.mockResolvedValue(db as never);
    await expect(
      createInvitation({ organizationId: 700001, email: "x@y.com", role: "operator", createdByUserId: 1 })
    ).rejects.toMatchObject({ message: expect.stringContaining("Tente novamente") });
  });
});

describe("invitationService · resendInvitation", () => {
  it("convite não encontrado (id ou organizationId não batem — isolamento) → INVITATION_NOT_FOUND", async () => {
    const { db } = makeFakeDb({ selectResult: [] });
    getDbMock.mockResolvedValue(db as never);
    await expect(
      resendInvitation({ invitationId: 1, organizationId: 700001, actorUserId: 1 })
    ).rejects.toMatchObject({ message: "INVITATION_NOT_FOUND" });
  });

  it("convite expirado → INVITATION_EXPIRED, sem gerar novo token", async () => {
    const { db } = makeFakeDb({ selectResult: [makeInvitation({ expiresAt: new Date(Date.now() - 1000) })] });
    getDbMock.mockResolvedValue(db as never);
    await expect(
      resendInvitation({ invitationId: 1, organizationId: 700001, actorUserId: 1 })
    ).rejects.toMatchObject({ message: "INVITATION_EXPIRED" });
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });

  it("caminho feliz: gera um token NOVO (o antigo é superseded), incrementa resendCount, usa o template 'invitation_resent'", async () => {
    const { db, updateSetCalls, insertValuesCalls } = makeFakeDb({ selectResult: [makeInvitation({ id: 5, resendCount: 2 })] });
    getDbMock.mockResolvedValue(db as never);

    await resendInvitation({ invitationId: 5, organizationId: 700001, actorUserId: 9, correlationId: "corr-2" });

    expect(updateSetCalls[0]).toMatchObject({ status: "superseded", activeKey: null });
    const inserted = insertValuesCalls[0] as Record<string, unknown>;
    expect(inserted.resendCount).toBe(3);
    expect(inserted.tokenHash).not.toBe("a".repeat(64)); // token novo, hash diferente do original

    const enqueueArg = enqueueEmailMock.mock.calls[0][0];
    expect(enqueueArg.templateKey).toBe("invitation_resent");

    expect(logActivityMock).toHaveBeenCalledWith(expect.objectContaining({ action: "invitation.resent" }));
  });
});

describe("invitationService · cancelInvitation", () => {
  it("convite não pending → lança (não permite cancelar já aceito)", async () => {
    const { db } = makeFakeDb({ selectResult: [makeInvitation({ status: "accepted" })] });
    getDbMock.mockResolvedValue(db as never);
    await expect(cancelInvitation({ invitationId: 1, organizationId: 700001, actorUserId: 1 })).rejects.toThrow();
  });

  it("caminho feliz: status→cancelled, activeKey liberado, audita", async () => {
    const { db, updateSetCalls } = makeFakeDb({ selectResult: [makeInvitation({ id: 7 })] });
    getDbMock.mockResolvedValue(db as never);
    await cancelInvitation({ invitationId: 7, organizationId: 700001, actorUserId: 3 });
    expect(updateSetCalls[0]).toMatchObject({ status: "cancelled", activeKey: null });
    expect(logActivityMock).toHaveBeenCalledWith(expect.objectContaining({ action: "invitation.cancelled", entityId: 7 }));
  });
});

describe("invitationService · validateInvitationToken", () => {
  it("token implausível → invalid, sem tocar o banco", async () => {
    const r = await validateInvitationToken("curto");
    expect(r.valid).toBe(false);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("token válido → retorna organizationName/role/emailNormalized", async () => {
    const { db } = makeFakeDb({ selectResult: [makeInvitation()] });
    getDbMock.mockResolvedValue(db as never);
    const r = await validateInvitationToken("a".repeat(43));
    expect(r).toEqual({ valid: true, organizationName: "Prefeitura de Moreira Sales", role: "operator", emailNormalized: "convidado@x.com" });
  });
});

describe("invitationService · acceptInvitation (conta nova)", () => {
  it("já existe conta com este e-mail → CONFLICT/INVITATION_ALREADY_ACCEPTED (orienta login)", async () => {
    const { db } = makeFakeDb({ selectResult: [makeInvitation()] });
    getDbMock.mockResolvedValue(db as never);
    getUserByEmailMock.mockResolvedValue(makeUser());
    await expect(
      acceptInvitation({ token: "a".repeat(43), name: "Novo", password: "senhaForte123" })
    ).rejects.toMatchObject({ message: "INVITATION_ALREADY_ACCEPTED" });
  });

  it("senha viola a política → BAD_REQUEST, transação nunca inicia", async () => {
    const { db } = makeFakeDb({ selectResult: [makeInvitation()] });
    getDbMock.mockResolvedValue(db as never);
    await expect(
      acceptInvitation({ token: "a".repeat(43), name: "Novo", password: "convidado@x.com" })
    ).rejects.toThrow();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("caminho feliz: cria user+membership+marca aceito na mesma transação, audita, retorna dados p/ sessão", async () => {
    const { db } = makeFakeDb({ selectResult: [makeInvitation({ id: 3, organizationId: 700001, role: "manager" })] });
    getDbMock.mockResolvedValue(db as never);

    const result = await acceptInvitation({ token: "a".repeat(43), name: "Novo Usuário", password: "senhaMuitoForte123", correlationId: "corr-3" });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(result.organizationId).toBe(700001);
    expect(result.name).toBe("Novo Usuário");
    expect(logActivityMock).toHaveBeenCalledWith(expect.objectContaining({ action: "invitation.accepted", organizationId: 700001 }));
  });
});

describe("invitationService · acceptExistingInvitation", () => {
  it("e-mail da sessão diferente do convidado → EMAIL_MISMATCH (FORBIDDEN)", async () => {
    const { db } = makeFakeDb({ selectResult: [makeInvitation({ emailNormalized: "convidado@x.com" })] });
    getDbMock.mockResolvedValue(db as never);
    await expect(
      acceptExistingInvitation({ token: "a".repeat(43), userId: 10, userEmail: "outro@x.com" })
    ).rejects.toMatchObject({ message: "INVITATION_EMAIL_MISMATCH" });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("caminho feliz: reativa/insere membership com o papel do convite, marca aceito", async () => {
    const { db } = makeFakeDb({ selectResult: [makeInvitation({ id: 8, organizationId: 700001, role: "viewer", emailNormalized: "fulano@x.com" })] });
    getDbMock.mockResolvedValue(db as never);
    const result = await acceptExistingInvitation({ token: "a".repeat(43), userId: 42, userEmail: "Fulano@X.com" });
    expect(result).toEqual({ organizationId: 700001 });
    expect(logActivityMock).toHaveBeenCalledWith(expect.objectContaining({ action: "invitation.accepted", userId: 42 }));
  });
});

/**
 * PR A.1 — services/passwordResetService.ts.
 *
 * `db/users` (getUserByEmail/getUserById/updateUserPassword/bumpTokenVersion), `email/*`
 * (enqueueEmail/kick), `activityLogService` e `rateLimiter` são mockados — o foco aqui é a
 * ORQUESTRAÇÃO (anti-enumeração, revogação de tokens antigos, transição de estados do token,
 * transação de complete), não a mecânica de cada dependência (já testada nos respectivos
 * arquivos). `getDb()` é mockado com um fake mínimo o bastante para os 2 UPDATEs inline de
 * `request`/`complete` e para `select().from().where().limit()`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";
import type { User, PasswordResetToken } from "../../../drizzle/schema";

vi.mock("../../db/connection", () => ({ getDb: vi.fn() }));
vi.mock("../../db/users", () => ({
  getUserByEmail: vi.fn(),
  getUserById: vi.fn(),
  updateUserPassword: vi.fn(),
  bumpTokenVersion: vi.fn(),
}));
vi.mock("../../services/email/emailOutboxService", () => ({ enqueueEmail: vi.fn() }));
vi.mock("../../services/email/emailDispatcher", () => ({ kick: vi.fn() }));
vi.mock("../../services/activityLogService", () => ({ logActivity: vi.fn() }));
vi.mock("../../services/passwordSecurity", () => ({ hashPassword: vi.fn().mockResolvedValue("$2b$12$fixed-hash-for-tests") }));
vi.mock("../../config/email", () => ({
  EMAIL_CONFIG: { provider: "fake", enabled: true, brevoApiKey: "", senderEmail: "no-reply@x.com", senderName: "LiciGov Pro", appBaseUrl: "https://licigovpro.com.br", maxAttempts: 5, dispatchIntervalMs: 30000 },
}));

import { getDb } from "../../db/connection";
import { getUserByEmail, getUserById, updateUserPassword, bumpTokenVersion } from "../../db/users";
import { enqueueEmail } from "../../services/email/emailOutboxService";
import { kick } from "../../services/email/emailDispatcher";
import { logActivity } from "../../services/activityLogService";
import { checkRateLimit } from "../../services/rateLimiter";
import {
  requestPasswordReset,
  validatePasswordResetToken,
  completePasswordReset,
} from "../../services/passwordResetService";

const getDbMock = vi.mocked(getDb);
const getUserByEmailMock = vi.mocked(getUserByEmail);
const getUserByIdMock = vi.mocked(getUserById);
const updateUserPasswordMock = vi.mocked(updateUserPassword);
const bumpTokenVersionMock = vi.mocked(bumpTokenVersion);
const enqueueEmailMock = vi.mocked(enqueueEmail);
const kickMock = vi.mocked(kick);
const logActivityMock = vi.mocked(logActivity);

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1, openId: "oid1", name: "Fulano", email: "fulano@x.com", loginMethod: "email",
    role: "user", theme: "light", passwordHash: "old-hash", signaturePassword: null, tokenVersion: 0,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    ...overrides,
  } as User;
}

function makeTokenRow(overrides: Partial<PasswordResetToken> = {}): PasswordResetToken {
  return {
    id: 10, userId: 1, tokenHash: "a".repeat(64), expiresAt: new Date(Date.now() + 3_600_000),
    consumedAt: null, revokedAt: null, requestedAt: new Date(), ipAddress: null, correlationId: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  } as PasswordResetToken;
}

function makeFakeDb(opts: { selectResult?: unknown[] } = {}) {
  const updateSetCalls: unknown[] = [];
  const insertValuesCalls: unknown[] = [];
  const selectResult = opts.selectResult ?? [];

  const selectChain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn(() => Promise.resolve(selectResult)) };
  const updateChain = { set: vi.fn((v: unknown) => { updateSetCalls.push(v); return updateChain; }), where: vi.fn(() => Promise.resolve([{ affectedRows: 1 }])) };
  const insertChain = { values: vi.fn((v: unknown) => { insertValuesCalls.push(v); return Promise.resolve(undefined); }) };

  const db = {
    select: vi.fn(() => selectChain),
    update: vi.fn(() => updateChain),
    insert: vi.fn(() => insertChain),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<void>) => cb(db)), // tx = o próprio fake db
  };
  return { db, updateSetCalls, insertValuesCalls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("passwordResetService · requestPasswordReset — anti-enumeração", () => {
  it("e-mail inexistente: não lança, não consulta DB, não enfileira e-mail", async () => {
    getUserByEmailMock.mockResolvedValue(undefined);
    await expect(requestPasswordReset({ email: "inexistente@x.com" })).resolves.toBeUndefined();
    expect(getDbMock).not.toHaveBeenCalled();
    expect(enqueueEmailMock).not.toHaveBeenCalled();
    expect(logActivityMock).not.toHaveBeenCalled();
  });

  it("e-mail existente mas rate-limitado (checagem secundária por e-mail): não lança, não emite token", async () => {
    getUserByEmailMock.mockResolvedValue(makeUser());
    // Esgota o limite de 3/15min para a mesma chave de e-mail antes de chamar o serviço.
    const email = "fulano@x.com";
    const key = `email:${createHash("sha256").update(email).digest("hex")}`;
    checkRateLimit(key, "passwordReset");
    checkRateLimit(key, "passwordReset");
    checkRateLimit(key, "passwordReset"); // 3ª — ainda permitida (max:3)
    const fourth = checkRateLimit(key, "passwordReset");
    expect(fourth.allowed).toBe(false);

    const { db } = makeFakeDb();
    getDbMock.mockResolvedValue(db as never);
    await requestPasswordReset({ email });
    expect(enqueueEmailMock).not.toHaveBeenCalled();
  });
});

describe("passwordResetService · requestPasswordReset — caminho feliz", () => {
  it("revoga tokens ativos anteriores, cria um novo, enfileira o e-mail com o link certo, dá kick e audita", async () => {
    getUserByEmailMock.mockResolvedValue(makeUser({ id: 42, email: "novo-teste@x.com", name: "Novo Teste" }));
    const { db, insertValuesCalls } = makeFakeDb();
    getDbMock.mockResolvedValue(db as never);

    await requestPasswordReset({ email: "novo-teste@x.com", correlationId: "corr-1" });

    expect(db.update).toHaveBeenCalledTimes(1); // revogação dos tokens anteriores
    expect(insertValuesCalls).toHaveLength(1);
    const inserted = insertValuesCalls[0] as Record<string, unknown>;
    expect(inserted.userId).toBe(42);
    expect(typeof inserted.tokenHash).toBe("string");
    expect((inserted.tokenHash as string)).toHaveLength(64);
    expect(inserted.expiresAt).toBeInstanceOf(Date);

    expect(enqueueEmailMock).toHaveBeenCalledTimes(1);
    const enqueueArg = enqueueEmailMock.mock.calls[0][0];
    expect(enqueueArg.templateKey).toBe("password_reset");
    expect(enqueueArg.recipient).toBe("novo-teste@x.com");
    expect((enqueueArg.payload as Record<string, unknown>).resetUrl).toMatch(/^https:\/\/licigovpro\.com\.br\/redefinir-senha\?token=/);
    expect(enqueueArg.idempotencyKey).toContain("password_reset:");

    expect(kickMock).toHaveBeenCalledTimes(1);
    expect(logActivityMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, action: "password_reset.requested" }));
  });
});

describe("passwordResetService · validatePasswordResetToken", () => {
  it("token com formato implausível → invalid, sem consultar o banco", async () => {
    const r = await validatePasswordResetToken("curto");
    expect(r.valid).toBe(false);
    expect(getDbMock).not.toHaveBeenCalled();
  });

  it("token não encontrado → invalid", async () => {
    const { db } = makeFakeDb({ selectResult: [] });
    getDbMock.mockResolvedValue(db as never);
    const r = await validatePasswordResetToken("a".repeat(43));
    expect(r.valid).toBe(false);
  });

  it("token revogado → invalid", async () => {
    const { db } = makeFakeDb({ selectResult: [makeTokenRow({ revokedAt: new Date() })] });
    getDbMock.mockResolvedValue(db as never);
    const r = await validatePasswordResetToken("a".repeat(43));
    expect(r.valid).toBe(false);
  });

  it("token consumido → reason=PASSWORD_RESET_CONSUMED", async () => {
    const { db } = makeFakeDb({ selectResult: [makeTokenRow({ consumedAt: new Date() })] });
    getDbMock.mockResolvedValue(db as never);
    const r = await validatePasswordResetToken("a".repeat(43));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("PASSWORD_RESET_CONSUMED");
  });

  it("token expirado → reason=PASSWORD_RESET_EXPIRED", async () => {
    const { db } = makeFakeDb({ selectResult: [makeTokenRow({ expiresAt: new Date(Date.now() - 1000) })] });
    getDbMock.mockResolvedValue(db as never);
    const r = await validatePasswordResetToken("a".repeat(43));
    expect(r.valid).toBe(false);
    expect(r.reason).toBe("PASSWORD_RESET_EXPIRED");
  });

  it("token válido → {valid:true}", async () => {
    const { db } = makeFakeDb({ selectResult: [makeTokenRow()] });
    getDbMock.mockResolvedValue(db as never);
    const r = await validatePasswordResetToken("a".repeat(43));
    expect(r).toEqual({ valid: true });
  });
});

describe("passwordResetService · completePasswordReset", () => {
  const VALID_TOKEN = "b".repeat(43);
  const NEW_PASSWORD = "novaSenhaForte123";

  it("formato implausível → lança BAD_REQUEST/PASSWORD_RESET_INVALID", async () => {
    await expect(completePasswordReset({ token: "x", newPassword: NEW_PASSWORD })).rejects.toMatchObject({ message: "PASSWORD_RESET_INVALID" });
  });

  it("token não encontrado → PASSWORD_RESET_INVALID", async () => {
    const { db } = makeFakeDb({ selectResult: [] });
    getDbMock.mockResolvedValue(db as never);
    await expect(completePasswordReset({ token: VALID_TOKEN, newPassword: NEW_PASSWORD })).rejects.toMatchObject({ message: "PASSWORD_RESET_INVALID" });
  });

  it("token consumido → PASSWORD_RESET_CONSUMED", async () => {
    const { db } = makeFakeDb({ selectResult: [makeTokenRow({ consumedAt: new Date() })] });
    getDbMock.mockResolvedValue(db as never);
    await expect(completePasswordReset({ token: VALID_TOKEN, newPassword: NEW_PASSWORD })).rejects.toMatchObject({ message: "PASSWORD_RESET_CONSUMED" });
  });

  it("token expirado → PASSWORD_RESET_EXPIRED", async () => {
    const { db } = makeFakeDb({ selectResult: [makeTokenRow({ expiresAt: new Date(Date.now() - 1000) })] });
    getDbMock.mockResolvedValue(db as never);
    await expect(completePasswordReset({ token: VALID_TOKEN, newPassword: NEW_PASSWORD })).rejects.toMatchObject({ message: "PASSWORD_RESET_EXPIRED" });
  });

  it("usuário do token não existe mais → PASSWORD_RESET_INVALID", async () => {
    const { db } = makeFakeDb({ selectResult: [makeTokenRow()] });
    getDbMock.mockResolvedValue(db as never);
    getUserByIdMock.mockResolvedValue(undefined);
    await expect(completePasswordReset({ token: VALID_TOKEN, newPassword: NEW_PASSWORD })).rejects.toMatchObject({ message: "PASSWORD_RESET_INVALID" });
  });

  it("senha viola a política (igual ao e-mail) → BAD_REQUEST com a mensagem da política", async () => {
    const { db } = makeFakeDb({ selectResult: [makeTokenRow()] });
    getDbMock.mockResolvedValue(db as never);
    getUserByIdMock.mockResolvedValue(makeUser({ email: "fulano@x.com" }));
    await expect(completePasswordReset({ token: VALID_TOKEN, newPassword: "Fulano@X.com" })).rejects.toThrow(/e-mail/i);
    expect(updateUserPasswordMock).not.toHaveBeenCalled();
  });

  it("caminho feliz: atualiza senha+tokenVersion na transação, consome o token, enfileira 'senha alterada', dá kick e audita", async () => {
    const row = makeTokenRow({ id: 99, userId: 42 });
    const { db, updateSetCalls } = makeFakeDb({ selectResult: [row] });
    getDbMock.mockResolvedValue(db as never);
    getUserByIdMock.mockResolvedValue(makeUser({ id: 42, email: "fulano@x.com", name: "Fulano" }));

    await completePasswordReset({ token: VALID_TOKEN, newPassword: NEW_PASSWORD, correlationId: "corr-2" });

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(updateUserPasswordMock).toHaveBeenCalledWith(42, "$2b$12$fixed-hash-for-tests", db);
    expect(bumpTokenVersionMock).toHaveBeenCalledWith(42, db);

    // 2 updates inline dentro da transação: consumedAt do token + revogação de outros ativos.
    expect(updateSetCalls.some(c => (c as Record<string, unknown>).consumedAt instanceof Date)).toBe(true);
    expect(updateSetCalls.some(c => (c as Record<string, unknown>).revokedAt instanceof Date)).toBe(true);

    expect(enqueueEmailMock).toHaveBeenCalledTimes(1);
    const [enqueueArg, txArg] = enqueueEmailMock.mock.calls[0];
    expect(enqueueArg.templateKey).toBe("password_changed");
    expect(enqueueArg.recipient).toBe("fulano@x.com");
    expect(txArg).toBe(db); // enfileirado NA MESMA transação

    expect(kickMock).toHaveBeenCalledTimes(1);
    expect(logActivityMock).toHaveBeenCalledWith(expect.objectContaining({ userId: 42, action: "password_reset.completed" }));
  });
});

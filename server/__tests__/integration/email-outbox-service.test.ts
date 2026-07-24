/**
 * PR A.1 — services/email/emailOutboxService.ts.
 *
 * `getDb()` é mockado (mesmo padrão de sprint25-hardening.test.ts/organizations.test.ts) — sem
 * MySQL real aqui; o ciclo de vida completo contra banco real é o smoke de C11
 * (invitations-mysql-smoke.test.ts, describe.skipIf(!DB)). Este arquivo cobre:
 *   1. Degradação graciosa sem DB (nunca lança, retorna valores neutros).
 *   2. enqueueEmail: shape do insert + idempotência via onDuplicateKeyUpdate.
 *   3. claimPendingEmails: UPDATE condicional — só reivindica quando affectedRows===1
 *      (simula outra instância vencendo a corrida quando affectedRows===0).
 *   4. markEmailFailed: classificação retryable→retryable_failure+backoff vs.
 *      permanente→permanent_failure, usando maxAttempts DA PRÓPRIA LINHA.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../../db/connection";
import {
  enqueueEmail,
  claimPendingEmails,
  markEmailSent,
  markEmailFailed,
} from "../../services/email/emailOutboxService";

const getDbMock = vi.mocked(getDb);

beforeEach(() => {
  getDbMock.mockReset();
});

describe("emailOutboxService · degradação graciosa sem DB", () => {
  beforeEach(() => {
    getDbMock.mockResolvedValue(null);
  });

  it("enqueueEmail não lança quando getDb() é null", async () => {
    await expect(
      enqueueEmail({
        messageType: "invitation", recipient: "x@y.com", templateKey: "invitation",
        payload: {}, idempotencyKey: "k1",
      })
    ).resolves.toBeUndefined();
  });

  it("claimPendingEmails retorna [] quando getDb() é null", async () => {
    await expect(claimPendingEmails()).resolves.toEqual([]);
  });

  it("markEmailSent não lança quando getDb() é null", async () => {
    await expect(markEmailSent({ id: 1, attempts: 0 }, "fake", null)).resolves.toBeUndefined();
  });

  it("markEmailFailed retorna permanent:true (conservador) quando getDb() é null", async () => {
    const r = await markEmailFailed(
      { id: 1, attempts: 0, maxAttempts: 5 },
      { retryable: true, errorCode: "x", errorMessage: "x" }
    );
    expect(r.permanent).toBe(true);
    expect(r.nextAttemptAt).toBeNull();
  });
});

// ─── Fake DB para os testes de wiring/comportamento ────────────────────────────

function makeFakeDb(opts: { selectResult?: unknown[]; affectedRowsSequence?: number[] } = {}) {
  const affectedRowsQueue = [...(opts.affectedRowsSequence ?? [])];
  const selectResult = opts.selectResult ?? [];

  const setCalls: unknown[] = [];
  const valuesCalls: unknown[] = [];

  const selectChain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(selectResult),
  };
  const insertChain = {
    values: vi.fn((v: unknown) => { valuesCalls.push(v); return insertChain; }),
    onDuplicateKeyUpdate: vi.fn().mockResolvedValue(undefined),
  };
  const updateChain = {
    set: vi.fn((v: unknown) => { setCalls.push(v); return updateChain; }),
    where: vi.fn(() => Promise.resolve([{ affectedRows: affectedRowsQueue.length > 0 ? affectedRowsQueue.shift() : 1 }])),
  };

  return {
    db: {
      select: vi.fn(() => selectChain),
      insert: vi.fn(() => insertChain),
      update: vi.fn(() => updateChain),
    },
    setCalls,
    valuesCalls,
  };
}

describe("emailOutboxService · enqueueEmail", () => {
  it("insere com status pending, maxAttempts de EMAIL_CONFIG, e usa onDuplicateKeyUpdate (idempotente)", async () => {
    const { db, valuesCalls } = makeFakeDb();
    getDbMock.mockResolvedValue(db as never);

    await enqueueEmail({
      organizationId: 700001,
      messageType: "invitation",
      recipient: "fulano@x.com",
      templateKey: "invitation",
      payload: { organizationName: "X" },
      idempotencyKey: "invite:700001:fulano@x.com:1",
      correlationId: "corr-1",
    });

    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(valuesCalls).toHaveLength(1);
    const inserted = valuesCalls[0] as Record<string, unknown>;
    expect(inserted.status).toBe("pending");
    expect(inserted.recipient).toBe("fulano@x.com");
    expect(inserted.idempotencyKey).toBe("invite:700001:fulano@x.com:1");
    expect(typeof inserted.maxAttempts).toBe("number");
    expect(inserted.maxAttempts).toBeGreaterThan(0);
  });

  it("aceita txDb (transação) em vez de chamar getDb()", async () => {
    const { db } = makeFakeDb();
    await enqueueEmail(
      { messageType: "password_reset", recipient: "x@y.com", templateKey: "password_reset", payload: {}, idempotencyKey: "k2" },
      db
    );
    expect(getDbMock).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalledTimes(1);
  });
});

describe("emailOutboxService · claimPendingEmails", () => {
  it("linha cujo UPDATE afeta exatamente 1 é reivindicada; affectedRows=0 (outra instância venceu) é descartada", async () => {
    const rowA = { id: 1, status: "pending" };
    const rowB = { id: 2, status: "retryable_failure" };
    const { db } = makeFakeDb({ selectResult: [rowA, rowB], affectedRowsSequence: [1, 0] });
    getDbMock.mockResolvedValue(db as never);

    const claimed = await claimPendingEmails(10);
    expect(claimed).toHaveLength(1);
    expect(claimed[0].id).toBe(1);
    expect(claimed[0].status).toBe("processing"); // refletido localmente após o claim bem-sucedido
  });

  it("nenhum candidato → [] sem tentar UPDATE", async () => {
    const { db } = makeFakeDb({ selectResult: [] });
    getDbMock.mockResolvedValue(db as never);
    const claimed = await claimPendingEmails();
    expect(claimed).toEqual([]);
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("emailOutboxService · markEmailFailed (classificação retryable vs. permanente)", () => {
  it("erro retryable com tentativas restantes → retryable_failure, nextAttemptAt no futuro", async () => {
    const { db, setCalls } = makeFakeDb();
    getDbMock.mockResolvedValue(db as never);

    const r = await markEmailFailed(
      { id: 1, attempts: 0, maxAttempts: 5 },
      { retryable: true, errorCode: "brevo_http_500", errorMessage: "erro temporário" }
    );

    expect(r.permanent).toBe(false);
    expect(r.attempts).toBe(1);
    expect(r.nextAttemptAt).toBeInstanceOf(Date);
    expect(r.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    const set = setCalls[0] as Record<string, unknown>;
    expect(set.status).toBe("retryable_failure");
    expect(set.attempts).toBe(1);
  });

  it("erro retryable mas já na última tentativa (attempts+1 === maxAttempts) → permanent_failure", async () => {
    const { db, setCalls } = makeFakeDb();
    getDbMock.mockResolvedValue(db as never);

    const r = await markEmailFailed(
      { id: 1, attempts: 4, maxAttempts: 5 }, // esta seria a 5ª tentativa
      { retryable: true, errorCode: "brevo_timeout", errorMessage: "timeout" }
    );

    expect(r.permanent).toBe(true);
    expect(r.attempts).toBe(5);
    expect(r.nextAttemptAt).toBeNull();
    const set = setCalls[0] as Record<string, unknown>;
    expect(set.status).toBe("permanent_failure");
  });

  it("erro NÃO retryable (ex.: 400 do Brevo) → permanent_failure mesmo na 1ª tentativa", async () => {
    const { db, setCalls } = makeFakeDb();
    getDbMock.mockResolvedValue(db as never);

    const r = await markEmailFailed(
      { id: 1, attempts: 0, maxAttempts: 5 },
      { retryable: false, errorCode: "brevo_invalid_parameter", errorMessage: "endereço inválido" }
    );

    expect(r.permanent).toBe(true);
    expect(r.attempts).toBe(1);
    const set = setCalls[0] as Record<string, unknown>;
    expect(set.status).toBe("permanent_failure");
  });

  it("mensagem de erro é truncada em 500 caracteres antes de persistir", async () => {
    const { db, setCalls } = makeFakeDb();
    getDbMock.mockResolvedValue(db as never);

    await markEmailFailed(
      { id: 1, attempts: 0, maxAttempts: 5 },
      { retryable: true, errorCode: "x", errorMessage: "a".repeat(1000) }
    );

    const set = setCalls[0] as Record<string, unknown>;
    expect((set.lastErrorMessage as string).length).toBe(500);
  });
});

describe("emailOutboxService · markEmailSent", () => {
  it("marca status sent, grava provider/providerMessageId, incrementa attempts e limpa o último erro", async () => {
    const { db, setCalls } = makeFakeDb();
    getDbMock.mockResolvedValue(db as never);

    await markEmailSent({ id: 1, attempts: 1 }, "brevo", "<msg-id@brevo>");

    const set = setCalls[0] as Record<string, unknown>;
    expect(set.status).toBe("sent");
    expect(set.provider).toBe("brevo");
    expect(set.providerMessageId).toBe("<msg-id@brevo>");
    expect(set.attempts).toBe(2);
    expect(set.lastErrorCode).toBeNull();
  });
});

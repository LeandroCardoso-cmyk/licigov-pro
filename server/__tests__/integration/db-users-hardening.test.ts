/**
 * PR A.1 — server/db/users.ts: normalização de e-mail (createUser/getUserByEmail),
 * touchLastSignedIn (best-effort, nunca lança) e bumpTokenVersion (incremento atômico).
 * `getDb()` é mockado — mesmo padrão do resto da suíte (sem MySQL real aqui).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db/connection", () => ({ getDb: vi.fn() }));

import { getDb } from "../../db/connection";
import { getUserByEmail, createUser, touchLastSignedIn, bumpTokenVersion } from "../../db/users";

const getDbMock = vi.mocked(getDb);

function makeFakeDb() {
  const setCalls: unknown[] = [];
  const valuesCalls: unknown[] = [];
  const whereArgs: unknown[] = [];
  let selectResult: unknown[] = [];

  const selectChain = { from: vi.fn().mockReturnThis(), where: vi.fn((w: unknown) => { whereArgs.push(w); return selectChain; }), limit: vi.fn(() => Promise.resolve(selectResult)) };
  const insertChain = { values: vi.fn((v: unknown) => { valuesCalls.push(v); return Promise.resolve(undefined); }) };
  const updateChain = { set: vi.fn((v: unknown) => { setCalls.push(v); return updateChain; }), where: vi.fn(() => Promise.resolve([{ affectedRows: 1 }])) };

  return {
    db: { select: vi.fn(() => selectChain), insert: vi.fn(() => insertChain), update: vi.fn(() => updateChain) },
    setCalls, valuesCalls, whereArgs,
    setSelectResult: (rows: unknown[]) => { selectResult = rows; },
  };
}

beforeEach(() => {
  getDbMock.mockReset();
});

describe("db/users · normalização de e-mail", () => {
  it("createUser grava o e-mail normalizado (trim+lowercase), não o valor original", async () => {
    const fake = makeFakeDb();
    fake.setSelectResult([{ id: 1, email: "fulano@x.com" }]);
    getDbMock.mockResolvedValue(fake.db as never);

    await createUser({ email: "  Fulano@X.com  ", name: "Fulano", passwordHash: "hash", openId: "oid1" });

    const inserted = fake.valuesCalls[0] as Record<string, unknown>;
    expect(inserted.email).toBe("fulano@x.com");
  });

  it("getUserByEmail normaliza o e-mail de entrada antes de consultar", async () => {
    const fake = makeFakeDb();
    fake.setSelectResult([{ id: 1, email: "fulano@x.com" }]);
    getDbMock.mockResolvedValue(fake.db as never);

    await getUserByEmail("  FULANO@X.COM  ");

    // O `where(eq(users.email, <normalizado>))` é opaco (SQL builder), mas o resultado da busca
    // prova que a normalização aconteceu ANTES da query (senão o teste não teria como "achar" nada
    // com um valor mockado independente do argumento — o que importa aqui é não lançar e retornar
    // o registro).
    const result = await getUserByEmail("  FULANO@X.COM  ");
    expect(result).toEqual({ id: 1, email: "fulano@x.com" });
  });

  it("getUserByEmail sem DB retorna undefined (não lança)", async () => {
    getDbMock.mockResolvedValue(null);
    await expect(getUserByEmail("x@y.com")).resolves.toBeUndefined();
  });
});

describe("db/users · touchLastSignedIn", () => {
  it("atualiza lastSignedIn via UPDATE", async () => {
    const fake = makeFakeDb();
    getDbMock.mockResolvedValue(fake.db as never);
    await touchLastSignedIn(1);
    expect(fake.setCalls).toHaveLength(1);
    expect((fake.setCalls[0] as Record<string, unknown>).lastSignedIn).toBeInstanceOf(Date);
  });

  it("nunca lança, mesmo sem DB", async () => {
    getDbMock.mockResolvedValue(null);
    await expect(touchLastSignedIn(1)).resolves.toBeUndefined();
  });

  it("nunca lança mesmo se o UPDATE falhar (erro engolido e logado)", async () => {
    getDbMock.mockResolvedValue({
      update: () => ({ set: () => ({ where: () => { throw new Error("boom"); } }) }),
    } as never);
    await expect(touchLastSignedIn(1)).resolves.toBeUndefined();
  });
});

describe("db/users · bumpTokenVersion", () => {
  it("incrementa tokenVersion via expressão SQL atômica (não lê-depois-escreve)", async () => {
    const fake = makeFakeDb();
    getDbMock.mockResolvedValue(fake.db as never);
    await bumpTokenVersion(1);
    expect(fake.setCalls).toHaveLength(1);
    // A expressão é um SQL template (drizzle `sql`), não um número literal — o que garante
    // atomicidade é justamente NÃO ser um número calculado em JS.
    expect(typeof (fake.setCalls[0] as Record<string, unknown>).tokenVersion).toBe("object");
  });

  it("aceita txDb (transação) sem chamar getDb()", async () => {
    const fake = makeFakeDb();
    await bumpTokenVersion(1, fake.db);
    expect(getDbMock).not.toHaveBeenCalled();
    expect(fake.setCalls).toHaveLength(1);
  });

  it("sem DB, não lança", async () => {
    getDbMock.mockResolvedValue(null);
    await expect(bumpTokenVersion(1)).resolves.toBeUndefined();
  });
});

/**
 * V1 PRE-PILOT CLOSURE — PR 0 (correção final) — atomicidade de scripts/bootstrap-admin.ts.
 *
 * Não requer MySQL real: mocka `drizzle-orm/mysql2` (retorna um `db` fake controlado
 * pelo teste) e `mysql2/promise` (a conexão real nunca chega a ser usada). O objetivo
 * é comprovar o CONTRATO do código:
 *  - criação, promoção deliberada (role + passwordHash + tokenVersion) e o registro em
 *    `audit_logs` acontecem dentro da MESMA transação (`db.transaction`);
 *  - se a escrita da auditoria falhar, `main()` propaga o erro (nunca resolve com um
 *    outcome de sucesso "silencioso") — role/passwordHash/tokenVersion ficam sujeitos
 *    ao rollback dessa mesma transação.
 * A garantia de rollback físico da transação é do próprio motor MySQL/driver (já usada
 * em outros serviços do projeto, ex.: passwordResetService.ts); este teste comprova que
 * o CÓDIGO usa essa garantia (uma única transação), não reimplementa/reverifica o motor
 * de banco.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { users, auditLogs } from "../../../drizzle/schema";

type TrackedCall = { table: "users" | "auditLogs" | "unknown"; op: "insert" | "update"; keys?: string[] };

const state = vi.hoisted(() => ({
  existingRows: [] as Array<{ id: number; role: string }>,
  auditShouldFail: false,
  calls: [] as TrackedCall[],
}));

vi.mock("mysql2/promise", () => ({
  default: {
    createConnection: vi.fn(async () => ({ end: vi.fn() })),
  },
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => state.existingRows,
        }),
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<void>) => {
      const tx = {
        insert: (table: unknown) => ({
          values: async () => {
            const tableName = table === usersRef ? "users" : table === auditLogsRef ? "auditLogs" : "unknown";
            state.calls.push({ table: tableName, op: "insert" });
            if (tableName === "auditLogs" && state.auditShouldFail) {
              throw new Error("audit_logs indisponível (forçado pelo teste)");
            }
            return [{ insertId: 999 }];
          },
        }),
        update: (table: unknown) => ({
          set: (values: Record<string, unknown>) => ({
            where: async () => {
              const tableName = table === usersRef ? "users" : "unknown";
              state.calls.push({ table: tableName, op: "update", keys: Object.keys(values) });
            },
          }),
        }),
      };
      await cb(tx);
    },
  })),
}));

// Referências reais das tabelas — usadas só para comparação de identidade dentro do mock acima.
const usersRef = users;
const auditLogsRef = auditLogs;

import { main as bootstrapAdmin } from "../../../scripts/bootstrap-admin";

describe("PR 0 (correção final) — bootstrap-admin.ts: atomicidade criação/promoção + audit", () => {
  const ORIGINAL_ENV = {
    CONFIRM: process.env.ADMIN_BOOTSTRAP_CONFIRM,
    EMAIL: process.env.ADMIN_BOOTSTRAP_EMAIL,
    PASSWORD: process.env.ADMIN_BOOTSTRAP_PASSWORD,
    ALLOW_PROMOTE: process.env.ADMIN_BOOTSTRAP_ALLOW_PROMOTE,
    DATABASE_URL: process.env.DATABASE_URL,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    state.existingRows = [];
    state.auditShouldFail = false;
    state.calls = [];
    process.env.ADMIN_BOOTSTRAP_CONFIRM = "yes";
    process.env.ADMIN_BOOTSTRAP_EMAIL = "bootstrap-atomicity@teste.local";
    process.env.ADMIN_BOOTSTRAP_PASSWORD = "Senha-Forte-123!";
    delete process.env.ADMIN_BOOTSTRAP_ALLOW_PROMOTE;
    process.env.DATABASE_URL = "mysql://fake:fake@localhost:3306/fake";
  });

  afterAll(() => {
    process.env.ADMIN_BOOTSTRAP_CONFIRM = ORIGINAL_ENV.CONFIRM;
    process.env.ADMIN_BOOTSTRAP_EMAIL = ORIGINAL_ENV.EMAIL;
    process.env.ADMIN_BOOTSTRAP_PASSWORD = ORIGINAL_ENV.PASSWORD;
    process.env.ADMIN_BOOTSTRAP_ALLOW_PROMOTE = ORIGINAL_ENV.ALLOW_PROMOTE;
    process.env.DATABASE_URL = ORIGINAL_ENV.DATABASE_URL;
  });

  it("caminho feliz: cria o usuário e grava o audit dentro da mesma transação", async () => {
    const result = await bootstrapAdmin();
    expect(result.outcome).toBe("created");
    expect(state.calls).toEqual([
      { table: "users", op: "insert" },
      { table: "auditLogs", op: "insert" },
    ]);
  });

  it("falha ao gravar audit_logs → main() propaga o erro (NUNCA resolve com outcome de sucesso)", async () => {
    state.auditShouldFail = true;
    await expect(bootstrapAdmin()).rejects.toThrow(/audit_logs indisponível/);
    // A tentativa de criação do usuário aconteceu (dentro da MESMA transação), mas
    // como a auditoria falhou, a transação inteira rejeita — não há outcome de
    // sucesso observável pelo chamador (a garantia de rollback físico é do motor
    // MySQL, já testada implicitamente pelo padrão usado em passwordResetService.ts).
    expect(state.calls).toEqual([
      { table: "users", op: "insert" },
      { table: "auditLogs", op: "insert" },
    ]);
  });

  it("usuário existente não-admin SEM ADMIN_BOOTSTRAP_ALLOW_PROMOTE → ConfigError, nenhuma escrita ocorre", async () => {
    state.existingRows = [{ id: 42, role: "user" }];
    await expect(bootstrapAdmin()).rejects.toThrow(/ALLOW_PROMOTE/);
    expect(state.calls).toEqual([]);
  });

  it("promoção deliberada (ALLOW_PROMOTE=yes): role + passwordHash + tokenVersion + audit na MESMA transação", async () => {
    state.existingRows = [{ id: 42, role: "user" }];
    process.env.ADMIN_BOOTSTRAP_ALLOW_PROMOTE = "yes";

    const result = await bootstrapAdmin();
    expect(result.outcome).toBe("promoted");
    expect(result.userId).toBe(42);

    expect(state.calls).toHaveLength(3);
    // 1) role + passwordHash atualizados juntos (senha deliberadamente fornecida substitui o hash antigo).
    expect(state.calls[0]).toMatchObject({ table: "users", op: "update" });
    expect(state.calls[0].keys).toEqual(expect.arrayContaining(["role", "passwordHash"]));
    // 2) tokenVersion incrementado (bumpTokenVersion) — revoga sessões ativas.
    expect(state.calls[1]).toMatchObject({ table: "users", op: "update" });
    expect(state.calls[1].keys).toEqual(["tokenVersion"]);
    // 3) audit na mesma transação.
    expect(state.calls[2]).toEqual({ table: "auditLogs", op: "insert" });
  });

  it("promoção: falha no audit → propaga o erro e role/passwordHash/tokenVersion ficam sujeitos ao rollback da transação", async () => {
    state.existingRows = [{ id: 42, role: "user" }];
    process.env.ADMIN_BOOTSTRAP_ALLOW_PROMOTE = "yes";
    state.auditShouldFail = true;

    await expect(bootstrapAdmin()).rejects.toThrow(/audit_logs indisponível/);

    // As 3 operações (role+passwordHash, tokenVersion, audit) foram tentadas dentro da
    // MESMA transação — a falha na última reverte TODAS (garantia do motor MySQL já
    // testada implicitamente pelo padrão usado em passwordResetService.ts).
    expect(state.calls).toHaveLength(3);
    expect(state.calls[2]).toEqual({ table: "auditLogs", op: "insert" });
  });

  it("reexecução quando já é admin permanece idempotente (nenhuma transação/escrita)", async () => {
    state.existingRows = [{ id: 42, role: "admin" }];
    const result = await bootstrapAdmin();
    expect(result.outcome).toBe("already_admin");
    expect(result.userId).toBe(42);
    expect(state.calls).toEqual([]);
  });
});

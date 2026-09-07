/**
 * V1 PRE-PILOT CLOSURE — PR 0 (correção final) — atomicidade de scripts/bootstrap-admin.ts.
 *
 * Não requer MySQL real: mocka `drizzle-orm/mysql2` (retorna um `db` fake controlado
 * pelo teste) e `mysql2/promise` (a conexão real nunca chega a ser usada). O objetivo
 * é comprovar o CONTRATO do código — criação/promoção do admin e o registro em
 * `audit_logs` acontecem dentro da MESMA transação (`db.transaction`) — e que, se a
 * escrita da auditoria falhar, `main()` propaga o erro (nunca resolve com um outcome
 * de sucesso "silencioso"). A garantia de rollback físico da transação é do próprio
 * motor MySQL/driver (já usada em outros serviços do projeto, ex.: passwordResetService.ts);
 * este teste comprova que o CÓDIGO usa essa garantia (uma única transação), não
 * reimplementa/reverifica o motor de banco.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { users, auditLogs } from "../../../drizzle/schema";

const state = vi.hoisted(() => ({
  existingRows: [] as Array<{ id: number; role: string }>,
  auditShouldFail: false,
  calls: [] as Array<{ table: "users" | "auditLogs" | "unknown"; op: "insert" | "update" }>,
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
        update: () => ({
          set: () => ({
            where: async () => {
              state.calls.push({ table: "users", op: "update" });
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
    process.env.DATABASE_URL = "mysql://fake:fake@localhost:3306/fake";
  });

  afterAll(() => {
    process.env.ADMIN_BOOTSTRAP_CONFIRM = ORIGINAL_ENV.CONFIRM;
    process.env.ADMIN_BOOTSTRAP_EMAIL = ORIGINAL_ENV.EMAIL;
    process.env.ADMIN_BOOTSTRAP_PASSWORD = ORIGINAL_ENV.PASSWORD;
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

  it("promoção de usuário existente também é atômica com o audit", async () => {
    state.existingRows = [{ id: 42, role: "user" }];
    const result = await bootstrapAdmin();
    expect(result.outcome).toBe("promoted");
    expect(result.userId).toBe(42);
    expect(state.calls).toEqual([
      { table: "users", op: "update" },
      { table: "auditLogs", op: "insert" },
    ]);
  });

  it("promoção: falha no audit também propaga o erro (nada fica silenciosamente promovido)", async () => {
    state.existingRows = [{ id: 42, role: "user" }];
    state.auditShouldFail = true;
    await expect(bootstrapAdmin()).rejects.toThrow(/audit_logs indisponível/);
  });
});

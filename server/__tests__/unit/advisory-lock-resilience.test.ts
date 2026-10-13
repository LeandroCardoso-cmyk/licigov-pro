/**
 * Resiliência do advisory lock (Database Layer): perda da sessão do lock, nome com identidade do banco, limite de 64 caracteres e falha de
 * RELEASE_LOCK depois de o trabalho concluir (resultado incerto falso). A prova com sessão realmente morta (KILL) está no smoke MySQL (LOCK-LOSS-*).
 */
import { describe, expect, it, vi } from "vitest";
import { AdvisoryLockLostError, MAX_LOGICAL_LOCK_NAME, namespacedLockName, withHeldAdvisoryLock } from "../../db/advisoryLock";
import { withAdvisoryLock } from "../../db/migrationLock";
import { candidateRegistrationLockName } from "../../services/institutionalTemplates/candidateRegistrationService";

type Handler = (err: unknown) => void;
/** Conexão falsa: responde por padrão como uma sessão saudável dona do lock (CONNECTION_ID = 7). */
function fakeConnection(over: { isUsedLock?: () => number | null | Promise<never>; release?: () => Promise<unknown>; db?: string } = {}) {
  const handlers: Handler[] = [];
  const sqls: string[] = [];
  const conn = {
    on: (_evt: string, h: Handler) => { handlers.push(h); },
    query: vi.fn(async (sql: string) => {
      sqls.push(sql);
      if (sql.includes("DATABASE()")) return [[{ db: over.db ?? "banco_a" }]];
      if (sql.includes("GET_LOCK")) return [[{ ok: 1 }]];
      if (sql.includes("IS_USED_LOCK")) { const v = over.isUsedLock ? await over.isUsedLock() : 1; return [[{ held: v }]]; }
      if (sql.includes("RELEASE_LOCK")) { if (over.release) await over.release(); return [[{ released: 1 }]]; }
      throw new Error(`sql inesperado: ${sql}`);
    }),
  };
  return { conn, emit: (e: unknown) => handlers.forEach((h) => h(e)), sqls };
}

describe("nome do lock", () => {
  it("inclui a identidade do banco (bancos distintos ⇒ nomes distintos), é determinístico e ≤ 64 caracteres", () => {
    const logical = candidateRegistrationLockName(1, "ti0001");
    const a = namespacedLockName("banco_a", logical); const b = namespacedLockName("banco_b", logical);
    expect(a).not.toBe(b);
    expect(namespacedLockName("banco_a", logical)).toBe(a);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(namespacedLockName("x", "y".repeat(MAX_LOGICAL_LOCK_NAME)).length).toBe(64);
    expect(() => namespacedLockName("x", "y".repeat(MAX_LOGICAL_LOCK_NAME + 1))).toThrow(/nome de lock inválido/);
    expect(() => namespacedLockName("x", "")).toThrow(/nome de lock inválido/);
  });
});

describe("assertHeld — propriedade do lock durante o trabalho", () => {
  it("sessão dona ⇒ passa; outro dono ou lock livre ⇒ AdvisoryLockLostError; sessão morta (erro de conexão / evento 'error') ⇒ AdvisoryLockLostError e hook de observabilidade", async () => {
    const lost: string[] = [];
    const hooks = { onLockLost: (i: { lockName: string; reason: string }) => lost.push(i.reason) };
    const healthy = fakeConnection();
    await expect(withHeldAdvisoryLock(healthy.conn as never, "lk", 1, async (h) => { await h.assertHeld(); return "ok"; }, hooks)).resolves.toBe("ok");
    expect(lost).toEqual([]);

    const otherOwner = fakeConnection({ isUsedLock: () => 0 });
    await expect(withHeldAdvisoryLock(otherOwner.conn as never, "lk", 1, async (h) => { await h.assertHeld(); return "x"; }, hooks)).rejects.toBeInstanceOf(AdvisoryLockLostError);
    const free = fakeConnection({ isUsedLock: () => null });
    await expect(withHeldAdvisoryLock(free.conn as never, "lk", 1, async (h) => { await h.assertHeld(); }, hooks)).rejects.toBeInstanceOf(AdvisoryLockLostError);

    const dead = fakeConnection({ isUsedLock: () => Promise.reject(new Error("Connection lost")) });
    await expect(withHeldAdvisoryLock(dead.conn as never, "lk", 1, async (h) => { await h.assertHeld(); }, hooks)).rejects.toBeInstanceOf(AdvisoryLockLostError);

    const killed = fakeConnection();
    await expect(withHeldAdvisoryLock(killed.conn as never, "lk", 1, async (h) => { killed.emit(new Error("server closed")); await h.assertHeld(); }, hooks)).rejects.toBeInstanceOf(AdvisoryLockLostError);
    expect(lost).toHaveLength(4);
  });
  it("o nome efetivo usado em GET_LOCK é o namespaced (identidade do banco)", async () => {
    const f = fakeConnection({ db: "banco_z" });
    let seen = "";
    await withHeldAdvisoryLock(f.conn as never, "lk", 1, async (h) => { seen = h.name; });
    expect(seen).toBe(namespacedLockName("banco_z", "lk"));
    expect(f.conn.query.mock.calls.some((c) => String(c[0]).includes("GET_LOCK") && (c[1] as string[])[0] === seen)).toBe(true);
  });
});

describe("RELEASE_LOCK que falha depois do trabalho (resultado incerto falso)", () => {
  it("fn concluiu ⇒ o resultado NÃO é mascarado pela falha de liberação (hook registra); fn falhou ⇒ o erro de fn prevalece", async () => {
    const released: unknown[] = [];
    const ok = fakeConnection({ release: () => Promise.reject(new Error("conexão perdida ao liberar")) });
    await expect(withAdvisoryLock(ok.conn as never, "lk", 1, async () => "feito", (e) => released.push(e))).resolves.toBe("feito");
    expect(released).toHaveLength(1);
    const bad = fakeConnection({ release: () => Promise.reject(new Error("conexão perdida ao liberar")) });
    await expect(withAdvisoryLock(bad.conn as never, "lk", 1, async () => { throw new Error("erro do trabalho"); }, (e) => released.push(e))).rejects.toThrow("erro do trabalho");
    expect(released).toHaveLength(2);
  });
});

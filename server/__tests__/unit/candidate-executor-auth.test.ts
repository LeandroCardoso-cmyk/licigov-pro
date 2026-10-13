/**
 * Autenticação do executor (credencial do próprio sistema) e amarração da autoridade — domínio/serviço puros com fakes.
 */
import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../../services/passwordSecurity";
import { ExecutorAuthError, authenticateExecutor, type ExecutorAuthDeps } from "../../services/institutionalTemplates/candidateExecutorAuthService";
import { bindAuthorityToExecutor, executorCredentialsFromEnv, roleAtLeast } from "../../domain/institutionalTemplates/candidateExecution";
import { TEMPLATE_ACTION_MIN_ROLE } from "../../services/institutionalTemplates/authority";

describe("autenticação do executor", () => {
  let good: string;
  const deps = async (members: Record<string, string | null> = { "1:10": "operator" }, over: Partial<{ hash: string | null }> = {}): Promise<{ d: ExecutorAuthDeps; verify: ReturnType<typeof vi.fn> }> => {
    good ??= await hashPassword("Senha-Correta-1!");
    const verify = vi.fn(verifyPassword);
    return {
      verify,
      d: {
        getUserByEmail: async (e) => (e === "ana@orgao.gov.br" ? { id: 10, name: "Ana", passwordHash: over.hash === undefined ? good : over.hash } : undefined),
        verifyPassword: verify, getActiveMemberRole: async (o, u) => (members[`${o}:${u}`] ?? null) as never,
      },
    };
  };
  const creds = { email: "ana@orgao.gov.br", password: "Senha-Correta-1!" };

  it("credencial válida + membership ativa ≥ operator ⇒ autentica e devolve o id VERIFICADO", async () => {
    const { d } = await deps();
    await expect(authenticateExecutor(d, 1, creds)).resolves.toEqual({ userId: 10, name: "Ana", role: "operator" });
    const m = await deps({ "1:10": "manager" });
    await expect(authenticateExecutor(m.d, 1, creds)).resolves.toMatchObject({ role: "manager" });
  });
  it("e-mail desconhecido, senha errada, sem hash, sem membership, membership de OUTRO órgão ou papel viewer ⇒ a MESMA recusa", async () => {
    const msgs = new Set<string>();
    const cases: Array<[string, ExecutorAuthDeps, { email: string; password: string }, number]> = [];
    const a = await deps();
    cases.push(["desconhecido", a.d, { ...creds, email: "x@orgao.gov.br" }, 1], ["senha errada", a.d, { ...creds, password: "errada" }, 1]);
    cases.push(["sem hash", (await deps({ "1:10": "operator" }, { hash: null })).d, creds, 1]);
    cases.push(["sem membership", (await deps({})).d, creds, 1], ["outro órgão", (await deps({ "2:10": "owner" })).d, creds, 1], ["viewer", (await deps({ "1:10": "viewer" })).d, creds, 1]);
    for (const [label, d, c, org] of cases) {
      const err = await authenticateExecutor(d, org, c).catch((e) => e);
      expect(err, label).toBeInstanceOf(ExecutorAuthError);
      msgs.add(String(err.message));
    }
    expect(msgs.size).toBe(1);
  });
  it("a senha é SEMPRE comparada (também para e-mail desconhecido): custo igual, sem enumeração por tempo", async () => {
    const { d, verify } = await deps();
    await authenticateExecutor(d, 1, { ...creds, email: "x@orgao.gov.br" }).catch(() => undefined);
    expect(verify).toHaveBeenCalledTimes(1);
  });
  it("o piso de papel é o mesmo de registrar no fluxo normal", () => {
    expect(roleAtLeast("operator")).toBe(true); expect(roleAtLeast("viewer")).toBe(false); expect(roleAtLeast(null)).toBe(false); expect(roleAtLeast("estranho")).toBe(false);
    expect(TEMPLATE_ACTION_MIN_ROLE.register).toBe("operator");
  });
});

describe("autoridade amarrada ao executor e credenciais por ambiente", () => {
  const auth = { decidedByName: "Ana", decidedByRole: "Gestora", decidedAt: "2026-10-13", basisReference: "Ato X", reason: "Registro do DRAFT" };
  it("decidedByUserId é forçado ao usuário autenticado; divergente é recusado; campos obrigatórios", () => {
    expect(bindAuthorityToExecutor(auth, 10).decidedByUserId).toBe(10);
    expect(bindAuthorityToExecutor({ ...auth, decidedByUserId: 10 }, 10).decidedByUserId).toBe(10);
    expect(() => bindAuthorityToExecutor({ ...auth, decidedByUserId: 99 }, 10)).toThrow(/difere do usuário autenticado/);
    const { reason: _r, ...semReason } = auth;
    expect(() => bindAuthorityToExecutor(semReason, 10)).toThrow(/reason/);
  });
  it("credenciais só de variáveis de ambiente; ausência ⇒ erro", () => {
    expect(executorCredentialsFromEnv({ CANDIDATE_EXECUTOR_EMAIL: " a@b.c ", CANDIDATE_EXECUTOR_PASSWORD: "p" })).toEqual({ email: "a@b.c", password: "p" });
    expect(() => executorCredentialsFromEnv({})).toThrow(/CANDIDATE_EXECUTOR_EMAIL/);
    expect(() => executorCredentialsFromEnv({ CANDIDATE_EXECUTOR_EMAIL: "a@b.c" })).toThrow(/CANDIDATE_EXECUTOR_PASSWORD/);
  });
});

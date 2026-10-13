/**
 * CLI `scripts/register-model-candidate.ts` — guardas que valem ANTES de qualquer acesso ao banco.
 *  G1  TODA execução exige --allow-production, --confirm exato e --expect-database, INDEPENDENTE de APP_ENV/NODE_ENV (ausente, divergente ou
 *      ambos não produtivos): rótulos de ambiente nunca dispensam guarda;
 *  G2  o ator nunca é digitado (--actor-user-id removido) e a credencial do executor vem só de variáveis de ambiente;
 *  snapshot/plan seguem SOMENTE LEITURA (sem caminho de escrita no script).
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { main } from "../../../scripts/register-model-candidate";
import { executionGuardFailures } from "../../domain/institutionalTemplates/candidateExecution";

const H = (c: string) => c.repeat(64);
const base = ["--organization-id=7", "--identity-id=ti123", "--package-version=1.0.2-draft", `--expect-semantic-hash=${H("a")}`, `--expect-baseline-hash=${H("b")}`, `--expect-source-sha256=${H("c")}`];
const CONFIRM = `REGISTER_CANDIDATE_DRAFT:7:ti123:${"a".repeat(12)}`;
const saved = { argv: process.argv, app: process.env.APP_ENV, node: process.env.NODE_ENV, email: process.env.CANDIDATE_EXECUTOR_EMAIL, pw: process.env.CANDIDATE_EXECUTOR_PASSWORD };
const setEnv = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
const run = (args: string[]) => { process.argv = ["node", "register-model-candidate.ts", ...args]; return main(); };
afterEach(() => { process.argv = saved.argv; setEnv("APP_ENV", saved.app); setEnv("NODE_ENV", saved.node); setEnv("CANDIDATE_EXECUTOR_EMAIL", saved.email); setEnv("CANDIDATE_EXECUTOR_PASSWORD", saved.pw); });

describe("register-model-candidate (guardas)", () => {
  it("modo inválido, ids ausentes ou hashes malformados ⇒ recusa", async () => {
    await expect(run(["--mode=apply", ...base])).rejects.toThrow(/--mode/);
    await expect(run(["--organization-id=7"])).rejects.toThrow(/obrigatório/);
    await expect(run([...base.slice(0, 3), "--expect-semantic-hash=xyz", ...base.slice(4)])).rejects.toThrow(/inválido/);
    await expect(run(["--organization-id=-1", ...base.slice(1)])).rejects.toThrow(/inválido/);
  });

  // G1 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const ENVS: Array<[string, string | undefined, string | undefined]> = [
    ["APP_ENV ausente, NODE_ENV ausente", undefined, undefined],
    ["APP_ENV ausente, NODE_ENV=development", undefined, "development"],
    ["APP_ENV=development, NODE_ENV=production (divergente)", "development", "production"],
    ["APP_ENV=production, NODE_ENV=development (divergente)", "production", "development"],
    ["APP_ENV=staging, NODE_ENV=test (ambos não produtivos)", "staging", "test"],
    ["APP_ENV=development, NODE_ENV=development (ambos não produtivos)", "development", "development"],
    ["APP_ENV=production, NODE_ENV=production", "production", "production"],
  ];
  for (const [label, app, node] of ENVS) {
    it(`G1 — execução exige --allow-production, --confirm e --expect-database em QUALQUER ambiente: ${label}`, async () => {
      setEnv("APP_ENV", app); setEnv("NODE_ENV", node);
      const full = ["--mode=execute", ...base, `--confirm=${CONFIRM}`, "--expect-database=licigov", "--authority-file=/nao/existe.json"];
      await expect(run(full.filter((a) => a !== "--allow-production"))).rejects.toThrow(/--allow-production/);                          // sem a guarda explícita
      await expect(run([...full, "--allow-production"].filter((a) => !a.startsWith("--confirm=")))).rejects.toThrow(/--confirm deve ser exatamente/);
      await expect(run([...full, "--allow-production"].filter((a) => !a.startsWith("--expect-database=")))).rejects.toThrow(/--expect-database/);
      await expect(run([...full.map((a) => (a.startsWith("--confirm=") ? "--confirm=REGISTER_CANDIDATE_DRAFT:7:outra:aaaaaaaaaaaa" : a)), "--allow-production"])).rejects.toThrow(/--confirm deve ser exatamente/);
    });
  }
  it("G1 — a função pura de guardas devolve o MESMO resultado para qualquer combinação de rótulos de ambiente", () => {
    const g = (appEnv?: string, nodeEnv?: string) => executionGuardFailures({ confirm: CONFIRM, confirmExpected: CONFIRM, allowProduction: false, expectDatabase: "licigov", appEnv, nodeEnv });
    const ref = g(undefined, undefined);
    expect(ref).toHaveLength(1);
    for (const [a, n] of [["production", "production"], ["development", "production"], ["production", "development"], ["staging", "test"], [undefined, "production"]] as const) expect(g(a, n)).toEqual(ref);
    expect(executionGuardFailures({ confirm: CONFIRM, confirmExpected: CONFIRM, allowProduction: true, expectDatabase: "licigov" })).toEqual([]);
    expect(executionGuardFailures({ confirm: CONFIRM, confirmExpected: CONFIRM, allowProduction: true, expectDatabase: "x; DROP" })).toHaveLength(1);
  });
  it("G1 — plan e snapshot NÃO exigem as guardas de escrita (somente leitura) e não aceitam --allow-production como substituto de nada", () => {
    const src = readFileSync(path.resolve("scripts/register-model-candidate.ts"), "utf8");
    const planBlock = src.slice(src.indexOf('if (mode === "plan")'), src.indexOf("// ── EXECUÇÃO"));
    expect(planBlock).not.toMatch(/registerCandidateDraft|allow-production/);
    const snapBlock = src.slice(src.indexOf('if (mode === "snapshot")'), src.indexOf("const identityId"));
    expect(snapBlock).not.toMatch(/registerCandidateDraft|createDraft|\.insert\(|\.update\(/);
  });

  // G2 ───────────────────────────────────────────────────────────────────────────────────────────────────────
  it("G2 — --actor-user-id foi removido em TODOS os modos (o ator é o usuário autenticado)", async () => {
    for (const mode of ["plan", "snapshot", "execute"]) await expect(run([`--mode=${mode}`, ...base, "--actor-user-id=5"])).rejects.toThrow(/--actor-user-id não existe mais/);
  });
  it("G2 — com as guardas satisfeitas, a execução exige credenciais por variáveis de ambiente (nunca por argumento)", async () => {
    setEnv("CANDIDATE_EXECUTOR_EMAIL", undefined); setEnv("CANDIDATE_EXECUTOR_PASSWORD", undefined);
    const ok = ["--mode=execute", ...base, `--confirm=${CONFIRM}`, "--expect-database=licigov", "--allow-production", "--authority-file=/nao/existe.json"];
    await expect(run(ok)).rejects.toThrow(/CANDIDATE_EXECUTOR_EMAIL/);
    await expect(run([...ok, "--password=x", "--email=a@b.c"])).rejects.toThrow(/CANDIDATE_EXECUTOR_EMAIL/);          // argumentos de credencial são ignorados
  });
  it("o script não contém caminho de aprovação/publicação/vínculo/flag-write e não é rota nem preset", () => {
    const src = readFileSync(path.resolve("scripts/register-model-candidate.ts"), "utf8");
    expect(src).not.toMatch(/\.(approve|publish|setBinding|deprecate)\(|setFeatureFlag|updateFeatureFlag|generateTemplatedDocument|\.(insert|update|delete)\(/);   // a flag só é LIDA (snapshot)
    expect(src).not.toMatch(/arg\("(password|senha|email|actor-user-id)"\)/);                       // credencial/ator nunca por argumento
    expect(src).toContain("executorCredentialsFromEnv(process.env)");
    const svc = readFileSync(path.resolve("server/services/institutionalTemplates/candidateRegistrationService.ts"), "utf8");
    expect(svc).not.toMatch(/\.(approve|publish|setBinding|deprecate)\(|generateTemplatedDocument/);
    const router = readFileSync(path.resolve("server/routers/institutionalTemplatesRouter.ts"), "utf8");
    expect(router).not.toMatch(/candidateRegistration|candidateExecut|allowCandidatePackages|packageVersion/);
  });
});

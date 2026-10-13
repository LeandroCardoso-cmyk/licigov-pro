/**
 * CLI `scripts/register-model-candidate.ts` — guardas que valem ANTES de qualquer acesso ao banco (execução só com confirmação exata,
 * produção só com --allow-production, autoridade declarada obrigatória; modo padrão é o plano somente leitura).
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../../../scripts/register-model-candidate";

const H = (c: string) => c.repeat(64);
const base = ["--organization-id=7", "--identity-id=ti123", "--package-version=1.0.2-draft", `--expect-semantic-hash=${H("a")}`, `--expect-baseline-hash=${H("b")}`, `--expect-source-sha256=${H("c")}`];
const CONFIRM = `REGISTER_CANDIDATE_DRAFT:7:ti123:${"a".repeat(12)}`;
const saved = { argv: process.argv, env: process.env.APP_ENV };
const run = (args: string[]) => { process.argv = ["node", "register-model-candidate.ts", ...args]; return main(); };
afterEach(() => { process.argv = saved.argv; if (saved.env === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = saved.env; });

describe("register-model-candidate (guardas)", () => {
  it("modo inválido, ids ausentes ou hashes malformados ⇒ recusa", async () => {
    await expect(run(["--mode=apply", ...base])).rejects.toThrow(/--mode/);
    await expect(run(["--organization-id=7"])).rejects.toThrow(/obrigatório/);
    await expect(run([...base.slice(0, 3), "--expect-semantic-hash=xyz", ...base.slice(4)])).rejects.toThrow(/inválido/);
    await expect(run(["--organization-id=-1", ...base.slice(1)])).rejects.toThrow(/inválido/);
  });
  it("execução exige --actor-user-id e --confirm EXATO com os identificadores", async () => {
    await expect(run(["--mode=execute", ...base])).rejects.toThrow(/actor-user-id/);
    await expect(run(["--mode=execute", ...base, "--actor-user-id=5"])).rejects.toThrow(/--confirm deve ser exatamente/);
    await expect(run(["--mode=execute", ...base, "--actor-user-id=5", "--confirm=REGISTER_CANDIDATE_DRAFT:7:outra:aaaaaaaaaaaa"])).rejects.toThrow(/--confirm deve ser exatamente/);
  });
  it("produção só com --allow-production explícito", async () => {
    process.env.APP_ENV = "production";
    await expect(run(["--mode=execute", ...base, "--actor-user-id=5", `--confirm=${CONFIRM}`])).rejects.toThrow(/--allow-production/);
  });
  it("autoridade declarada é obrigatória e nunca preenchida pela ferramenta", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cand-"));
    const f = path.join(dir, "authority.json");
    writeFileSync(f, JSON.stringify({ decidedByName: "Fulana", decidedByRole: "Gestora", decidedAt: "2026-10-13", basisReference: "x" }));    // sem `reason`
    await expect(run(["--mode=execute", ...base, "--actor-user-id=5", `--confirm=${CONFIRM}`, `--authority-file=${f}`])).rejects.toThrow(/reason/);
  });
  it("o script não contém caminho de aprovação/publicação/vínculo/flag e não é rota nem preset", () => {
    const src = readFileSync(path.resolve("scripts/register-model-candidate.ts"), "utf8");
    expect(src).not.toMatch(/\.(approve|publish|setBinding|deprecate)\(|setFeatureFlag|updateFeatureFlag|generateTemplatedDocument|\.(insert|update|delete)\(/);   // a flag só é LIDA (snapshot)
    const svc = readFileSync(path.resolve("server/services/institutionalTemplates/candidateRegistrationService.ts"), "utf8");
    expect(svc).not.toMatch(/\.(approve|publish|setBinding|deprecate)\(|generateTemplatedDocument/);
    const router = readFileSync(path.resolve("server/routers/institutionalTemplatesRouter.ts"), "utf8");
    expect(router).not.toMatch(/candidateRegistration|allowCandidatePackages|packageVersion/);
  });
});

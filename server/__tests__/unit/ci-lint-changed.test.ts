/**
 * SEC-AUD-2026-10 — seleção FAIL-CLOSED do lint de não-regressão da CI (scripts/ci/lint-changed.sh).
 *
 * Repositório git temporário com origin local (bare) e o eslint REAL do projeto (um `pnpm` falso no PATH só
 * repassa `pnpm exec eslint …` ao binário instalado). Prova: arquivo .ts alterado é de fato lintado; violação
 * reprova; base ausente, nome inválido, repositório raso e ausência de merge-base reprovam; diff válido sem .ts
 * aprova sem chamar o eslint; e o cenário que enganava o passo antigo (base avançou com commit que não é
 * ancestral do head) agora linta de verdade.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/ci/lint-changed.sh");
const ESLINT_JS = path.join(ROOT, "node_modules/eslint/bin/eslint.js");

let dir: string;
let work: string;
let bin: string;
let eslintCalls: string;

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
function write(rel: string, content: string, cwd = work) {
  const p = path.join(cwd, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}
function commit(msg: string, cwd = work) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-q", "-m", msg);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "lint-changed-"));
  const origin = path.join(dir, "origin.git");
  work = path.join(dir, "work");
  bin = path.join(dir, "bin");
  eslintCalls = path.join(dir, "eslint-calls.log");
  mkdirSync(bin);
  git(dir, "init", "-q", "--bare", origin);
  git(dir, "clone", "-q", origin, work);
  git(work, "checkout", "-q", "-b", "staging");
  write("eslint.config.mjs", 'export default [{ files: ["**/*.ts", "**/*.tsx"], rules: { "no-unused-vars": "error" } }];\n');
  write("src/base.ts", "export const base = 1;\n");
  write("README.md", "base\n");
  commit("base");
  git(work, "push", "-q", "origin", "staging");
  git(work, "checkout", "-q", "-b", "feature");
  // `pnpm exec eslint …` ⇒ eslint REAL do projeto (registra a chamada para provar que rodou ou não).
  writeFileSync(path.join(bin, "pnpm"), `#!/usr/bin/env bash
[ "$1" = exec ] && shift; [ "$1" = eslint ] && shift
printf '%s\\n' "$*" >> "${eslintCalls}"
exec node "${ESLINT_JS}" "$@"
`);
  chmodSync(path.join(bin, "pnpm"), 0o755);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>, cwd = work) {
  const r = spawnSync("bash", [SCRIPT], {
    cwd, encoding: "utf8",
    env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: dir, ...env },
  });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}`, eslintRan: existsSync(eslintCalls) };
}
const dispatch = (base: string) => ({ EVENT_NAME: "workflow_dispatch", DISPATCH_LINT_BASE: base });

describe("lint-changed.sh — o eslint roda de verdade nos arquivos alterados", () => {
  it("arquivo .ts alterado limpo ⇒ listado, eslint executado, aprovado", () => {
    write("src/ok.ts", "export const ok = 2;\n");
    commit("ok");
    const r = run(dispatch("staging"));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/arquivos \.ts\/\.tsx: 1/);
    expect(r.out).toContain("./src/ok.ts");
    expect(r.out).toMatch(/eslint executado em 1 arquivo/);
    expect(readFileSync(eslintCalls, "utf8")).toContain("./src/ok.ts");
  });

  it("violação introduzida num .ts alterado ⇒ reprova (eslint real)", () => {
    write("src/bad.ts", "const naoUsada = 1;\nexport const ok = 2;\n");
    commit("bad");
    const r = run(dispatch("staging"));
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/no-unused-vars/);
    expect(r.out).toContain("bad.ts");
  });

  it("arquivo não alterado com violação herdada NÃO entra no lint (não-regressão)", () => {
    git(work, "checkout", "-q", "staging");
    write("src/legado.ts", "const divida = 1;\n");
    commit("dívida herdada");
    git(work, "push", "-q", "origin", "staging");
    git(work, "checkout", "-q", "feature");
    git(work, "merge", "-q", "--no-edit", "staging");
    write("src/novo.ts", "export const novo = 3;\n");
    commit("novo");
    const r = run(dispatch("staging"));
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toContain("legado.ts");
  });

  it("nome de arquivo com espaço e hífen inicial é tratado como arquivo, não como opção", () => {
    write("src/-estranho nome.ts", "export const x = 1;\n");
    commit("nome estranho");
    const r = run(dispatch("staging"));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("./src/-estranho nome.ts");
  });

  it("regressão do passo antigo: base avançou com commit fora do head ⇒ merge-base encontrada e eslint roda", () => {
    write("src/feature.ts", "const naoUsada = 1;\nexport const f = 1;\n");
    commit("feature com violação");
    git(work, "checkout", "-q", "staging");
    write("hotfix.md", "hotfix só na base\n");
    commit("hotfix na base");
    git(work, "push", "-q", "origin", "staging");
    git(work, "checkout", "-q", "feature");
    git(work, "fetch", "-q", "origin"); // clone completo, como o checkout fetch-depth: 0

    // Passo ANTIGO (reproduzido): fetch --depth=1 + diff com stderr descartado ⇒ "nenhum arquivo" (falso OK).
    const old = spawnSync("bash", ["-c", `set -euo pipefail
git fetch --no-tags --depth=1 origin staging >/dev/null 2>&1 || true
CHANGED=$(git diff --diff-filter=ACMR --name-only origin/staging...HEAD -- '*.ts' '*.tsx' 2>/dev/null | tr '\\n' ' ' || true)
[ -z "\${CHANGED// /}" ] && echo VAZIO || echo "$CHANGED"`], { cwd: work, encoding: "utf8" });
    expect(old.stdout.trim()).toBe("VAZIO");

    // Script novo num clone completo (o antigo deixou este raso; reclona como a CI faz).
    git(work, "push", "-q", "origin", "feature");
    const fresh = path.join(dir, "fresh");
    git(dir, "clone", "-q", "--branch", "feature", path.join(dir, "origin.git"), fresh);
    const r = run(dispatch("staging"), fresh);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/arquivos \.ts\/\.tsx: 1/);
    expect(r.out).toMatch(/no-unused-vars/);
  });
});

describe("lint-changed.sh — diff vazio só aprova quando calculado", () => {
  it("só .md alterado ⇒ aprova com 0 arquivos e sem chamar o eslint", () => {
    write("docs.md", "texto\n");
    commit("docs");
    const r = run(dispatch("staging"));
    expect(r.status, r.out).toBe(0);
    expect(r.out).toMatch(/arquivos \.ts\/\.tsx: 0/);
    expect(r.out).toMatch(/Diff calculado com sucesso/);
    expect(r.eslintRan).toBe(false);
  });

  it("base inexistente no origin ⇒ reprova (antes virava 'nenhum arquivo')", () => {
    write("src/ok.ts", "export const ok = 2;\n");
    commit("ok");
    const r = run(dispatch("nao-existe"));
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/falha ao buscar a base/);
    expect(r.eslintRan).toBe(false);
  });

  it("sem merge-base (histórico disjunto) ⇒ reprova", () => {
    git(work, "checkout", "-q", "--orphan", "orfa");
    git(work, "rm", "-rq", "--cached", ".");
    write("x.md", "órfão\n");
    git(work, "add", "x.md");
    git(work, "commit", "-q", "-m", "órfão");
    git(work, "push", "-q", "origin", "orfa");
    git(work, "checkout", "-q", "-f", "feature");
    const r = run(dispatch("orfa"));
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/sem merge-base/);
  });

  it("repositório raso ⇒ reprova (merge-base indisponível)", () => {
    git(work, "push", "-q", "origin", "feature");
    const shallow = path.join(dir, "shallow");
    git(dir, "clone", "-q", "--depth", "1", "--branch", "feature", `file://${path.join(dir, "origin.git")}`, shallow);
    const r = run(dispatch("staging"), shallow);
    expect(r.status).not.toBe(0);
    expect(r.out).toMatch(/repositório raso/);
  });

  it("base ausente, evento desconhecido ou nome de branch malicioso ⇒ reprova sem buscar nada", () => {
    for (const env of [
      { EVENT_NAME: "workflow_dispatch" },
      { EVENT_NAME: "pull_request", PR_BASE_REF: "" },
      { EVENT_NAME: "schedule", DISPATCH_LINT_BASE: "staging" },
      dispatch("staging;touch PWNED"),
      dispatch("$(touch PWNED)"),
      dispatch("-x"),
      dispatch("a..b"),
    ] as Record<string, string>[]) {
      const r = run(env);
      expect(r.status, JSON.stringify(env)).not.toBe(0);
    }
    expect(existsSync(path.join(work, "PWNED"))).toBe(false);
  });

  it("push: SHA anterior válido é a base; SHA nulo ou fora do histórico reprova", () => {
    const before = git(work, "rev-parse", "HEAD");
    write("src/p.ts", "export const p = 1;\n");
    commit("push");
    expect(run({ EVENT_NAME: "push", PUSH_BEFORE: before }).status).toBe(0);
    expect(run({ EVENT_NAME: "push", PUSH_BEFORE: "0".repeat(40) }).status).not.toBe(0);
    expect(run({ EVENT_NAME: "push", PUSH_BEFORE: "f".repeat(40) }).status).not.toBe(0);
  });
});

describe("ci.yml — passo de lint ligado ao seletor", () => {
  const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  const step = ci.slice(ci.indexOf("- name: Lint (não-regressão"), ci.indexOf("# ── GATE OBRIGATÓRIO 2"));

  it("usa o script, recebe as entradas só por env e não esconde erro", () => {
    expect(step).toContain("run: bash scripts/ci/lint-changed.sh");
    expect(step).toContain("PR_BASE_REF: ${{ github.base_ref }}");
    expect(step).toContain("DISPATCH_LINT_BASE: ${{ inputs.lint_base }}");
    expect(step).not.toMatch(/\|\|\s*true/);
    expect(step).not.toContain("2>/dev/null");
    expect(step).not.toMatch(/--depth/);
  });

  it("disparo manual exige a base do lint", () => {
    const dispatchBlock = ci.slice(ci.indexOf("workflow_dispatch:"), ci.indexOf("concurrency:"));
    expect(dispatchBlock).toMatch(/lint_base:[\s\S]*required: true/);
  });

  it("o checkout do job quality continua com histórico completo", () => {
    const quality = ci.slice(ci.indexOf("  quality:"), ci.indexOf("  test:"));
    expect(quality).toContain("fetch-depth: 0");
  });
});

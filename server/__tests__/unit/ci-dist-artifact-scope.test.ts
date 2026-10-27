/**
 * Guarda do artefato `dist` no CI (cota de armazenamento de Actions da conta).
 *
 * O job `build` continua compilando em todo PR (gate obrigatório), mas só publica o
 * `dist` quando há consumidor: o job `deploy`, que roda apenas em refs/heads/main.
 * Antes, cada execução de PR publicava ~38 MB com retenção de 7 dias e esgotava a cota.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

/** Bloco de um job de primeiro nível (`  nome:` até o próximo job ou o fim do arquivo). */
function jobBlock(name: string): string {
  const start = ci.indexOf(`\n  ${name}:\n`);
  expect(start, `job ${name} não encontrado no ci.yml`).toBeGreaterThan(-1);
  const rest = ci.slice(start + 1);
  const next = rest.slice(1).search(/\n  [a-z][a-z0-9_-]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** Bloco de um step (`- name: X` até o próximo `- name:` do mesmo job). */
function stepBlock(job: string, stepName: string): string {
  const start = job.indexOf(`- name: ${stepName}`);
  expect(start, `step "${stepName}" não encontrado`).toBeGreaterThan(-1);
  const rest = job.slice(start);
  const next = rest.slice(1).search(/\n\s+- name: /);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

const MAIN_ONLY = "if: github.ref == 'refs/heads/main'";

describe("CI — artefato dist só onde há consumidor", () => {
  const build = jobBlock("build");
  const deploy = jobBlock("deploy");

  it("o build de produção roda sem condição (gate de PR preservado)", () => {
    const buildStep = stepBlock(build, "Build (vite build + esbuild do server)");
    expect(buildStep).toMatch(/run: pnpm build\b/);
    expect(buildStep).not.toMatch(/\bif:/);
    // O job inteiro também não é condicional: o check "Build de Produção (gate)" existe em todo PR.
    expect(build.split("steps:")[0]).not.toMatch(/\bif:/);
  });

  it("o upload do dist só acontece em refs/heads/main e falha se o dist não existir", () => {
    const upload = stepBlock(build, "Publicar artefato de build validado");
    expect(upload).toContain(MAIN_ONLY);
    expect(upload).toContain("actions/upload-artifact@");
    expect(upload).toMatch(/name: dist\b/);
    expect(upload).toMatch(/if-no-files-found: error/);
  });

  it("o único consumidor (deploy) usa exatamente a mesma condição e depende do build", () => {
    expect(deploy).toContain(MAIN_ONLY);
    expect(deploy).toMatch(/needs: \[[^\]]*\bbuild\b[^\]]*\]/);
    const download = stepBlock(deploy, "Baixar artefato de build validado");
    expect(download).toContain("actions/download-artifact@");
    expect(download).toMatch(/name: dist\b/);
  });

  it("nenhum outro job baixa o dist", () => {
    const downloads = [...ci.matchAll(/download-artifact@[^\n]*\n(?:[^\n]*\n){0,3}?\s+name: ([^\n]+)/g)].map((m) => m[1].trim());
    expect(downloads).toEqual(["dist"]);
  });
});

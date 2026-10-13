/**
 * Runbook da Revisão 2 — os comandos para COPIAR E USAR têm hashes completos e válidos (iguais aos do pacote), o token de confirmação
 * correto e passam pelas guardas do CLI (a execução só para na falta de credencial, que não existe no teste).
 */
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { main } from "../../../scripts/register-model-candidate";
import { revisionSemanticHash } from "../../domain/institutionalTemplates/semanticHash";
import { BLL_MODEL_KEY, getModelPackage, getModelPackageVersion } from "../../services/institutionalTemplates/modelPackages";

const DOC = readFileSync(path.resolve("docs/ops/EDITAL_REVISION2_PUBLICATION_RUNBOOK.md"), "utf8");
const R1 = getModelPackage(BLL_MODEL_KEY)!; const R2 = getModelPackageVersion(BLL_MODEL_KEY, "1.0.2-draft")!;
const R1_HASH = revisionSemanticHash({ ast: R1.ast, variableCatalogVersion: R1.catalog.version });
const R2_HASH = revisionSemanticHash({ ast: R2.ast, variableCatalogVersion: R2.catalog.version });
const SHA = R2.provenance.sourceSha256;
const blocks = [...DOC.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
const cmd = (flag: string) => blocks.find((b) => b.includes(flag))!;
const flagsOf = (block: string): string[] => block.replace(/\\\n/g, " ").split(/\s+/).filter((t) => t.startsWith("--"));
const saved = { argv: process.argv, e: process.env.CANDIDATE_EXECUTOR_EMAIL, p: process.env.CANDIDATE_EXECUTOR_PASSWORD };
afterEach(() => { process.argv = saved.argv; for (const [k, v] of [["CANDIDATE_EXECUTOR_EMAIL", saved.e], ["CANDIDATE_EXECUTOR_PASSWORD", saved.p]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });

describe("runbook — constantes e comandos", () => {
  it("os hashes do pacote são os documentados (completos, 64 hex)", () => {
    expect(R2_HASH).toBe("33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd");
    expect(R1_HASH).toBe("e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d");
    for (const h of [R1_HASH, R2_HASH, SHA]) { expect(h).toMatch(/^[0-9a-f]{64}$/); expect(DOC).toContain(h); }
  });
  it("nenhum comando do runbook usa hash abreviado (…), --actor-user-id ou credencial por argumento", () => {
    for (const b of blocks.filter((x) => x.includes("register-model-candidate"))) {
      expect(b).not.toMatch(/--expect-[a-z0-9-]+=[0-9a-f]{0,63}(…|\.\.\.)/);
      expect(b).not.toContain("--actor-user-id");
      expect(b).not.toMatch(/--(password|email)=/);
      for (const t of flagsOf(b).filter((x) => x.startsWith("--expect-") && !x.startsWith("--expect-database"))) expect(t.split("=")[1]).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("o comando de EXECUÇÃO tem hashes e token corretos, --allow-production e --expect-database", () => {
    const exec = cmd("--mode=execute");
    expect(exec).toContain(`--expect-semantic-hash=${R2_HASH}`);
    expect(exec).toContain(`--expect-baseline-hash=${R1_HASH}`);
    expect(exec).toContain(`--expect-source-sha256=${SHA}`);
    expect(exec).toContain(`--confirm=REGISTER_CANDIDATE_DRAFT:1:<IDENTITY_ID>:${R2_HASH.slice(0, 12)}`);
    expect(exec).toContain("--allow-production"); expect(exec).toContain("--expect-database=<DATABASE_NAME>");
    expect(exec).toContain("CANDIDATE_EXECUTOR_EMAIL="); expect(exec).toContain("CANDIDATE_EXECUTOR_PASSWORD=");
  });
  it("o comando de PLANO (leitura) tem os mesmos hashes completos", () => {
    const plan = cmd("--mode=plan");
    expect(plan).toContain(`--expect-semantic-hash=${R2_HASH}`); expect(plan).toContain(`--expect-baseline-hash=${R1_HASH}`); expect(plan).toContain(`--expect-source-sha256=${SHA}`);
    expect(plan).not.toContain("--allow-production");
  });
  it("o comando copiado (placeholders preenchidos) PASSA pelas guardas do CLI: só falta a credencial do executor", async () => {
    delete process.env.CANDIDATE_EXECUTOR_EMAIL; delete process.env.CANDIDATE_EXECUTOR_PASSWORD;
    const args = flagsOf(cmd("--mode=execute")).map((t) => t.replace("<IDENTITY_ID>", "ti123").replace("<DATABASE_NAME>", "licigov").replace("authority.json", "/x.json"));
    process.argv = ["node", "register-model-candidate.ts", ...args];
    await expect(main()).rejects.toThrow(/CANDIDATE_EXECUTOR_EMAIL/);
  });
  it("as limitações da atribuição e a exigência de evidência jurídica própria permanecem documentadas", () => {
    expect(DOC).toContain("não tem MFA");
    expect(DOC).toContain("Não há limitação de tentativas");
    expect(DOC).toMatch(/rótulo `1\.0\.2-draft`[\s\S]{0,200}\*\*não\*\* têm ato jurídico próprio/);
    for (const t of ["CANDIDATE_UNIQUE", "NO_CONFLICTING_REVISION", "FLAG_ENABLED", "MODULE_DISABLED", "ignorado", "pino de SHA-256", "Riscos residuais"]) expect(DOC).toContain(t);
    for (const d of ["D0", "D1", "D2", "D3", "D4", "D5", "D6"]) expect(DOC).toContain(`${d} —`);
  });
});

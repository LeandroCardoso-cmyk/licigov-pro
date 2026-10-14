/**
 * Template Governance V2 — MARCO DE TRANSIÇÃO: contrato estático da migration 0318 e do leitor (somente leitura, imutável, fail-closed).
 * A prova de comportamento em banco real está em `templates-governance-v2-mysql-smoke.test.ts` (TRN-1..4).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "__tests__" || e === "dist") continue;
    const p = path.join(dir, e);
    statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(e) && out.push(p);
  }
  return out;
}

describe("migration 0318 — marco imutável no instante efetivo do primeiro deploy", () => {
  const sql = read("drizzle/0318_template_governance_transition.sql");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  it("cria a tabela platform-level (sem organization_id, sem FK) e semeia UMA vez com INSERT IGNORE do relógio UTC do banco", () => {
    expect(code).toMatch(/CREATE TABLE IF NOT EXISTS `template_governance_transitions`/);
    expect(code).not.toMatch(/organization_id|FOREIGN KEY|REFERENCES|CASCADE/i);
    expect(code).toMatch(/INSERT IGNORE INTO `template_governance_transitions`/);
    expect(code).toMatch(/UTC_TIMESTAMP\(3\)/);
    expect(code).toMatch(/'LEGACY_POLICY_CUTOVER'/);
  });
  it("nunca move o marco: sem UPDATE/DELETE/REPLACE/ON DUPLICATE KEY, sem DDL em tabela existente, sem DROP", () => {
    expect(code).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bREPLACE\b|ON DUPLICATE KEY|\bDROP\b|\bALTER\b|\bTRUNCATE\b/i);
  });
  it("journal: 0318 depois da 0317 (when maior) e snapshot presente", () => {
    const j = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: { idx: number; when: number; tag: string }[] };
    const e317 = j.entries.find((e) => e.tag.startsWith("0317_"))!;
    const e318 = j.entries.find((e) => e.tag === "0318_template_governance_transition")!;
    expect(e318).toBeTruthy(); expect(e318.idx).toBe(e317.idx + 1); expect(e318.when).toBeGreaterThan(e317.when);
    expect(j.entries[j.entries.length - 1].tag).toBe("0318_template_governance_transition");
    expect(read("drizzle/meta/0318_snapshot.json")).toContain("template_governance_transitions");
  });
});

describe("leitor do marco — somente leitura, fail-closed, sem knob mutável", () => {
  it("nenhum código de aplicação escreve na tabela do marco (INSERT/UPDATE/DELETE) — só o leitor a consulta", () => {
    const offenders: string[] = [];
    for (const f of walk(path.join(root, "server"))) {
      const src = strip(readFileSync(f, "utf8"));
      if (!/templateGovernanceTransitionsTable|template_governance_transitions/.test(src)) continue;
      if (/\.(insert|update|delete)\(\s*templateGovernanceTransitionsTable|(INSERT|UPDATE|DELETE)[^;]{0,40}template_governance_transitions/i.test(src)) offenders.push(path.relative(root, f));
    }
    expect(offenders).toEqual([]);
  });
  it("não há variável de ambiente nem constante que defina o marco: ele vem EXCLUSIVAMENTE do registro imutável", () => {
    for (const f of walk(path.join(root, "server"))) {
      expect(strip(readFileSync(f, "utf8")), f).not.toMatch(/TEMPLATE_LEGACY_POLICY_CUTOVER/);
    }
    expect(read(".env.example")).not.toMatch(/TEMPLATE_LEGACY_POLICY_CUTOVER/);
  });
  it("o leitor valida o formato ISO/UTC com ms, só cacheia valor positivo e devolve null (estrito) em ausência/erro", () => {
    const src = strip(read("server/db/templateGovernanceTransition.ts"));
    expect(src).toMatch(/ISO_MS_UTC/);
    expect(src).toMatch(/catch \(err\)[\s\S]*return null/);
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.delete\(|\.execute\(/);
  });
});

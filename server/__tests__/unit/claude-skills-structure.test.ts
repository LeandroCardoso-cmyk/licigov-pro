/**
 * Skills do projeto (Claude Code): `.claude/skills/<nome>/SKILL.md` com frontmatter YAML (`name` = nome da pasta, `description`).
 * Valida a estrutura de TODAS as skills versionadas e as salvaguardas da skill de execução `licigov-entrega-completa`:
 * ela orienta o procedimento, mas NUNCA concede autorização (merge, produção, migrations, secrets, atos institucionais).
 * Puro: só lê arquivos do repositório.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const SKILLS_DIR = path.join(process.cwd(), ".claude", "skills");

/** Frontmatter simples (chave: valor por linha, valor opcionalmente entre aspas) — o formato usado pelas skills do projeto. */
function frontmatter(src: string): Record<string, string> | null {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src.replace(/\r\n/g, "\n"));
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([a-z][a-z0-9_-]*):\s*(.*)$/i.exec(line);
    if (!kv) return null;                                     // linha fora do formato chave: valor ⇒ inválido
    const raw = kv[2].trim();
    out[kv[1]] = raw.startsWith('"') && raw.endsWith('"') ? JSON.parse(raw) : raw;
  }
  return out;
}

const skills = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();

describe("skills do projeto — estrutura descobrível pelo Claude Code", () => {
  it("cada pasta tem SKILL.md com frontmatter válido: name = pasta (kebab-case), description não vazia", () => {
    expect(skills).toContain("licigov-entrega-completa");
    for (const s of skills) {
      const file = path.join(SKILLS_DIR, s, "SKILL.md");
      expect(existsSync(file), s).toBe(true);
      const fm = frontmatter(readFileSync(file, "utf8"));
      expect(fm, `${s}: frontmatter`).not.toBeNull();
      expect(fm!.name, s).toBe(s);
      expect(fm!.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect((fm!.description ?? "").length, `${s}: description`).toBeGreaterThan(20);
      expect((fm!.description ?? "").length, `${s}: description longa demais`).toBeLessThanOrEqual(1024);
      // Nenhum campo que conceda ferramentas/permissões (ex.: allowed-tools): só name e description.
      expect(Object.keys(fm!).sort(), `${s}: campos do frontmatter`).toEqual(["description", "name"]);
    }
  });
});

describe("licigov-entrega-completa — procedimento integral sem autorização implícita", () => {
  const src = readFileSync(path.join(SKILLS_DIR, "licigov-entrega-completa", "SKILL.md"), "utf8");

  it("declara que não concede permissões e lista as operações que exigem autorização específica", () => {
    expect(src).toMatch(/não concede permissões novas/);
    expect(src).toMatch(/a skill nunca é autorização/);
    for (const op of ["merge (inclusive staging)", "`main`/produção", "deploy manual", "SQL/migration em staging ou produção", "secrets/flags", "policies/bindings/limiares", "atos ou documentos institucionais"]) {
      expect(src, op).toContain(op);
    }
    expect(src).toMatch(/Merge em staging não autoriza produção/);
  });

  it("define a execução integral, o integrador único, a auditoria única e os gates no estado final", () => {
    expect(src).toMatch(/Não encerre depois de investigar, escrever código, testar ou auditar/);
    expect(src).toMatch(/um único integrador/);
    expect(src).toMatch(/Auditores não editam/);
    expect(src).toMatch(/\*\*P0\*\*.*\*\*P1\*\*.*\*\*P2\*\*/s);
    expect(src).toMatch(/Não reabrir auditoria\s+ampla sem alteração material/);
    expect(src).toMatch(/No máximo dois\s+ciclos/);
    expect(src).toMatch(/JÁ é a confirmação que\s+essas skills exigem/);
    expect(src).toMatch(/estado FINAL/);
    expect(src).toMatch(/expectedHeadSha/);
  });

  it("preserva as regras de atos humanos, organização 1 e a ordem de autoridade (Constituição primeiro)", () => {
    expect(src).toMatch(/IA não marca declaração pessoal/);
    expect(src).toMatch(/não substitui `\[REVISAR\]` por falsa\s+conferência/);
    expect(src).toMatch(/organização 1/);
    expect(src.indexOf("PRODUCT_NORTH_STAR.md")).toBeLessThan(src.indexOf("CLAUDE.md"));
    expect(src).toMatch(/REUTILIZAR → INTEGRAR → CORRIGIR → ESTENDER → CRIAR/);
  });
});

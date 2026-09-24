/**
 * Guarda do dark mode dos <select> NATIVOS (24 ocorrências em 16 arquivos na auditoria do piloto).
 *
 * Causa raiz do bug da Pesquisa de Preços: o preflight do Tailwind deixa `select` transparente e com cor
 * herdada; a lista de opções (desenhada pelo navegador/SO) caía em fundo claro no dark mode. A correção é
 * SISTÊMICA em `client/src/index.css` (@layer base) — esta guarda impede que ela regrida e que um select
 * nativo volte a fixar cores claras que anulem a base.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CSS = readFileSync(path.join(ROOT, "client/src/index.css"), "utf8");

function block(selector: RegExp): string {
  const m = CSS.match(selector);
  if (!m || m.index === undefined) return "";
  const start = CSS.indexOf("{", m.index);
  let depth = 0;
  for (let i = start; i < CSS.length; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}" && --depth === 0) return CSS.slice(start + 1, i);
  }
  return "";
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith(".tsx") && !full.includes(".test.") ? [full] : [];
  });
}

describe("dark mode · base sistêmica para <select> nativo", () => {
  const base = block(/@layer base\s*\{/);

  it("@layer base dá fundo/texto semânticos ao select e às opções", () => {
    expect(base).toMatch(/\bselect\s*\{\s*@apply\s+bg-background\s+text-foreground;/);
    expect(base).toMatch(/\boption,\s*optgroup\s*\{\s*@apply\s+bg-popover\s+text-popover-foreground;/);
  });

  it("tokens usados existem nos DOIS temas (light preservado, dark definido)", () => {
    const light = block(/^:root\s*\{/m);
    const dark = block(/^\.dark\s*\{/m);
    for (const token of ["--background", "--foreground", "--popover", "--popover-foreground"]) {
      expect(light).toContain(`${token}:`);
      expect(dark).toContain(`${token}:`);
    }
  });

  it("color-scheme declarado em CSS: light no :root, dark no .dark", () => {
    expect(CSS).toMatch(/:root\s*\{\s*color-scheme:\s*light;\s*\}/);
    expect(CSS).toMatch(/\.dark\s*\{\s*color-scheme:\s*dark;\s*\}/);
  });
});

describe("dark mode · nenhum <select> nativo fixa cor clara que anule a base", () => {
  const LIGHT_ONLY = /\b(?:bg-white|bg-gray-\d{2,3}|bg-slate-\d{2,3}|text-black|text-gray-\d{2,3}|text-slate-\d{2,3})\b|backgroundColor\s*:|[^-]color\s*:\s*["'#]/;
  const files = tsxFiles(path.join(ROOT, "client/src"));

  it("encontra os selects nativos (sanidade da varredura)", () => {
    const total = files.reduce((n, f) => n + (readFileSync(f, "utf8").match(/<select\b/g)?.length ?? 0), 0);
    expect(total).toBeGreaterThanOrEqual(20);
  });

  it("nenhum select nativo usa fundo/texto claro fixo ou cor inline", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/<select\b/g)) {
        const rest = src.slice(m.index!);
        const stops = [rest.indexOf("<option"), rest.indexOf("</select>"), rest.indexOf("/>")].filter((i) => i > 0);
        const openTag = rest.slice(0, stops.length ? Math.min(...stops) : 600);
        const hit = openTag.match(LIGHT_ONLY);
        if (hit) offenders.push(`${path.relative(ROOT, f)}:${src.slice(0, m.index).split("\n").length} → ${hit[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

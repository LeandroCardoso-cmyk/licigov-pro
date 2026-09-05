/**
 * Guard de DARK MODE — superfícies com tint FUNCIONAL CLARO (OBJ: Dark Mode Hardening).
 *
 * O guard anterior (darkmode-tokens.test.ts) só proíbe NEUTROS hardcoded
 * (bg-white, bg-gray-NNN, text-gray-NNN, …). Ele NÃO capturava o defeito real observado
 * na homologação: superfícies com cor funcional CLARA (bg-indigo-50, bg-cyan-50,
 * bg-amber-50, bg-func-100…) usadas como fundo SEM variante `dark:` — que
 * permanecem claras em pleno dark mode (ex.: bloco "Reasoning & Explainability",
 * área de "Pesquisa/Justificativa do Preço").
 *
 * Regra determinística (não é screenshot): em toda tela V1 alcançável, qualquer linha
 * que use uma superfície funcional clara (bg-<func>-50/100) DEVE trazer, na MESMA linha,
 * a variante dark correspondente (dark:bg-… / dark:<variant>:bg-…). Cores funcionais
 * continuam significando estado — apenas passam a ser theme-aware.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// Diretórios das árvores de componentes ALCANÇÁVEIS nas telas V1 de operador.
const DIRS = [
  "client/src/components/legal-opinion",
  "client/src/components/direct-procurement",
  "client/src/components/contract-workspace",
  "client/src/components/procurement",
  "client/src/components/department-operation",
  "client/src/components/tirar-duvidas",
  "client/src/components/documents",
];

// Arquivos comprovadamente INALCANÇÁVEIS na navegação V1 (código morto) — fora do escopo
// desta fase (ver mapa de alcançabilidade). Não são renderizados por nenhuma rota V1.
const DEAD = new Set([
  "client/src/components/legal-opinion/PendingRequests.tsx",
  "client/src/components/procurement/CopilotPanel.tsx",
  "client/src/components/procurement/TimelinePanel.tsx",
]);

const FUNC = "indigo|blue|sky|cyan|teal|green|emerald|lime|amber|yellow|orange|red|rose|pink|purple|violet|fuchsia";
// Superfície funcional CLARA usada como fundo (shades 50/100, opacidade opcional).
const LIGHT_SURFACE = new RegExp(`\\bbg-(?:${FUNC})-(?:50|100)(?:/\\d+)?\\b`);
// Variante dark de background na mesma linha (estática ou com prefixo hover:/focus:/…).
const DARK_BG = /dark:(?:[a-z-]+:)?bg-/;

function walk(relDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, relDir))) {
    const rel = `${relDir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(tsx|ts)$/.test(name)) out.push(rel);
  }
  return out;
}

const FILES = DIRS.flatMap(walk)
  .filter((f) => !DEAD.has(f))
  .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));

describe("Dark mode · superfícies funcionais claras são theme-aware (telas V1)", () => {
  it.each(FILES)("%s — nenhuma bg-<func>-50/100 sem dark:bg na mesma linha", (rel) => {
    const offending = readFileSync(path.join(ROOT, rel), "utf8")
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((l) => LIGHT_SURFACE.test(l.line) && !DARK_BG.test(l.line));
    expect(
      offending,
      `Superfície funcional clara SEM variante dark: em ${rel}:\n${offending.map((o) => `  L${o.n}: ${o.line}`).join("\n")}`,
    ).toEqual([]);
  });
});

/**
 * Guard de DARK MODE — contraste de estados DISABLED (OBJ: contraste de disabled).
 *
 * A homologação visual revelou estados desabilitados quase ILEGÍVEIS no dark mode:
 * `disabled:opacity-50` (e `cursor-not-allowed opacity-50`) empilha opacidade sobre
 * botões sólidos e sobre texto já-muted, derrubando o contraste bem abaixo do legível
 * ("Parecer assinado", "ICP-Brasil (em breve)", "Registrar proposta"…).
 *
 * Regra determinística: nas telas V1 alcançáveis, o estado desabilitado NÃO pode ser
 * comunicado por fade de opacidade (opacity-50). Deve usar tratamento por TOKEN legível
 * (disabled:bg-muted / disabled:text-muted-foreground / bg-muted+text-muted-foreground),
 * que comunica "indisponível" sem virar "ilegível", em ambos os temas.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const DIRS = [
  "client/src/components/legal-opinion",
  "client/src/components/direct-procurement",
  "client/src/components/contract-workspace",
  "client/src/components/procurement",
  "client/src/components/department-operation",
  "client/src/components/tirar-duvidas",
  "client/src/components/documents",
];

const DEAD = new Set([
  "client/src/components/legal-opinion/PendingRequests.tsx",
  "client/src/components/procurement/CopilotPanel.tsx",
  "client/src/components/procurement/TimelinePanel.tsx",
]);

// Padrões proibidos: fade de opacidade como (único) sinal de desabilitado.
const BANNED = [
  /\bdisabled:opacity-50\b/, // fade em botão desabilitado
  /cursor-not-allowed[^"'`]*\bopacity-50\b|\bopacity-50\b[^"'`]*cursor-not-allowed/, // chip "não permitido" com fade
];

function walk(relDir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(ROOT, relDir))) {
    const rel = `${relDir}/${name}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(tsx|ts)$/.test(name)) out.push(rel);
  }
  return out;
}

const FILES = walkAll();
function walkAll() {
  return DIRS.flatMap(walk)
    .filter((f) => !DEAD.has(f))
    .filter((f) => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
}

describe("Dark mode · estados disabled legíveis (telas V1)", () => {
  it.each(FILES)("%s — não usa opacity-50 como sinal de desabilitado", (rel) => {
    const offending = readFileSync(path.join(ROOT, rel), "utf8")
      .split("\n")
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((l) => BANNED.some((re) => re.test(l.line)));
    expect(
      offending,
      `Estado desabilitado por fade de opacidade (use disabled:bg-muted/text-muted-foreground) em ${rel}:\n${offending.map((o) => `  L${o.n}: ${o.line}`).join("\n")}`,
    ).toEqual([]);
  });
});

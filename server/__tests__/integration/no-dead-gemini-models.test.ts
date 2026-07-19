/**
 * Guarda de regressão: nenhum serviço deve hardcodar um modelo Gemini DESCONTINUADO
 * numa chamada `getGenerativeModel`. O "gemini-2.0-flash-exp" (experimental) foi removido
 * e fazia TODA geração de documento (ETP/TR/DFD/Edital) e o AI Assistant falharem em produção.
 *
 * A regra: chamadas de modelo devem usar `AI_CONFIG.model` (o modelo vivo, dirigido por ENV),
 * nunca um id literal fixo. Assim, quando um modelo sair do ar, basta trocar `AI_MODEL`.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SERVER_DIR = path.join(process.cwd(), "server");

// Modelos sabidamente descontinuados / que não devem ser hardcodados em chamadas.
const DEAD_MODELS = [
  "gemini-2.0-flash-exp",
  "gemini-2.5-flash-preview", // previews antigas
  "gemini-1.5-flash-latest",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "graphify-out" || entry === "__tests__") continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.ts$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

describe("IA · nenhum modelo Gemini descontinuado hardcoded", () => {
  const files = walk(SERVER_DIR);

  it("varre a árvore server/ (sanidade: encontrou arquivos)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("nenhum arquivo hardcoda um modelo morto em `model: \"...\"`", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const dead of DEAD_MODELS) {
        // Só conta como uso hardcoded se aparecer como valor de `model:` (chamada de API),
        // não em comentários explicativos.
        const re = new RegExp(`model:\\s*["']${dead.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`);
        for (const line of src.split("\n")) {
          if (re.test(line)) offenders.push(`${path.relative(process.cwd(), file)} → ${line.trim()}`);
        }
      }
    }
    expect(offenders, `Modelo Gemini morto hardcodado:\n${offenders.join("\n")}\nUse AI_CONFIG.model.`).toEqual([]);
  });
});

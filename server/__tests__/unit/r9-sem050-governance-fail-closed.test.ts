/**
 * R9 / SEM-050 — governança de Itens da contratação FAIL-CLOSED (guarda ESTRUTURAL; o comportamento com leitura
 * falhando está em r10-sem050-governance-read-unknown.test.ts).
 * Antes: `loadGovernance` engolia erros (`.catch(() => null)`) ⇒ "nada emitido/consumido" ⇒ mudança classificada como
 * "define". Agora `loadGovernance` nunca engole (nem para leitura): a leitura do workspace usa
 * `readGovernanceForDisplay` (estado DESCONHECIDO ⇒ travado); escritas usam `ctxForWrite` (sem catch).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const src = readFileSync(path.resolve(import.meta.dirname, "../../services/procurementItemsService.ts"), "utf8");
const body = (name: string) => {
  const start = src.indexOf(`async function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const next = src.indexOf("\nasync function ", start + 10);
  const nextExport = src.indexOf("\nexport ", start + 10);
  const end = [next, nextExport].filter((x) => x > 0).sort((a, b) => a - b)[0] ?? src.length;
  return src.slice(start, end);
};

describe("R9 / SEM-050 — governança fail-closed", () => {
  it("loadGovernance NUNCA engole erro (nem no modo de leitura — não existe mais displayOnly)", () => {
    const b = body("loadGovernance");
    expect(b).not.toMatch(/\.catch\(/);
    expect(b).not.toMatch(/displayOnly/);
    expect(src).not.toMatch(/displayOnly/);
  });

  it("ctxForWrite não engole erro", () => {
    expect(body("ctxForWrite")).not.toMatch(/\.catch\(/);
  });

  it("escritas governadas usam ctxForWrite; só a leitura do workspace usa ctxOrNull + readGovernanceForDisplay", () => {
    expect(src.match(/ctxOrNull\(/g)?.length).toBe(2); // definição + leitura do workspace
    expect(src.match(/readGovernanceForDisplay\(/g)?.length).toBe(2); // definição + leitura do workspace
    expect(src.match(/ctxForWrite\(a, tx\)/g)?.length).toBe(3);
  });
});

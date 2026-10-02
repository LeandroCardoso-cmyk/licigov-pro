/**
 * R9 / SEM-050 — governança de Itens da contratação FAIL-CLOSED nas escritas.
 * Antes: `loadGovernance` engolia erros (`.catch(() => null)`) ⇒ "nada emitido/consumido" ⇒ mudança classificada como
 * "define". Agora só a leitura do workspace (`displayOnly`) degrada; escritas usam `ctxForWrite` (sem catch).
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
  it("loadGovernance só tolera erro no modo displayOnly", () => {
    const b = body("loadGovernance");
    expect(b).toMatch(/opts\.displayOnly \? p\.catch\(\(\) => null\) : p/);
    expect(b.replace(/opts\.displayOnly \? p\.catch\(\(\) => null\) : p/, "")).not.toMatch(/\.catch\(/);
  });

  it("ctxForWrite não engole erro", () => {
    expect(body("ctxForWrite")).not.toMatch(/\.catch\(/);
  });

  it("escritas governadas usam ctxForWrite; displayOnly só na leitura do workspace", () => {
    expect(src.match(/ctxOrNull\(/g)?.length).toBe(2); // definição + leitura do workspace
    expect(src.match(/displayOnly: true/g)?.length).toBe(1);
    expect(src.match(/ctxForWrite\(a, tx\)/g)?.length).toBe(3);
  });
});

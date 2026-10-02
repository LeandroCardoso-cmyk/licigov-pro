/**
 * NEW-028 — enquanto o vocabulário de status não tiver "não ratificado" (HD-09), o `status` do workspace da
 * contratação direta pode continuar "ratificado" depois de uma decisão superveniente "não ratificado". Guard: nenhuma
 * regra do servidor decide pelo `status` — a publicação lê a DECISÃO VIGENTE do ledger, e a UI exibe a decisão vigente.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (f === "__tests__" || f === "node_modules") return [];
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const SERVER = walk(join(ROOT, "server"));
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("NEW-028 — decisão vigente do ledger é a autoridade da ratificação", () => {
  it("nenhum código do servidor compara o status do workspace com 'ratificado' para decidir", () => {
    const hits = SERVER.filter((f) => /status\s*===?\s*["']ratificado["']|["']ratificado["']\s*===?\s*\w*\.?status|directProcurementWorkspacesTable\.status\s*,\s*["']ratificado["']/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it("a publicação lê a decisão VIGENTE do ledger e exige outcome 'ratificado'", () => {
    const src = read("server/services/directProcurementService.ts");
    const fn = src.slice(src.indexOf("export async function generatePublications"), src.indexOf("function buildRatificationContent"));
    expect(fn).toContain('getCurrentDecision(null, params.organizationId, "direct_procurement.ratification", ws.id)');
    expect(fn).toContain('ratification.outcome !== "ratificado"');
  });
  it("a tela de ratificação exibe a decisão vigente (revisão) do ledger", () => {
    const ui = read("client/src/components/direct-procurement/RatificationWorkspace.tsx");
    expect(ui).toContain("getRatificationDecision");
    expect(ui).toContain("Decisão atual (revisão {current.revision}):");
  });
});

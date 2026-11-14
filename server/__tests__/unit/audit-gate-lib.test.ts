/**
 * SEC-AUD-2026-10 — gate de auditoria de dependências fail-closed quanto ao formato.
 *
 * Antes: `Object.values(audit.advisories || {})` — uma saída de erro do registry (sem `advisories`)
 * virava "0 advisories" e o gate aprovava. Agora a forma é validada antes da comparação com o baseline.
 */
import { describe, it, expect } from "vitest";
// @ts-expect-error — módulo .mjs sem declaração de tipos (script de CI)
import { auditShapeError, evaluateAudit } from "../../../scripts/audit-gate-lib.mjs";

const validAudit = (advisories: Record<string, unknown>) => ({
  actions: [],
  advisories,
  muted: [],
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0 } },
});

describe("audit-gate · formato da saída do pnpm audit (fail-closed)", () => {
  it("recusa saída de erro do registry (sem advisories)", () => {
    expect(auditShapeError({ error: { code: "ERR_PNPM_AUDIT_BAD_RESPONSE" } })).not.toBeNull();
  });

  it("recusa objeto vazio, array, null e ausência de metadata", () => {
    expect(auditShapeError({})).not.toBeNull();
    expect(auditShapeError([])).not.toBeNull();
    expect(auditShapeError(null)).not.toBeNull();
    expect(auditShapeError({ advisories: {} })).not.toBeNull();
  });

  it("aceita a forma válida, inclusive sem nenhuma advisory", () => {
    expect(auditShapeError(validAudit({}))).toBeNull();
  });
});

describe("audit-gate · comparação com o baseline", () => {
  const audit = validAudit({
    "1": { github_advisory_id: "GHSA-aaaa-aaaa-aaaa", severity: "high", module_name: "a" },
    "2": { github_advisory_id: "GHSA-bbbb-bbbb-bbbb", severity: "critical", module_name: "b" },
    "3": { github_advisory_id: "GHSA-cccc-cccc-cccc", severity: "moderate", module_name: "c" },
  });

  it("aponta como NOVA a high/critical fora do baseline e ignora moderate", () => {
    const r = evaluateAudit(audit, ["GHSA-aaaa-aaaa-aaaa"]);
    expect(r.fresh.map((f: { ghsa: string }) => f.ghsa)).toEqual(["GHSA-bbbb-bbbb-bbbb"]);
    expect(r.found.has("GHSA-cccc-cccc-cccc")).toBe(false);
  });

  it("lista entradas do baseline já resolvidas como stale", () => {
    const r = evaluateAudit(audit, ["GHSA-aaaa-aaaa-aaaa", "GHSA-bbbb-bbbb-bbbb", "GHSA-zzzz-zzzz-zzzz"]);
    expect(r.fresh).toEqual([]);
    expect(r.stale).toEqual(["GHSA-zzzz-zzzz-zzzz"]);
  });
});

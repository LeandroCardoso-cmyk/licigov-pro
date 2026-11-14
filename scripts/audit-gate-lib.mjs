/**
 * Lógica pura do gate de auditoria de dependências (scripts/audit-gate.mjs), separada para teste.
 *
 * SEC-AUD-2026-10 — o gate passa a ser FAIL-CLOSED quanto ao formato: antes, uma saída do
 * `pnpm audit --json` sem `advisories` (ex.: erro do registry devolvido como JSON) era lida
 * como "0 advisories" e o gate APROVAVA. Agora a saída precisa ter o formato esperado
 * (`advisories` objeto + `metadata.vulnerabilities`), senão o gate falha (exit 2).
 */

export const BLOCKING_SEVERITIES = new Set(["critical", "high"]);

/** Valida o formato do JSON do `pnpm audit`. Retorna motivo da recusa ou null quando válido. */
export function auditShapeError(audit) {
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) return "saída não é um objeto JSON";
  if (audit.error) return "pnpm audit devolveu erro";
  if (!audit.advisories || typeof audit.advisories !== "object" || Array.isArray(audit.advisories)) {
    return "campo `advisories` ausente ou inválido";
  }
  const v = audit.metadata && audit.metadata.vulnerabilities;
  if (!v || typeof v !== "object") return "campo `metadata.vulnerabilities` ausente";
  return null;
}

/**
 * Compara as advisories high/critical com o baseline.
 * Retorna as GHSA bloqueantes encontradas, as NOVAS (fora do baseline) e as do baseline já resolvidas.
 */
export function evaluateAudit(audit, allowed) {
  const baseline = new Set(allowed || []);
  const blocking = Object.values(audit.advisories)
    .filter((a) => BLOCKING_SEVERITIES.has(a.severity))
    .map((a) => ({ ghsa: a.github_advisory_id || String(a.id), sev: a.severity, mod: a.module_name }));
  const unique = new Set(blocking.map((b) => b.ghsa));
  const fresh = [...unique].filter((g) => !baseline.has(g)).map((g) => blocking.find((b) => b.ghsa === g));
  const stale = [...baseline].filter((g) => !unique.has(g));
  return { found: unique, fresh, stale };
}

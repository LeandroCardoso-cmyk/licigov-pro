/**
 * Template Governance V2 — marco de transição do padrão de política jurídica dos modelos.
 *
 * Órgãos SEM política registrada e SEM modelos criados antes deste instante recebem o padrão da plataforma (evidência jurídica OPCIONAL).
 * Órgãos que já tinham modelos antes dele continuam, até decidirem, no regime anterior (REQUIRED — `LEGACY_COMPAT`), de forma visível e auditável.
 *
 * `TEMPLATE_LEGACY_POLICY_CUTOVER_AT` (ISO-8601, opcional) permite ao operador fixar o instante exato do deploy; valor inválido ⇒ falha fechada
 * (o valor padrão do código é usado e o fato é sinalizado em `source`), nunca um valor "adivinhado".
 */
export const TEMPLATE_LEGACY_POLICY_CUTOVER_DEFAULT_AT = "2026-10-14T00:00:00.000Z";

export interface TemplateGovernanceConfig {
  readonly legacyCutoverAt: string;
  readonly source: "DEFAULT" | "ENV" | "ENV_INVALID_FELL_BACK";
}

export function getTemplateGovernanceConfig(env: Readonly<Record<string, string | undefined>> = process.env): TemplateGovernanceConfig {
  const raw = env.TEMPLATE_LEGACY_POLICY_CUTOVER_AT?.trim();
  if (!raw) return { legacyCutoverAt: TEMPLATE_LEGACY_POLICY_CUTOVER_DEFAULT_AT, source: "DEFAULT" };
  const t = Date.parse(raw);
  return Number.isNaN(t) || !/^\d{4}-\d{2}-\d{2}T/.test(raw)
    ? { legacyCutoverAt: TEMPLATE_LEGACY_POLICY_CUTOVER_DEFAULT_AT, source: "ENV_INVALID_FELL_BACK" }
    : { legacyCutoverAt: new Date(t).toISOString(), source: "ENV" };
}

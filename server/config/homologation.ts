import { APP_ENV, type AppEnv } from "./env";

/**
 * M8 — EXCEÇÃO CONTROLADA de homologação para valores DEMONSTRATIVOS (política aprovada pelo Owner em 20/10/2026).
 *
 * Cotações fictícias nunca fundamentam referência institucional nem documento oficial de órgão REAL. A exceção só
 * permite exercitar a jornada (referência demonstrativa nos rascunhos e emissão do documento de homologação) numa
 * organização sintética EXPRESSAMENTE autorizada. Condições CUMULATIVAS, todas avaliadas no backend:
 *   1. ambiente NÃO produtivo (`APP_ENV` ≠ production — em produção a lista é ignorada);
 *   2. o id da organização consta da configuração administrativa `HOMOLOGATION_DEMONSTRATIVE_ORG_IDS` (ids separados
 *      por vírgula; ausente/vazia ⇒ nenhuma exceção — fail-closed);
 *   3. a organização NÃO é a 1 (dados reais de Moreira Sales) — recusada sempre, qualquer que seja a configuração;
 *   4. o slug REAL da organização, lido no banco, é exatamente `homologacao-sintetica` (confirmação adicional, nunca a
 *      única autorização).
 * Nenhum parâmetro do cliente participa. A configuração é lida UMA vez no boot (não muda em runtime).
 */
export const HOMOLOGATION_DEMONSTRATIVE_ORG_IDS_ENV_KEY = "HOMOLOGATION_DEMONSTRATIVE_ORG_IDS";
export const HOMOLOGATION_SYNTHETIC_SLUG = "homologacao-sintetica";
/** Organização com dados reais (Moreira Sales): nunca recebe a exceção. */
export const PROTECTED_REAL_ORGANIZATION_ID = 1;

/** Lê a lista de ids (inteiros positivos). Entrada inválida é descartada item a item. Puro/testável. */
export function parseHomologationOrgIds(raw: string | undefined): readonly number[] {
  return Object.freeze([...new Set((raw ?? "").split(",").map((v) => v.trim()).filter((v) => /^\d+$/.test(v)).map(Number).filter((n) => n > 0))]);
}

/** Decide a exceção para uma organização (identidade REAL já lida no banco). Puro/testável. Default fail-closed. */
export function homologationDemonstrativeAllowed(p: {
  appEnv: AppEnv; allowedOrgIds: readonly number[]; organization: { id: number; slug: string | null } | null;
}): boolean {
  const org = p.organization;
  if (!org || p.appEnv === "production") return false;
  if (org.id === PROTECTED_REAL_ORGANIZATION_ID) return false;
  if (!p.allowedOrgIds.includes(org.id)) return false;
  return org.slug === HOMOLOGATION_SYNTHETIC_SLUG;
}

export const HOMOLOGATION_CONFIG: Readonly<{ appEnv: AppEnv; allowedOrgIds: readonly number[] }> = Object.freeze({
  appEnv: APP_ENV,
  allowedOrgIds: APP_ENV === "production" ? Object.freeze([]) : parseHomologationOrgIds(process.env[HOMOLOGATION_DEMONSTRATIVE_ORG_IDS_ENV_KEY]),
});

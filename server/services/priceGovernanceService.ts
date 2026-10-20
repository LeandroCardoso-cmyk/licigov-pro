/**
 * M8 — GOVERNANÇA DOS PREÇOS DE REFERÊNCIA (política aprovada pelo Owner em 20/10/2026, alternativa D).
 *
 * Ponto único de decisão consultado por: contexto canônico (referência de DFD/ETP/TR/Edital IA/Edital BLL e telas),
 * contexto legado de autoria, precondições de EMISSÃO oficial e Justificativa de Preço da Contratação Direta.
 * Determinístico, auditável e sem IA. A exceção de homologação vem só do backend (`server/config/homologation.ts`).
 */
import { HOMOLOGATION_CONFIG, homologationDemonstrativeAllowed } from "../config/homologation";
import { getOrganizationById } from "../db/organizations";

/** Overrides de TESTE (suíte isolada): ids autorizados e ambiente simulados. Nunca configurados em produção. */
let testOverride: { allowedOrgIds: readonly number[]; appEnv?: "development" | "staging" | "production" } | null = null;
export function __setHomologationConfigForTests(o: typeof testOverride): void { testOverride = o; }

/**
 * A organização pode usar valores DEMONSTRATIVOS como se fossem referência (somente homologação autorizada)?
 * Sem configuração ⇒ `false` sem consulta ao banco (fail-closed).
 */
export async function demonstrativePricesAllowed(organizationId: number): Promise<boolean> {
  const cfg = testOverride
    ? { appEnv: testOverride.appEnv ?? HOMOLOGATION_CONFIG.appEnv, allowedOrgIds: testOverride.allowedOrgIds }
    : HOMOLOGATION_CONFIG;
  if (cfg.allowedOrgIds.length === 0 || !cfg.allowedOrgIds.includes(organizationId)) return false;
  const org = await getOrganizationById(organizationId).catch(() => null);
  return homologationDemonstrativeAllowed({
    appEnv: cfg.appEnv, allowedOrgIds: cfg.allowedOrgIds,
    organization: org ? { id: org.id, slug: org.slug ?? null } : null,
  });
}

/**
 * Decisão ÚNICA do preço de um Item Inteligente fora do contexto canônico (modo legado de ETP/TR/Edital e emissão):
 * devolve o predicado "o preço deste item está suspenso por fonte fictícia?". Só consulta a exceção quando há fictícia.
 */
export async function fictitiousPriceBlocker(
  organizationId: number, items: ReadonlyArray<{ fictitiousQuoteCount: number }>,
): Promise<(item: { fictitiousQuoteCount: number }) => boolean> {
  if (!items.some((i) => i.fictitiousQuoteCount > 0)) return () => false;
  const allowed = await demonstrativePricesAllowed(organizationId);
  return (item) => item.fictitiousQuoteCount > 0 && !allowed;
}

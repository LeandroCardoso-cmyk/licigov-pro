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
  const cfg = effectiveConfig();
  if (cfg.allowedOrgIds.length === 0 || !cfg.allowedOrgIds.includes(organizationId)) return false;
  const org = await getOrganizationById(organizationId).catch(() => null);
  return demonstrativePricesAllowedForOrganization(org ? { id: org.id, slug: org.slug ?? null } : null);
}

/**
 * Mesma decisão, para a organização JÁ LIDA no banco pelo chamador (sem nova consulta). Usada pelo pré-flight da homologação
 * (`organizations.getCurrent`, só manager+ do PRÓPRIO tenant): permite saber, ANTES de qualquer escrita, se a jornada de emissão
 * com valores demonstrativos é possível — sem expor a lista configurada nem o nome da variável.
 */
export function demonstrativePricesAllowedForOrganization(org: { id: number; slug: string | null } | null): boolean {
  const cfg = effectiveConfig();
  return homologationDemonstrativeAllowed({ appEnv: cfg.appEnv, allowedOrgIds: cfg.allowedOrgIds, organization: org });
}

/** Papéis que EMITEM (manager+) — os únicos que recebem a projeção do pré-flight. */
const PREFLIGHT_ROLES = new Set(["manager", "admin", "owner"]);

/**
 * Projeção SOMENTE LEITURA para o pré-flight da homologação (servida por `organizations.getCurrent`): a decisão continua aqui, no
 * backend; o router apenas repassa o resultado — nenhum parâmetro do cliente participa e nenhum router decide ou habilita a
 * exceção (invariante [36]). Abaixo de manager ⇒ null.
 */
export function priceGovernancePreflight(org: { id: number; slug: string | null } | null, role: string | null | undefined): { demonstrativePricesAllowed: boolean } | null {
  if (!PREFLIGHT_ROLES.has(role ?? "")) return null;
  return { demonstrativePricesAllowed: demonstrativePricesAllowedForOrganization(org) };
}

function effectiveConfig(): { appEnv: typeof HOMOLOGATION_CONFIG.appEnv; allowedOrgIds: readonly number[] } {
  return testOverride
    ? { appEnv: testOverride.appEnv ?? HOMOLOGATION_CONFIG.appEnv, allowedOrgIds: testOverride.allowedOrgIds }
    : HOMOLOGATION_CONFIG;
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

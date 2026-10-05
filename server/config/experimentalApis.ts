import { APP_ENV, type AppEnv } from "./env";

/**
 * R2 / LEG-028 — capability das APIs experimentais EM MEMÓRIA (sem banco).
 *
 * Decisão humana (inventário R2.1, `docs/audits/R2_LEGACY_REACHABILITY_INVENTORY.md`): **DISABLE EM PRODUÇÃO**.
 * Os routers experimentais (`itemTr`, `reviewWorkspace`, `trComposition`, `approvalWorkflow`,
 * `collaborationComments`, `exports`, `structuredExports`, `webhooks`, `clauses`, `pilotReadiness`,
 * `productionReadiness`, `itemAnalytics`) guardam estado em `Map`/array de processo ou devolvem mock, e vários
 * recebem `organizationId` do cliente — nunca podem ser superfície institucional.
 *
 * Regra (fail-closed, avaliada UMA vez no boot — não muda em runtime):
 *  - `production` e `staging` ⇒ SEMPRE desligadas (nenhuma flag as liga);
 *  - `development` (inclui a suíte de testes, que roda com APP_ENV=development) ⇒ desligadas por padrão; só
 *    ligam com o opt-in EXPLÍCITO `EXPERIMENTAL_IN_MEMORY_APIS_ENABLED=true`.
 */
export const EXPERIMENTAL_IN_MEMORY_APIS_ENV_KEY = "EXPERIMENTAL_IN_MEMORY_APIS_ENABLED";

/** Lê o opt-in explícito. Qualquer valor diferente de "true" (case-insensitive) ⇒ false. Puro/testável. */
export function resolveExperimentalInMemoryApisOptIn(env: { EXPERIMENTAL_IN_MEMORY_APIS_ENABLED?: string }): boolean {
  return (env.EXPERIMENTAL_IN_MEMORY_APIS_ENABLED ?? "").trim().toLowerCase() === "true";
}

/** Decide se as APIs experimentais em memória podem atender chamadas. Puro/testável. Default fail-closed. */
export function experimentalInMemoryApisAllowed(opts: { appEnv: AppEnv; optIn: boolean }): boolean {
  return opts.appEnv === "development" && opts.optIn === true;
}

const OPT_IN = resolveExperimentalInMemoryApisOptIn({
  EXPERIMENTAL_IN_MEMORY_APIS_ENABLED: process.env.EXPERIMENTAL_IN_MEMORY_APIS_ENABLED,
});

export const EXPERIMENTAL_API_CONFIG: Readonly<{ appEnv: AppEnv; optIn: boolean; allowed: boolean }> = Object.freeze({
  appEnv: APP_ENV,
  optIn: OPT_IN,
  allowed: experimentalInMemoryApisAllowed({ appEnv: APP_ENV, optIn: OPT_IN }),
});

/**
 * A3-RD1 — orquestrador CANÔNICO de PRE-DEPLOY do release.
 *
 * Uso:  pnpm db:release:predeploy   (Railway Pre-Deploy Command; ver docs/ops/MIGRATION_RELEASE_RUNBOOK.md)
 *
 * SCHEMA MIGRATION e REFERENCE DATA INSTALLATION são passos DISTINTOS (separação de
 * responsabilidades da Fase B). Este orquestrador roda os dois em ORDEM e FAIL-CLOSED,
 * SEM transformar `migrate-release` em seed runner:
 *   1) [migrate]        migrations versionadas (reusa `migrate-release.main()`) — schema only;
 *   2) [reference-data] instalação governada replay-safe (reusa `install-reference-data.main()`)
 *                       — executada SOMENTE após (1) concluir com sucesso.
 *
 * Contrato:
 *   - instalar ≠ ativar: o reference set entra como `draft` (ativação é aprovação humana separada);
 *   - qualquer falha → exit != 0 e a aplicação NÃO inicia (o passo seguinte não executa);
 *   - determinístico/replay-safe (herda o ledger do Drizzle e o installer por hash);
 *   - nenhuma aprovação automática do set;
 *   - NÃO loga DATABASE_URL/segredos.
 *
 * Reusa as funções `main()` já existentes (em vez de spawnar shells) para preservar erros e testes.
 */
import { main as migrateRelease } from "./migrate-release";
import { main as installReferenceData } from "./install-reference-data";

function defaultLog(msg: string): void {
  console.info(`[RELEASE][predeploy] ${msg}`);
}

export interface PredeployDeps {
  /** Passo 1 — migrations versionadas (schema only). */
  migrate: () => Promise<void>;
  /** Passo 2 — instalação governada do reference data (replay-safe, draft). */
  installReference: () => Promise<void>;
  log?: (msg: string) => void;
}

/**
 * Orquestração PURA e injetável (testável sem DB): migrations → (só em sucesso) reference-data.
 * Fail-closed: se o passo 1 lançar, o passo 2 NUNCA executa e o erro é propagado.
 */
export async function runPredeploy(deps: PredeployDeps): Promise<void> {
  const log = deps.log ?? defaultLog;
  const startedAt = Date.now();
  log("Iniciando PRE-DEPLOY (migrations → reference-data governada; instalar ≠ ativar)…");

  log("Passo 1/2 — migrations versionadas…");
  await deps.migrate(); // fail-closed: se lançar, o passo 2 NÃO executa
  log("Passo 1/2 concluído.");

  log("Passo 2/2 — instalação governada do reference data (replay-safe, draft)…");
  await deps.installReference();
  log("Passo 2/2 concluído.");

  log(
    `PRE-DEPLOY concluído em ${Date.now() - startedAt}ms ` +
      `(schema aplicado + reference set instalado como draft; NÃO ativado).`,
  );
}

export async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    // Nunca imprime o valor — apenas a ausência.
    throw new Error("DATABASE_URL não definida — impossível executar o pre-deploy de release.");
  }
  await runPredeploy({ migrate: migrateRelease, installReference: installReferenceData });
}

// Só executa quando invocado como script (não quando importado por um teste ou por outro release step).
const invokedDirectly =
  typeof process.argv[1] === "string" && /predeploy-release(\.ts|\.js|\.mts)?$/.test(process.argv[1]);

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[RELEASE][predeploy] FALHA: ${message}`);
      process.exit(1);
    });
}

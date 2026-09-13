/**
 * A3-RD1 — comando de RELEASE para INSTALAÇÃO de reference data governada.
 *
 * Uso:  pnpm db:install:reference   (rodar no RELEASE/PRE-DEPLOY, APÓS `pnpm db:migrate:release`)
 *
 * SCHEMA MIGRATION e REFERENCE DATA INSTALLATION são operações DISTINTAS, mesmo orquestradas pelo
 * mesmo release. Este passo NÃO altera schema e NÃO é um seed manual: instala o reference set V1
 * (Lei 14.133/2021) de forma REPLAY-SAFE (INSERT / no-op por hash / fail-closed em divergência),
 * a partir da FONTE ÚNICA `server/domain/legalReference/manifestV1.ts`.
 *
 * Contrato:
 *   - instalar ≠ ativar: o set entra como `draft` (ativação é aprovação humana separada);
 *   - idempotente/replay-safe (mesmo hash → no-op; hash divergente na mesma versão → falha);
 *   - NÃO inicia a aplicação; NÃO roda no boot/request/cron; NÃO expõe endpoint;
 *   - falha (exit != 0) se a instalação falhar — erro nunca engolido;
 *   - NÃO loga DATABASE_URL/segredos.
 */
import { installGovernedLegalReferenceV1 } from "../server/db/legalReference";

function log(msg: string): void {
  console.info(`[RELEASE][reference-data] ${msg}`);
}

export async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL não definida — impossível instalar reference data.");

  const startedAt = Date.now();
  log("Instalando reference set V1 (Lei 14.133/2021) — replay-safe, draft…");
  const result = await installGovernedLegalReferenceV1();
  log(`Resultado: ${result.action}${result.setId ? ` (setId=${result.setId})` : ""}; contentHash=${result.referenceSetContentHash}.`);
  log(`Instalação de reference data concluída em ${Date.now() - startedAt}ms.`);
}

const invokedDirectly =
  typeof process.argv[1] === "string" && /install-reference-data(\.ts|\.js|\.mts)?$/.test(process.argv[1]);

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[RELEASE][reference-data] FALHA: ${message}`);
      process.exit(1);
    });
}

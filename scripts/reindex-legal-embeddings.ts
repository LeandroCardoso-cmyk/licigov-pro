/**
 * F-EMB1 — CLI one-shot de reindexação do corpus jurídico global.
 *
 * Exemplos:
 *   pnpm db:embedding:reindex -- --dry-run --environment staging
 *   pnpm db:embedding:reindex -- --apply --environment staging --run-id <uuid>
 *
 * Produção possui um segundo acknowledgement operacional:
 *   --production-approved
 * A flag NÃO substitui o gate humano/owner; apenas impede execução produtiva acidental.
 * Este script nunca executa no import, no boot ou em scheduler.
 */
import {
  getEmbeddingReindexRepository,
  runEmbeddingReindex,
  toSafeReindexErrorCode,
  type EmbeddingReindexMode,
} from "../server/services/embeddingReindex";

export interface ReindexCliArgs {
  mode: EmbeddingReindexMode;
  environment: string;
  runId?: string;
  productionApproved: boolean;
}

function parseMap(argv: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const equalsIndex = arg.indexOf("=");
    if (equalsIndex >= 0) {
      map.set(arg.slice(2, equalsIndex), arg.slice(equalsIndex + 1));
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      map.set(key, "true");
    } else {
      map.set(key, next);
      index += 1;
    }
  }
  return map;
}

export function parseReindexArgs(argv: readonly string[]): ReindexCliArgs {
  const map = parseMap(argv);
  const dryRun = map.has("dry-run");
  const apply = map.has("apply");
  if (dryRun === apply) {
    throw new Error("EMBEDDING_REINDEX_MODE_REQUIRED");
  }

  const environment = map.get("environment")?.trim();
  if (!environment) throw new Error("EMBEDDING_REINDEX_ENVIRONMENT_REQUIRED");
  if (!new Set(["staging", "production"]).has(environment)) {
    throw new Error("EMBEDDING_REINDEX_ENVIRONMENT_NOT_ALLOWED");
  }

  const runId = map.get("run-id")?.trim() || undefined;
  if (apply && !runId) throw new Error("EMBEDDING_REINDEX_RUN_ID_REQUIRED");
  if (dryRun && runId) throw new Error("EMBEDDING_REINDEX_DRY_RUN_ID_NOT_ALLOWED");

  const productionApproved = map.has("production-approved");
  if (environment === "production" && !productionApproved) {
    throw new Error("EMBEDDING_REINDEX_PRODUCTION_APPROVAL_REQUIRED");
  }
  if (environment !== "production" && productionApproved) {
    throw new Error("EMBEDDING_REINDEX_PRODUCTION_FLAG_INVALID");
  }

  return {
    mode: dryRun ? "dry-run" : "apply",
    environment,
    runId,
    productionApproved,
  };
}

export async function main(): Promise<void> {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("EMBEDDING_REINDEX_DATABASE_URL_MISSING");
  }

  const args = parseReindexArgs(process.argv.slice(2));
  const appEnvironment = process.env.APP_ENV?.trim();
  if (!appEnvironment || appEnvironment !== args.environment) {
    throw new Error("EMBEDDING_REINDEX_ENVIRONMENT_MISMATCH");
  }

  const repository = await getEmbeddingReindexRepository();
  const result = await runEmbeddingReindex(
    {
      mode: args.mode,
      environment: args.environment,
      runId: args.runId,
    },
    { repository },
  );

  if (result.status === "failed") {
    throw new Error(result.errorCode ?? "EMBEDDING_REINDEX_OPERATION_FAILED");
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string"
  && /reindex-legal-embeddings(\.ts|\.js|\.mts)?$/.test(process.argv[1]);

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      // Nunca imprime mensagem arbitrária do driver/provider. Somente código sanitizado.
      console.error(`[F-EMB1] reindex_failed code=${toSafeReindexErrorCode(error)}`);
      process.exit(1);
    });
}

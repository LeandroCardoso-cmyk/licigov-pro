import { materializeGovernedLawCorpus } from "../server/services/governedLawCorpusMaterializer";

type Environment = "staging" | "production";
type Mode = "dry-run" | "apply";

export interface MaterializeCliOptions {
  mode: Mode;
  environment: Environment;
  asOfDate: string;
  runId?: string;
  productionApproved: boolean;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseArgs(args: string[]): MaterializeCliOptions {
  const dryRun = args.includes("--dry-run");
  const apply = args.includes("--apply");
  if (dryRun === apply) throw new Error("GOVERNED_LAW_CORPUS_MODE_REQUIRED");

  const environment = valueAfter(args, "--environment");
  if (environment !== "staging" && environment !== "production") {
    throw new Error("GOVERNED_LAW_CORPUS_ENVIRONMENT_INVALID");
  }

  const asOfDate = valueAfter(args, "--as-of-date");
  if (!asOfDate || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error("GOVERNED_LAW_CORPUS_AS_OF_DATE_REQUIRED");
  }

  const runId = valueAfter(args, "--run-id");
  const productionApproved = args.includes("--production-approved");
  const mode: Mode = apply ? "apply" : "dry-run";

  if (mode === "apply" && !runId) throw new Error("GOVERNED_LAW_CORPUS_RUN_ID_REQUIRED");
  if (mode === "dry-run" && runId) throw new Error("GOVERNED_LAW_CORPUS_DRY_RUN_FORBIDS_RUN_ID");
  if (environment === "production" && !productionApproved) {
    throw new Error("GOVERNED_LAW_CORPUS_PRODUCTION_APPROVAL_FLAG_REQUIRED");
  }
  if (environment === "staging" && productionApproved) {
    throw new Error("GOVERNED_LAW_CORPUS_STAGING_REJECTS_PRODUCTION_FLAG");
  }

  return { mode, environment, asOfDate, runId, productionApproved };
}

export function validateRuntimeEnvironment(options: MaterializeCliOptions): void {
  const appEnv = process.env.APP_ENV?.trim();
  if (appEnv !== options.environment) {
    throw new Error("GOVERNED_LAW_CORPUS_APP_ENV_MISMATCH");
  }
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("GOVERNED_LAW_CORPUS_DATABASE_URL_REQUIRED");
  }
  if (options.mode === "apply" && !process.env.GEMINI_API_KEY?.trim()) {
    throw new Error("GOVERNED_LAW_CORPUS_PROVIDER_NOT_CONFIGURED");
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  validateRuntimeEnvironment(options);

  const result = await materializeGovernedLawCorpus({
    mode: options.mode,
    environment: options.environment,
    asOfDate: options.asOfDate,
    runId: options.runId,
  });

  console.info(
    `[F-RAG1] status=completed mode=${result.mode} environment=${options.environment}`
      + ` setId=${result.referenceSetId} setVersion=${result.referenceSetVersion}`
      + ` hash=${result.referenceSetContentHash.slice(0, 12)}`
      + ` total=${result.totalEntries} existing=${result.alreadyMaterialized}`
      + ` materialized=${result.materialized} replayed=${result.replayed}`,
  );
}

const invokedDirectly =
  typeof process.argv[1] === "string"
  && /materialize-governed-law-corpus(\.ts|\.js|\.mts)?$/.test(process.argv[1]);

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      const code = error instanceof Error && /^[A-Z0-9_:-]{1,100}$/.test(error.message)
        ? error.message
        : error instanceof Error
          ? error.name
          : "GOVERNED_LAW_CORPUS_UNKNOWN_ERROR";
      console.error(`[F-RAG1] status=failed code=${code}`);
      process.exit(1);
    });
}

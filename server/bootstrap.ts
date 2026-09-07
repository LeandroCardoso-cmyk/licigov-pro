import path from "path";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import type { RowDataPacket } from "mysql2";
import { APP_ENV, ENV_TAG, validateRequiredEnv } from "./config/env";
import { APP_CONFIG } from "./config/app";
import { AWS_CONFIG } from "./config/aws";
import { AI_CONFIG, validateAiRuntime } from "./config/ai";
import { migrateWithAdvisoryLock } from "./db/releaseMigrate";

// process.cwd() is always the project root in both Railway and local dev,
// regardless of how esbuild bundles import.meta.dirname.
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

// ─── Logging helper ───────────────────────────────────────────────────────────

function log(module: string, msg: string): void {
  console.info(`[BOOT]${ENV_TAG}[${module}] ${msg}`);
}

// ─── Step 1: run pending migrations ──────────────────────────────────────────

// Exportada para os smokes MySQL que constroem o schema num banco real (migrate() já é
// suficiente desde a Fase B — a 0297 fechou o schema; não há mais reconciliação em runtime).
// O boot usa `migrateWithAdvisoryLock` (com lock); esta variante sem lock atende aos testes.
export async function runMigrations(connection: mysql.Connection): Promise<void> {
  log("DB", `Executando migrações de: ${MIGRATIONS_FOLDER}`);
  const db = drizzle(connection);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  log("DB", "✓ Migrações aplicadas");
}

// ─── Step 2: validar o schema (NÃO-MUTÁVEL) ──────────────────────────────────
// Fase B (RUNTIME & RELEASE SAFETY): antes, ensureSchema() era um RECONCILIADOR que executava
// DDL (ALTER/CREATE/RENAME) a cada boot para "consertar" o banco em runtime. Isso saiu: TODA
// mudança de schema mora agora em migrations versionadas (a migration 0297 fechou a diferença
// que só existia no reconciliador — ver drizzle/0297_phase_b_schema_closure.sql). Este passo é
// um DETECTOR/VALIDATOR, não um reconciliador:
//   - NÃO executa DDL (nenhum ALTER/CREATE/DROP/RENAME/push/índice) — jamais muta o schema;
//   - confere que o ledger de migrations está aplicado e que estruturas críticas existem;
//   - staging/produção: FALHA FECHADA (fail-closed) se o schema estiver incompatível/atrás — a
//     aplicação não deve ficar online num estado parcialmente compatível;
//   - desenvolvimento: apenas AVISA (um banco local pode legitimamente estar atrasado).

/** Nº de migrations versionadas esperadas (journal do Drizzle). Lido do disco; tolerante a falha. */
function expectedMigrationCount(): number | null {
  try {
    const journalPath = path.join(process.cwd(), "drizzle", "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries?: unknown[] };
    return Array.isArray(journal.entries) ? journal.entries.length : null;
  } catch {
    return null;
  }
}

// Estruturas CRÍTICAS (defesa em profundidade). Não é exaustivo — a completude é coberta pelo
// ledger; aqui garantimos os invariantes de maior valor: multi-tenant, segurança (PR 0) e acesso
// institucional. A ausência de qualquer um indica um schema quebrado/atrás.
const CRITICAL_TABLES: readonly string[] = [
  "users", "organizations", "organization_members", "processes", "documents",
  "audit_logs", "activity_logs", "process_members",
  "institutional_invitations", "password_reset_tokens", "email_outbox",
];
const CRITICAL_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ["users", "passwordHash"], ["users", "tokenVersion"], ["users", "email"],
  ["process_members", "functionalRole"],
  ["processes", "organizationId"], ["documents", "organizationId"], ["activity_logs", "organizationId"],
];

export type SchemaValidationLevel = "ok" | "warn" | "fail";

/**
 * Decisão PURA e testável do validator: schema íntegro → "ok"; incompatível em
 * desenvolvimento → "warn" (banco local pode legitimamente atrasar); incompatível em
 * staging/produção → "fail" (fail-closed: a aplicação não fica online parcialmente compatível).
 */
export function decideSchemaValidation(
  problems: readonly string[],
  isDevelopment: boolean,
): SchemaValidationLevel {
  if (problems.length === 0) return "ok";
  return isDevelopment ? "warn" : "fail";
}

export async function validateSchema(connection: mysql.Connection): Promise<void> {
  type Cnt = { cnt: number };
  const problems: string[] = [];

  async function tableExists(table: string): Promise<boolean> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [table],
    );
    return (rows[0] as Cnt).cnt > 0;
  }
  async function columnExists(table: string, column: string): Promise<boolean> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [table, column],
    );
    return (rows[0] as Cnt).cnt > 0;
  }

  // 1) Completude do ledger de migrations. Sem a tabela de ledger, o schema nunca foi
  //    inicializado por migrations → incompatível. Ledger atrás → migrations pendentes.
  if (!(await tableExists("__drizzle_migrations"))) {
    problems.push("tabela de controle de migrations (__drizzle_migrations) ausente — migrations nunca aplicadas");
  } else {
    const expected = expectedMigrationCount();
    const [ledger] = await connection.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM __drizzle_migrations",
    );
    const applied = (ledger[0] as Cnt).cnt;
    if (expected !== null && applied < expected) {
      problems.push(
        `migrations pendentes: ${applied}/${expected} aplicadas — aplique as migrations (pnpm db:migrate:release) antes de iniciar`,
      );
    }
  }

  // 2) Estruturas críticas.
  for (const t of CRITICAL_TABLES) {
    if (!(await tableExists(t))) problems.push(`tabela crítica ausente: ${t}`);
  }
  for (const [t, c] of CRITICAL_COLUMNS) {
    // Só cobra a coluna se a tabela existe (ausência da tabela já foi registrada acima).
    if ((await tableExists(t)) && !(await columnExists(t, c))) {
      problems.push(`coluna crítica ausente: ${t}.${c}`);
    }
  }

  const level = decideSchemaValidation(problems, APP_CONFIG.isDevelopment);
  if (level === "ok") {
    log("DB", "✓ Schema validado (ledger aplicado + estruturas críticas presentes) — sem mutação em runtime");
    return;
  }

  const detail = problems.map((p) => `  • ${p}`).join("\n");
  const msg =
    `Schema incompatível com o esperado:\n${detail}\n` +
    `Nenhuma correção automática é aplicada em runtime (Fase B — RUNTIME & RELEASE SAFETY). ` +
    `Aplique as migrations versionadas com \`pnpm db:migrate:release\` e reinicie.`;

  if (level === "warn") {
    log("DB", `⚠ ${msg}`);
    return;
  }
  // staging/produção: FAIL-CLOSED — não ficar online em estado parcialmente compatível.
  throw new Error(`[bootstrap]${ENV_TAG} ${msg}`);
}

// ─── PR 0 (Security Emergency Closure) ─────────────────────────────────────────
// O bootstrap de admin de plataforma NÃO roda mais aqui. Antes, `seedAdmin` criava
// ou PROMOVIA a `role='admin'` — a CADA boot, em staging/produção — a conta cujo
// e-mail vinha de `ADMIN_EMAIL` com um default hardcoded para um e-mail pessoal de
// terceiro; e `seedDefaultOrgMembership` dava a TODO usuário `role='admin'` (não só
// o recém-criado) membership `owner` automática na organização 1. Quem controlasse
// esse e-mail (ou recuperasse a senha dele) virava admin de plataforma sem nenhuma
// ação deliberada. Substituído por um comando explícito e fail-closed —
// ver `scripts/bootstrap-admin.ts` (não roda no boot normal; invocação manual).

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs all startup tasks before Express begins accepting requests.
 * Every step is idempotent — safe to call on every deploy.
 */
export async function bootstrap(): Promise<void> {
  // Step 0 — validar variáveis obrigatórias antes de qualquer conexão
  validateRequiredEnv();
  // Modelo de IA: sem allowlist rígida, mas bloqueia formato inválido/vazio e IDs
  // confirmadamente descontinuados — falha explícita no boot em vez de só na 1ª geração.
  validateAiRuntime({ provider: AI_CONFIG.provider, model: AI_CONFIG.model });

  console.info(
    `[BOOT]${ENV_TAG} Iniciando ${APP_CONFIG.name} v${APP_CONFIG.version}` +
    (APP_CONFIG.isStaging    ? " — ⚠️  STAGING" : "") +
    (APP_CONFIG.isDevelopment ? " — DEV"         : "")
  );

  log("CONFIG", `APP_ENV=${APP_ENV} | S3=${AWS_CONFIG.isConfigured ? "✓" : "✗"} | AI=${AI_CONFIG.isConfigured ? "✓" : "✗"} (${AI_CONFIG.provider}/${AI_CONFIG.model})`);

  const databaseUrl = process.env.DATABASE_URL!;
  const connection = await mysql.createConnection(databaseUrl);

  try {
    // RELEASE / MIGRATION STEP — aplica apenas migrations versionadas, sob advisory lock
    // (replay/concorrência-safe). Transitório no boot: quando o Railway Pre-Deploy Command
    // for configurado (Fase X), este passo sai do boot e vira o passo de release externo, e o
    // boot passa a APENAS validar. Ver docs/ops/MIGRATION_RELEASE_RUNBOOK.md.
    await migrateWithAdvisoryLock(connection, (m) => log("RELEASE", m));
    // APPLICATION START — validação NÃO-MUTÁVEL do schema (fail-closed em staging/produção).
    await validateSchema(connection);
  } finally {
    await connection.end();
  }

  log("OK", "Bootstrap concluído. Servidor pronto.");
}

import path from "path";
import bcrypt from "bcrypt";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { users, organizations, organizationMembers } from "../drizzle/schema";
import type { RowDataPacket } from "mysql2";
import { APP_ENV, ENV_TAG, validateRequiredEnv } from "./config/env";
import { APP_CONFIG } from "./config/app";
import { AWS_CONFIG } from "./config/aws";
import { AI_CONFIG } from "./config/ai";

// ─── Config ───────────────────────────────────────────────────────────────────

const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    ?? "cardosomsales@gmail.com";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "Admin@123";
const ADMIN_NAME     = process.env.ADMIN_NAME     ?? "Administrador";

// process.cwd() is always the project root in both Railway and local dev,
// regardless of how esbuild bundles import.meta.dirname.
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

// ─── Logging helper ───────────────────────────────────────────────────────────

function log(module: string, msg: string): void {
  console.info(`[BOOT]${ENV_TAG}[${module}] ${msg}`);
}

// ─── Step 1: run pending migrations ──────────────────────────────────────────

async function runMigrations(connection: mysql.Connection): Promise<void> {
  log("DB", `Executando migrações de: ${MIGRATIONS_FOLDER}`);
  const db = drizzle(connection);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  log("DB", "✓ Migrações aplicadas");
}

// ─── Step 2: ensure critical schema (safety net) ─────────────────────────────
// Guards against schema.ts changes that were never accompanied by a migration
// file. Each check is idempotent and safe to run on every startup.

async function ensureSchema(connection: mysql.Connection): Promise<void> {
  type ColRow = { cnt: number };

  async function addColumnIfMissing(
    table: string,
    column: string,
    definition: string
  ): Promise<void> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME   = ?
         AND COLUMN_NAME  = ?`,
      [table, column]
    );
    if ((rows[0] as ColRow).cnt === 0) {
      await connection.execute(`ALTER TABLE \`${table}\` ADD \`${column}\` ${definition}`);
      log("DB", `✓ Schema corrigido: ${table}.${column} adicionada`);
    }
  }

  // Colunas pré-Sprint 1 (legacy)
  await addColumnIfMissing("users",     "passwordHash",    "varchar(255)");
  await addColumnIfMissing("documents", "sourceType",     "enum('ai','upload') NOT NULL DEFAULT 'ai'");
  await addColumnIfMissing("documents", "s3Key",          "varchar(500)");
  await addColumnIfMissing("documents", "fileUrl",        "varchar(1000)");
  await addColumnIfMissing("documents", "createdBy",      "int");
  await addColumnIfMissing("documents", "documentStatus", "enum('draft','in_review','approved','rejected') NOT NULL DEFAULT 'draft'");

  // Sprint 1 — Multi-tenant columns (zero-gap safety net)
  await addColumnIfMissing("processes",        "organizationId", "int");
  await addColumnIfMissing("documents",        "organizationId", "int");
  await addColumnIfMissing("tasks",            "organizationId", "int");
  await addColumnIfMissing("contracts",        "organizationId", "int");
  await addColumnIfMissing("direct_contracts", "organizationId", "int");
  await addColumnIfMissing("legal_opinions",   "organizationId", "int");
  await addColumnIfMissing("comments",         "organizationId", "int");
  await addColumnIfMissing("activity_logs",    "organizationId", "int");

  // Sprint 1 — Activity logs v2
  await addColumnIfMissing("activity_logs", "correlationId", "varchar(36)");
  await addColumnIfMissing("activity_logs", "requestId",     "varchar(36)");
  await addColumnIfMissing("activity_logs", "actorName",     "varchar(255)");
  await addColumnIfMissing("activity_logs", "entityType",    "varchar(50)");
  await addColumnIfMissing("activity_logs", "entityId",      "int");
}

// ─── Step 3: seed admin user ──────────────────────────────────────────────────

async function seedAdmin(connection: mysql.Connection): Promise<void> {
  log("SEED", "Verificando usuário admin...");
  const db = drizzle(connection);

  const existing = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    if (existing[0].role !== "admin") {
      await db.update(users).set({ role: "admin" }).where(eq(users.email, ADMIN_EMAIL));
      log("SEED", `✓ Admin promovido: ${ADMIN_EMAIL}`);
    } else {
      log("SEED", `✓ Admin já existe: ${ADMIN_EMAIL}`);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await db.insert(users).values({
    openId: nanoid(),
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    role: "admin",
    passwordHash,
    loginMethod: "email",
    theme: "light",
  });
  log("SEED", `✓ Admin criado: ${ADMIN_EMAIL}`);
}

// ─── Step 4: seed admin membership na org padrão ────────────────────────────

async function seedDefaultOrgMembership(connection: mysql.Connection): Promise<void> {
  log("SEED", "Verificando membership do admin na org padrão...");
  const db = drizzle(connection);

  // Verificar se a tabela organizations existe (pode não existir em dev sem migrations)
  const [tables] = await connection.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations'"
  );
  if ((tables[0] as { cnt: number }).cnt === 0) {
    log("SEED", "Tabela organizations não existe ainda — pulando seed de membership");
    return;
  }

  const adminUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, "admin"))
    .limit(10);

  for (const adminUser of adminUsers) {
    const existingMembership = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(and(
        eq(organizationMembers.organizationId, 1),
        eq(organizationMembers.userId, adminUser.id),
      ))
      .limit(1);

    if (existingMembership.length === 0) {
      await db.insert(organizationMembers).values({
        organizationId: 1,
        userId: adminUser.id,
        role: "owner",
        ativo: true,
      });
      log("SEED", `✓ Membership owner criado para admin userId=${adminUser.id} na org padrão`);
    }
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs all startup tasks before Express begins accepting requests.
 * Every step is idempotent — safe to call on every deploy.
 */
export async function bootstrap(): Promise<void> {
  // Step 0 — validar variáveis obrigatórias antes de qualquer conexão
  validateRequiredEnv();

  console.info(
    `[BOOT]${ENV_TAG} Iniciando ${APP_CONFIG.name} v${APP_CONFIG.version}` +
    (APP_CONFIG.isStaging    ? " — ⚠️  STAGING" : "") +
    (APP_CONFIG.isDevelopment ? " — DEV"         : "")
  );

  log("CONFIG", `APP_ENV=${APP_ENV} | S3=${AWS_CONFIG.isConfigured ? "✓" : "✗"} | AI=${AI_CONFIG.isConfigured ? "✓" : "✗"}`);

  const databaseUrl = process.env.DATABASE_URL!;
  const connection = await mysql.createConnection(databaseUrl);

  try {
    await runMigrations(connection);
    await ensureSchema(connection);
    await seedAdmin(connection);
    await seedDefaultOrgMembership(connection);
  } finally {
    await connection.end();
  }

  log("OK", "Bootstrap concluído. Servidor pronto.");
}

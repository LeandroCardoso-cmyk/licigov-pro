import path from "path";
import bcrypt from "bcrypt";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { users } from "../drizzle/schema";
import type { RowDataPacket } from "mysql2";

// ─── Config ───────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = "cardosomsales@gmail.com";
const ADMIN_PASSWORD = "Admin@123";
const ADMIN_NAME = "Administrador";

// process.cwd() is always the project root in both Railway and local dev,
// regardless of how esbuild bundles import.meta.dirname.
const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

// ─── Step 1: run pending migrations ──────────────────────────────────────────

async function runMigrations(connection: mysql.Connection): Promise<void> {
  console.log(`[bootstrap] Running migrations from: ${MIGRATIONS_FOLDER}`);
  const db = drizzle(connection);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("[bootstrap] ✓ DB OK");
}

// ─── Step 2: ensure critical schema (safety net) ─────────────────────────────
// Guards against schema.ts changes that were never accompanied by a migration
// file. Each check is idempotent and safe to run on every startup.

async function ensureSchema(connection: mysql.Connection): Promise<void> {
  // Ensure passwordHash column — added after initial migrations were generated
  const [cols] = await connection.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS cnt
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = 'users'
       AND COLUMN_NAME  = 'passwordHash'`
  );
  if ((cols[0] as { cnt: number }).cnt === 0) {
    await connection.execute("ALTER TABLE `users` ADD `passwordHash` varchar(255)");
    console.log("[bootstrap] ✓ Schema patched: users.passwordHash added");
  }
}

// ─── Step 3: seed admin user ──────────────────────────────────────────────────

async function seedAdmin(connection: mysql.Connection): Promise<void> {
  console.log("[bootstrap] Checking admin user...");
  const db = drizzle(connection);

  const existing = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    if (existing[0].role !== "admin") {
      await db
        .update(users)
        .set({ role: "admin" })
        .where(eq(users.email, ADMIN_EMAIL));
      console.log(`[bootstrap] ✓ Admin OK (${ADMIN_EMAIL} promovido para admin)`);
    } else {
      console.log(`[bootstrap] ✓ Admin OK (${ADMIN_EMAIL} já existe)`);
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

  console.log(`[bootstrap] ✓ Admin OK (${ADMIN_EMAIL} criado)`);
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs all startup tasks before Express begins accepting requests.
 * Every step is idempotent — safe to call on every deploy.
 */
export async function bootstrap(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("[bootstrap] DATABASE_URL is not set. Cannot start server.");
  }

  console.log("[bootstrap] Starting...");
  const connection = await mysql.createConnection(databaseUrl);

  try {
    await runMigrations(connection);
    await ensureSchema(connection);
    await seedAdmin(connection);
  } finally {
    await connection.end();
  }
}

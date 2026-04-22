import { execSync } from "child_process";
import bcrypt from "bcrypt";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { users } from "../drizzle/schema";

// ─── Config ───────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = "cardosomsales@gmail.com";
const ADMIN_PASSWORD = "Admin@123";
const ADMIN_NAME = "Administrador";

// ─── Step 1: sync schema via drizzle-kit push ─────────────────────────────────
// drizzle-kit push reads schema.ts, introspects the live database, and applies
// every missing CREATE TABLE / ALTER TABLE — fully idempotent and covers ALL
// tables, including ones never covered by migration files.
//
// --force auto-approves any data-loss statements (safe here: we only add,
// never drop). stdin=ignore prevents hangs in non-TTY environments like Railway.

async function runPush(): Promise<void> {
  console.log("[bootstrap] Syncing schema with drizzle-kit push...");
  execSync("./node_modules/.bin/drizzle-kit push --force", {
    stdio: ["ignore", "inherit", "inherit"],
    cwd: process.cwd(),
  });
  console.log("[bootstrap] ✓ DB OK");
}

// ─── Step 2: seed admin user ──────────────────────────────────────────────────

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

  // Step 1: sync schema (runs drizzle-kit push, no DB connection needed here)
  await runPush();

  // Step 2: seed admin (opens own connection after schema is guaranteed ready)
  const connection = await mysql.createConnection(databaseUrl);
  try {
    await seedAdmin(connection);
  } finally {
    await connection.end();
  }
}

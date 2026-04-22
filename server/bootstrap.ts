import path from "path";
import bcrypt from "bcrypt";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { users } from "../drizzle/schema";

// ─── Config ───────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = "cardosomsales@gmail.com";
const ADMIN_PASSWORD = "Admin@123";
const ADMIN_NAME = "Administrador";

// In the production bundle (dist/index.js) import.meta.dirname = dist/
// In development (tsx server/_core/index.ts) it resolves to server/
// Either way, ../drizzle points to the project-root drizzle/ folder.
const MIGRATIONS_FOLDER = path.join(import.meta.dirname, "../drizzle");

// ─── Steps ────────────────────────────────────────────────────────────────────

async function runMigrations(connection: mysql.Connection): Promise<void> {
  console.log("[bootstrap] Running database migrations...");
  const db = drizzle(connection);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  console.log("[bootstrap] ✓ DB OK");
}

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
 * Safe to call multiple times — every step is idempotent.
 */
export async function bootstrap(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("[bootstrap] DATABASE_URL is not set. Cannot start server.");
  }

  const connection = await mysql.createConnection(databaseUrl);

  try {
    await runMigrations(connection);
    await seedAdmin(connection);
  } finally {
    await connection.end();
  }
}

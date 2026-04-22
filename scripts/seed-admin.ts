/**
 * Cria o usuário admin inicial se não existir.
 * Idempotente — pode ser executado múltiplas vezes com segurança.
 *
 * Uso:
 *   pnpm tsx scripts/seed-admin.ts
<<<<<<< claude/rebuild-licigov-pro-bFyTO
 *
 * Em produção isso roda automaticamente no bootstrap do servidor.
 * Use este script apenas para forçar a criação local/manualmente.
 */
import "dotenv/config";
import { bootstrap } from "../server/bootstrap";

bootstrap()
  .then(() => {
    console.log("Seed concluído.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Erro no seed:", err);
    process.exit(1);
  });
=======
 */
import "dotenv/config";
import bcrypt from "bcrypt";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { nanoid } from "nanoid";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const ADMIN_EMAIL = "cardosomsales@gmail.com";
const ADMIN_PASSWORD = "Admin@123";
const ADMIN_NAME = "Administrador";
const SALT_ROUNDS = 12;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌  DATABASE_URL não configurado. Verifique o .env");
    process.exit(1);
  }

  const connection = await mysql.createConnection(databaseUrl);
  const db = drizzle(connection);

  console.log("🔍  Verificando usuário admin...");

  const existing = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    const user = existing[0];
    if (user.role !== "admin") {
      // Promover para admin se existir mas não for admin
      await db
        .update(users)
        .set({ role: "admin" })
        .where(eq(users.email, ADMIN_EMAIL));
      console.log(`⬆️   Usuário existente promovido para admin: ${ADMIN_EMAIL}`);
    } else {
      console.log(`✅  Usuário admin já existe: ${ADMIN_EMAIL} (id=${user.id})`);
    }
    await connection.end();
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
  const openId = nanoid();

  await db.insert(users).values({
    openId,
    email: ADMIN_EMAIL,
    name: ADMIN_NAME,
    role: "admin",
    passwordHash,
    loginMethod: "email",
    theme: "light",
  });

  console.log("✅  Usuário admin criado com sucesso!");
  console.log(`   E-mail: ${ADMIN_EMAIL}`);
  console.log(`   Senha:  ${ADMIN_PASSWORD}`);
  console.log("   ⚠️  Troque a senha após o primeiro login.");

  await connection.end();
}

main().catch((err) => {
  console.error("❌  Erro ao criar usuário admin:", err);
  process.exit(1);
});
>>>>>>> main

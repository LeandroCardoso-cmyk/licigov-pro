/**
 * Cria o usuário admin inicial se não existir.
 * Idempotente — pode ser executado múltiplas vezes com segurança.
 *
 * Uso:
 *   pnpm tsx scripts/seed-admin.ts
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
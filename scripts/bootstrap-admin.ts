/**
 * Bootstrap explícito e fail-closed do administrador de plataforma.
 *
 * PR 0 (V1 Pre-Pilot Closure — Security Emergency Closure): substitui o antigo
 * seed automático de `server/bootstrap.ts`, que criava/promovia um admin a CADA
 * boot do servidor (staging/produção), com e-mail default hardcoded para um
 * endereço pessoal de terceiro — e dava a TODO usuário `role='admin'` membership
 * `owner` automática na organização 1. Nada disso roda mais no boot normal.
 *
 * Este comando:
 *  - NÃO é executado durante o boot do servidor — só por invocação manual explícita;
 *  - é idempotente — reexecutar com o mesmo e-mail não duplica nem rebaixa o usuário;
 *  - é fail-closed — sem as variáveis obrigatórias, encerra com erro (nenhum default
 *    inseguro, nenhum e-mail hardcoded);
 *  - NÃO associa o admin a nenhuma organização — o admin de plataforma opera
 *    cross-tenant via o cabeçalho `X-Organization-Id` (validado explicitamente em
 *    `server/_core/trpc.ts`), sem precisar de uma linha em `organization_members`;
 *  - registra a própria execução em `audit_logs` (ação `promote_to_admin`).
 *
 * Uso:
 *   ADMIN_BOOTSTRAP_CONFIRM=yes \
 *   ADMIN_BOOTSTRAP_EMAIL=admin@seu-orgao.gov.br \
 *   ADMIN_BOOTSTRAP_PASSWORD="senha-forte-min-8-chars" \
 *   ADMIN_BOOTSTRAP_NAME="Administrador da Plataforma" \
 *   DATABASE_URL="mysql://user:senha@host:3306/db" \
 *   tsx scripts/bootstrap-admin.ts
 *
 * `ADMIN_BOOTSTRAP_NAME` é opcional (default "Administrador"). Todas as demais são
 * obrigatórias. `ADMIN_BOOTSTRAP_CONFIRM=yes` existe apenas para que a execução
 * nunca seja acidental (ex.: um script/CI disparando isto sem intenção).
 *
 * Exit codes (execução direta): 0 = sucesso (criado, promovido, ou já era admin);
 * 1 = configuração inválida/ausente; 2 = erro de execução (banco indisponível etc.).
 *
 * `main()` é exportado e NÃO chama `process.exit` — apenas lança `ConfigError` para
 * configuração inválida (permitindo testar o comando via import, contra um banco de
 * teste, sem derrubar o processo que o importa). A conversão para exit code só
 * acontece no bloco de execução direta, no fim deste arquivo.
 */

import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { hashPassword } from "../server/services/passwordSecurity";

const MIN_PASSWORD_LENGTH = 8;

export class ConfigError extends Error {}

export type BootstrapOutcome = "created" | "promoted" | "already_admin";

export interface BootstrapResult {
  outcome: BootstrapOutcome;
  userId: number;
  email: string;
}

export async function main(): Promise<BootstrapResult> {
  if (process.env.ADMIN_BOOTSTRAP_CONFIRM?.trim().toLowerCase() !== "yes") {
    throw new ConfigError(
      "confirmação obrigatória ausente. Defina ADMIN_BOOTSTRAP_CONFIRM=yes explicitamente para executar este comando."
    );
  }

  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim();
  if (!email) {
    throw new ConfigError("ADMIN_BOOTSTRAP_EMAIL é obrigatório (sem default — nenhum e-mail hardcoded).");
  }

  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new ConfigError(`ADMIN_BOOTSTRAP_PASSWORD é obrigatória (mínimo ${MIN_PASSWORD_LENGTH} caracteres).`);
  }

  const name = process.env.ADMIN_BOOTSTRAP_NAME?.trim() || "Administrador";

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new ConfigError("DATABASE_URL é obrigatória.");
  }

  const connection = await mysql.createConnection(databaseUrl);
  try {
    const db = drizzle(connection);

    const existing = await db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    let targetUserId: number;
    let outcome: BootstrapOutcome;

    if (existing.length > 0) {
      targetUserId = existing[0].id;
      if (existing[0].role === "admin") {
        outcome = "already_admin";
        console.info(`[bootstrap-admin] Usuário ${email} já é admin de plataforma (id=${targetUserId}). Nenhuma alteração.`);
      } else {
        await db.update(users).set({ role: "admin" }).where(eq(users.id, targetUserId));
        outcome = "promoted";
        console.info(`[bootstrap-admin] Usuário ${email} (id=${targetUserId}) promovido a admin de plataforma.`);
      }
    } else {
      const passwordHash = await hashPassword(password);
      const result = await db.insert(users).values({
        openId: `platform-admin-${Date.now()}`,
        email,
        name,
        role: "admin",
        passwordHash,
        loginMethod: "email",
        theme: "light",
      });
      targetUserId = result[0].insertId;
      outcome = "created";
      console.info(`[bootstrap-admin] Admin de plataforma criado: ${email} (id=${targetUserId}).`);
    }

    // Auditoria da própria execução — nunca deve quebrar o resultado do bootstrap.
    try {
      await connection.execute(
        `INSERT INTO audit_logs (adminId, targetUserId, action, details, createdAt)
         VALUES (?, ?, 'promote_to_admin', ?, NOW())`,
        [
          targetUserId,
          targetUserId,
          JSON.stringify({ event: "platform_admin_bootstrap", email, outcome, via: "scripts/bootstrap-admin.ts" }),
        ]
      );
    } catch (auditError) {
      console.warn("[bootstrap-admin] Aviso: não foi possível gravar audit_logs (bootstrap já concluído):", auditError);
    }

    console.info(`[bootstrap-admin] Concluído (${outcome}). NÃO foi criada membership de organização — o admin de plataforma opera via X-Organization-Id explícito e validado.`);

    return { outcome, userId: targetUserId, email };
  } finally {
    await connection.end();
  }
}

// Só executa ao rodar diretamente (`tsx scripts/bootstrap-admin.ts`) — nunca ao
// importar `main`/`ConfigError` de um teste ou de outro módulo.
const isDirectExecution =
  typeof process.argv[1] === "string" && import.meta.url === `file://${process.argv[1]}`;

if (isDirectExecution) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      if (error instanceof ConfigError) {
        console.error(`[bootstrap-admin] ERRO: ${error.message}`);
        process.exit(1);
      }
      console.error("[bootstrap-admin] Falha na execução:", error);
      process.exit(2);
    });
}

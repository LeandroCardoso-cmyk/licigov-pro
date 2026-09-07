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
 *  - é fail-closed — sem as variáveis obrigatórias, encerra com erro (nenhum default
 *    inseguro, nenhum e-mail hardcoded);
 *  - NÃO associa o admin a nenhuma organização — o admin de plataforma opera
 *    cross-tenant via o cabeçalho `X-Organization-Id` (validado explicitamente em
 *    `server/_core/trpc.ts`), sem precisar de uma linha em `organization_members`;
 *  - exige a MESMA política de força de senha de qualquer usuário do sistema
 *    (`validatePasswordStrength` — maiúscula, minúscula, número, caractere especial;
 *    8+ caracteres sozinhos NÃO bastam);
 *  - registra a própria execução em `audit_logs` (ação `promote_to_admin`) na MESMA
 *    transação da criação/promoção — se a auditoria falhar, tudo reverte (fail-closed).
 *
 * Semântica por caminho (correção de segurança — promoção deixou de ser implícita):
 *  - E-mail inexistente → CRIA um novo usuário admin com a senha fornecida.
 *  - E-mail já é admin → idempotente: NÃO altera senha, NÃO rebaixa, retorna `already_admin`.
 *  - E-mail existe e NÃO é admin → NUNCA promove automaticamente (antes: o script só
 *    alterava `role`, e a senha forte fornecida ao CLI era validada e descartada — uma
 *    conta legada com senha fraca virava admin de plataforma mantendo essa senha fraca).
 *    Promover exige a confirmação explícita ADICIONAL `ADMIN_BOOTSTRAP_ALLOW_PROMOTE=yes`;
 *    sem ela, falha com `ConfigError` (fail-closed) e a conta permanece como estava. Com
 *    ela: a senha fornecida é validada, um novo hash é gravado (substitui o hash antigo,
 *    possivelmente fraco), `tokenVersion` é incrementado (revoga qualquer sessão ativa
 *    daquela conta) e `role` vira `admin` — tudo na MESMA transação do audit.
 *
 * Uso (criação, ou já-admin idempotente):
 *   ADMIN_BOOTSTRAP_CONFIRM=yes \
 *   ADMIN_BOOTSTRAP_EMAIL=admin@seu-orgao.gov.br \
 *   ADMIN_BOOTSTRAP_PASSWORD="Senha-Forte-123!" \
 *   ADMIN_BOOTSTRAP_NAME="Administrador da Plataforma" \
 *   DATABASE_URL="mysql://user:senha@host:3306/db" \
 *   tsx scripts/bootstrap-admin.ts
 *
 * Uso (promover conta EXISTENTE não-admin — exige a confirmação adicional):
 *   ADMIN_BOOTSTRAP_CONFIRM=yes ADMIN_BOOTSTRAP_ALLOW_PROMOTE=yes \
 *   ADMIN_BOOTSTRAP_EMAIL=usuario-existente@seu-orgao.gov.br \
 *   ADMIN_BOOTSTRAP_PASSWORD="Senha-Forte-Nova-123!" \
 *   DATABASE_URL="mysql://user:senha@host:3306/db" \
 *   tsx scripts/bootstrap-admin.ts
 *
 * `ADMIN_BOOTSTRAP_NAME` é opcional (default "Administrador", só usado na criação).
 * `ADMIN_BOOTSTRAP_ALLOW_PROMOTE` só é necessária ao promover uma conta já existente.
 * Todas as demais são obrigatórias. `ADMIN_BOOTSTRAP_CONFIRM=yes` existe apenas para
 * que a execução nunca seja acidental (ex.: um script/CI disparando isto sem intenção).
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
import { users, auditLogs } from "../drizzle/schema";
import { hashPassword, validatePasswordStrength } from "../server/services/passwordSecurity";
import { bumpTokenVersion } from "../server/db/users";

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
  if (!password) {
    throw new ConfigError("ADMIN_BOOTSTRAP_PASSWORD é obrigatória.");
  }
  // Correção: 8+ caracteres não bastam — reutiliza a MESMA política de força de senha
  // já aplicada a qualquer usuário do sistema (maiúscula, minúscula, número, caractere
  // especial). Um admin de plataforma não pode ser criado com senha mais fraca que a
  // exigida de qualquer outro usuário.
  const strength = validatePasswordStrength(password);
  if (!strength.isValid) {
    throw new ConfigError(
      `ADMIN_BOOTSTRAP_PASSWORD não atende à política de senha: ${strength.feedback.join(" ")}`
    );
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

    if (existing.length > 0 && existing[0].role === "admin") {
      // Idempotente: NÃO altera senha, NÃO rebaixa — apenas confirma o estado atual.
      console.info(`[bootstrap-admin] Usuário ${email} já é admin de plataforma (id=${existing[0].id}). Nenhuma alteração.`);
      return { outcome: "already_admin", userId: existing[0].id, email };
    }

    // Correção de segurança: uma conta EXISTENTE não-admin nunca é promovida
    // automaticamente. Sem isso, uma conta legada com senha fraca/desconhecida
    // virava admin de plataforma mantendo essa senha — a senha forte fornecida ao
    // CLI era apenas validada e descartada. Promover exige confirmação adicional
    // e deliberada, distinta de ADMIN_BOOTSTRAP_CONFIRM (que só autoriza o comando
    // rodar, não autoriza elevar privilégio de uma conta que já existe).
    const isExistingNonAdmin = existing.length > 0;
    if (isExistingNonAdmin && process.env.ADMIN_BOOTSTRAP_ALLOW_PROMOTE?.trim().toLowerCase() !== "yes") {
      throw new ConfigError(
        `Usuário ${email} já existe e NÃO é admin de plataforma — promoção automática bloqueada. ` +
        "Defina ADMIN_BOOTSTRAP_ALLOW_PROMOTE=yes explicitamente para promover esta conta existente."
      );
    }

    // Criação/promoção + auditoria são ATÔMICAS: se o registro em `audit_logs` falhar,
    // a transação inteira reverte (role, passwordHash e tokenVersion incluídos) — a
    // criação/promoção do admin NUNCA fica sem o rastro de auditoria correspondente
    // (fail-closed).
    let targetUserId!: number;
    let outcome!: BootstrapOutcome;

    await db.transaction(async tx => {
      const passwordHash = await hashPassword(password);

      if (isExistingNonAdmin) {
        targetUserId = existing[0].id;
        // Promoção deliberada (ADMIN_BOOTSTRAP_ALLOW_PROMOTE=yes): grava a senha forte
        // DELIBERADAMENTE fornecida (substitui o hash antigo, possivelmente fraco) e
        // revoga qualquer sessão ativa dessa conta incrementando `tokenVersion`.
        await tx.update(users).set({ role: "admin", passwordHash }).where(eq(users.id, targetUserId));
        await bumpTokenVersion(targetUserId, tx);
        outcome = "promoted";
      } else {
        const result = await tx.insert(users).values({
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
      }

      // `targetUserId` já identifica o alvo — não repete o e-mail em `details`.
      await tx.insert(auditLogs).values({
        adminId: targetUserId,
        targetUserId,
        action: "promote_to_admin",
        details: JSON.stringify({ event: "platform_admin_bootstrap", outcome, via: "scripts/bootstrap-admin.ts" }),
      });
    });

    console.info(`[bootstrap-admin] Concluído (${outcome}, id=${targetUserId}). NÃO foi criada membership de organização — o admin de plataforma opera via X-Organization-Id explícito e validado.`);

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

/**
 * SEC-AUD-2026-10 — contas de banco com menor privilégio (fonte única: runbook + smoke MySQL).
 *
 * Uso (somente leitura, não conecta em nada): `pnpm db:roles:plan [nome_do_banco]`
 * Imprime o SQL de GRANT para cada papel, SEM senhas. As contas são criadas pelo operador num cliente
 * `mysql` interativo em ambiente confiável (o `--histignore` padrão do cliente não grava linhas com
 * IDENTIFIED/PASSWORD no histórico), com senha gerada na hora — ver
 * docs/security/incident-2026-10/PRODUCTION_DB_RUNBOOK.md §2.
 *
 * Privilégios ensaiados em MySQL 9.7.4 (imagem oficial `mysql:9`) e cobertos por
 * server/__tests__/integration/sec-db-least-privilege-mysql-smoke.test.ts (MySQL 8 da CI):
 *   - migrator: as 320 migrations aplicam do zero e em replay; sem EXECUTE (o criador da procedure
 *     temporária recebe EXECUTE automaticamente — automatic_sp_privileges); ALTER ROUTINE é exigido
 *     por `DROP PROCEDURE IF EXISTS` de procedure inexistente.
 *   - runtime: boot (validação de schema), login, criação de órgão/processo — só DML.
 *   - backup: mysqldump --single-transaction --routines --triggers --events --no-tablespaces completo;
 *     SEM SHOW_ROUTINE o mysqldump OMITE procedures em silêncio (exit 0) — por isso o privilégio global.
 *   - audit: `pnpm db:audit` só lê INFORMATION_SCHEMA; REFERENCES dá visibilidade de metadados sem
 *     permitir SELECT nos dados.
 */

export type DbRole = "runtime" | "migrator" | "backup" | "audit";

export interface DbRoleSpec {
  /** Nome sugerido da conta. */
  readonly user: string;
  /** Privilégios no banco da aplicação (`<db>.*`). */
  readonly schemaPrivileges: readonly string[];
  /** Privilégios globais (`*.*`) — só quando não existe equivalente por banco. */
  readonly globalPrivileges: readonly string[];
  /** Conexão pelo endpoint público ⇒ o servidor recusa sessão sem TLS. */
  readonly requireSsl: boolean;
  /** Variável que recebe a URL desta conta e quem a consome. */
  readonly consumer: string;
  /** Por que cada privilégio existe. */
  readonly justification: Readonly<Record<string, string>>;
}

export const DB_ROLES: Readonly<Record<DbRole, DbRoleSpec>> = Object.freeze({
  runtime: {
    user: "licigov_app",
    schemaPrivileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
    globalPrivileges: [],
    requireSsl: false,
    consumer: "DATABASE_URL (serviço licigov-pro: runtime + reference data do pre-deploy), rede privada",
    justification: {
      SELECT: "leituras e validação de schema no boot (INFORMATION_SCHEMA + __drizzle_migrations)",
      INSERT: "escrita de domínio, ledger e auditoria (append-only)",
      UPDATE: "transições de estado e SELECT … FOR UPDATE (locks de linha exigem UPDATE)",
      DELETE: "remoções governadas existentes no domínio (rascunhos, vínculos substituídos)",
    },
  },
  migrator: {
    user: "licigov_migrator",
    schemaPrivileges: [
      "SELECT", "INSERT", "UPDATE", "DELETE",
      "CREATE", "ALTER", "DROP", "INDEX", "REFERENCES",
      "CREATE ROUTINE", "ALTER ROUTINE",
    ],
    globalPrivileges: [],
    requireSsl: false,
    consumer: "MIGRATION_DATABASE_URL (pre-deploy: pnpm db:migrate:release), rede privada",
    justification: {
      SELECT: "journal __drizzle_migrations e leituras de INFORMATION_SCHEMA nas migrations",
      INSERT: "journal e backfills de dados das migrations",
      UPDATE: "backfills (UPDATE) em migrations",
      DELETE: "limpezas de dados em migrations (ex.: 0302)",
      CREATE: "CREATE TABLE (335 ocorrências)",
      ALTER: "ALTER TABLE (116 ocorrências)",
      DROP: "DROP TABLE em migrations de reconciliação",
      INDEX: "CREATE INDEX",
      REFERENCES: "FOREIGN KEY (0316+)",
      "CREATE ROUTINE": "procedures temporárias de reconciliação (0297 e seguintes)",
      "ALTER ROUTINE": "DROP PROCEDURE IF EXISTS (exigido mesmo quando a procedure não existe)",
    },
  },
  backup: {
    user: "licigov_backup",
    schemaPrivileges: ["SELECT", "SHOW VIEW", "TRIGGER", "EVENT"],
    globalPrivileges: ["SHOW_ROUTINE"],
    requireSsl: true,
    consumer: "BACKUP_DATABASE_URL (GitHub Actions db-backup.yml), proxy TCP público",
    justification: {
      SELECT: "dados das tabelas",
      "SHOW VIEW": "definição de views (--routines/--triggers não cobrem views)",
      TRIGGER: "--triggers",
      EVENT: "--events",
      SHOW_ROUTINE: "--routines; sem ele o mysqldump omite procedures/funções SEM erro",
    },
  },
  audit: {
    user: "licigov_audit",
    schemaPrivileges: ["REFERENCES"],
    globalPrivileges: [],
    requireSsl: true,
    consumer: "AUDIT_DATABASE_URL (GitHub Actions schema-audit.yml), proxy TCP público",
    justification: {
      REFERENCES: "torna tabelas/colunas visíveis em INFORMATION_SCHEMA sem permitir SELECT nos dados",
    },
  },
});

const IDENTIFIER = /^[A-Za-z0-9_]{1,64}$/;

function assertIdentifier(kind: string, value: string): void {
  if (!IDENTIFIER.test(value)) throw new Error(`${kind} inválido para GRANT: use apenas [A-Za-z0-9_] (1–64).`);
}

/**
 * GRANT/ALTER USER de um papel (identificadores validados — GRANT não aceita parâmetros).
 * Não cria a conta nem define senha: isso é feito pelo operador (ou pelo smoke, com senha aleatória).
 */
export function grantStatements(role: DbRole, database: string, user = DB_ROLES[role].user, host = "%"): string[] {
  assertIdentifier("banco", database);
  assertIdentifier("usuário", user);
  if (!/^[A-Za-z0-9_.%:-]{1,255}$/.test(host)) throw new Error("host inválido para GRANT.");
  const spec = DB_ROLES[role];
  const account = `'${user}'@'${host}'`;
  const out = [`GRANT ${spec.schemaPrivileges.join(", ")} ON \`${database}\`.* TO ${account}`];
  if (spec.globalPrivileges.length > 0) out.push(`GRANT ${spec.globalPrivileges.join(", ")} ON *.* TO ${account}`);
  out.push(`ALTER USER ${account} REQUIRE ${spec.requireSsl ? "SSL" : "NONE"}`);
  return out;
}

function printPlan(database: string): void {
  console.info(`-- Plano de contas com menor privilégio para o banco \`${database}\` (sem senhas).`);
  console.info("-- Criar cada conta antes, no cliente mysql interativo: CREATE USER '<usuario>'@'%' IDENTIFIED BY '<senha gerada>';");
  for (const role of Object.keys(DB_ROLES) as DbRole[]) {
    const spec = DB_ROLES[role];
    console.info(`\n-- ${role}: ${spec.user} — ${spec.consumer}`);
    for (const [priv, why] of Object.entries(spec.justification)) console.info(`--   ${priv}: ${why}`);
    for (const s of grantStatements(role, database)) console.info(`${s};`);
  }
}

const invokedDirectly = typeof process.argv[1] === "string" && /db-roles(\.ts|\.js|\.mts)?$/.test(process.argv[1]);
if (invokedDirectly) {
  try {
    printPlan(process.argv[2] ?? "railway");
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

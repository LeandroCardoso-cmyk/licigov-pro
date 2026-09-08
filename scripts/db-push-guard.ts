/**
 * V1 PRE-PILOT CLOSURE — Fase B — guard técnico para `drizzle-kit push` (finding RUNTIME-02).
 *
 * `drizzle-kit push` compara o schema.ts com o banco e aplica DDL DIRETO — inclusive
 * destrutivo com `--force`. Isso NÃO pode fazer parte de nenhum fluxo de staging/produção
 * nem da CI. Em staging/produção a única via permitida de mudança de schema é a migration
 * versionada (`pnpm db:migrate:release`). Este wrapper é o único caminho oficial de `db:push`
 * do repositório e é FAIL-CLOSED:
 *   - recusa se APP_ENV/NODE_ENV não for `development`/`test`;
 *   - recusa se estiver rodando em CI;
 *   - recusa `--force` (destrutivo) a menos que haja confirmação local explícita
 *     `DB_PUSH_ALLOW_FORCE=yes` — e nunca injeta `--force` implicitamente.
 *
 * NOTA HONESTA DE ESCOPO: nenhum guard de repositório impede um operador com credenciais de
 * rodar `drizzle-kit push --force` manualmente fora do repo. O objetivo é tornar TODOS os
 * caminhos oficiais do LiciGov Pro (package scripts, CI, runtime) fail-closed.
 */

export type DbPushDecision =
  | { allowed: true; args: string[] }
  | { allowed: false; reason: string };

export interface DbPushEnv {
  APP_ENV?: string;
  NODE_ENV?: string;
  CI?: string;
  DB_PUSH_ALLOW_FORCE?: string;
}

/** Decisão pura e testável: dado o ambiente e os argumentos, pode rodar `drizzle-kit push`? */
export function evaluateDbPush(env: DbPushEnv, argv: readonly string[]): DbPushDecision {
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? "development").trim().toLowerCase();
  const isDevOrTest = appEnv === "development" || appEnv === "test";
  const inCi = !!env.CI && env.CI.trim().toLowerCase() !== "false" && env.CI.trim() !== "0";

  if (inCi) {
    return {
      allowed: false,
      reason:
        "db:push está BLOQUEADO na CI. A CI só aplica migrations versionadas (pnpm db:migrate:release). " +
        "Nunca use push (muito menos --force) em pipelines.",
    };
  }
  if (!isDevOrTest) {
    return {
      allowed: false,
      reason:
        `db:push está BLOQUEADO em APP_ENV='${appEnv}'. Só é permitido em development/test. ` +
        "Em staging/produção a única via de mudança de schema é a migration versionada (pnpm db:migrate:release).",
    };
  }

  const wantsForce = argv.includes("--force");
  if (wantsForce && (env.DB_PUSH_ALLOW_FORCE ?? "").trim().toLowerCase() !== "yes") {
    return {
      allowed: false,
      reason:
        "db:push --force é destrutivo e exige confirmação local EXPLÍCITA: rode com " +
        "DB_PUSH_ALLOW_FORCE=yes (apenas em desenvolvimento, e sabendo que pode perder dados locais).",
    };
  }

  // Passa adiante os argumentos do usuário SEM injetar --force. Se o usuário pediu --force e
  // confirmou, ele já está em argv; caso contrário, nunca adicionamos.
  return { allowed: true, args: [...argv] };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
const invokedDirectly =
  typeof process.argv[1] === "string" && /db-push-guard(\.ts|\.js)?$/.test(process.argv[1]);

if (invokedDirectly) {
  const decision = evaluateDbPush(process.env, process.argv.slice(2));
  if (!decision.allowed) {
    console.error(`[db:push][BLOQUEADO] ${decision.reason}`);
    process.exit(1);
  }
  // Import dinâmico só quando realmente vamos empurrar (evita carregar em teste/CI).
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("drizzle-kit", ["push", ...decision.args], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

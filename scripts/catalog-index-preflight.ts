/* eslint-disable no-console -- CLI de diagnóstico: o relatório é a saída no terminal */
/**
 * Preflight SOMENTE LEITURA do índice global dos catálogos oficiais (organização 0) — antes/depois de `catalog:sync`.
 *
 * Uso (Console do Railway do ambiente staging, em /app):
 *   pnpm catalog:preflight
 *
 * Garantias (o script RECUSA rodar se alguma faltar):
 *   - ambiente: APP_ENV=staging com RAILWAY_ENVIRONMENT_NAME=staging e banco na rede privada (`*.railway.internal`),
 *     ou APP_ENV=development com banco local; produção (APP_ENV ou ambiente Railway) é SEMPRE recusada;
 *   - acesso: UMA conexão dedicada em transação `READ ONLY` (verificada por `@@transaction_read_only` antes de qualquer
 *     consulta), somente as instruções SELECT fixas abaixo, encerrada com ROLLBACK;
 *   - sigilo: nunca imprime a string de conexão, usuário ou senha (só o host e o nome do banco).
 * Saída: 0 = diagnóstico concluído; 3 = ambiente/acesso recusado (nada consultado); 1 = erro. Via `pnpm`, todo código ≠ 0
 * chega como 1 — a linha `RECUSADO:`/`ERRO:` identifica o caso.
 */
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";
import { sanitizeFailureMessage } from "../server/domain/cognitiveProvenance";

export const PREFLIGHT_EXIT = { ok: 0, error: 1, refused: 3 } as const;

export type PreflightTarget =
  | { readonly ok: true; readonly appEnv: "staging" | "development"; readonly host: string; readonly database: string }
  | { readonly ok: false; readonly reason: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Decide, só por metadados não sensíveis, se o destino é seguro para o diagnóstico. Pura e testável. */
export function assessPreflightTarget(env: {
  APP_ENV?: string; NODE_ENV?: string; RAILWAY_ENVIRONMENT_NAME?: string; DATABASE_URL?: string;
}): PreflightTarget {
  const appEnv = (env.APP_ENV ?? env.NODE_ENV ?? "development").trim().toLowerCase();
  const railwayEnv = (env.RAILWAY_ENVIRONMENT_NAME ?? "").trim().toLowerCase();
  if (appEnv === "production" || railwayEnv === "production") return { ok: false, reason: "ambiente de PRODUÇÃO — diagnóstico recusado." };
  let url: URL;
  try { url = new URL((env.DATABASE_URL ?? "").trim()); } catch { return { ok: false, reason: "DATABASE_URL ausente ou inválida." }; }
  if (url.protocol !== "mysql:") return { ok: false, reason: "DATABASE_URL não é MySQL." };
  const host = url.hostname.toLowerCase();
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (appEnv === "staging") {
    if (railwayEnv !== "staging") return { ok: false, reason: `APP_ENV=staging fora do ambiente Railway "staging" (RAILWAY_ENVIRONMENT_NAME=${railwayEnv || "ausente"}).` };
    if (!host.endsWith(".railway.internal")) return { ok: false, reason: `banco fora da rede privada do ambiente (host ${host}) — possível banco de outro ambiente.` };
    return { ok: true, appEnv: "staging", host, database };
  }
  if (appEnv === "development") {
    if (railwayEnv) return { ok: false, reason: `APP_ENV=development dentro do Railway (${railwayEnv}) — configuração ambígua.` };
    if (!LOCAL_HOSTS.has(host)) return { ok: false, reason: `development só com banco local (host ${host}).` };
    return { ok: true, appEnv: "development", host, database };
  }
  return { ok: false, reason: `APP_ENV não suportado pelo diagnóstico: ${appEnv}.` };
}

/** Consultas do diagnóstico — SOMENTE SELECT (verificado em teste). Nenhuma recebe parâmetro externo. */
export const PREFLIGHT_QUERIES: ReadonlyArray<readonly [label: string, sql: string]> = [
  ["BANCO", "SELECT DATABASE() AS banco, @@hostname AS servidor, @@version AS versao, @@read_only AS servidor_read_only, @@max_connections AS max_conexoes, (SELECT COUNT(*) FROM information_schema.processlist) AS conexoes_visiveis"],
  ["MIGRATIONS_APLICADAS", "SELECT COUNT(*) AS aplicadas FROM __drizzle_migrations"],
  ["TABELAS", "SELECT table_name AS tabela, engine, table_rows AS linhas_estimadas, ROUND((data_length + index_length) / 1048576, 2) AS mb FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('catalog_snapshots', 'catalog_entries') ORDER BY table_name"],
  ["INDICES", "SELECT table_name AS tabela, index_name AS indice, non_unique, GROUP_CONCAT(column_name ORDER BY seq_in_index) AS colunas FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name IN ('catalog_snapshots', 'catalog_entries') GROUP BY table_name, index_name, non_unique ORDER BY table_name, index_name"],
  ["CHAVES_ESTRANGEIRAS", "SELECT table_name AS tabela, constraint_name AS restricao FROM information_schema.referential_constraints WHERE constraint_schema = DATABASE() AND table_name IN ('catalog_snapshots', 'catalog_entries')"],
  ["SNAPSHOTS_POR_ORG", "SELECT organization_id AS org, catalog_type AS tipo, sync_status AS situacao, COUNT(*) AS snapshots, SUM(total_entries) AS entradas_declaradas FROM catalog_snapshots GROUP BY organization_id, catalog_type, sync_status ORDER BY org, tipo, situacao"],
  ["INDICE_GLOBAL_SNAPSHOTS", "SELECT id, catalog_type AS tipo, sync_status AS situacao, total_entries AS entradas, JSON_UNQUOTE(JSON_EXTRACT(integrity_metadata, '$.kind')) AS kind, JSON_EXTRACT(integrity_metadata, '$.complete') AS completo, JSON_EXTRACT(integrity_metadata, '$.total') AS total_oficial, JSON_EXTRACT(integrity_metadata, '$.pages') AS paginas, JSON_UNQUOTE(JSON_EXTRACT(integrity_metadata, '$.publishedAt')) AS publicado_em, correlation_id FROM catalog_snapshots WHERE organization_id = 0 ORDER BY created_at DESC LIMIT 20"],
  ["INDICE_CATSER_VIGENTE", "SELECT s.id, s.total_entries AS entradas_declaradas, JSON_EXTRACT(s.integrity_metadata, '$.complete') AS completo, JSON_EXTRACT(s.integrity_metadata, '$.total') AS total_oficial, JSON_UNQUOTE(JSON_EXTRACT(s.integrity_metadata, '$.publishedAt')) AS publicado_em, (SELECT COUNT(*) FROM catalog_entries e WHERE e.organization_id = 0 AND e.snapshot_id = s.id) AS entradas_gravadas, (SELECT COUNT(*) FROM catalog_entries e WHERE e.organization_id = 0 AND e.snapshot_id = s.id AND e.active = 1) AS entradas_ativas FROM catalog_snapshots s WHERE s.organization_id = 0 AND s.catalog_type = 'catser' AND s.sync_status = 'synced' AND JSON_UNQUOTE(JSON_EXTRACT(s.integrity_metadata, '$.kind')) = 'indice' ORDER BY JSON_UNQUOTE(JSON_EXTRACT(s.integrity_metadata, '$.publishedAt')) DESC LIMIT 1"],
  ["ENTRADAS_POR_ORG", "SELECT organization_id AS org, catalog_type AS tipo, COUNT(*) AS entradas, COUNT(DISTINCT snapshot_id) AS snapshots, SUM(snapshot_id IS NULL) AS sem_snapshot FROM catalog_entries GROUP BY organization_id, catalog_type ORDER BY org, tipo"],
  ["SNAPSHOTS_GLOBAIS_NAO_PUBLICADOS", "SELECT COUNT(*) AS n FROM catalog_snapshots WHERE organization_id = 0 AND sync_status <> 'synced'"],
  ["ORG_0_CADASTRADA", "SELECT COUNT(*) AS n FROM organizations WHERE id = 0"],
  ["IMPRESSAO_DIGITAL_FORA_DO_INDICE", "SELECT (SELECT COUNT(*) FROM organizations) AS organizacoes, (SELECT COUNT(*) FROM processes) AS processos, (SELECT MAX(updatedAt) FROM processes) AS processos_ultima_alteracao, (SELECT COUNT(*) FROM catalog_snapshots WHERE organization_id <> 0) AS snapshots_dos_orgaos, (SELECT COUNT(*) FROM catalog_entries WHERE organization_id <> 0) AS entradas_dos_orgaos"],
  ["LOCK_PUBLICACAO_CATSER_LIVRE", "SELECT IS_FREE_LOCK('licigov:catalog-index:catser') AS livre"],
];

function repoMigrationCount(): number | null {
  try { return (JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: unknown[] }).entries.length; } catch { return null; }
}

async function main(): Promise<number> {
  const target = assessPreflightTarget(process.env);
  console.log(`[CATALOGO-PREFLIGHT] ambiente: ${JSON.stringify({
    APP_ENV: process.env.APP_ENV ?? null, railwayEnv: process.env.RAILWAY_ENVIRONMENT_NAME ?? null, railwayService: process.env.RAILWAY_SERVICE_NAME ?? null,
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA ?? "").slice(0, 7) || null, ...(target.ok ? { dbHost: target.host, banco: target.database } : {}),
  })}`);
  if (!target.ok) { console.log(`[CATALOGO-PREFLIGHT] RECUSADO: ${target.reason} Nada foi consultado.`); return PREFLIGHT_EXIT.refused; }

  const conn = await mysql.createConnection({ uri: process.env.DATABASE_URL, connectTimeout: 10_000 });
  try {
    await conn.query("SET SESSION TRANSACTION READ ONLY");
    await conn.query("START TRANSACTION READ ONLY");
    const [ro] = await conn.query("SELECT @@transaction_read_only AS ro");
    if (Number((ro as Array<{ ro: number }>)[0]?.ro) !== 1) {
      console.log("[CATALOGO-PREFLIGHT] RECUSADO: não foi possível garantir transação somente leitura. Nada foi consultado.");
      return PREFLIGHT_EXIT.refused;
    }
    console.log("[CATALOGO-PREFLIGHT] acesso: transação READ ONLY confirmada (@@transaction_read_only = 1)");
    for (const [label, sql] of PREFLIGHT_QUERIES) {
      const [rows] = await conn.query(sql);
      console.log(`${label} ${JSON.stringify(rows)}`);
    }
    console.log(`MIGRATIONS_REPOSITORIO ${JSON.stringify([{ no_repositorio: repoMigrationCount() }])}`);
    console.log("[CATALOGO-PREFLIGHT] concluído — nenhuma escrita (ROLLBACK).");
    return PREFLIGHT_EXIT.ok;
  } finally {
    await conn.query("ROLLBACK").catch(() => undefined);
    await conn.end().catch(() => undefined);
  }
}

if (process.argv[1] && /catalog-index-preflight\.[cm]?[jt]s$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(`[CATALOGO-PREFLIGHT] ERRO: ${sanitizeFailureMessage(String((err as Error)?.message ?? err))}`);
      process.exit(PREFLIGHT_EXIT.error);
    },
  );
}

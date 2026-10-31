/**
 * SEC-AUD-2026-10 — seleção fail-closed do ambiente de banco (scripts/ops/select-db-target.sh) nos workflows
 * de backup, drill e auditoria. Secrets de produção e staging têm NOMES próprios e nunca há fallback: ensaiar
 * em staging não exige (nem permite) apontar os secrets de produção para staging. Só valores sintéticos.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { auditConnectionOptions } from "../../../scripts/schema-audit-util";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SELECT = path.join(ROOT, "scripts/ops/select-db-target.sh");
const BACKUP = path.join(ROOT, "scripts/ops/db-backup.sh");

const PROD_URL = "mysql://backup:prod-s3nha@prod.proxy.invalid:41001/railway";
const STG_URL = "mysql://backup:stg-s3nha@stg.proxy.invalid:42002/railway";
const PROD_KEY = "chave-sintetica-producao-000000000000";
const STG_KEY = "chave-sintetica-staging-1111111111111";
const CA = "-----BEGIN CERTIFICATE-----\nSINTETICA\n-----END CERTIFICATE-----";
const SECRETS = [PROD_URL, STG_URL, PROD_KEY, STG_KEY, "prod-s3nha", "stg-s3nha", "SINTETICA"];

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "db-target-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const BACKUP_CANDIDATES = {
  PRODUCTION_BACKUP_DATABASE_URL: PROD_URL,
  PRODUCTION_BACKUP_ENCRYPTION_KEY: PROD_KEY,
  STAGING_BACKUP_DATABASE_URL: STG_URL,
  STAGING_BACKUP_ENCRYPTION_KEY: STG_KEY,
  STAGING_BACKUP_DB_SSL_CA: CA,
};

/** Executa o seletor com `env -0` como comando e devolve o ambiente que o comando recebeu. */
function select(kind: string, env: Record<string, string | undefined>) {
  const output = path.join(dir, "gh-output");
  writeFileSync(output, "");
  const base: Record<string, string> = { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: output };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) base[k] = v;
  const r = spawnSync("bash", [SELECT, kind, "--", "env", "-0"], { env: base, encoding: "utf8" });
  const child: Record<string, string> = {};
  if (r.status === 0) {
    for (const entry of r.stdout.split("\0")) {
      const i = entry.indexOf("=");
      if (i > 0) child[entry.slice(0, i)] = entry.slice(i + 1);
    }
  }
  // Em sucesso o stdout é o ambiente do comando (contém valores por definição); o log do seletor é o stderr.
  const logs = r.status === 0 ? r.stderr : `${r.stdout}\n${r.stderr}`;
  return { status: r.status, child, logs, ghOutput: readFileSync(output, "utf8") };
}

function expectNoSecrets(text: string) {
  for (const s of SECRETS) expect(text).not.toContain(s);
}

describe("select-db-target.sh — escolha do ambiente", () => {
  it("agendado ⇒ sempre produção, com os secrets de produção e nenhum candidato de staging no comando", () => {
    const r = select("backup", { GITHUB_EVENT_NAME: "schedule", ...BACKUP_CANDIDATES });
    expect(r.status).toBe(0);
    expect(r.child.DB_TARGET).toBe("production");
    expect(r.child.BACKUP_DATABASE_URL).toBe(PROD_URL);
    expect(r.child.BACKUP_ENCRYPTION_KEY).toBe(PROD_KEY);
    expect(Object.keys(r.child).filter((k) => /^(PRODUCTION|STAGING)_/.test(k))).toEqual([]);
    expect(r.ghOutput).toBe("target=production\n");
    expectNoSecrets(r.logs);
  });

  it("agendado com input diferente de produção ⇒ recusa", () => {
    const r = select("backup", { GITHUB_EVENT_NAME: "schedule", DB_TARGET_INPUT: "staging", ...BACKUP_CANDIDATES });
    expect(r.status).not.toBe(0);
    expect(r.logs).toMatch(/sempre produção/);
  });

  it("manual exige input explícito e exato (ausente, abreviado ou com caixa diferente ⇒ recusa)", () => {
    for (const input of [undefined, "", "prod", "Staging", "production ", "staging,production"]) {
      const r = select("backup", { GITHUB_EVENT_NAME: "workflow_dispatch", DB_TARGET_INPUT: input, ...BACKUP_CANDIDATES });
      expect(r.status, `input ${JSON.stringify(input)}`).not.toBe(0);
      expect(r.ghOutput).toBe("");
    }
  });

  it("evento não suportado ou fora do Actions ⇒ recusa", () => {
    for (const ev of [undefined, "push", "pull_request"]) {
      const r = select("backup", { GITHUB_EVENT_NAME: ev, DB_TARGET_INPUT: "production", ...BACKUP_CANDIDATES });
      expect(r.status).not.toBe(0);
    }
  });

  it("manual staging ⇒ secrets STAGING_* com nome canônico; produção não chega ao comando", () => {
    const r = select("backup", { GITHUB_EVENT_NAME: "workflow_dispatch", DB_TARGET_INPUT: "staging", ...BACKUP_CANDIDATES });
    expect(r.status).toBe(0);
    expect(r.child.DB_TARGET).toBe("staging");
    expect(r.child.BACKUP_DATABASE_URL).toBe(STG_URL);
    expect(r.child.BACKUP_ENCRYPTION_KEY).toBe(STG_KEY);
    expect(r.child.BACKUP_DB_SSL_CA).toBe(CA);
    expect(JSON.stringify(r.child)).not.toContain(PROD_URL);
    expect(JSON.stringify(r.child)).not.toContain(PROD_KEY);
    expect(r.ghOutput).toBe("target=staging\n");
    expectNoSecrets(r.logs);
  });
});

describe("select-db-target.sh — sem fallback e sem mistura de ambientes", () => {
  it("staging sem secret próprio ⇒ recusa, mesmo com o de produção presente", () => {
    for (const missing of ["STAGING_BACKUP_DATABASE_URL", "STAGING_BACKUP_ENCRYPTION_KEY", "STAGING_BACKUP_DB_SSL_CA"]) {
      const env: Record<string, string | undefined> = { GITHUB_EVENT_NAME: "workflow_dispatch", DB_TARGET_INPUT: "staging", ...BACKUP_CANDIDATES };
      env[missing] = "";
      const r = select("backup", env);
      expect(r.status, missing).not.toBe(0);
      expect(r.logs).toContain(missing);
      expect(r.logs).toMatch(/sem fallback/);
    }
  });

  it("produção sem secret ⇒ recusa (sem usar o de staging)", () => {
    const r = select("backup", { GITHUB_EVENT_NAME: "schedule", ...BACKUP_CANDIDATES, PRODUCTION_BACKUP_DATABASE_URL: "" });
    expect(r.status).not.toBe(0);
  });

  it("produção sem CA continua aceita (backup diário existente); staging exige CA desde o início", () => {
    const prod = select("backup", { GITHUB_EVENT_NAME: "schedule", ...BACKUP_CANDIDATES });
    expect(prod.status).toBe(0);
    expect(prod.child.BACKUP_DB_SSL_CA ?? "").toBe("");
  });

  it("staging apontando para o mesmo host:porta de produção ⇒ recusa (mesmo com outro usuário/banco/caixa)", () => {
    const r = select("backup", {
      GITHUB_EVENT_NAME: "workflow_dispatch", DB_TARGET_INPUT: "staging", ...BACKUP_CANDIDATES,
      STAGING_BACKUP_DATABASE_URL: "mysql://outro:x@PROD.proxy.invalid:41001/outrobanco",
    });
    expect(r.status).not.toBe(0);
    expect(r.logs).toMatch(/mesmo host:porta de produção/);
  });

  it("staging com a mesma chave de cifra de produção ⇒ recusa", () => {
    const r = select("backup", {
      GITHUB_EVENT_NAME: "workflow_dispatch", DB_TARGET_INPUT: "staging", ...BACKUP_CANDIDATES,
      STAGING_BACKUP_ENCRYPTION_KEY: PROD_KEY,
    });
    expect(r.status).not.toBe(0);
    expect(r.logs).toMatch(/igual à chave de produção/);
    expectNoSecrets(r.logs);
  });
});

describe("select-db-target.sh — auditoria", () => {
  const AUDIT = {
    PRODUCTION_AUDIT_DATABASE_URL: PROD_URL, PRODUCTION_AUDIT_DB_SSL_CA: CA,
    STAGING_AUDIT_DATABASE_URL: STG_URL, STAGING_AUDIT_DB_SSL_CA: CA,
  };
  it("staging ⇒ AUDIT_* de staging; CA obrigatória nos dois ambientes", () => {
    const ok = select("audit", { GITHUB_EVENT_NAME: "workflow_dispatch", DB_TARGET_INPUT: "staging", ...AUDIT });
    expect(ok.status).toBe(0);
    expect(ok.child.AUDIT_DATABASE_URL).toBe(STG_URL);
    for (const t of ["staging", "production"]) {
      const env: Record<string, string | undefined> = { GITHUB_EVENT_NAME: "workflow_dispatch", DB_TARGET_INPUT: t, ...AUDIT };
      env[`${t.toUpperCase()}_AUDIT_DB_SSL_CA`] = "";
      expect(select("audit", env).status, t).not.toBe(0);
    }
  });

  it("staging de auditoria no host:porta de produção ⇒ recusa", () => {
    const r = select("audit", { GITHUB_EVENT_NAME: "workflow_dispatch", DB_TARGET_INPUT: "staging", ...AUDIT, STAGING_AUDIT_DATABASE_URL: PROD_URL });
    expect(r.status).not.toBe(0);
  });
});

describe("select-db-target.sh — drill de restauração", () => {
  const DRILL = {
    ...BACKUP_CANDIDATES,
    PRODUCTION_RESTORE_TARGET_URL: "mysql://root:d@drill-prod.proxy.invalid:43003/licigov_restore_drill",
    STAGING_RESTORE_TARGET_URL: "mysql://root:d@drill-stg.proxy.invalid:44004/licigov_restore_drill_stg",
  };
  const dispatch = (t: string, extra: Record<string, string> = {}) =>
    select("drill", { GITHUB_EVENT_NAME: "workflow_dispatch", DB_TARGET_INPUT: t, ...DRILL, ...extra });

  it("destino identificado e isolado ⇒ aceito, com a origem e a chave do mesmo ambiente", () => {
    const r = dispatch("staging");
    expect(r.status).toBe(0);
    expect(r.child.RESTORE_TARGET_URL).toBe(DRILL.STAGING_RESTORE_TARGET_URL);
    expect(r.child.BACKUP_DATABASE_URL).toBe(STG_URL);
    expect(r.child.BACKUP_ENCRYPTION_KEY).toBe(STG_KEY);
  });

  it("destino no host:porta da origem ⇒ recusa", () => {
    expect(dispatch("staging", { STAGING_RESTORE_TARGET_URL: "mysql://r:x@stg.proxy.invalid:42002/licigov_restore_drill" }).status).not.toBe(0);
  });

  it("destino no banco do OUTRO ambiente (ex.: drill de staging sobre produção) ⇒ recusa", () => {
    const r = dispatch("staging", { STAGING_RESTORE_TARGET_URL: "mysql://r:x@prod.proxy.invalid:41001/licigov_restore_drill" });
    expect(r.status).not.toBe(0);
    expect(r.logs).toMatch(/outro ambiente/);
  });

  it("banco de destino sem identificação de descartável (ex.: 'railway') ⇒ recusa", () => {
    for (const db of ["railway", "licigov", "restore_drill", "licigov_restore_drillx"]) {
      expect(dispatch("production", { PRODUCTION_RESTORE_TARGET_URL: `mysql://r:x@drill.proxy.invalid:1/${db}` }).status, db).not.toBe(0);
    }
  });

  it("sem destino do ambiente ⇒ recusa (não usa o destino do outro ambiente)", () => {
    expect(dispatch("staging", { STAGING_RESTORE_TARGET_URL: "" }).status).not.toBe(0);
  });
});

describe("seletor + db-backup.sh (binários sintéticos)", () => {
  function fakeBin() {
    const bin = path.join(dir, "bin");
    mkdirSync(bin);
    const w = (f: string, c: string) => { writeFileSync(path.join(bin, f), c); chmodSync(path.join(bin, f), 0o755); };
    w("mysql", `#!/usr/bin/env bash\nprintf '9.4.0\\nSsl_version\\tTLSv1.3\\nSsl_cipher\\tX\\n'\n`);
    w("mysqldump", `#!/usr/bin/env bash\n[ "\${1:-}" = "--version" ] && { echo fake; exit 0; }\nfor i in $(seq 1 200); do echo "INSERT $(printf %s $i | sha256sum)"; done\necho "-- Dump completed"\n`);
    return bin;
  }

  it("artefato nomeado pelo ambiente escolhido (staging ≠ production)", () => {
    const bin = fakeBin();
    for (const [event, input, expected] of [["schedule", "", "production"], ["workflow_dispatch", "staging", "staging"]] as const) {
      const out = path.join(dir, `out-${expected}`);
      mkdirSync(out);
      const r = spawnSync("bash", [SELECT, "backup", "--", "bash", BACKUP], {
        env: { PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: dir, BACKUP_OUT_DIR: out, GITHUB_EVENT_NAME: event, DB_TARGET_INPUT: input, ...BACKUP_CANDIDATES },
        encoding: "utf8",
      });
      expect(r.status, r.stderr).toBe(0);
      const files = readdirSync(out);
      expect(files.find((f) => f.endsWith(".enc"))).toMatch(new RegExp(`^backup-${expected}-railway-\\d{8}-\\d{6}\\.sql\\.gz\\.enc$`));
      expectNoSecrets(`${r.stdout}${r.stderr}`);
    }
  });
});

describe("workflows — ligação com o seletor", () => {
  const backupYml = readFileSync(path.join(ROOT, ".github/workflows/db-backup.yml"), "utf8");
  const auditYml = readFileSync(path.join(ROOT, ".github/workflows/schema-audit.yml"), "utf8");

  it("nenhum fallback entre secrets por expressão (`secrets.X || secrets.Y`)", () => {
    for (const y of [backupYml, auditYml]) expect(y).not.toMatch(/secrets\.[A-Z_]+\s*\|\|/);
  });

  it("produção mantém os nomes atuais dos secrets; staging usa nomes STAGING_*", () => {
    expect(backupYml).toContain("PRODUCTION_BACKUP_DATABASE_URL: ${{ secrets.BACKUP_DATABASE_URL }}");
    expect(backupYml).toContain("STAGING_BACKUP_DATABASE_URL: ${{ secrets.STAGING_BACKUP_DATABASE_URL }}");
    expect(backupYml).toContain("STAGING_RESTORE_TARGET_URL: ${{ secrets.STAGING_RESTORE_TARGET_URL }}");
    expect(auditYml).toContain("STAGING_AUDIT_DATABASE_URL: ${{ secrets.STAGING_AUDIT_DATABASE_URL }}");
  });

  it("artifact e drill usam o ambiente que o seletor escolheu", () => {
    expect(backupYml).toContain("name: db-backup-${{ steps.dump.outputs.target }}");
    expect(backupYml).toContain("name: db-backup-${{ needs.backup.outputs.target }}");
    expect(backupYml).toContain("select-db-target.sh\" drill -- bash");
    expect(auditYml).toContain("bash scripts/ops/select-db-target.sh audit --");
  });

  it("drill só por dispatch e opt-in; agendamento continua diário", () => {
    expect(backupYml).toMatch(/cron: "0 6 \* \* \*"/);
    expect(backupYml).toContain("if: ${{ github.event_name == 'workflow_dispatch' && inputs.run_restore_drill }}");
  });
});

describe("auditConnectionOptions (schema-audit)", () => {
  it("remoto exige CA e verifica a cadeia; nunca rejectUnauthorized:false", () => {
    expect(auditConnectionOptions({ AUDIT_DATABASE_URL: PROD_URL })).toEqual({ error: expect.stringContaining("AUDIT_DB_SSL_CA") });
    expect(auditConnectionOptions({ AUDIT_DATABASE_URL: PROD_URL, AUDIT_DB_SSL_CA: CA })).toEqual({
      uri: PROD_URL, ssl: { ca: CA, rejectUnauthorized: true, verifyIdentity: false },
    });
  });
  it("uso local por DATABASE_URL segue igual; sem URL ⇒ null", () => {
    expect(auditConnectionOptions({ DATABASE_URL: "mysql://u:p@localhost/db" })).toEqual({ uri: "mysql://u:p@localhost/db" });
    expect(auditConnectionOptions({})).toBeNull();
  });
});

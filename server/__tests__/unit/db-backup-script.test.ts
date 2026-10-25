/**
 * SEC-AUD-2026-10 — harness sintético do backup cifrado (scripts/ops/db-backup.sh).
 *
 * `mysql` e `mysqldump` são substituídos por scripts falsos no PATH (nenhum banco real); `gzip` e
 * `openssl` são os reais (o `openssl` pode ser embrulhado para simular falha de cifra). Prova:
 * chave ausente ⇒ falha ANTES de conectar; dump/cifra com erro ⇒ nada publicável; sessão sem TLS ⇒
 * aborta antes do dump; caminho feliz ⇒ só artefato cifrado + checksum, que decifra para o dump
 * original; nenhum segredo nos logs. Também confere, no YAML, que o upload só publica o .enc em sucesso.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/ops/db-backup.sh");
const WORKFLOW = path.join(ROOT, ".github/workflows/db-backup.yml");
const PASSWORD = "S3nh@-sint3tica/\"com:aspas";
const KEY = "chave-sintetica-de-backup-0123456789";
const DB_URL = `mysql://backup_user:${PASSWORD}@db.sintetico.invalid:50643/railway`;

let dir: string;
let bin: string;
let out: string;
let callLog: string;

function write(file: string, content: string) {
  writeFileSync(file, content);
  chmodSync(file, 0o755);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "db-backup-test-"));
  bin = path.join(dir, "bin");
  out = path.join(dir, "out");
  callLog = path.join(dir, "calls.log");
  for (const d of [bin, out]) spawnSync("mkdir", ["-p", d]);
  // mysql falso: informa versão e sessão TLS conforme FAKE_SSL_VERSION (vazio ⇒ sem TLS).
  write(path.join(bin, "mysql"), `#!/usr/bin/env bash
echo "mysql $*" >> "$FAKE_CALL_LOG"
cnf="\${1#--defaults-extra-file=}"; cp "$cnf" "$FAKE_CNF_COPY" 2>/dev/null || true
[ "\${FAKE_MYSQL_EXIT:-0}" = "0" ] || exit "$FAKE_MYSQL_EXIT"
printf '9.4.0\\n'
printf 'Ssl_version\\t%s\\n' "\${FAKE_SSL_VERSION-TLSv1.3}"
printf 'Ssl_cipher\\tTLS_AES_256_GCM_SHA384\\n'
`);
  // mysqldump falso: dump > 1 KB com marcador final; modos de falha por FAKE_DUMP_MODE.
  write(path.join(bin, "mysqldump"), `#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "mysqldump  Ver 9.4.0 (sintético)"; exit 0; fi
echo "mysqldump $*" >> "$FAKE_CALL_LOG"
echo "-- MySQL dump sintético"
for i in $(seq 1 200); do echo "INSERT INTO t VALUES ($i,'$(printf %s "$i" | sha256sum | cut -c1-64)');"; done
case "\${FAKE_DUMP_MODE:-ok}" in
  fail) exit 2 ;;
  nomarker) exit 0 ;;
esac
echo "-- Dump completed on 2026-10-25"
`);
  // openssl: real, exceto quando FAKE_OPENSSL_FAIL=1 (simula falha de cifra).
  const realOpenssl = spawnSync("bash", ["-lc", "command -v openssl"]).stdout.toString().trim();
  write(path.join(bin, "openssl"), `#!/usr/bin/env bash
[ "\${FAKE_OPENSSL_FAIL:-0}" = "1" ] && { cat > /dev/null; exit 1; }
exec "${realOpenssl}" "$@"
`);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string | undefined>) {
  const base: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    HOME: dir,
    FAKE_CALL_LOG: callLog,
    FAKE_CNF_COPY: path.join(dir, "cnf-copy"),
    BACKUP_OUT_DIR: out,
    BACKUP_DATABASE_URL: DB_URL,
    BACKUP_ENCRYPTION_KEY: KEY,
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  const r = spawnSync("bash", [SCRIPT], { env: base, encoding: "utf8" });
  const logs = `${r.stdout}\n${r.stderr}`;
  return { status: r.status, logs, files: readdirSync(out) };
}

const calls = () => (existsSync(callLog) ? readFileSync(callLog, "utf8") : "");

function expectNoSecrets(logs: string) {
  expect(logs).not.toContain(PASSWORD);
  expect(logs).not.toContain(KEY);
  expect(logs).not.toContain("db.sintetico.invalid");
}

describe("db-backup.sh — falha fechada", () => {
  it("sem BACKUP_ENCRYPTION_KEY: falha antes de conectar e não gera arquivo", () => {
    const r = run({ BACKUP_ENCRYPTION_KEY: undefined });
    expect(r.status).not.toBe(0);
    expect(r.logs).toMatch(/BACKUP_ENCRYPTION_KEY ausente/);
    expect(calls()).toBe("");
    expect(r.files).toEqual([]);
  });

  it("sem BACKUP_DATABASE_URL: falha sem conectar", () => {
    const r = run({ BACKUP_DATABASE_URL: undefined });
    expect(r.status).not.toBe(0);
    expect(calls()).toBe("");
    expect(r.files).toEqual([]);
  });

  it("sessão sem TLS (Ssl_version vazio): aborta antes do dump, sem fallback", () => {
    const r = run({ FAKE_SSL_VERSION: "" });
    expect(r.status).not.toBe(0);
    expect(r.logs).toMatch(/Sessão sem TLS/);
    expect(calls()).not.toContain("mysqldump");
    expect(r.files).toEqual([]);
    expectNoSecrets(r.logs);
  });

  it("conexão TLS recusada: falha sem tentar texto puro", () => {
    const r = run({ FAKE_MYSQL_EXIT: "1" });
    expect(r.status).not.toBe(0);
    expect(calls()).not.toContain("mysqldump");
    expect(r.files).toEqual([]);
  });

  it("dump com erro no meio: nada publicável fica no diretório", () => {
    const r = run({ FAKE_DUMP_MODE: "fail" });
    expect(r.status).not.toBe(0);
    expect(r.files).toEqual([]);
    expectNoSecrets(r.logs);
  });

  it("dump sem marcador final (truncado): rejeitado", () => {
    const r = run({ FAKE_DUMP_MODE: "nomarker" });
    expect(r.status).not.toBe(0);
    expect(r.logs).toMatch(/Dump incompleto/);
    expect(r.files).toEqual([]);
  });

  it("falha de criptografia: nada publicável fica no diretório", () => {
    const r = run({ FAKE_OPENSSL_FAIL: "1" });
    expect(r.status).not.toBe(0);
    expect(r.files).toEqual([]);
  });
});

describe("db-backup.sh — caminho feliz", () => {
  it("gera só o artefato cifrado + checksum; decifra para o dump; TLS REQUIRED; sem segredos no log", () => {
    const r = run({});
    expect(r.status).toBe(0);
    const enc = r.files.find((f) => f.endsWith(".sql.gz.enc"));
    expect(enc).toMatch(/^backup-railway-\d{8}-\d{6}\.sql\.gz\.enc$/);
    expect(r.files.sort()).toEqual([enc, `${enc}.sha256`].sort());

    const encPath = path.join(out, enc!);
    const sum = readFileSync(`${encPath}.sha256`, "utf8").split(" ")[0];
    expect(sum).toBe(createHash("sha256").update(readFileSync(encPath)).digest("hex"));

    // Mesmo formato do drill de restauração: openssl enc -d -aes-256-cbc -pbkdf2 -salt | gunzip.
    const dec = spawnSync("bash", ["-c", `openssl enc -d -aes-256-cbc -pbkdf2 -salt -pass env:K -in "${encPath}" | gzip -dc`], {
      env: { ...process.env, K: KEY }, encoding: "utf8",
    });
    expect(dec.status).toBe(0);
    expect(dec.stdout).toContain("-- Dump completed");

    const cnf = readFileSync(path.join(dir, "cnf-copy"), "utf8");
    expect(cnf).toContain("ssl-mode=REQUIRED");
    expect(calls()).toMatch(/mysqldump --defaults-extra-file=\S+ --single-transaction --routines --triggers --events/);
    expect(calls()).not.toContain(PASSWORD);
    expect(r.logs).toMatch(/identidade do servidor NÃO verificada/);
    expect(r.logs).toMatch(/TLS TLSv1\.3/);
    expectNoSecrets(r.logs);
    // Arquivo de opções temporário (com a senha) não sobrevive à execução.
    expect(readdirSync(tmpdir()).some((d) => existsSync(path.join(tmpdir(), d, "client.cnf")))).toBe(false);
  });

  it("com BACKUP_DB_SSL_CA: VERIFY_CA com a CA informada", () => {
    const r = run({ BACKUP_DB_SSL_CA: "-----BEGIN CERTIFICATE-----\nSINTETICO\n-----END CERTIFICATE-----" });
    expect(r.status).toBe(0);
    const cnf = readFileSync(path.join(dir, "cnf-copy"), "utf8");
    expect(cnf).toContain("ssl-mode=VERIFY_CA");
    expect(cnf).toMatch(/ssl-ca=\S+server-ca\.pem/);
    expect(r.logs).toMatch(/VERIFY_CA/);
  });
});

describe("db-backup.yml — publicação", () => {
  const yml = readFileSync(WORKFLOW, "utf8");
  const backupJob = yml.slice(yml.indexOf("  backup:"), yml.indexOf("  restore-drill:"));

  it("o job de backup usa o script e não tem mais caminho sem cifra", () => {
    expect(backupJob).toContain("scripts/ops/db-backup.sh");
    expect(backupJob).not.toMatch(/NÃO cifrado|sem cifra \(apenas restrito/);
    expect(backupJob).not.toMatch(/mysqldump /);
  });

  it("upload só em sucesso e só do artefato cifrado + checksum", () => {
    const upload = backupJob.slice(backupJob.indexOf("actions/upload-artifact"));
    expect(backupJob).not.toMatch(/if:\s*(always|failure)\(\)/);
    expect(upload).toMatch(/\.sql\.gz\.enc/);
    expect(upload).toContain("if-no-files-found: error");
  });
});

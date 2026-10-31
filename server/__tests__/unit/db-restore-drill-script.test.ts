/**
 * SEC-AUD-2026-10 — harness sintético do drill de restauração (scripts/ops/db-restore-drill.sh).
 *
 * `mysql` é um script falso no PATH: registra cada chamada (argumentos + permissão do arquivo de CA), só aceita o
 * handshake quando o `--ssl-ca` recebido tem o conteúdo da CA esperada (simula VERIFY_CA) e responde às consultas
 * do drill com contagens sintéticas. `openssl` e `gzip` são reais; as CAs são certificados X.509 reais gerados aqui.
 * Nenhum banco real. Prova: CA do destino obrigatória e válida antes de conectar; VERIFY_CA + CA em TODAS as
 * chamadas ao destino; CA errada ou sessão sem TLS ⇒ nada restaurado; CA temporária 0600 e removida também em
 * falha; evidência só diz PASS quando tudo passou (falha ⇒ FAIL com a etapa e exit ≠ 0).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const SCRIPT = path.join(ROOT, "scripts/ops/db-restore-drill.sh");
const KEY = "chave-sintetica-do-drill-0123456789";
const TGT_PASS = "s3nha-sintetica-destino";
const TGT_URL = `mysql://drill:${TGT_PASS}@drill-target.invalid:44004/licigov_restore_drill`;
const SRC_URL = "mysql://backup:s3nha-origem@src.invalid:42002/railway";

let certs: string;
let CA_OK: string;
let CA_OTHER: string;
let dir: string;
let work: string;
let bin: string;
let tmp: string;
let calls: string;

function genCa(name: string): string {
  const key = path.join(certs, `${name}.key`);
  const crt = path.join(certs, `${name}.pem`);
  const r = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "1", "-subj", `/CN=${name}`], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return readFileSync(crt, "utf8");
}

beforeAll(() => {
  certs = mkdtempSync(path.join(tmpdir(), "drill-certs-"));
  CA_OK = genCa("ca-destino");
  CA_OTHER = genCa("ca-outra-instancia");
});
afterAll(() => rmSync(certs, { recursive: true, force: true }));

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "drill-test-"));
  work = path.join(dir, "drill-in");
  bin = path.join(dir, "bin");
  tmp = path.join(dir, "tmp");
  calls = path.join(dir, "calls.log");
  for (const d of [work, bin, tmp]) mkdirSync(d);
  writeFileSync(path.join(dir, "accepted-ca.pem"), CA_OK);
  // mysql falso: VERIFY_CA simulado (conteúdo do --ssl-ca precisa ser a CA esperada) + respostas sintéticas.
  writeFileSync(path.join(bin, "mysql"), `#!/usr/bin/env bash
ca=""; q=""
for a in "$@"; do case "$a" in --ssl-ca=*) ca="\${a#--ssl-ca=}" ;; esac; done
prev=""; for a in "$@"; do [ "$prev" = "-e" ] && q="$a"; prev="$a"; done
perm=$( [ -n "$ca" ] && stat -c %a "$ca" 2>/dev/null || echo none )
echo "ARGS $* | CAPERM $perm" >> "$FAKE_CALLS"
[ -n "$ca" ] && [ "$(grep -v '^$' "$ca" 2>/dev/null)" = "$(grep -v '^$' "$FAKE_ACCEPTED_CA")" ] || { echo "ERROR 2026 (HY000): SSL connection error: certificate verify failed" >&2; exit 1; }
if [ -z "$q" ]; then cat > /dev/null; touch "$FAKE_STATE"; exit 0; fi
case "$q" in
  "SELECT 1;") echo 1 ;;
  *Ssl_version*) if [ "\${FAKE_NO_TLS:-0}" = "1" ]; then printf 'Ssl_version\\t\\nSsl_cipher\\t\\n'; else printf 'Ssl_version\\tTLSv1.3\\nSsl_cipher\\tTLS_AES_256_GCM_SHA384\\n'; fi ;;
  *__drizzle_migrations*) echo "\${FAKE_MIG:-3}" ;;
  *table_name=*) echo 1 ;;
  *information_schema.tables*) if [ -f "$FAKE_STATE" ]; then echo 9; else echo "\${FAKE_PRE:-0}"; fi ;;
  *) echo 0 ;;
esac
`);
  chmodSync(path.join(bin, "mysql"), 0o755);
  // Artefato cifrado real (mesmo formato do backup) + checksum.
  const enc = "backup-staging-railway-20261031-000000.sql.gz.enc";
  const mk = spawnSync("bash", ["-c", `printf -- '-- dump sintético\\n-- Dump completed\\n' | gzip -c | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:K -out "${enc}" && sha256sum "${enc}" > "${enc}.sha256"`], {
    cwd: work, env: { ...process.env, K: KEY }, encoding: "utf8",
  });
  if (mk.status !== 0) throw new Error(mk.stderr);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string | undefined> = {}) {
  const base: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH ?? ""}`, HOME: dir, TMPDIR: tmp,
    FAKE_CALLS: calls, FAKE_STATE: path.join(dir, "restored"), FAKE_ACCEPTED_CA: path.join(dir, "accepted-ca.pem"),
    DB_TARGET: "staging", BACKUP_DATABASE_URL: SRC_URL, RESTORE_TARGET_URL: TGT_URL,
    RESTORE_DB_SSL_CA: CA_OK, BACKUP_ENCRYPTION_KEY: KEY,
  };
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete base[k]; else base[k] = v; }
  const r = spawnSync("bash", [SCRIPT], { cwd: work, env: base, encoding: "utf8" });
  const evidencePath = path.join(work, "restore-drill-evidence.md");
  return {
    status: r.status, logs: `${r.stdout}\n${r.stderr}`,
    evidence: existsSync(evidencePath) ? readFileSync(evidencePath, "utf8") : null,
    calls: existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : [],
    restored: existsSync(path.join(dir, "restored")),
  };
}

function expectNoSecrets(text: string) {
  for (const s of [TGT_PASS, KEY, "drill-target.invalid", "src.invalid", "s3nha-origem", "BEGIN CERTIFICATE"]) expect(text).not.toContain(s);
}

describe("db-restore-drill.sh — CA do destino obrigatória antes de conectar", () => {
  it("sem RESTORE_DB_SSL_CA ⇒ falha sem nenhuma conexão; evidência FAIL", () => {
    const r = run({ RESTORE_DB_SSL_CA: undefined });
    expect(r.status).not.toBe(0);
    expect(r.logs).toMatch(/RESTORE_DB_SSL_CA ausente/);
    expect(r.calls).toEqual([]);
    expect(r.evidence).toMatch(/FAIL/);
    expect(r.evidence).not.toMatch(/\| PASS \|/);
  });

  it("CA que não é certificado, ou que contém chave privada ⇒ recusada antes de conectar", () => {
    const key = readFileSync(path.join(certs, "ca-destino.key"), "utf8");
    for (const bad of ["qualquer coisa", "-----BEGIN CERTIFICATE-----\nlixo\n-----END CERTIFICATE-----", `${CA_OK}\n${key}`]) {
      const r = run({ RESTORE_DB_SSL_CA: bad });
      expect(r.status).not.toBe(0);
      expect(r.calls).toEqual([]);
      expect(r.restored).toBe(false);
      expectNoSecrets(r.logs);
    }
  });
});

describe("db-restore-drill.sh — TLS VERIFY_CA em todas as conexões", () => {
  it("caminho feliz: toda chamada ao destino usa --ssl-mode=VERIFY_CA e a CA (0600); PASS registra o modo TLS", () => {
    const r = run();
    expect(r.status, r.logs).toBe(0);
    expect(r.restored).toBe(true);
    expect(r.calls.length).toBeGreaterThan(10); // pré-checagens + importação + validações
    for (const c of r.calls) {
      expect(c).toContain("--ssl-mode=VERIFY_CA");
      expect(c).toMatch(/--ssl-ca=\S+restore-target-ca\.pem/);
      expect(c).toContain("--protocol=TCP");
      expect(c).toContain("CAPERM 600");
      expect(c).not.toMatch(/PREFERRED|DISABLED|ssl-mode=REQUIRED|--skip-ssl|--ssl=0/);
    }
    expect(r.evidence).toMatch(/\| Resultado agregado \| PASS \|/);
    expect(r.evidence).toMatch(/VERIFY_CA com RESTORE_DB_SSL_CA; TLSv1\.3/);
    expect(r.evidence).toMatch(/hostname NÃO conferido/);
    expect(r.evidence).toMatch(/não verificados pelo script/); // descartabilidade não é inferida
    expect(r.logs).toMatch(/NÃO prova que a instância é descartável/);
    expect(r.logs).not.toMatch(/descartável confirmado/);
    expectNoSecrets(r.logs + (r.evidence ?? ""));
    expect(readdirSync(tmp)).toEqual([]); // CA temporária removida
  });

  it("CA de OUTRA instância ⇒ handshake recusado, nada restaurado, evidência FAIL na etapa de TLS, CA removida", () => {
    const r = run({ RESTORE_DB_SSL_CA: CA_OTHER });
    expect(r.status).not.toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.restored).toBe(false);
    expect(r.logs).toMatch(/certificado não confere com RESTORE_DB_SSL_CA/);
    expect(r.evidence).toMatch(/Etapa que falhou \| conexão TLS ao destino/);
    expect(r.evidence).toMatch(/FAIL/);
    expect(r.evidence).not.toMatch(/\| PASS \|/);
    expect(readdirSync(tmp)).toEqual([]);
    expectNoSecrets(r.logs + (r.evidence ?? ""));
  });

  it("sessão sem TLS (Ssl_version vazio) ⇒ aborta antes de restaurar", () => {
    const r = run({ FAKE_NO_TLS: "1" });
    expect(r.status).not.toBe(0);
    expect(r.logs).toMatch(/sem TLS/);
    expect(r.restored).toBe(false);
    expect(r.evidence).not.toMatch(/\| PASS \|/);
  });
});

describe("db-restore-drill.sh — PASS só quando todas as etapas passam", () => {
  it("destino não vazio ⇒ recusa antes de restaurar; evidência FAIL", () => {
    const r = run({ FAKE_PRE: "345" });
    expect(r.status).not.toBe(0);
    expect(r.restored).toBe(false);
    expect(r.evidence).toMatch(/Etapa que falhou \| destino vazio/);
  });

  it("falha numa validação pós-restauração (journal vazio) ⇒ exit ≠ 0 e evidência FAIL, nunca PASS", () => {
    const r = run({ FAKE_MIG: "0" });
    expect(r.status).not.toBe(0);
    expect(r.restored).toBe(true);
    expect(r.evidence).toMatch(/Etapa que falhou \| validações pós-restauração/);
    expect(r.evidence).not.toMatch(/\| PASS \|/);
    expect(readdirSync(work).filter((f) => /\.sql|\.enc/.test(f))).toEqual([]); // dumps limpos também em falha
    expect(readdirSync(tmp)).toEqual([]);
  });

  it("checksum adulterado ⇒ nada restaurado", () => {
    const sha = readdirSync(work).find((f) => f.endsWith(".sha256"))!;
    writeFileSync(path.join(work, sha), `${"0".repeat(64)}  ${sha.replace(/\.sha256$/, "")}\n`);
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.restored).toBe(false);
    expect(r.evidence).toMatch(/Etapa que falhou \| artefato cifrado e checksum/);
  });

  it("evidência de execução anterior nunca é reaproveitada", () => {
    writeFileSync(path.join(work, "restore-drill-evidence.md"), "| Resultado agregado | PASS |\n");
    const r = run({ RESTORE_DB_SSL_CA: undefined });
    expect(r.status).not.toBe(0);
    expect(r.evidence).not.toMatch(/\| PASS \|/);
  });
});

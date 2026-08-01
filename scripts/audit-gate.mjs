#!/usr/bin/env node
/**
 * PR D — Gate de auditoria de dependências com BASELINE.
 *
 * Roda `pnpm audit --prod --json`, coleta as advisories high/critical e FALHA (exit 1) se
 * houver alguma NOVA (GHSA) que não esteja no baseline (`security/audit-baseline.json`). Assim,
 * a dívida PRÉ-EXISTENTE não bloqueia o CI, mas qualquer REGRESSÃO (nova vulnerabilidade
 * high/critical) quebra o pipeline — sem `|| true`, sem mascarar.
 *
 * Reduzir o baseline (via upgrades de dependências) é ação operacional (OPERATOR_ACTION_REQUIRED).
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";

const BASELINE_PATH = "security/audit-baseline.json";
const BLOCKING = new Set(["critical", "high"]);

function runAudit() {
  try {
    const out = execSync("pnpm audit --prod --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(out);
  } catch (err) {
    // pnpm audit sai com código != 0 quando há vulnerabilidades; o JSON ainda vem no stdout.
    const out = err.stdout ? err.stdout.toString() : "";
    if (!out) {
      console.error("Falha ao executar `pnpm audit --prod --json`:", err.message);
      process.exit(2);
    }
    return JSON.parse(out);
  }
}

const baseline = existsSync(BASELINE_PATH)
  ? new Set((JSON.parse(readFileSync(BASELINE_PATH, "utf8")).allowed) || [])
  : new Set();

const audit = runAudit();
const advisories = Object.values(audit.advisories || {});
const blocking = advisories
  .filter((a) => BLOCKING.has(a.severity))
  .map((a) => ({ ghsa: a.github_advisory_id || String(a.id), sev: a.severity, mod: a.module_name }));

const uniqueGhsa = new Set(blocking.map((b) => b.ghsa));
const fresh = [...uniqueGhsa].filter((g) => !baseline.has(g));

console.log(`[audit-gate] high/critical (prod): ${uniqueGhsa.size} advisories; baseline permite ${baseline.size}.`);

if (fresh.length > 0) {
  console.error(`\n❌ ${fresh.length} vulnerabilidade(s) NOVA(S) high/critical fora do baseline:`);
  for (const g of fresh) {
    const item = blocking.find((b) => b.ghsa === g);
    console.error(`   - ${item.sev.toUpperCase()} ${g} (${item.mod})`);
  }
  console.error("\nCorrija a dependência (upgrade) ou, com justificativa explícita, adicione o GHSA a");
  console.error(`${BASELINE_PATH}. O baseline nunca deve crescer silenciosamente.`);
  process.exit(1);
}

// Info: baseline com entradas já resolvidas (candidatas a limpeza — não bloqueante).
const stale = [...baseline].filter((g) => !uniqueGhsa.has(g));
if (stale.length > 0) {
  console.log(`[audit-gate] ${stale.length} entrada(s) do baseline não aparece(m) mais (candidatas a remoção).`);
}

console.log("✅ Nenhuma vulnerabilidade high/critical NOVA fora do baseline. Gate OK.");

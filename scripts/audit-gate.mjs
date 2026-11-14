#!/usr/bin/env node
/**
 * PR D — Gate de auditoria de dependências com BASELINE.
 *
 * Roda `pnpm audit --prod --json`, coleta as advisories high/critical e FALHA (exit 1) se
 * houver alguma NOVA (GHSA) que não esteja no baseline (`security/audit-baseline.json`). Assim,
 * a dívida PRÉ-EXISTENTE não bloqueia o CI, mas qualquer REGRESSÃO (nova vulnerabilidade
 * high/critical) quebra o pipeline — sem `|| true`, sem mascarar.
 *
 * SEC-AUD-2026-10 — fail-closed também no FORMATO: saída sem `advisories`/`metadata` (erro do
 * registry, rede) falha com exit 2 em vez de aprovar como "0 advisories". Lógica em audit-gate-lib.mjs.
 *
 * Reduzir o baseline (via upgrades de dependências) é ação operacional (OPERATOR_ACTION_REQUIRED).
 */
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { auditShapeError, evaluateAudit } from "./audit-gate-lib.mjs";

const BASELINE_PATH = "security/audit-baseline.json";

function runAudit() {
  let out;
  try {
    out = execSync("pnpm audit --prod --json", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch (err) {
    // pnpm audit sai com código != 0 quando há vulnerabilidades; o JSON ainda vem no stdout.
    out = err.stdout ? err.stdout.toString() : "";
    if (!out) {
      console.error("Falha ao executar `pnpm audit --prod --json`:", err.message);
      process.exit(2);
    }
  }
  try {
    return JSON.parse(out);
  } catch {
    console.error("❌ Saída do `pnpm audit --prod --json` não é JSON válido — gate falha (fail-closed).");
    process.exit(2);
  }
}

const allowed = existsSync(BASELINE_PATH)
  ? (JSON.parse(readFileSync(BASELINE_PATH, "utf8")).allowed) || []
  : [];

const audit = runAudit();
const shapeError = auditShapeError(audit);
if (shapeError) {
  console.error(`❌ Resultado do pnpm audit inutilizável (${shapeError}) — gate falha (fail-closed).`);
  process.exit(2);
}

const { found, fresh, stale } = evaluateAudit(audit, allowed);

console.log(`[audit-gate] high/critical (prod): ${found.size} advisories; baseline permite ${allowed.length}.`);

if (fresh.length > 0) {
  console.error(`\n❌ ${fresh.length} vulnerabilidade(s) NOVA(S) high/critical fora do baseline:`);
  for (const item of fresh) {
    console.error(`   - ${item.sev.toUpperCase()} ${item.ghsa} (${item.mod})`);
  }
  console.error("\nCorrija a dependência (upgrade) ou, com justificativa explícita, adicione o GHSA a");
  console.error(`${BASELINE_PATH}. O baseline nunca deve crescer silenciosamente.`);
  process.exit(1);
}

// Info: baseline com entradas já resolvidas (candidatas a limpeza — não bloqueante).
if (stale.length > 0) {
  console.log(`[audit-gate] ${stale.length} entrada(s) do baseline não aparece(m) mais (candidatas a remoção).`);
}

console.log("✅ Nenhuma vulnerabilidade high/critical NOVA fora do baseline. Gate OK.");

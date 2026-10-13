/**
 * Registro CONTROLADO de um pacote CANDIDATO como DRAFT numa identidade existente.
 *
 *   # SNAPSHOT — SOMENTE LEITURA da organização: identidades de Edital, revisões (status/hash), vínculos ativos e flag; sem conteúdo nem dados de processo
 *   pnpm tsx scripts/register-model-candidate.ts --mode=snapshot --organization-id=<id> [--json]
 *
 *   # PLANO (padrão) — SOMENTE LEITURA: verifica o pacote, a identidade, a Revisão 1 publicada, registros prévios e vínculos; não grava nada
 *   pnpm tsx scripts/register-model-candidate.ts --organization-id=<id> --identity-id=<id> --package-version=1.0.2-draft \
 *     --expect-semantic-hash=<hex64> --expect-baseline-hash=<hex64> --expect-source-sha256=<hex64> [--json]
 *
 *   # EXECUÇÃO — escreve SOMENTE DRAFT + procedência (nunca aprova/publica/vincula, nunca liga flag, nunca compõe documento)
 *   CANDIDATE_EXECUTOR_EMAIL=... CANDIDATE_EXECUTOR_PASSWORD=... \
 *   pnpm tsx scripts/register-model-candidate.ts --mode=execute ...(mesmos ids)... --authority-file=authority.json \
 *     --confirm=REGISTER_CANDIDATE_DRAFT:<org>:<identity>:<hash12> --expect-database=<nome do banco> --allow-production
 *
 * Guardas (valem em QUALQUER ambiente; APP_ENV/NODE_ENV são rótulos e nunca dispensam nenhuma): `--allow-production` + `--confirm` exato +
 * `--expect-database` conferido contra o banco realmente conectado. O ATOR é o usuário AUTENTICADO pela credencial do próprio sistema
 * (e-mail + senha por variáveis de ambiente, nunca por argumento): precisa ser membro ATIVO da organização com papel ≥ operator; `--actor-user-id`
 * não existe mais. A autoridade (nome/cargo/data/base/motivo) vem do arquivo e é amarrada ao usuário autenticado; nunca é inventada.
 * Não imprime DATABASE_URL, senhas, segredos nem conteúdo do modelo. Ver docs/ops/EDITAL_REVISION2_PUBLICATION_RUNBOOK.md.
 */
import { readFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";

const arg = (name: string): string | undefined => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name: string): boolean => process.argv.slice(2).includes(`--${name}`);
const need = (name: string): string => { const v = arg(name); if (!v) throw new Error(`parâmetro obrigatório ausente: --${name}`); return v; };
const hex64 = (name: string): string => { const v = need(name); if (!/^[0-9a-f]{64}$/.test(v)) throw new Error(`--${name} inválido (64 hex minúsculos)`); return v; };
const posInt = (name: string): number => { const n = Number(need(name)); if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`--${name} inválido`); return n; };

export async function main(): Promise<number> {
  const mode = arg("mode") ?? "plan";
  if (mode !== "plan" && mode !== "execute" && mode !== "snapshot") throw new Error("--mode deve ser plan, execute ou snapshot");
  // O ator NUNCA é digitado: é o usuário autenticado pela credencial do sistema (ver cabeçalho).
  if (process.argv.slice(2).some((a) => a.startsWith("--actor-user-id"))) throw new Error("--actor-user-id não existe mais: o ator é o usuário autenticado por CANDIDATE_EXECUTOR_EMAIL/CANDIDATE_EXECUTOR_PASSWORD");
  const organizationId = posInt("organization-id");
  if (mode === "snapshot") {
    const { createTemplateWorkflowPorts } = await import("../server/services/institutionalTemplates/integration");
    const { snapshotOrganizationTemplates } = await import("../server/services/institutionalTemplates/candidateRegistrationService");
    const { isFeatureEnabled } = await import("../server/services/featureFlagService");
    const { BLL_MODEL_KEY } = await import("../server/services/institutionalTemplates/modelPackages");
    const snap = await snapshotOrganizationTemplates(createTemplateWorkflowPorts(), organizationId, {
      baselineSemanticHash: arg("expect-baseline-hash") ?? "e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d",
      semanticHash: arg("expect-semantic-hash") ?? "33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd",
    }, await isFeatureEnabled("FF_INSTITUTIONAL_TEMPLATES_V1", organizationId), { modelKey: BLL_MODEL_KEY, packageVersion: arg("package-version") ?? "1.0.2-draft" });
    console.info(JSON.stringify(snap, null, has("json") ? 2 : 0));
    return 0;
  }
  const identityId = need("identity-id");
  const packageVersion = need("package-version");
  const expected = { semanticHash: hex64("expect-semantic-hash"), baselineSemanticHash: hex64("expect-baseline-hash"), sourceSha256: hex64("expect-source-sha256") };
  const envLabel = process.env.APP_ENV ?? process.env.NODE_ENV ?? "(ausente)";      // rótulo informativo — nunca decide nenhuma guarda

  const { createTemplateWorkflowPorts } = await import("../server/services/institutionalTemplates/integration");
  const { planCandidateRegistration, registerCandidateDraft } = await import("../server/services/institutionalTemplates/candidateRegistrationService");
  const { BLL_MODEL_KEY } = await import("../server/services/institutionalTemplates/modelPackages");
  const { bindAuthorityToExecutor, databaseMatches, executionGuardFailures, executorCredentialsFromEnv } = await import("../server/domain/institutionalTemplates/candidateExecution");
  const runId = arg("run-id") ?? String(Date.now());
  const base = { organizationId, identityId, runId, modelKey: BLL_MODEL_KEY, packageVersion, expected };

  if (mode === "plan") {
    const ports = createTemplateWorkflowPorts();
    const plan = await planCandidateRegistration(ports, base);
    console.info(has("json") ? JSON.stringify({ mode, envLabel, plan }, null, 2) : formatPlan(plan, envLabel));
    return plan.ok ? 0 : 1;
  }

  // ── EXECUÇÃO: guardas independentes de ambiente → credencial → banco → autoridade → registro ──
  const confirmExpected = `REGISTER_CANDIDATE_DRAFT:${organizationId}:${identityId}:${expected.semanticHash.slice(0, 12)}`;
  const failures = executionGuardFailures({ confirm: arg("confirm"), confirmExpected, allowProduction: has("allow-production"), expectDatabase: arg("expect-database"), appEnv: process.env.APP_ENV, nodeEnv: process.env.NODE_ENV });
  if (failures.length) throw new Error(failures.join(" | "));
  const creds = executorCredentialsFromEnv(process.env);
  const authorityRaw = JSON.parse(readFileSync(need("authority-file"), "utf8")) as Record<string, unknown>;

  const { getDb } = await import("../server/db/connection");
  const db = await getDb();
  if (!db) throw new Error("banco indisponível");
  const { sql } = await import("drizzle-orm");
  const [rows] = (await db.execute(sql`SELECT DATABASE() AS d`)) as unknown as [Array<{ d: string | null }>];
  if (!databaseMatches(need("expect-database"), rows?.[0]?.d)) throw new Error("RECUSADO: o banco conectado não é o informado em --expect-database (nada foi alterado)");

  const { authenticateExecutor } = await import("../server/services/institutionalTemplates/candidateExecutorAuthService");
  const { getUserByEmail } = await import("../server/db/users");
  const { getActiveMemberRole } = await import("../server/db/organizations");
  const { verifyPassword } = await import("../server/services/passwordSecurity");
  const executor = await authenticateExecutor({ getUserByEmail, verifyPassword, getActiveMemberRole }, organizationId, creds);
  const decision = bindAuthorityToExecutor(authorityRaw, executor.userId);

  const result = await registerCandidateDraft(createTemplateWorkflowPorts(), {
    ...base, actorUserId: executor.userId, decision,
    executorContext: { authenticatedUserId: executor.userId, role: executor.role, osUser: userInfo().username, host: hostname(), pid: process.pid, envLabel },
  });
  console.info(has("json") ? JSON.stringify({ mode, envLabel, actorUserId: executor.userId, result }, null, 2)
    : `${formatPlan(result.plan, envLabel)}\nExecutado por usuário autenticado ${executor.userId}: ${result.performed} · revisão ${result.revisionId ?? "—"} · procedência ${result.provenance}`);
  return result.provenance === "FAILED" ? 3 : 0;
}

function formatPlan(plan: import("../server/services/institutionalTemplates/candidateRegistrationService").CandidatePlan, envLabel: string): string {
  const lines = [`Registro de candidato — org ${plan.organizationId} · identidade ${plan.identityId} · rótulo de ambiente (informativo): ${envLabel}`];
  for (const c of plan.checks) lines.push(`  [${c.ok ? "OK " : "FALHA"}] ${c.id} — ${c.detail}`);
  lines.push(`Revisões da identidade: ${plan.revisions.map((r) => `#${r.revision} ${r.status} ${r.semanticHash.slice(0, 12)}…`).join(" · ") || "—"}`);
  lines.push(`Vínculos ativos da identidade: ${plan.activeBindings.length}`);
  lines.push(`Ação planejada: ${plan.action}${plan.candidateRevisionId ? ` (candidata já existe: ${plan.candidateStatus})` : ""} · plano ${plan.ok ? "APTO" : "RECUSADO"}`);
  return lines.join("\n");
}

if (process.argv[1] && /register-model-candidate\.[tj]s$/.test(process.argv[1])) {
  main().then((code) => process.exit(code)).catch((err) => { console.error(`❌ ${err instanceof Error ? err.message : String(err)}`); process.exit(2); });
}

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
 *   pnpm tsx scripts/register-model-candidate.ts --mode=execute ...(mesmos ids)... --actor-user-id=<id> --authority-file=authority.json \
 *     --confirm=REGISTER_CANDIDATE_DRAFT:<org>:<identity>:<hash12> [--allow-production]
 *
 * Guardas: em produção a execução exige `--allow-production` E o `--confirm` com os identificadores exatos; o ator precisa ser membro ATIVO
 * da organização com papel de ao menos "operator" (piso de registrar); a autoridade (nome/cargo/data/base/motivo) vem do arquivo, nunca é
 * inventada. Não imprime DATABASE_URL, segredos nem conteúdo do modelo. Ver docs/ops/EDITAL_REVISION2_PUBLICATION_RUNBOOK.md.
 */
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { organizationMembers } from "../drizzle/schema";

const arg = (name: string): string | undefined => process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const has = (name: string): boolean => process.argv.slice(2).includes(`--${name}`);
const need = (name: string): string => { const v = arg(name); if (!v) throw new Error(`parâmetro obrigatório ausente: --${name}`); return v; };
const hex64 = (name: string): string => { const v = need(name); if (!/^[0-9a-f]{64}$/.test(v)) throw new Error(`--${name} inválido (64 hex minúsculos)`); return v; };
const posInt = (name: string): number => { const n = Number(need(name)); if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`--${name} inválido`); return n; };
const ROLE_RANK: Record<string, number> = { viewer: 0, operator: 1, manager: 2, admin: 3, owner: 4 };

export async function main(): Promise<number> {
  const mode = arg("mode") ?? "plan";
  if (mode !== "plan" && mode !== "execute" && mode !== "snapshot") throw new Error("--mode deve ser plan, execute ou snapshot");
  const organizationId = posInt("organization-id");
  if (mode === "snapshot") {
    const { createTemplateWorkflowPorts } = await import("../server/services/institutionalTemplates/integration");
    const { snapshotOrganizationTemplates } = await import("../server/services/institutionalTemplates/candidateRegistrationService");
    const { isFeatureEnabled } = await import("../server/services/featureFlagService");
    const snap = await snapshotOrganizationTemplates(createTemplateWorkflowPorts(), organizationId, {
      baselineSemanticHash: arg("expect-baseline-hash") ?? "e62297e16e4d3c2e0bbef5d288f1a0e675675c4d741f6b2afe1d5c265431da5d",
      semanticHash: arg("expect-semantic-hash") ?? "33ee30bc76b79fa92dfe7952e5e6fbce1c5e830d8da9227d3333bac68a63c0cd",
    }, await isFeatureEnabled("FF_INSTITUTIONAL_TEMPLATES_V1", organizationId));
    console.info(JSON.stringify(snap, null, has("json") ? 2 : 0));
    return 0;
  }
  const identityId = need("identity-id");
  const packageVersion = need("package-version");
  const expected = { semanticHash: hex64("expect-semantic-hash"), baselineSemanticHash: hex64("expect-baseline-hash"), sourceSha256: hex64("expect-source-sha256") };
  const production = (process.env.APP_ENV ?? process.env.NODE_ENV) === "production";

  const { createTemplateWorkflowPorts } = await import("../server/services/institutionalTemplates/integration");
  const { planCandidateRegistration, registerCandidateDraft } = await import("../server/services/institutionalTemplates/candidateRegistrationService");
  const { BLL_MODEL_KEY } = await import("../server/services/institutionalTemplates/modelPackages");
  const ports = createTemplateWorkflowPorts();
  const runId = arg("run-id") ?? String(Date.now());
  const base = { organizationId, identityId, runId, modelKey: BLL_MODEL_KEY, packageVersion, expected };

  if (mode === "plan") {
    const plan = await planCandidateRegistration(ports, { ...base, actorUserId: Number(arg("actor-user-id") ?? 1), decision: { decidedByName: "-", decidedByRole: "-", decidedAt: "1970-01-01", basisReference: "-", reason: "-" } });
    console.info(has("json") ? JSON.stringify({ mode, production, plan }, null, 2) : formatPlan(plan, production));
    return plan.ok ? 0 : 1;
  }

  const actorUserId = posInt("actor-user-id");
  const confirmWanted = `REGISTER_CANDIDATE_DRAFT:${organizationId}:${identityId}:${expected.semanticHash.slice(0, 12)}`;
  if (arg("confirm") !== confirmWanted) throw new Error(`--confirm deve ser exatamente: ${confirmWanted}`);
  if (production && !has("allow-production")) throw new Error("RECUSADO: execução em produção exige --allow-production (decisão humana explícita)");
  const authority = JSON.parse(readFileSync(need("authority-file"), "utf8")) as Record<string, unknown>;
  for (const k of ["decidedByName", "decidedByRole", "decidedAt", "basisReference", "reason"]) {
    if (typeof authority[k] !== "string" || !(authority[k] as string).trim()) throw new Error(`authority-file: campo obrigatório ausente: ${k}`);
  }
  const { getDb } = await import("../server/db/connection");
  const db = await getDb();
  if (!db) throw new Error("banco indisponível");
  const m = (await db.select().from(organizationMembers).where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, actorUserId))).limit(1))[0];
  if (!m || !m.ativo || (ROLE_RANK[m.role] ?? -1) < ROLE_RANK.operator) throw new Error("o ator precisa ser membro ATIVO desta organização com papel de ao menos operator");

  const result = await registerCandidateDraft(ports, { ...base, actorUserId, decision: authority as never });
  console.info(has("json") ? JSON.stringify({ mode, production, result }, null, 2) : `${formatPlan(result.plan, production)}\nExecutado: ${result.performed} · revisão ${result.revisionId ?? "—"} · procedência ${result.provenance}`);
  return result.provenance === "FAILED" ? 3 : 0;
}

function formatPlan(plan: import("../server/services/institutionalTemplates/candidateRegistrationService").CandidatePlan, production: boolean): string {
  const lines = [`Registro de candidato — org ${plan.organizationId} · identidade ${plan.identityId} · ambiente ${production ? "PRODUÇÃO" : "não-produção"}`];
  for (const c of plan.checks) lines.push(`  [${c.ok ? "OK " : "FALHA"}] ${c.id} — ${c.detail}`);
  lines.push(`Revisões da identidade: ${plan.revisions.map((r) => `#${r.revision} ${r.status} ${r.semanticHash.slice(0, 12)}…`).join(" · ") || "—"}`);
  lines.push(`Vínculos ativos da identidade: ${plan.activeBindings.length}`);
  lines.push(`Ação planejada: ${plan.action}${plan.candidateRevisionId ? ` (candidata já existe: ${plan.candidateStatus})` : ""} · plano ${plan.ok ? "APTO" : "RECUSADO"}`);
  return lines.join("\n");
}

if (process.argv[1] && /register-model-candidate\.[tj]s$/.test(process.argv[1])) {
  main().then((code) => process.exit(code)).catch((err) => { console.error(`❌ ${err instanceof Error ? err.message : String(err)}`); process.exit(2); });
}

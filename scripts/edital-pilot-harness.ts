/**
 * Harness do piloto Edital — CLI. NÃO é executado em produção; NÃO liga feature flag; NÃO toca o processo 2026/253.
 *
 *   # dry-run (padrão): ports em memória + fixture SINTÉTICA; sem banco, sem rede, sem efeitos
 *   pnpm tsx scripts/edital-pilot-harness.ts --mode=dry-run --confirm=REGISTER,LEGAL_EVIDENCE,APPROVE,PUBLISH,BIND
 *   # opções de simulação (dry-run): --simulate-lane-a-scope (persistência grava forma/plataforma) · --all-capabilities ·
 *   #   --with-items (tabela dinâmica ITEMS) · --with-certame (entrada CERTAME_CONFIG) · --accept-blockers=ID1,ID2
 *
 *   # staging (ports REAIS; exige APP_ENV=staging|development, flag já LIGADA para a organização de TESTE pelo operador):
 *   APP_ENV=staging pnpm tsx scripts/edital-pilot-harness.ts --mode=staging --organization-id=<id> --actor-user-id=<id> \
 *     --process-id=<id-do-processo-de-TESTE> --ast-file=... --inventory-file=... --source-version=1.0.1-draft --source-sha256=<hex> \
 *     --authority-file=authority.json --confirm=REGISTER,APPROVE,PUBLISH,BIND
 *
 * Os passos de DECISÃO HUMANA só rodam se listados em --confirm (uma pessoa os confirmou, com a autoridade de --authority-file).
 * Os passos 10–12 (revisão humana, revalidação, emissão do artefato de teste) são SEMPRE humanos: o harness só imprime a rota.
 * Ver docs/architecture/EDITAL_PILOT_RUNBOOK.md.
 */
import { readFileSync } from "node:fs";
import { MODEL_REGISTRATION_PRESETS } from "../server/services/institutionalTemplates/modelRegistrationService";
import { PILOT_STEP_IDS, runEditalPilot, type PilotInput, type PilotReport, type PilotStepId } from "../server/services/institutionalTemplates/pilot/editalPilotHarness";
import { ALL_CAPABILITIES, BASELINE_CAPABILITIES_D4BB209, buildPilotAst, buildPilotCatalog, buildPilotInventory, PILOT_SOURCE_LOGICAL_VERSION, pilotSourceSha256 } from "../server/services/institutionalTemplates/pilot/editalPilotFixture";
import { SCOPE_DIMENSIONS } from "../server/domain/institutionalTemplates/governance/scopeDimensions";
import type { WorkflowContext } from "../server/services/institutionalTemplates/ports";

const FORBIDDEN_PROCESS_NUMBER = "2026/253";

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}
const has = (name: string): boolean => process.argv.slice(2).includes(`--${name}`);

function parseConfirm(): Set<PilotStepId> {
  const raw = (arg("confirm") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const bad = raw.filter((s) => !(PILOT_STEP_IDS as readonly string[]).includes(s));
  if (bad.length) throw new Error(`passos desconhecidos em --confirm: ${bad.join(", ")}`);
  return new Set(raw as PilotStepId[]);
}

export function formatReport(r: PilotReport, mode = "?"): string {
  const flag = r.featureEnabledForOrganization ? (mode === "dry-run" ? "LIGADA (simulada em memória)" : "LIGADA (pelo operador; o harness não a liga)") : "OFF";
  const lines = [`Harness piloto Edital — modo ${mode} — run ${r.runId} — flag da organização: ${flag}`];
  for (const s of r.steps) lines.push(`${String(s.order).padStart(2)}. [${s.status}] ${s.id} — ${s.title}\n      ${s.detail}`);
  lines.push(`Concluído até: ${r.completedThrough ?? "—"} · parou em: ${r.stoppedAt ?? "—"}`);
  if (r.readiness) lines.push(`Matriz: ${r.readiness.overall} (${r.readiness.summary.pass} PASS / ${r.readiness.summary.blocked} BLOCKED / ${r.readiness.summary.notApplicable} N/A) hash ${r.readiness.matrixHash.slice(0, 16)}…`);
  lines.push(`Segurança: ${JSON.stringify(r.safety)}`);
  return lines.join("\n");
}

async function dryRun(): Promise<PilotReport> {
  // Test doubles em memória (nunca carregados em produção: só este modo da CLI os importa).
  const { makeTestPorts } = await import("../server/__tests__/helpers/institutionalTemplatesFakes");
  const opts = { withItemsTable: has("with-items"), withCertameConfig: has("with-certame") };
  const catalog = buildPilotCatalog(opts);
  const { ports: full } = makeTestPorts({
    catalog, capabilities: has("all-capabilities") ? ALL_CAPABILITIES : has("simulate-lane-a-scope") ? { ...BASELINE_CAPABILITIES_D4BB209, scopeDimensions: SCOPE_DIMENSIONS } : BASELINE_CAPABILITIES_D4BB209,
  });
  const ast = buildPilotAst(opts);
  const preset = MODEL_REGISTRATION_PRESETS[0];
  const ctx: WorkflowContext = { organizationId: 1, actor: { kind: "human", userId: 1 }, correlationId: "pilot-dry-run" };
  const input: PilotInput = {
    ctx, ports: full, runId: arg("run-id") ?? "dry1",
    registration: {
      target: { kind: "NEW_IDENTITY", documentKind: preset.documentKind, slug: preset.slug }, templateKey: preset.templateKey, displayName: preset.displayName,
      declaredScope: { ...preset.scope, regime: "EMPREITADA_PRECO_UNITARIO", criterion: "MENOR_PRECO" }, source: { kind: "AST", ast },
      sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(ast), inventory: buildPilotInventory(ast, opts),
    },
    authority: { decidedByName: "Operador do piloto (dry-run)", decidedByRole: "Responsável técnico", decidedAt: "2026-10-07", basisReference: "Roteiro do piloto (dry-run, dados sintéticos)", reason: "Execução de teste com dados sintéticos em memória." },
    // evidência SINTÉTICA de teste: sem parecer/protocolo/procurador (nada é inventado)
    legalEvidence: { sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(ast) },
    bindingScope: { ...preset.scope, regime: "EMPREITADA_PRECO_UNITARIO", criterion: "MENOR_PRECO" },
    previewContext: { scope: { ...preset.scope, regime: "EMPREITADA_PRECO_UNITARIO", criterion: "MENOR_PRECO" }, sampleValues: { "processo.numero": "TESTE/0001", ...Object.fromEntries(Array.from({ length: 48 }, (_, i) => [`ent.i${String(i + 1).padStart(3, "0")}`, i % 2 ? "SIM" : "NAO"])) } },
    inventory: buildPilotInventory(ast, opts),
    confirmedSteps: parseConfirm(), acceptedBlockers: (arg("accept-blockers") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
  return runEditalPilot(input);
}

async function staging(): Promise<PilotReport> {
  const appEnv = process.env.APP_ENV ?? process.env.NODE_ENV ?? "";
  if (appEnv === "production" || process.env.NODE_ENV === "production") throw new Error("RECUSADO: o harness nunca roda em produção");
  if (appEnv !== "staging" && appEnv !== "development") throw new Error("RECUSADO: defina APP_ENV=staging (ou development)");
  const need = (n: string): string => { const v = arg(n); if (!v) throw new Error(`parâmetro obrigatório ausente: --${n}`); return v; };
  const organizationId = Number(need("organization-id")); const actorUserId = Number(need("actor-user-id")); const processId = need("process-id");
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0 || !Number.isSafeInteger(actorUserId) || actorUserId <= 0) throw new Error("ids inválidos");
  const { getProcess } = await import("../server/db/procurement");
  const proc = await getProcess(processId, organizationId);
  if (!proc) throw new Error("processo de teste não encontrado nesta organização");
  if (String(proc.processNumber) === FORBIDDEN_PROCESS_NUMBER) throw new Error(`RECUSADO: o processo ${FORBIDDEN_PROCESS_NUMBER} nunca é tocado pelo harness`);

  const { createTemplateCompositionPorts, createTemplateWorkflowPorts } = await import("../server/services/institutionalTemplates/integration");
  const { generateTemplatedDocument } = await import("../server/services/institutionalTemplates/templateCompositionService");
  const { InstitutionalTemplatesWorkflow } = await import("../server/services/institutionalTemplates/workflowService");
  const ports = createTemplateWorkflowPorts();
  const compositionPorts = createTemplateCompositionPorts();
  const ctx: WorkflowContext = { organizationId, actor: { kind: "human", userId: actorUserId }, correlationId: `pilot-${arg("run-id") ?? Date.now()}` };
  const authority = JSON.parse(readFileSync(need("authority-file"), "utf8")) as PilotInput["authority"];
  const ast = JSON.parse(readFileSync(need("ast-file"), "utf8")) as unknown;
  const inventory = arg("inventory-file") ? (JSON.parse(readFileSync(arg("inventory-file")!, "utf8")) as unknown) : undefined;
  const preset = MODEL_REGISTRATION_PRESETS[0];
  const scope = JSON.parse(arg("scope-json") ?? JSON.stringify({ ...preset.scope })) as Record<string, string>;
  const legal = arg("legal-evidence-file") ? (JSON.parse(readFileSync(arg("legal-evidence-file")!, "utf8")) as PilotInput["legalEvidence"]) : undefined;
  const sha = need("source-sha256");
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error("--source-sha256 inválido");
  const input: PilotInput = {
    ctx, ports, runId: arg("run-id") ?? String(Date.now()),
    registration: { target: { kind: "NEW_IDENTITY", documentKind: preset.documentKind, slug: arg("slug") ?? preset.slug }, templateKey: arg("template-key") ?? preset.templateKey, displayName: arg("display-name") ?? preset.displayName, declaredScope: scope, source: { kind: "AST", ast }, sourceLogicalVersion: need("source-version"), sourceSha256: sha, ...(inventory !== undefined ? { inventory } : {}) },
    authority, ...(legal ? { legalEvidence: legal } : {}), bindingScope: scope,
    previewContext: { scope, sampleValues: JSON.parse(arg("sample-values-json") ?? "{}") as Record<string, unknown> },
    ...(inventory !== undefined ? { inventory } : {}), confirmedSteps: parseConfirm(), acceptedBlockers: (arg("accept-blockers") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    staging: {
      compose: async ({ documentKind, scope: sc, asOf }) => {
        const r = await generateTemplatedDocument({
          organizationId, subjectId: processId, documentKind, documentType: "edital", scope: sc, asOf, title: `Edital de TESTE — ${processId}`, actorUserId, correlationId: ctx.correlationId, aiNarratives: [],
        }, compositionPorts);
        return { generationManifestId: r.generationManifest.id, generatedDocumentId: r.generatedDocumentId, replayed: r.replayed };
      },
      explain: async (manifestId) => { const e = await new InstitutionalTemplatesWorkflow(ports).explainManifest(ctx, manifestId); return { manifest: e.manifest, revision: e.revision }; },
    },
  };
  return runEditalPilot(input);
}

async function main(): Promise<void> {
  const mode = arg("mode") ?? "dry-run";
  if (mode !== "dry-run" && mode !== "staging") throw new Error("--mode deve ser dry-run ou staging");
  const report = mode === "dry-run" ? await dryRun() : await staging();
  console.info(has("json") ? JSON.stringify(report, null, 2) : formatReport(report, mode));
  process.exit(report.steps.some((s) => s.status === "FAILED") ? 1 : 0);
}

if (process.argv[1] && /edital-pilot-harness\.[tj]s$/.test(process.argv[1])) {
  main().catch((err) => { console.error(`❌ ${err instanceof Error ? err.message : String(err)}`); process.exit(2); });
}

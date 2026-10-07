/**
 * Piloto Edital — HARNESS: roteiro executável DRY-RUN (ports em memória + fixture sintética). Prova a ordem dos 12 passos, que decisões
 * humanas só rodam com confirmação explícita, que o harness nunca liga a flag nem toca produção/processo 2026/253, que a matriz de
 * prontidão trava o PUBLISH sem aceite humano e que passos de staging ficam REQUIRES_STAGING.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BASELINE_CAPABILITIES_D4BB209 } from "../../domain/institutionalTemplates/governance/capabilities";
import { SCOPE_DIMENSIONS } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { MODEL_REGISTRATION_PRESETS } from "../../services/institutionalTemplates/modelRegistrationService";
import { previewComposeOutcome } from "../../services/institutionalTemplates/adapters/previewAdapter";
import { PILOT_STEP_IDS, runEditalPilot, type PilotInput, type PilotStepId } from "../../services/institutionalTemplates/pilot/editalPilotHarness";
import { ALL_CAPABILITIES, buildPilotAst, buildPilotCatalog, buildPilotInventory, PILOT_SOURCE_LOGICAL_VERSION, pilotSourceSha256 } from "../../services/institutionalTemplates/pilot/editalPilotFixture";
import { decisionInput, makeTestPorts } from "../helpers/institutionalTemplatesFakes";

const preset = MODEL_REGISTRATION_PRESETS[0];
const SCOPE = { ...preset.scope, regime: "EMPREITADA_PRECO_UNITARIO", criterion: "MENOR_PRECO" };
const HUMAN: PilotStepId[] = ["REGISTER", "LEGAL_EVIDENCE", "APPROVE", "PUBLISH", "BIND"];
const LANE_A = { ...BASELINE_CAPABILITIES_D4BB209, scopeDimensions: SCOPE_DIMENSIONS };

function build(over: { flag?: boolean; capabilities?: typeof LANE_A; items?: boolean; certame?: boolean; confirm?: PilotStepId[]; accept?: string[]; legal?: boolean; staging?: PilotInput["staging"] } = {}) {
  const opts = { withItemsTable: over.items, withCertameConfig: over.certame };
  const catalog = buildPilotCatalog(opts);
  const ast = buildPilotAst(opts);
  const t = makeTestPorts({ catalog, capabilities: over.capabilities ?? LANE_A, composer: previewComposeOutcome, flag: () => over.flag ?? true });
  const sampleValues = { "processo.numero": "TESTE/1", ...Object.fromEntries(Array.from({ length: 48 }, (_, i) => [`ent.i${String(i + 1).padStart(3, "0")}`, "SIM"])) };
  const input: PilotInput = {
    ctx: { organizationId: 1, actor: { kind: "human", userId: 5 }, correlationId: "t" }, ports: t.ports, runId: "r1",
    registration: {
      target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: preset.slug }, templateKey: preset.templateKey, displayName: preset.displayName, declaredScope: SCOPE, source: { kind: "AST", ast },
      sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(ast), inventory: buildPilotInventory(ast, opts),
    },
    authority: decisionInput(),
    ...(over.legal === false ? {} : { legalEvidence: { sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(ast) } }),
    bindingScope: SCOPE, previewContext: { scope: SCOPE, sampleValues }, inventory: buildPilotInventory(ast, opts),
    confirmedSteps: new Set(over.confirm ?? HUMAN), acceptedBlockers: over.accept, staging: over.staging,
  };
  return { t, input };
}
const by = (r: Awaited<ReturnType<typeof runEditalPilot>>, id: PilotStepId) => r.steps.find((s) => s.id === id)!;

describe("harness do piloto Edital (dry-run)", () => {
  it("percorre os 12 passos na ordem; 1–7 concluem; 8–9 exigem staging; 10–12 são sempre humanos; nunca emite nem chama IA", async () => {
    const { t, input } = build();
    const r = await runEditalPilot(input);
    expect(r.steps.map((s) => s.id)).toEqual([...PILOT_STEP_IDS]);
    expect(r.steps.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (const id of ["REGISTER", "LEGAL_EVIDENCE", "READINESS", "APPROVE", "PUBLISH", "BIND", "PREVIEW"] as const) expect(by(r, id).status, id).toBe("DONE");
    expect(by(r, "COMPOSE").status).toBe("REQUIRES_STAGING");
    expect(by(r, "INSPECT_M1").status).toBe("SKIPPED_PRECONDITION");
    expect(by(r, "HUMAN_REVIEW").status).toBe("SKIPPED_PRECONDITION");
    expect(r.completedThrough).toBe("PREVIEW");
    expect(r.stoppedAt).toBe("COMPOSE");
    expect(r.safety).toEqual({ productionTouched: false, featureFlagChanged: false, process2026_253Touched: false, aiCalled: false, officialDocumentIssued: false });
    // estado final: uma revisão PUBLISHED, um binding exato, nenhuma escrita além do roteiro
    const rev = [...t.repo.revisions.values()];
    expect(rev).toHaveLength(1);
    expect(rev[0].status).toBe("PUBLISHED");
    expect([...t.repo.bindings.values()]).toHaveLength(1);
    expect([...t.repo.bindings.values()][0].pinnedRevisionId).toBe(rev[0].id);
    expect(by(r, "REGISTER").evidence).toMatchObject({ status: "DRAFT" });
    expect(by(r, "PREVIEW").evidence).toMatchObject({ sideEffects: { persisted: false, aiCalled: false, issued: false } });
  });

  it("sem confirmação humana NADA muda: o 1º passo fica AWAITING_HUMAN_CONFIRMATION e os demais SKIPPED; zero escritas", async () => {
    const { t, input } = build({ confirm: [] });
    const r = await runEditalPilot(input);
    expect(by(r, "REGISTER").status).toBe("AWAITING_HUMAN_CONFIRMATION");
    for (const s of r.steps.slice(1)) expect(s.status).toBe("SKIPPED_PRECONDITION");
    expect(t.repo.writes + t.governance.writes).toBe(0);
  });

  it("confirmação parcial: para na primeira decisão não confirmada (ex.: APPROVE) e não avança nem publica", async () => {
    const { t, input } = build({ confirm: ["REGISTER", "LEGAL_EVIDENCE"] });
    const r = await runEditalPilot(input);
    expect(by(r, "READINESS").status).toBe("DONE");
    expect(by(r, "APPROVE").status).toBe("AWAITING_HUMAN_CONFIRMATION");
    expect(by(r, "PUBLISH").status).toBe("SKIPPED_PRECONDITION");
    expect([...t.repo.revisions.values()][0].status).toBe("DRAFT");
    expect(t.repo.bindings.size).toBe(0);
  });

  it("FEATURE OFF: todos os passos SKIPPED; nenhuma escrita; o harness NÃO liga a flag", async () => {
    const { t, input } = build({ flag: false });
    const r = await runEditalPilot(input);
    expect(r.featureEnabledForOrganization).toBe(false);
    for (const s of r.steps) { expect(s.status).toBe("SKIPPED_PRECONDITION"); expect(s.detail).toMatch(/FEATURE OFF/); }
    expect(t.repo.writes + t.governance.writes).toBe(0);
    expect(r.safety.featureFlagChanged).toBe(false);
  });

  it("estado atual de main (sem forma/plataforma na persistência): BIND falha FECHADO e o resto não roda; nada fica vinculado", async () => {
    const { t, input } = build({ capabilities: BASELINE_CAPABILITIES_D4BB209 as never });
    const r = await runEditalPilot(input);
    expect(by(r, "PUBLISH").status).toBe("DONE");
    expect(by(r, "BIND").status).toBe("FAILED");
    expect(by(r, "BIND").detail).toMatch(/SCOPE_DIMENSION_UNSUPPORTED/);
    expect(by(r, "PREVIEW").status).toBe("SKIPPED_PRECONDITION");
    expect(t.repo.bindings.size).toBe(0);
  });

  it("matriz BLOCKED (ITEMS + CERTAME_CONFIG) trava o PUBLISH até uma pessoa aceitar os bloqueios; o aceite fica registrado na decisão", async () => {
    const blocked = build({ items: true, certame: true });
    const r1 = await runEditalPilot(blocked.input);
    expect(by(r1, "READINESS").evidence).toMatchObject({ blocked: ["ITEMS_BACKING", "CERTAME_CONFIG"] });
    expect(by(r1, "PUBLISH").status).toBe("AWAITING_HUMAN_CONFIRMATION");
    expect(by(r1, "PUBLISH").detail).toMatch(/ITEMS_BACKING, CERTAME_CONFIG/);
    expect([...blocked.t.repo.revisions.values()][0].status).toBe("APPROVED");

    const accepted = build({ items: true, certame: true, accept: ["ITEMS_BACKING", "CERTAME_CONFIG"] });
    const r2 = await runEditalPilot(accepted.input);
    expect(by(r2, "PUBLISH").status).toBe("DONE");
    expect(by(r2, "PUBLISH").evidence).toMatchObject({ acceptedBlockers: ["ITEMS_BACKING", "CERTAME_CONFIG"] });
    const publishDecision = [...accepted.t.repo.decisions.values()].find((d) => d.decisionType === "template_publication")!;
    expect(publishDecision.evidence.join(" ")).toMatch(/readiness\.acceptedBlockers=CERTAME_CONFIG,ITEMS_BACKING/);
  });

  it("com capacidades completas a matriz fica READY e o roteiro não exige aceite de bloqueios", async () => {
    const { input } = build({ items: true, certame: true, capabilities: ALL_CAPABILITIES as never });
    const r = await runEditalPilot(input);
    expect(r.readiness?.overall).toBe("READY");
    expect(by(r, "PUBLISH").status).toBe("DONE");
  });

  it("evidência jurídica é OPCIONAL no roteiro: sem ela o passo é ignorado com aviso, nada é inventado e a matriz mostra a pendência", async () => {
    const { t, input } = build({ legal: false, accept: ["LEGAL_APPROVAL_EVIDENCE"] });
    const r = await runEditalPilot(input);
    expect(by(r, "LEGAL_EVIDENCE").detail).toMatch(/nada foi inventado/);
    expect(r.readiness?.checks.find((c) => c.id === "LEGAL_APPROVAL_EVIDENCE")!.status).toBe("BLOCKED");
    expect([...t.repo.decisions.values()].some((d) => d.decisionType === "template_legal_approval_evidence")).toBe(false);
  });

  it("staging: COMPOSE e INSPECT_M1 usam o port de staging; HUMAN_REVIEW/REVALIDATE/ISSUE seguem humanos (nunca executados pelo harness)", async () => {
    const calls: string[] = [];
    let revisionId = "";
    const { t, input } = build({
      staging: {
        compose: async (a) => { calls.push(`compose:${a.documentKind}`); revisionId = [...t.repo.revisions.values()][0].id; return { generationManifestId: "m1id", generatedDocumentId: "gd1", replayed: false }; },
        explain: async (id) => { calls.push(`explain:${id}`); return { manifest: { stage: "GENERATION", id, manifestHash: "h" }, revision: { id: revisionId, revision: 1, status: "PUBLISHED" } }; },
      },
    });
    const r = await runEditalPilot(input);
    expect(calls).toEqual(["compose:edital", "explain:m1id"]);
    expect(by(r, "COMPOSE").status).toBe("DONE");
    expect(by(r, "INSPECT_M1").status).toBe("DONE");
    expect(by(r, "HUMAN_REVIEW").status).toBe("AWAITING_HUMAN_CONFIRMATION");   // o roteiro PARA no 1º passo humano
    expect(by(r, "HUMAN_REVIEW").detail).toMatch(/acceptAiNarrative/);
    for (const id of ["REVALIDATE", "ISSUE_TEST_ARTIFACT"] as const) expect(by(r, id).status).toBe("SKIPPED_PRECONDITION");
    expect(r.stoppedAt).toBe("HUMAN_REVIEW");
    expect(r.completedThrough).toBe("INSPECT_M1");
    expect(r.safety.officialDocumentIssued).toBe(false);
  });

  it("staging: M1 que aponta para OUTRA revisão é rejeitado (FAILED)", async () => {
    const { input } = build({
      staging: {
        compose: async () => ({ generationManifestId: "m1", generatedDocumentId: "g", replayed: false }),
        explain: async () => ({ manifest: { stage: "GENERATION", id: "m1", manifestHash: "h" }, revision: { id: "outra", revision: 9, status: "PUBLISHED" } }),
      },
    });
    const r = await runEditalPilot(input);
    expect(by(r, "INSPECT_M1").status).toBe("FAILED");
    expect(by(r, "INSPECT_M1").detail).toMatch(/OUTRA revisão/);
  });
});

describe("CLI do harness — salvaguardas estruturais", () => {
  const src = readFileSync(path.resolve("scripts/edital-pilot-harness.ts"), "utf8");
  it("recusa produção e o processo 2026/253; nunca altera a feature flag; passos humanos só por --confirm", () => {
    expect(src).toMatch(/RECUSADO: o harness nunca roda em produção/);
    expect(src).toMatch(/FORBIDDEN_PROCESS_NUMBER = "2026\/253"/);
    expect(src).toMatch(/RECUSADO: o processo/);
    expect(src).not.toMatch(/setFeatureFlag|upsertTenantFlag|tenant_feature_flags|UPDATE |INSERT |DELETE /);
    expect(src).toMatch(/parseConfirm/);
    expect(src).toMatch(/APP_ENV=staging/);
  });
  it("a biblioteca do harness não importa banco, flag nem IA", () => {
    const lib = readFileSync(path.resolve("server/services/institutionalTemplates/pilot/editalPilotHarness.ts"), "utf8");
    expect(lib).not.toMatch(/featureFlagService|getDb|invokeLLM|llm|process\.env/);
  });
});

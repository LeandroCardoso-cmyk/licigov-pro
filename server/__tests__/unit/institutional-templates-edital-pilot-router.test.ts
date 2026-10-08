/**
 * Piloto Edital — ROUTER tRPC (sem DB; tenant mockado; ports em memória; composer REAL de prévia).
 * Cobre: feature OFF bloqueada no backend mesmo por rota direta, RBAC das novas ações, tenant do contexto, cross-tenant,
 * registro nascendo DRAFT, evidência jurídica opcional/humana, prontidão e dossiê só-leitura, binding de escopo explícito.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const tenant = vi.hoisted(() => ({ org: 1, role: "owner" as string }));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: tenant.org,
    membership: { id: 1, organizationId: tenant.org, userId: 1, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));

import { institutionalTemplatesRouter } from "../../routers/institutionalTemplatesRouter";
import { BASELINE_CAPABILITIES_D4BB209 } from "../../domain/institutionalTemplates/governance/capabilities";
import { SCOPE_DIMENSIONS } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { previewComposeOutcome } from "../../services/institutionalTemplates/adapters/previewAdapter";
import { buildPilotAst, buildPilotCatalog, buildPilotInventory, PILOT_SOURCE_LOGICAL_VERSION, pilotSourceSha256 } from "../../services/institutionalTemplates/pilot/editalPilotFixture";
import { getModelPackage } from "../../services/institutionalTemplates/modelPackages";
import { configureTemplateWorkflowPorts, resetTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { makeContext, mockUser } from "../helpers/fixtures";
import { decisionInput, makeTestPorts, type InMemoryTemplateRepository } from "../helpers/institutionalTemplatesFakes";
import type { InMemoryGovernance } from "../helpers/institutionalTemplatesGovernanceFakes";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const caller = () => institutionalTemplatesRouter.createCaller(makeContext(mockUser) as any);
const as = (role: string, org = 1) => { tenant.role = role; tenant.org = org; return caller(); };
const trpcErr = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as { code?: string; message?: string } | null;

let repo: InMemoryTemplateRepository;
let gov: InMemoryGovernance;
let flagOn = true;
const FULL = { modality: "pregao", form: "eletronica", platform: "bll", regime: "empreitada-preco-unitario", criterion: "menor-preco" };
const ast = buildPilotAst();
const sha = pilotSourceSha256(ast);

beforeEach(() => {
  flagOn = true;
  const t = makeTestPorts({ flag: () => flagOn, catalog: buildPilotCatalog(), composer: previewComposeOutcome, capabilities: { ...BASELINE_CAPABILITIES_D4BB209, scopeDimensions: SCOPE_DIMENSIONS } });
  repo = t.repo; gov = t.governance;
  configureTemplateWorkflowPorts(t.ports);
  tenant.org = 1; tenant.role = "owner";
});
afterEach(() => resetTemplateWorkflowPorts());

let n = 0;
const k = (p: string) => `${p}-router-key-${++n}`;
const registerInput = (over: Record<string, unknown> = {}) => ({
  target: { kind: "NEW_IDENTITY" as const, documentKind: "edital" as const, slug: "edital-pregao-eletronico-bll" }, templateKey: "EDITAL_PREGAO_ELETRONICO_BLL",
  displayName: "Edital — Pregão Eletrônico — BLL", declaredScope: FULL, source: { kind: "AST" as const, ast }, sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: sha,
  inventory: buildPilotInventory(ast), confirm: true, idempotencyKey: k("reg"), decision: decisionInput(), ...over,
});
const life = (revisionId: string, expectedStatus: "DRAFT" | "APPROVED", extra: Record<string, unknown> = {}) =>
  ({ revisionId, expectedStatus, confirm: true, idempotencyKey: k("life"), decision: decisionInput(), ...extra });

describe("FEATURE OFF — o backend bloqueia mesmo por rota direta; nada é lido nem escrito", () => {
  it("catálogo, governança, registro, prontidão e dossiê ⇒ PRECONDITION_FAILED/MODULE_DISABLED; getCapabilities informa enabled=false", async () => {
    const seeded = await as("owner").registration.register(registerInput());
    flagOn = false;
    const c = as("owner");
    const before = repo.writes + gov.writes;
    const calls = [
      c.catalog.list({}), c.governance.get({ revisionId: seeded.revision.id }),
      c.governance.recordLegalEvidence({ revisionId: seeded.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: k("ev"), decision: decisionInput(), evidence: { sourceLogicalVersion: "v", sourceSha256: sha } }),
      c.registration.register(registerInput({ idempotencyKey: k("off"), target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: "outro" } })),
      c.readiness.evaluate({ revisionId: seeded.revision.id }), c.previewDossier.hints({ revisionId: seeded.revision.id }),
      c.previewDossier.run({ target: { kind: "REVISION", revisionId: seeded.revision.id }, context: { scope: FULL, sampleValues: {} } }),
    ];
    for (const p of calls) {
      const e = await trpcErr(p);
      expect(e?.code).toBe("PRECONDITION_FAILED");
      expect(e?.message).toMatch(/MODULE_DISABLED/);
    }
    expect(repo.writes + gov.writes).toBe(before);
    const caps = await c.getCapabilities();
    expect(caps).toMatchObject({ enabled: false, flag: "FF_INSTITUTIONAL_TEMPLATES_V1" });
  });

  it("ports não configurados ⇒ PORTS_NOT_CONFIGURED (fail-closed) e a capacidade não habilita nada", async () => {
    resetTemplateWorkflowPorts();
    const c = as("owner");
    expect((await trpcErr(c.catalog.list({})))?.message).toMatch(/PORTS_NOT_CONFIGURED/);
    expect(await c.getCapabilities()).toMatchObject({ enabled: false, portsConfigured: false });
  });
});

describe("capacidades expostas à UX", () => {
  it("presets (BLL primeiro), dimensões de escopo, dimensões persistidas, 12 verificações de prontidão e pisos novos", async () => {
    const caps = await as("viewer").getCapabilities();
    expect(caps.enabled).toBe(true);
    expect(caps.registrationPresets[0]).toMatchObject({ templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL" });
    expect(caps.scopeDimensions.map((d) => d.dimension)).toEqual(["modality", "form", "platform", "regime", "criterion"]);
    expect(caps.persistedScopeDimensions).toEqual(["modality", "form", "platform", "regime", "criterion"]);
    expect(caps.readinessChecks).toHaveLength(12);
    expect(caps.roleFloors).toMatchObject({ register: "operator", evidence: "manager" });
  });
});

describe("getCapabilities — contexto do tenant e metadados do pacote (somente leitura)", () => {
  it("organizationId vem de ctx (nunca do cliente) e o preset BLL traz a procedência do pacote servidor, sem conteúdo jurídico", async () => {
    const caps = await as("viewer", 7).getCapabilities();
    expect(caps.organizationId).toBe(7);                                  // do contexto autenticado
    const bll = getModelPackage("EDITAL_PREGAO_ELETRONICO_BLL")!;
    expect(caps.registrationPresets[0]).toMatchObject({
      sourceKind: "MODEL_PACKAGE", sourceLogicalVersion: bll.provenance.sourceLogicalVersion, sourceSha256: bll.provenance.sourceSha256,
    });
    expect(caps.registrationPresets[0].sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    const json = JSON.stringify(caps.registrationPresets);
    for (const forbidden of ['"ast"', '"root"', '"mapping"', '"catalog"', '"inventory"', "tpl-ast/"]) expect(json).not.toContain(forbidden);
  });
  it("o cliente não consegue fornecer organizationId (input estrito) e o query não escreve nada", async () => {
    const before = JSON.stringify(await as("viewer", 3).catalog.list({}));
    // @ts-expect-error getCapabilities não aceita input
    const withInput = await as("viewer", 3).getCapabilities({ organizationId: 999 });
    expect(withInput.organizationId).toBe(3);
    expect(JSON.stringify(await as("viewer", 3).catalog.list({}))).toBe(before);
  });
});

describe("RBAC das novas ações", () => {
  it("viewer: lê catálogo, governança, prontidão e dossiê; NÃO registra nem registra evidência", async () => {
    const seeded = await as("operator").registration.register(registerInput());
    const v = as("viewer");
    expect((await v.catalog.list({})).map((r) => r.slug)).toEqual(["edital-pregao-eletronico-bll"]);
    expect((await v.governance.get({ revisionId: seeded.revision.id })).provenance?.templateKey).toBe("EDITAL_PREGAO_ELETRONICO_BLL");
    expect((await v.readiness.evaluate({ revisionId: seeded.revision.id })).matrix.checks).toHaveLength(12);
    expect((await v.previewDossier.run({ target: { kind: "REVISION", revisionId: seeded.revision.id }, context: { scope: FULL, sampleValues: {} } })).status).toMatch(/COMPOSED|COMPOSE_ERROR/);
    const before = repo.writes + gov.writes;
    expect((await trpcErr(v.registration.register(registerInput({ target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: "x1" }, idempotencyKey: k("v")}))))?.code).toBe("FORBIDDEN");
    expect((await trpcErr(v.governance.recordLegalEvidence({ revisionId: seeded.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: k("v2"), decision: decisionInput(), evidence: { sourceLogicalVersion: "v", sourceSha256: sha } })))?.code).toBe("FORBIDDEN");
    expect(repo.writes + gov.writes).toBe(before);
  });

  it("operator registra (DRAFT) mas NÃO registra evidência jurídica; manager registra; ambos só com confirmação explícita", async () => {
    const seeded = await as("operator").registration.register(registerInput());
    const ev = (confirm = true, key = k("ev")) => ({ revisionId: seeded.revision.id, expectedVersion: 0, confirm, idempotencyKey: key, decision: decisionInput(), evidence: { sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: sha } });
    expect((await trpcErr(as("operator").governance.recordLegalEvidence(ev())))?.code).toBe("FORBIDDEN");
    expect((await trpcErr(as("manager").governance.recordLegalEvidence(ev(false))))?.message).toMatch(/CONFIRMATION_REQUIRED/);
    const out = await as("manager").governance.recordLegalEvidence(ev());
    expect(out.evidence).toMatchObject({ version: 1, parecerNumber: null, protocol: null, procurador: null });
    expect((await as("viewer").governance.get({ revisionId: seeded.revision.id })).legalEvidence?.version).toBe(1);
  });
});

describe("registro pelo router — nasce DRAFT; tenant nunca vem do cliente", () => {
  it("revisão DRAFT + procedência; escopo incompleto ⇒ BAD_REQUEST sem escrita; ator/campos estritos", async () => {
    const o = as("operator");
    const out = await o.registration.register(registerInput());
    expect(out.revision.status).toBe("DRAFT");
    expect(out.provenance.status).toBe("RECORDED");
    const before = repo.writes + gov.writes;
    const cast = (v: unknown) => v as never;
    expect((await trpcErr(o.registration.register(registerInput({ declaredScope: { modality: "pregao" }, target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: "y1" }, idempotencyKey: k("y")}))))?.code).toBe("BAD_REQUEST");
    expect((await trpcErr(o.registration.register(cast(registerInput({ organizationId: 999, idempotencyKey: k("z") })))))?.code).toBe("BAD_REQUEST");
    expect((await trpcErr(o.registration.register(cast(registerInput({ sourceSha256: "nope", idempotencyKey: k("w") })))))?.code).toBe("BAD_REQUEST");
    expect((await trpcErr(as("manager").governance.recordLegalEvidence(cast({ revisionId: out.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: k("q"), decision: decisionInput(), evidence: { sourceLogicalVersion: "v", sourceSha256: sha }, organizationId: 5 }))))?.code).toBe("BAD_REQUEST");
    expect(repo.writes + gov.writes).toBe(before);
  });

  it("cross-tenant: o tenant B não vê catálogo, governança, prontidão nem dossiê do A (NOT_FOUND idêntico ao inexistente)", async () => {
    const seeded = await as("operator").registration.register(registerInput());
    const b = as("owner", 2);
    expect(await b.catalog.list({})).toEqual([]);
    const ghost = "tr_inexistente";
    const pairs: Array<[string, (id: string) => Promise<unknown>]> = [
      ["governance.get", (id) => b.governance.get({ revisionId: id })],
      ["readiness.evaluate", (id) => b.readiness.evaluate({ revisionId: id })],
      ["previewDossier.run", (id) => b.previewDossier.run({ target: { kind: "REVISION", revisionId: id }, context: { scope: FULL, sampleValues: {} } })],
      ["previewDossier.hints", (id) => b.previewDossier.hints({ revisionId: id })],
    ];
    for (const [label, call] of pairs) {
      const foreign = await trpcErr(call(seeded.revision.id));
      const missing = await trpcErr(call(ghost));
      expect(foreign?.code, label).toBe("NOT_FOUND");
      expect(foreign?.message, label).toBe(missing?.message);   // sem oráculo de existência entre tenants
    }
  });
});

const evidenceInput = (revisionId: string) => ({ revisionId, expectedVersion: 0, confirm: true, idempotencyKey: k("evx"), decision: decisionInput(), evidence: { sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: sha } });
const INV = buildPilotInventory(ast);

describe("binding de escopo explícito e gate de prontidão na publicação", () => {
  /** Modelo APPROVED. `ready` registra a evidência jurídica (pré-condição do Edital); sem ela a matriz fica BLOCKED. */
  async function publishedModel(ready = true) {
    const o = as("operator");
    const reg = await o.registration.register(registerInput());
    if (ready) await as("manager").governance.recordLegalEvidence(evidenceInput(reg.revision.id));
    await as("manager").revisions.approve(life(reg.revision.id, "DRAFT"));
    return { reg };
  }

  it("Edital: escopo incompleto ou dimensão sem backing ⇒ BAD_REQUEST; escopo completo ⇒ binding na revisão exata", async () => {
    const { reg } = await publishedModel();
    const pub = await as("manager").revisions.publish(life(reg.revision.id, "APPROVED", { inventory: INV }));
    expect(pub.revision.status).toBe("PUBLISHED");
    const input = (scope: Record<string, string>) => ({ documentKind: "edital" as const, scope, identityId: reg.identity.id, pinnedRevisionId: reg.revision.id, effectiveFrom: "2026-10-01T00:00:00.000Z", confirm: true });
    expect((await trpcErr(as("manager").bindings.set(input({ modality: "pregao" }))))?.message).toMatch(/SCOPE_INVALID/);
    const b = await as("manager").bindings.set(input(FULL));
    expect(b).toMatchObject({ pinnedRevisionId: reg.revision.id, scope: FULL });
    const res = await as("viewer").bindings.resolve({ documentKind: "edital", scope: FULL, asOf: "2026-10-07T00:00:00.000Z" });
    expect(res).toMatchObject({ status: "RESOLVED", revisionId: reg.revision.id });
    expect((await as("viewer").bindings.resolve({ documentKind: "edital", scope: { ...FULL, form: "presencial", platform: "bll" }, asOf: "2026-10-07T00:00:00.000Z" })).status).toBe("NOT_BOUND");
  });

  it("BLOCKED ⇒ PRECONDITION_FAILED/PUBLICATION_BLOCKED com os blockers; nada persistido; o contrato NÃO aceita matriz nem aceite de bloqueio do cliente", async () => {
    const { reg } = await publishedModel(false);
    const before = repo.writes + gov.writes;
    const cast = (v: unknown) => v as never;
    const blocked = await trpcErr(as("manager").revisions.publish(life(reg.revision.id, "APPROVED", { inventory: INV })));
    expect(blocked?.code).toBe("PRECONDITION_FAILED");
    expect(blocked?.message).toMatch(/PUBLICATION_BLOCKED.*LEGAL_APPROVAL_EVIDENCE/);
    // tentativas de forçar: matriz/aceite no input são REJEITADOS pelo schema estrito (BAD_REQUEST) — não existe caminho de override
    for (const forged of [
      { readiness: { matrixHash: "a".repeat(64), acceptedBlockedChecks: ["LEGAL_APPROVAL_EVIDENCE"] } }, { acceptedBlockedChecks: ["LEGAL_APPROVAL_EVIDENCE"] },
      { matrix: { overall: "READY" } }, { readinessMatrixHash: "a".repeat(64) },
    ]) expect((await trpcErr(as("manager").revisions.publish(cast(life(reg.revision.id, "APPROVED", { inventory: INV, ...forged })))))?.code).toBe("BAD_REQUEST");
    expect(repo.writes + gov.writes).toBe(before);
    expect([...repo.decisions.values()].some((d) => d.decisionType === "template_publication")).toBe(false);
    expect((await as("viewer").revisions.get({ revisionId: reg.revision.id })).revision.status).toBe("APPROVED");
  });

  it("PASS/NOT_APPLICABLE ⇒ publica; a decisão grava readiness.matrixHash/checkedAt/statuses; replay converge e viewer/operator não publicam", async () => {
    const { reg } = await publishedModel(true);
    expect((await trpcErr(as("operator").revisions.publish(life(reg.revision.id, "APPROVED", { inventory: INV }))))?.code).toBe("FORBIDDEN");
    const matrix = (await as("viewer").readiness.evaluate({ revisionId: reg.revision.id, inventory: INV })).matrix;
    const pubInput = life(reg.revision.id, "APPROVED", { inventory: INV, idempotencyKey: "router-pub-key-1" });
    const out = await as("manager").revisions.publish(pubInput);
    expect(out.revision.status).toBe("PUBLISHED");
    expect(out.decision.evidence[0]).toBe(`readiness.matrixHash=${matrix.matrixHash}`);
    expect(out.decision.evidence[1]).toMatch(/^readiness\.witnessHash=[0-9a-f]{64}$/);
    expect(out.decision.evidence[2]).toMatch(/^readiness\.checkedAt=\d{4}-\d{2}-\d{2}T/);
    expect(out.decision.evidence[3]).toMatch(/^readiness\.statuses=SOURCE_PROVENANCE:PASS,.*ITEMS_BACKING:NOT_APPLICABLE/);
    const writes = repo.writes + gov.writes;
    const replay = await as("manager").revisions.publish(pubInput);
    expect(replay).toMatchObject({ replayed: true });
    expect(replay.decision.id).toBe(out.decision.id);
    expect(repo.writes + gov.writes).toBe(writes);
  });

  it("inventário adulterado ou ausente ⇒ BLOCKED no servidor (o cliente só fornece DADO, autenticado pelo hash da procedência); FEATURE OFF bloqueia a publicação", async () => {
    const { reg } = await publishedModel(true);
    const tampered = { ...INV, declared: { ...INV.declared, conditionTypes: 47 } };
    expect((await trpcErr(as("manager").revisions.publish(life(reg.revision.id, "APPROVED", { inventory: tampered }))))?.message).toMatch(/PUBLICATION_BLOCKED/);
    expect((await trpcErr(as("manager").revisions.publish(life(reg.revision.id, "APPROVED"))))?.message).toMatch(/PUBLICATION_BLOCKED/);
    flagOn = false;
    expect((await trpcErr(as("manager").revisions.publish(life(reg.revision.id, "APPROVED", { inventory: INV }))))?.message).toMatch(/MODULE_DISABLED/);
  });

  it("cross-tenant: o tenant B não publica revisão do A (NOT_FOUND idêntico ao inexistente)", async () => {
    const { reg } = await publishedModel(true);
    const foreign = await trpcErr(as("manager", 2).revisions.publish(life(reg.revision.id, "APPROVED", { inventory: INV })));
    const ghost = await trpcErr(as("manager", 2).revisions.publish(life("tr_inexistente", "APPROVED", { inventory: INV })));
    expect(foreign?.code).toBe("NOT_FOUND");
    expect(foreign?.message).toBe(ghost?.message);
  });

  it("a matriz via router espelha o domínio: evidência ausente ⇒ BLOCKED; com evidência + inventário ⇒ READY", async () => {
    const { reg } = await publishedModel(false);
    const v = as("viewer");
    const before = (await v.readiness.evaluate({ revisionId: reg.revision.id, inventory: buildPilotInventory(ast) })).matrix;
    expect(before.checks.find((c) => c.id === "LEGAL_APPROVAL_EVIDENCE")!.status).toBe("BLOCKED");
    await as("manager").governance.recordLegalEvidence({ revisionId: reg.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: k("ev"), decision: decisionInput(), evidence: { sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: sha } });
    const after = (await v.readiness.evaluate({ revisionId: reg.revision.id, inventory: buildPilotInventory(ast) })).matrix;
    expect(after.overall).toBe("READY");
  });
});

describe("catálogo e dossiê pelo router", () => {
  it("catalog.list aceita os 5 filtros e valida o domínio dos valores (status/tipo fora da lista ⇒ BAD_REQUEST)", async () => {
    await as("operator").registration.register(registerInput());
    const v = as("viewer");
    expect((await v.catalog.list({ documentKind: "edital", modality: "pregao", form: "eletronica", platform: "bll", status: "DRAFT" })).map((r) => r.slug)).toEqual(["edital-pregao-eletronico-bll"]);
    expect(await v.catalog.list({ platform: "OUTRA" })).toEqual([]);
    expect((await trpcErr(v.catalog.list({ status: "ATIVO" } as never)))?.code).toBe("BAD_REQUEST");
    expect((await trpcErr(v.catalog.list({ documentKind: "nada" } as never)))?.code).toBe("BAD_REQUEST");
  });

  it("dossiê por revisão exata: sem escrita, sem IA; dicas de variáveis disponíveis para o contexto de teste", async () => {
    const reg = await as("operator").registration.register(registerInput());
    const before = repo.writes + gov.writes;
    const v = as("viewer");
    const hints = await v.previewDossier.hints({ revisionId: reg.revision.id });
    expect(hints.variables.length).toBeGreaterThan(100);
    const values = Object.fromEntries(hints.variables.filter((h) => h.name.startsWith("ent.")).map((h) => [h.name, "SIM"]));
    const d = await v.previewDossier.run({ target: { kind: "REVISION", revisionId: reg.revision.id }, context: { scope: FULL, sampleValues: values } });
    expect(d.status).toBe("COMPOSED");
    expect(d.sideEffects).toMatchObject({ persisted: false, aiCalled: false, issued: false, published: false });
    expect(d.conditionDecisions).toHaveLength(48);
    expect(repo.writes + gov.writes).toBe(before);
  });
});

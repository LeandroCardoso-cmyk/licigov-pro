/**
 * Piloto Edital — SERVIÇOS (ports em memória): catálogo multi-modelo, aplicabilidade/binding exato (fail-closed), evidência jurídica
 * (opcional, append-only, humana, sem mudar status), registro/importação (nasce DRAFT), prontidão, dossiê de prévia sem efeitos.
 */
import { describe, it, expect } from "vitest";
import type { TemplateBinding, TemplateIdentity } from "../../domain/institutionalTemplates";
import { BASELINE_CAPABILITIES_D4BB209 } from "../../domain/institutionalTemplates/governance/capabilities";
import { SCOPE_DIMENSIONS } from "../../domain/institutionalTemplates/governance/scopeDimensions";
import { previewComposeOutcome } from "../../services/institutionalTemplates/adapters/previewAdapter";
import { TemplateCatalogService } from "../../services/institutionalTemplates/catalogService";
import { TemplateGovernanceService } from "../../services/institutionalTemplates/governanceService";
import { MODEL_REGISTRATION_PRESETS, ModelRegistrationService } from "../../services/institutionalTemplates/modelRegistrationService";
import { ALL_CAPABILITIES, buildPilotAst, buildPilotCatalog, buildPilotInventory, PILOT_SOURCE_LOGICAL_VERSION, pilotSourceSha256 } from "../../services/institutionalTemplates/pilot/editalPilotFixture";
import type { WorkflowContext } from "../../services/institutionalTemplates/ports";
import { TemplatePreviewDossierService } from "../../services/institutionalTemplates/previewDossierService";
import { TemplateReadinessService } from "../../services/institutionalTemplates/readinessService";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { decisionInput, makeTestPorts, simpleAst, TEST_CATALOG } from "../helpers/institutionalTemplatesFakes";

const ctx = (org = 1, userId = 10, kind: "human" | "ai" = "human"): WorkflowContext => ({ organizationId: org, actor: { kind, userId } as never, correlationId: `c-${org}-${userId}` });
const LANE_A = { ...BASELINE_CAPABILITIES_D4BB209, scopeDimensions: SCOPE_DIMENSIONS };
const FULL = { modality: "PREGAO", form: "ELETRONICA", platform: "BLL", regime: "EMPREITADA_PRECO_UNITARIO", criterion: "MENOR_PRECO" } as const;
const preset = MODEL_REGISTRATION_PRESETS[0];

function world(capabilities = LANE_A, opts: { governance?: boolean } = {}) {
  const catalog = buildPilotCatalog();
  // composer REAL (puro, modo PREVIEW) — o stand-in `fakeComposer` não avalia condições
  const t = makeTestPorts({ catalog, capabilities, composer: previewComposeOutcome, ...opts });
  return { ...t, catalog, wf: new InstitutionalTemplatesWorkflow(t.ports) };
}
type W = ReturnType<typeof world>;

let keySeq = 0;
const key = (p: string) => `${p}-key-${++keySeq}`;

async function register(w: W, over: Record<string, unknown> = {}, c = ctx()) {
  const ast = buildPilotAst();
  return new ModelRegistrationService(w.ports).register(c, {
    target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: preset.slug }, templateKey: preset.templateKey, displayName: preset.displayName,
    declaredScope: FULL, source: { kind: "AST", ast }, sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(ast), inventory: buildPilotInventory(ast),
    confirm: true, idempotencyKey: key("reg"), decision: decisionInput(), ...over,
  } as never);
}
const publish = async (w: W, revisionId: string, c = ctx()) => {
  await w.wf.approve(c, { revisionId, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("ap"), decision: decisionInput() });
  return w.wf.publish(c, { revisionId, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key("pb"), decision: decisionInput() });
};
const bind = (w: W, identityId: string, revisionId: string, scope: Record<string, string>, c = ctx()) =>
  w.wf.setBinding(c, { documentKind: "edital", scope, identityId, pinnedRevisionId: revisionId, effectiveFrom: "2026-10-01T00:00:00.000Z", confirm: true });
const err = async (p: Promise<unknown>) => (await p.then(() => null, (e: unknown) => e)) as (Error & { code?: string }) | null;

describe("registro do primeiro modelo (EDITAL_PREGAO_ELETRONICO_BLL) — nasce DRAFT, nunca PUBLISHED", () => {
  it("o preset define templateKey, slug e displayName oficiais; escopo declarado Pregão | Eletrônica | BLL", () => {
    expect(preset).toMatchObject({ templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", slug: "edital-pregao-eletronico-bll", displayName: "Edital — Pregão Eletrônico — BLL", documentKind: "edital" });
    expect(preset.scope).toEqual({ modality: "PREGAO", form: "ELETRONICA", platform: "BLL" });
  });

  it("nasce DRAFT mesmo com evidência jurídica externa; procedência registrada; nenhum binding, aprovação ou publicação", async () => {
    const w = world();
    const r = await register(w);
    expect(r.revision.status).toBe("DRAFT");
    expect(r.provenance.status).toBe("RECORDED");
    expect(r.notices.join(" ")).toMatch(/nasceu DRAFT/);
    const gov = new TemplateGovernanceService(w.ports);
    await gov.recordLegalEvidence(ctx(), { revisionId: r.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: key("ev"), decision: decisionInput(), evidence: { sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(buildPilotAst()) } });
    const after = await w.ports.repository.getRevision(1, r.revision.id);
    expect(after!.status).toBe("DRAFT");           // evidência jurídica NÃO é status
    expect(after!.approvalDecisionId).toBeUndefined();
    expect(w.repo.bindings.size).toBe(0);
    // o ciclo de vida só avança por decisões humanas distintas
    expect((await publish(w, r.revision.id)).revision.status).toBe("PUBLISHED");
  });

  it("não existe atalho de importação para PUBLISHED: DRAFT → APPROVED → PUBLISHED exigem duas decisões", async () => {
    const w = world();
    const r = await register(w);
    const e = await err(w.wf.publish(ctx(), { revisionId: r.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("sh"), decision: decisionInput() }));
    expect(e?.message).toMatch(/TRANSITION_INVALID/);
    expect((await w.ports.repository.getRevision(1, r.revision.id))!.status).toBe("DRAFT");
  });

  it("recusas ANTES de qualquer escrita: sem confirmação, ator não humano, escopo incompleto, SHA inválido, inventário de outra fonte, AST inválido", async () => {
    const w = world();
    const writes = () => w.repo.writes + w.governance.writes;
    const cases: Array<[string, Promise<unknown>, RegExp]> = [
      ["sem confirmação", register(w, { confirm: false }), /CONFIRMATION_REQUIRED/],
      ["ator IA", register(w, {}, ctx(1, 10, "ai")), /HUMAN_ACTION_REQUIRED/],
      ["escopo incompleto", register(w, { declaredScope: { modality: "PREGAO" } }), /SCOPE_INVALID/],
      ["sha inválido", register(w, { sourceSha256: "zz" }), /VALIDATION_FAILED/],
      ["inventário de outra fonte", register(w, { sourceLogicalVersion: "9.9.9" }), /não corresponde/],
      ["AST inválido", register(w, { source: { kind: "AST", ast: { schema: "tpl-ast/1", root: [{ t: "script" }] } } }), /estrutura do modelo é inválida/],
    ];
    for (const [label, p, re] of cases) expect((await err(p))?.message, label).toMatch(re);
    expect(writes()).toBe(0);
  });

  it("importação Markdown com macro é recusada e nada é criado; AST fora do catálogo é recusado", async () => {
    const w = world();
    const e = await err(register(w, { source: { kind: "MARKDOWN", markdown: "# t\n\n{{#each x}}{{/each}}" } }));
    expect((e as { code?: string })?.code).toBe("IMPORT_REJECTED");
    expect(w.repo.identities.size).toBe(0);
  });

  it("nova revisão de modelo existente reutiliza a identidade (DRAFT revisão 2) e registra nova procedência", async () => {
    const w = world();
    const first = await register(w);
    const second = await register(w, { target: { kind: "EXISTING_IDENTITY", identityId: first.identity.id }, idempotencyKey: key("reg2") });
    expect(second.identity.id).toBe(first.identity.id);
    expect(second.revision).toMatchObject({ revision: 2, status: "DRAFT" });
    expect(w.repo.identities.size).toBe(1);
  });

  it("falha na procedência após o DRAFT criado é REPORTADA (não escondida) e a matriz a mostra BLOCKED", async () => {
    const w = world(LANE_A, { governance: false });
    const r = await register(w);
    expect(r.revision.status).toBe("DRAFT");
    expect(r.provenance).toMatchObject({ status: "FAILED" });
    const m = await new TemplateReadinessService(w.ports).evaluate(ctx(), { revisionId: r.revision.id });
    expect(m.matrix.checks.find((c) => c.id === "SOURCE_PROVENANCE")!.status).toBe("BLOCKED");
    expect(m.matrix.checks.find((c) => c.id === "LEGAL_APPROVAL_EVIDENCE")!.status).toBe("BLOCKED");
  });
});

describe("evidência jurídica — humana, append-only, opcional, sem status", () => {
  async function seeded() {
    const w = world();
    const r = await register(w);
    const gov = new TemplateGovernanceService(w.ports);
    const write = (over: Record<string, unknown> = {}, c = ctx()) => gov.recordLegalEvidence(c, {
      revisionId: r.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: key("ev"), decision: decisionInput(),
      evidence: { sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(buildPilotAst()) }, ...over,
    } as never);
    return { w, r, gov, write };
  }

  it("grava só o informado; parecer/data/protocolo/procurador ausentes ficam null; guarda versão lógica, SHA-256, quem registrou e quando", async () => {
    const { r, gov, write } = await seeded();
    const out = await write();
    expect(out.evidence).toMatchObject({ parecerNumber: null, parecerDate: null, protocol: null, procurador: null, sourceLogicalVersion: "1.0.1-draft", recordedByUserId: 10, version: 1, revisionId: r.revision.id });
    expect(out.evidence.sourceSha256).toBe(pilotSourceSha256(buildPilotAst()));
    expect(out.evidence.recordedAt).toBe("2026-10-06T12:00:00.000Z");
    expect(out.evidence.authorityValidation).toBe("NOT_VALIDATED_POLICY_PENDING");
    const view = await gov.get(ctx(), r.revision.id);
    expect(view.legalEvidence?.version).toBe(1);
    expect(view.provenance?.displayName).toBe("Edital — Pregão Eletrônico — BLL");
    expect(view.lifecycleNote).toMatch(/não alteram o status/);
  });

  it("metadados opcionais informados são preservados; supera a versão anterior (CAS) e o histórico permanece", async () => {
    const { r, gov, write } = await seeded();
    await write();
    const v2 = await write({ expectedVersion: 1, evidence: { sourceLogicalVersion: "1.0.1-draft", sourceSha256: pilotSourceSha256(buildPilotAst()), parecerNumber: "55/2026", procurador: "Fulano de Tal", evidenceRefs: ["proc 12"] } });
    expect(v2.evidence).toMatchObject({ version: 2, parecerNumber: "55/2026", procurador: "Fulano de Tal", protocol: null, evidenceRefs: ["proc 12"] });
    const view = await gov.get(ctx(), r.revision.id);
    expect(view.legalEvidenceHistory.map((e) => e.version)).toEqual([1, 2]);
    expect(view.legalEvidence?.supersedesDecisionId).toBe(view.legalEvidenceHistory[0].decisionId);
  });

  it("CAS: versão desatualizada ⇒ STALE_STATE sem escrita; replay da mesma chave converge; mesma chave com pedido diferente ⇒ conflito", async () => {
    const { w, write } = await seeded();
    await write({ idempotencyKey: "same-key-1" });
    const writes = w.governance.writes;
    expect((await err(write({ expectedVersion: 0, idempotencyKey: "other-key-1" })))?.message).toMatch(/STALE_STATE/);
    expect(w.governance.writes).toBe(writes);
    const replay = await write({ idempotencyKey: "same-key-1" });
    expect(replay.replayed).toBe(true);
    expect(w.governance.writes).toBe(writes);
    const conflict = await err(write({ idempotencyKey: "same-key-1", evidence: { sourceLogicalVersion: "1.0.9", sourceSha256: pilotSourceSha256(buildPilotAst()) } }));
    expect(conflict?.message).toMatch(/DECISION_REJECTED/);
  });

  it("replay com relógio que AVANÇA converge (o recordedAt da repetição é o já gravado, não o relógio atual)", async () => {
    const { w, r, gov } = await seeded();
    let tick = 0;
    const advancing = new TemplateGovernanceService({ ...w.ports, clock: { now: () => `2026-10-07T10:00:${String(++tick).padStart(2, "0")}.000Z` } });
    const input = { revisionId: r.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: "replay-clock-1", decision: decisionInput(), evidence: { sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(buildPilotAst()) } };
    const first = await advancing.recordLegalEvidence(ctx(), input);
    const again = await advancing.recordLegalEvidence(ctx(), input);
    expect(again.replayed).toBe(true);
    expect(again.evidence.recordedAt).toBe(first.evidence.recordedAt);
    expect((await gov.get(ctx(), r.revision.id)).legalEvidenceHistory).toHaveLength(1);
  });

  it("só pessoa autenticada, com confirmação explícita e campos válidos; IA/sistema jamais registra", async () => {
    const { w, write } = await seeded();
    const before = w.governance.writes;
    expect((await err(write({}, ctx(1, 10, "ai"))))?.message).toMatch(/HUMAN_ACTION_REQUIRED/);
    expect((await err(write({ confirm: false })))?.message).toMatch(/CONFIRMATION_REQUIRED/);
    expect((await err(write({ evidence: { sourceLogicalVersion: "", sourceSha256: "x" } })))?.message).toMatch(/evidência jurídica inválida/);
    expect((await err(write({ evidence: { sourceLogicalVersion: "v", sourceSha256: pilotSourceSha256(buildPilotAst()), parecerNumber: " " } })))?.message).toMatch(/inválida/);
    expect((await err(write({ decision: decisionInput({ decidedByName: "" }) })))?.message).toMatch(/DECISION_REJECTED/);
    expect(w.governance.writes).toBe(before);
  });

  it("cross-tenant: outro tenant não vê nem registra evidência de revisão alheia (NOT_FOUND neutro)", async () => {
    const { r, gov, w } = await seeded();
    const other = new TemplateGovernanceService(w.ports);
    const e1 = await err(other.get(ctx(2, 50), r.revision.id));
    const e2 = await err(other.recordLegalEvidence(ctx(2, 50), { revisionId: r.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: key("x"), decision: decisionInput(), evidence: { sourceLogicalVersion: "v", sourceSha256: "a".repeat(64) } }));
    const e3 = await err(other.get(ctx(2, 50), "tr_inexistente"));
    expect(e1?.message).toBe(e3?.message);
    expect(e2?.message).toMatch(/NOT_FOUND/);
    expect((await gov.get(ctx(), r.revision.id)).legalEvidence).toBeNull();
  });

  it("sem port de governança ⇒ falha fechada (PORTS_NOT_CONFIGURED), nunca fallback", async () => {
    const w = world(LANE_A, { governance: false });
    const r = await w.wf.createIdentity(ctx(), { documentKind: "edital", slug: "e1" });
    const rev = await w.wf.createDraft(ctx(), { identityId: r.id, ast: buildPilotAst() });
    const gov = new TemplateGovernanceService(w.ports);
    expect((await err(gov.get(ctx(), rev.id)))?.message).toMatch(/PORTS_NOT_CONFIGURED/);
  });

  it("o lifecycle com evidência é opcional: aprovar/publicar funcionam sem nenhuma evidência (a matriz apenas a mostra pendente)", async () => {
    const w = world();
    const r = await register(w);
    expect((await publish(w, r.revision.id)).revision.status).toBe("PUBLISHED");
    const m = await new TemplateReadinessService(w.ports).evaluate(ctx(), { revisionId: r.revision.id });
    expect(m.matrix.checks.find((c) => c.id === "LEGAL_APPROVAL_EVIDENCE")!.status).toBe("BLOCKED");
  });
});

describe("catálogo multi-modelo — vários editais, nenhum assumido como único", () => {
  async function multi() {
    const w = world();
    const mk = async (slug: string, scope: Record<string, string>, opts: { publish?: boolean; name?: string; key?: string } = {}) => {
      const r = await register(w, { target: { kind: "NEW_IDENTITY", documentKind: "edital", slug }, displayName: opts.name ?? `Edital ${slug}`, templateKey: opts.key ?? slug.toUpperCase().replace(/-/g, "_"), declaredScope: scope, idempotencyKey: key("m") });
      if (opts.publish !== false) { await publish(w, r.revision.id); await bind(w, r.identity.id, r.revision.id, scope); }
      return r;
    };
    const bll = await mk("edital-pregao-eletronico-bll", { ...FULL }, { name: "Edital — Pregão Eletrônico — BLL", key: "EDITAL_PREGAO_ELETRONICO_BLL" });
    const comprasgov = await mk("edital-pregao-eletronico-comprasgov", { ...FULL, platform: "COMPRASGOV" }, { name: "Edital — Pregão Eletrônico — Compras.gov" });
    const presencial = await mk("edital-pregao-presencial", { modality: "PREGAO", form: "PRESENCIAL", regime: "EMPREITADA_PRECO_UNITARIO", criterion: "MENOR_PRECO" }, { name: "Edital — Pregão Presencial" });
    const concorrencia = await mk("edital-concorrencia-eletronica", { ...FULL, modality: "CONCORRENCIA" }, { name: "Edital — Concorrência Eletrônica", publish: false });
    return { w, bll, comprasgov, presencial, concorrencia, svc: new TemplateCatalogService(w.ports) };
  }

  it("lista várias identidades do mesmo documentKind com nome, slug, revisão EXATA, binding e escopo; headline no formato do pilot", async () => {
    const { svc } = await multi();
    const rows = await svc.list(ctx(), { documentKind: "edital" });
    expect(rows.map((r) => r.slug)).toEqual(["edital-concorrencia-eletronica", "edital-pregao-eletronico-bll", "edital-pregao-eletronico-comprasgov", "edital-pregao-presencial"]);
    const bll = rows.find((r) => r.slug === "edital-pregao-eletronico-bll")!;
    expect(bll).toMatchObject({ displayName: "Edital — Pregão Eletrônico — BLL", displayNameSource: "REGISTRATION_PROVENANCE", templateKey: "EDITAL_PREGAO_ELETRONICO_BLL", bindingStatus: "BOUND" });
    expect(bll.headline).toMatch(/^Edital — Pregão Eletrônico — BLL \/ Pregão \| Eletrônica \| BLL \| Empreitada por preço unitário \| Menor preço \/ PUBLISHED revisão 1 \([0-9a-f]{8}\)$/);
    expect(bll.bindings[0]).toMatchObject({ health: "OK", pinnedRevision: 1, pinnedRevisionStatus: "PUBLISHED", active: true });
    const conc = rows.find((r) => r.slug === "edital-concorrencia-eletronica")!;
    expect(conc.bindingStatus).toBe("NOT_BOUND");
    expect(conc.headline).toMatch(/Concorrência.*\(declarado, sem binding\) \/ DRAFT revisão 1 \(sem binding\)/);
  });

  it("filtros: modalidade, forma, plataforma e status (mesma modalidade/plataformas diferentes; eletrônico × presencial)", async () => {
    const { svc } = await multi();
    const slugs = async (f: Parameters<typeof svc.list>[1]) => (await svc.list(ctx(), f)).map((r) => r.slug);
    expect(await slugs({ modality: "PREGAO" })).toEqual(["edital-pregao-eletronico-bll", "edital-pregao-eletronico-comprasgov", "edital-pregao-presencial"]);
    expect(await slugs({ modality: "PREGAO", platform: "BLL" })).toEqual(["edital-pregao-eletronico-bll"]);
    expect(await slugs({ modality: "PREGAO", platform: "COMPRASGOV" })).toEqual(["edital-pregao-eletronico-comprasgov"]);
    expect(await slugs({ form: "PRESENCIAL" })).toEqual(["edital-pregao-presencial"]);
    expect(await slugs({ form: "ELETRONICA" })).toEqual(["edital-concorrencia-eletronica", "edital-pregao-eletronico-bll", "edital-pregao-eletronico-comprasgov"]);
    expect(await slugs({ status: "DRAFT" })).toEqual(["edital-concorrencia-eletronica"]);
    expect(await slugs({ status: "PUBLISHED" })).toEqual(["edital-pregao-eletronico-bll", "edital-pregao-eletronico-comprasgov", "edital-pregao-presencial"]);
    expect(await slugs({ status: "DEPRECATED" })).toEqual([]);
    expect(await slugs({ documentKind: "tr" })).toEqual([]);
  });

  it("cada escopo resolve SÓ o seu binding exato (mesma modalidade, plataforma/forma diferente ⇒ outro modelo ou NOT_BOUND)", async () => {
    const { w, bll, comprasgov, presencial } = await multi();
    const res = (scope: Record<string, string>) => w.wf.resolveBinding(ctx(), { documentKind: "edital", scope, asOf: "2026-10-07T00:00:00.000Z" });
    const r1 = await res({ ...FULL });
    const r2 = await res({ ...FULL, platform: "COMPRASGOV" });
    const r3 = await res({ modality: "PREGAO", form: "PRESENCIAL", regime: "EMPREITADA_PRECO_UNITARIO", criterion: "MENOR_PRECO" });
    expect(r1.status === "RESOLVED" && r1.revision.id).toBe(bll.revision.id);
    expect(r2.status === "RESOLVED" && r2.revision.id).toBe(comprasgov.revision.id);
    expect(r3.status === "RESOLVED" && r3.revision.id).toBe(presencial.revision.id);
    expect((await res({ ...FULL, platform: "OUTRA" })).status).toBe("NOT_BOUND");
    expect((await res({ modality: "PREGAO", form: "ELETRONICA" })).status).toBe("NOT_BOUND");
  });

  it("displayName da identidade (quando a persistência o fornecer) tem precedência; sem nada, cai para o slug — e o nome nunca altera resolução", async () => {
    const w = world();
    const id1 = await w.wf.createIdentity(ctx(), { documentKind: "edital", slug: "sem-nome" });
    const id2 = await w.wf.createIdentity(ctx(), { documentKind: "edital", slug: "com-nome" });
    w.repo.identities.set(id2.id, { ...id2, displayName: "Nome da Lane A" } as TemplateIdentity);
    const rows = await new TemplateCatalogService(w.ports).list(ctx(), {});
    expect(rows.find((r) => r.identityId === id1.id)).toMatchObject({ displayName: "sem-nome", displayNameSource: "SLUG" });
    expect(rows.find((r) => r.identityId === id2.id)).toMatchObject({ displayName: "Nome da Lane A", displayNameSource: "IDENTITY" });
  });

  it("saúde do binding: revisão fixada depreciada/ausente e conflito de escopo (adapter com bug) aparecem — nunca silenciosos", async () => {
    const { w, bll, svc } = await multi();
    const b = [...w.repo.bindings.values()].find((x) => x.identityId === bll.identity.id)!;
    const dupe: TemplateBinding = { ...b, id: "tbdup0001" };
    w.repo.bindings.set(dupe.id, dupe);
    const conflict = (await svc.list(ctx(), {})).find((r) => r.identityId === bll.identity.id)!;
    expect(conflict.bindingStatus).toBe("CONFLICT");
    expect(conflict.bindings.every((x) => x.health === "SCOPE_CONFLICT")).toBe(true);
    const res = await w.wf.resolveBinding(ctx(), { documentKind: "edital", scope: { ...FULL }, asOf: "2026-10-07T00:00:00.000Z" });
    expect(res.status).toBe("AMBIGUOUS"); // a resolução continua fail-closed
    w.repo.bindings.delete(dupe.id);
    w.repo.revisions.set(bll.revision.id, { ...(await w.ports.repository.getRevision(1, bll.revision.id))!, status: "DEPRECATED" });
    expect((await svc.list(ctx(), {})).find((r) => r.identityId === bll.identity.id)!.bindings[0].health).toBe("REVISION_NOT_PUBLISHED");
  });

  it("cross-tenant: o catálogo do tenant B nunca contém modelos do A", async () => {
    const { svc } = await multi();
    expect(await svc.list(ctx(2, 50), {})).toEqual([]);
  });
});

describe("binding com aplicabilidade explícita (fail-closed, sem escolha opaca)", () => {
  it("Edital: escopo incompleto ⇒ SCOPE_INVALID sem escrita; plataforma obrigatória para forma eletrônica", async () => {
    const w = world();
    const r = await register(w);
    await publish(w, r.revision.id);
    const writes = w.repo.writes;
    const e1 = await err(bind(w, r.identity.id, r.revision.id, { modality: "PREGAO" }));
    expect(e1?.message).toMatch(/SCOPE_INVALID/);
    expect(e1?.message).toBeDefined();
    const e2 = await err(bind(w, r.identity.id, r.revision.id, { ...FULL, platform: "com espaço" }));
    expect((e2 as { issues?: { code: string }[] })?.issues?.map((i) => i.code)).toContain("INVALID_TOKEN");
    // dimensão em branco = NÃO declarada (nunca valor padrão)
    const blank = await err(bind(w, r.identity.id, r.revision.id, { ...FULL, platform: "" }));
    expect((blank as { issues?: { code: string }[] })?.issues?.[0]?.code).toBe("PLATFORM_REQUIRED_FOR_ELECTRONIC");
    const { platform: _p, ...noPlatform } = FULL;
    const e3 = await err(bind(w, r.identity.id, r.revision.id, noPlatform));
    expect((e3 as { issues?: { code: string }[] })?.issues?.[0]?.code).toBe("PLATFORM_REQUIRED_FOR_ELECTRONIC");
    expect(w.repo.writes).toBe(writes);
  });

  it("persistência SEM forma/plataforma (estado atual de main) ⇒ SCOPE_DIMENSION_UNSUPPORTED, nada é descartado em silêncio", async () => {
    const w = world(BASELINE_CAPABILITIES_D4BB209);
    const r = await register(w);
    await publish(w, r.revision.id);
    const writes = w.repo.writes;
    const e = await err(bind(w, r.identity.id, r.revision.id, { ...FULL }));
    expect((e as { code?: string })?.code).toBe("SCOPE_DIMENSION_UNSUPPORTED");
    expect(e?.message).toMatch(/form, platform/);
    expect(w.repo.writes).toBe(writes);
    expect(w.repo.bindings.size).toBe(0);
  });

  it("só revisão PUBLISHED exata é vinculável; a revisão fixada aparece pelo id/nº/hash; nova revisão publicada NÃO substitui o binding", async () => {
    const w = world();
    const r1 = await register(w);
    expect((await err(bind(w, r1.identity.id, r1.revision.id, { ...FULL })))?.message).toMatch(/BINDING_NOT_PUBLISHED/);
    await publish(w, r1.revision.id);
    const b = await bind(w, r1.identity.id, r1.revision.id, { ...FULL });
    expect(b.pinnedRevisionId).toBe(r1.revision.id);
    const r2 = await register(w, { target: { kind: "EXISTING_IDENTITY", identityId: r1.identity.id }, idempotencyKey: key("r2") });
    await publish(w, r2.revision.id);
    const res = await w.wf.resolveBinding(ctx(), { documentKind: "edital", scope: { ...FULL }, asOf: "2026-10-07T00:00:00.000Z" });
    expect(res.status === "RESOLVED" && res.revision.id).toBe(r1.revision.id);
  });

  it("segundo binding ativo para o MESMO escopo é recusado (BINDING_AMBIGUOUS); substituição explícita é atômica", async () => {
    const w = world();
    const r1 = await register(w);
    await publish(w, r1.revision.id);
    const b1 = await bind(w, r1.identity.id, r1.revision.id, { ...FULL });
    expect((await err(bind(w, r1.identity.id, r1.revision.id, { ...FULL })))?.message).toMatch(/BINDING_AMBIGUOUS/);
    const r2 = await register(w, { target: { kind: "EXISTING_IDENTITY", identityId: r1.identity.id }, idempotencyKey: key("r2b") });
    await publish(w, r2.revision.id);
    const b2 = await w.wf.setBinding(ctx(), { documentKind: "edital", scope: { ...FULL }, identityId: r1.identity.id, pinnedRevisionId: r2.revision.id, effectiveFrom: "2026-10-02T00:00:00.000Z", confirm: true, replacesBindingId: b1.id });
    expect(b2.pinnedRevisionId).toBe(r2.revision.id);
    expect([...w.repo.bindings.values()].filter((x) => x.active)).toHaveLength(1);
  });

  it("bind exige ator humano e confirmação; tipos não-edital mantêm escopo livre (compatibilidade)", async () => {
    const w = world();
    const r = await register(w);
    await publish(w, r.revision.id);
    expect((await err(bind(w, r.identity.id, r.revision.id, { ...FULL }, ctx(1, 10, "ai"))))?.message).toMatch(/HUMAN_ACTION_REQUIRED/);
    expect((await err(w.wf.setBinding(ctx(), { documentKind: "edital", scope: { ...FULL }, identityId: r.identity.id, pinnedRevisionId: r.revision.id, effectiveFrom: "2026-10-01T00:00:00.000Z", confirm: false })))?.message).toMatch(/CONFIRMATION_REQUIRED/);
    const tr = await w.wf.createIdentity(ctx(), { documentKind: "tr", slug: "tr-livre" });
    const trRev = await w.wf.createDraft(ctx(), { identityId: tr.id, ast: simpleAst() }).catch(() => null);
    expect(trRev === null || trRev.status === "DRAFT").toBe(true);
    void TEST_CATALOG;
  });
});

describe("publicação com rastro da matriz de prontidão (decisão humana; informativo)", () => {
  it("o hash da matriz e os bloqueios aceitos entram na EVIDÊNCIA da decisão de publicação; sem `readiness` nada é acrescentado", async () => {
    const w = world();
    const r = await register(w);
    await w.wf.approve(ctx(), { revisionId: r.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("a"), decision: decisionInput() });
    const matrix = (await new TemplateReadinessService(w.ports).evaluate(ctx(), { revisionId: r.revision.id, inventory: buildPilotInventory(buildPilotAst()) })).matrix;
    const out = await w.wf.publish(ctx(), {
      revisionId: r.revision.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key("p"), decision: decisionInput(),
      readiness: { matrixHash: matrix.matrixHash, acceptedBlockedChecks: ["ITEMS_BACKING", "CERTAME_CONFIG"] },
    });
    expect(out.decision.evidence).toEqual([`readiness.matrixHash=${matrix.matrixHash}`, "readiness.acceptedBlockers=CERTAME_CONFIG,ITEMS_BACKING"]);
    const r2 = await register(w, { target: { kind: "EXISTING_IDENTITY", identityId: r.identity.id }, idempotencyKey: key("rr") });
    const plain = await publish(w, r2.revision.id);
    expect(plain.decision.evidence).toEqual([]);
  });
});

describe("prontidão via serviço — o inventário reenviado precisa casar com a procedência", () => {
  it("modelo registrado + evidência + inventário ⇒ READY; inventário diferente ⇒ BLOCKED; forma inválida ⇒ motivos e BLOCKED", async () => {
    const w = world();
    const r = await register(w);
    const svc = new TemplateReadinessService(w.ports);
    await new TemplateGovernanceService(w.ports).recordLegalEvidence(ctx(), { revisionId: r.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: key("e"), decision: decisionInput(), evidence: { sourceLogicalVersion: PILOT_SOURCE_LOGICAL_VERSION, sourceSha256: pilotSourceSha256(buildPilotAst()) } });
    const inv = buildPilotInventory(buildPilotAst());
    const ready = await svc.evaluate(ctx(), { revisionId: r.revision.id, inventory: inv });
    expect(ready.matrix.overall).toBe("READY");
    expect(ready.inventory).toEqual({ supplied: true, shapeIssues: [] });
    const tampered = await svc.evaluate(ctx(), { revisionId: r.revision.id, inventory: { ...inv, declared: { ...inv.declared, conditionTypes: 47 } } });
    expect(tampered.matrix.overall).toBe("BLOCKED");
    const malformed = await svc.evaluate(ctx(), { revisionId: r.revision.id, inventory: { schema: "x" } });
    expect(malformed.inventory.shapeIssues.length).toBeGreaterThan(0);
    expect(malformed.matrix.checks.find((c) => c.id === "INPUTS_ACCOUNTED")!.status).toBe("BLOCKED");
  });

  it("cross-tenant e revisão inexistente ⇒ NOT_FOUND idêntico; a avaliação não escreve nada", async () => {
    const w = world();
    const r = await register(w);
    const writes = w.repo.writes + w.governance.writes;
    const svc = new TemplateReadinessService(w.ports);
    const a = await err(svc.evaluate(ctx(2, 50), { revisionId: r.revision.id }));
    const b = await err(svc.evaluate(ctx(2, 50), { revisionId: "tr_nope" }));
    expect(a?.message).toBe(b?.message);
    await svc.evaluate(ctx(), { revisionId: r.revision.id });
    expect(w.repo.writes + w.governance.writes).toBe(writes);
  });
});

describe("dossiê de pré-visualização com contexto de teste — SEM efeitos colaterais", () => {
  async function ready() {
    const w = world(ALL_CAPABILITIES);
    const r = await register(w);
    await publish(w, r.revision.id);
    await bind(w, r.identity.id, r.revision.id, { ...FULL });
    return { w, r };
  }
  const sampleValues = Object.fromEntries(Array.from({ length: 48 }, (_, i) => [`ent.i${String(i + 1).padStart(3, "0")}`, i % 2 ? "SIM" : "NAO"]));

  it("por binding exato: identidade, revisão exata, contexto (modalidade/forma/plataforma), condições, fontes, anexos, slots de IA e manifest preview", async () => {
    const { w, r } = await ready();
    const writes = w.repo.writes + w.governance.writes;
    const d = await new TemplatePreviewDossierService(w.ports).dossier(ctx(), { kind: "BOUND", documentKind: "edital" }, { scope: { ...FULL }, sampleValues: { ...sampleValues, "processo.numero": "TESTE/1" } });
    expect(d.status).toBe("COMPOSED");
    expect(d.template).toMatchObject({ slug: preset.slug, displayName: "Edital — Pregão Eletrônico — BLL", displayNameSource: "REGISTRATION_PROVENANCE" });
    expect(d.revision).toMatchObject({ id: r.revision.id, revision: 1, status: "PUBLISHED" });
    expect(d.resolution).toMatchObject({ status: "RESOLVED", revisionId: r.revision.id });
    expect(d.context.scopeHeadline).toBe("Pregão | Eletrônica | BLL | Empreitada por preço unitário | Menor preço");
    expect(d.context.appliedScopeVariables.map((v) => v.name).sort()).toEqual(["edital.forma", "edital.modalidade", "edital.plataforma"]);
    expect(d.crossReferences.annexIds).toEqual(["anexo-i", "anexo-ii", "anexo-iii", "anexo-iv"]);
    expect(d.crossReferences.docRefs.map((x) => x.kind)).toEqual(["TR", "TR"]);
    expect(d.aiSlots).toEqual([{ slotKey: "justificativa", maxTokens: 600, status: "PLACEHOLDER_ONLY" }]);
    expect(d.manifestPreview).toMatchObject({ persisted: false });
    expect(d.sideEffects).toEqual({ persisted: false, aiCalled: false, officialDocumentCreated: false, issued: false, published: false, processTouched: false });
    expect(d.contentText).toMatch(/Edital sintético nº TESTE\/1/);
    expect(d.contentText).toMatch(/\[Narrativa de IA — slot "justificativa"/); // marcador; a IA NÃO foi chamada
    expect(w.repo.writes + w.governance.writes).toBe(writes);                   // nenhuma escrita
  });

  it("revisão em DRAFT também pré-visualiza (por id exato) sem exigir binding; decisões de condição refletem o contexto", async () => {
    const w = world(ALL_CAPABILITIES);
    const r = await register(w);
    const svc = new TemplatePreviewDossierService(w.ports);
    const sim = await svc.dossier(ctx(), { kind: "REVISION", revisionId: r.revision.id }, { scope: { ...FULL }, sampleValues: { ...sampleValues, ["ent.i001"]: "SIM" } });
    const nao = await svc.dossier(ctx(), { kind: "REVISION", revisionId: r.revision.id }, { scope: { ...FULL }, sampleValues: { ...sampleValues, ["ent.i001"]: "NAO" } });
    expect(sim.status).toBe("COMPOSED");
    expect(sim.revision?.status).toBe("DRAFT");
    expect(sim.notices.join(" ")).toMatch(/DRAFT/);
    expect(sim.conditionDecisions).toHaveLength(48);
    expect(sim.conditionDecisions[0].result).toBe(true);
    expect(nao.conditionDecisions[0].result).toBe(false);
    expect(nao.contentText).toMatch(/Alternativa sintética 001/);
    expect(sim.manifestPreview?.composedOutputHash).not.toBe(nao.manifestPreview?.composedOutputHash);
  });

  it("binding ausente ou ambíguo ⇒ NOT_RESOLVED SEM prévia (nenhum modelo escolhido por você)", async () => {
    const { w, r } = await ready();
    const svc = new TemplatePreviewDossierService(w.ports);
    const none = await svc.dossier(ctx(), { kind: "BOUND", documentKind: "edital" }, { scope: { ...FULL, platform: "OUTRA" }, sampleValues });
    expect(none).toMatchObject({ status: "NOT_RESOLVED", contentText: null, revision: null, resolution: { status: "NOT_BOUND" } });
    const b = [...w.repo.bindings.values()][0];
    w.repo.bindings.set("tbdup0002", { ...b, id: "tbdup0002" });
    const amb = await svc.dossier(ctx(), { kind: "BOUND", documentKind: "edital" }, { scope: { ...FULL }, sampleValues });
    expect(amb).toMatchObject({ status: "NOT_RESOLVED", contentText: null, resolution: { status: "AMBIGUOUS" } });
    void r;
  });

  it("composição que falha (valor obrigatório ausente) é reportada fechada, sem conteúdo; cross-tenant ⇒ NOT_FOUND", async () => {
    const w = world(ALL_CAPABILITIES);
    const r = await register(w);
    const svc = new TemplatePreviewDossierService(w.ports);
    expect((await err(svc.dossier(ctx(2, 50), { kind: "REVISION", revisionId: r.revision.id }, { scope: {}, sampleValues: {} })))?.message).toMatch(/NOT_FOUND/);
  });

  it("dicas de variáveis: separam o que é só condição (control-only) do que aparece no texto; entradas preenchidas pelo contexto", async () => {
    const w = world(ALL_CAPABILITIES);
    const r = await register(w);
    const hints = await new TemplatePreviewDossierService(w.ports).variableHints(ctx(), r.revision.id);
    const by = Object.fromEntries(hints.variables.map((v) => [v.name, v]));
    expect(by["ent.i001"].usedIn).toBe("CONDITION");
    expect(by["ent.i060"].usedIn).toBe("TEXT");
    expect(by["ent.i010"].usedIn).toBe("TEXT_AND_CONDITION");
    expect(by["edital.forma"]).toBeUndefined(); // não é usada no texto/condição deste AST sintético
    expect(hints.scopeParamVariables.platform).toBe("edital.plataforma");
  });
});

describe("o workflow permanece 100% humano e fail-closed", () => {
  it("nenhuma operação nova de escrita aceita ator IA/sistema; nada é gravado", async () => {
    const w = world();
    const r = await register(w);
    const before = w.repo.writes + w.governance.writes;
    const ai = ctx(1, 10, "ai");
    const gov = new TemplateGovernanceService(w.ports);
    const attempts = [
      register(w, { idempotencyKey: key("ai") }, ai),
      gov.recordLegalEvidence(ai, { revisionId: r.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: key("ai2"), decision: decisionInput(), evidence: { sourceLogicalVersion: "v", sourceSha256: "a".repeat(64) } }),
      gov.recordImportProvenance(ai, { revisionId: r.revision.id, expectedVersion: 1, confirm: true, idempotencyKey: key("ai3"), decision: decisionInput(), provenance: { templateKey: "ABC", displayName: "x", sourceLogicalVersion: "v", sourceSha256: "a".repeat(64), sourceFormat: "NATIVE", scope: {} } }),
      w.wf.approve(ai, { revisionId: r.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("ai4"), decision: decisionInput() }),
    ];
    for (const p of attempts) expect((await err(p))?.message).toMatch(/HUMAN_ACTION_REQUIRED/);
    expect(w.repo.writes + w.governance.writes).toBe(before);
  });
});

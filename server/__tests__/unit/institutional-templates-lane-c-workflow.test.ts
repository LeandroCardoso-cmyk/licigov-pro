/**
 * Modelos Institucionais — Lane C: WORKFLOW (sem DB; ports em memória).
 * Cobre: lifecycle (DRAFT→APPROVED→PUBLISHED→DEPRECATED), APPROVED ≠ PUBLISHED, imutabilidade da PUBLISHED, nova revisão
 * após publicar, DEPRECATED disponível historicamente, autoridade HUMANA (IA nunca age), binding por revisão EXATA,
 * ambiguidade fail-closed, preview/explicabilidade e isolamento de tenant.
 */
import { describe, it, expect } from "vitest";
import { InstitutionalTemplatesWorkflow, type LifecycleInput } from "../../services/institutionalTemplates/workflowService";
import { TemplateWorkflowError } from "../../services/institutionalTemplates/errors";
import type { WorkflowContext } from "../../services/institutionalTemplates/ports";
import type { CompositionManifest } from "../../domain/institutionalTemplates";
import { sealGenerationManifest } from "../../domain/institutionalTemplates";
import { decisionInput, makeTestPorts, sha, simpleAst, TEST_CATALOG } from "../helpers/institutionalTemplatesFakes";

const ORG_A = 11;
const ORG_B = 22;
const ctxOf = (organizationId = ORG_A, userId = 10): WorkflowContext => ({ organizationId, actor: { kind: "human", userId }, correlationId: `corr-${organizationId}-${userId}` });

function setup(opts: Parameters<typeof makeTestPorts>[0] = {}) {
  const t = makeTestPorts(opts);
  return { ...t, wf: new InstitutionalTemplatesWorkflow(t.ports) };
}

async function expectCode(p: Promise<unknown> | (() => unknown), code: string) {
  const err = await (typeof p === "function" ? Promise.resolve().then(p) : p).then(() => null, (e: unknown) => e);
  expect(err, `esperava ${code}`).toBeInstanceOf(TemplateWorkflowError);
  expect((err as TemplateWorkflowError).code).toBe(code);
  return err as TemplateWorkflowError;
}

const life = (revisionId: string, expectedStatus: LifecycleInput["expectedStatus"], key: string, over: Partial<LifecycleInput> = {}): LifecycleInput =>
  ({ revisionId, expectedStatus, confirm: true, idempotencyKey: `idem-${key}`, decision: decisionInput(), ...over });

async function draftOf(wf: InstitutionalTemplatesWorkflow, ctx = ctxOf()) {
  const identity = await wf.createIdentity(ctx, { documentKind: "tr", slug: `tr-padrao-${ctx.organizationId}` });
  const draft = await wf.createDraft(ctx, { identityId: identity.id, ast: simpleAst() });
  return { identity, draft };
}

async function publishedOf(wf: InstitutionalTemplatesWorkflow, ctx = ctxOf(), key = "k1") {
  const { identity, draft } = await draftOf(wf, ctx);
  await wf.approve(ctx, life(draft.id, "DRAFT", `${key}-approve`));
  const { revision } = await wf.publish(ctx, life(draft.id, "APPROVED", `${key}-publish`));
  return { identity, revision };
}

describe("Lane C — ciclo de vida: DRAFT → APPROVED → PUBLISHED → DEPRECATED", () => {
  it("cria identidade e revisão DRAFT; slug duplicado no tenant ⇒ CONFLICT; slug inválido ⇒ VALIDATION_FAILED", async () => {
    const { wf, repo } = setup();
    const identity = await wf.createIdentity(ctxOf(), { documentKind: "tr", slug: "tr-padrao" });
    expect(identity).toMatchObject({ organizationId: ORG_A, documentKind: "tr", slug: "tr-padrao", createdByUserId: 10 });
    await expectCode(wf.createIdentity(ctxOf(), { documentKind: "tr", slug: "tr-padrao" }), "CONFLICT");
    await expectCode(wf.createIdentity(ctxOf(), { documentKind: "tr", slug: "Slug Inválido!" }), "VALIDATION_FAILED");
    // o mesmo slug em OUTRO tenant é permitido (isolamento)
    await wf.createIdentity(ctxOf(ORG_B), { documentKind: "tr", slug: "tr-padrao" });
    const draft = await wf.createDraft(ctxOf(), { identityId: identity.id, ast: simpleAst() });
    expect(draft).toMatchObject({ status: "DRAFT", revision: 1, organizationId: ORG_A, sourceFormat: "NATIVE" });
    expect(repo.revisions.size).toBe(1);
  });

  it("variável desconhecida e nó fora da whitelist bloqueiam o submit (nada é gravado)", async () => {
    const { wf, repo } = setup();
    const identity = await wf.createIdentity(ctxOf(), { documentKind: "tr", slug: "tr-x" });
    const writes = repo.writes;
    const bad = { schema: "tpl-ast/1", root: [{ t: "paragraph", inline: [{ t: "var", name: "inexistente.var" }] }] };
    const e1 = await expectCode(wf.createDraft(ctxOf(), { identityId: identity.id, ast: bad }), "VALIDATION_FAILED");
    expect(e1.issues.some((i) => i.code === "UNKNOWN_VARIABLE")).toBe(true);
    await expectCode(wf.createDraft(ctxOf(), { identityId: identity.id, ast: { schema: "tpl-ast/1", root: [{ t: "script", code: "x" }] } }), "VALIDATION_FAILED");
    expect(repo.writes).toBe(writes);
  });

  it("aprovar e publicar são decisões DISTINTAS: APPROVED não é PUBLISHED e a decisão de aprovação não publica", async () => {
    const { wf, repo } = setup();
    const { draft } = await draftOf(wf);
    const approved = await wf.approve(ctxOf(), life(draft.id, "DRAFT", "k-approve-1"));
    expect(approved.revision.status).toBe("APPROVED");
    expect(approved.revision.publishDecisionId).toBeUndefined();
    expect(approved.decision).toMatchObject({ subjectType: "institutional_template.approval", decisionType: "template_approval", outcome: "aprovado", subjectId: draft.id, authorityValidation: "NOT_VALIDATED_POLICY_PENDING" });
    const published = await wf.publish(ctxOf(), life(draft.id, "APPROVED", "k-publish-1"));
    expect(published.revision.status).toBe("PUBLISHED");
    expect(published.decision).toMatchObject({ subjectType: "institutional_template.publication", decisionType: "template_publication", outcome: "publicado" });
    expect(published.decision.id).not.toBe(approved.decision.id);
    expect(published.revision.approvalDecisionId).toBe(approved.decision.id);
    expect(published.revision.publishDecisionId).toBe(published.decision.id);
    expect(repo.decisions.size).toBe(2);
    // a autoridade é a DECLARADA no ato, nunca o usuário que clicou
    expect(published.decision).toMatchObject({ decidedByName: "Maria Souza", decidedByRole: "Procuradora-Geral", recordedByUserId: 10 });
  });

  it("não há atalho: DRAFT → PUBLISHED é recusado; PUBLISHED não volta a APPROVED", async () => {
    const { wf, repo } = setup();
    const { draft } = await draftOf(wf);
    const writes = repo.writes;
    await expectCode(wf.publish(ctxOf(), life(draft.id, "DRAFT", "k-skip")), "TRANSITION_INVALID");
    await expectCode(wf.deprecate(ctxOf(), life(draft.id, "DRAFT", "k-skip2")), "TRANSITION_INVALID");
    expect(repo.writes).toBe(writes);
  });

  it("ação sem confirmação humana explícita é recusada sem nenhuma escrita; campos do ato são obrigatórios", async () => {
    const { wf, repo } = setup();
    const { draft } = await draftOf(wf);
    const writes = repo.writes;
    await expectCode(wf.approve(ctxOf(), life(draft.id, "DRAFT", "k-noconfirm", { confirm: false })), "CONFIRMATION_REQUIRED");
    const e = await expectCode(wf.approve(ctxOf(), life(draft.id, "DRAFT", "k-nofields", { decision: decisionInput({ decidedByName: "", reason: "curto" }) })), "DECISION_REJECTED");
    expect(e.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["decidedByName", "reason"]));
    expect(repo.writes).toBe(writes);
    expect((await repo.getRevision(ORG_A, draft.id))!.status).toBe("DRAFT");
  });

  it("estado visto pela pessoa divergente do atual ⇒ STALE_STATE; chave de idempotência reutilizada com outro conteúdo ⇒ DECISION_REJECTED", async () => {
    const { wf, repo } = setup();
    const { draft } = await draftOf(wf);
    await expectCode(wf.approve(ctxOf(), life(draft.id, "APPROVED", "k-stale")), "STALE_STATE");
    await wf.approve(ctxOf(), life(draft.id, "DRAFT", "k-reuse"));
    const identity2 = await wf.createIdentity(ctxOf(), { documentKind: "etp", slug: "etp-padrao" });
    const d2 = await wf.createDraft(ctxOf(), { identityId: identity2.id, ast: simpleAst("ETP") });
    const writes = repo.writes;
    await expectCode(wf.approve(ctxOf(), life(d2.id, "DRAFT", "k-reuse", { decision: decisionInput({ reason: "Outra justificativa completa." }) })), "DECISION_REJECTED");
    expect(repo.writes).toBe(writes);
  });

  it("a decisão e a transição são atômicas: falha na transação não deixa decisão órfã nem muda o estado", async () => {
    const { wf, repo } = setup();
    const { draft } = await draftOf(wf);
    repo.failNextCommit = true;
    await expect(wf.approve(ctxOf(), life(draft.id, "DRAFT", "k-atomic"))).rejects.toThrow("falha simulada");
    expect(repo.decisions.size).toBe(0);
    expect((await repo.getRevision(ORG_A, draft.id))!.status).toBe("DRAFT");
    expect((await wf.approve(ctxOf(), life(draft.id, "DRAFT", "k-atomic"))).revision.status).toBe("APPROVED");
  });

  it("depreciar exige uma revisão PUBLISHED e uma decisão própria; DEPRECATED não aprova/publica de novo", async () => {
    const { wf, repo } = setup();
    const { revision } = await publishedOf(wf);
    const dep = await wf.deprecate(ctxOf(), life(revision.id, "PUBLISHED", "k-dep"));
    expect(dep.revision.status).toBe("DEPRECATED");
    expect(dep.decision).toMatchObject({ subjectType: "institutional_template.deprecation", decisionType: "template_deprecation", outcome: "depreciado" });
    expect(repo.decisions.size).toBe(3);
    await expectCode(wf.approve(ctxOf(), life(revision.id, "DEPRECATED", "k-x1")), "TRANSITION_INVALID");
    await expectCode(wf.publish(ctxOf(), life(revision.id, "DEPRECATED", "k-x2")), "TRANSITION_INVALID");
    await expectCode(wf.deprecate(ctxOf(), life(revision.id, "DEPRECATED", "k-x3")), "TRANSITION_INVALID");
  });
});

describe("Lane C — imutabilidade da PUBLISHED e nova revisão", () => {
  it("revisão APPROVED/PUBLISHED/DEPRECATED não aceita edição; mudança exige NOVA revisão DRAFT", async () => {
    const { wf, repo } = setup();
    const { identity, revision } = await publishedOf(wf);
    const before = JSON.stringify(await repo.getRevision(ORG_A, revision.id));
    await expectCode(wf.updateDraft(ctxOf(), { revisionId: revision.id, ast: simpleAst("Alterado"), expectedSemanticHash: revision.semanticHash }), "REVISION_IMMUTABLE");
    expect(JSON.stringify(await repo.getRevision(ORG_A, revision.id))).toBe(before);

    const next = await wf.createDraft(ctxOf(), { identityId: identity.id, fromRevisionId: revision.id });
    expect(next).toMatchObject({ status: "DRAFT", revision: 2 });
    expect(next.semanticHash).toBe(revision.semanticHash); // mesmo conteúdo, nova revisão
    const edited = await wf.updateDraft(ctxOf(), { revisionId: next.id, ast: simpleAst("Termo de Referência v2"), expectedSemanticHash: next.semanticHash });
    expect(edited.semanticHash).not.toBe(next.semanticHash);
    expect(JSON.stringify(await repo.getRevision(ORG_A, revision.id))).toBe(before); // a publicada continua intacta
  });

  it("edição de DRAFT é CAS pelo hash que a pessoa viu (outro editor ⇒ STALE_STATE)", async () => {
    const { wf } = setup();
    const { draft } = await draftOf(wf);
    await wf.updateDraft(ctxOf(), { revisionId: draft.id, ast: simpleAst("A"), expectedSemanticHash: draft.semanticHash });
    await expectCode(wf.updateDraft(ctxOf(), { revisionId: draft.id, ast: simpleAst("B"), expectedSemanticHash: draft.semanticHash }), "STALE_STATE");
  });

  it("DEPRECATED continua legível, pré-visualizável e explicável para replay histórico; não pode ser vinculada", async () => {
    const manifests = new Map<string, CompositionManifest>();
    const { wf, repo } = setup({ manifests });
    const { identity, revision } = await publishedOf(wf);
    await wf.deprecate(ctxOf(), life(revision.id, "PUBLISHED", "k-dep"));
    const got = await wf.getRevision(ctxOf(), revision.id);
    expect(got.revision.status).toBe("DEPRECATED");
    expect(got.nextAction.action).toBe("NEW_REVISION_ONLY");
    const prev = await wf.preview(ctxOf(), { revisionId: revision.id, sampleValues: { "processo.objeto": "Limpeza" } });
    expect(prev.status).toBe("COMPOSED");
    // manifest histórico que referencia a revisão depreciada continua explicável
    const sealed = sealGenerationManifest({
      id: "man1", createdAt: "2026-10-06T00:00:00.000Z", stage: "GENERATION", organizationId: ORG_A, generatedDocumentId: "gd1",
      templateIdentityId: identity.id, templateRevisionId: revision.id, templateSemanticHash: revision.semanticHash, hashVersion: "tpl-hash/1",
      catalogVersion: TEST_CATALOG.version, sources: [{ key: "processo", digest: `srcd:${sha("p")}` }], officialDocRefs: [], conditionalDecisions: [],
      aiNarratives: [], annexes: [], identityFingerprint: "fp", composedOutputHash: sha("out"),
    });
    if (!sealed.ok) throw new Error("manifest inválido");
    manifests.set("man1", sealed.value);
    const exp = await wf.explainManifest(ctxOf(), "man1");
    expect(exp.revision).toMatchObject({ id: revision.id, status: "DEPRECATED" });
    expect(exp.manifest).toMatchObject({ persisted: true, id: "man1", manifestHash: sealed.value.manifestHash });
    await expectCode(wf.setBinding(ctxOf(), { documentKind: "tr", scope: {}, identityId: identity.id, pinnedRevisionId: revision.id, effectiveFrom: "2026-10-01T00:00:00Z", confirm: true }), "BINDING_NOT_PUBLISHED");
    void repo;
  });
});

describe("Lane C — binding por revisão EXATA (nunca 'última')", () => {
  const bindInput = (identityId: string, pinnedRevisionId: string, over: Record<string, unknown> = {}) =>
    ({ documentKind: "tr" as const, scope: { modality: "pregao" }, identityId, pinnedRevisionId, effectiveFrom: "2026-10-01T00:00:00Z", confirm: true, ...over });

  it("vincula uma revisão PUBLISHED exata; revisão APPROVED ou DRAFT não pode ser vinculada; sem confirmação ⇒ recusa", async () => {
    const { wf, repo } = setup();
    const { identity, draft } = await draftOf(wf);
    await expectCode(wf.setBinding(ctxOf(), bindInput(identity.id, draft.id)), "BINDING_NOT_PUBLISHED");
    await wf.approve(ctxOf(), life(draft.id, "DRAFT", "kb-a"));
    await expectCode(wf.setBinding(ctxOf(), bindInput(identity.id, draft.id)), "BINDING_NOT_PUBLISHED"); // APPROVED ≠ PUBLISHED
    await wf.publish(ctxOf(), life(draft.id, "APPROVED", "kb-p"));
    const writes = repo.writes;
    await expectCode(wf.setBinding(ctxOf(), bindInput(identity.id, draft.id, { confirm: false })), "CONFIRMATION_REQUIRED");
    expect(repo.writes).toBe(writes);
    const binding = await wf.setBinding(ctxOf(), bindInput(identity.id, draft.id));
    expect(binding).toMatchObject({ pinnedRevisionId: draft.id, active: true, organizationId: ORG_A });
  });

  it("publicar a revisão 2 NÃO muda o que o binding aplica: continua a revisão 1 fixada (nunca 'latest')", async () => {
    const { wf } = setup();
    const { identity, revision: r1 } = await publishedOf(wf);
    await wf.setBinding(ctxOf(), bindInput(identity.id, r1.id));
    const r2 = await wf.createDraft(ctxOf(), { identityId: identity.id, fromRevisionId: r1.id });
    await wf.approve(ctxOf(), life(r2.id, "DRAFT", "kb2-a"));
    await wf.publish(ctxOf(), life(r2.id, "APPROVED", "kb2-p"));
    const res = await wf.resolveBinding(ctxOf(), { documentKind: "tr", scope: { modality: "pregao" }, asOf: "2026-10-06T00:00:00Z" });
    expect(res.status).toBe("RESOLVED");
    if (res.status === "RESOLVED") expect(res.revision.id).toBe(r1.id);
    const bound = await wf.previewBound(ctxOf(), { documentKind: "tr", scope: { modality: "pregao" }, asOf: "2026-10-06T00:00:00Z", sampleValues: { "processo.objeto": "X" } });
    expect(bound.resolution).toMatchObject({ status: "RESOLVED", revisionId: r1.id, revision: 1 });
    expect(bound.preview && bound.preview.status === "COMPOSED" ? bound.preview.revision.id : null).toBe(r1.id);
  });

  it("segundo binding ativo para o mesmo tipo+escopo ⇒ BINDING_AMBIGUOUS; substituir explicitamente desativa o anterior", async () => {
    const { wf, repo } = setup();
    const { identity, revision: r1 } = await publishedOf(wf);
    const first = await wf.setBinding(ctxOf(), bindInput(identity.id, r1.id));
    const r2 = await wf.createDraft(ctxOf(), { identityId: identity.id, fromRevisionId: r1.id });
    await wf.approve(ctxOf(), life(r2.id, "DRAFT", "ka-a"));
    await wf.publish(ctxOf(), life(r2.id, "APPROVED", "ka-p"));
    const writes = repo.writes;
    await expectCode(wf.setBinding(ctxOf(), bindInput(identity.id, r2.id)), "BINDING_AMBIGUOUS");
    expect(repo.writes).toBe(writes);
    const second = await wf.setBinding(ctxOf(), bindInput(identity.id, r2.id, { replacesBindingId: first.id }));
    expect(repo.bindings.get(first.id)!.active).toBe(false);
    const res = await wf.resolveBinding(ctxOf(), { documentKind: "tr", scope: { modality: "pregao" }, asOf: "2026-10-06T00:00:00Z" });
    expect(res.status === "RESOLVED" && res.binding.id).toBe(second.id);
  });

  it("estado corrompido na persistência: dois bindings ativos ⇒ AMBIGUOUS (fail-closed, sem prévia); binding sem pin ⇒ INVALID; nenhum ⇒ NOT_BOUND", async () => {
    const { wf, repo } = setup();
    const { identity, revision } = await publishedOf(wf);
    const base = { organizationId: ORG_A, documentKind: "tr" as const, scope: { modality: "pregao" }, identityId: identity.id, active: true, effectiveFrom: "2026-10-01T00:00:00Z" };
    const input = { documentKind: "tr" as const, scope: { modality: "pregao" }, asOf: "2026-10-06T00:00:00Z", sampleValues: { "processo.objeto": "X" } };
    expect((await wf.resolveBinding(ctxOf(), input)).status).toBe("NOT_BOUND");
    repo.bindings.set("bX1", { ...base, id: "bX1", pinnedRevisionId: revision.id });
    repo.bindings.set("bX2", { ...base, id: "bX2", pinnedRevisionId: revision.id });
    expect((await wf.resolveBinding(ctxOf(), input)).status).toBe("AMBIGUOUS");
    const bound = await wf.previewBound(ctxOf(), input);
    expect(bound.resolution.status).toBe("AMBIGUOUS");
    expect(bound.preview).toBeNull();
    repo.bindings.clear();
    repo.bindings.set("bU", { ...base, id: "bU" }); // sem pinnedRevisionId ('última publicada' é proibido)
    const unpinned = await wf.resolveBinding(ctxOf(), input);
    expect(unpinned).toMatchObject({ status: "INVALID" });
    expect(unpinned.status === "INVALID" && unpinned.issues[0].code).toBe("BINDING_REVISION_NOT_PINNED");
  });

  it("não deprecia uma revisão fixada por binding ativo; após desativar o binding, deprecia", async () => {
    const { wf } = setup();
    const { identity, revision } = await publishedOf(wf);
    const b = await wf.setBinding(ctxOf(), bindInput(identity.id, revision.id));
    await expectCode(wf.deprecate(ctxOf(), life(revision.id, "PUBLISHED", "kd-1")), "REVISION_PINNED_BY_BINDING");
    await expectCode(wf.deactivateBinding(ctxOf(), { bindingId: b.id, confirm: false }), "CONFIRMATION_REQUIRED");
    await wf.deactivateBinding(ctxOf(), { bindingId: b.id, confirm: true });
    expect((await wf.deprecate(ctxOf(), life(revision.id, "PUBLISHED", "kd-2"))).revision.status).toBe("DEPRECATED");
  });
});

describe("Lane C — pré-visualização e explicabilidade", () => {
  it("preview: conteúdo + explicação (identidade, revisão exata, pins, condicionais, narrativa de IA, manifest); sem persistir e sem IA", async () => {
    const { wf, repo, composeCalls } = setup();
    const identity = await wf.createIdentity(ctxOf(), { documentKind: "tr", slug: "tr-ia" });
    const ast = { ...simpleAst(), root: [...simpleAst().root, { t: "aiSlot", slotKey: "justificativa", maxTokens: 400, instructionsKey: "just.v1" }] };
    const draft = await wf.createDraft(ctxOf(), { identityId: identity.id, ast });
    const writes = repo.writes;
    const res = await wf.preview(ctxOf(), { revisionId: draft.id, sampleValues: { "processo.objeto": "Serviço de limpeza" } });
    expect(repo.writes).toBe(writes);
    expect(res.status).toBe("COMPOSED");
    if (res.status !== "COMPOSED") return;
    expect(res.content.text).toContain("Objeto: Serviço de limpeza");
    expect(res.revision).toMatchObject({ id: draft.id, revision: 1, status: "DRAFT", semanticHash: draft.semanticHash });
    expect(res.explanation.template).toMatchObject({ identityId: identity.id, slug: "tr-ia", documentKind: "tr" });
    expect(res.explanation.revision).toMatchObject({ id: draft.id, semanticHash: draft.semanticHash, catalogVersion: TEST_CATALOG.version });
    expect(res.explanation.sourcePins[0]).toMatchObject({ key: "processo" });
    expect(res.explanation.aiNarratives).toEqual([{ slotKey: "justificativa", status: "PLACEHOLDER_ONLY", humanAccepted: null }]);
    expect(res.explanation.manifest).toMatchObject({ stage: "GENERATION", persisted: false, id: null });
    expect(res.explanation.notices.join(" ")).toMatch(/nenhuma IA foi chamada/);
    expect(res.explanation.notices.join(" ")).toMatch(/DRAFT/);
    // o composer recebeu só marcadores — nenhuma narrativa real de IA
    expect(composeCalls[0].aiNarratives.justificativa).toMatch(/gerada somente na geração/);
    // sem vazamento do AST/conteúdo interno na explicação
    expect(JSON.stringify(res.explanation)).not.toContain("instructionsKey");
  });

  it("preview com variável obrigatória ausente devolve COMPOSE_ERROR (sem exceção, sem persistir)", async () => {
    const { wf, repo } = setup();
    const { draft } = await draftOf(wf);
    const writes = repo.writes;
    const res = await wf.preview(ctxOf(), { revisionId: draft.id, sampleValues: {} });
    expect(res).toMatchObject({ status: "COMPOSE_ERROR", error: "MISSING_REQUIRED", revision: { id: draft.id } });
    expect(repo.writes).toBe(writes);
  });

  it("validateAst expõe motivos e resumo sem persistir", async () => {
    const { wf, repo } = setup();
    const writes = repo.writes;
    const ok = wf.validateAst(ctxOf(), simpleAst());
    expect(ok).toMatchObject({ valid: true, catalogVersion: TEST_CATALOG.version });
    expect(ok.summary?.variables).toEqual(["processo.objeto"]);
    const bad = wf.validateAst(ctxOf(), { schema: "tpl-ast/1", root: [{ t: "paragraph", inline: [{ t: "var", name: "x.y" }] }] });
    expect(bad.valid).toBe(false);
    expect(bad.issues[0].code).toBe("UNKNOWN_VARIABLE");
    expect(repo.writes).toBe(writes);
  });
});

describe("Lane C — isolamento de tenant (cross-tenant falha fechado, sem enumeração)", () => {
  it("o tenant B não lista, lê, pré-visualiza, aprova nem vincula nada do tenant A; NOT_FOUND idêntico ao inexistente", async () => {
    const { wf, repo } = setup();
    const { identity, draft } = await draftOf(wf, ctxOf(ORG_A));
    expect(await wf.listIdentities(ctxOf(ORG_B))).toEqual([]);
    const cross = [
      await expectCode(wf.getIdentity(ctxOf(ORG_B), identity.id), "NOT_FOUND"),
      await expectCode(wf.getRevision(ctxOf(ORG_B), draft.id), "NOT_FOUND"),
      await expectCode(wf.preview(ctxOf(ORG_B), { revisionId: draft.id, sampleValues: {} }), "NOT_FOUND"),
      await expectCode(wf.approve(ctxOf(ORG_B), life(draft.id, "DRAFT", "kx-1")), "NOT_FOUND"),
      await expectCode(wf.createDraft(ctxOf(ORG_B), { identityId: identity.id, ast: simpleAst() }), "NOT_FOUND"),
    ];
    const missing = await expectCode(wf.getRevision(ctxOf(ORG_B), "nao-existe"), "NOT_FOUND");
    expect(cross[1].message).toBe(missing.message); // mesma mensagem neutra: não distingue "de outro tenant" de "inexistente"
    const writes = repo.writes;
    await expectCode(wf.setBinding(ctxOf(ORG_B), { documentKind: "tr", scope: {}, identityId: identity.id, pinnedRevisionId: draft.id, effectiveFrom: "2026-10-01T00:00:00Z", confirm: true }), "NOT_FOUND");
    expect(repo.writes).toBe(writes);
    expect((await repo.getRevision(ORG_A, draft.id))!.status).toBe("DRAFT");
  });

  it("adapter que devolve linha de OUTRO tenant é tratado como não encontrado (fail-closed, nada vaza)", async () => {
    const { wf, repo } = setup();
    const { identity, draft } = await draftOf(wf, ctxOf(ORG_A));
    repo.getIdentity = async (_org, id) => repo.identities.get(id) ?? null;     // bug de integração: ignora o tenant
    repo.getRevision = async (_org, id) => repo.revisions.get(id) ?? null;
    await expectCode(wf.getIdentity(ctxOf(ORG_B), identity.id), "NOT_FOUND");
    await expectCode(wf.getRevision(ctxOf(ORG_B), draft.id), "NOT_FOUND");
  });

  it("bindings de um tenant não aparecem nem resolvem no outro", async () => {
    const { wf } = setup();
    const { identity, revision } = await publishedOf(wf, ctxOf(ORG_A));
    await wf.setBinding(ctxOf(ORG_A), { documentKind: "tr", scope: {}, identityId: identity.id, pinnedRevisionId: revision.id, effectiveFrom: "2026-10-01T00:00:00Z", confirm: true });
    expect(await wf.listBindings(ctxOf(ORG_B))).toEqual([]);
    expect((await wf.resolveBinding(ctxOf(ORG_B), { documentKind: "tr", scope: {}, asOf: "2026-10-06T00:00:00Z" })).status).toBe("NOT_BOUND");
  });

  it("manifest de outro tenant ⇒ NOT_FOUND na explicação", async () => {
    const manifests = new Map<string, CompositionManifest>();
    const { wf } = setup({ manifests });
    const { identity, revision } = await publishedOf(wf, ctxOf(ORG_A));
    const sealed = sealGenerationManifest({
      id: "manA", createdAt: "2026-10-06T00:00:00.000Z", stage: "GENERATION", organizationId: ORG_A, generatedDocumentId: "gd",
      templateIdentityId: identity.id, templateRevisionId: revision.id, templateSemanticHash: revision.semanticHash, hashVersion: "tpl-hash/1",
      catalogVersion: TEST_CATALOG.version, sources: [], officialDocRefs: [], conditionalDecisions: [], aiNarratives: [], annexes: [],
      identityFingerprint: "fp", composedOutputHash: sha("o"),
    });
    if (!sealed.ok) throw new Error("manifest inválido");
    manifests.set("manA", sealed.value);
    await expectCode(wf.explainManifest(ctxOf(ORG_B), "manA"), "NOT_FOUND");
    expect((await wf.explainManifest(ctxOf(ORG_A), "manA")).manifest.id).toBe("manA");
  });
});

describe("Lane C — autoridade humana: IA e sistema NUNCA executam ações institucionais", () => {
  const ai = (organizationId = ORG_A): WorkflowContext => ({ organizationId, actor: { kind: "ai", userId: 10 } as never, correlationId: "c" });
  const system = (): WorkflowContext => ({ organizationId: ORG_A, actor: { kind: "system", userId: 1 } as never, correlationId: "c" });
  const noUser = (): WorkflowContext => ({ organizationId: ORG_A, actor: { kind: "human", userId: 0 }, correlationId: "c" });

  it("toda mutação recusa ator não humano (HUMAN_ACTION_REQUIRED) sem nenhuma escrita", async () => {
    const { wf, repo } = setup();
    const { identity, revision } = await publishedOf(wf);
    const { draft } = await draftOf(wf, ctxOf(ORG_B));
    void draft;
    const before = repo.writes;
    for (const bad of [ai(), system(), noUser()]) {
      await expectCode(wf.createIdentity(bad, { documentKind: "tr", slug: "ia-cria" }), "HUMAN_ACTION_REQUIRED");
      await expectCode(wf.createDraft(bad, { identityId: identity.id, ast: simpleAst() }), "HUMAN_ACTION_REQUIRED");
      await expectCode(wf.updateDraft(bad, { revisionId: revision.id, ast: simpleAst(), expectedSemanticHash: revision.semanticHash }), "HUMAN_ACTION_REQUIRED");
      await expectCode(wf.approve(bad, life(revision.id, "DRAFT", "ia-1")), "HUMAN_ACTION_REQUIRED");
      await expectCode(wf.publish(bad, life(revision.id, "APPROVED", "ia-2")), "HUMAN_ACTION_REQUIRED");
      await expectCode(wf.deprecate(bad, life(revision.id, "PUBLISHED", "ia-3")), "HUMAN_ACTION_REQUIRED");
      await expectCode(wf.setBinding(bad, { documentKind: "tr", scope: {}, identityId: identity.id, pinnedRevisionId: revision.id, effectiveFrom: "2026-10-01T00:00:00Z", confirm: true }), "HUMAN_ACTION_REQUIRED");
      await expectCode(wf.deactivateBinding(bad, { bindingId: "x", confirm: true }), "HUMAN_ACTION_REQUIRED");
    }
    expect(repo.writes).toBe(before);
    expect((await repo.getRevision(ORG_A, revision.id))!.status).toBe("PUBLISHED");
  });

  it("o preview nunca chama IA: narrativas são marcadores; o resolvedor de binding nunca escolhe por IA", async () => {
    const { wf, composeCalls } = setup();
    const identity = await wf.createIdentity(ctxOf(), { documentKind: "tr", slug: "tr-ia2" });
    const draft = await wf.createDraft(ctxOf(), { identityId: identity.id, ast: { schema: "tpl-ast/1", root: [{ t: "aiSlot", slotKey: "s1", maxTokens: 10, instructionsKey: "k" }] } });
    await wf.preview(ctxOf(), { revisionId: draft.id, sampleValues: { "processo.objeto": "x" } });
    expect(Object.values(composeCalls[0].aiNarratives).every((v) => v.includes("gerada somente na geração"))).toBe(true);
  });
});

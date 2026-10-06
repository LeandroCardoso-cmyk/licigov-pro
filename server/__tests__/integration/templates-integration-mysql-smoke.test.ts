/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Institutional Templates — INTEGRAÇÃO A + B + C contra MySQL REAL (CI). Ports REAIS (nenhum fake): repositório/manifests da
 * Lane A, composer/revalidação da Lane B, workflow/API da Lane C, Document Engine, promoção oficial e ledger institucional.
 * Só roda com DATABASE_URL. Organizações sintéticas (sem dados reais, sem processo real, sem documento real).
 *
 *  I1  CICLO COMPLETO: identidade → DRAFT → APPROVED → PUBLISHED → binding exato → composição → M1 → edição humana →
 *      aceite humano da IA → revalidação canônica → M2 → emissão oficial (um tenant, uma linhagem, sem duplicidade)
 *  I2  CROSS-TENANT: o tenant B não usa identidade/revisão/binding/manifest/documento oficial do A (fail-closed, sem oráculo)
 *  I3  REPLAY: mesma idempotência ⇒ nenhuma decisão, transição, M1, M2 ou emissão duplicados
 *  I4  CONCORRÊNCIA: transição de revisão, binding, M1 e emissão ⇒ estado final determinístico
 *  I5  SOURCE_CHANGED: fonte canônica alterada após o M1 ⇒ emissão BLOQUEADA, zero mutação oficial
 *  I6  IA: sem aceite humano exato a emissão é bloqueada; com aceite exato, liberada; a IA nunca age
 *  I7  FEATURE OFF: nenhuma mutação do workflow, nenhuma geração, nenhuma emissão templated
 *  I8  SCHEMA: o guard de FKs e o validador de boot continuam limpos depois de todo o uso (migrations: ver 0316-migration smoke)
 *  I9  ROLLBACK DO CICLO DE VIDA: falha depois da decisão ⇒ decisão, transição e evento revertidos juntos; replay converge
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const tenant = vi.hoisted(() => ({ org: 1, role: "owner" as string }));
vi.mock("../../services/tenantService", () => ({
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: tenant.org,
    membership: { id: 1, organizationId: tenant.org, userId: 1, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));

import { runMigrations, validateSchema, collectSchemaProblems } from "../../bootstrap";
import { checkForeignKeyContract } from "../../db/schemaForeignKeyGuard";
import { invalidateFlagCache } from "../../services/featureFlagService";
import { draftContentHash } from "../../domain/generatedDocument";
import { promoteOfficialDocument } from "../../services/documentPromotionService";
import { saveReviewableDraft } from "../../services/procurementProcessService";
import { institutionalTemplatesRouter } from "../../routers/institutionalTemplatesRouter";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { generateTemplatedDocument, type GenerateTemplatedDocumentParams } from "../../services/institutionalTemplates/templateCompositionService";
import { TemplateReviewService } from "../../services/institutionalTemplates/reviewService";
import { TEMPLATE_CATALOG_V1 } from "../../services/institutionalTemplates/catalogRegistry";
import {
  createTemplateCompositionPorts, createTemplateWorkflowPorts, templateIssuanceHook,
} from "../../services/institutionalTemplates/integration";
import {
  configureTemplateCompositionPorts, configureTemplateWorkflowPorts, FF_INSTITUTIONAL_TEMPLATES_V1, getTemplateCompositionPorts, getTemplateWorkflowPorts,
} from "../../services/institutionalTemplates/portsRegistry";
import { persistIssuanceManifest, withTemplatesTransaction } from "../../db/institutionalTemplates";
import type { WorkflowContext } from "../../services/institutionalTemplates/ports";
import { makeContext, mockUser } from "../helpers/fixtures";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
const BASE_ORG = 972_000_000 + STAMP * 10;
let orgSeq = 0;
let idSeq = 0;
const RUN = STAMP.toString(36);

const U_AUTHOR = 101;   // gera o rascunho (autor)
const U_EDITOR = 202;   // edita (último ator substantivo)
const U_MANAGER = 303;  // aprova/publica/aceita/emite (≠ autor ≠ editor: SoD da emissão)
const FLAG = FF_INSTITUTIONAL_TEMPLATES_V1;

let conn: mysql.Connection;
const exec = (sql: string, args: unknown[] = []) => conn.execute(sql, args as never);
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const nid = (p: string) => `${p}${RUN}${(idSeq++).toString(36)}`.slice(0, 20);

const ORGS: number[] = [];
async function cleanup(): Promise<void> {
  if (ORGS.length === 0) return;
  const q = ORGS.join(",");
  const stmts = [
    `DELETE FROM document_composition_references WHERE organization_id IN (${q})`,
    `DELETE FROM document_composition_manifests WHERE organization_id IN (${q}) AND derived_from_manifest_id IS NOT NULL`,
    `DELETE FROM document_composition_manifests WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_events WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_bindings WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_revisions WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_identities WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_decisions WHERE organization_id IN (${q})`,
    `DELETE FROM generated_document_edits WHERE organization_id IN (${q})`,
    `DELETE FROM generated_documents WHERE organization_id IN (${q})`,
    `DELETE FROM ai_orchestrations WHERE organization_id IN (${q})`,
    `DELETE FROM tenant_feature_flags WHERE organizationId IN (${q})`,
    `DELETE FROM procurement_processes WHERE organization_id IN (${q})`,
  ];
  for (const sql of stmts) await conn.query(sql).catch(() => { /* tabela/coluna ausente em esquemas antigos: limpeza best-effort */ });
}

// ── fixtures ─────────────────────────────────────────────────────────────────────────────────────────────────────
const AST_AI = {
  schema: "tpl-ast/1" as const,
  root: [
    { t: "heading" as const, level: 1 as const, text: [{ t: "text" as const, v: "Termo de Referência nº " }, { t: "var" as const, name: "processo.numero" }] },
    { t: "paragraph" as const, inline: [{ t: "text" as const, v: "Órgão: " }, { t: "var" as const, name: "orgao.nome" }] },
    { t: "paragraph" as const, inline: [{ t: "text" as const, v: "Objeto: " }, { t: "var" as const, name: "processo.objeto" }] },
    { t: "aiSlot" as const, slotKey: "justificativa", maxTokens: 120, instructionsKey: "tr.justificativa" },
  ],
};
const AST_PLAIN = { schema: "tpl-ast/1" as const, root: AST_AI.root.slice(0, 3) };

const decision = (over: Record<string, unknown> = {}) => ({
  decidedByName: "Maria Souza", decidedByRole: "Procuradora-Geral", decidedAt: "2026-10-06",
  basisReference: "Portaria 12/2026", reason: "Conferido pela assessoria jurídica.", ...over,
});
const ctxOf = (org: number, userId = U_MANAGER, kind: "human" | "ai" = "human"): WorkflowContext =>
  ({ organizationId: org, actor: { kind, userId } as any, correlationId: `corr-${org}-${userId}` });

interface World {
  org: number; processId: string; identityId: string; revisionId: string; bindingId: string; execId: string | null;
  wf: InstitutionalTemplatesWorkflow;
}

async function seedOrg(label: string, flagOn = true): Promise<{ org: number; processId: string }> {
  const org = BASE_ORG + orgSeq++;
  ORGS.push(org);
  await exec("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [org, `Prefeitura Sintética ${label}`, `tpl-int-${RUN}-${org}`]);
  const processId = `tp${RUN}${org % 100000}`.slice(0, 20);
  await exec(
    "INSERT INTO procurement_processes (id, organization_id, process_number, object, modality, current_stage, status, responsible_user, created_at, updated_at) VALUES (?, ?, ?, ?, 'pregao', 'TR', 'rascunho', ?, NOW(), NOW())",
    [processId, org, `2026/${org % 10000}`, "Aquisição sintética de material de expediente", U_AUTHOR]);
  await setFlag(org, flagOn);
  return { org, processId };
}
async function setFlag(org: number, on: boolean): Promise<void> {
  await exec("INSERT INTO tenant_feature_flags (organizationId, flagName, enabled, percentage) VALUES (?, ?, ?, 100) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), percentage = 100", [org, FLAG, on ? 1 : 0]);
  invalidateFlagCache(FLAG, org);
}

async function newWorld(label: string, opts: { ai?: boolean; flagOn?: boolean } = {}): Promise<World> {
  const { org, processId } = await seedOrg(label, opts.flagOn ?? true);
  const wf = new InstitutionalTemplatesWorkflow(getTemplateWorkflowPorts());
  const ctx = ctxOf(org);
  const identity = await wf.createIdentity(ctx, { documentKind: "tr", slug: `tr-${label}-${org}` });
  const draft = await wf.createDraft(ctx, { identityId: identity.id, ast: opts.ai ? AST_AI : AST_PLAIN });
  await wf.approve(ctx, { revisionId: draft.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: `ap-${RUN}-${org}`, decision: decision() });
  await wf.publish(ctx, { revisionId: draft.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: `pb-${RUN}-${org}`, decision: decision({ basisReference: "Portaria 13/2026" }) });
  const binding = await wf.setBinding(ctx, {
    documentKind: "tr", scope: { modality: "pregao" }, identityId: identity.id, pinnedRevisionId: draft.id, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true,
  });
  let execId: string | null = null;
  if (opts.ai) {
    execId = nid("ex");
    await exec(
      "INSERT INTO ai_orchestrations (id, organization_id, session_id, replay_key, outputs, started_at, updated_at, created_at) VALUES (?, ?, ?, ?, ?, NOW(3), NOW(3), NOW(3))",
      [execId, org, `sess-${org}`, `rk-${execId}`, JSON.stringify({ templateNarrative: { slotKey: "justificativa", text: "Justificativa sintética redigida para revisão humana." } })]);
  }
  return { org, processId, identityId: identity.id, revisionId: draft.id, bindingId: binding.id, execId, wf };
}

async function genParams(w: World, over: Partial<GenerateTemplatedDocumentParams> = {}): Promise<GenerateTemplatedDocumentParams> {
  const ports = getTemplateCompositionPorts();
  const aiNarratives = w.execId ? [...(await ports.review.loadAiOutputs(w.org, [w.execId]))] : [];
  return {
    organizationId: w.org, subjectId: w.processId, documentKind: "tr", documentType: "tr", scope: { modality: "pregao" },
    asOf: "2026-10-06T00:00:00Z", title: "Termo de Referência — sintético", actorUserId: U_AUTHOR, correlationId: `corr-gen-${w.org}`, aiNarratives, ...over,
  };
}
const generate = async (w: World, over: Partial<GenerateTemplatedDocumentParams> = {}) =>
  generateTemplatedDocument(await genParams(w, over), getTemplateCompositionPorts());

const draftOf = async (w: World) => (await rows("SELECT * FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'tr'", [w.org, w.processId]))[0];
const m1Count = (org: number) => count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'GENERATION'", [org]);
const m2Count = (org: number) => count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'ISSUANCE'", [org]);
const officialCount = (org: number, status: string) => count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND status = ?", [org, status]);
const decisionCount = (org: number, subjectId: string) => count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_id = ?", [org, subjectId]);
const eventCount = (org: number, type: string) => count("SELECT COUNT(*) n FROM institutional_template_events WHERE organization_id = ? AND event_type = ?", [org, type]);
const err = async (p: Promise<unknown>): Promise<any> => p.then(() => null, (e) => e);

async function humanEdit(w: World, append: string, key = "edit-1"): Promise<string> {
  const d = await draftOf(w);
  const content = `${d.content}\n${append}\n`;
  await saveReviewableDraft({
    organizationId: w.org, processId: w.processId, kind: "tr", content, actorUserId: U_EDITOR,
    expectedContentHash: draftContentHash(d.content), idempotencyKey: `${key}-${w.org}`, correlationId: "corr-edit",
  });
  return content;
}

async function accept(w: World, manifestId: string, narrative: { slotKey: string; executionId: string; outputHash: string }, ctx = ctxOf(w.org)) {
  return new TemplateReviewService(getTemplateWorkflowPorts().manifests!).acceptAiNarrative(ctx, {
    manifestId, ...narrative, confirm: true, idempotencyKey: `acc-${manifestId}`, decision: decision({ basisReference: "Revisão do documento composto" }),
  });
}

async function promote(w: World, content: string, key: string, actor = U_MANAGER) {
  return promoteOfficialDocument({
    organizationId: w.org, processId: w.processId, kind: "tr", actorUserId: actor, actorRole: "manager", idempotencyKey: key,
    correlationId: `corr-promo-${w.org}`, expectedContentHash: draftContentHash(content), reason: "Revisado e conferido pelo gestor.",
    templateIssuance: templateIssuanceHook(),
  });
}

describe.skipIf(!DB)("Institutional Templates — integração A+B+C (MySQL real, ports reais)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    // ports REAIS (o mesmo wiring de produção; nenhum tenant habilitado por padrão)
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
  }, 300_000);

  afterAll(async () => {
    if (conn) { await cleanup().catch(() => {}); await conn.end(); }
  }, 60_000);

  it("I1 — ciclo completo: identidade → DRAFT → APPROVED → PUBLISHED → binding exato → M1 → edição humana → aceite de IA → M2 → emissão", async () => {
    const w = await newWorld("e2e", { ai: true });
    const ports = getTemplateCompositionPorts();

    // estado pré-geração: revisão PUBLISHED com as duas decisões DISTINTAS, binding exato ativo
    const rev = await rows("SELECT * FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [w.org, w.revisionId]);
    expect(rev[0]).toMatchObject({ status: "PUBLISHED" });
    expect(rev[0].approval_decision_id).toBeTruthy();
    expect(rev[0].publish_decision_id).toBeTruthy();
    expect(rev[0].approval_decision_id).not.toBe(rev[0].publish_decision_id);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_events WHERE organization_id = ? AND revision_id = ? AND decision_id IS NOT NULL", [w.org, w.revisionId])).toBe(2);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ? AND active = 1 AND pinned_revision_id = ?", [w.org, w.revisionId])).toBe(1);

    // composição → M1 (+ rascunho + versão `gerado`, na MESMA transação)
    const gen = await generate(w);
    expect(gen.replayed).toBe(false);
    const m1 = gen.generationManifest;
    expect(m1).toMatchObject({ stage: "GENERATION", organizationId: w.org, templateRevisionId: w.revisionId, templateIdentityId: w.identityId });
    expect(m1.aiNarratives).toHaveLength(1);
    expect(m1.aiNarratives[0]).toMatchObject({ slotKey: "justificativa", executionId: w.execId, humanAccepted: false });
    expect(gen.content).toContain("Aquisição sintética de material de expediente");
    expect(gen.content).toContain("Prefeitura Sintética e2e");
    expect(await m1Count(w.org)).toBe(1);
    expect(await officialCount(w.org, "gerado")).toBe(1);
    const draft = await draftOf(w);
    expect(draft).toMatchObject({ id: gen.generatedDocumentId, status: "rascunho", author_user_id: U_AUTHOR });
    expect(draftContentHash(draft.content)).toBe(m1.composedOutputHash);
    expect((await ports.manifests.findGenerationManifestForDraft(w.org, draft.id))?.id).toBe(m1.id);

    // revisão humana: edição governada (ledger human_edit) + aceite humano EXATO da narrativa de IA
    const edited = await humanEdit(w, "Observação do revisor humano.");
    await accept(w, m1.id, { slotKey: "justificativa", executionId: w.execId!, outputHash: m1.aiNarratives[0].outputHash });

    // emissão: revalidação canônica → M2 na transação da promoção
    const res = await promote(w, edited, `promo-${RUN}-${w.org}`);
    expect(res).toMatchObject({ promoted: true, replayed: false, officialDocument: { status: "emitido", version: 2 } });
    const official = res.officialDocument;
    expect(official.contentHash).toBe(draftContentHash(edited));
    expect(await officialCount(w.org, "emitido")).toBe(1);
    expect(await m2Count(w.org)).toBe(1);
    expect(await m1Count(w.org)).toBe(1);   // M1 intacto: M2 é registro NOVO
    const m2row = (await rows("SELECT * FROM document_composition_manifests WHERE organization_id = ? AND stage = 'ISSUANCE'", [w.org]))[0];
    expect(m2row).toMatchObject({ derived_from_manifest_id: m1.id, official_document_id: official.id, document_content_hash: draftContentHash(edited), template_revision_id: w.revisionId });
    const m1row = (await rows("SELECT manifest_hash FROM document_composition_manifests WHERE organization_id = ? AND id = ?", [w.org, m1.id]))[0];
    expect(m1row.manifest_hash).toBe(m1.manifestHash);
    // uma linhagem oficial autoritativa (gerado v1 → emitido v2), um tenant, sem duplicidade
    expect(await count("SELECT COUNT(DISTINCT lineage_id) n FROM official_documents WHERE tenant_id = ? AND origin = ?", [w.org, w.processId])).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ?", [w.org])).toBe(2);
    // o M2 gravado pelos repositórios é o mesmo que a leitura reconstrói (hash recalculado)
    const m2 = await ports.manifests.getManifest(w.org, m2row.id);
    expect(m2).toMatchObject({ stage: "ISSUANCE", derivedFromManifestId: m1.id, humanEditRefs: [{ editRef: expect.stringMatching(/^edit:/), resultingContentHash: draftContentHash(edited) }] });
    if (m2?.stage === "ISSUANCE") expect(m2.canonicalRevalidation.status).toBe("PASSED");
  }, 120_000);

  it("I2 — cross-tenant: o tenant B não usa identidade, revisão, binding, manifest nem documento oficial do tenant A", async () => {
    const a = await newWorld("xa", { ai: false });
    const b = await newWorld("xb", { ai: false });
    const gen = await generate(a);
    const m1 = gen.generationManifest;
    const aDraft = await draftOf(a);
    const wfB = b.wf, ctxB = ctxOf(b.org);
    const notFound = (e: any) => expect(e?.message ?? "").toMatch(/^NOT_FOUND/);

    // workflow do B sobre ids do A: indistinguível de inexistente
    notFound(await err(wfB.getIdentity(ctxB, a.identityId)));
    notFound(await err(wfB.getRevision(ctxB, a.revisionId)));
    notFound(await err(wfB.setBinding(ctxB, { documentKind: "tr", scope: { regime: "r-x" }, identityId: a.identityId, pinnedRevisionId: a.revisionId, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true })));
    notFound(await err(wfB.setBinding(ctxB, { documentKind: "tr", scope: { regime: "r-y" }, identityId: b.identityId, pinnedRevisionId: a.revisionId, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true })));
    notFound(await err(wfB.deactivateBinding(ctxB, { bindingId: a.bindingId, confirm: true })));
    notFound(await err(wfB.approve(ctxB, { revisionId: a.revisionId, expectedStatus: "PUBLISHED", confirm: true, idempotencyKey: `x-${RUN}-1234`, decision: decision() })));
    expect((await wfB.listIdentities(ctxB)).map((i) => i.identity.id)).not.toContain(a.identityId);
    notFound(await err(wfB.explainManifest(ctxB, m1.id)));
    expect(await getTemplateWorkflowPorts().manifests!.getManifest(b.org, m1.id)).toBeNull();
    expect(await getTemplateCompositionPorts().manifests.findGenerationManifestForDraft(b.org, aDraft.id)).toBeNull();

    // revisão humana do B sobre o M1 do A
    const reviewB = new TemplateReviewService(getTemplateWorkflowPorts().manifests!);
    notFound(await err(reviewB.acknowledgeDeviation(ctxB, {
      manifestId: m1.id, blockId: "x", kind: "INCLUDED_BLOCK_REMOVED", confirm: true, idempotencyKey: `dev-${RUN}-${b.org}`, decision: decision(),
    })));

    // persistência do B com M1/M2/pin do A: a transação recusa (tenant do contexto ≠ tenant do manifest; pais por id + tenant)
    const crossTx = (run: (tx: any) => Promise<unknown>) => withTemplatesTransaction("x", { organizationId: b.org, correlationId: "x" }, run);
    expect((await err(crossTx((tx) => persistIssuanceManifest(tx, { organizationId: b.org, actorUserId: U_MANAGER, correlationId: "x" }, { ...(m1 as any), stage: "ISSUANCE" }, "doc")))).message).toMatch(/CROSS_TENANT_REFERENCE|INVALID_INPUT/);

    // geração no B não enxerga o binding do A
    const genB = await err(generateTemplatedDocument(await genParams(b, { organizationId: b.org }), getTemplateCompositionPorts()));
    expect(genB).toBeNull(); // o B tem o PRÓPRIO modelo/binding: a geração dele é independente…
    expect(await m1Count(b.org)).toBe(1);
    expect(await m1Count(a.org)).toBe(1);
    // …e sem binding próprio (org nova habilitada, sem modelo) nada é composto a partir do binding do A
    const c = await seedOrg("xc");
    const genC = await err(generateTemplatedDocument({ ...(await genParams(a)), organizationId: c.org, subjectId: c.processId, correlationId: "corr-c" }, getTemplateCompositionPorts()));
    expect(genC?.message).toMatch(/^TEMPLATE_NOT_BOUND/);
    expect(await m1Count(c.org)).toBe(0);
    // o M1 do A continua único e do A
    expect(await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE id = ? AND organization_id = ?", [m1.id, a.org])).toBe(1);
  }, 120_000);

  it("I3 — replay: mesma idempotência ⇒ nenhuma decisão, transição, M1, M2 ou emissão duplicados", async () => {
    const w = await newWorld("replay", { ai: false });
    const ctx = ctxOf(w.org);
    // ciclo de vida: replay da aprovação e da publicação (a revisão já avançou)
    const again = await w.wf.approve(ctx, { revisionId: w.revisionId, expectedStatus: "DRAFT", confirm: true, idempotencyKey: `ap-${RUN}-${w.org}`, decision: decision() });
    expect(again.replayed).toBe(true);
    const againPub = await w.wf.publish(ctx, { revisionId: w.revisionId, expectedStatus: "APPROVED", confirm: true, idempotencyKey: `pb-${RUN}-${w.org}`, decision: decision({ basisReference: "Portaria 13/2026" }) });
    expect(againPub.replayed).toBe(true);
    expect(await decisionCount(w.org, w.revisionId)).toBe(2);        // 1 aprovação + 1 publicação (subject types distintos, mesma revisão)
    expect(await eventCount(w.org, "REVISION_APPROVED")).toBe(1);
    expect(await eventCount(w.org, "REVISION_PUBLISHED")).toBe(1);
    // mesma chave com pedido DIFERENTE ⇒ recusa (conflito de idempotência), sem escrita
    const conflict = await err(w.wf.approve(ctx, { revisionId: w.revisionId, expectedStatus: "DRAFT", confirm: true, idempotencyKey: `ap-${RUN}-${w.org}`, decision: decision({ reason: "Outra justificativa totalmente diferente." }) }));
    expect(conflict?.message).toMatch(/DECISION_REJECTED|STALE_STATE/);
    expect(await decisionCount(w.org, w.revisionId)).toBe(2);

    // geração: mesma composição ⇒ mesmo M1, nenhum segundo rascunho nem versão `gerado`
    const g1 = await generate(w);
    const g2 = await generate(w);
    expect(g1.replayed).toBe(false);
    expect(g2.replayed).toBe(true);
    expect(g2.generationManifest.id).toBe(g1.generationManifest.id);
    expect(await m1Count(w.org)).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM generated_documents WHERE organization_id = ?", [w.org])).toBe(1);
    expect(await officialCount(w.org, "gerado")).toBe(1);

    // emissão: mesma chave ⇒ replay sem novo M2 nem nova versão emitida
    const edited = await humanEdit(w, "Conferência humana.");
    const e1 = await promote(w, edited, `promo-${RUN}-${w.org}`);
    const e2 = await promote(w, edited, `promo-${RUN}-${w.org}`);
    expect(e1.promoted).toBe(true);
    expect(e2).toMatchObject({ promoted: false, replayed: true });
    expect(e2.officialDocument.id).toBe(e1.officialDocument.id);
    expect(await officialCount(w.org, "emitido")).toBe(1);
    expect(await m2Count(w.org)).toBe(1);
    expect(await m1Count(w.org)).toBe(1);
  }, 120_000);

  it("I4 — concorrência: transição, binding, M1 e emissão convergem para um estado final determinístico", async () => {
    // (a) duas aprovações concorrentes da MESMA revisão (CAS): exatamente uma vence
    const { org, processId } = await seedOrg("conc");
    const wf = new InstitutionalTemplatesWorkflow(getTemplateWorkflowPorts());
    const ctx = ctxOf(org);
    const identity = await wf.createIdentity(ctx, { documentKind: "tr", slug: `tr-conc-${org}` });
    const draft = await wf.createDraft(ctx, { identityId: identity.id, ast: AST_PLAIN });
    const approveWith = (key: string) => wf.approve(ctx, { revisionId: draft.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: `${key}-${RUN}-${org}`, decision: decision() });
    const results = await Promise.allSettled([approveWith("capA"), approveWith("capB"), approveWith("capC")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === "rejected")) expect(String(r.reason?.message)).toMatch(/STALE_STATE|DECISION_REJECTED/);
    expect((await rows("SELECT status FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [org, draft.id]))[0].status).toBe("APPROVED");
    expect(await decisionCount(org, draft.id)).toBe(1);
    expect(await eventCount(org, "REVISION_APPROVED")).toBe(1);

    // (b) dois bindings concorrentes para o MESMO escopo: um ativo
    await wf.publish(ctx, { revisionId: draft.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: `cpb-${RUN}-${org}`, decision: decision({ basisReference: "Portaria 14/2026" }) });
    const bind = () => wf.setBinding(ctx, { documentKind: "tr", scope: { modality: "pregao" }, identityId: identity.id, pinnedRevisionId: draft.id, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true });
    const b = await Promise.allSettled([bind(), bind(), bind()]);
    expect(b.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of b.filter((x): x is PromiseRejectedResult => x.status === "rejected")) expect(String(r.reason?.message)).toMatch(/BINDING_AMBIGUOUS/);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ? AND active = 1", [org])).toBe(1);

    // (c) gerações concorrentes idênticas: um M1, um rascunho, uma versão `gerado`
    const w: World = { org, processId, identityId: identity.id, revisionId: draft.id, bindingId: "", execId: null, wf };
    const gens = await Promise.all([generate(w), generate(w), generate(w), generate(w)]);
    expect(new Set(gens.map((g) => g.generationManifest.id)).size).toBe(1);
    expect(gens.filter((g) => !g.replayed)).toHaveLength(1);
    expect(await m1Count(org)).toBe(1);
    expect(await count("SELECT COUNT(*) n FROM generated_documents WHERE organization_id = ?", [org])).toBe(1);
    expect(await officialCount(org, "gerado")).toBe(1);

    // (d) emissões concorrentes (mesma chave e chaves distintas): uma versão emitida, um M2
    const edited = await humanEdit(w, "Conferência humana concorrente.");
    const emits = await Promise.allSettled([
      promote(w, edited, `pe-same-${RUN}-${org}`), promote(w, edited, `pe-same-${RUN}-${org}`),
      promote(w, edited, `pe-other-${RUN}-${org}`),
    ]);
    expect(emits.filter((r) => r.status === "fulfilled" && (r.value as any).promoted)).toHaveLength(1);
    expect(await officialCount(org, "emitido")).toBe(1);
    expect(await m2Count(org)).toBe(1);
    expect(await m1Count(org)).toBe(1);
  }, 180_000);

  it("I5 — SOURCE_CHANGED: fonte canônica alterada após o M1 ⇒ emissão bloqueada e zero mutação oficial", async () => {
    const w = await newWorld("src", { ai: false });
    await generate(w);
    const edited = await humanEdit(w, "Conferência humana.");
    await exec("UPDATE procurement_processes SET object = ? WHERE organization_id = ? AND id = ?", ["Objeto ALTERADO depois do M1", w.org, w.processId]);
    const before = [await officialCount(w.org, "emitido"), await m2Count(w.org), await count("SELECT COUNT(*) n FROM official_document_promotions WHERE organization_id = ?", [w.org])];
    const e = await err(promote(w, edited, `promo-src-${RUN}-${w.org}`));
    expect(e?.message).toMatch(/TEMPLATE_ISSUANCE_BLOCKED[\s\S]*SOURCE_CHANGED/);
    expect([await officialCount(w.org, "emitido"), await m2Count(w.org), await count("SELECT COUNT(*) n FROM official_document_promotions WHERE organization_id = ?", [w.org])]).toEqual(before);
    expect(before).toEqual([0, 0, 0]);
    expect(await m1Count(w.org)).toBe(1);                       // nada foi regenerado nem atualizado
    expect(draftContentHash((await draftOf(w)).content)).toBe(draftContentHash(edited));
  }, 120_000);

  it("I6 — IA: sem aceite humano exato a emissão é bloqueada; com aceite exato é liberada; a IA nunca age", async () => {
    const w = await newWorld("ai", { ai: true });
    const gen = await generate(w);
    const m1 = gen.generationManifest;
    const narrative = { slotKey: "justificativa", executionId: w.execId!, outputHash: m1.aiNarratives[0].outputHash };
    const edited = await humanEdit(w, "Conferência humana.");

    // sem aceite: bloqueio, zero emissão
    const blocked = await err(promote(w, edited, `promo-ai-1-${RUN}-${w.org}`));
    expect(blocked?.message).toMatch(/TEMPLATE_ISSUANCE_BLOCKED[\s\S]*AI_NARRATIVE_NOT_ACCEPTED/);
    expect(await officialCount(w.org, "emitido")).toBe(0);
    expect(await m2Count(w.org)).toBe(0);

    // a IA / o sistema não aceitam; aceite sem confirmação ou com hash/execução divergentes é recusado sem escrita
    expect((await err(accept(w, m1.id, narrative, ctxOf(w.org, 0, "ai"))))?.message).toMatch(/HUMAN_ACTION_REQUIRED/);
    expect((await err(accept(w, m1.id, { ...narrative, outputHash: "f".repeat(64) })))?.message).toMatch(/VALIDATION_FAILED/);
    expect((await err(accept(w, m1.id, { ...narrative, executionId: "outra-execucao" })))?.message).toMatch(/VALIDATION_FAILED/);
    expect((await err(new TemplateReviewService(getTemplateWorkflowPorts().manifests!).acceptAiNarrative(ctxOf(w.org), {
      manifestId: m1.id, ...narrative, confirm: false, idempotencyKey: `acc-noconf-${RUN}-${w.org}`, decision: decision(),
    })))?.message).toMatch(/CONFIRMATION_REQUIRED/);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'institutional_template.ai_acceptance'", [w.org])).toBe(0);
    expect((await err(promote(w, edited, `promo-ai-2-${RUN}-${w.org}`)))?.message).toMatch(/AI_NARRATIVE_NOT_ACCEPTED/);

    // aceite exato (slot + execução + hash) por pessoa ⇒ liberado
    const acc = await accept(w, m1.id, narrative);
    expect(acc.replayed).toBe(false);
    expect((await accept(w, m1.id, narrative)).replayed).toBe(true);   // o mesmo ato converge, sem segunda linha
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'institutional_template.ai_acceptance'", [w.org])).toBe(1);
    const res = await promote(w, edited, `promo-ai-3-${RUN}-${w.org}`);
    expect(res.promoted).toBe(true);
    expect(await m2Count(w.org)).toBe(1);
    const m2 = (await getTemplateCompositionPorts().manifests.getManifest(w.org, (await rows("SELECT id FROM document_composition_manifests WHERE organization_id = ? AND stage = 'ISSUANCE'", [w.org]))[0].id));
    if (m2?.stage === "ISSUANCE") expect(m2.aiNarratives[0]).toMatchObject({ slotKey: "justificativa", humanAccepted: true });
  }, 120_000);

  it("I7 — feature OFF: nenhuma mutação do workflow, nenhuma geração, nenhuma emissão templated (backend bloqueia, não só o menu)", async () => {
    const off = await seedOrg("off", false);
    tenant.org = off.org; tenant.role = "owner";
    const caller = institutionalTemplatesRouter.createCaller(makeContext(mockUser) as any);
    const code = async (p: Promise<unknown>) => { const e = await err(p); return e ? `${e.code}:${String(e.message).slice(0, 60)}` : "OK"; };

    expect((await caller.getCapabilities()).enabled).toBe(false);
    expect(await code(caller.identities.create({ documentKind: "tr", slug: "tr-off" }))).toMatch(/^PRECONDITION_FAILED:.*MODULE_DISABLED|PRECONDITION_FAILED/);
    expect(await code(caller.compose.generate({ processId: off.processId, documentKind: "tr", documentType: "tr", scope: {}, asOf: "2026-10-06T00:00:00Z", title: "x" }))).toMatch(/^PRECONDITION_FAILED/);
    expect(await code(caller.reviews.acceptAiNarrative({
      manifestId: "x", slotKey: "justificativa", executionId: "e", outputHash: "a".repeat(64), confirm: true, idempotencyKey: "idem-key-off", decision: decision(),
    }))).toMatch(/^PRECONDITION_FAILED/);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_identities WHERE organization_id = ?", [off.org])).toBe(0);
    expect(await m1Count(off.org)).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM generated_documents WHERE organization_id = ?", [off.org])).toBe(0);

    // serviço de composição: desabilitado ⇒ recusa antes de qualquer leitura/escrita
    const dis = await err(generateTemplatedDocument({
      organizationId: off.org, subjectId: off.processId, documentKind: "tr", documentType: "tr", scope: {}, asOf: "2026-10-06T00:00:00Z",
      title: "x", actorUserId: U_AUTHOR, correlationId: "corr-off",
    }, getTemplateCompositionPorts()));
    expect(dis?.message).toMatch(/^TEMPLATE_COMPOSITION_DISABLED/);
    expect(await count("SELECT COUNT(*) n FROM generated_documents WHERE organization_id = ?", [off.org])).toBe(0);

    // com a flag LIGADA a mesma rota funciona pelo router (wiring real) — e desligar a flag depois bloqueia a EMISSÃO templated
    const w = await newWorld("flip", { ai: false });
    tenant.org = w.org;
    const created = await caller.identities.create({ documentKind: "tr", slug: "tr-router-ok" });
    expect(created.organizationId).toBe(w.org);
    await generate(w);
    const edited = await humanEdit(w, "Conferência humana.");
    await setFlag(w.org, false);
    const emit = await err(promote(w, edited, `promo-off-${RUN}-${w.org}`));
    expect(emit?.message).toMatch(/TEMPLATE_COMPOSITION_DISABLED/);
    expect(await officialCount(w.org, "emitido")).toBe(0);
    expect(await m2Count(w.org)).toBe(0);
    // rascunho SEM modelo (sem M1) segue o caminho existente com a flag desligada: o hook devolve `null` (nenhum M2, nenhuma
    // regressão da emissão comum) — só um rascunho COMPOSTO por modelo é bloqueado quando o módulo está desabilitado
    const plain = await templateIssuanceHook()!.prepare({
      organizationId: w.org, processId: w.processId, draftId: "rascunho-sem-modelo", content: "x", contentHash: draftContentHash("x"), actorUserId: U_MANAGER, correlationId: "corr-plain",
    });
    expect(plain).toBeNull();
    await setFlag(w.org, true);
  }, 120_000);

  it("I9 — rollback do ciclo de vida: falha depois da decisão ⇒ decisão, transição e evento revertidos juntos; replay converge", async () => {
    const { org } = await seedOrg("rb");
    const wf = new InstitutionalTemplatesWorkflow(getTemplateWorkflowPorts());
    const ctx = ctxOf(org);
    const identity = await wf.createIdentity(ctx, { documentKind: "tr", slug: `tr-rb-${org}` });
    const draft = await wf.createDraft(ctx, { identityId: identity.id, ast: AST_PLAIN });
    const trigger = `trg_tpl_fail_${org}`;
    await conn.query(`DROP TRIGGER IF EXISTS ${trigger}`);
    await conn.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON institutional_template_revisions FOR EACH ROW
      BEGIN IF NEW.id = '${draft.id}' AND NEW.status = 'APPROVED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha injetada após a decisão'; END IF; END`);
    try {
      const input = { revisionId: draft.id, expectedStatus: "DRAFT" as const, confirm: true, idempotencyKey: `rb-${RUN}-${org}`, decision: decision() };
      const failure = await err(wf.approve(ctx, input));
      expect(String(failure?.cause?.message ?? failure?.message ?? failure)).toMatch(/falha injetada/);
      // ROLLBACK TOTAL: nenhuma decisão, revisão inalterada, nenhum evento de aprovação
      expect(await decisionCount(org, draft.id)).toBe(0);
      expect((await rows("SELECT status, approval_decision_id FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [org, draft.id]))[0]).toMatchObject({ status: "DRAFT", approval_decision_id: null });
      expect(await eventCount(org, "REVISION_APPROVED")).toBe(0);
      await conn.query(`DROP TRIGGER IF EXISTS ${trigger}`);
      // sem a falha, o MESMO pedido converge para um estado consistente (decisão + transição + evento)
      const ok = await wf.approve(ctx, input);
      expect(ok.replayed).toBe(false);
      expect(await decisionCount(org, draft.id)).toBe(1);
      expect((await rows("SELECT status, approval_decision_id FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [org, draft.id]))[0]).toMatchObject({ status: "APPROVED", approval_decision_id: ok.decision.id });
      expect(await eventCount(org, "REVISION_APPROVED")).toBe(1);
      expect((await wf.approve(ctx, input)).replayed).toBe(true);
      expect(await decisionCount(org, draft.id)).toBe(1);
    } finally {
      await conn.query(`DROP TRIGGER IF EXISTS ${trigger}`).catch(() => {});
    }
  }, 120_000);

  it("I10 — rollback da emissão: falha ao gravar o M2 ⇒ nenhuma versão emitida, nenhum ledger, nenhum M2; a mesma chave é reutilizável", async () => {
    const w = await newWorld("rbm2", { ai: false });
    await generate(w);
    const edited = await humanEdit(w, "Conferência humana.");
    const trigger = `trg_tpl_m2_${w.org}`;
    await conn.query(`DROP TRIGGER IF EXISTS ${trigger}`);
    await conn.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON document_composition_manifests FOR EACH ROW
      BEGIN IF NEW.organization_id = ${w.org} AND NEW.stage = 'ISSUANCE' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'falha injetada no M2'; END IF; END`);
    try {
      const key = `promo-rb-${RUN}-${w.org}`;
      const failure = await err(promote(w, edited, key));
      expect(String(failure?.cause?.message ?? failure?.message ?? failure)).toMatch(/falha injetada no M2/);
      expect(await officialCount(w.org, "emitido")).toBe(0);
      expect(await m2Count(w.org)).toBe(0);
      expect(await count("SELECT COUNT(*) n FROM official_document_promotions WHERE organization_id = ?", [w.org])).toBe(0);
      expect(await m1Count(w.org)).toBe(1);
      await conn.query(`DROP TRIGGER IF EXISTS ${trigger}`);
      const ok = await promote(w, edited, key);
      expect(ok.promoted).toBe(true);
      expect(await officialCount(w.org, "emitido")).toBe(1);
      expect(await m2Count(w.org)).toBe(1);
    } finally {
      await conn.query(`DROP TRIGGER IF EXISTS ${trigger}`).catch(() => {});
    }
  }, 120_000);

  it("I8 — schema: o guard de FKs e o validador de boot seguem limpos depois de todo o uso; catálogo embutido válido", async () => {
    expect(await checkForeignKeyContract(conn)).toEqual([]);
    expect(await collectSchemaProblems(conn)).toEqual([]);
    expect(TEMPLATE_CATALOG_V1.version).toBe("tpl-catalog/1");
    // nenhuma tabela existente ganhou FK por causa dos Templates (HD-26: sem DDL em pais existentes)
    const fks = await rows(`SELECT TABLE_NAME t FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND REFERENCED_TABLE_NAME IN ('official_documents','generated_documents','institutional_decisions','official_document_artifacts')
      AND TABLE_NAME IN ('institutional_template_identities','institutional_template_revisions','institutional_template_bindings','institutional_template_events','document_composition_manifests','document_composition_references')`);
    expect(fks).toEqual([]);
  }, 60_000);
});

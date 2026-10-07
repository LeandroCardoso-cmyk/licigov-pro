/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Piloto Edital — Lane C contra MySQL REAL (CI com DATABASE_URL). Ports REAIS (adapters sobre a persistência da Lane A e o ledger
 * institucional EXISTENTE). Organizações sintéticas; nenhum processo real, nenhum documento real, nenhuma IA.
 *
 *  P1  PROCEDÊNCIA + EVIDÊNCIA no ledger real: round-trip, versões append-only, supersede, replay, CAS, conflito, histórico
 *  P2  CONCORRÊNCIA: duas evidências com a MESMA versão esperada ⇒ exatamente uma grava; a outra é STALE_STATE
 *  P3  A evidência NÃO é status: revisão segue DRAFT, sem decisão de aprovação, sem evento de transição
 *  P4  CROSS-TENANT: o tenant B não lê nem grava governança de revisão do A (NOT_FOUND neutro; nada escrito)
 *  P5  BINDING: as 5 dimensões do escopo exato (migration 0317) persistem; mesmo escopo exato sem substituição ⇒ BINDING_AMBIGUOUS
 *  P6  CATÁLOGO multi-modelo sobre o banco real (nome via procedência; escopo declarado; filtros)
 *  P7  FEATURE OFF: o backend bloqueia a rota direta; nenhuma linha é escrita
 *  P8  SCHEMA: o guard de FKs e o validador de boot seguem limpos (nenhuma tabela nova; colunas aditivas da 0317)
 *  P9  GATE DE PRONTIDÃO NA PUBLICAÇÃO (banco real): BLOCKED ⇒ PUBLICATION_BLOCKED com zero decisão/status/evento; cliente não força PASS;
 *      PASS publica e grava readiness.*; replay; concorrência; cross-tenant; readiness indisponível ⇒ falha fechada
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
import { institutionalTemplatesRouter } from "../../routers/institutionalTemplatesRouter";
import { TemplateCatalogService } from "../../services/institutionalTemplates/catalogService";
import { TemplateGovernanceService } from "../../services/institutionalTemplates/governanceService";
import { ModelRegistrationService } from "../../services/institutionalTemplates/modelRegistrationService";
import { createTemplateWorkflowPorts } from "../../services/institutionalTemplates/integration";
import { inventoryCounts, inventoryHash, type SourceInventory } from "../../domain/institutionalTemplates/governance/sourceInventory";
import { FF_INSTITUTIONAL_TEMPLATES_V1 } from "../../services/institutionalTemplates/portsRegistry";
import type { WorkflowContext } from "../../services/institutionalTemplates/ports";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { makeContext, mockUser } from "../helpers/fixtures";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
const BASE_ORG = 973_000_000 + STAMP * 10;
const RUN = STAMP.toString(36);
let orgSeq = 0;
let keySeq = 0;
const key = (p: string) => `${p}-${RUN}-${++keySeq}-pilot`;

let conn: mysql.Connection;
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const ORGS: number[] = [];
const err = async (p: Promise<unknown>): Promise<any> => p.then(() => null, (e) => e);

async function cleanup(): Promise<void> {
  if (ORGS.length === 0) return;
  const q = ORGS.join(",");
  for (const sql of [
    `DELETE FROM institutional_template_events WHERE organization_id IN (${q})`, `DELETE FROM institutional_template_bindings WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_revisions WHERE organization_id IN (${q})`, `DELETE FROM institutional_template_identities WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_decisions WHERE organization_id IN (${q})`, `DELETE FROM tenant_feature_flags WHERE organizationId IN (${q})`,
  ]) await conn.query(sql).catch(() => { /* best-effort */ });
}
async function seedOrg(label: string, flagOn = true): Promise<number> {
  const org = BASE_ORG + orgSeq++;
  ORGS.push(org);
  await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [org, `Prefeitura Sintética ${label}`, `pilot-${RUN}-${org}`] as never);
  await conn.execute("INSERT INTO tenant_feature_flags (organizationId, flagName, enabled, percentage) VALUES (?, ?, ?, 100) ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), percentage = 100", [org, FF_INSTITUTIONAL_TEMPLATES_V1, flagOn ? 1 : 0] as never);
  invalidateFlagCache(FF_INSTITUTIONAL_TEMPLATES_V1, org);
  return org;
}
const ctxOf = (org: number, userId = 303): WorkflowContext => ({ organizationId: org, actor: { kind: "human", userId }, correlationId: `corr-${org}-${userId}` });
const decision = (over: Record<string, unknown> = {}) => ({
  decidedByName: "Procuradoria Jurídica", decidedByRole: "Órgão de assessoramento", decidedAt: "2026-10-06", basisReference: "Documento informado pelo gestor", reason: "Registro de aprovação externa informada.", ...over,
});
const SHA = "a".repeat(64);
// AST válido no catálogo REAL `tpl-catalog/1` (a persistência do piloto é testada aqui; o inventário completo é do harness em memória)
const AST = {
  schema: "tpl-ast/1" as const,
  root: [
    { t: "heading" as const, level: 1 as const, text: [{ t: "text" as const, v: "Edital sintético nº " }, { t: "var" as const, name: "processo.numero" }] },
    { t: "paragraph" as const, inline: [{ t: "text" as const, v: "Modalidade: " }, { t: "var" as const, name: "edital.modalidade" }] },
  ],
};
// Inventário mínimo coerente com o AST acima e o catálogo REAL (2 entradas, 0 control-only, 0 condições): a matriz resulta PASS/NOT_APPLICABLE
const SMALL_INV: SourceInventory = {
  schema: "tpl-source-inventory/1", sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, declared: { inputsTotal: 2, controlOnlyInputs: 0, conditionTypes: 0 },
  inputs: [{ key: "I1", disposition: "VARIABLE", variable: "processo.numero" }, { key: "I2", disposition: "VARIABLE", variable: "edital.modalidade" }],
  conditionTypes: [], annexes: [], crossReferences: [], aiSlots: [],
};
const FULL = { modality: "pregao", form: "eletronica", platform: "bll", regime: "empreitada-preco-unitario", criterion: "menor-preco" };

async function register(org: number, slug: string, over: Record<string, unknown> = {}) {
  const ports = createTemplateWorkflowPorts();
  return new ModelRegistrationService(ports).register(ctxOf(org), {
    target: { kind: "NEW_IDENTITY", documentKind: "edital", slug }, templateKey: slug.toUpperCase().replace(/-/g, "_"), displayName: `Edital — ${slug}`, declaredScope: { ...FULL },
    source: { kind: "AST", ast: AST }, sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, inventory: SMALL_INV, confirm: true, idempotencyKey: key("reg"), decision: decision(), ...over,
  } as never);
}
async function recordEvidence(org: number, revisionId: string): Promise<void> {
  await new TemplateGovernanceService(createTemplateWorkflowPorts()).recordLegalEvidence(ctxOf(org), { revisionId, expectedVersion: 0, confirm: true, idempotencyKey: key("sev"), decision: decision(), evidence: { sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA } });
}
const evidence = (revisionId: string, over: Record<string, unknown> = {}, org?: number) => ({
  revisionId, expectedVersion: 0, confirm: true, idempotencyKey: key("ev"), decision: decision(),
  evidence: { sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA }, ...over, __org: org,
});

describe.skipIf(!DB)("Piloto Edital — Lane C (MySQL real, adapters reais)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
  }, 300_000);
  afterAll(async () => { if (conn) { await cleanup().catch(() => {}); await conn.end(); } }, 60_000);

  it("P1 — registro nasce DRAFT; procedência e evidência jurídica gravadas no ledger REAL, append-only, com replay/CAS/histórico", async () => {
    const org = await seedOrg("p1");
    const r = await register(org, "edital-pregao-eletronico-bll");
    expect(r.revision.status).toBe("DRAFT");
    expect(r.provenance.status).toBe("RECORDED");
    const stored = await rows("SELECT subject_type, decision_type, outcome, subject_id, revision, authority_validation, recorded_by_user_id FROM institutional_decisions WHERE organization_id = ?", [org]);
    expect(stored).toEqual([{ subject_type: "institutional_template.import_provenance", decision_type: "template_import_provenance", outcome: "registrado", subject_id: r.revision.id, revision: 1, authority_validation: "NOT_VALIDATED_POLICY_PENDING", recorded_by_user_id: 303 }]);

    const gov = new TemplateGovernanceService(createTemplateWorkflowPorts());
    const { __org: _o, ...e1 } = evidence(r.revision.id, { idempotencyKey: "pilot-ev-fixed-1" });
    const v1 = await gov.recordLegalEvidence(ctxOf(org), e1 as never);
    expect(v1.evidence).toMatchObject({ version: 1, sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, parecerNumber: null, parecerDate: null, protocol: null, procurador: null, recordedByUserId: 303 });
    // replay: mesma chave + mesmo pedido ⇒ nenhuma segunda linha
    const replay = await gov.recordLegalEvidence(ctxOf(org), e1 as never);
    expect(replay.replayed).toBe(true);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'institutional_template.legal_evidence'", [org])).toBe(1);
    // mesma chave + pedido diferente ⇒ conflito sem escrita
    const conflict = await err(gov.recordLegalEvidence(ctxOf(org), { ...e1, evidence: { sourceLogicalVersion: "9.9", sourceSha256: SHA } } as never));
    expect(conflict?.message).toMatch(/DECISION_REJECTED/);
    // CAS: versão desatualizada ⇒ STALE_STATE; versão correta supera a anterior (append-only)
    const stale = await err(gov.recordLegalEvidence(ctxOf(org), { ...evidence(r.revision.id, { expectedVersion: 0 }) } as never));
    expect(stale?.message).toMatch(/STALE_STATE/);
    const { __org: _p, ...e2 } = evidence(r.revision.id, { expectedVersion: 1, evidence: { sourceLogicalVersion: "1.0.1-draft", sourceSha256: SHA, parecerNumber: "55/2026", evidenceRefs: ["proc 12"] } });
    const v2 = await gov.recordLegalEvidence(ctxOf(org), e2 as never);
    expect(v2.evidence).toMatchObject({ version: 2, parecerNumber: "55/2026", protocol: null, evidenceRefs: ["proc 12"], supersedesDecisionId: v1.evidence.decisionId });
    const view = await gov.get(ctxOf(org), r.revision.id);
    expect(view.legalEvidenceHistory.map((e) => e.version)).toEqual([1, 2]);
    expect(view.provenance?.displayName).toBe("Edital — edital-pregao-eletronico-bll");
    expect(view.malformedRecords).toBe(0);
  });

  it("P2 — concorrência: duas evidências com a MESMA versão esperada ⇒ exatamente uma grava (CAS), a outra é STALE_STATE", async () => {
    const org = await seedOrg("p2");
    const r = await register(org, "edital-concorrente");
    const gov = new TemplateGovernanceService(createTemplateWorkflowPorts());
    const mk = (n: number) => { const { __org, ...e } = evidence(r.revision.id, { expectedVersion: 0, idempotencyKey: `pilot-race-${RUN}-${n}`, decision: decision({ reason: `Registro concorrente número ${n} (teste).` }) }); void __org; return e; };
    const results = await Promise.all([1, 2, 3, 4].map((n) => gov.recordLegalEvidence(ctxOf(org, 300 + n), mk(n) as never).then(() => "OK", (e) => String(e.message))));
    expect(results.filter((x) => x === "OK")).toHaveLength(1);
    for (const x of results.filter((y) => y !== "OK")) expect(x).toMatch(/STALE_STATE/);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'institutional_template.legal_evidence'", [org])).toBe(1);
  });

  it("P3 — a evidência NÃO é status: revisão segue DRAFT, sem decisão de aprovação, sem evento de transição", async () => {
    const org = await seedOrg("p3");
    const r = await register(org, "edital-sem-status");
    const eventsBefore = await count("SELECT COUNT(*) n FROM institutional_template_events WHERE organization_id = ?", [org]);
    const { __org, ...e } = evidence(r.revision.id); void __org;
    await new TemplateGovernanceService(createTemplateWorkflowPorts()).recordLegalEvidence(ctxOf(org), e as never);
    const rev = (await rows("SELECT status, approval_decision_id, publish_decision_id FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [org, r.revision.id]))[0];
    expect(rev).toEqual({ status: "DRAFT", approval_decision_id: null, publish_decision_id: null });
    expect(await count("SELECT COUNT(*) n FROM institutional_template_events WHERE organization_id = ?", [org])).toBe(eventsBefore);
    // o ciclo de vida continua exigindo as DUAS decisões humanas distintas
    const wf = new InstitutionalTemplatesWorkflow(createTemplateWorkflowPorts());
    const shortcut = await err(wf.publish(ctxOf(org), { revisionId: r.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("sh"), decision: decision() }));
    expect(shortcut?.message).toMatch(/TRANSITION_INVALID/);
    expect((await wf.approve(ctxOf(org), { revisionId: r.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("ap"), decision: decision() })).revision.status).toBe("APPROVED");
  });

  it("P4 — cross-tenant: o tenant B não lê nem grava governança de revisão do A (NOT_FOUND neutro; nada escrito)", async () => {
    const a = await seedOrg("p4a"); const b = await seedOrg("p4b");
    const r = await register(a, "edital-isolado");
    const gov = new TemplateGovernanceService(createTemplateWorkflowPorts());
    const before = await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id IN (?, ?)", [a, b]);
    const read = await err(gov.get(ctxOf(b), r.revision.id));
    const ghost = await err(gov.get(ctxOf(b), "tr_inexistente"));
    expect(read?.message).toBe(ghost?.message);
    const { __org, ...e } = evidence(r.revision.id); void __org;
    expect((await err(gov.recordLegalEvidence(ctxOf(b), e as never)))?.message).toMatch(/NOT_FOUND/);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id IN (?, ?)", [a, b])).toBe(before);
    expect(await new TemplateCatalogService(createTemplateWorkflowPorts()).list(ctxOf(b), {})).toEqual([]);
  });

  it("P5 — binding com as 5 dimensões do escopo exato: persiste; mesmo escopo sem substituição é recusado; plataforma/forma diferentes coexistem", async () => {
    const org = await seedOrg("p5");
    const r = await register(org, "edital-binding");
    const wf = new InstitutionalTemplatesWorkflow(createTemplateWorkflowPorts());
    await recordEvidence(org, r.revision.id);
    await wf.approve(ctxOf(org), { revisionId: r.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("ap"), decision: decision() });
    await wf.publish(ctxOf(org), { revisionId: r.revision.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key("pb"), decision: decision({ basisReference: "Ato 2" }), inventory: SMALL_INV });
    const input = { documentKind: "edital" as const, scope: { ...FULL }, identityId: r.identity.id, pinnedRevisionId: r.revision.id, effectiveFrom: "2026-10-01T00:00:00.000Z", confirm: true };
    const first = await wf.setBinding(ctxOf(org), input);
    expect(first.scope).toEqual(FULL);
    const stored = (await rows("SELECT scope_modality m, scope_form f, scope_platform p, scope_regime r, scope_criterion c FROM institutional_template_bindings WHERE organization_id = ? AND id = ?", [org, first.id]))[0];
    expect(stored).toEqual({ m: "pregao", f: "eletronica", p: "bll", r: "empreitada-preco-unitario", c: "menor-preco" });
    expect((await err(wf.setBinding(ctxOf(org), input)))?.code).toBe("BINDING_AMBIGUOUS");                              // mesmo escopo exato
    const other = await wf.setBinding(ctxOf(org), { ...input, scope: { ...FULL, platform: "compras-gov" } });          // outra plataforma coexiste
    expect(other.id).not.toBe(first.id);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ? AND active = 1", [org])).toBe(2);
    // escopo de 3 dimensões (persistível) continua funcionando para tipos sem regra explícita (compatibilidade)
    const tr = await wf.createIdentity(ctxOf(org), { documentKind: "tr", slug: `tr-p5-${RUN}` });
    const trDraft = await wf.createDraft(ctxOf(org), { identityId: tr.id, ast: AST });
    await wf.approve(ctxOf(org), { revisionId: trDraft.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("ap2"), decision: decision() });
    await wf.publish(ctxOf(org), { revisionId: trDraft.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key("pb2"), decision: decision({ basisReference: "Ato 3" }) });
    const ok = await wf.setBinding(ctxOf(org), { documentKind: "tr", scope: { modality: "pregao" }, identityId: tr.id, pinnedRevisionId: trDraft.id, effectiveFrom: "2026-10-01T00:00:00.000Z", confirm: true });
    expect(ok.pinnedRevisionId).toBe(trDraft.id);
  });

  it("P6 — catálogo multi-modelo sobre o banco real: nome pela procedência, escopo declarado, filtros e revisões", async () => {
    const org = await seedOrg("p6");
    await register(org, "edital-pregao-eletronico-bll");
    await register(org, "edital-pregao-presencial", { displayName: "Edital — Pregão Presencial", templateKey: "EDITAL_PREGAO_PRESENCIAL", declaredScope: { modality: "pregao", form: "presencial", regime: "empreitada-preco-unitario", criterion: "menor-preco" } });
    const svc = new TemplateCatalogService(createTemplateWorkflowPorts());
    const all = await svc.list(ctxOf(org), { documentKind: "edital" });
    expect(all.map((x) => x.displayName)).toEqual(["Edital — edital-pregao-eletronico-bll", "Edital — Pregão Presencial"]);
    expect(all.every((x) => x.displayNameSource === "IDENTITY" && x.bindingStatus === "NOT_BOUND")).toBe(true);
    expect((await svc.list(ctxOf(org), { form: "presencial" })).map((x) => x.slug)).toEqual(["edital-pregao-presencial"]);
    expect((await svc.list(ctxOf(org), { platform: "bll", status: "DRAFT" })).map((x) => x.slug)).toEqual(["edital-pregao-eletronico-bll"]);
    expect(await svc.list(ctxOf(org), { status: "PUBLISHED" })).toEqual([]);
  });

  it("P7 — feature OFF: o backend bloqueia a rota direta (catálogo, registro, evidência, prontidão, dossiê); nenhuma linha é escrita", async () => {
    const on = await seedOrg("p7on");
    const r = await register(on, "edital-off-base");
    const off = await seedOrg("p7off", false);
    tenant.org = off; tenant.role = "owner";
    const caller = institutionalTemplatesRouter.createCaller(makeContext(mockUser) as any);
    const code = async (p: Promise<unknown>) => { const e = await err(p); return e ? `${e.code}` : "OK"; };
    expect((await caller.getCapabilities()).enabled).toBe(false);
    const attempts = [
      caller.catalog.list({}), caller.governance.get({ revisionId: r.revision.id }),
      caller.registration.register({ target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: "off-1" }, templateKey: "OFF_KEY", displayName: "x", declaredScope: FULL, source: { kind: "AST", ast: AST }, sourceLogicalVersion: "1", sourceSha256: SHA, confirm: true, idempotencyKey: key("off"), decision: decision() } as never),
      caller.governance.recordLegalEvidence({ revisionId: r.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: key("offev"), decision: decision(), evidence: { sourceLogicalVersion: "1", sourceSha256: SHA } }),
      caller.readiness.evaluate({ revisionId: r.revision.id }), caller.previewDossier.run({ target: { kind: "REVISION", revisionId: r.revision.id }, context: { scope: FULL, sampleValues: {} } }),
    ];
    for (const p of attempts) expect(await code(p)).toBe("PRECONDITION_FAILED");
    expect(await count("SELECT COUNT(*) n FROM institutional_template_identities WHERE organization_id = ?", [off])).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ?", [off])).toBe(0);
  });

  it("P9 — gate de prontidão na publicação (banco real): BLOCKED ⇒ nada persistido; cliente não força PASS; PASS grava readiness.*; replay; concorrência; cross-tenant; indisponível ⇒ falha fechada", async () => {
    const org = await seedOrg("p9"); const other = await seedOrg("p9b");
    const ports = createTemplateWorkflowPorts();
    const wf = new InstitutionalTemplatesWorkflow(ports);
    const r = await register(org, "edital-gate");
    await wf.approve(ctxOf(org), { revisionId: r.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("ap"), decision: decision() });
    const pub = (over: Record<string, unknown> = {}, c = ctxOf(org), w = wf) => w.publish(c, { revisionId: r.revision.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key("pb"), decision: decision({ basisReference: "Ato de publicação" }), inventory: SMALL_INV, ...over } as never);
    const snap = async () => ({
      decisions: await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ?", [org]),
      events: await count("SELECT COUNT(*) n FROM institutional_template_events WHERE organization_id = ?", [org]),
      status: (await rows("SELECT status FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [org, r.revision.id]))[0].status,
    });

    // 1+2) evidência jurídica ausente ⇒ BLOCKED ⇒ PUBLICATION_BLOCKED; zero decisão, zero evento, status intacto
    const before = await snap();
    const blocked = await err(pub());
    expect(blocked?.code).toBe("PUBLICATION_BLOCKED");
    expect(blocked?.issues.map((i: any) => i.code)).toEqual(["LEGAL_APPROVAL_EVIDENCE"]);
    expect(await snap()).toEqual({ ...before, status: "APPROVED" });

    // 3) o cliente não força PASS: inventário adulterado segue BLOCKED (hash da procedência), mesmo após a evidência existir
    await recordEvidence(org, r.revision.id);
    const afterEvidence = await snap();
    const tampered = await err(pub({ inventory: { ...SMALL_INV, declared: { ...SMALL_INV.declared, inputsTotal: 3 } } }));
    expect(tampered?.code).toBe("PUBLICATION_BLOCKED");
    expect(tampered.issues.map((i: any) => i.code)).toEqual(expect.arrayContaining(["INPUTS_ACCOUNTED"]));
    expect((await err(pub({ inventory: undefined })))?.code).toBe("PUBLICATION_BLOCKED");
    expect(await snap()).toEqual(afterEvidence);

    // 9) readiness indisponível ⇒ falha fechada, nada persistido
    const { readiness: _r, ...noReadiness } = ports;
    expect((await err(pub({}, ctxOf(org), new InstitutionalTemplatesWorkflow(noReadiness as any))))?.code).toBe("READINESS_UNAVAILABLE");
    expect((await err(pub({}, ctxOf(org), new InstitutionalTemplatesWorkflow({ ...ports, readiness: { evaluateForPublication: async () => { throw new Error("db down"); } } } as any))))?.code).toBe("READINESS_UNAVAILABLE");
    expect(await snap()).toEqual(afterEvidence);

    // 6) cross-tenant: outro tenant não publica (NOT_FOUND) e nada é escrito
    expect((await err(pub({}, ctxOf(other))))?.code).toBe("NOT_FOUND");
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ?", [other])).toBe(0);

    // 8) concorrência: 4 publicações simultâneas ⇒ exatamente UMA decisão de publicação e UMA transição
    const results = await Promise.all([1, 2, 3, 4].map((n) => pub({ idempotencyKey: `pilot-race-pub-${RUN}-${n}` }, ctxOf(org, 300 + n)).then(() => "OK", (e) => String(e.message))));
    expect(results.filter((x) => x === "OK")).toHaveLength(1);
    for (const x of results.filter((y) => y !== "OK")) expect(x).toMatch(/STALE_STATE|DECISION_REJECTED/);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_publication'", [org])).toBe(1);

    // 4+5) PASS/NOT_APPLICABLE publicou: a decisão persistiu readiness.matrixHash/checkedAt/statuses (uma só authority)
    const d = (await rows("SELECT evidence, subject_id, outcome FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_publication'", [org]))[0];
    const lines: string[] = JSON.parse(d.evidence);
    expect(d).toMatchObject({ subject_id: r.revision.id, outcome: "publicado" });
    expect(lines[0]).toMatch(/^readiness\.matrixHash=[0-9a-f]{64}$/);
    expect(lines[1]).toMatch(/^readiness\.witnessHash=[0-9a-f]{64}$/);   // TOCTOU-001: estado em que a prontidão foi provada
    expect(lines[2]).toMatch(/^readiness\.checkedAt=\d{4}-\d{2}-\d{2}T/);
    expect(lines[3]).toMatch(/^readiness\.statuses=SOURCE_PROVENANCE:PASS,.*ITEMS_BACKING:NOT_APPLICABLE.*LEGAL_APPROVAL_EVIDENCE:PASS$/);
    expect(lines[3]).not.toMatch(/BLOCKED/);
    const final = await snap();
    expect(final.status).toBe("PUBLISHED");

    // 7) replay da publicação (mesma chave + mesmo pedido): converge, sem novas linhas
    const winnerKey = (await rows("SELECT idempotency_key k FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_publication'", [org]))[0].k as string;
    const n = Number(winnerKey.split("-").pop());
    const replay = await pub({ idempotencyKey: winnerKey }, ctxOf(org, 300 + n));
    expect(replay.replayed).toBe(true);
    expect(await snap()).toEqual(final);
    void inventoryHash; void inventoryCounts;
  });

  it("P8 — schema: guard de FKs e validador de boot limpos; nenhuma tabela nova do piloto; ledger usa as colunas existentes", async () => {
    expect(await checkForeignKeyContract(conn)).toEqual([]);
    expect(await collectSchemaProblems(conn)).toEqual([]);
    const tables = await rows(`SELECT TABLE_NAME t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'institutional_template%' OR TABLE_NAME LIKE 'document_composition%') ORDER BY 1`);
    expect(tables.map((x: any) => x.t)).toEqual(["document_composition_manifests", "document_composition_references", "institutional_template_bindings", "institutional_template_events", "institutional_template_identities", "institutional_template_revisions"]);
    const cols = await rows(`SELECT COLUMN_NAME c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'institutional_template_bindings' ORDER BY ORDINAL_POSITION`);
    expect(cols.map((x: any) => x.c)).toEqual(expect.arrayContaining(["scope_form", "scope_platform", "active_scope_key"]));   // 0317 (aditiva)
  }, 60_000);
});

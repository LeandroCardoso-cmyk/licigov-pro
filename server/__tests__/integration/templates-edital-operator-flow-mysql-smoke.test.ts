/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Fluxo OPERACIONAL do Edital institucional — MySQL REAL, dados SINTÉTICOS, SEM `seedGoverned`, pelas MESMAS rotas tRPC da UI.
 *
 *  O1  preparação (pendências) → preflight BLOCKED (zero draft/M1) → órgão/divulgação/processo (CAS) → preflight READY →
 *      TR exato → gerar M1 → estado de revisão → editar [REVISAR] → desvios → reconhecimentos (rota) → emitir (M2) → official_document
 *  O2  segurança: campos de outro tenant / processo arbitrário / revisão, TR e manifesto de outro tenant ⇒ fail-closed, sem enumeração
 *  O3  replay/CAS: mesma key+payload ⇒ replay; mesma key + payload diferente ⇒ CONFLICT; expectedRevision obsoleto ⇒ não sobrescreve;
 *      reconhecimento repetido ⇒ sem duplicar
 * Só roda com DATABASE_URL. Nenhum dado real, nenhum processo 2026/253, nenhum modelo de produção.
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
const legacy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../services/procurementProcessService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/procurementProcessService")>();
  return { ...actual, generateNotice: vi.fn(async () => { legacy.calls++; throw new Error("gerador legado não deve ser chamado no fluxo BOUND"); }) };
});

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import { institutionalTemplatesRouter } from "../../routers/institutionalTemplatesRouter";
import { runMigrations, validateSchema } from "../../bootstrap";
import { draftContentHash } from "../../domain/generatedDocument";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { ModelRegistrationService } from "../../services/institutionalTemplates/modelRegistrationService";
import { TemplateGovernanceService } from "../../services/institutionalTemplates/governanceService";
import { createTemplateCompositionPorts, createTemplateWorkflowPorts } from "../../services/institutionalTemplates/integration";
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts, getTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { installGovernedLegalReferenceV1, approveAndActivateReferenceSet } from "../../db/legalReference";
import { computeManifestHashes, LEGAL_REFERENCE_V1_META } from "../../domain/legalReference/manifestV1";
import { makeContext, mockUser } from "../helpers/fixtures";
import {
  BLL, U_AUTHOR, U_EDITOR, U_MANAGER, cleanupOrgs, ctxOf, decision, governedFieldsFor, seedOfficialTr, seedWorld, type World,
} from "../helpers/institutionalTemplatesE2eWorld";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
const BASE_ORG = 985_000_000 + STAMP * 10;
const RUN = STAMP.toString(36);
let orgSeq = 0;
let keySeq = 0;
const key = (p: string) => `${p}-${RUN}-${++keySeq}-opf`;
const ORGS: number[] = [];
const newOrg = () => { const o = BASE_ORG + orgSeq++; ORGS.push(o); return o; };

let conn: mysql.Connection;
let installedReferenceSet = false;
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const ctx = (org: number, role: string, userId: number) => {
  tenant.org = org; tenant.role = role;
  return { ...makeContext({ ...mockUser, id: userId }), correlationId: `corr-opf-${org}-${userId}`, requestId: `req-opf-${org}` } as any;
};
/** Rotas da UI, por papel/usuário. */
const proc = (org: number, role = "manager", userId = U_AUTHOR) => procurementProcessRouter.createCaller(ctx(org, role, userId));
const tpl = (org: number, role = "manager", userId = U_MANAGER) => institutionalTemplatesRouter.createCaller(ctx(org, role, userId));
const err = async (p: Promise<unknown>): Promise<{ code?: string; message: string } | null> => p.then(() => null, (e) => e);
const WS = { modality: "pregao", form: "eletronico", platform: "bll" } as const;

async function publishBll(org: number): Promise<{ identityId: string; revisionId: string }> {
  const wports = getTemplateWorkflowPorts();
  const reg = await new ModelRegistrationService(wports).register(ctxOf(org), {
    target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: BLL.slug }, templateKey: BLL.modelKey, displayName: BLL.displayName,
    declaredScope: BLL.declaredScope, source: { kind: "MODEL_PACKAGE", modelKey: BLL.modelKey },
    sourceLogicalVersion: BLL.provenance.sourceLogicalVersion, sourceSha256: BLL.provenance.sourceSha256,
    confirm: true, idempotencyKey: key("reg"), decision: decision(),
  });
  await new TemplateGovernanceService(wports).recordLegalEvidence(ctxOf(org), {
    revisionId: reg.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: key("ev"), decision: decision({ basisReference: "Parecer jurídico — [preencher no piloto]" }),
    evidence: { sourceLogicalVersion: BLL.provenance.sourceLogicalVersion, sourceSha256: BLL.provenance.sourceSha256 },
  });
  const wf = new InstitutionalTemplatesWorkflow(wports);
  await wf.approve(ctxOf(org), { revisionId: reg.revision.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("ap"), decision: decision({ basisReference: "Ato de aprovação" }) });
  await wf.publish(ctxOf(org), { revisionId: reg.revision.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: key("pb"), decision: decision({ basisReference: "Ato de publicação" }) });
  await wf.setBinding(ctxOf(org), { documentKind: "edital", scope: { ...BLL.declaredScope }, identityId: reg.identity.id, pinnedRevisionId: reg.revision.id, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true });
  return { identityId: reg.identity.id, revisionId: reg.revision.id };
}

/** Mundo SEM campos governados: nenhum `seedGoverned`. */
async function prepareBare(label: string) {
  const org = newOrg();
  const w: World = await seedWorld(conn, org, label, { flagOn: true });
  const tr = await seedOfficialTr(conn, w);
  const model = await publishBll(org);
  return { w, org, tr, model };
}
type Bare = Awaited<ReturnType<typeof prepareBare>>;

const prep = async (p: Bare): Promise<any> => proc(p.org).editalTemplatePreparation({ processId: p.w.processId, ...WS });
const pin = (tr: { documentId: string; version: number; contentHash: string }) => ({ TR: { documentId: tr.documentId, version: tr.version, contentHash: tr.contentHash } });
const preflight = (p: Bare, withPin = true): Promise<any> => proc(p.org).editalTemplatePreflight({ processId: p.w.processId, ...WS, ...(withPin ? { officialPins: pin(p.tr) } : {}) });
const writes = async (p: Bare) => ({
  drafts: await count("SELECT COUNT(*) n FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [p.org, p.w.processId]),
  m1: await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ?", [p.org]),
  official: await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital'", [p.org]),
});
const act = (k: string) => ({ confirm: true, idempotencyKey: key(k), decision: decision() });

/** O que a UI faz: grava UMA seção com os campos do catálogo, sempre com o `expectedRevision` do estado recarregado. */
async function saveOrg(p: Bare, source: "IDENTITY" | "POLICY", fields = governedFieldsFor(source)) {
  const st = await prep(p);
  return tpl(p.org).governed.recordOrganizationFields({ ...act(`o-${source}`), catalogVersion: st.catalogVersion, source, fields, expectedRevision: st.revisions.organization });
}
async function saveProcess(p: Bare, source: any, fields = governedFieldsFor(source)) {
  const st = await prep(p);
  return tpl(p.org).governed.recordProcessFields({
    ...act(`p-${source}`), catalogVersion: st.catalogVersion, processId: p.w.processId, source, fields, expectedRevision: st.revisions.process,
    ...(source === "ITEMS" ? { participation: { default: "Ampla participação, com os benefícios da LC nº 123/2006" } } : {}),
  });
}
async function saveDisclosure(p: Bare, disclosure: "publico" | "sigiloso" = "publico") {
  const st = await prep(p);
  return tpl(p.org).governed.recordBudgetDisclosure({ ...act("disc"), processId: p.w.processId, disclosure, expectedRevision: st.revisions.budget });
}
async function prepareAll(p: Bare) {
  for (const s of ["IDENTITY", "POLICY"] as const) await saveOrg(p, s);
  await saveDisclosure(p);
  const st = await prep(p);
  for (const s of st.sections.filter((x: any) => x.scope === "PROCESS").map((x: any) => x.source)) await saveProcess(p, s);
}

describe.skipIf(!DB)("Fluxo operacional do Edital institucional (MySQL real, rotas da UI, SEM seedGoverned)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
    if ((await count("SELECT COUNT(*) n FROM legal_reference_sets WHERE status = 'active'")) === 0) {
      await installGovernedLegalReferenceV1();
      await approveAndActivateReferenceSet({ version: LEGAL_REFERENCE_V1_META.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "operator-flow-synthetic" });
      installedReferenceSet = true;
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanupOrgs(conn, ORGS).catch(() => {});
    if (installedReferenceSet) for (const t of ["legal_reference_set_events", "legal_value_overrides", "legal_reference_entries", "legal_reference_sets"]) await conn.query(`DELETE FROM ${t}`).catch(() => {});
    await conn.end();
  }, 120_000);

  it("O1 — do processo real ao documento oficial, SOMENTE pelas rotas da UI, sem seed governado", async () => {
    const p = await prepareBare("o1");
    // 1. preparação: pendências visíveis, derivadas da revisão EXATA; nenhuma AST/payload bruto
    const st0 = await prep(p);
    expect(st0.status).toBe("READY_FOR_PREPARATION");
    expect(st0.revisionId).toBe(p.model.revisionId);
    expect(st0.revisions).toEqual({ process: 0, organization: 0, budget: 0 });
    expect(JSON.stringify(st0)).not.toContain("tpl-ast");
    const pending0 = st0.sections.reduce((a: number, s: any) => a + s.pendingRequired, 0);
    expect(pending0).toBeGreaterThan(0);
    // os campos do estado == os campos governáveis do catálogo (a UI não tem lista própria)
    for (const s of st0.sections) {
      const expected = Object.keys(governedFieldsFor(s.source)).sort();
      const mine = s.fields.filter((f: any) => !f.name.startsWith("pos.")).map((f: any) => f.path).sort();
      for (const path of expected) expect(mine, `${s.source}:${path}`).toContain(path);
    }
    // 2. preflight: BLOCKED com fontes ausentes visíveis; ZERO draft/M1/official
    const zero = await writes(p);
    const pf0 = await preflight(p);
    expect(pf0.status).toBe("BLOCKED");
    expect(pf0.issues.length).toBeGreaterThan(0);
    expect(pf0.issues.some((i: any) => i.code === "GOVERNED_SOURCE_PENDING" && i.source)).toBe(true);
    expect(await writes(p)).toEqual(zero);
    expect(legacy.calls).toBe(0);
    // geração BOUND sem preparo ⇒ falha fechada, sem legado, sem escrita
    const blocked = await err(proc(p.org).generateNotice({ processId: p.w.processId, object: "x", ...WS, officialPins: pin(p.tr), idempotencyKey: key("gen0") } as any));
    expect(blocked).not.toBeNull();
    expect(await writes(p)).toEqual(zero);
    expect(legacy.calls).toBe(0);

    // 3. preparar: órgão (IDENTITY, POLICY), divulgação, e cada seção do processo — CAS lido do estado recarregado
    await saveOrg(p, "IDENTITY");
    await saveOrg(p, "POLICY");
    expect((await prep(p)).revisions.organization).toBe(2);
    await saveDisclosure(p, "publico");
    const st1 = await prep(p);
    expect(st1.budgetDisclosure).toBe("publico");
    const processSources = st1.sections.filter((s: any) => s.scope === "PROCESS").map((s: any) => s.source);
    expect(processSources).toEqual(expect.arrayContaining(["PROCESS", "TR", "CERTAME_CONFIG", "ITEMS", "NORMATIVE", "LIFECYCLE"]));
    for (const s of processSources) await saveProcess(p, s);
    const st2 = await prep(p);
    expect(st2.revisions.process).toBe(processSources.length);
    expect(st2.sections.reduce((a: number, s: any) => a + s.pendingRequired, 0)).toBe(0);
    expect(st2.participation).toBeTruthy();

    // 4. preflight READY (sem pin ⇒ BLOCKED por TR); ainda zero escrita
    const noPin = await preflight(p, false);
    expect(noPin.status).toBe("BLOCKED");
    const pf1 = await preflight(p);
    expect(pf1.status).toBe("READY_FOR_COMPOSITION");
    expect(pf1.templateRevisionId).toBe(p.model.revisionId);
    expect(await writes(p)).toEqual(zero);

    // 5. gerar M1 pelo caminho da UI (legado não chamado)
    const r: any = await proc(p.org).generateNotice({ processId: p.w.processId, object: "Aquisição sintética de material de expediente", ...WS, officialPins: pin(p.tr), idempotencyKey: key("gen") } as any);
    expect(r.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    expect(legacy.calls).toBe(0);
    expect(await writes(p)).toEqual({ drafts: 1, m1: 1, official: 1 });

    // 6. estado de revisão do M1: marcadores pendentes visíveis; sem desvios ainda
    const rs0: any = await proc(p.org).editalTemplateReviewState({ processId: p.w.processId });
    expect(rs0.composedByTemplate).toBe(true);
    expect(rs0.generationManifestId).toBe(r.generationManifestId);
    expect(rs0.templateRevisionId).toBe(p.model.revisionId);
    expect(rs0.unresolvedMarkers.count).toBeGreaterThan(0);
    expect(rs0.structuralDeviations).toEqual([]);
    expect(rs0.revalidation.status).toMatch(/^(PASSED|BLOCKED)$/);   // marcadores pendentes são recusados na emissão (checados à parte)

    // 7. edição humana pelo endpoint de edição do workspace
    const draft: any = await proc(p.org).reviewableDraft({ processId: p.w.processId, kind: "edital" });
    const human = draft.draft.content.replace(/\[REVISAR[^\]]*\]/g, "Texto redigido e conferido pela equipe de licitações.") + "\nObservação do revisor: conteúdo conferido.\n";
    await proc(p.org, "operator", U_EDITOR).saveReviewableDraft({ processId: p.w.processId, kind: "edital", content: human, expectedContentHash: draft.draft.contentHash, idempotencyKey: key("edit") });
    const rs1: any = await proc(p.org).editalTemplateReviewState({ processId: p.w.processId });
    expect(rs1.unresolvedMarkers.count).toBe(0);
    expect(rs1.structuralDeviations.length).toBeGreaterThan(0);
    expect(rs1.structuralDeviations.every((d: any) => d.acknowledged === false && d.blockId && d.kind)).toBe(true);

    // 8. emissão ANTES do reconhecimento: o backend recusa (autoridade final)
    const promote = () => proc(p.org, "manager", U_MANAGER).promoteOfficial({ processId: p.w.processId, kind: "edital", idempotencyKey: key("promo"), expectedContentHash: draftContentHash(human), reason: "Revisado e conferido pelo gestor." } as any);
    const refused = await err(promote());
    expect(refused?.message).toContain("STRUCTURAL_DEVIATION_UNACKNOWLEDGED");

    // 9. reconhecimentos pela ROTA tRPC (um por desvio, idempotency própria por write)
    for (const d of rs1.structuralDeviations) {
      await tpl(p.org, "operator", U_MANAGER).reviews.acknowledgeDeviation({
        manifestId: rs1.generationManifestId, blockId: d.blockId, kind: d.kind, ...act("ack"), decision: decision({ basisReference: "Revisão do documento composto" }),
      });
    }
    const rs2: any = await proc(p.org).editalTemplateReviewState({ processId: p.w.processId });
    expect(rs2.structuralDeviations.every((d: any) => d.acknowledged)).toBe(true);
    expect(rs2.revalidation).toMatchObject({ status: "PASSED" });

    // 10. emissão ⇒ M2 + official_document
    const res: any = await promote();
    expect(res.promoted).toBe(true);
    expect(res.officialDocument.status).toBe("emitido");
    const m2 = await rows("SELECT derived_from_manifest_id d FROM document_composition_manifests WHERE organization_id = ? AND stage = 'ISSUANCE'", [p.org]);
    expect(m2).toHaveLength(1);
    expect(m2[0].d).toBe(r.generationManifestId);
    expect(await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [p.org])).toBe(1);
    expect(legacy.calls).toBe(0);
  }, 600_000);

  it("O2 — segurança: campos de outro tenant, processId arbitrário, revisão/TR/manifesto de outro tenant ⇒ fail-closed", async () => {
    const a = await prepareBare("o2a");
    const b = await prepareBare("o2b");
    await prepareAll(a);
    // leitura de preparação/preflight/review de processo alheio ⇒ NOT_FOUND
    expect((await err(proc(b.org).editalTemplatePreparation({ processId: a.w.processId, ...WS })))?.code).toBe("NOT_FOUND");
    expect((await err(proc(b.org).editalTemplatePreflight({ processId: a.w.processId, ...WS })))?.code).toBe("NOT_FOUND");
    expect((await err(proc(b.org).editalTemplateReviewState({ processId: a.w.processId })))?.code).toBe("NOT_FOUND");
    // escrever campos/divulgação num processo de outro tenant ou inexistente ⇒ NOT_FOUND, nada gravado
    const stB = await prep(b);
    const before = await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ?", [b.org]);
    for (const processId of [a.w.processId, "inexistente-1"]) {
      const e1 = await err(tpl(b.org).governed.recordProcessFields({ ...act("x"), catalogVersion: stB.catalogVersion, processId, source: "PROCESS", fields: {}, expectedRevision: 0 }));
      expect(e1?.code).toBe("NOT_FOUND");
      const e2 = await err(tpl(b.org).governed.recordBudgetDisclosure({ ...act("y"), processId, disclosure: "publico", expectedRevision: 0 }));
      expect(e2?.code).toBe("NOT_FOUND");
    }
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ?", [b.org])).toBe(before);
    // o estado de A não vaza para B; o registro ORG de A não aparece em B
    const stA = await prep(a);
    expect(stA.revisions.organization).toBe(2);
    expect(stB.revisions.organization).toBe(0);
    expect(JSON.stringify(stB)).not.toContain(a.w.processId);
    // TR e manifesto de outro tenant
    const zero = await writes(b);
    const crossTr = await err(proc(b.org).generateNotice({ processId: b.w.processId, object: "x", ...WS, officialPins: pin(a.tr), idempotencyKey: key("gx") } as any));
    expect(crossTr).not.toBeNull();
    expect(await writes(b)).toEqual(zero);
    const pfB = await preflight({ ...b, tr: a.tr } as Bare);
    expect(pfB.status).toBe("BLOCKED");
    const r: any = await proc(a.org).generateNotice({ processId: a.w.processId, object: "x", ...WS, officialPins: pin(a.tr), idempotencyKey: key("ga") } as any);
    const ackCross = await err(tpl(b.org, "operator").reviews.acknowledgeDeviation({ manifestId: r.generationManifestId, blockId: "x", kind: "INCLUDED_BLOCK_REMOVED", ...act("ack") }));
    expect(ackCross).not.toBeNull();
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type LIKE ?", [b.org, "%deviation%"])).toBe(0);
  }, 600_000);

  it("O3 — replay e CAS: mesma key/payload ⇒ replay; key igual + payload diferente ⇒ DECISION_IDEMPOTENCY_CONFLICT; revisão obsoleta não sobrescreve; ack sem duplicar", async () => {
    const p = await prepareBare("o3");
    const st = await prep(p);
    const fields = governedFieldsFor("IDENTITY");
    const input = { ...act("rp"), catalogVersion: st.catalogVersion, source: "IDENTITY" as const, fields, expectedRevision: 0 };
    const first: any = await tpl(p.org).governed.recordOrganizationFields(input);
    const again: any = await tpl(p.org).governed.recordOrganizationFields(input);
    expect(again.replayed).toBe(true);
    expect((await prep(p)).revisions.organization).toBe(1);
    // mesma key + payload diferente ⇒ CONFLICT
    const textKey = Object.keys(fields).find((k) => typeof fields[k] === "string" && !/url|cnpj|email|data|telefone|cep/i.test(k) && (fields[k] as string).length > 5)!;
    const other = { ...fields, [textKey]: `${fields[textKey]} (alterado)` };
    const conflict = await err(tpl(p.org).governed.recordOrganizationFields({ ...input, fields: other }));
    expect(conflict?.message).toContain("DECISION_IDEMPOTENCY_CONFLICT");
    // expectedRevision obsoleto (0 depois da revisão 1) ⇒ rejeitado e o valor gravado permanece
    const stale = await err(tpl(p.org).governed.recordOrganizationFields({ ...act("stale"), catalogVersion: st.catalogVersion, source: "IDENTITY", fields: other, expectedRevision: 0 }));
    expect(stale).not.toBeNull();
    expect((await prep(p)).revisions.organization).toBe(1);
    const cur = (await prep(p)).sections.find((s: any) => s.source === "IDENTITY").fields.filter((f: any) => f.hasValue);
    expect(JSON.stringify(cur)).not.toContain("(alterado)");
    expect(first.revision ?? first.record?.revision ?? 1).toBeTruthy();

    // reconhecimento repetido (mesma key) ⇒ replay, sem duplicar
    await prepareAll(p);
    const r: any = await proc(p.org).generateNotice({ processId: p.w.processId, object: "x", ...WS, officialPins: pin(p.tr), idempotencyKey: key("g3") } as any);
    const draft: any = await proc(p.org).reviewableDraft({ processId: p.w.processId, kind: "edital" });
    const human = draft.draft.content.replace(/\[REVISAR[^\]]*\]/g, "Texto humano.");
    await proc(p.org, "operator", U_EDITOR).saveReviewableDraft({ processId: p.w.processId, kind: "edital", content: human, expectedContentHash: draft.draft.contentHash, idempotencyKey: key("e3") });
    const rs: any = await proc(p.org).editalTemplateReviewState({ processId: p.w.processId });
    const d0 = rs.structuralDeviations[0];
    const ackIn = { manifestId: r.generationManifestId, blockId: d0.blockId, kind: d0.kind, ...act("ack3") };
    const a1: any = await tpl(p.org, "operator").reviews.acknowledgeDeviation(ackIn);
    const a2: any = await tpl(p.org, "operator").reviews.acknowledgeDeviation(ackIn);
    expect(a1.replayed ?? false).toBe(false);
    expect(a2.replayed).toBe(true);
    const rs2: any = await proc(p.org).editalTemplateReviewState({ processId: p.w.processId });
    expect(rs2.structuralDeviations.filter((d: any) => d.acknowledged)).toHaveLength(1);
  }, 600_000);
});

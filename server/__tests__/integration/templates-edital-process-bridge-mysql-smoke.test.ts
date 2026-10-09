/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Bridge Edital (workspace do processo) → Modelos Institucionais — MySQL REAL, dados SINTÉTICOS, pelo router tRPC real.
 *
 *  B1  BOUND (pregao/eletronico/bll → pregao/eletronica/bll): resolução autoritativa, TR oficial exato, geração institucional no
 *      MESMO rascunho canônico (origem:template + M1), gerador LEGADO não chamado, replay convergente
 *  B2  TR exato: ausente / hash divergente / versão obsoleta ⇒ falha fechada, ZERO writes, legado não chamado
 *  B3  revisão humana → revalidação → M2 (emissão) pelo pipeline existente; SOURCE_CHANGED bloqueia a emissão
 *  B4  roteamento: feature OFF e NOT_BOUND ⇒ LEGADO (uma chamada); plataforma "outra" ⇒ NOT_BOUND sem aproximação
 *  B5  cross-tenant: processo/TR/binding/revisão de outro tenant ⇒ NOT_FOUND / fail-closed sem revelar existência
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
// O gerador LEGADO é observado (espião): prova o roteamento sem chamar cognição real. O restante do serviço é o REAL.
const legacy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../services/procurementProcessService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/procurementProcessService")>();
  return {
    ...actual,
    generateNotice: vi.fn(async (p: { processId: string; organizationId: number; object: string }) => {
      legacy.calls++;
      return { document: { id: "legacy", processId: p.processId, organizationId: p.organizationId, kind: "edital", title: `Edital — ${p.object}`, content: "legado", status: "rascunho" }, validation: { valid: true, violations: [] }, replayed: false };
    }),
  };
});

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import { runMigrations, validateSchema } from "../../bootstrap";
import { draftContentHash } from "../../domain/generatedDocument";
import { promoteOfficialDocument } from "../../services/documentPromotionService";
import { saveReviewableDraft } from "../../services/procurementProcessService";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { ModelRegistrationService } from "../../services/institutionalTemplates/modelRegistrationService";
import { TemplateReviewService } from "../../services/institutionalTemplates/reviewService";
import { TemplateGovernanceService } from "../../services/institutionalTemplates/governanceService";
import { createTemplateCompositionPorts, createTemplateWorkflowPorts, templateIssuanceHook } from "../../services/institutionalTemplates/integration";
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts, getTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { installGovernedLegalReferenceV1, approveAndActivateReferenceSet } from "../../db/legalReference";
import { computeManifestHashes, LEGAL_REFERENCE_V1_META } from "../../domain/legalReference/manifestV1";
import { makeContext, mockUser } from "../helpers/fixtures";
import {
  BLL, E2E_SCENARIO, U_EDITOR, U_MANAGER, cleanupOrgs, ctxOf, decision, seedGoverned, seedOfficialTr, seedWorld, type World,
} from "../helpers/institutionalTemplatesE2eWorld";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
const BASE_ORG = 986_000_000 + STAMP * 10;
const RUN = STAMP.toString(36);
let orgSeq = 0;
let keySeq = 0;
const key = (p: string) => `${p}-${RUN}-${++keySeq}-brg`;
const ORGS: number[] = [];
const newOrg = () => { const o = BASE_ORG + orgSeq++; ORGS.push(o); return o; };

let conn: mysql.Connection;
let installedReferenceSet = false;
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const caller = (org: number, role = "owner") => { tenant.org = org; tenant.role = role; return procurementProcessRouter.createCaller({ ...makeContext(mockUser), correlationId: `corr-bridge-${org}`, requestId: `req-bridge-${org}` } as any); };
const err = async (p: Promise<unknown>): Promise<{ code?: string; message: string } | null> => p.then(() => null, (e) => e);

// Parâmetros do WORKSPACE (vocabulário legado do domínio): eletronico / bll. O servidor normaliza no boundary.
const WS = { modality: "pregao", form: "eletronico", platform: "bll" } as const;

async function publishBll(org: number, bind = true): Promise<{ identityId: string; revisionId: string }> {
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
  if (bind) await wf.setBinding(ctxOf(org), { documentKind: "edital", scope: { ...BLL.declaredScope }, identityId: reg.identity.id, pinnedRevisionId: reg.revision.id, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true });
  return { identityId: reg.identity.id, revisionId: reg.revision.id };
}

async function prepare(label: string, o: { bind?: boolean; publish?: boolean; flagOn?: boolean } = {}) {
  const org = newOrg();
  const w: World = await seedWorld(conn, org, label, { flagOn: o.flagOn ?? true });
  await seedGoverned(w, E2E_SCENARIO as any, "publico", label);
  const tr = await seedOfficialTr(conn, w);
  const model = o.publish === false ? null : await publishBll(org, o.bind ?? true);
  return { w, org, tr, model };
}

const draftOf = async (w: World) => (await rows("SELECT * FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [w.org, w.processId]))[0];
const writes = async (w: World) => ({
  drafts: await count("SELECT COUNT(*) n FROM generated_documents WHERE organization_id = ? AND process_id = ? AND kind = 'edital'", [w.org, w.processId]),
  m1: await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ?", [w.org]),
  official: await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital'", [w.org]),
});
const pin = (tr: { documentId: string; version: number; contentHash: string }) => ({ TR: { documentId: tr.documentId, version: tr.version, contentHash: tr.contentHash } });
const gen = (org: number, w: World, officialPins?: object, params: object = WS) =>
  caller(org).generateNotice({ processId: w.processId, object: "Aquisição sintética de material de expediente", ...params, ...(officialPins ? { officialPins } : {}), idempotencyKey: key("gen") } as any);

describe.skipIf(!DB)("Bridge Edital → Modelos Institucionais (MySQL real, router real, dados sintéticos)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
    if ((await count("SELECT COUNT(*) n FROM legal_reference_sets WHERE status = 'active'")) === 0) {
      await installGovernedLegalReferenceV1();
      await approveAndActivateReferenceSet({ version: LEGAL_REFERENCE_V1_META.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "bridge-synthetic" });
      installedReferenceSet = true;
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanupOrgs(conn, ORGS).catch(() => {});
    if (installedReferenceSet) for (const t of ["legal_reference_set_events", "legal_value_overrides", "legal_reference_entries", "legal_reference_sets"]) await conn.query(`DELETE FROM ${t}`).catch(() => {});
    await conn.end();
  }, 120_000);

  it("B1 — BOUND: eletronico→eletronica; resolução autoritativa; TR exato; geração institucional no MESMO rascunho; legado não chamado; replay", async () => {
    const p = await prepare("b1");
    // resolução autoritativa (sem AST) com o vocabulário do WORKSPACE
    const res: any = await caller(p.org).editalTemplateResolution({ processId: p.w.processId, ...WS });
    expect(res.status).toBe("BOUND");
    expect(res.template).toMatchObject({ displayName: "Edital — Pregão Eletrônico — BLL", revisionId: p.model!.revisionId, revision: 1, identityId: p.model!.identityId });
    expect(res.template.scope).toMatchObject({ modality: "pregao", form: "eletronica", platform: "bll" });
    expect(JSON.stringify(res)).not.toContain("tpl-ast");
    // TR oficial exato: hash calculado no servidor
    const cands: any[] = await caller(p.org).editalTrCandidates({ processId: p.w.processId });
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ documentId: p.tr.documentId, version: 1, contentHash: p.tr.contentHash, current: true });

    const before = legacy.calls;
    const r: any = await gen(p.org, p.w, pin(p.tr));
    expect(r.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    expect(r.replayed).toBe(false);
    expect(legacy.calls).toBe(before);                                  // gerador legado NÃO foi chamado
    expect(r.template).toMatchObject({ revisionId: p.model!.revisionId, identityId: p.model!.identityId });
    // MESMO rascunho canônico do workspace: origem:template + M1
    const d = await draftOf(p.w);
    expect(d.status).toBe("rascunho");
    expect(JSON.parse(d.sources)).toEqual(expect.arrayContaining(["origem:template", `tpl-m1:${r.generationManifestId}`]));
    expect(d.content).toContain("Papel sulfite A4 75g");
    expect(await writes(p.w)).toEqual({ drafts: 1, m1: 1, official: 1 });   // 1 rascunho, 1 M1, 1 versão `gerado`
    // o workspace lê o MESMO rascunho (reviewableDraft)
    const rv: any = await caller(p.org).reviewableDraft({ processId: p.w.processId, kind: "edital" });
    expect(rv.draft.contentHash).toBe(draftContentHash(d.content));

    // replay: mesmas entradas + mesmo pin ⇒ converge, sem duplicar rascunho/M1/versão
    const again: any = await gen(p.org, p.w, pin(p.tr));
    expect(again.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    expect(again.replayed).toBe(true);
    expect(again.generationManifestId).toBe(r.generationManifestId);
    expect(await writes(p.w)).toEqual({ drafts: 1, m1: 1, official: 1 });
  }, 300_000);

  it("B2 — TR exato obrigatório: ausente / hash divergente / obsoleto ⇒ falha fechada, ZERO writes, legado não chamado", async () => {
    const p = await prepare("b2");
    const zero = await writes(p.w);
    const calls = legacy.calls;
    const missing = await err(gen(p.org, p.w));
    expect(missing?.message).toContain("TR_OFICIAL_EXATO_NECESSARIO");
    const badHash = await err(gen(p.org, p.w, pin({ ...p.tr, contentHash: "0".repeat(64) })));
    expect(badHash?.message).toContain("OFFICIAL_PIN_MISMATCH");
    const badVersion = await err(gen(p.org, p.w, pin({ ...p.tr, version: 9 })));
    expect(badVersion?.message).toContain("OFFICIAL_PIN_MISMATCH");
    // nova versão emitida do TR ⇒ o pin da v1 passa a ser OBSOLETO (nunca "latest" implícito)
    const v2 = await seedOfficialTr(conn, p.w, 2, "TERMO DE REFERÊNCIA — conteúdo sintético v2");
    const stale = await err(gen(p.org, p.w, pin(p.tr)));
    expect(stale?.message).toContain("OFFICIAL_PIN_STALE");
    const cands: any[] = await caller(p.org).editalTrCandidates({ processId: p.w.processId });
    expect(cands.map((c) => [c.version, c.current])).toEqual([[2, true], [1, false]]);
    expect(await writes(p.w)).toEqual(zero);
    expect(legacy.calls).toBe(calls);                                   // nenhuma falha institucional cai para o legado
    // pin da versão vigente ⇒ funciona
    expect((await gen(p.org, p.w, pin(v2)) as any).generationMode).toBe("INSTITUTIONAL_TEMPLATE");
  }, 300_000);

  /** Revisão humana do rascunho composto pelo bridge (editor ≠ autor): texto humano nos blocos de narrativa + reconhecimento dos desvios. */
  async function reviewByHuman(p: Awaited<ReturnType<typeof prepare>>, r: any) {
    const d = await draftOf(p.w);
    // Narrativas de IA NÃO são produzidas pelo bridge: o rascunho traz marcadores governados e a emissão recusa pendências.
    expect(d.content).toMatch(/\[REVISAR/);
    const human = d.content.replace(/\[REVISAR[^\]]*\]/g, "Texto redigido e conferido pela equipe de licitações.") + "\nObservação do revisor: conteúdo conferido.\n";
    await saveReviewableDraft({
      organizationId: p.org, processId: p.w.processId, kind: "edital", content: human, actorUserId: U_EDITOR,
      expectedContentHash: draftContentHash(d.content), idempotencyKey: key("edit"), correlationId: "corr-edit",
    });
    const promote = () => promoteOfficialDocument({
      organizationId: p.org, processId: p.w.processId, kind: "edital", actorUserId: U_MANAGER, actorRole: "manager", idempotencyKey: key("promo"),
      correlationId: `corr-promo-${p.org}`, expectedContentHash: draftContentHash(human), reason: "Revisado e conferido pelo gestor.", templateIssuance: templateIssuanceHook(),
    });
    // Sem narrativa de IA aceita, a substituição humana dos blocos de narrativa é um DESVIO ESTRUTURAL: exige reconhecimento humano
    // registrado, bloco a bloco (mecanismo governado existente). A emissão recusa até todos serem reconhecidos.
    const refused = await err(promote());
    expect(refused?.message).toContain("STRUCTURAL_DEVIATION_UNACKNOWLEDGED");
    const deviations = [...(refused?.message ?? "").matchAll(/(INCLUDED_BLOCK_REMOVED|EXCLUDED_BLOCK_INSERTED) em (\S+) sem reconhecimento/g)];
    expect(deviations.length).toBeGreaterThan(0);
    const review = new TemplateReviewService(getTemplateWorkflowPorts().manifests!);
    for (const [, kind, blockId] of deviations) {
      await review.acknowledgeDeviation(ctxOf(p.org), {
        manifestId: r.generationManifestId, blockId, kind: kind as any, confirm: true, idempotencyKey: key("ack").slice(0, 120), decision: decision({ basisReference: "Revisão do documento composto" }),
      });
    }
    return promote;
  }

  it("B3 — fonte alterada depois do M1 ⇒ emissão bloqueada por SOURCE_CHANGED (zero mutação oficial); a revisão humana já está completa", async () => {
    const p = await prepare("b3");
    const r: any = await gen(p.org, p.w, pin(p.tr));
    const promote = await reviewByHuman(p, r);
    // o TR muda DEPOIS do M1 ⇒ a revalidação canônica bloqueia (nada é regenerado nem mutado)
    const v2 = await seedOfficialTr(conn, p.w, 2, "TERMO DE REFERÊNCIA — alterado depois do M1");
    const blocked = await err(promote());
    expect(blocked?.message).toContain("TEMPLATE_ISSUANCE_BLOCKED");
    expect(blocked?.message).toMatch(/SOURCE_CHANGED/);
    expect(await count("SELECT COUNT(*) n FROM document_composition_manifests WHERE organization_id = ? AND stage = 'ISSUANCE'", [p.org])).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [p.org])).toBe(0);
    expect(v2.version).toBe(2);
  }, 300_000);

  it("B3b — revisão humana → revalidação → M2 → emissão (TR inalterado desde o M1), M2 derivado do M1 do bridge", async () => {
    const p = await prepare("b3b");
    const r: any = await gen(p.org, p.w, pin(p.tr));
    const promote = await reviewByHuman(p, r);
    const res = await promote();
    expect(res.promoted).toBe(true);
    expect(res.officialDocument.status).toBe("emitido");
    const m2 = (await rows("SELECT derived_from_manifest_id d FROM document_composition_manifests WHERE organization_id = ? AND stage = 'ISSUANCE'", [p.org]));
    expect(m2).toHaveLength(1);
    expect(m2[0].d).toBe(r.generationManifestId);
    const official = (await rows("SELECT content FROM official_documents WHERE tenant_id = ? AND document_type = 'edital' AND status = 'emitido'", [p.org]))[0];
    expect(official.content).not.toMatch(/\{\{|\}\}|SYSTEM NOTE|\[REVISAR/);
  }, 300_000);

  it("B4 — roteamento: feature OFF e NOT_BOUND ⇒ LEGADO; plataforma sem slug institucional ⇒ NOT_BOUND sem aproximação", async () => {
    const off = await prepare("b4-off", { flagOn: false, publish: false });
    expect(((await caller(off.org).editalTemplateResolution({ processId: off.w.processId, ...WS })) as any).status).toBe("FEATURE_OFF");
    const c0 = legacy.calls;
    const rOff: any = await gen(off.org, off.w);
    expect(rOff.generationMode).toBe("LEGACY");
    expect(legacy.calls).toBe(c0 + 1);

    const nb = await prepare("b4-nb", { publish: false });
    const resNb: any = await caller(nb.org).editalTemplateResolution({ processId: nb.w.processId, ...WS });
    expect(resNb).toMatchObject({ status: "NOT_BOUND", reason: "NO_BINDING" });
    const rNb: any = await gen(nb.org, nb.w);
    expect(rNb.generationMode).toBe("LEGACY");
    expect(legacy.calls).toBe(c0 + 2);
    expect(await writes(nb.w)).toMatchObject({ m1: 0 });

    // modelo publicado e vinculado a bll: licitanet/outra NÃO resolvem por aproximação
    const p = await prepare("b4-b");
    expect(((await caller(p.org).editalTemplateResolution({ processId: p.w.processId, modality: "pregao", form: "eletronico", platform: "licitanet" })) as any).status).toBe("NOT_BOUND");
    const outra: any = await caller(p.org).editalTemplateResolution({ processId: p.w.processId, modality: "pregao", form: "eletronico", platform: "outra" });
    expect(outra).toMatchObject({ status: "NOT_BOUND", reason: "UNMAPPED_SCOPE" });
    expect(((await caller(p.org).editalTemplateResolution({ processId: p.w.processId, modality: "pregao", form: "presencial" })) as any).status).toBe("NOT_BOUND");
  }, 300_000);

  it("B5 — cross-tenant: processo/TR/binding de outro tenant ⇒ NOT_FOUND ou fail-closed, sem revelar existência", async () => {
    const a = await prepare("b5-a");
    const b = await prepare("b5-b");
    expect((await err(caller(b.org).editalTemplateResolution({ processId: a.w.processId, ...WS })))?.code).toBe("NOT_FOUND");
    expect((await err(caller(b.org).editalTrCandidates({ processId: a.w.processId })))?.code).toBe("NOT_FOUND");
    expect((await err(gen(b.org, a.w, pin(a.tr))))?.code).toBe("NOT_FOUND");
    // TR do tenant A no processo do tenant B ⇒ indistinguível de inexistente
    const zero = await writes(b.w);
    const cross = await err(gen(b.org, b.w, pin(a.tr)));
    expect(cross?.message).toContain("OFFICIAL_PIN_NOT_FOUND");
    expect(await writes(b.w)).toEqual(zero);
    // binding/revisão de B não aparecem no tenant A e vice-versa
    const resB: any = await caller(b.org).editalTemplateResolution({ processId: b.w.processId, ...WS });
    expect(resB.template.revisionId).toBe(b.model!.revisionId);
    expect(resB.template.revisionId).not.toBe(a.model!.revisionId);
    expect(U_EDITOR).toBeGreaterThan(0);
  }, 300_000);
});

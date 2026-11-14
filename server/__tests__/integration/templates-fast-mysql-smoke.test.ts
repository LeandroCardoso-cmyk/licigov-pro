/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * LICIGOV-FAST — MySQL REAL, tenants SINTÉTICOS, pelas rotas reais (tRPC): decisão registrada ELETRONICAMENTE pelo usuário autenticado (sem digitar autoridade/cargo/ato),
 * "Disponibilizar para elaboração" em um ato (aprovar + publicar no catálogo INTERNO, readiness recalculada no servidor), com RBAC, isolamento de tenant, idempotência/replay e
 * o gate jurídico do regime legado intacto; M8-UX-GOV-001: escritas governadas (orçamento, TR/certame, itens, Perfil) também sem redigitar autoridade. Só roda com DATABASE_URL. Nenhum dado real, nenhum modelo de produção, nenhuma organização real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";

const tenant = vi.hoisted(() => ({ org: 1, role: "owner" as string }));
vi.mock("../../services/tenantService", () => ({
  // SECURITY-02 — a autoridade institucional é lida da fonte autoritativa (getMembership): o ator do router destes cenários
  // é MEMBRO REAL do órgão com o papel do contexto (a releitura transacional da emissão continua no MySQL real).
  getMembership: vi.fn(async (userId: number, organizationId: number) => ({ id: 1, organizationId, userId, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() })),
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: tenant.org,
    membership: { id: 1, organizationId: tenant.org, userId: 1, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));

import { institutionalTemplatesRouter } from "../../routers/institutionalTemplatesRouter";
import { runMigrations, validateSchema } from "../../bootstrap";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { ModelRegistrationService } from "../../services/institutionalTemplates/modelRegistrationService";
import { createTemplateCompositionPorts, createTemplateWorkflowPorts } from "../../services/institutionalTemplates/integration";
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts, getTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { originalStorageKey } from "../../services/institutionalTemplates/adapters/originalStoreAdapter";
import { getModelPackage } from "../../services/institutionalTemplates/modelPackages";
import { summarizePackageInventory } from "../../services/institutionalTemplates/modelRegistrationService";
import { ELECTRONIC_BASIS } from "../../services/institutionalTemplates/electronicAuthority";
import { makeContext, mockUser } from "../helpers/fixtures";
import { BLL, BLL_CATALOG, E2E_BUDGET_BASE_DATE, SYNTHETIC_PLATFORMS, U_MANAGER, cleanupOrgs, ctxOf, decision, governedFieldsFor, markTemplateOrgLegacy, seedWorld } from "../helpers/institutionalTemplatesE2eWorld";
import { createHash } from "node:crypto";

const DB = process.env.DATABASE_URL;
const STAMP = Date.now() % 1_000_000;
const BASE_ORG = 976_000_000 + (STAMP % 20_000) * 100;
const RUN = STAMP.toString(36);
let orgSeq = 0; let keySeq = 0;
const key = (p: string) => `${p}-${RUN}-${++keySeq}-fast`;
const ORGS: number[] = [];
const newOrg = async (label: string) => { const o = BASE_ORG + orgSeq++; ORGS.push(o); await seedWorld(conn, o, label, { flagOn: true }); return o; };
let conn: mysql.Connection;
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const tpl = (org: number, role = "manager", userId = U_MANAGER) => {
  tenant.org = org; tenant.role = role;
  return institutionalTemplatesRouter.createCaller({ ...makeContext({ ...mockUser, id: userId }), correlationId: `corr-fast-${org}-${userId}`, requestId: `req-fast-${org}` } as any);
};
const wports = () => getTemplateWorkflowPorts();
const wf = () => new InstitutionalTemplatesWorkflow(wports());
const OPTIONAL = { legalEvidence: "OPTIONAL", approveMinRole: "manager", publishMinRole: "manager" } as const;
const store = { objects: new Map<string, Buffer>() };
const fakeStore = {
  put: async (i: any) => { const storageKey = originalStorageKey(i.organizationId, i.sha256, i.filename); store.objects.set(storageKey, Buffer.from(i.bytes)); return { storageKey, verifiedSha256: i.sha256, verifiedSizeBytes: i.bytes.length }; },
  verify: async () => ({ status: "VERIFIED" }),
};
const register = (org: number, over: Record<string, unknown> = {}) => new ModelRegistrationService(wports()).register(ctxOf(org), {
  target: { kind: "NEW_IDENTITY", documentKind: "edital", slug: BLL.slug }, templateKey: BLL.modelKey, displayName: BLL.displayName, declaredScope: BLL.declaredScope,
  source: { kind: "MODEL_PACKAGE", modelKey: BLL.modelKey }, sourceLogicalVersion: BLL.provenance.sourceLogicalVersion, sourceSha256: BLL.provenance.sourceSha256,
  confirm: true, idempotencyKey: key("reg"), decision: decision(), ...over,
} as any);
const decisionsOf = (org: number, type: string) => rows<any>("SELECT * FROM institutional_decisions WHERE organization_id = ? AND subject_type = ? ORDER BY revision", [org, type]);
const available = (org: number, revisionId: string, over: Record<string, unknown> = {}, role = "manager") =>
  tpl(org, role).revisions.makeAvailable({ revisionId, expectedStatus: "DRAFT", confirm: true, idempotencyKey: key("av"), ...over } as any) as Promise<any>;
const statusOf = async (org: number, revisionId: string) => (await wports().repository.getRevision(org, revisionId))!.status;

describe.skipIf(!DB)("LICIGOV-FAST (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn); await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts({ ...createTemplateWorkflowPorts(), originals: fakeStore as any });
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
  }, 300_000);
  afterAll(async () => { if (!conn) return; await cleanupOrgs(conn, ORGS).catch(() => {}); await conn.end(); }, 120_000);

  it("FAST-1 — política SEM digitar autoridade/cargo/ato: registrada com o usuário autenticado; contrato do ledger intacto; replay; CAS; RBAC; fundamento explícito prevalece; confirmação obrigatória", async () => {
    const org = await newOrg("fast1");
    const k = key("pol");
    const rec = (over: Record<string, unknown> = {}, role = "manager", ex = 0) => tpl(org, role).governance.policy.record({ expectedVersion: ex, confirm: true, idempotencyKey: k, policy: OPTIONAL, ...over } as any) as Promise<any>;
    const first = await rec();
    expect(first.policy).toMatchObject({ kind: "TENANT_DEFINED", version: 1, policy: { legalEvidence: "OPTIONAL" } });
    const [d] = await decisionsOf(org, "institutional.policy");
    expect(d).toMatchObject({
      decided_by_name: "Usuário Teste", decided_by_role: "Gestor do órgão (manager)", basis_reference: ELECTRONIC_BASIS, recorded_by_user_id: U_MANAGER,
      authority_validation: "NOT_VALIDATED_POLICY_PENDING",
    });
    expect(d.correlation_id).toMatch(/^corr-fast-/);                                                  // rastreabilidade: correlation id + usuário + data
    expect(d.reason).toMatch(/Política de governança dos modelos do órgão — registrado eletronicamente/);
    expect(d.basis_reference).toMatch(/nenhum ato administrativo informado/);                          // nenhum ato fictício
    // replay idempotente (mesma chave + mesmo pedido) ⇒ converge sem nova decisão
    expect((await rec()).replayed).toBe(true);
    expect(await decisionsOf(org, "institutional.policy")).toHaveLength(1);
    // CAS pela versão vista; RBAC; confirmação literal
    await expect(rec({ idempotencyKey: key("p2"), policy: { ...OPTIONAL, legalEvidence: "REQUIRED" } }, "manager", 0)).rejects.toThrow(/STALE_STATE|outra pessoa registrou/i);
    for (const role of ["operator", "viewer"]) await expect(rec({ idempotencyKey: key("p3") }, role, 1)).rejects.toThrow();
    await expect(rec({ idempotencyKey: key("p4"), confirm: false, policy: { ...OPTIONAL, legalEvidence: "REQUIRED" } }, "manager", 1)).rejects.toThrow(/CONFIRMATION_REQUIRED|confirmação/i);
    // observação do usuário vira a justificativa; fundamento institucional EXPLÍCITO (decision completa) prevalece e continua validado como antes
    await rec({ idempotencyKey: key("p5"), policy: { ...OPTIONAL, legalEvidence: "REQUIRED" }, note: "Decisão tomada em reunião do setor." }, "manager", 1);
    await rec({ idempotencyKey: key("p6"), policy: OPTIONAL, decision: { decidedByName: "Ana Lima", decidedByRole: "Secretária", decidedAt: "2026-10-01", basisReference: "Portaria 7/2026", reason: "Conforme a portaria." } }, "manager", 2);
    const all = await decisionsOf(org, "institutional.policy");
    expect(all.map((x) => x.reason)).toEqual([expect.stringMatching(/eletronicamente/), "Decisão tomada em reunião do setor.", "Conforme a portaria."]);
    expect(all[2]).toMatchObject({ decided_by_name: "Ana Lima", basis_reference: "Portaria 7/2026" });
    // decisão PARCIAL é recusada (o contrato estrito não foi enfraquecido): ou tudo ou nada
    await expect(rec({ idempotencyKey: key("p7"), policy: { ...OPTIONAL, legalEvidence: "REQUIRED" }, decision: { decidedByName: "Ana" } }, "manager", 3)).rejects.toThrow();
  }, 300_000);

  it("FAST-2 — DISPONIBILIZAR em um ato: aprova + publica no catálogo INTERNO (2 decisões no ledger, chaves derivadas, autoridade eletrônica); não vincula; replay converge; um clique em orgão novo (OPTIONAL padrão)", async () => {
    const org = await newOrg("fast2");
    const reg = await register(org);
    const bindingsBefore = await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ?", [org]);
    const k = key("av");
    await available(org, reg.revision.id, { idempotencyKey: k });
    expect(await statusOf(org, reg.revision.id)).toBe("PUBLISHED");
    const approval = await decisionsOf(org, "institutional_template.approval");
    const publication = await decisionsOf(org, "institutional_template.publication");
    expect(approval).toHaveLength(1); expect(publication).toHaveLength(1);
    expect(approval[0]).toMatchObject({ idempotency_key: `${k}:approve`, basis_reference: ELECTRONIC_BASIS, recorded_by_user_id: U_MANAGER });
    expect(publication[0]).toMatchObject({ idempotency_key: `${k}:publish`, basis_reference: ELECTRONIC_BASIS, recorded_by_user_id: U_MANAGER });
    expect(approval[0].reason).toMatch(/Disponibilização do modelo para elaboração/);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ?", [org])).toBe(bindingsBefore);   // NÃO vincula: o modelo em uso nos novos documentos não muda
    // replay (mesma chave, mesmo pedido) ⇒ converge, sem decisões novas
    await available(org, reg.revision.id, { idempotencyKey: k }).catch(() => undefined);
    expect(await decisionsOf(org, "institutional_template.approval")).toHaveLength(1);
    expect(await decisionsOf(org, "institutional_template.publication")).toHaveLength(1);
    // revisão publicada é imutável e não pode ser "disponibilizada" de novo com outra chave
    await expect(available(org, reg.revision.id, { idempotencyKey: key("av2") })).rejects.toThrow();
    // confirmação literal obrigatória: nada muda
    const org2 = await newOrg("fast2b"); const reg2 = await register(org2);
    await expect(available(org2, reg2.revision.id, { confirm: false })).rejects.toThrow(/CONFIRMATION_REQUIRED|confirmação/i);
    expect(await statusOf(org2, reg2.revision.id)).toBe("DRAFT");
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type LIKE 'institutional_template.%' AND subject_type <> 'institutional_template.import_provenance'", [org2])).toBe(0);
  }, 300_000);

  it("FAST-3 — RBAC e isolamento: operator/viewer recusados; piso elevado da política (owner) vale para disponibilizar; outro tenant não enxerga a revisão", async () => {
    const org = await newOrg("fast3"); const other = await newOrg("fast3b");
    const reg = await register(org);
    for (const role of ["operator", "viewer"]) await expect(available(org, reg.revision.id, {}, role)).rejects.toThrow();
    await tpl(org).governance.policy.record({ expectedVersion: 0, confirm: true, idempotencyKey: key("fl"), policy: { legalEvidence: "OPTIONAL", approveMinRole: "owner", publishMinRole: "manager" } } as any);
    await expect(available(org, reg.revision.id, {}, "manager")).rejects.toThrow(/exige papel owner.*aprovar/i);          // manager não atinge o piso de APROVAR
    expect(await statusOf(org, reg.revision.id)).toBe("DRAFT");
    await expect(available(other, reg.revision.id)).rejects.toThrow(/não encontrad|NOT_FOUND/i);                           // revisão de outro tenant ≡ inexistente
    await available(org, reg.revision.id, {}, "owner");
    expect(await statusOf(org, reg.revision.id)).toBe("PUBLISHED");
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type LIKE 'institutional_template.%'", [other])).toBe(0);
  }, 300_000);

  it("FAST-4 — órgão LEGADO sem política: disponibilizar fica BLOQUEADO pela prontidão (sem bypass), revisão segura em APPROVED; após a política OPTIONAL do órgão (um clique), conclui; Rev1/vínculo intactos", async () => {
    const org = await newOrg("fast4");
    // baseline: Rev1 publicada (com evidência, regime legado) e vinculada — o cenário de produção
    const r1 = await register(org); await markTemplateOrgLegacy(conn, org);
    await new (await import("../../services/institutionalTemplates/governanceService")).TemplateGovernanceService(wports()).recordLegalEvidence(ctxOf(org), { revisionId: r1.revision.id, expectedVersion: 0, confirm: true, idempotencyKey: key("ev"), decision: decision(), evidence: { sourceLogicalVersion: BLL.provenance.sourceLogicalVersion, sourceSha256: BLL.provenance.sourceSha256 } });
    await available(org, r1.revision.id);
    const bound = await wf().setBinding(ctxOf(org), { documentKind: "edital", scope: { ...BLL.declaredScope } as any, identityId: r1.identity.id, pinnedRevisionId: r1.revision.id, confirm: true });
    // Revisão 2 (mesmo conteúdo, sem evidência): bloqueada pelo gate jurídico do órgão legado
    const r2 = await wf().createDraft(ctxOf(org), { identityId: r1.identity.id, fromRevisionId: r1.revision.id });
    await new (await import("../../services/institutionalTemplates/governanceService")).TemplateGovernanceService(wports()).recordImportProvenance(ctxOf(org), { revisionId: r2.id, expectedVersion: 0, confirm: true, idempotencyKey: key("pv2"), decision: decision(), provenance: { templateKey: BLL.modelKey, displayName: BLL.displayName, sourceLogicalVersion: BLL.provenance.sourceLogicalVersion, sourceSha256: BLL.provenance.sourceSha256, sourceFormat: "NATIVE", scope: BLL.declaredScope as any, inventory: summarizePackageInventory(getModelPackage(BLL.modelKey)!) } as any });
    const blockedIds = async () => (((await tpl(org).readiness.evaluate({ revisionId: r2.id })) as any).matrix.checks as any[]).filter((c) => c.status === "BLOCKED").map((c) => c.id);
    expect(await blockedIds()).toEqual(["LEGAL_APPROVAL_EVIDENCE"]);                                                       // só o gate jurídico do regime legado
    await expect(available(org, r2.id)).rejects.toThrow(/PUBLICATION_BLOCKED[\s\S]*LEGAL_APPROVAL_EVIDENCE/);
    expect(await statusOf(org, r2.id)).toBe("APPROVED");                                                                   // estado seguro (aprovada, não disponibilizada)
    expect(await decisionsOf(org, "institutional_template.publication")).toHaveLength(1);                                   // só a da Rev1
    // a autoridade do órgão estabelece OPTIONAL (um clique, sem formulário de ato) ⇒ disponibilizar conclui (só publica: já APPROVED)
    await tpl(org).governance.policy.record({ expectedVersion: 0, confirm: true, idempotencyKey: key("pol"), policy: OPTIONAL } as any);
    await available(org, r2.id, { expectedStatus: "APPROVED" });
    expect(await statusOf(org, r2.id)).toBe("PUBLISHED");
    // Rev1 e vínculo exatamente como estavam
    expect(await statusOf(org, r1.revision.id)).toBe("PUBLISHED");
    expect((await wf().listBindings(ctxOf(org), { documentKind: "edital", activeOnly: true })).map((b) => [b.id, b.pinnedRevisionId])).toEqual([[bound.id, r1.revision.id]]);
  }, 300_000);

  it("FAST-5 — enviar e derivar modelo SEM digitar autoridade/ato: decisões eletrônicas na procedência/ledger; upload com SHA-256 do servidor", async () => {
    const org = await newOrg("fast5");
    const md = "# Termo de Referência\n\nObjeto do termo.\n";
    const up: any = await tpl(org, "operator").registration.register({
      target: { kind: "NEW_IDENTITY", documentKind: "tr", slug: "tr-proprio" }, templateKey: "TR_PROPRIO", displayName: "TR próprio", declaredScope: {},
      source: { kind: "MARKDOWN", markdown: md, filename: "tr.md" }, sourceLogicalVersion: "1.0.0", sourceSha256: sha(md), confirm: true, idempotencyKey: key("up"),
    });
    expect(up.revision.status).toBe("DRAFT"); expect(up.provenance.status).toBe("RECORDED");
    const [p] = await decisionsOf(org, "institutional_template.import_provenance");
    expect(p).toMatchObject({ basis_reference: ELECTRONIC_BASIS, recorded_by_user_id: U_MANAGER, decided_by_role: "Operador do órgão (operator)" });
    await available(org, up.revision.id, { idempotencyKey: key("av") });                                                    // tr não é gateado por readiness: um clique
    const der: any = await tpl(org, "operator").derivation.derive({ source: { kind: "TENANT_REVISION", revisionId: up.revision.id }, slug: "tr-derivado", displayName: "TR derivado", confirm: true, idempotencyKey: key("der") });
    expect(der.revision.status).toBe("DRAFT"); expect(der.origin.ownership).toBe("DERIVED");
    // operator não disponibiliza (piso manager) — o que já protegia continua protegendo
    await expect(available(org, der.revision.id, {}, "operator")).rejects.toThrow();
  }, 300_000);

  it("FAST-6 (M8-UX-GOV-001) — fontes governadas SEM digitar autoridade/cargo/ato: orçamento, TR, itens e Perfil gravados com o usuário autenticado; replay; ato parcial recusado; RBAC; isolamento", async () => {
    const o = BASE_ORG + orgSeq++; ORGS.push(o);
    const w = await seedWorld(conn, o, "fast6", { flagOn: true });
    const gov = (role = "manager") => tpl(o, role).governed;
    const dk = key("disc");
    const disc = (over: Record<string, unknown> = {}, role = "manager") => gov(role).recordBudgetDisclosure({ processId: w.processId, disclosure: "sigiloso", confirm: true, idempotencyKey: dk, expectedRevision: 0, ...over } as any) as Promise<any>;
    const first = await disc();
    expect(first.replayed).toBe(false);
    const [d] = await decisionsOf(o, "procurement.budget_disclosure");
    expect(d).toMatchObject({
      outcome: "sigiloso", decided_by_name: "Usuário Teste", decided_by_role: "Gestor do órgão (manager)", decided_by_user_id: U_MANAGER, recorded_by_user_id: U_MANAGER,
      basis_reference: ELECTRONIC_BASIS, authority_validation: "NOT_VALIDATED_POLICY_PENDING",
    });
    expect(d.reason).toMatch(/^Registro da divulgação do orçamento — registrado eletronicamente/);
    expect(d.correlation_id).toMatch(/^corr-fast-/);
    expect((await disc()).replayed).toBe(true);                                                                              // replay idempotente
    expect(await decisionsOf(o, "procurement.budget_disclosure")).toHaveLength(1);
    // ato PARCIAL é recusado; operator/viewer recusados; outro tenant ≡ processo inexistente — nada gravado
    await expect(disc({ idempotencyKey: key("d2"), expectedRevision: 1, decision: { decidedByName: "Ana" } })).rejects.toThrow();
    for (const role of ["operator", "viewer"]) await expect(disc({ idempotencyKey: key(`d-${role}`), expectedRevision: 1 }, role)).rejects.toThrow();
    const other = await newOrg("fast6b");
    tenant.org = other;
    await expect(tpl(other).governed.recordBudgetDisclosure({ processId: w.processId, disclosure: "publico", confirm: true, idempotencyKey: key("x"), expectedRevision: 0 })).rejects.toThrow(/não encontrad|NOT_FOUND/i);
    expect(await decisionsOf(o, "procurement.budget_disclosure")).toHaveLength(1);
    expect(await decisionsOf(other, "procurement.budget_disclosure")).toHaveLength(0);
    // demais fontes governadas do mesmo processo/órgão, todas sem `decision`
    await gov().recordBudgetBaseDate({ processId: w.processId, catalogVersion: BLL_CATALOG.version, baseDate: E2E_BUDGET_BASE_DATE, confirm: true, idempotencyKey: key("bd"), expectedRevision: 0 });
    await gov().recordProcessFields({ processId: w.processId, source: "TR", catalogVersion: BLL_CATALOG.version, fields: governedFieldsFor("TR"), confirm: true, idempotencyKey: key("tr"), expectedRevision: 1, note: "Conferido com a área demandante." });
    await gov().recordItemsParticipation({ processId: w.processId, catalogVersion: BLL_CATALOG.version, participation: { default: "Ampla participação, com os benefícios da LC nº 123/2006" }, confirm: true, idempotencyKey: key("part"), expectedRevision: 2 });
    await gov().recordLicitacoesProfile({ catalogVersion: BLL_CATALOG.version, platforms: SYNTHETIC_PLATFORMS, confirm: true, idempotencyKey: key("plat"), expectedRevision: 0 });
    const proc = await decisionsOf(o, "procurement.source_fields");
    expect(proc.map((x) => x.reason)).toEqual([
      expect.stringMatching(/^Registro da data-base do orçamento/), "Conferido com a área demandante.", expect.stringMatching(/^Registro do regime de participação dos itens/),
    ]);
    for (const x of [...proc, ...(await decisionsOf(o, "institutional.policy"))]) {
      expect(x).toMatchObject({ basis_reference: ELECTRONIC_BASIS, decided_by_user_id: U_MANAGER, recorded_by_user_id: U_MANAGER, decided_by_role: "Gestor do órgão (manager)" });
    }
    expect((await decisionsOf(o, "institutional.policy")).map((x) => x.reason)).toEqual([expect.stringMatching(/^Registro do Perfil de Licitações do órgão/)]);
  }, 300_000);
});

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Lane A / multi-modelo — FONTES CANÔNICAS e escopo de binding contra MySQL REAL (adapter real, ledger real, nenhum fake).
 * Só roda com DATABASE_URL. Organizações sintéticas (sem dados reais, sem o processo 2026/253, sem modelo real).
 *
 *  S1  ITEMS: só Itens da contratação canônicos (HD-01); sem itens ⇒ falha fechada; quantidade vem da decisão humana; valor só
 *      com orçamento PÚBLICO; processo de outro tenant é indistinguível de inexistente
 *  S2  TR: pin OFICIAL exato (org + documentId + versão + hash); exigido, divergente, rascunho, outro tenant e obsoleto ⇒ falha
 *      fechada; mudança do TR depois do pin ⇒ a autoridade atual produz outro digest (SOURCE_CHANGED)
 *  S3  CERTAME_CONFIG: decisão humana versionada (CAS/idempotência), isolada por tenant e por processo; regime de participação
 *      por item/lote só a partir dela; mudança ⇒ outro digest
 *  S4  POLICY / BUDGET / NORMATIVE / LIFECYCLE / RESULT: cada fonte lê a SUA autoridade, sem mistura; RESULT falha fechada
 *  S5  APROVAÇÃO JURÍDICA: evidência no ledger existente, hash semântico exato, nada inventado, sem alterar a revisão
 *  S6  MULTI-MODELO: a mesma revisão PUBLISHED com bindings exatos por forma/plataforma; resolução exata, cross-tenant e concorrência
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

import { createHash } from "crypto";
import { runMigrations, validateSchema } from "../../bootstrap";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { GovernedSourceService } from "../../services/institutionalTemplates/governedSourceService";
import { createCanonicalReferenceAdapter } from "../../services/institutionalTemplates/adapters/canonicalAdapter";
import { TemplateSourceUnavailableError, type WorkflowContext } from "../../services/institutionalTemplates/ports";
import { createTemplateCompositionPorts, createTemplateWorkflowPorts } from "../../services/institutionalTemplates/integration";
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts, getTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { CERTAME_CONFIG_SCHEMA } from "../../domain/institutionalTemplates";
import { templateHash } from "../../domain/institutionalTemplates/semanticHash";
import { createCanonicalManualItem } from "../helpers/canonicalItems";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
const BASE_ORG = 973_000_000 + STAMP * 10;
const RUN = STAMP.toString(36);
let orgSeq = 0;
let idSeq = 0;
const U_MANAGER = 303;

let conn: mysql.Connection;
const exec = (sql: string, args: unknown[] = []) => conn.execute(sql, args as never);
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const nid = (p: string) => `${p}${RUN}${(idSeq++).toString(36)}`.slice(0, 20);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const err = async (p: Promise<unknown>): Promise<any> => p.then(() => null, (e) => e);
const reasonOf = async (p: Promise<unknown>): Promise<string> => {
  const e = await err(p);
  expect(e, "esperava falha fechada").toBeInstanceOf(TemplateSourceUnavailableError);
  return (e as TemplateSourceUnavailableError).reason;
};

const ORGS: number[] = [];
async function cleanup(): Promise<void> {
  if (ORGS.length === 0) return;
  const q = ORGS.join(",");
  for (const sql of [
    `DELETE FROM institutional_template_events WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_bindings WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_revisions WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_template_identities WHERE organization_id IN (${q})`,
    `DELETE FROM institutional_decisions WHERE organization_id IN (${q})`,
    `DELETE FROM official_documents WHERE tenant_id IN (${q})`,
    `DELETE FROM procurement_items WHERE organization_id IN (${q})`,
    `DELETE FROM procurement_processes WHERE organization_id IN (${q})`,
  ]) await conn.query(sql).catch(() => { /* best-effort */ });
}

const decision = (over: Record<string, unknown> = {}) => ({
  decidedByName: "Maria Souza", decidedByRole: "Procuradora-Geral", decidedAt: "2026-10-06",
  basisReference: "Portaria 12/2026", reason: "Conferido pela assessoria jurídica.", ...over,
});
const ctxOf = (org: number, userId = U_MANAGER, kind: "human" | "ai" = "human"): WorkflowContext =>
  ({ organizationId: org, actor: { kind, userId } as any, correlationId: `corr-${org}-${userId}` });
const act = (key: string, over: Record<string, unknown> = {}) => ({ confirm: true, idempotencyKey: `idem-${key}-${RUN}`, decision: decision(), ...over });

async function seedOrg(label: string): Promise<{ org: number; processId: string }> {
  const org = BASE_ORG + orgSeq++;
  ORGS.push(org);
  await exec("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [org, `Prefeitura Sintética ${label}`, `tpl-src-${RUN}-${org}`]);
  const processId = `ps${RUN}${org % 100000}`.slice(0, 20);
  await exec(
    "INSERT INTO procurement_processes (id, organization_id, process_number, object, modality, current_stage, status, responsible_user, created_at, updated_at) VALUES (?, ?, ?, ?, 'pregao', 'TR', 'rascunho', ?, NOW(), NOW())",
    [processId, org, `2026/${org % 10000}`, "Aquisição sintética de material de expediente", U_MANAGER]);
  return { org, processId };
}

async function insertOfficial(org: number, processId: string, over: { id?: string; version: number; status?: string; content: string; type?: string; lineage?: string }): Promise<{ id: string; hash: string }> {
  const id = over.id ?? nid("od");
  await exec(
    `INSERT INTO official_documents (id, tenant_id, business_domain, document_type, origin, title, version, status, content, lineage_id, replay_hash, storage_key, mime_type, size_bytes, content_hash)
     VALUES (?, ?, 'processo_licitatorio', ?, ?, 'Termo de Referência sintético', ?, ?, ?, ?, ?, '', '', 0, '')`,
    [id, org, over.type ?? "tr", processId, over.version, over.status ?? "emitido", over.content, over.lineage ?? `ln${id}`.slice(0, 20), `rh-${id}`]);
  return { id, hash: sha(over.content) };
}

describe.skipIf(!DB)("Lane A multi-modelo — fontes canônicas e escopo (MySQL real, adapter real)", () => {
  const adapter = createCanonicalReferenceAdapter();
  const gov = new GovernedSourceService();

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
  }, 300_000);

  afterAll(async () => {
    if (conn) { await cleanup().catch(() => {}); await conn.end(); }
  }, 60_000);

  it("S1 — ITEMS: somente Itens da contratação canônicos; sem itens ⇒ falha fechada; valor só com orçamento público; cross-tenant impossível", async () => {
    const A = await seedOrg("itens-a"), B = await seedOrg("itens-b");
    // sem Itens canônicos: nada é montado a partir de cotação/manual/IA
    expect(await reasonOf(adapter.resolveSources(A.org, A.processId, ["ITEMS"]))).toBe("CANONICAL_ITEMS_REQUIRED");

    await createCanonicalManualItem({ organizationId: A.org, processId: A.processId, actorUserId: U_MANAGER, description: "Papel A4 75g", unit: "resma", plannedQuantity: "120" });
    const first = (await adapter.resolveSources(A.org, A.processId, ["ITEMS"])).ITEMS!;
    expect(first.organizationId).toBe(A.org);
    const d = first.data as any;
    expect(d.itemCount).toBe(1);
    expect(d.items[0]).toMatchObject({ description: "Papel A4 75g", unit: "resma", quantity: 120, ordinal: 1, lotCode: null });
    // valores NUNCA por omissão: sem decisão pública do orçamento não há preço
    expect(d.valuesDisclosed).toBe(false);
    expect(d.items[0]).not.toHaveProperty("unitReferencePriceCents");
    expect(d.items[0]).not.toHaveProperty("estimatedTotalCents");
    expect(d).not.toHaveProperty("estimatedTotalCents");
    expect(d.quadroLinhas[0]).toContain("Quantidade: 120");
    expect(d.quadroLinhas[0]).not.toMatch(/R\$/);

    // orçamento sigiloso ⇒ continua sem valores
    await gov.recordBudgetDisclosure(ctxOf(A.org), { ...act("bd1"), processId: A.processId, disclosure: "sigiloso", expectedRevision: 0 });
    expect(((await adapter.resolveSources(A.org, A.processId, ["ITEMS"])).ITEMS!.data as any).valuesDisclosed).toBe(false);

    // cross-tenant: o processo de A não existe para B (sem oráculo) e vice-versa
    expect(await reasonOf(adapter.resolveSources(B.org, A.processId, ["ITEMS"]))).toBe("PROCESS_NOT_FOUND");
    expect(await reasonOf(adapter.resolveSources(A.org, B.processId, ["ITEMS"]))).toBe("PROCESS_NOT_FOUND");
    // determinismo: a mesma leitura repetida produz o mesmo digest
    const again = (await adapter.resolveSources(A.org, A.processId, ["ITEMS"])).ITEMS!;
    expect(templateHash(again.data)).toBe(templateHash(first.data));
  }, 120_000);

  it("S2 — TR: pin oficial EXATO (org+id+versão+hash); exigido/divergente/rascunho/outro tenant/obsoleto ⇒ falha; mudança do TR ⇒ novo digest", async () => {
    const A = await seedOrg("tr-a"), B = await seedOrg("tr-b");
    const v1 = await insertOfficial(A.org, A.processId, { version: 1, content: "TR v1 — conteúdo sintético", lineage: "lnTR" + RUN });
    const req = (o: Partial<{ documentId: string; version: number; contentHash: string }> = {}) =>
      ({ TR: { documentId: v1.id, version: 1, contentHash: v1.hash, ...o } });

    // pin exato ⇒ OK e carrega org + id + versão + hash
    const pinned = (await adapter.pinOfficialDocuments(A.org, A.processId, ["TR"], req())).TR!;
    expect(pinned).toMatchObject({ organizationId: A.org, documentId: v1.id, version: 1, contentHash: v1.hash });

    // exigido: o servidor nunca escolhe "o último"
    expect(await reasonOf(adapter.pinOfficialDocuments(A.org, A.processId, ["TR"], {}))).toBe("OFFICIAL_PIN_REQUIRED");
    // versão/hash divergentes
    expect(await reasonOf(adapter.pinOfficialDocuments(A.org, A.processId, ["TR"], req({ version: 2 })))).toBe("OFFICIAL_PIN_MISMATCH");
    expect(await reasonOf(adapter.pinOfficialDocuments(A.org, A.processId, ["TR"], req({ contentHash: sha("outro") })))).toBe("OFFICIAL_PIN_MISMATCH");
    // documento inexistente / de OUTRO tenant / de outro processo / de outro tipo: indistinguíveis de "não encontrado"
    expect(await reasonOf(adapter.pinOfficialDocuments(A.org, A.processId, ["TR"], req({ documentId: "inexistente" })))).toBe("OFFICIAL_PIN_NOT_FOUND");
    expect(await reasonOf(adapter.pinOfficialDocuments(B.org, B.processId, ["TR"], req()))).toBe("OFFICIAL_PIN_NOT_FOUND");
    expect(await reasonOf(adapter.pinOfficialDocuments(A.org, B.processId, ["TR"], req()))).toBe("OFFICIAL_PIN_NOT_FOUND");
    const etp = await insertOfficial(A.org, A.processId, { version: 1, content: "ETP", type: "etp" });
    expect(await reasonOf(adapter.pinOfficialDocuments(A.org, A.processId, ["TR"], req({ documentId: etp.id, contentHash: etp.hash })))).toBe("OFFICIAL_PIN_NOT_FOUND");
    // rascunho/não emitido nunca é pinável
    const draft = await insertOfficial(A.org, A.processId, { version: 2, status: "gerado", content: "TR rascunho" });
    expect(await reasonOf(adapter.pinOfficialDocuments(A.org, A.processId, ["TR"], req({ documentId: draft.id, version: 2, contentHash: draft.hash })))).toBe("OFFICIAL_PIN_NOT_FOUND");
    // kind sem backing de pin (ex.: ANNEX) ⇒ falha fechada
    expect(await reasonOf(adapter.pinOfficialDocuments(A.org, A.processId, ["ANNEX" as never], {}))).toBe("UNSUPPORTED_KIND");

    // autoridade ATUAL (revalidação) antes e depois de uma NOVA versão emitida do TR
    const current1 = (await adapter.resolveOfficialDocuments(A.org, A.processId, ["TR"])).TR!;
    expect(current1).toMatchObject({ documentId: v1.id, version: 1, contentHash: v1.hash });
    const v2 = await insertOfficial(A.org, A.processId, { version: 2, content: "TR v2 — alterado depois do M1", lineage: "lnTR" + RUN });
    const current2 = (await adapter.resolveOfficialDocuments(A.org, A.processId, ["TR"])).TR!;
    expect(current2).toMatchObject({ documentId: v2.id, version: 2, contentHash: v2.hash });
    expect(current2.contentHash).not.toBe(pinned.contentHash);              // base do SOURCE_CHANGED: o pin do M1 ≠ a autoridade atual
    // o pin da v1 agora é OBSOLETO (existe versão mais recente) — nunca é aceito como "o vigente"
    expect(await reasonOf(adapter.pinOfficialDocuments(A.org, A.processId, ["TR"], req()))).toBe("OFFICIAL_PIN_STALE");
    // pin da versão vigente ⇒ OK
    expect((await adapter.pinOfficialDocuments(A.org, A.processId, ["TR"], req({ documentId: v2.id, version: 2, contentHash: v2.hash }))).TR!.documentId).toBe(v2.id);
    // tenant B nunca enxerga o TR de A
    expect((await adapter.resolveOfficialDocuments(B.org, A.processId, ["TR"])).TR).toBeUndefined();
  }, 120_000);

  it("S3 — CERTAME_CONFIG: decisão humana versionada (CAS/idempotência), isolada por tenant/processo; participação só a partir dela", async () => {
    const A = await seedOrg("certame-a"), B = await seedOrg("certame-b");
    const config = {
      schema: CERTAME_CONFIG_SCHEMA, disputeMode: "aberto", decimalPlaces: 2, minimumBidInterval: { kind: "AMOUNT_CENTS", value: 50 },
      stageDurationMinutes: 10, extensionRule: "automatica", extensionMinutes: 2,
      schedule: { abertura: { date: "2026-11-05", time: "09:00" }, disputa: { date: "2026-11-05", time: "10:00" } },
      operationalWindows: [{ key: "manha", startTime: "08:00", endTime: "12:00" }],
      participation: { default: "ampla" },
    };
    // sem decisão ⇒ a fonte simplesmente não existe (o composer falha se o modelo exigir)
    expect((await adapter.resolveSources(A.org, A.processId, ["CERTAME_CONFIG"])).CERTAME_CONFIG).toBeUndefined();

    // governança: só pessoa; confirmação explícita; contrato fechado
    expect((await err(gov.recordCertameConfig(ctxOf(A.org, 9, "ai"), { ...act("c0"), processId: A.processId, config, expectedRevision: 0 })))?.message).toMatch(/humano|human|IA|ator/i);
    expect((await err(gov.recordCertameConfig(ctxOf(A.org), { ...act("c0b", { confirm: false }), processId: A.processId, config, expectedRevision: 0 })))?.code).toBe("CONFIRMATION_REQUIRED");
    expect((await err(gov.recordCertameConfig(ctxOf(A.org), { ...act("c0c"), processId: A.processId, config: { ...config, loginPlataforma: "x" }, expectedRevision: 0 })))?.code).toBe("VALIDATION_FAILED");
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'procurement.certame_config'", [A.org])).toBe(0);

    const r1 = await gov.recordCertameConfig(ctxOf(A.org), { ...act("c1"), processId: A.processId, config, expectedRevision: 0 });
    expect(r1.replayed).toBe(false);
    // replay (mesma chave) ⇒ mesma decisão, sem duplicar
    const r1b = await gov.recordCertameConfig(ctxOf(A.org), { ...act("c1"), processId: A.processId, config, expectedRevision: 0 });
    expect(r1b.replayed).toBe(true);
    expect(r1b.decision.id).toBe(r1.decision.id);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'procurement.certame_config'", [A.org])).toBe(1);
    // CAS: revisão desatualizada é recusada
    expect(await err(gov.recordCertameConfig(ctxOf(A.org), { ...act("c1x"), processId: A.processId, config: { ...config, decimalPlaces: 3 }, expectedRevision: 0 }))).not.toBeNull();

    const s1 = (await adapter.resolveSources(A.org, A.processId, ["CERTAME_CONFIG"])).CERTAME_CONFIG!;
    expect(s1.organizationId).toBe(A.org);
    expect(s1.data).toMatchObject({ disputeMode: "aberto", decimalPlaces: 2, stageDurationMinutes: 10 });
    expect((s1.data as any).operationalWindowLines).toEqual(["manha: 08:00–12:00"]);
    // ISOLAMENTO: outro tenant e outro processo do mesmo tenant não enxergam a configuração
    expect((await adapter.resolveSources(B.org, A.processId, ["CERTAME_CONFIG"])).CERTAME_CONFIG).toBeUndefined();
    expect((await adapter.resolveSources(B.org, B.processId, ["CERTAME_CONFIG"])).CERTAME_CONFIG).toBeUndefined();
    const other = `${A.processId}x`.slice(0, 20);
    expect((await adapter.resolveSources(A.org, other, ["CERTAME_CONFIG"])).CERTAME_CONFIG).toBeUndefined();

    // participação: aparece nos ITEMS só porque a decisão humana a declarou (nunca inferida)
    await createCanonicalManualItem({ organizationId: A.org, processId: A.processId, actorUserId: U_MANAGER, description: "Caneta azul", unit: "un", plannedQuantity: "10" });
    expect(((await adapter.resolveSources(A.org, A.processId, ["ITEMS"])).ITEMS!.data as any).items[0].participationRegime).toBe("ampla");

    // nova revisão (CAS ok) ⇒ outro digest da fonte (SOURCE_CHANGED na revalidação)
    await gov.recordCertameConfig(ctxOf(A.org), { ...act("c2"), processId: A.processId, config: { ...config, decimalPlaces: 3 }, expectedRevision: 1 });
    const s2 = (await adapter.resolveSources(A.org, A.processId, ["CERTAME_CONFIG"])).CERTAME_CONFIG!;
    expect(templateHash(s2.data)).not.toBe(templateHash(s1.data));
    expect((s2.data as any).decimalPlaces).toBe(3);
    // integridade: evidência adulterada no ledger ⇒ falha fechada (nunca usa payload sem verificação)
    const tampered = await exec("UPDATE institutional_decisions SET evidence = ? WHERE organization_id = ? AND subject_type = 'procurement.certame_config'",
      [JSON.stringify(["schema:certame-config/1", 'payload:{"schema":"certame-config/1","decimalPlaces":1}', `hash:${"0".repeat(64)}`]), A.org]).then(() => true, () => false);
    if (tampered) expect(await reasonOf(adapter.resolveSources(A.org, A.processId, ["CERTAME_CONFIG"]))).toBe("EVIDENCE_CORRUPT");
    else expect(((await adapter.resolveSources(A.org, A.processId, ["CERTAME_CONFIG"])).CERTAME_CONFIG!.data as any).decimalPlaces).toBe(3);   // ledger imutável: nada a adulterar
  }, 120_000);

  it("S4 — POLICY / BUDGET / NORMATIVE / LIFECYCLE / RESULT: cada fonte lê a SUA autoridade; RESULT falha fechada", async () => {
    const A = await seedOrg("fontes-a"), B = await seedOrg("fontes-b");
    // POLICY: por órgão; separada de fato do processo e de normativo
    expect((await adapter.resolveSources(A.org, A.processId, ["POLICY"])).POLICY).toBeUndefined();
    expect((await err(gov.recordPolicy(ctxOf(A.org), { ...act("p0"), policyKey: "Chave Inválida", payload: { a: 1 }, expectedRevision: 0 })))?.code).toBe("VALIDATION_FAILED");
    expect((await err(gov.recordPolicy(ctxOf(A.org), { ...act("p0b"), policyKey: "garantia", payload: { aninhado: { x: 1 } }, expectedRevision: 0 })))?.code).toBe("VALIDATION_FAILED");
    await gov.recordPolicy(ctxOf(A.org), { ...act("p1"), policyKey: "garantia", payload: { exige_garantia: true, percentual: 5 }, expectedRevision: 0 });
    const pol = (await adapter.resolveSources(A.org, A.processId, ["POLICY"])).POLICY!;
    expect(pol.data).toEqual({ garantia: { exige_garantia: true, percentual: 5 } });
    expect((await adapter.resolveSources(B.org, B.processId, ["POLICY"])).POLICY).toBeUndefined();   // cross-tenant

    // BUDGET: divulgação é decisão; sigiloso nunca expõe valor; sem decisão ⇒ fonte ausente
    expect((await adapter.resolveSources(A.org, A.processId, ["BUDGET"])).BUDGET).toBeUndefined();
    expect((await err(gov.recordBudgetDisclosure(ctxOf(A.org), { ...act("b0"), processId: A.processId, disclosure: "talvez" as never, expectedRevision: 0 })))?.code).toBe("VALIDATION_FAILED");
    await gov.recordBudgetDisclosure(ctxOf(A.org), { ...act("b1"), processId: A.processId, disclosure: "sigiloso", expectedRevision: 0 });
    expect((await adapter.resolveSources(A.org, A.processId, ["BUDGET"])).BUDGET!.data).toEqual({ disclosure: "sigiloso" });
    await gov.recordBudgetDisclosure(ctxOf(A.org), { ...act("b2"), processId: A.processId, disclosure: "publico", expectedRevision: 1 });
    expect((await adapter.resolveSources(A.org, A.processId, ["BUDGET"])).BUDGET!.data).toMatchObject({ disclosure: "publico" });
    expect((await adapter.resolveSources(B.org, A.processId, ["BUDGET"])).BUDGET).toBeUndefined();

    // LIFECYCLE: projeção do ciclo do processo da PRÓPRIA organização
    const life = (await adapter.resolveSources(A.org, A.processId, ["LIFECYCLE"])).LIFECYCLE;
    if (life) expect(life.organizationId).toBe(A.org);
    expect((await adapter.resolveSources(B.org, A.processId, ["LIFECYCLE"])).LIFECYCLE).toBeUndefined();

    // NORMATIVE: sem reference set governado verificado ⇒ falha fechada (nunca texto livre) OU snapshot do set verificado
    const norm = await adapter.resolveSources(A.org, A.processId, ["NORMATIVE"]).then((r) => ({ ok: true as const, r }), (e) => ({ ok: false as const, e }));
    if (norm.ok) expect(norm.r.NORMATIVE!.organizationId).toBe(A.org);
    else expect(norm.e).toBeInstanceOf(TemplateSourceUnavailableError);

    // RESULT: sem autoridade — documento pré-certame não tem resultado ⇒ falha fechada
    expect(await err(adapter.resolveSources(A.org, A.processId, ["RESULT"]))).toBeInstanceOf(TemplateSourceUnavailableError);
    // fonte fora do contrato ⇒ falha fechada (nunca omitida em silêncio)
    expect(await err(adapter.resolveSources(A.org, A.processId, ["INEXISTENTE" as never]))).toBeInstanceOf(TemplateSourceUnavailableError);
  }, 120_000);

  async function publishedModel(org: number, label: string, ast?: unknown) {
    const wf = new InstitutionalTemplatesWorkflow(getTemplateWorkflowPorts());
    const ctx = ctxOf(org);
    const identity = await wf.createIdentity(ctx, { documentKind: "edital", slug: `ed-${label}-${org}`, displayName: `Edital ${label}` } as any);
    const draft = await wf.createDraft(ctx, { identityId: identity.id, ast: ast ?? { schema: "tpl-ast/1", root: [{ t: "paragraph", inline: [{ t: "text", v: "Edital sintético" }] }] } } as any);
    await wf.approve(ctx, { revisionId: draft.id, expectedStatus: "DRAFT", confirm: true, idempotencyKey: `ap-${label}-${org}-${RUN}`, decision: decision() });
    await wf.publish(ctx, { revisionId: draft.id, expectedStatus: "APPROVED", confirm: true, idempotencyKey: `pb-${label}-${org}-${RUN}`, decision: decision({ basisReference: "Portaria 13/2026" }) });
    return { wf, ctx, identity, revisionId: draft.id as string };
  }

  it("S5 — APROVAÇÃO JURÍDICA: evidência no ledger existente, hash semântico exato; nada inventado; a revisão não muda", async () => {
    const A = await seedOrg("juridico-a"), B = await seedOrg("juridico-b");
    const m = await publishedModel(A.org, "jur");
    const rev = (await rows("SELECT semantic_hash h, status s FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [A.org, m.revisionId]))[0];
    const before = JSON.stringify(await rows("SELECT * FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [A.org, m.revisionId]));
    expect(await gov.getLegalApprovalEvidence(A.org, m.revisionId)).toBeNull();           // sem ato ⇒ sem evidência (nada inventado)

    // hash errado ⇒ recusa; IA ⇒ recusa; sem confirmação ⇒ recusa; outro tenant ⇒ não encontra
    const base = { revisionId: m.revisionId, outcome: "aprovado" as const, expectedRevision: 0 };
    expect((await err(gov.recordLegalApproval(m.ctx, { ...act("j0"), ...base, semanticHash: "0".repeat(64) })))?.code).toBe("VALIDATION_FAILED");
    expect(await err(gov.recordLegalApproval(ctxOf(A.org, 9, "ai"), { ...act("j0b"), ...base, semanticHash: rev.h }))).not.toBeNull();
    expect((await err(gov.recordLegalApproval(m.ctx, { ...act("j0c", { confirm: false }), ...base, semanticHash: rev.h })))?.code).toBe("CONFIRMATION_REQUIRED");
    expect((await err(gov.recordLegalApproval(ctxOf(B.org), { ...act("j0d"), ...base, semanticHash: rev.h })))?.code).toBe("NOT_FOUND");
    expect(await gov.getLegalApprovalEvidence(A.org, m.revisionId)).toBeNull();

    // o parecer/protocolo/data vêm da PESSOA (basisReference/decidedAt); o sistema só guarda
    const r = await gov.recordLegalApproval(m.ctx, { ...act("j1", { decision: decision({ basisReference: "Parecer jurídico nº [preencher no piloto]", decidedAt: "2026-10-07" }) }), ...base, semanticHash: rev.h });
    expect(r.replayed).toBe(false);
    expect((await gov.recordLegalApproval(m.ctx, { ...act("j1", { decision: decision({ basisReference: "Parecer jurídico nº [preencher no piloto]", decidedAt: "2026-10-07" }) }), ...base, semanticHash: rev.h })).replayed).toBe(true);
    const ev = (await gov.getLegalApprovalEvidence(A.org, m.revisionId))!;
    expect(ev.matchesRevision).toBe(true);
    expect(ev.approvedSemanticHash).toBe(rev.h);
    expect(ev.decision).toMatchObject({ decisionType: "template_legal_approval", subjectType: "institutional_template.legal_approval", outcome: "aprovado", authorityValidation: "NOT_VALIDATED_POLICY_PENDING" });
    expect(ev.decision.basisReference).toBe("Parecer jurídico nº [preencher no piloto]");
    // isolamento + sem segundo ledger + revisão intacta
    expect(await gov.getLegalApprovalEvidence(B.org, m.revisionId)).toBeNull();
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND decision_type = 'template_legal_approval'", [A.org])).toBe(1);
    expect(JSON.stringify(await rows("SELECT * FROM institutional_template_revisions WHERE organization_id = ? AND id = ?", [A.org, m.revisionId]))).toBe(before);
    // a decisão jurídica é DISTINTA das de aprovação/publicação do lifecycle
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_id = ?", [A.org, m.revisionId])).toBeGreaterThanOrEqual(3);
    // reprovação posterior (CAS) vira a evidência corrente
    await gov.recordLegalApproval(m.ctx, { ...act("j2"), ...base, outcome: "reprovado", expectedRevision: 1, semanticHash: rev.h });
    expect((await gov.getLegalApprovalEvidence(A.org, m.revisionId))!.decision.outcome).toBe("reprovado");
  }, 120_000);

  it("S6 — MULTI-MODELO: mesma revisão PUBLISHED com bindings exatos por forma/plataforma; resolução exata; cross-tenant; concorrência", async () => {
    const A = await seedOrg("multi-a"), B = await seedOrg("multi-b");
    const m = await publishedModel(A.org, "multi");
    const bind = (scope: Record<string, string>) => m.wf.setBinding(m.ctx, {
      documentKind: "edital", scope, identityId: m.identity.id, pinnedRevisionId: m.revisionId, effectiveFrom: "2026-01-01T00:00:00Z", confirm: true,
    } as any);
    const bBll = await bind({ modality: "pregao", form: "eletronico", platform: "bll" });
    const bLic = await bind({ modality: "pregao", form: "eletronico", platform: "licitanet" });
    const bPre = await bind({ modality: "pregao", form: "presencial" });
    expect(new Set([bBll.id, bLic.id, bPre.id]).size).toBe(3);
    // mesmo escopo exato SEM substituição explícita ⇒ recusado (nunca dois ativos, nunca desempate silencioso)
    expect((await err(bind({ modality: "pregao", form: "eletronico", platform: "bll" })))?.code).toBe("BINDING_AMBIGUOUS");
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ? AND active = 1", [A.org])).toBe(3);
    // substituição EXPLÍCITA e atômica do binding anterior
    const bBll2 = await m.wf.setBinding(m.ctx, {
      documentKind: "edital", scope: { modality: "pregao", form: "eletronico", platform: "bll" }, identityId: m.identity.id, pinnedRevisionId: m.revisionId,
      effectiveFrom: "2026-01-01T00:00:00Z", confirm: true, replacesBindingId: bBll.id,
    } as any);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ? AND active = 1", [A.org])).toBe(3);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ? AND scope_form = 'eletronico' AND scope_platform = 'bll' AND active = 1", [A.org])).toBe(1);
    expect(bBll2.id).not.toBe(bBll.id);

    const ports = getTemplateWorkflowPorts();
    const list = await ports.repository.listBindings(A.org);
    const active = list.filter((b) => b.active);
    expect(active.map((b) => [b.scope.form ?? null, b.scope.platform ?? null]).sort()).toEqual([["eletronico", "bll"], ["eletronico", "licitanet"], ["presencial", null]].sort());
    // todos fixam a MESMA revisão exata (nunca "a última")
    expect(new Set(active.map((b) => b.pinnedRevisionId))).toEqual(new Set([m.revisionId]));

    // escopo inválido: nada é gravado, nada é normalizado por aproximação
    for (const scope of [{ platform: "BLL" }, { platform: "a b" }, { form: "" }, { form: "a|b" }]) {
      expect(await err(bind(scope as any)), JSON.stringify(scope)).not.toBeNull();
    }
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ?", [A.org])).toBe(4);

    // cross-tenant adversarial: B não vê, não referencia e não resolve nada de A
    expect((await ports.repository.listBindings(B.org)).length).toBe(0);
    const wfB = new InstitutionalTemplatesWorkflow(ports);
    expect(await err(wfB.setBinding(ctxOf(B.org), {
      documentKind: "edital", scope: { modality: "pregao", form: "eletronico", platform: "bll" }, identityId: m.identity.id, pinnedRevisionId: m.revisionId,
      effectiveFrom: "2026-01-01T00:00:00Z", confirm: true,
    } as any))).not.toBeNull();
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ?", [B.org])).toBe(0);

    // concorrência: N pedidos simultâneos do MESMO escopo ⇒ exatamente um ativo; estado final determinístico
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => bind({ modality: "pregao", form: "eletronico", platform: "concorrente" })));
    expect(results.some((r) => r.status === "fulfilled")).toBe(true);
    expect(await count("SELECT COUNT(*) n FROM institutional_template_bindings WHERE organization_id = ? AND scope_platform = 'concorrente' AND active = 1", [A.org])).toBe(1);
    // rótulo de apresentação persistido na identidade (criação), sem efeito em regra/escopo
    expect((await rows("SELECT display_name d FROM institutional_template_identities WHERE organization_id = ? AND id = ?", [A.org, m.identity.id]))[0].d).toBe("Edital multi");
  }, 180_000);
});

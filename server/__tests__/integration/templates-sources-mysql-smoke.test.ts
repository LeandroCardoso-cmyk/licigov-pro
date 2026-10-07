/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Lane A / multi-modelo — FONTES CANÔNICAS e escopo de binding contra MySQL REAL (adapter real, ledger real, nenhum fake).
 * Só roda com DATABASE_URL. Organizações sintéticas (sem dados reais, sem o processo 2026/253, sem modelo real).
 *
 *  S1  ITEMS: só Itens da contratação canônicos (HD-01); sem itens ⇒ falha fechada; quantidade vem da decisão humana; valor só
 *      com orçamento PÚBLICO; processo de outro tenant é indistinguível de inexistente
 *  S2  TR: pin OFICIAL exato (org + documentId + versão + hash); exigido, divergente, rascunho, outro tenant e obsoleto ⇒ falha
 *      fechada; mudança do TR depois do pin ⇒ a autoridade atual produz outro digest (SOURCE_CHANGED)
 *  S3  CAMPOS GOVERNADOS (CERTAME_CONFIG/POLICY/…): decisão humana versionada (CAS/idempotência) validada contra o catálogo,
 *      isolada por tenant e por processo; caminhos de autoridade canônica recusados; mudança ⇒ outro digest
 *  S4  POLICY / BUDGET / NORMATIVE / LIFECYCLE / RESULT: cada fonte lê a SUA autoridade, sem mistura; RESULT nunca inventada
 *  (aprovação jurídica e multi-modelo/bindings: cobertos por templates-edital-bll-e2e / persistence / 0317)
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
import { GovernedSourceService } from "../../services/institutionalTemplates/governedSourceService";
import { createCanonicalReferenceAdapter } from "../../services/institutionalTemplates/adapters/canonicalAdapter";
import { TemplateSourceUnavailableError, type WorkflowContext } from "../../services/institutionalTemplates/ports";
import { createTemplateCompositionPorts, createTemplateWorkflowPorts } from "../../services/institutionalTemplates/integration";
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { templateHash } from "../../domain/institutionalTemplates/semanticHash";
import { createVariableCatalogPort } from "../../services/institutionalTemplates/catalogRegistry";
import { BLL_CATALOG, governedFieldsFor, E2E_SCENARIO } from "../helpers/institutionalTemplatesE2eWorld";
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

const at = (o: unknown, path: string): unknown => path.split(".").reduce<any>((a, k) => (a == null ? a : a[k]), o);
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
  const gov = new GovernedSourceService(createVariableCatalogPort());

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
    expect(await reasonOf(adapter.resolveSources(A.org, A.processId, ["ITEMS"], BLL_CATALOG))).toBe("CANONICAL_ITEMS_REQUIRED");

    await createCanonicalManualItem({ organizationId: A.org, processId: A.processId, actorUserId: U_MANAGER, description: "Papel A4 75g", unit: "resma", plannedQuantity: "120" });
    const first = (await adapter.resolveSources(A.org, A.processId, ["ITEMS"], BLL_CATALOG)).ITEMS!;
    expect(first.organizationId).toBe(A.org);
    const rowsOut = (first.data as any).quadroItensContratacao as any[];
    expect(rowsOut).toHaveLength(1);
    expect(rowsOut[0]).toMatchObject({ item: "1", descricao: "Papel A4 75g", unidade: "resma", quantidade: 120 });
    // valores NUNCA por omissão: sem decisão pública do orçamento não há preço (as chaves nem existem)
    expect(rowsOut[0]).not.toHaveProperty("valorUnitarioEstimado");
    expect(rowsOut[0]).not.toHaveProperty("valorTotalEstimado");

    // orçamento sigiloso ⇒ continua sem valores
    await gov.recordBudgetDisclosure(ctxOf(A.org), { ...act("bd1"), processId: A.processId, disclosure: "sigiloso", expectedRevision: 0 });
    const sig = (await adapter.resolveSources(A.org, A.processId, ["ITEMS"], BLL_CATALOG)).ITEMS!.data as any;
    expect(JSON.stringify(sig)).not.toMatch(/valorUnitarioEstimado|valorTotalEstimado/);

    // cross-tenant: o processo de A não existe para B (sem oráculo) e vice-versa
    expect(await reasonOf(adapter.resolveSources(B.org, A.processId, ["ITEMS"], BLL_CATALOG))).toBe("PROCESS_NOT_FOUND");
    expect(await reasonOf(adapter.resolveSources(A.org, B.processId, ["ITEMS"], BLL_CATALOG))).toBe("PROCESS_NOT_FOUND");
    // determinismo: a mesma leitura repetida produz o mesmo digest
    const again = (await adapter.resolveSources(A.org, A.processId, ["ITEMS"], BLL_CATALOG)).ITEMS!;
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

  it("S3 — CAMPOS GOVERNADOS: decisão humana versionada (CAS/idempotência), validada pelo catálogo, isolada por tenant/processo", async () => {
    const A = await seedOrg("cert-a"), B = await seedOrg("cert-b");
    const fields = governedFieldsFor("CERTAME_CONFIG", E2E_SCENARIO);
    expect(Object.keys(fields).length).toBeGreaterThan(0);
    const base = { catalogVersion: BLL_CATALOG.version, source: "CERTAME_CONFIG" as const, processId: A.processId, fields };
    // sem decisão ⇒ a fonte não existe (o composer falha se o modelo exigir)
    expect((await adapter.resolveSources(A.org, A.processId, ["CERTAME_CONFIG"], BLL_CATALOG)).CERTAME_CONFIG).toBeUndefined();

    // governança: só pessoa; confirmação explícita; contrato fechado do catálogo; autoridade canônica não é digitável
    expect((await err(gov.recordProcessFields(ctxOf(A.org, 9, "ai"), { ...act("c0"), ...base, expectedRevision: 0 })))).not.toBeNull();
    expect((await err(gov.recordProcessFields(ctxOf(A.org), { ...act("c0b", { confirm: false }), ...base, expectedRevision: 0 })))?.code).toBe("CONFIRMATION_REQUIRED");
    expect((await err(gov.recordProcessFields(ctxOf(A.org), { ...act("c0c"), ...base, fields: { campoInexistente: "x" }, expectedRevision: 0 })))?.code).toBe("VALIDATION_FAILED");
    expect((await err(gov.recordProcessFields(ctxOf(A.org), { ...act("c0d"), ...base, source: "PROCESS", fields: { numeroProcesso: "999/2099" }, expectedRevision: 0 })))?.code).toBe("VALIDATION_FAILED");
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'procurement.source_fields'", [A.org])).toBe(0);

    const r1 = await gov.recordProcessFields(ctxOf(A.org), { ...act("c1"), ...base, expectedRevision: 0 });
    expect(r1.replayed).toBe(false);
    const r1b = await gov.recordProcessFields(ctxOf(A.org), { ...act("c1"), ...base, expectedRevision: 0 });   // replay (mesma chave)
    expect(r1b.replayed).toBe(true);
    expect(r1b.decision.id).toBe(r1.decision.id);
    expect(await count("SELECT COUNT(*) n FROM institutional_decisions WHERE organization_id = ? AND subject_type = 'procurement.source_fields'", [A.org])).toBe(1);
    // CAS: revisão desatualizada é recusada
    expect(await err(gov.recordProcessFields(ctxOf(A.org), { ...act("c1x"), ...base, expectedRevision: 0 }))).not.toBeNull();

    const s1 = (await adapter.resolveSources(A.org, A.processId, ["CERTAME_CONFIG"], BLL_CATALOG)).CERTAME_CONFIG!;
    expect(s1.organizationId).toBe(A.org);
    for (const [k, v] of Object.entries(fields)) expect(at(s1.data, k)).toEqual(v);
    // ISOLAMENTO: outro tenant e outro processo do mesmo tenant não enxergam a configuração
    expect((await adapter.resolveSources(B.org, A.processId, ["CERTAME_CONFIG"], BLL_CATALOG)).CERTAME_CONFIG).toBeUndefined();
    expect((await adapter.resolveSources(B.org, B.processId, ["CERTAME_CONFIG"], BLL_CATALOG)).CERTAME_CONFIG).toBeUndefined();
    expect((await adapter.resolveSources(A.org, `${A.processId}x`.slice(0, 20), ["CERTAME_CONFIG"], BLL_CATALOG)).CERTAME_CONFIG).toBeUndefined();

    // nova revisão (CAS ok) com outro valor ⇒ outro digest (SOURCE_CHANGED na revalidação)
    const [k0, v0] = Object.entries(fields)[0];
    const changed = { ...fields, [k0]: typeof v0 === "boolean" ? !v0 : typeof v0 === "number" ? v0 + 1 : v0 };
    if (JSON.stringify(changed) !== JSON.stringify(fields)) {
      await gov.recordProcessFields(ctxOf(A.org), { ...act("c2"), ...base, fields: changed, expectedRevision: 1 });
      const s2 = (await adapter.resolveSources(A.org, A.processId, ["CERTAME_CONFIG"], BLL_CATALOG)).CERTAME_CONFIG!;
      expect(templateHash(s2.data)).not.toBe(templateHash(s1.data));
    }
  }, 120_000);

  it("S4 — POLICY / BUDGET / NORMATIVE / LIFECYCLE / RESULT: cada fonte lê a SUA autoridade; sigiloso sem valor; RESULT nunca inventada", async () => {
    const A = await seedOrg("fontes-a"), B = await seedOrg("fontes-b");
    const polFields = governedFieldsFor("POLICY", E2E_SCENARIO);
    expect((await adapter.resolveSources(A.org, A.processId, ["POLICY"], BLL_CATALOG)).POLICY).toBeUndefined();
    if (Object.keys(polFields).length > 0) {
      await gov.recordOrganizationFields(ctxOf(A.org), { ...act("p1"), catalogVersion: BLL_CATALOG.version, source: "POLICY", fields: polFields, expectedRevision: 0 });
      const pol = (await adapter.resolveSources(A.org, A.processId, ["POLICY"], BLL_CATALOG)).POLICY!;
      for (const [k, v] of Object.entries(polFields)) expect(at(pol.data, k)).toEqual(v);
      expect((await adapter.resolveSources(B.org, B.processId, ["POLICY"], BLL_CATALOG)).POLICY).toBeUndefined();   // cross-tenant
    }

    // BUDGET: divulgação é decisão; sigiloso nunca expõe valor; sem decisão ⇒ fonte ausente
    expect((await adapter.resolveSources(A.org, A.processId, ["BUDGET"], BLL_CATALOG)).BUDGET).toBeUndefined();
    expect((await err(gov.recordBudgetDisclosure(ctxOf(A.org), { ...act("b0"), processId: A.processId, disclosure: "talvez" as never, expectedRevision: 0 })))?.code).toBe("VALIDATION_FAILED");
    await gov.recordBudgetDisclosure(ctxOf(A.org), { ...act("disclosure"), processId: A.processId, disclosure: "sigiloso", expectedRevision: 0 });
    expect(JSON.stringify((await adapter.resolveSources(A.org, A.processId, ["BUDGET"], BLL_CATALOG)).BUDGET ?? {})).not.toMatch(/valorEstimado/);
    expect((await adapter.resolveSources(A.org, A.processId, ["PROCESS"], BLL_CATALOG)).PROCESS!.data).toMatchObject({ orcamentoSigilosoSimNao: true });   // derivado da decisão, nunca digitado
    expect((await adapter.resolveSources(B.org, A.processId, ["BUDGET"], BLL_CATALOG)).BUDGET).toBeUndefined();

    // LIFECYCLE: projeção do ciclo do processo da PRÓPRIA organização
    const life = (await adapter.resolveSources(A.org, A.processId, ["LIFECYCLE"], BLL_CATALOG)).LIFECYCLE;
    if (life) expect(life.organizationId).toBe(A.org);
    expect(await reasonOf(adapter.resolveSources(B.org, A.processId, ["LIFECYCLE"], BLL_CATALOG))).toBe("PROCESS_NOT_FOUND");

    // NORMATIVE: sem reference set governado verificado ⇒ falha fechada (nunca texto livre)
    const norm = await adapter.resolveSources(A.org, A.processId, ["NORMATIVE"], BLL_CATALOG).then((r) => ({ ok: true as const, r }), (e) => ({ ok: false as const, e }));
    if (norm.ok) expect(norm.r.NORMATIVE!.organizationId).toBe(A.org);
    else expect(norm.e).toBeInstanceOf(TemplateSourceUnavailableError);

    // RESULT: sem autoridade pré-certame ⇒ omitida (os campos pós-homologação ficam "a preencher"); PARAMS não existe no v2
    expect((await adapter.resolveSources(A.org, A.processId, ["RESULT"], BLL_CATALOG)).RESULT).toBeUndefined();
    expect(await err(adapter.resolveSources(A.org, A.processId, ["PARAMS"], BLL_CATALOG))).toBeInstanceOf(TemplateSourceUnavailableError);
    expect(await err(adapter.resolveSources(A.org, A.processId, ["INEXISTENTE" as never], BLL_CATALOG))).toBeInstanceOf(TemplateSourceUnavailableError);
  }, 120_000);
});

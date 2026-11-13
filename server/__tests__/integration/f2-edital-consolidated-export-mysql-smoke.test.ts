/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * F2 — EDITAL COMPLETO (Edital emitido + TR oficial integral no Anexo I) — MySQL REAL, dados SINTÉTICOS, rotas tRPC da UI.
 * Só roda com DATABASE_URL. O armazenamento é interceptado em memória para ler os bytes exportados (nenhum S3).
 *
 *  T1/T2/T10  DOCX e PDF completos pela rota `exportConsolidatedEdital`: TR integral entre o Anexo I e o Anexo II; anexos preservados
 *  T3         processo com TR v1 (fixado no Edital) e TR v2 emitido depois ⇒ o pacote traz a v1, nunca a v2
 *  T4         exportar não altera Edital/TR oficiais, M2, ledger de emissões nem hashes; artefato e trilha registram a origem do TR
 *  T5/T6      outro órgão e usuário sem vínculo não obtêm o pacote; versão de outro processo é recusada
 *  T7         TR adulterado / Edital sem vínculo fixado ⇒ recusa explícita, nada gerado
 *  T8         exportações repetidas ⇒ mesmo conteúdo documental
 *  T11/T12    exportações individuais intactas; versão HISTÓRICA do Edital exporta o seu próprio pacote
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import mysql from "mysql2/promise";
import { useGlobalFixtureLock } from "../helpers/globalFixtureLock";

const tenant = vi.hoisted(() => ({ org: 1, role: "owner" as string }));
vi.mock("../../services/tenantService", () => ({
  getMembership: vi.fn(async (userId: number, organizationId: number) => (tenant.role === "none" ? null : { id: 1, organizationId, userId, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() })),
  resolveTenantForUser: vi.fn(async () => ({
    organizationId: tenant.org,
    membership: tenant.role === "none" ? null : { id: 1, organizationId: tenant.org, userId: 1, role: tenant.role, invitedBy: null, ativo: true, createdAt: new Date(), updatedAt: new Date() },
  })),
}));
const store = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../../storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../storage")>()),
  assertStorageUsable: vi.fn(),
  storagePut: vi.fn(async (key: string, data: Buffer) => { store.set(key, Buffer.from(data)); return { key, url: `mem://${key}` }; }),
  storageSignedUrl: vi.fn(async (key: string) => ({ key, url: `mem://${key}` })),
}));

import { procurementProcessRouter } from "../../routers/procurementProcessRouter";
import { documentEngineRouter } from "../../routers/documentEngineRouter";
import { runMigrations, validateSchema } from "../../bootstrap";
import { generateTemplatedDocument } from "../../services/institutionalTemplates/templateCompositionService";
import { InstitutionalTemplatesWorkflow } from "../../services/institutionalTemplates/workflowService";
import { ModelRegistrationService } from "../../services/institutionalTemplates/modelRegistrationService";
import { TemplateGovernanceService } from "../../services/institutionalTemplates/governanceService";
import { createTemplateCompositionPorts, createTemplateWorkflowPorts } from "../../services/institutionalTemplates/integration";
import { configureTemplateCompositionPorts, configureTemplateWorkflowPorts, getTemplateCompositionPorts, getTemplateWorkflowPorts } from "../../services/institutionalTemplates/portsRegistry";
import { installGovernedLegalReferenceV1, approveAndActivateReferenceSet } from "../../db/legalReference";
import { computeManifestHashes, LEGAL_REFERENCE_V1_META } from "../../domain/legalReference/manifestV1";
import { makeContext, mockUser } from "../helpers/fixtures";
import { resolvePendingSlotsForTest } from "../helpers/slotResolutionFixture";
import { readZipEntry } from "../helpers/zipText";
import { BLL, U_AUTHOR, U_EDITOR, U_MANAGER, cleanupOrgs, ctxOf, decision, seedGoverned, seedOfficialTr, seedWorld, type World } from "../helpers/institutionalTemplatesE2eWorld";

const DB = process.env.DATABASE_URL;
const STAMP = (Date.now() % 1_000_000);
// Faixa PRÓPRIA deste arquivo ([998.000.000, 999.000.000)).
const BASE_ORG = 998_000_000 + (STAMP % 9_000) * 100;
const RUN = STAMP.toString(36);
let orgSeq = 0;
let keySeq = 0;
const key = (p: string) => `${p}-${RUN}-${++keySeq}-f2x`;
const ORGS: number[] = [];
const newOrg = () => { const o = BASE_ORG + orgSeq++; ORGS.push(o); return o; };

let conn: mysql.Connection;
let installedReferenceSet = false;
const rows = async <T = any>(sql: string, args: unknown[] = []): Promise<T[]> => (await conn.execute(sql, args as never))[0] as T[];
const count = async (sql: string, args: unknown[] = []): Promise<number> => Number((await rows<{ n: number }>(sql, args))[0].n);
const err = async (p: Promise<unknown>): Promise<{ code?: string; message: string } | null> => p.then(() => null, (e) => e);
const ctx = (org: number, role: string, userId: number) => {
  tenant.org = org; tenant.role = role;
  return { ...makeContext({ ...mockUser, id: userId, name: `Servidor sintético ${userId}` }), correlationId: `corr-f2x-${org}-${userId}`, requestId: `req-f2x-${org}` } as any;
};
const proc = (org: number, role = "operator", userId = U_EDITOR) => procurementProcessRouter.createCaller(ctx(org, role, userId));

const TR_V1 = [
  "# TERMO DE REFERÊNCIA", "## 1. DO OBJETO", "Aquisição sintética de material de expediente — TR VERSÃO UM.",
  "## 2. DOS ITENS", "| Item | Descrição | Unidade | Quantidade |\n|---|---|---|---|\n| 1 | Papel sulfite A4 75g | resma | 120 |\n| 2 | Caneta esferográfica azul | un | 400 |",
  "## 3. DO RECEBIMENTO", "Recebimento provisório em até 5 (cinco) dias úteis; definitivo após **conferência técnica**.",
  "## 4. DO PAGAMENTO", "Pagamento em até 30 (trinta) dias após o atesto — acentuação: ação, opção, ç.",
].join("\n\n");
const TR_V2 = TR_V1.replace("TR VERSÃO UM", "TR VERSÃO DOIS (posterior ao Edital)");

async function publishBll(org: number): Promise<void> {
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
}

const draftOf = async (w: World): Promise<{ content: string; contentHash: string }> => ((await proc(w.org).reviewableDraft({ processId: w.processId, kind: "edital" })) as any).draft;
const emitEdital = async (w: World): Promise<string> => {
  const d = await draftOf(w);
  const r: any = await proc(w.org, "manager", U_MANAGER).promoteOfficial({ processId: w.processId, kind: "edital", idempotencyKey: key("promo"), expectedContentHash: d.contentHash, reason: "Versão preparatória do Edital." } as any);
  expect(r.promoted).toBe(true);
  return r.officialDocument.id as string;
};

/** Órgão sintético com TR v1 oficial (conteúdo rico), Edital composto pelo modelo com o TR v1 fixado, trechos resolvidos e EMITIDO. */
async function emittedEdital(label: string): Promise<{ w: World; editalId: string; tr: { documentId: string; contentHash: string } }> {
  const org = newOrg();
  const w = await seedWorld(conn, org, label, { flagOn: true });
  await seedGoverned(w, undefined, "publico", label);
  const tr = await seedOfficialTr(conn, w, 1, TR_V1);
  await publishBll(org);
  await generateTemplatedDocument({
    organizationId: org, subjectId: w.processId, documentKind: "edital", documentType: "edital", scope: { ...BLL.declaredScope },
    asOf: "2026-10-07T00:00:00Z", title: "Edital de Pregão Eletrônico — sintético", actorUserId: U_AUTHOR, correlationId: `corr-gen-${org}`,
    aiNarratives: [], officialPins: { TR: { documentId: tr.documentId, version: tr.version, contentHash: tr.contentHash } },
  }, getTemplateCompositionPorts());
  await resolvePendingSlotsForTest(org, w.processId, U_EDITOR, key("slots"));
  return { w, editalId: await emitEdital(w), tr };
}

const bytesOf = (fileUrl: string): Buffer => {
  const b = store.get(fileUrl.replace(/^mem:\/\//, ""));
  if (!b) throw new Error(`artefato não armazenado: ${fileUrl}`);
  return b;
};
const docxText = (buf: Buffer): string => (readZipEntry(buf, "word/document.xml") ?? "").replace(/<[^>]+>/g, "|");
/** Texto documental do DOCX sem o carimbo "Exportado em" (metadado variável do contrato de exportação). */
const docxBody = (buf: Buffer): string => docxText(buf).replace(/Exportado em:[^|]*\|(\|)*[^|]*/g, "");
const officialSnapshot = async (org: number) => rows("SELECT id, content, version, status, replay_hash, metadata FROM official_documents WHERE tenant_id = ? ORDER BY id", [org]);

useGlobalFixtureLock("legal_reference");

describe.skipIf(!DB)("F2 — Edital completo com o TR oficial incorporado (MySQL real, rotas da UI)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO'");
    configureTemplateWorkflowPorts(createTemplateWorkflowPorts());
    configureTemplateCompositionPorts(createTemplateCompositionPorts());
    if ((await count("SELECT COUNT(*) n FROM legal_reference_sets WHERE status = 'active'")) === 0) {
      await installGovernedLegalReferenceV1();
      await approveAndActivateReferenceSet({ version: LEGAL_REFERENCE_V1_META.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "f2-synthetic" });
      installedReferenceSet = true;
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanupOrgs(conn, ORGS).catch(() => {});
    if (installedReferenceSet) for (const t of ["legal_reference_set_events", "legal_value_overrides", "legal_reference_entries", "legal_reference_sets"]) await conn.query(`DELETE FROM ${t}`).catch(() => {});
    await conn.end();
  }, 120_000);

  it("T1/T2/T3/T4/T8/T10/T11/T12 — pacote completo com o TR FIXADO, fontes intactas, repetível; individuais e versão histórica preservados", async () => {
    const { w, editalId, tr } = await emittedEdital("f2a");
    // T3 — um TR v2 é emitido DEPOIS do Edital: o pacote do Edital já emitido continua com a v1 fixada
    await seedOfficialTr(conn, w, 2, TR_V2);
    const before = await officialSnapshot(w.org);
    const m2Before = await rows("SELECT id, manifest_hash h, body_json b FROM document_composition_manifests WHERE organization_id = ? ORDER BY id", [w.org]);
    const promotionsBefore = await count("SELECT COUNT(*) n FROM official_document_promotions WHERE organization_id = ?", [w.org]);

    // T1 — DOCX completo (servidor comum do órgão: a mesma permissão de leitura/exportação oficial)
    const docx: any = await proc(w.org, "viewer", U_AUTHOR).exportConsolidatedEdital({ processId: w.processId, format: "docx" });
    expect(docx.fileName).toMatch(/^EDITAL_COMPLETO_.+_emitido_v\d+\.docx$/);
    const text = docxText(bytesOf(docx.url));
    const at = (s: string) => text.indexOf(s);
    expect(at("ANEXO I — TERMO DE REFERÊNCIA")).toBeGreaterThan(0);
    expect(text).toContain(`incorporada (SHA-256): ${tr.contentHash}`);   // F3-E: hash completo preservado (discreto, ao fim do TR)
    for (const t of ["1. DO OBJETO", "TR VERSÃO UM", "Papel sulfite A4 75g", "Caneta esferográfica azul", "3. DO RECEBIMENTO", "conferência técnica", "4. DO PAGAMENTO", "ação, opção, ç"]) expect(text, t).toContain(t);
    expect(text).not.toContain("TR VERSÃO DOIS");                                                  // T3
    expect(text).not.toContain("versão oficial emitida no processo");                              // T10: sem página de referência + cópia
    expect(at("ANEXO I — TERMO DE REFERÊNCIA")).toBeLessThan(at("TR VERSÃO UM"));
    expect(at("4. DO PAGAMENTO")).toBeLessThan(at("ANEXO II —"));
    for (const a of ["ANEXO II —", "ANEXO III —", "ANEXO IV —"]) expect(text.split(a).length - 1, a).toBe(1);
    // T2 — PDF completo (mesmo conteúdo renderizado pelo pipeline canônico); maior que o Edital isolado
    const pdf: any = await proc(w.org).exportConsolidatedEdital({ processId: w.processId, format: "pdf" });
    expect(pdf.fileName).toMatch(/^EDITAL_COMPLETO_.+\.pdf$/);
    const single: any = await proc(w.org).exportDocument({ processId: w.processId, kind: "edital", format: "pdf" });   // T11
    expect(bytesOf(pdf.url).subarray(0, 4).toString()).toBe("%PDF");
    expect(bytesOf(pdf.url).length).toBeGreaterThan(bytesOf(single.url).length);
    expect(single.fileName).toMatch(/^EDITAL_.+_emitido_v\d+\.pdf$/);
    expect(single.fileName).not.toContain("COMPLETO");
    // T11 — o TR oficial continua exportável sozinho (mesma exportação oficial da tela "Documentos oficiais")
    const trAlone: any = await documentEngineRouter.createCaller(ctx(w.org, "operator", U_EDITOR)).exportInstitutional({ documentId: tr.documentId, format: "docx" });
    expect(docxText(bytesOf(trAlone.url))).toContain("TR VERSÃO UM");
    expect(docxText(bytesOf(trAlone.url))).not.toContain("ANEXO II");

    // T8 — repetível: mesmo conteúdo documental (o carimbo "Exportado em" é metadado variável previsto)
    const again: any = await proc(w.org).exportConsolidatedEdital({ processId: w.processId, documentId: editalId, format: "docx" });
    expect(docxBody(bytesOf(again.url))).toBe(docxBody(bytesOf(docx.url)));

    // T4 — nada oficial mudou: documentos, M2, ledger de emissões; o artefato e a trilha registram a origem exata do TR
    expect(await officialSnapshot(w.org)).toEqual(before);
    expect(await rows("SELECT id, manifest_hash h, body_json b FROM document_composition_manifests WHERE organization_id = ? ORDER BY id", [w.org])).toEqual(m2Before);
    expect(await count("SELECT COUNT(*) n FROM official_document_promotions WHERE organization_id = ?", [w.org])).toBe(promotionsBefore);
    const tl = await rows("SELECT summary FROM official_document_timeline WHERE tenant_id = ? AND document_id = ? AND event_type = 'documento_exportado'", [w.org, editalId]);
    expect(tl.some((e: any) => String(e.summary).includes(`Termo de Referência oficial incorporado (documento ${tr.documentId}, revisão técnica v1, sha256:${tr.contentHash})`))).toBe(true);
    const audit = await rows("SELECT details FROM activity_logs WHERE organizationId = ? AND action = 'exportou documento oficial' ORDER BY id DESC", [w.org]);
    const details = audit.map((x: any) => (typeof x.details === "string" ? JSON.parse(x.details) : x.details));
    expect(details.some((d: any) => d.consolidated === true && d.trDocumentId === tr.documentId && d.trVersion === 1 && d.trContentHash === tr.contentHash)).toBe(true);

    // T12 — versão HISTÓRICA: nova emissão do Edital (com nota) ⇒ a versão anterior exporta o SEU pacote (sem a nota)
    // (o TR v2 tornaria a nova emissão SOURCE_CHANGED; remove-se aqui a v2 sintética, que nenhum documento emitido referencia)
    await conn.execute("DELETE FROM official_documents WHERE tenant_id = ? AND document_type = 'tr' AND version = 2", [w.org]);
    const d = await draftOf(w);
    await proc(w.org, "manager", U_MANAGER).saveReviewableDraft({ processId: w.processId, kind: "edital", content: `${d.content}\nNota sintética da segunda emissão.\n`, expectedContentHash: d.contentHash, idempotencyKey: key("ed2") });
    const edital2 = await emitEdital(w);
    expect(edital2).not.toBe(editalId);
    const hist: any = await proc(w.org).exportConsolidatedEdital({ processId: w.processId, documentId: editalId, format: "docx" });
    const cur: any = await proc(w.org).exportConsolidatedEdital({ processId: w.processId, format: "docx" });
    expect(docxText(bytesOf(hist.url))).not.toContain("Nota sintética da segunda emissão");
    expect(docxText(bytesOf(cur.url))).toContain("Nota sintética da segunda emissão");
    expect(docxText(bytesOf(hist.url))).toContain("TR VERSÃO UM");
  }, 900_000);

  it("T5/T6/T7 — outro órgão, sem vínculo, versão de outro processo, TR adulterado e Edital sem vínculo fixado ⇒ recusa explícita", async () => {
    const a = await emittedEdital("f2b");
    const b = await emittedEdital("f2c");
    // T5 — outro órgão: processo alheio ⇒ NOT_FOUND; documento alheio no próprio processo ⇒ NOT_FOUND
    expect((await err(proc(b.w.org).exportConsolidatedEdital({ processId: a.w.processId, format: "docx" })))?.code).toBe("NOT_FOUND");
    expect((await err(proc(b.w.org).exportConsolidatedEdital({ processId: b.w.processId, documentId: a.editalId, format: "docx" })))?.code).toBe("NOT_FOUND");
    // T6 — usuário sem vínculo com o órgão
    expect((await err(proc(a.w.org, "none", 4040).exportConsolidatedEdital({ processId: a.w.processId, format: "pdf" })))?.code).toBe("FORBIDDEN");
    // T7 — TR fixado adulterado no banco (simulação de corrupção) ⇒ recusa, nunca troca pelo TR atual; nada exportado
    const stored = store.size;
    await conn.execute("UPDATE official_documents SET content = CONCAT(content, ' adulterado') WHERE tenant_id = ? AND id = ?", [a.w.org, a.tr.documentId]);
    const bad = await err(proc(a.w.org).exportConsolidatedEdital({ processId: a.w.processId, format: "docx" }));
    expect(bad?.code).toBe("PRECONDITION_FAILED");
    expect(bad?.message).toContain("EDITAL_TR_SOURCE_UNVERIFIABLE");
    expect(store.size).toBe(stored);
    // T7 — Edital emitido sem vínculo fixado (ex.: gerador legado, sem M2) ⇒ recusa explícita com orientação
    await conn.execute("UPDATE official_documents SET metadata = JSON_REMOVE(metadata, '$.templateIssuanceManifestId') WHERE tenant_id = ? AND id = ?", [b.w.org, b.editalId]);
    const legacy = await err(proc(b.w.org).exportConsolidatedEdital({ processId: b.w.processId, format: "pdf" }));
    expect(legacy?.code).toBe("PRECONDITION_FAILED");
    expect(legacy?.message).toContain("EDITAL_TR_LINK_UNAVAILABLE");
    expect(legacy?.message).toContain("Exporte o Edital e o Termo de Referência separadamente");
    // o Edital individual continua exportável
    expect(((await proc(b.w.org).exportDocument({ processId: b.w.processId, kind: "edital", format: "pdf" })) as any).fileName).toMatch(/^EDITAL_/);
  }, 900_000);
});

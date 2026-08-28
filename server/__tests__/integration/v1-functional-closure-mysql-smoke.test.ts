/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * V1 — FUNCTIONAL CLOSURE contra MySQL REAL (CI, modo ESTRITO).
 *
 * Prova, contra o writer real sob STRICT_TRANS_TABLES, que os documentos finais dos módulos satélite
 * são materializados no pipeline ÚNICO (Document Engine) e exportáveis, reusando toda a fundação
 * C.4A/C.4B. NÃO reimplementa export nem cria renderer paralelo.
 *
 *   A. PARECER — ao ASSINAR, materializa a versão OFICIAL (`emitido`) com o conteúdo EXATO assinado;
 *      o rascunho `gerado` NÃO exporta como oficial (policy server-owned parecer_juridico → "emitido");
 *      a versão `emitido` exporta DOCX/PDF; isolamento por tenant.
 *   B. CONTRATAÇÃO DIRETA — a justificativa de PREÇO é projetada no Document Engine; a RATIFICAÇÃO
 *      materializa a decisão REAL persistida (não texto genérico); o painel consulta por origin.
 *   D. CONTRATOS/ADITIVOS — contrato e aditivo geram documento oficial e exportam DOCX/PDF (comprovação,
 *      sem reimplementação).
 *
 * Só roda com DATABASE_URL. NUNCA relaxa o sql_mode.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, ensureSchema } from "../../bootstrap";
import { createLegalOpinionWorkspace, transitionLegalStage } from "../../domain/legalOpinionWorkspace";
import { insertLegalOpinionWorkspace } from "../../db/legalOpinionWorkspace";
import { createOpinionDraft, updateOpinionDraft, signOpinion } from "../../services/legalOpinionWorkspaceService";
import { createDirectProcurementWorkspace } from "../../domain/directProcurementWorkspace";
import { createRatification } from "../../domain/directProcurementJustifications";
import { insertDirectProcurementWorkspace, insertRatification } from "../../db/directProcurement";
import { generatePriceJustification, generatePublications } from "../../services/directProcurementService";
import { createManualContract, generateContractDocument, createAddendum } from "../../services/contractService";
import { listOfficialDocuments, getOfficialDocument } from "../../db/officialDocuments";
import { exportOfficialDocument } from "../../services/officialDocumentExportAdapter";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 991061;
const ORG2 = 991062;
const LAWYER = 8;
const SIGNER = 8;
const USER = 5;

let conn: mysql.Connection;

async function docsByOrigin(org: number, businessDomain: string, origin: string) {
  return listOfficialDocuments(org, { businessDomain, origin });
}

/**
 * Convenção dos smokes (idêntica ao c4b1): o CI não tem S3; o UPLOAD real não é exercitado. Provamos
 * (a) a MATERIALIZAÇÃO no Document Engine e (b) o GATE de policy server-owned. `exportOfficialDocument`
 * roda o gate ANTES do storage: um rascunho barrado rejeita com FORBIDDEN (determinístico, sem S3); um
 * documento liberado passa do gate e só então falha por storage ausente (erro ambiental, nunca FORBIDDEN).
 */
async function exportBlockedByPolicy(org: number, documentId: string): Promise<boolean> {
  try {
    await exportOfficialDocument({ organizationId: org, userId: USER, documentId, format: "pdf" });
    return false;
  } catch (e: any) {
    return e?.code === "FORBIDDEN";
  }
}

async function cleanup() {
  for (const org of [ORG, ORG2]) {
    for (const t of [
      "official_document_timeline", "official_documents", "process_timeline",
      "legal_opinion_history", "legal_opinion_versions", "legal_opinion_drafts", "legal_opinion_workspaces",
      "generated_publications", "required_documents", "ratifications", "price_justifications", "contract_justifications",
      "direct_procurement_procedures", "direct_procurement_workspaces",
      "contract_addenda", "contract_ws_documents", "contract_workspaces",
    ]) {
      await conn.execute(`DELETE FROM ${t} WHERE organization_id = ?`, [org]).catch(() => {});
      await conn.execute(`DELETE FROM ${t} WHERE tenant_id = ?`, [org]).catch(() => {});
    }
    // idempotency_keys usa a coluna camelCase `organizationId` — limpar para não poluir replays entre runs.
    await conn.execute("DELETE FROM idempotency_keys WHERE organizationId = ?", [org]).catch(() => {});
  }
}

/** Semeia um workspace de Parecer + rascunho inicial (via Institutional Request simulada por insert direto). */
async function seedOpinionWorkspace(org: number, requestId: string, processId: string) {
  let ws = createLegalOpinionWorkspace({
    organizationId: org, requestId, sourceDomain: "processo_licitatorio",
    referenceProcessId: processId, requestType: "LEGAL_OPINION_FINAL",
    assignedLawyer: LAWYER, correlationId: "v1-closure",
  });
  // Caminha por transições válidas até UNDER_ANALYSIS (de onde DRAFT é alcançável no createOpinionDraft).
  ws = transitionLegalStage(ws, "RECEIVED");
  ws = transitionLegalStage(ws, "UNDER_ANALYSIS");
  await insertLegalOpinionWorkspace(ws);
  return ws;
}

describe.skipIf(!DB)("V1 — Functional Closure (MySQL estrito)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    // Espelha o BOOT real (migrate + ensureSchema): o safety net adiciona colunas de drift não
    // journaladas (ex.: contract_ws_documents.metadata, contract_addenda.request_origin).
    await ensureSchema(conn);
    await conn.query(`SET GLOBAL sql_mode = '${STRICT}'`).catch(() => {});
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    for (const [id, slug] of [[ORG, "v1-org"], [ORG2, "v1-org-2"]] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `V1 ${slug}`, slug]).catch(() => {});
    }
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG2]).catch(() => {});
    await conn.end();
  });

  // ─── A. PARECER ─────────────────────────────────────────────────────────────

  it("A1) assinar materializa a versão OFICIAL (emitido) com o conteúdo EXATO assinado", async () => {
    const ws = await seedOpinionWorkspace(ORG, "v1-req-a1", "PROC-A1");
    await createOpinionDraft({
      workspaceId: ws.id, organizationId: ORG, author: LAWYER, opinionType: "LEGAL_OPINION_FINAL",
      report: "Relatório inicial", foundation: "Fundamentação inicial", conclusion: "Conclusão inicial",
      conclusionType: "favoravel", correlationId: "v1-closure",
    });
    // Edição humana ANTES da assinatura — a versão oficial deve refletir o conteúdo FINAL, não o inicial.
    await updateOpinionDraft({
      workspaceId: ws.id, organizationId: ORG, author: LAWYER,
      patch: { report: "Relatório FINAL revisado", foundation: "Fundamentação FINAL", conclusion: "Conclusão FINAL favorável" },
      correlationId: "v1-closure",
    });
    await signOpinion({ workspaceId: ws.id, organizationId: ORG, signedBy: SIGNER, method: "manual", idempotencyKey: "sign-key-fix-0001", correlationId: "v1-closure" });

    const emitidos = (await docsByOrigin(ORG, "parecer_juridico", ws.id)).filter(d => d.status === "emitido");
    expect(emitidos.length).toBe(1);
    const full = await getOfficialDocument(emitidos[0]!.id, ORG);
    expect(full!.content).toContain("Relatório FINAL revisado");
    expect(full!.content).toContain("Fundamentação FINAL");
    expect(full!.content).toContain("Conclusão FINAL favorável");
    expect(full!.content).not.toContain("Relatório inicial");
    expect(full!.documentType).toBe("parecer_final");
  }, 120_000);

  it("A2) rascunho 'gerado' é BARRADO pela policy; 'emitido' passa do gate (liberado para export)", async () => {
    const ws = await seedOpinionWorkspace(ORG, "v1-req-a2", "PROC-A2");
    await createOpinionDraft({
      workspaceId: ws.id, organizationId: ORG, author: LAWYER, opinionType: "LEGAL_OPINION_INITIAL",
      report: "R", foundation: "F", conclusion: "C", conclusionType: "favoravel", correlationId: "v1-closure",
    });
    const all = await docsByOrigin(ORG, "parecer_juridico", ws.id);
    const gerado = all.find(d => d.status !== "emitido");
    expect(gerado).toBeTruthy();
    // Policy server-owned: rascunho não sai como oficial mesmo por chamada direta ao endpoint.
    expect(await exportBlockedByPolicy(ORG, gerado!.id)).toBe(true);

    await signOpinion({ workspaceId: ws.id, organizationId: ORG, signedBy: SIGNER, method: "manual", idempotencyKey: "sign-key-fix-0002", correlationId: "v1-closure" });
    const emitido = (await docsByOrigin(ORG, "parecer_juridico", ws.id)).find(d => d.status === "emitido");
    expect(emitido).toBeTruthy();
    // A versão assinada/emitido PASSA do gate (a falha remanescente no CI é ambiental — storage — nunca FORBIDDEN).
    expect(await exportBlockedByPolicy(ORG, emitido!.id)).toBe(false);
  }, 120_000);

  it("A3) isolamento por tenant: ORG2 não enxerga o parecer do ORG", async () => {
    const ws = await seedOpinionWorkspace(ORG, "v1-req-a3", "PROC-A3");
    await createOpinionDraft({
      workspaceId: ws.id, organizationId: ORG, author: LAWYER, opinionType: "LEGAL_OPINION_FINAL",
      report: "R", foundation: "F", conclusion: "C", conclusionType: "favoravel", correlationId: "v1-closure",
    });
    await signOpinion({ workspaceId: ws.id, organizationId: ORG, signedBy: SIGNER, method: "manual", idempotencyKey: "sign-key-fix-0003", correlationId: "v1-closure" });
    expect((await docsByOrigin(ORG2, "parecer_juridico", ws.id)).length).toBe(0);
  }, 120_000);

  it("A4) assinatura REPLAY-SAFE/CONVERGENTE: repetir o comando não cria nova versão emitido", async () => {
    const ws = await seedOpinionWorkspace(ORG, "v1-req-a4", "PROC-A4");
    await createOpinionDraft({
      workspaceId: ws.id, organizationId: ORG, author: LAWYER, opinionType: "LEGAL_OPINION_FINAL",
      report: "R4", foundation: "F4", conclusion: "C4", conclusionType: "favoravel", correlationId: "v1-closure",
    });
    const r1 = await signOpinion({ workspaceId: ws.id, organizationId: ORG, signedBy: SIGNER, method: "manual", idempotencyKey: "sign-key-a4-0001", correlationId: "v1-closure" });
    expect(r1.replayed).toBe(false);
    expect(r1.workspace.currentStage).toBe("SIGNED");
    expect((await docsByOrigin(ORG, "parecer_juridico", ws.id)).filter(d => d.status === "emitido").length).toBe(1);

    // Mesmo comando/key (retry de outcome desconhecido) → reconverge, NÃO cria nova versão.
    const r2 = await signOpinion({ workspaceId: ws.id, organizationId: ORG, signedBy: SIGNER, method: "manual", idempotencyKey: "sign-key-a4-0001", correlationId: "v1-closure" });
    expect(r2.replayed).toBe(true);
    expect(r2.workspace.currentStage).toBe("SIGNED");
    expect((await docsByOrigin(ORG, "parecer_juridico", ws.id)).filter(d => d.status === "emitido").length).toBe(1);
  }, 120_000);

  it("A5) reparo de materialização parcial: emitido ausente é remateralizado UMA vez", async () => {
    const ws = await seedOpinionWorkspace(ORG, "v1-req-a5", "PROC-A5");
    await createOpinionDraft({
      workspaceId: ws.id, organizationId: ORG, author: LAWYER, opinionType: "LEGAL_OPINION_FINAL",
      report: "R5", foundation: "F5", conclusion: "C5", conclusionType: "favoravel", correlationId: "v1-closure",
    });
    await signOpinion({ workspaceId: ws.id, organizationId: ORG, signedBy: SIGNER, method: "manual", idempotencyKey: "sign-key-a5-0001", correlationId: "v1-closure" });
    // Simula falha parcial: o draft ficou assinado, mas a versão emitido não persistiu.
    await conn.execute("DELETE FROM official_documents WHERE tenant_id = ? AND status = 'emitido' AND origin = ?", [ORG, ws.id]);
    expect((await docsByOrigin(ORG, "parecer_juridico", ws.id)).filter(d => d.status === "emitido").length).toBe(0);

    // NOVA tentativa lógica (key distinta): a idempotência canônica executa a operação, e a convergência
    // por estado detecta o draft já assinado + a versão emitido ausente e a REPARA uma única vez.
    const r = await signOpinion({ workspaceId: ws.id, organizationId: ORG, signedBy: SIGNER, method: "manual", idempotencyKey: "sign-key-a5-0002", correlationId: "v1-closure" });
    expect(r.replayed).toBe(false);
    expect((await docsByOrigin(ORG, "parecer_juridico", ws.id)).filter(d => d.status === "emitido").length).toBe(1);
  }, 120_000);

  it("A6) parâmetros incompatíveis com a assinatura existente → CONFLICT", async () => {
    const ws = await seedOpinionWorkspace(ORG, "v1-req-a6", "PROC-A6");
    await createOpinionDraft({
      workspaceId: ws.id, organizationId: ORG, author: LAWYER, opinionType: "LEGAL_OPINION_FINAL",
      report: "R6", foundation: "F6", conclusion: "C6", conclusionType: "favoravel", correlationId: "v1-closure",
    });
    await signOpinion({ workspaceId: ws.id, organizationId: ORG, signedBy: SIGNER, method: "manual", idempotencyKey: "sign-key-fix-0004", correlationId: "v1-closure" });
    // Outro signer (id distinto) tenta assinar o mesmo parecer já assinado → recusa fail-closed.
    const OTHER_SIGNER = 9;
    await expect(signOpinion({ workspaceId: ws.id, organizationId: ORG, signedBy: OTHER_SIGNER, method: "manual", idempotencyKey: "sign-key-a6-0001", correlationId: "v1-closure" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect((await docsByOrigin(ORG, "parecer_juridico", ws.id)).filter(d => d.status === "emitido").length).toBe(1);
  }, 120_000);

  it("A7) idempotência CANÔNICA: MESMA key + payload diferente → CONFLICT", async () => {
    const wsA = await seedOpinionWorkspace(ORG, "v1-req-a7a", "PROC-A7A");
    const wsB = await seedOpinionWorkspace(ORG, "v1-req-a7b", "PROC-A7B");
    for (const w of [wsA, wsB]) {
      await createOpinionDraft({
        workspaceId: w.id, organizationId: ORG, author: LAWYER, opinionType: "LEGAL_OPINION_FINAL",
        report: "R7", foundation: "F7", conclusion: "C7", conclusionType: "favoravel", correlationId: "v1-closure",
      });
    }
    const KEY = "sign-key-a7-shared";
    await signOpinion({ workspaceId: wsA.id, organizationId: ORG, signedBy: SIGNER, method: "manual", idempotencyKey: KEY, correlationId: "v1-closure" });
    // Mesma key, payload distinto (outro workspace/draft) → CONFLICT canônico.
    await expect(signOpinion({ workspaceId: wsB.id, organizationId: ORG, signedBy: SIGNER, method: "manual", idempotencyKey: KEY, correlationId: "v1-closure" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    expect((await docsByOrigin(ORG, "parecer_juridico", wsB.id)).filter(d => d.status === "emitido").length).toBe(0);
  }, 120_000);

  it("A8) concorrência com a MESMA key → efeito único (uma versão emitido)", async () => {
    const ws = await seedOpinionWorkspace(ORG, "v1-req-a8", "PROC-A8");
    await createOpinionDraft({
      workspaceId: ws.id, organizationId: ORG, author: LAWYER, opinionType: "LEGAL_OPINION_FINAL",
      report: "R8", foundation: "F8", conclusion: "C8", conclusionType: "favoravel", correlationId: "v1-closure",
    });
    const KEY = "sign-key-a8-concurrent";
    const call = () => signOpinion({ workspaceId: ws.id, organizationId: ORG, signedBy: SIGNER, method: "manual", idempotencyKey: KEY, correlationId: "v1-closure" });
    const results = await Promise.allSettled([call(), call()]);
    // Pelo menos uma conclui; nenhuma duplica o efeito.
    expect(results.some(r => r.status === "fulfilled")).toBe(true);
    expect((await docsByOrigin(ORG, "parecer_juridico", ws.id)).filter(d => d.status === "emitido").length).toBe(1);
  }, 120_000);

  // ─── B. CONTRATAÇÃO DIRETA ──────────────────────────────────────────────────

  async function seedDirect(org: number, processNumber: string) {
    const ws = createDirectProcurementWorkspace({
      organizationId: org, processNumber, object: "Aquisição direta de teste",
      procurementType: "dispensa", startOption: "sem_dfd", responsibleUser: USER, correlationId: "v1-closure",
    });
    await insertDirectProcurementWorkspace(ws);
    return ws;
  }

  it("B1) justificativa de PREÇO é projetada no Document Engine (fiel aos dados persistidos)", async () => {
    const ws = await seedDirect(ORG, "DIR-B1");
    await generatePriceJustification({
      workspaceId: ws.id, organizationId: ORG, source: "pesquisa", justification: "Preço fundamentado em 3 cotações.",
      referenceValue: 15000, researchId: "res-1", correlationId: "v1-closure",
    });
    const docs = (await docsByOrigin(ORG, "contratacao_direta", ws.id)).filter(d => d.documentType === "justificativa_preco");
    expect(docs.length).toBe(1);
    const full = await getOfficialDocument(docs[0]!.id, ORG);
    expect(full!.content).toContain("Preço fundamentado em 3 cotações.");
    expect(full!.content).toContain("15000");
  }, 120_000);

  it("B2) RATIFICAÇÃO materializa a decisão REAL persistida (não texto genérico)", async () => {
    const ws = await seedDirect(ORG, "DIR-B2");
    const rat = createRatification({
      organizationId: ORG, workspaceId: ws.id, responsible: USER, decision: "ratificado",
      justification: "Ratifico a contratação direta por dispensa, art. 75.", evidence: ["parecer-123"], correlationId: "v1-closure",
    });
    await insertRatification(rat);
    await generatePublications({ workspaceId: ws.id, organizationId: ORG, correlationId: "v1-closure" });
    const ratDoc = (await docsByOrigin(ORG, "contratacao_direta", ws.id)).find(d => d.documentType === "ratificacao");
    expect(ratDoc).toBeTruthy();
    const full = await getOfficialDocument(ratDoc!.id, ORG);
    expect(full!.content).toContain("Ratifico a contratação direta por dispensa, art. 75.");
    expect(full!.content).toContain("ratificado");
  }, 120_000);

  it("B3) FAIL-CLOSED: publicar SEM ratificação registrada → bloqueado, nenhum doc ratificacao", async () => {
    const ws = await seedDirect(ORG, "DIR-B3");
    await expect(generatePublications({ workspaceId: ws.id, organizationId: ORG, correlationId: "v1-closure" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await docsByOrigin(ORG, "contratacao_direta", ws.id)).filter(d => d.documentType === "ratificacao").length).toBe(0);
  }, 120_000);

  it("B4) FAIL-CLOSED: decisão 'nao_ratificado' → bloqueado, nenhum doc ratificacao", async () => {
    const ws = await seedDirect(ORG, "DIR-B4");
    const rat = createRatification({
      organizationId: ORG, workspaceId: ws.id, responsible: USER, decision: "nao_ratificado",
      justification: "Contratação não ratificada.", correlationId: "v1-closure",
    });
    await insertRatification(rat);
    await expect(generatePublications({ workspaceId: ws.id, organizationId: ORG, correlationId: "v1-closure" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await docsByOrigin(ORG, "contratacao_direta", ws.id)).filter(d => d.documentType === "ratificacao").length).toBe(0);
  }, 120_000);

  // ─── D. CONTRATOS / ADITIVOS ────────────────────────────────────────────────

  it("D1) contrato gera documento oficial e exporta DOCX/PDF", async () => {
    const contract = await createManualContract({
      organizationId: ORG, contractNumber: "CT-D1/2026", contractor: "Fornecedor X", object: "Objeto do contrato",
      value: 50000, term: "12 meses", correlationId: "v1-closure", createdBy: USER,
    });
    await generateContractDocument({ organizationId: ORG, contractId: contract.id, kind: "contrato", correlationId: "v1-closure" });
    const docs = (await docsByOrigin(ORG, "contratos", contract.id)).filter(d => d.documentType === "contrato");
    expect(docs.length).toBeGreaterThanOrEqual(1);
    // Contratos não têm gate de status: o documento oficial é materializado e LIBERADO para export.
    expect(await exportBlockedByPolicy(ORG, docs[0]!.id)).toBe(false);
  }, 120_000);

  it("D2) aditivo gera documento oficial e exporta DOCX/PDF", async () => {
    const contract = await createManualContract({
      organizationId: ORG, contractNumber: "CT-D2/2026", contractor: "Fornecedor Y", object: "Objeto D2",
      value: 80000, term: "12 meses", correlationId: "v1-closure", createdBy: USER,
    });
    await createAddendum({
      organizationId: ORG, contractId: contract.id, addendumType: "prazo", justification: "Prorrogação de 6 meses.",
      newTerm: "18 meses", correlationId: "v1-closure",
    });
    const docs = (await docsByOrigin(ORG, "contratos", contract.id)).filter(d => d.documentType === "aditivo");
    expect(docs.length).toBeGreaterThanOrEqual(1);
    expect(await exportBlockedByPolicy(ORG, docs[0]!.id)).toBe(false);
  }, 120_000);
});

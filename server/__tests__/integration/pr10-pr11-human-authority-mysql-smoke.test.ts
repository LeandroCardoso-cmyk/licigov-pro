/**
 * R5 / PR-10 (SEM-019) + PR-11 (SEM-021/SEM-022) — MySQL 8 REAL, dados SINTÉTICOS (órgãos 960821/960822).
 *
 *   H1. salvar o parecer com campos em branco NÃO apaga o persistido (no-op, sem nova versão);
 *   H2. `expectedVersion` desatualizada ⇒ CONFLICT `LEGAL_OPINION_STALE_VERSION`, zero escrita;
 *   H3. patch real com a versão correta grava só o campo alterado (v+1);
 *   J1. gerar a justificativa da contratação devolve SUGESTÃO — nada é persistido e nenhum documento oficial é criado;
 *   J2. aceite com campos centrais curtos ⇒ BAD_REQUEST `JUSTIFICATION_FIELDS_REQUIRED`, zero escrita;
 *   J3. aceite humano persiste e gera o documento oficial com o AUTOR humano;
 *   J4. justificativa de preço: vazia, valor ≤ 0 ou sem `confirmOfficial` ⇒ recusa sem escrita; válida ⇒ autor humano;
 *   J5. isolamento: o órgão B não lê nem aceita no workspace do órgão A (NOT_FOUND).
 *
 * Só roda com DATABASE_URL. Nunca toca dados reais.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, validateSchema } from "../../bootstrap";
import { createLegalOpinionWorkspace, transitionLegalStage } from "../../domain/legalOpinionWorkspace";
import { insertLegalOpinionWorkspace } from "../../db/legalOpinionWorkspace";
import { createOpinionDraft, updateOpinionDraft } from "../../services/legalOpinionWorkspaceService";
import { createDirectProcurementWorkspace } from "../../domain/directProcurementWorkspace";
import { insertDirectProcurementWorkspace, getContractJustification, getPriceJustification } from "../../db/directProcurement";
import { acceptContractJustification, generateContractJustification, generatePriceJustification } from "../../services/directProcurementService";
import { listOfficialDocuments } from "../../db/officialDocuments";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG = 960821;
const ORG_B = 960822;
const LAWYER = 31;
const ACTOR = 32;
const CORR = "pr10-pr11-smoke";
const RUN = Date.now().toString(36);

let conn: mysql.Connection;

const TABLES = [
  "official_document_timeline", "official_documents", "process_timeline",
  "legal_opinion_history", "legal_opinion_versions", "legal_opinion_drafts", "legal_opinion_workspaces",
  "price_justifications", "contract_justifications", "direct_procurement_workspaces",
];

/** Coluna de tenant: o Document Engine usa `tenant_id`; os domínios, `organization_id`. */
const tenantCol = (t: string) => (t.startsWith("official_document") ? "tenant_id" : "organization_id");

async function cleanup() {
  for (const org of [ORG, ORG_B]) {
    for (const t of TABLES) {
      await conn.execute(`DELETE FROM ${t} WHERE ${tenantCol(t)} = ?`, [org]).catch(() => {});
    }
  }
}

async function count(table: string, org: number): Promise<number> {
  const [rows] = await conn.query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${tenantCol(table)} = ?`, [org]);
  return Number((rows as Array<{ n: number }>)[0]!.n);
}
async function counts(org: number) {
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = await count(t, org);
  return out;
}

async function authorsOf(origin: string, documentType: string): Promise<string[]> {
  const [rows] = await conn.query("SELECT author FROM official_documents WHERE tenant_id = ? AND origin = ? AND document_type = ?", [ORG, origin, documentType]);
  return (rows as Array<{ author: string }>).map(r => r.author);
}

async function errOf(fn: () => Promise<unknown>): Promise<{ code?: string; message: string }> {
  try { await fn(); } catch (e) { return e as { code?: string; message: string }; }
  throw new Error("esperava erro");
}

async function seedOpinion(processId: string) {
  let ws = createLegalOpinionWorkspace({
    organizationId: ORG, requestId: `req-${RUN}-${processId}`, sourceDomain: "processo_licitatorio",
    referenceProcessId: processId, requestType: "LEGAL_OPINION_INITIAL", assignedLawyer: LAWYER, correlationId: CORR,
  });
  ws = transitionLegalStage(ws, "RECEIVED");
  ws = transitionLegalStage(ws, "UNDER_ANALYSIS");
  await insertLegalOpinionWorkspace(ws);
  const { draft } = await createOpinionDraft({
    workspaceId: ws.id, organizationId: ORG, author: LAWYER, opinionType: "LEGAL_OPINION_INITIAL",
    report: "Relatório persistido.", foundation: "Fundamentação persistida.", conclusion: "Conclusão persistida.",
    conclusionType: "favoravel", correlationId: CORR,
  });
  return { ws, draft };
}

async function seedDirect(org: number, n: string) {
  const ws = createDirectProcurementWorkspace({
    organizationId: org, processNumber: `SINT-PR11/${RUN}/${n}`, object: "Aquisição sintética",
    procurementType: "dispensa", startOption: "sem_dfd", responsibleUser: ACTOR, correlationId: CORR,
  });
  await insertDirectProcurementWorkspace(ws);
  return ws;
}

describe.skipIf(!DB)("PR-10 / PR-11 — autoridade humana e hidratação não destrutiva (MySQL 8)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await validateSchema(conn);
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    for (const id of [ORG, ORG_B]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `PR11 ${id}`, `pr11-${id}`]);
    }
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await cleanup().catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("H1) salvar em branco não apaga o parecer persistido (no-op, sem nova versão)", async () => {
    const { ws, draft } = await seedOpinion("P-H1");
    const before = await counts(ORG);
    const res = await updateOpinionDraft({
      workspaceId: ws.id, organizationId: ORG, author: LAWYER, expectedVersion: draft.version,
      patch: { report: "", foundation: "   ", conclusion: "Conclusão persistida.", conclusionType: null }, correlationId: CORR,
    });
    expect(res.changed).toBe(false);
    expect(res.draft).toMatchObject({ version: draft.version, report: "Relatório persistido.", foundation: "Fundamentação persistida.", conclusionType: "favoravel" });
    expect(await counts(ORG)).toEqual(before);
  }, 60_000);

  it("H2) versão desatualizada ⇒ CONFLICT LEGAL_OPINION_STALE_VERSION — zero escrita", async () => {
    const { ws, draft } = await seedOpinion("P-H2");
    const before = await counts(ORG);
    const e = await errOf(() => updateOpinionDraft({
      workspaceId: ws.id, organizationId: ORG, author: LAWYER, expectedVersion: draft.version + 7,
      patch: { report: "Texto que não deve ser gravado." }, correlationId: CORR,
    }));
    expect(e.code).toBe("CONFLICT");
    expect(e.message).toContain("LEGAL_OPINION_STALE_VERSION");
    expect(await counts(ORG)).toEqual(before);
  }, 60_000);

  it("H3) patch real com a versão correta grava só o campo alterado (v+1)", async () => {
    const { ws, draft } = await seedOpinion("P-H3");
    const res = await updateOpinionDraft({
      workspaceId: ws.id, organizationId: ORG, author: LAWYER, expectedVersion: draft.version,
      patch: { report: "Relatório revisado pelo procurador.", foundation: "" }, correlationId: CORR,
    });
    expect(res.changed).toBe(true);
    expect(res.draft).toMatchObject({ version: draft.version + 1, report: "Relatório revisado pelo procurador.", foundation: "Fundamentação persistida.", conclusionType: "favoravel" });
  }, 60_000);

  it("J1) gerar justificativa devolve SUGESTÃO — nada persistido, nenhum documento oficial", async () => {
    const ws = await seedDirect(ORG, "J1");
    const res = await generateContractJustification({ workspaceId: ws.id, organizationId: ORG, correlationId: CORR });
    expect(res.suggestion).toBeTruthy();
    expect(res.justification).toBeNull();
    expect(res.recommendation.rejectable).toBe(true);
    expect(await getContractJustification(ws.id, ORG)).toBeNull();
    expect(await listOfficialDocuments(ORG, { businessDomain: "contratacao_direta", origin: ws.id })).toEqual([]);
  }, 120_000);

  it("J2) aceite com campos centrais curtos ⇒ BAD_REQUEST JUSTIFICATION_FIELDS_REQUIRED — zero escrita", async () => {
    const ws = await seedDirect(ORG, "J2");
    const before = await counts(ORG);
    const e = await errOf(() => acceptContractJustification({
      workspaceId: ws.id, organizationId: ORG, actorUserId: ACTOR, basedOnSuggestion: false, correlationId: CORR,
      fields: { need: "curta", publicInterest: "", motivation: "", legalFoundation: "Art. 75, II", benefits: "", alternatives: "" },
    }));
    expect(e.code).toBe("BAD_REQUEST");
    expect(e.message).toContain("JUSTIFICATION_FIELDS_REQUIRED");
    expect(await counts(ORG)).toEqual(before);
  }, 60_000);

  it("J3) aceite humano persiste e gera o documento oficial com o autor humano", async () => {
    const ws = await seedDirect(ORG, "J3");
    await acceptContractJustification({
      workspaceId: ws.id, organizationId: ORG, actorUserId: ACTOR, basedOnSuggestion: true, correlationId: CORR,
      fields: { need: "Necessidade sintética do órgão.", publicInterest: "", motivation: "Motivação sintética revisada.", legalFoundation: "Art. 75, II, da Lei 14.133/2021.", benefits: "", alternatives: "" },
    });
    expect(await getContractJustification(ws.id, ORG)).toMatchObject({ need: "Necessidade sintética do órgão." });
    expect(await authorsOf(ws.id, "justificativa_contratacao")).toEqual([String(ACTOR)]);
  }, 60_000);

  it("J4) preço: vazio, valor ≤ 0 ou sem confirmação ⇒ recusa sem escrita; válido ⇒ autor humano", async () => {
    const ws = await seedDirect(ORG, "J4");
    const before = await counts(ORG);
    const base = { workspaceId: ws.id, organizationId: ORG, source: "manual" as const, correlationId: CORR, actorUserId: ACTOR };
    expect((await errOf(() => generatePriceJustification({ ...base, justification: "", referenceValue: 100, confirmOfficial: true }))).code).toBe("BAD_REQUEST");
    expect((await errOf(() => generatePriceJustification({ ...base, justification: "Três cotações válidas.", referenceValue: 0, confirmOfficial: true }))).code).toBe("BAD_REQUEST");
    const noConfirm = await errOf(() => generatePriceJustification({ ...base, justification: "Três cotações válidas.", referenceValue: 100 }));
    expect(noConfirm.code).toBe("PRECONDITION_FAILED");
    expect(noConfirm.message).toContain("HUMAN_APPROVAL_REQUIRED");
    expect(await counts(ORG)).toEqual(before);

    await generatePriceJustification({ ...base, justification: "Três cotações válidas.", referenceValue: 100, confirmOfficial: true });
    expect(await getPriceJustification(ws.id, ORG)).toMatchObject({ justification: "Três cotações válidas.", referenceValue: 100 });
    expect(await authorsOf(ws.id, "justificativa_preco")).toEqual([String(ACTOR)]);
  }, 60_000);

  it("J5) órgão B não lê nem aceita no workspace do órgão A", async () => {
    const ws = await seedDirect(ORG, "J5");
    expect(await getContractJustification(ws.id, ORG_B)).toBeNull();
    const before = await counts(ORG);
    const e = await errOf(() => acceptContractJustification({
      workspaceId: ws.id, organizationId: ORG_B, actorUserId: ACTOR, basedOnSuggestion: false, correlationId: CORR,
      fields: { need: "Necessidade cross-tenant.", publicInterest: "", motivation: "Motivação cross-tenant.", legalFoundation: "Fundamento cross-tenant.", benefits: "", alternatives: "" },
    }));
    expect(e.message).toMatch(/não encontrado/);
    expect(await counts(ORG)).toEqual(before);
    expect(await counts(ORG_B)).toEqual(Object.fromEntries(TABLES.map(t => [t, 0])));
  }, 60_000);
});

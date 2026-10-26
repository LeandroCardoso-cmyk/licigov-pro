/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * M8 — GOVERNANÇA DOS PREÇOS DE REFERÊNCIA contra MySQL REAL (política aprovada pelo Owner em 20/10/2026).
 * Só roda com DATABASE_URL (banco ISOLADO de teste). Organizações SINTÉTICAS dedicadas — nunca a organização 1.
 * Provider de IA = mock determinístico. A exceção de homologação é configurada SÓ por override de teste no backend.
 *
 * Matriz (numeração da rodada):
 *  [0319] coluna aditiva/anulável; linha legada fica NULL (sem backfill).
 *  [1,2,6,7] importação real: "Fornecedor Fictício A" ⇒ ficticia; "Papelaria Teste & Cia" ⇒ declarada; nada verificada.
 *  [8,9]  reimportação (upsert por id): declaração fictícia prevalece; mesmo conteúdo preserva ficticia/verificada;
 *         remover a nota não "esquenta"; valor alterado ⇒ proveniência nova.
 *  [19]   aprovação operacional permitida; painel declara a referência suspensa + risco derivado.
 *  [11,17,23] referência canônica FICTITIOUS_SOURCE (Itens da contratação).
 *  [20,21,24,22] ETP legado traz o preço SUSPENSO; remover [REVISAR] no editor e emitir ⇒ EMISSION_FICTITIOUS_PRICES.
 *  [26,27,28] documento oficial emitido antes permanece intacto; replay converge; proveniência alterada entre a
 *         revisão e a emissão ⇒ nova emissão recusada (reavaliada no instante da emissão).
 *  [25,18] Justificativa de Preço da Contratação Direta: fictícia excluída; só fictícias ⇒ PRICE_RESEARCH_FICTITIOUS.
 *  [29]   viewer não importa nem emite. [30] outro órgão não lê nada do órgão A.
 *  [31,33,37,38] homologação sintética autorizada: referência demonstrativa e emissão de homologação permitidas, com a
 *         marcação [REVISAR] de fonte fictícia mantida; org listada sem o slug sintético ⇒ sem exceção.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import { generateDocument } from "../../services/procurementProcessService";
import { buildMockProviderAuthoring } from "../../services/authoring/structuredAuthoringService";
import { resolveProcurementContext } from "../../services/canonicalContextService";
import { getItemPanel } from "../../services/itemIntelligenceService";
import { __setHomologationConfigForTests, demonstrativePricesAllowed } from "../../services/priceGovernanceService";
import { insertResearchItem, listQuoteProvenance } from "../../db/procurement";
import { createPriceResearchItem } from "../../domain/priceResearch";
import { draftContentHash } from "../../domain/generatedDocument";
import { FICTITIOUS_PRICE_CELL_TEXT, fictitiousQuotesReviewText } from "../../domain/authoritativeItems";
import { assertPriceLineageStillEligible, generatePriceJustification, listPriceResearchesForJustification } from "../../services/directProcurementService";
import { encodeLineage } from "../../domain/directPriceReference";
import { resolveDocumentAuthoringContext } from "../../services/authoring/authoringContext";

const DB = process.env.DATABASE_URL;
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";
const ORG_R = 991901; // órgão sintético "real-like" (sem exceção)
const ORG_H = 991902; // homologação sintética autorizada (slug homologacao-sintetica)
const ORG_B = 991903; // outro órgão (isolamento)
const ORGS = [ORG_R, ORG_H, ORG_B];
const OBJ = "Material de expediente (M8 proveniência)";
const stamp = Date.now();
const FICT_TEXT = "Caneta azul;10;UN;R$ 1,50;Fornecedor Fictício A\nCaneta azul;10;UN;R$ 1,70;Fornecedor Fictício B";
const REAL_TEXT = "Lápis HB;20;UN;R$ 0,90;Papelaria Alfa\nLápis HB;20;UN;R$ 1,10;Papelaria Teste & Cia";

let conn: mysql.Connection;
const U: Record<string, number> = {};
const parked: number[] = [];

async function caller(user: number, org: number) {
  const { appRouter } = await import("../../routers");
  return appRouter.createCaller({
    user: { id: user, role: "user", name: `M8 ${user}`, email: `m8prov-${user}@teste.local` },
    req: { headers: { "x-organization-id": String(org) }, ip: "127.0.0.1" }, res: {},
    correlationId: `m8prov-${Math.random().toString(36).slice(2, 10)}`,
  } as unknown as Parameters<typeof appRouter.createCaller>[0]);
}
const rows = async (q: string, p: unknown[]) => (await conn.execute<mysql.RowDataPacket[]>(q, p))[0];
const errOf = async (fn: () => Promise<unknown>) => {
  try { await fn(); } catch (e) { const x = e as { code?: string; message?: string }; return { code: x.code ?? "ERR", message: x.message ?? "" }; }
  return { code: "RESOLVED", message: "" };
};
const K = (t: string) => `m8prov-${t}-${stamp}`;

async function newProcess(user: number, org: number, tag: string): Promise<string> {
  const { process } = await (await caller(user, org)).procurementProcess.createProcess({ processNumber: `M8P-${tag}-${stamp}`, object: OBJ, startOption: "iniciar_pesquisa" });
  return process.id;
}
async function importAndApprove(user: number, org: number, pid: string, text: string) {
  const c = await caller(user, org);
  await c.procurementProcess.importPriceResearch({ processId: pid, source: "colar", text });
  const { items } = await c.procurementProcess.listItems({ processId: pid });
  for (const it of items) await c.procurementProcess.approveItem({ itemId: it.id });
  return (await c.procurementProcess.listItems({ processId: pid })).items;
}
const genEtp = (org: number, pid: string, author: number, key: string) => generateDocument({
  organizationId: org, processId: pid, kind: "etp", object: OBJ, correlationId: K(key), idempotencyKey: K(key), actorUserId: author,
  invoke: async () => buildMockProviderAuthoring("etp"),
});
/** Simula o servidor removendo TODOS os avisos no editor (caminho governado de edição). */
async function stripReviewMarkers(user: number, org: number, pid: string, key: string): Promise<string> {
  const c = await caller(user, org);
  const draft = await c.procurementProcess.reviewableDraft({ processId: pid, kind: "etp" }) as any;
  const content = String(draft.draft?.content ?? "");
  const edited = content.replace(/\[REVISAR\b/g, "[NOTA");
  await c.procurementProcess.saveReviewableDraft({ processId: pid, kind: "etp", content: edited, expectedContentHash: draftContentHash(content), idempotencyKey: K(key) });
  return draftContentHash(edited);
}

async function cleanup() {
  for (const org of ORGS) {
    for (const [t, col] of [
      ["official_document_promotions", "organization_id"], ["official_document_timeline", "tenant_id"], ["official_documents", "tenant_id"],
      ["procurement_item_events", "organization_id"], ["procurement_item_source_links", "organization_id"], ["procurement_items", "organization_id"],
      ["procurement_lots", "organization_id"], ["procurement_context_facts", "organization_id"], ["generated_document_edits", "organization_id"],
      ["generated_documents", "organization_id"], ["process_timeline", "organization_id"], ["item_risks", "organization_id"],
      ["item_recommendations", "organization_id"], ["catmat_matches", "organization_id"], ["intelligent_items", "organization_id"],
      ["price_research_items", "organization_id"], ["price_research", "organization_id"], ["import_promotions", "organizationId"],
      ["import_sessions", "organizationId"], ["direct_price_justifications", "organization_id"], ["direct_procurement_workspaces", "organization_id"],
      ["procurement_processes", "organization_id"], ["idempotency_keys", "organizationId"], ["activity_logs", "organizationId"],
      ["organization_members", "organizationId"],
    ] as const) {
      await conn.execute(`DELETE FROM ${t} WHERE ${col} = ?`, [org]).catch(() => {});
    }
  }
}

describe.skipIf(!DB)("M8 — governança dos preços de referência (MySQL estrito, órgãos sintéticos)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await conn.query(`SET SESSION sql_mode = '${STRICT}'`);
    await cleanup();
    // Slug sintético é ÚNICO: outra linha do banco ISOLADO com o mesmo slug é "estacionada" e restaurada no teardown
    // (a org 1 nunca é tocada; se fosse ela, a suíte aborta).
    const clash = await rows("SELECT id FROM organizations WHERE slug = 'homologacao-sintetica' AND id <> ?", [ORG_H]);
    if (clash.some((r) => Number(r.id) === 1)) throw new Error("org 1 com slug sintético — suíte abortada (dados reais protegidos)");
    for (const r of clash) {
      parked.push(Number(r.id));
      await conn.execute("UPDATE organizations SET slug = ? WHERE id = ?", [`homologacao-sintetica-parked-${stamp}`.slice(0, 64), Number(r.id)]);
    }
    for (const [id, nome, slug] of [
      [ORG_R, "Prefeitura Sintética M8 (sem exceção)", `m8prov-real-${stamp}`],
      [ORG_H, "Homologação Sintética M8", "homologacao-sintetica"],
      [ORG_B, "Outra Prefeitura Sintética M8", `m8prov-b-${stamp}`],
    ] as const) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome), slug = VALUES(slug)", [id, nome, slug]);
    }
    for (const tag of ["owner", "emitter", "viewer", "ownerH", "emitterH", "ownerB"]) {
      const [r] = await conn.execute<mysql.ResultSetHeader>("INSERT INTO users (openId, name, email, role) VALUES (?, ?, ?, 'user')",
        [`m8prov-${tag}-${stamp}`, `M8 ${tag}`, `m8prov-${tag}-${stamp}@teste.local`]);
      U[tag] = r.insertId;
    }
    for (const [org, u, role] of [
      [ORG_R, U.owner, "owner"], [ORG_R, U.emitter, "manager"], [ORG_R, U.viewer, "viewer"],
      [ORG_H, U.ownerH, "owner"], [ORG_H, U.emitterH, "manager"], [ORG_B, U.ownerB, "owner"],
    ] as const) {
      await conn.execute("INSERT INTO organization_members (organizationId, userId, role, ativo) VALUES (?, ?, ?, 1)", [org, u, role]);
    }
    // Exceção de homologação: SÓ a org sintética, ambiente não produtivo (override de teste no backend).
    __setHomologationConfigForTests({ allowedOrgIds: [ORG_H], appEnv: "staging" });
  }, 300_000);

  afterAll(async () => {
    __setHomologationConfigForTests(null);
    if (!conn) return;
    await cleanup().catch(() => {});
    const ids = Object.values(U).filter(Boolean);
    if (ids.length) await conn.execute(`DELETE FROM users WHERE id IN (${ids.map(() => "?").join(",")})`, ids).catch(() => {});
    await conn.execute(`DELETE FROM organizations WHERE id IN (?, ?, ?)`, ORGS).catch(() => {});
    for (const id of parked) await conn.execute("UPDATE organizations SET slug = 'homologacao-sintetica' WHERE id = ?", [id]).catch(() => {});
    await conn.end();
  });

  it("[0319] coluna aditiva e anulável; linha legada sem proveniência permanece NULL (sem backfill)", { timeout: 120_000 }, async () => {
    const cols = await rows(
      "SELECT IS_NULLABLE n, DATA_TYPE t, CHARACTER_MAXIMUM_LENGTH l FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'price_research_items' AND COLUMN_NAME = 'provenance_kind'", []);
    expect(cols).toHaveLength(1);
    expect(cols[0]).toMatchObject({ n: "YES", t: "varchar" });
    await conn.execute("INSERT INTO price_research_items (id, organization_id, research_id, process_id, description, supplier, value) VALUES (?, ?, 'legacyres', 'legacyproc', 'Item legado', 'Comercial Beta', 10)", [`lg${stamp}`.slice(0, 20), ORG_R]);
    const [r] = await rows("SELECT provenance_kind k FROM price_research_items WHERE id = ?", [`lg${stamp}`.slice(0, 20)]);
    expect(r.k).toBeNull();
    const prov = await listQuoteProvenance(ORG_R, [`lg${stamp}`.slice(0, 20)]);
    expect(prov.get(`lg${stamp}`.slice(0, 20))).toMatchObject({ stored: null, legacyMarker: false, supplier: "Comercial Beta", valueCents: 1000 });
  });

  let pidLegacy = "";
  it("[1,2,6,7,19] importação real grava a proveniência explícita; aprovação operacional segue disponível, sem promover o preço", { timeout: 120_000 }, async () => {
    pidLegacy = await newProcess(U.owner, ORG_R, "leg");
    const items = await importAndApprove(U.owner, ORG_R, pidLegacy, `${FICT_TEXT}\n${REAL_TEXT}`);
    expect(items.every((i: any) => i.status === "aprovado")).toBe(true);
    const kinds = await rows("SELECT supplier, provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ? ORDER BY supplier", [ORG_R, pidLegacy]);
    expect(kinds.map((r) => [r.supplier, r.k])).toEqual([
      ["Fornecedor Fictício A", "ficticia"], ["Fornecedor Fictício B", "ficticia"], ["Papelaria Alfa", "declarada"], ["Papelaria Teste & Cia", "declarada"],
    ]);
    expect(kinds.some((r) => r.k === "verificada")).toBe(false);
    const caneta = items.find((i: any) => /Caneta/.test(i.description));
    const lapis = items.find((i: any) => /Lápis/.test(i.description));
    expect(caneta.fictitiousQuoteCount).toBe(2);
    expect(lapis.fictitiousQuoteCount).toBe(0);
    const panel = await getItemPanel(caneta.id, ORG_R);
    expect(panel.governance).toMatchObject({ referenceBlockedReason: "FICTITIOUS_SOURCE", fictitiousQuoteCount: 2 });
    expect(panel.governance!.quoteSetText).toContain("2 identificada(s) como fictícia(s)");
    expect(panel.risks.some((r) => r.type === "fonte_ficticia")).toBe(true);
    expect((await getItemPanel(lapis.id, ORG_R)).governance!.referenceBlockedReason).toBeNull();
  });

  it("[8,9] reimportação por id: declaração fictícia prevalece; mesmo conteúdo preserva ficticia/verificada; valor novo ⇒ proveniência nova", { timeout: 120_000 }, async () => {
    const mk = (id: string, supplier: string, value: number, provenanceKind: "ficticia" | "declarada") => ({
      ...createPriceResearchItem({ researchId: "m8reimp", processId: "m8reimp", organizationId: ORG_R, description: "Caneta", unit: "UN", quantity: 1, value, supplier, provenanceKind, source: "colar" }),
      id: `${id}${stamp}`.slice(0, 20),
    });
    const kindOf = async (id: string) => String((await rows("SELECT provenance_kind k FROM price_research_items WHERE id = ?", [`${id}${stamp}`.slice(0, 20)]))[0].k);
    await insertResearchItem(mk("ra", "Alfa", 10, "ficticia"));
    await insertResearchItem(mk("ra", "Alfa", 10, "declarada")); // nota removida no texto reimportado
    expect(await kindOf("ra")).toBe("ficticia");
    await insertResearchItem(mk("ra", "Alfa", 12, "declarada")); // outro conteúdo econômico
    expect(await kindOf("ra")).toBe("declarada");
    await insertResearchItem(mk("rb", "Beta", 10, "declarada"));
    await insertResearchItem(mk("rb", "Beta", 10, "ficticia")); // nova declaração explícita
    expect(await kindOf("rb")).toBe("ficticia");
    await insertResearchItem(mk("rc", "Gama", 10, "declarada"));
    await conn.execute("UPDATE price_research_items SET provenance_kind = 'verificada' WHERE id = ?", [`rc${stamp}`.slice(0, 20)]); // procedimento legítimo (simulado no banco de teste)
    await insertResearchItem(mk("rc", "Gama", 10, "declarada"));
    expect(await kindOf("rc")).toBe("verificada");
  });

  it("[auditoria P1-1] item APROVADO: reimportar a linha com outro fornecedor não 'esquenta' o retrato fictício preservado", { timeout: 120_000 }, async () => {
    const pid = await newProcess(U.owner, ORG_R, "p11");
    const items = await importAndApprove(U.owner, ORG_R, pid, "Observação: os valores são fictícios\nCola branca;5;UN;R$ 3,00;Empresa X\nCola branca;5;UN;R$ 3,50;Empresa Y");
    expect(items[0].fictitiousQuoteCount).toBe(2);
    const quotes = await rows("SELECT id, research_id r FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG_R, pid]);
    for (const q of quotes) {
      await insertResearchItem({
        ...createPriceResearchItem({ researchId: String(q.r), processId: pid, organizationId: ORG_R, description: "Cola branca", unit: "UN", quantity: 5, value: 3, supplier: "Empresa Z", provenanceKind: "declarada", source: "colar" }),
        id: String(q.id),
      });
    }
    expect((await rows("SELECT DISTINCT provenance_kind k FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG_R, pid])).map((r) => r.k)).toEqual(["declarada"]);
    const after = (await (await caller(U.owner, ORG_R)).procurementProcess.listItems({ processId: pid })).items[0] as any;
    expect(after.status).toBe("aprovado");
    expect(after.fictitiousQuoteCount).toBe(2); // o item continua usando o retrato fictício ⇒ continua suspenso
    expect((await getItemPanel(after.id, ORG_R)).governance!.referenceBlockedReason).toBe("FICTITIOUS_SOURCE");
  });

  it("[20,21,22,24,27,29] ETP legado: preço SUSPENSO no documento; remover [REVISAR] no editor e emitir ⇒ EMISSION_FICTITIOUS_PRICES", { timeout: 120_000 }, async () => {
    const { document } = await genEtp(ORG_R, pidLegacy, U.owner, "etp-leg");
    // Estimativa do servidor: só o Lápis (20 × R$ 1,00); a Caneta fictícia (10 × R$ 1,60 = R$ 16,00) fica FORA.
    expect(document.content).toContain("R$ 20,00");
    expect(document.content).not.toContain("R$ 36,00");
    expect(document.content).toContain("1 item(ns) sem preço de referência não entram no total");
    const auth = await resolveDocumentAuthoringContext({ organizationId: ORG_R, processId: pidLegacy, kind: "tr", object: OBJ });
    expect(auth.authoritativeBlock).toContain(FICTITIOUS_PRICE_CELL_TEXT); // quadro autoritativo (TR) — célula suspensa
    // M8 (pós-homologação visual) — o resumo de fontes distingue a cotação fictícia e o item suspenso (mesmo `estimate` do quadro).
    const src = await (await caller(U.owner, ORG_R)).procurementProcess.authoringSourceState({ processId: pidLegacy, kind: "tr", object: OBJ });
    expect(src.summary).toMatchObject({ pricedItems: 1, unpricedItems: 1, priceSuspendedItems: 1, fictitiousPriceItems: 1, estimatedGlobalTotalCents: 2000 });
    expect(src.summary.fictitiousQuoteCount).toBeGreaterThan(0);
    expect(src.summary.fictitiousQuoteCount).toBeLessThan(src.summary.quoteCount);
    const hash = await stripReviewMarkers(U.owner, ORG_R, pidLegacy, "strip-leg");
    const em = await caller(U.emitter, ORG_R);
    const summary = await em.procurementProcess.officialSummary({ processId: pidLegacy, kind: "etp" });
    expect(summary.blockers.map((b: any) => b.code)).toEqual(["EMISSION_FICTITIOUS_PRICES"]);
    const e = await errOf(() => em.procurementProcess.promoteOfficial({ processId: pidLegacy, kind: "etp", idempotencyKey: K("emit-leg"), expectedContentHash: hash }));
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(e.message).toContain("(EMISSION_FICTITIOUS_PRICES)");
    expect(e.message).not.toContain("EMISSION_REVIEW_MARKERS");
    // [27] mesma chave de novo ⇒ reavalia e recusa de novo (nenhuma versão oficial criada).
    expect((await errOf(() => em.procurementProcess.promoteOfficial({ processId: pidLegacy, kind: "etp", idempotencyKey: K("emit-leg"), expectedContentHash: hash }))).message).toContain("EMISSION_FICTITIOUS_PRICES");
    expect(await rows("SELECT id FROM official_documents WHERE tenant_id = ? AND origin_id = ?", [ORG_R, pidLegacy]).catch(() => [])).toHaveLength(0);
    // [29] viewer não emite nem importa.
    const v = await caller(U.viewer, ORG_R);
    expect((await errOf(() => v.procurementProcess.promoteOfficial({ processId: pidLegacy, kind: "etp", idempotencyKey: K("emit-viewer"), expectedContentHash: hash }))).code).toBe("FORBIDDEN");
    expect((await errOf(() => v.procurementProcess.importPriceResearch({ processId: pidLegacy, source: "colar", text: REAL_TEXT }))).code).toBe("FORBIDDEN");
  });

  it("[11,17,23] Itens da contratação: referência canônica suspensa (FICTITIOUS_SOURCE), total não estimado", { timeout: 120_000 }, async () => {
    const pid = await newProcess(U.owner, ORG_R, "can");
    await importAndApprove(U.owner, ORG_R, pid, FICT_TEXT);
    const c = await caller(U.owner, ORG_R);
    const p = await c.procurementItems.candidates({ processId: pid, source: "price_research" });
    await c.procurementItems.confirmCandidates({
      processId: pid, source: "price_research", expectedSourceDigest: p.sourceDigest, idempotencyKey: K(`confirm-${pid}`),
      decisions: p.candidates.map((x: any) => ({ candidateKey: x.candidateKey, action: "create" as const })),
    });
    const ws = await c.procurementItems.workspace({ processId: pid });
    const it0 = ws.items[0] as any;
    await c.procurementItems.setQuantities({ processId: pid, idempotencyKey: K(`qty-${pid}`), changes: [{ itemId: it0.id, expectedRevision: it0.revision, mode: "informed", quantity: "10" }] });
    const ctx = await resolveProcurementContext({ organizationId: ORG_R, processId: pid });
    expect(ctx.items[0].priceContext).toMatchObject({ unitReferencePriceCents: null, priceBlockedReason: "FICTITIOUS_SOURCE" });
    expect(ctx.priceContext.estimatedTotalCents).toBeNull();
    const after = (await c.procurementItems.workspace({ processId: pid })).items[0] as any;
    expect(after.priceBlockedReason).toBe("FICTITIOUS_SOURCE");
    // M8 (pós-homologação visual) — nenhum item com preço de referência: o resumo expõe o motivo (a UI mostra "indisponível", não R$ 0,00).
    const src = await c.procurementProcess.authoringSourceState({ processId: pid, kind: "tr", object: OBJ });
    expect(src.summary).toMatchObject({ pricedItems: 0, estimatedGlobalTotalCents: 0, fictitiousPriceItems: src.summary.unpricedItems });
    expect(src.summary.fictitiousPriceItems).toBeGreaterThan(0);
    expect(src.summary.fictitiousQuoteCount).toBe(src.summary.quoteCount);
  });

  it("[26,27,28] oficial emitido com fonte real permanece intacto; proveniência alterada depois ⇒ nova emissão recusada; replay converge", { timeout: 120_000 }, async () => {
    const pid = await newProcess(U.owner, ORG_R, "off");
    await importAndApprove(U.owner, ORG_R, pid, REAL_TEXT);
    await genEtp(ORG_R, pid, U.owner, "etp-off");
    const hash = await stripReviewMarkers(U.owner, ORG_R, pid, "strip-off");
    const em = await caller(U.emitter, ORG_R);
    const ok = await em.procurementProcess.promoteOfficial({ processId: pid, kind: "etp", idempotencyKey: K("emit-off"), expectedContentHash: hash });
    expect(ok.promoted).toBe(true);
    const before = await rows("SELECT id, CAST(content AS CHAR) c FROM official_documents WHERE id = ?", [ok.officialDocument.id]);
    // Replay: mesma chave + mesmo conteúdo ⇒ converge sem nova versão.
    const again = await em.procurementProcess.promoteOfficial({ processId: pid, kind: "etp", idempotencyKey: K("emit-off"), expectedContentHash: hash });
    expect(again).toMatchObject({ replayed: true, promoted: false });
    // A reimportação passa a DECLARAR fictícia uma cotação (upsert por id) — muda a fonte DEPOIS da revisão.
    const [q] = await rows("SELECT id, research_id r, supplier s, value v FROM price_research_items WHERE organization_id = ? AND process_id = ? AND supplier = 'Papelaria Alfa'", [ORG_R, pid]);
    await insertResearchItem({
      ...createPriceResearchItem({ researchId: String(q.r), processId: pid, organizationId: ORG_R, description: "Lápis HB", unit: "UN", quantity: 20, value: Number(q.v), supplier: String(q.s), provenanceKind: "ficticia", source: "colar" }),
      id: String(q.id),
    });
    const after = await rows("SELECT id, CAST(content AS CHAR) c FROM official_documents WHERE id = ?", [ok.officialDocument.id]);
    expect(after).toEqual(before); // documento oficial imutável
    const c = await caller(U.owner, ORG_R);
    const draft = await c.procurementProcess.reviewableDraft({ processId: pid, kind: "etp" }) as any;
    const content = String(draft.draft?.content ?? "");
    await c.procurementProcess.saveReviewableDraft({ processId: pid, kind: "etp", content: `${content}\n\nAjuste pós-emissão.`, expectedContentHash: draftContentHash(content), idempotencyKey: K("edit-off") });
    const h2 = draftContentHash(`${content}\n\nAjuste pós-emissão.`);
    const e = await errOf(() => em.procurementProcess.promoteOfficial({ processId: pid, kind: "etp", idempotencyKey: K("emit-off-2"), expectedContentHash: h2 }));
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(e.message).toContain("EMISSION_FICTITIOUS_PRICES");
    expect(await rows("SELECT id FROM official_document_promotions WHERE organization_id = ? AND process_id = ?", [ORG_R, pid])).toHaveLength(1);
  });

  it("[25,18] Justificativa de Preço (Contratação Direta): fictícia excluída do cálculo; só fictícias ⇒ PRICE_RESEARCH_FICTITIOUS", { timeout: 120_000 }, async () => {
    const c = await caller(U.owner, ORG_R);
    const ws1 = (await c.directProcurement.createProcess({ processNumber: `M8D1-${stamp}`, object: "Dispensa M8", procurementType: "dispensa", startOption: "sem_dfd" })).workspace.id;
    await c.directProcurement.importPriceResearch({ workspaceId: ws1, source: "colar", idempotencyKey: K("dpi1"),
      text: "Caneta azul;10;un;1,00;Papelaria Alfa\nCaneta azul;10;un;2,00;Comercial Beta\nCaneta azul;10;un;100,00;Fornecedor Fictício A" });
    const [r1] = await listPriceResearchesForJustification(ws1, ORG_R);
    expect(r1).toMatchObject({ consistent: true, excludedFictitiousQuoteCount: 1, values: { media: 15, mediana: 15, menor_preco: 10 } });
    const out = await generatePriceJustification({ workspaceId: ws1, organizationId: ORG_R, source: "pesquisa", method: "media", justification: "Preço de referência pela média das cotações elegíveis (sintético).", correlationId: K("pj1"), confirmOfficial: true, actorUserId: U.owner });
    expect(out.lineage).toMatchObject({ kind: "pesquisa", computedValue: 15, excludedFictitiousQuoteCount: 1 });
    const ws2 = (await c.directProcurement.createProcess({ processNumber: `M8D2-${stamp}`, object: "Dispensa M8 fictícia", procurementType: "dispensa", startOption: "sem_dfd" })).workspace.id;
    await c.directProcurement.importPriceResearch({ workspaceId: ws2, source: "colar", idempotencyKey: K("dpi2"), text: "Caneta azul;10;un;1,00;Fornecedor Fictício A\nCaneta azul;10;un;2,00;Fornecedor Fictício B" });
    const e = await errOf(() => generatePriceJustification({ workspaceId: ws2, organizationId: ORG_R, source: "pesquisa", method: "media", justification: "Tentativa com cotações fictícias apenas (sintético).", correlationId: K("pj2"), confirmOfficial: true, actorUserId: U.owner }));
    expect(e.code).toBe("PRECONDITION_FAILED");
    expect(e.message).toContain("PRICE_RESEARCH_FICTITIOUS");
    expect(await rows("SELECT id FROM direct_price_justifications WHERE organization_id = ? AND workspace_id = ?", [ORG_R, ws2]).catch(() => [])).toHaveLength(0);
    // [auditoria P2-2] Ratificação revalida a linhagem: valor legado que incluía a cotação fictícia ⇒ recusa.
    await expect(assertPriceLineageStillEligible(ws1, ORG_R, [encodeLineage(out.lineage)])).resolves.toBeUndefined();
    const legacy = { ...(out.lineage as any), computedValue: 343.33, excludedFictitiousQuoteCount: undefined };
    const p22 = await errOf(() => assertPriceLineageStillEligible(ws1, ORG_R, [encodeLineage(legacy)]));
    expect(p22.code).toBe("PRECONDITION_FAILED");
    expect(p22.message).toContain("PRICE_RESEARCH_FICTITIOUS");
    const [only] = await listPriceResearchesForJustification(ws2, ORG_R);
    const p22b = await errOf(() => assertPriceLineageStillEligible(ws2, ORG_R, [encodeLineage({ ...(out.lineage as any), researchId: only.researchId })]));
    expect(p22b.message).toContain("PRICE_RESEARCH_FICTITIOUS");
    await expect(assertPriceLineageStillEligible(ws2, ORG_R, ["Cotação manual 1"])).resolves.toBeUndefined(); // sem linhagem de pesquisa
  });

  it("[30] outro órgão não lê item, proveniência nem contexto do órgão A", { timeout: 120_000 }, async () => {
    const items = (await (await caller(U.owner, ORG_R)).procurementProcess.listItems({ processId: pidLegacy })).items;
    const b = await caller(U.ownerB, ORG_B);
    expect((await b.itemIntelligence.getItem({ itemId: items[0].id })).item).toBeNull();
    const ids = (await rows("SELECT id FROM price_research_items WHERE organization_id = ? AND process_id = ?", [ORG_R, pidLegacy])).map((r) => String(r.id));
    expect((await listQuoteProvenance(ORG_B, ids)).size).toBe(0);
    expect((await errOf(() => resolveProcurementContext({ organizationId: ORG_B, processId: pidLegacy }))).code).toBe("NOT_FOUND");
  });

  it("[31,33,37,38] homologação sintética autorizada: referência demonstrativa e emissão permitidas, com a marcação mantida", { timeout: 120_000 }, async () => {
    expect(await demonstrativePricesAllowed(ORG_H)).toBe(true);
    __setHomologationConfigForTests({ allowedOrgIds: [ORG_H, ORG_R], appEnv: "staging" });
    expect(await demonstrativePricesAllowed(ORG_R)).toBe(false); // [33] listada, mas o slug REAL não é o sintético
    __setHomologationConfigForTests({ allowedOrgIds: [ORG_H], appEnv: "production" });
    expect(await demonstrativePricesAllowed(ORG_H)).toBe(false); // [34] produção
    __setHomologationConfigForTests({ allowedOrgIds: [ORG_H], appEnv: "staging" });

    const pid = await newProcess(U.ownerH, ORG_H, "hom");
    const items = await importAndApprove(U.ownerH, ORG_H, pid, FICT_TEXT);
    expect((await getItemPanel(items[0].id, ORG_H)).governance!.referenceBlockedReason).toBeNull();
    const { document } = await genEtp(ORG_H, pid, U.ownerH, "etp-hom");
    expect(document.content).toContain("R$ 16,00"); // valor demonstrativo flui na homologação autorizada
    const auth = await resolveDocumentAuthoringContext({ organizationId: ORG_H, processId: pid, kind: "tr", object: OBJ });
    expect(auth.authoritativeBlock).not.toContain(FICTITIOUS_PRICE_CELL_TEXT);
    expect(auth.authoritativeBlock).toContain(fictitiousQuotesReviewText(2)); // [37] continua demonstrativo e marcado
    const hash = await stripReviewMarkers(U.ownerH, ORG_H, pid, "strip-hom");
    const ok = await (await caller(U.emitterH, ORG_H)).procurementProcess.promoteOfficial({ processId: pid, kind: "etp", idempotencyKey: K("emit-hom"), expectedContentHash: hash });
    expect(ok.promoted).toBe(true); // [38] jornada de homologação continua operacional
  });
});

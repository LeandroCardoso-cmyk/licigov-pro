/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HOMOLOGAÇÃO E2E (HTTP real) — tenant `homologacao-sintetica`, pelas APIs OFICIAIS que a tela usa.
 * Pulado sem `HOMOLOG_BASE_URL` (CI e suíte local não o executam). Uso (ver scripts/homologation-e2e.ts):
 *
 *   HOMOLOG_BASE_URL=https://licigov-pro-staging.up.railway.app HOMOLOG_EXERCICIO=2026 [HOMOLOG_ORGANIZATION_ID=2] \
 *   HOMOLOG_EMAIL=… HOMOLOG_PASSWORD=… HOMOLOG_EMAIL_2=… HOMOLOG_PASSWORD_2=… \
 *   [HOMOLOG_REPORT=relatorio.json] pnpm homolog:e2e
 *
 * Usuário 1 elabora; usuário 2 (outro membro do tenant sintético) emite o TR oficial — segregação de funções real.
 *
 *  A  DFD → ETP → TR (emitido) → Edital BLL Revisão 2 (minuta; datas de publicação diferidas) → DOCX/PDF + replay.
 *     Sem modelo BLL Revisão 2 vinculado no tenant sintético ⇒ FALHA explícita (nunca troca silenciosa pelo Edital genérico).
 *  B  registro legado → contrato vigente (com histórico DECLARADO de aditivos) → aditivo de prazo com novo término
 *     (reagenda a vigência) → termo DOCX/PDF + replay.
 *  C  contrato externo com término → vencimento + alertas no calendário (sem duplicidade) → Centro de Operações.
 *  ISO  órgão alheio recusado.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import * as mammoth from "mammoth";
import {
  AI_META_RESIDUE, M8_PRICE_RESEARCH_TEXT, MARK, assertAllowedTarget, assertOrgRoleAtLeast, parseOrganizationId, assertSyntheticCredential, assertSyntheticTenant, directCallAdapter, homologSession, looksLike,
  assertDemonstrativePricesEnabled, assertDistinctIdentities, classifyLoginError,
  parseExercicio, pendingMarkers, priceImportMode, priceResearchCsv, runCanonicalPriceResearch, syntheticDecision, syntheticProcessNumber, technicalResidue, trpcCode,
} from "../../../scripts/homologation-e2e";
import { completeProfile, fillTrParams, scenarioValueByName, setBudgetDisclosure, setItemsParticipation, type ReuseHarness } from "../helpers/contextReuseHelpers";
import { buildSavePlan, executeSavePlan, isStaleSave, livePendingItems, toFormValue, type PlannedWrite } from "../../../client/src/lib/editalPreparation";
import { draftContentHash } from "../../domain/generatedDocument";

const ENV = process.env;
const BASE = ENV.HOMOLOG_BASE_URL;
const RUN = Date.now().toString(36).toUpperCase();
const TODAY = new Date().toISOString().slice(0, 10);
const plus = (d: number) => { const t = new Date(`${TODAY}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const WS = { modality: "pregao", form: "eletronico", platform: "bll" } as const;
const PUB_VARS = ["processo.numeroPregao", "controle.dataDivulgacaoPrevista", "processo.dataAbertura", "processo.horarioAbertura",
  "processo.dataInicioRecebimentoPropostas", "processo.dataFimRecebimentoPropostas", "processo.horarioFimRecebimentoPropostas"];
const ITEMS = [
  { description: `${MARK} Papel sulfite A4 75g`, unit: "resma", planned: 120, price: "25,50" },
  { description: `${MARK} Caneta esferográfica azul`, unit: "un", planned: 400, price: "1,75" },
];
const OBJ = `${MARK} Aquisição de material de expediente — execução ${RUN}`;
const REPORT: { run: string; tenant?: unknown; blocked?: string; journeys: Record<string, unknown>; metrics: Record<string, unknown>; mode: string } =
  { run: RUN, journeys: {}, metrics: {}, mode: "HTTP real (APIs oficiais); não é homologação visual" };

const download = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());
const docxText = async (b: Uint8Array) => (await mammoth.extractRawText({ buffer: Buffer.from(b) })).value;
const pdfText = async (b: Uint8Array) => {
  const { PDFParse } = (await import("pdf-parse")) as unknown as { PDFParse: new (o: { data: Uint8Array; verbosity?: number }) => { getText(): Promise<{ text: string }>; destroy(): Promise<void> } };
  const p = new PDFParse({ data: b.slice(), verbosity: 0 }); // cópia: o pdf.js transfere (desanexa) o buffer recebido
  try { return (await p.getText()).text; } finally { await p.destroy(); }
};

describe.skipIf(!BASE)("Homologação E2E — staging, tenant sintético, HTTP real", () => {
  const author = homologSession(BASE ?? "http://127.0.0.1");
  const issuer = homologSession(BASE ?? "http://127.0.0.1");
  let orgId = 0;
  let exercicio = 0;
  let decisionA: Record<string, unknown> = {};
  let k = 0;
  const key = (p: string) => `homolog-${p}-${RUN}-${++k}`;

  async function login(s: ReturnType<typeof homologSession>, email: string | undefined, password: string | undefined, who: string) {
    if (!email || !password) throw new Error("Credenciais do tenant sintético ausentes (HOMOLOG_EMAIL/HOMOLOG_PASSWORD e _2).");
    // Usuário com várias associações: o cabeçalho X-Organization-Id precisa ir já na 1ª chamada tenant-scoped (listMine).
    const pinned = parseOrganizationId(ENV.HOMOLOG_ORGANIZATION_ID);
    if (pinned) s.state.orgId = pinned;
    await s.api.auth.login.mutate({ email, password }).catch((e) => { throw classifyLoginError(e); });
    const me = await s.api.auth.me.query();
    const mine = await s.api.organizations.listMine.query();
    assertSyntheticCredential(me as any, mine.map((m) => m.org.id));
    const org = mine.map((m) => m.org).find((o) => o.slug === "homologacao-sintetica");
    assertSyntheticTenant(org);
    if (pinned && org.id !== pinned) throw new Error(`HOMOLOG_ORGANIZATION_ID=${pinned} não é o tenant sintético (${org.id}).`);
    s.state.orgId = org.id;
    const current = await s.api.organizations.getCurrent.query();
    assertSyntheticTenant(current.org);
    assertOrgRoleAtLeast(current.role, "manager", who);
    return { me: me as { id: number; name?: string | null }, org: current.org, role: current.role, current };
  }

  beforeAll(async () => {
    assertAllowedTarget(BASE!);
    exercicio = parseExercicio(ENV.HOMOLOG_EXERCICIO);
    const a = await login(author, ENV.HOMOLOG_EMAIL, ENV.HOMOLOG_PASSWORD, "usuário 1 (elabora)");
    const b = await login(issuer, ENV.HOMOLOG_EMAIL_2, ENV.HOMOLOG_PASSWORD_2, "usuário 2 (emite)");
    if (a.org.id !== b.org.id) throw new Error("Os dois usuários precisam ser do MESMO tenant sintético.");
    // Pré-flight M8 — tudo ANTES da primeira escrita: identidades distintas (SoD) e exceção de valores demonstrativos habilitada
    // para quem emite (jornada A). Bloqueio é diagnóstico de configuração (Owner), não falha de produto.
    try {
      assertDistinctIdentities(a.me, b.me);
      assertDemonstrativePricesEnabled(b.current);
    } catch (e) {
      REPORT.blocked = (e as Error).message.split(":")[0];
      throw e;
    }
    orgId = a.org.id;
    decisionA = syntheticDecision(a.me, TODAY);
    REPORT.tenant = { id: orgId, slug: a.org.slug, roles: [a.role, b.role] };
  }, 120_000);

  afterAll(() => {
    if (ENV.HOMOLOG_REPORT) writeFileSync(ENV.HOMOLOG_REPORT, JSON.stringify(REPORT, null, 2));
    console.info("[HOMOLOGACAO]", JSON.stringify(REPORT));
  });

  it("A — DFD → ETP → TR emitido → Edital BLL Revisão 2 (datas diferidas) → DOCX/PDF", async () => {
    const op = author.api;
    const mgr = issuer.api;
    // 1) Processo NNNN/AAAA (exercício explícito); colisão de número ⇒ próxima sequência (nunca reaproveita processo alheio).
    let pid = "";
    let processNumber = "";
    for (let attempt = 0; attempt < 5 && !pid; attempt++) {
      processNumber = syntheticProcessNumber(RUN, exercicio, attempt);
      try {
        pid = (await op.procurementProcess.createProcess.mutate({ processNumber, object: OBJ, startOption: "iniciar_pesquisa", modality: "pregao", requestingUnit: `${MARK} Secretaria Fictícia de Administração` })).process.id;
      } catch (e) { if (trpcCode(e) !== "CONFLICT") throw e; }
    }
    expect(pid, "processo criado").toBeTruthy();
    const h: ReuseHarness = { org: orgId, proc: () => directCallAdapter(op.procurementProcess, decisionA), tpl: () => directCallAdapter(op.institutionalTemplates, decisionA), ws: WS, processId: pid, key };

    // 1b) M8-PRICE-IMPORT-001 — prévia (sem gravação) do texto documental do caso real; texto ambíguo é recusado sem escrita.
    const prev: any = await op.procurementProcess.previewPriceResearch.mutate({ processId: pid, text: M8_PRICE_RESEARCH_TEXT });
    expect(prev.canImport).toBe(true);
    expect(prev.items).toHaveLength(1);
    expect(prev.items[0]).toMatchObject({ quantity: 10, unit: "UN", averageCents: 400000, totalCents: 4000000 });
    expect(prev.quoteCount).toBe(3);
    expect(prev.synthetic).toBe(true);
    // PR-04 (SEM-005): o modo da Pesquisa de Preços vem da capability OFICIAL do tenant (nunca presumido).
    const mode = priceImportMode(await op.ingestion.getCapabilities.query());
    REPORT.metrics.PRICE_IMPORT_MODE = mode;
    let refusal = { code: "", message: "" };
    try { await op.procurementProcess.importPriceResearch.mutate({ processId: pid, source: "colar", text: "Fornecedor Fictício Alfa — R$ 3.900,00" }); }
    catch (e) { refusal = { code: trpcCode(e), message: e instanceof Error ? e.message : String(e) }; }
    expect(refusal.code, "colagem ambígua/legada recusada").toBe("PRECONDITION_FAILED");
    if (mode === "canonical") {
      // Ingestão canônica ligada ⇒ a recusa é do CUTOVER (servidor), não do leitor — não confundir as duas.
      expect(refusal.message, "recusa pelo cutover canônico").toMatch(/^LEGACY_PRICE_IMPORT_DISABLED:/);
    } else {
      expect(refusal.message, "recusa por ambiguidade do conteúdo").toMatch(/ambígua/);
    }
    expect((await op.procurementProcess.listItems.query({ processId: pid })).items, "recusa sem gravação").toHaveLength(0);
    REPORT.metrics.PRICE_RESEARCH_M8 = { items: prev.items.length, quotes: prev.quoteCount, averageCents: prev.items[0].averageCents, totalCents: prev.items[0].totalCents, ignoredLines: prev.ignored.length, ambiguousRefused: true };

    // 2) Itens: Pesquisa de preços → itens aprovados → Itens da contratação com quantidade prevista (rotas da tela).
    const quoteRows = (supplier: string) => ITEMS.map((r) => ({ description: r.description, planned: r.planned, unit: r.unit, price: r.price, supplier }));
    if (mode === "canonical") {
      // Duas SESSÕES independentes (um fornecedor cada) ⇒ duas pesquisas; as cotações se SOMAM (nunca substituição silenciosa).
      const s1 = await runCanonicalPriceResearch({ baseUrl: BASE!, author, manager: mgr, processId: pid, csv: `${priceResearchCsv(quoteRows("Fornecedor Fictício A"))}\n`, fileName: `homolog-${RUN}-a.csv`, key });
      const s2 = await runCanonicalPriceResearch({ baseUrl: BASE!, author, manager: mgr, processId: pid, csv: `${priceResearchCsv(quoteRows("Fornecedor Fictício B"))}\n`, fileName: `homolog-${RUN}-b.csv`, key });
      const after = (await op.procurementProcess.listItems.query({ processId: pid })).items;
      expect(after, "um item por descrição").toHaveLength(ITEMS.length);
      for (const it of after) {
        expect(it.quoteCount, `cotações acumuladas: ${it.description}`).toBe(2);
        expect(it.fictitiousQuoteCount, `proveniência fictícia declarada: ${it.description}`).toBe(2);
      }
      REPORT.metrics.PRICE_RESEARCH_CANONICAL = { sessions: [s1.sessionId, s2.sessionId], quotesPerItem: 2, accumulated: true };
    } else {
      await op.procurementProcess.importPriceResearch.mutate({ processId: pid, source: "colar",
        text: ITEMS.flatMap((r) => [`${r.description};${r.planned};${r.unit};R$ ${r.price};Fornecedor Fictício A`, `${r.description};${r.planned};${r.unit};R$ ${r.price};Fornecedor Fictício B`]).join("\n") });
      // Guarda SEM-005 do legado: a mesma linha com OUTRO fornecedor exige confirmação — sem ela, CONFLICT e nada gravado.
      let replace = { code: "", message: "" };
      try {
        await op.procurementProcess.importPriceResearch.mutate({ processId: pid, source: "colar",
          text: ITEMS.flatMap((r) => [`${r.description};${r.planned};${r.unit};R$ ${r.price};Fornecedor Fictício C`, `${r.description};${r.planned};${r.unit};R$ ${r.price};Fornecedor Fictício D`]).join("\n") });
      } catch (e) { replace = { code: trpcCode(e), message: e instanceof Error ? e.message : String(e) }; }
      expect(replace.code, "substituição sem confirmação recusada").toBe("CONFLICT");
      expect(replace.message).toMatch(/^QUOTE_REPLACEMENT_CONFIRMATION_REQUIRED:/);
      for (const it of (await op.procurementProcess.listItems.query({ processId: pid })).items) {
        expect(it.suppliers.map((s: any) => s.name).sort(), `cotações originais intactas: ${it.description}`).toEqual(["Fornecedor Fictício A", "Fornecedor Fictício B"]);
      }
    }
    for (const it of (await op.procurementProcess.listItems.query({ processId: pid })).items) await op.procurementProcess.approveItem.mutate({ itemId: it.id });
    const cand = await op.procurementItems.candidates.query({ processId: pid, source: "price_research" });
    await op.procurementItems.confirmCandidates.mutate({ processId: pid, source: "price_research", expectedSourceDigest: cand.sourceDigest, idempotencyKey: key("items"),
      decisions: cand.candidates.map((c: any) => ({ candidateKey: c.candidateKey, action: "create" as const, plannedQuantity: String(ITEMS.find((i) => i.description === c.description)?.planned ?? 1) })) });

    // 3) DFD do contexto (sem redigitação) + replay.
    const { document: dfd } = await op.procurementProcess.generateDFD.mutate({ processId: pid, idempotencyKey: `homolog-dfd-${RUN}` });
    for (const it of ITEMS) expect(dfd.content).toContain(it.description);
    const dfdAgain = await op.procurementProcess.generateDFD.mutate({ processId: pid, idempotencyKey: `homolog-dfd-${RUN}` });
    expect(dfdAgain.document.content, "replay do DFD").toBe(dfd.content);
    const dfdState = await op.procurementProcess.dfdAssistState.query({ processId: pid });
    REPORT.metrics.DFD = { fields: dfdState.fields.length, byState: dfdState.summary, ...pendingMarkers(dfd.content) };
    // 3b) M8-AI-DFD-001 — sugestão de IA da justificativa (provider real do ambiente): só conteúdo documental; nada é gravado sem aceite.
    try {
      const sug: any = await op.procurementProcess.generateDFDJustification.mutate({ processId: pid, expectedContentHash: draftContentHash(dfd.content), idempotencyKey: key("dfd-ai") });
      expect(sug.suggestion.text).not.toMatch(AI_META_RESIDUE);
      REPORT.metrics.DFD_AI = { outputContract: sug.explanation.outputContract, gaps: sug.explanation.gaps?.length ?? 0, warnings: sug.explanation.warnings?.length ?? 0, discarded: sug.explanation.discardedSegments ?? 0 };
    } catch (e) {
      // Fallback seguro: saída sem conteúdo documental válido NÃO vira sugestão (erro explícito, DFD intacto).
      expect(String((e as Error).message)).toMatch(/texto documental válido/);
      REPORT.metrics.DFD_AI = { rejectedByContract: true };
    }

    // 4) ETP (reutiliza DFD + itens) e TR (DFD + ETP + itens + parâmetros estruturados confirmados uma vez).
    const { document: etp } = await op.procurementProcess.generateETP.mutate({ processId: pid, object: OBJ, idempotencyKey: key("etp") });
    REPORT.metrics.ETP = { chars: etp.content.length, ...pendingMarkers(etp.content) };
    const trBefore: any = await op.procurementProcess.trStructuredParams.query({ processId: pid, ...WS });
    const trTyped = (await fillTrParams(h, {}, ["processo.objetoCompleto"])).typed;
    const { document: trDraft } = await op.procurementProcess.generateTR.mutate({ processId: pid, object: OBJ, idempotencyKey: key("tr") });
    for (const it of ITEMS) expect(trDraft.content).toContain(it.description);
    REPORT.metrics.TR = {
      structuredActive: trBefore.fields.filter((f: any) => f.active).length,
      structuredPrefilled: trBefore.fields.filter((f: any) => f.active && f.status === "SET").length,
      structuredProposed: trBefore.fields.filter((f: any) => f.active && f.proposal).length,
      structuredConfirmedByHuman: trTyped.length, ...pendingMarkers(trDraft.content),
    };

    // 5) Revisão humana do TR (autor) → emissão oficial pelo OUTRO usuário (SoD) + replay da emissão.
    const human = trDraft.content.replace(/\[REVISAR[^\]]*\]/g, `${MARK} texto conferido na homologação.`);
    if (human !== trDraft.content) await op.procurementProcess.saveReviewableDraft.mutate({ processId: pid, kind: "tr", content: human, expectedContentHash: draftContentHash(trDraft.content), idempotencyKey: key("tr-edit") });
    const promoInput = { processId: pid, kind: "tr" as const, idempotencyKey: key("tr-promo"), expectedContentHash: draftContentHash(human), reason: `${MARK} TR revisado e conferido.` };
    const promoted: any = await mgr.procurementProcess.promoteOfficial.mutate(promoInput);
    expect(promoted.promoted).toBe(true);
    expect(((await mgr.procurementProcess.promoteOfficial.mutate(promoInput)) as any).replayed, "replay da emissão do TR").toBe(true);
    const trPin = { documentId: promoted.officialDocument.id, version: promoted.officialDocument.version, contentHash: promoted.officialDocument.contentHash };

    // 6) Edital BLL: o tenant sintético PRECISA ter a Revisão 2 vinculada — nunca substitui pelo Edital genérico.
    const resolution: any = await op.procurementProcess.editalTemplateResolution.query({ processId: pid, ...WS });
    REPORT.metrics.EDITAL_TEMPLATE_RESOLUTION = resolution.status;
    expect(resolution.status, "modelo BLL vinculado no tenant sintético (Revisão 2 disponibilizada e vinculada só nele)").toBe("BOUND");
    await completeProfile(h);
    await setBudgetDisclosure(h);
    await setItemsParticipation(h);
    const prep0: any = await op.procurementProcess.editalTemplatePreparation.query({ processId: pid, ...WS, officialPins: { TR: trPin } });
    expect(prep0.status).toBe("READY_FOR_PREPARATION");
    expect(prep0.publication?.deferredPolicy, "revisão vinculada é a Revisão 2 (datas de publicação diferidas)").toBeTruthy();
    const typed: string[] = [];
    for (let round = 1; round <= 8; round++) {
      const st: any = await op.procurementProcess.editalTemplatePreparation.query({ processId: pid, ...WS, officialPins: { TR: trPin } });
      const pend = livePendingItems(st, {});
      if (pend.length === 0) break;
      const edits: Record<string, Record<string, any>> = {};
      for (const { section, field } of pend) { (edits[section.source] ??= {})[field.path] = toFormValue(field, scenarioValueByName(field.name)); typed.push(field.name); }
      const plan = buildSavePlan(st, { edits: edits as any });
      expect(plan.errors).toEqual({});
      const out = await executeSavePlan(plan.writes, st.revisions, {
        async write(w: PlannedWrite, expectedRevision: number) {
          const base = { confirm: true as const, idempotencyKey: key(w.id), decision: decisionA as any, expectedRevision, catalogVersion: st.catalogVersion, fields: w.fields ?? {} };
          const r: any = w.kind === "ORG"
            ? await op.institutionalTemplates.governed.recordOrganizationFields.mutate({ ...base, source: w.source as any })
            : await op.institutionalTemplates.governed.recordCertameConfig.mutate({ ...base, processId: pid, source: w.source as any });
          return { revision: r.decision.revision as number };
        },
      }, (e) => isStaleSave(trpcCode(e), e instanceof Error ? e.message : String(e)));
      expect(out.failed, JSON.stringify(out.failed)).toBeNull();
    }
    for (const v of PUB_VARS) expect(typed, `data de publicação não pode ser pedida na minuta: ${v}`).not.toContain(v);
    const st: any = await op.procurementProcess.editalTemplatePreparation.query({ processId: pid, ...WS, officialPins: { TR: trPin } });
    expect(livePendingItems(st, {})).toEqual([]);
    REPORT.metrics.EDITAL_BLL = { preparation: st.metrics, publication: st.publication?.readiness, decisionsTypedInEdital: typed.length, decisionsTypedNames: typed };
    const pre: any = await op.procurementProcess.editalTemplatePreflight.query({ processId: pid, ...WS, officialPins: { TR: trPin } });
    expect(pre.status, JSON.stringify(pre.issues ?? [])).toBe("READY_FOR_COMPOSITION");

    // 7) Minuta BLL (modelo institucional) + replay.
    const genInput = { processId: pid, object: OBJ, ...WS, officialPins: { TR: trPin }, idempotencyKey: key("edital") };
    const ed: any = await op.procurementProcess.generateNotice.mutate(genInput as any);
    expect(ed.generationMode).toBe("INSTITUTIONAL_TEMPLATE");
    const text: string = ed.document.content;
    expect(text).toContain(OBJ);
    for (const it of ITEMS) expect(text).toContain(it.description);
    const [seq] = processNumber.split("/");
    expect(text, "numeração NNNN/AAAA").toContain(`Nº ${seq}/${exercicio}`);
    expect(text).toContain("A DEFINIR PARA PUBLICAÇÃO");
    expect(text).not.toMatch(/\[REVISAR[^\]]*(numeroPregao|dataAbertura|horarioAbertura|RecebimentoPropostas|dataDivulgacao)/);
    expect(technicalResidue(text)).toEqual([]);
    expect(((await op.procurementProcess.generateNotice.mutate(genInput as any)) as any).replayed, "replay da minuta").toBe(true);
    REPORT.metrics.EDITAL = { chars: text.length, ...pendingMarkers(text) };

    // 8) Exportação DOCX/PDF dos quatro documentos (bytes e texto conferidos).
    const exported: Record<string, unknown> = {};
    for (const kind of ["dfd", "etp", "tr", "edital"] as const) {
      for (const format of ["docx", "pdf"] as const) {
        const out = await op.procurementProcess.exportDocument.mutate({ processId: pid, kind, format });
        const bytes = await download(out.url);
        expect(looksLike(format, bytes), `${kind}.${format}`).toBe(true);
        if (kind === "edital") {
          const body = format === "docx" ? await docxText(bytes) : await pdfText(bytes);
          expect(technicalResidue(body), `edital.${format} sem resíduo técnico`).toEqual([]);
          expect(body).toContain("A DEFINIR PARA PUBLICAÇÃO");
        }
        exported[`${kind}.${format}`] = { bytes: bytes.length, fileName: out.fileName };
      }
    }
    REPORT.journeys.A = { processNumber, exported, passed: true };
  }, 900_000);

  it("B — registro legado → contrato vigente (histórico declarado) → aditivo com novo término → termo DOCX/PDF", async () => {
    const mgr = author.api;
    const legacy = await mgr.operationRecord.importLegacy.mutate({ recordType: "processo_licitatorio_legado", rawText: `${MARK} Processo nº 12/2023 — Pregão Eletrônico — Objeto: manutenção predial (homologação ${RUN}).` });
    const input = {
      idempotencyKey: key("ct"), contractNumber: `${MARK} CT-${RUN}`.slice(0, 60), contractor: `${MARK} Fornecedor Fictício Ltda`, term: "12 meses", value: 48000,
      endDate: plus(45), legacyRecordId: legacy.record.id,
      priorAmendments: [{ type: "prazo" as const, newTerm: "12 meses", reference: `${MARK} 1º Termo Aditivo`, signedOn: plus(-200) }],
    };
    const r: any = await mgr.contractWorkspace.registerInForceContract.mutate(input);
    expect(r.workspace).toMatchObject({ status: "vigente", originType: "legado" });
    expect(r.provenance).toBe("DECLARADO");
    expect((await mgr.contractWorkspace.registerInForceContract.mutate(input) as any).workspace.id, "replay do registro").toBe(r.workspace.id);
    const newEnd = plus(410);
    const ad: any = await mgr.contractWorkspace.createAddendum.mutate({ idempotencyKey: key("ad"), contractId: r.workspace.id, addendumType: "prazo", justification: `${MARK} Prorrogação por 12 meses.`, newTerm: "24 meses", newEndDate: newEnd });
    const cal = await mgr.departmentOperation.calendar.query({ from: TODAY, to: plus(420) });
    const mine = cal.events.filter((e) => e.referenceId === r.workspace.id);
    expect(mine.some((e) => e.eventDate === newEnd && e.eventType === "vencimento_contrato"), "vigência reagendada").toBe(true);
    expect(mine.some((e) => e.eventDate === plus(45)), "vencimento antigo removido").toBe(false);
    expect(new Set(mine.map((e) => e.id)).size).toBe(mine.length);
    const v = await mgr.documentEngine.versions.query({ businessDomain: "contratos", documentType: "aditivo", origin: r.workspace.id, instrumentId: ad.addendum.id });
    const exported: Record<string, number> = {};
    for (const format of ["docx", "pdf"] as const) {
      const out = await mgr.documentEngine.exportInstitutional.mutate({ documentId: v.versions[0].id, format });
      const bytes = await download(out.url);
      expect(looksLike(format, bytes), `termo.${format}`).toBe(true);
      exported[format] = bytes.length;
    }
    REPORT.journeys.B = { contractId: r.workspace.id, priorAmendments: r.priorAmendmentsRecorded, newEnd, exported, passed: true };
  }, 300_000);

  it("C — contrato externo → vencimento e alertas no calendário (sem duplicidade) → Centro de Operações", async () => {
    const api = author.api;
    const before: any = await api.departmentOperation.dashboard.query({ today: TODAY });
    const { record } = await api.operationRecord.createRecord.mutate({ recordType: "contrato_externo", origin: "externa", number: `${MARK} CE-${RUN}`.slice(0, 60), object: `${MARK} Locação de veículos`, expirationDate: plus(20) });
    const cal = await api.departmentOperation.calendar.query({ from: TODAY, to: plus(30) });
    const mine = cal.events.filter((e) => e.referenceId === record.id);
    expect(mine.filter((e) => e.eventDate === plus(20) && e.eventType === "vencimento_contrato")).toHaveLength(1);
    expect(mine.some((e) => e.eventDate === plus(5)) && mine.some((e) => e.eventDate === plus(13)), "alertas 15d e 7d").toBe(true);
    expect(new Set(mine.map((e) => `${e.eventDate}|${e.title}`)).size, "sem alerta duplicado").toBe(mine.length);
    const after: any = await api.departmentOperation.dashboard.query({ today: TODAY });
    expect(after.indicators.contractsExpiring - before.indicators.contractsExpiring, "indicador conta o contrato uma vez").toBe(1);
    REPORT.journeys.C = { recordId: record.id, events: mine.length, passed: true };
  }, 120_000);

  it("ISO — órgão alheio recusado para o mesmo usuário", async () => {
    const saved = author.state.orgId;
    author.state.orgId = 2_147_000_000;
    try {
      const code = await author.api.organizations.getCurrent.query().then(() => "ALLOWED", (e) => trpcCode(e));
      expect(["FORBIDDEN", "NOT_FOUND", "BAD_REQUEST"]).toContain(code);
    } finally { author.state.orgId = saved; }
  });
});

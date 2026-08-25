import { describe, it, expect } from "vitest";

// Domain
import {
  createProcurementWorkspace, nextStage, advanceStage, usesDFD, isStageMandatory, STAGE_ORDER, DOMAIN_COPILOTS,
} from "../../domain/procurementProcess";
import { createDFDState, canTransitionDFD, transitionDFD, importDFD, isDFDReady } from "../../domain/dfdState";
import { createPriceResearchWorkspace, createPriceResearchItem, extractItemsFromText, averageValue } from "../../domain/priceResearch";
import { createIntelligentItem, approveItem, rejectItem, applyCATMAT, isReadyForTR, canTransitionItem } from "../../domain/intelligentItem";
import { scoreMatch, rankCATMAT, acceptMatch, rejectMatch, manualMatch, suggestedAndAlternatives } from "../../domain/catmatMatching";
import { createItemRecommendation, acceptRecommendation, rejectRecommendation, createItemRisk, detectPriceOutlier } from "../../domain/itemRecommendation";
import { createGeneratedDocument, validateEdital, defaultPresencialJustification, approveDocument } from "../../domain/generatedDocument";

// Services
import { catmatCandidates, suggestSpecifications, enrichItem, getItemPanel } from "../../services/itemIntelligenceService";
import { generateDocument, generateNotice } from "../../services/procurementProcessService";

// Persistence
import { insertProcess, getProcess, listProcesses, listIntelligentItems, recordProcessEvent, listProcessTimeline } from "../../db/procurement";

const ORG_ID = 10500;
const CORR = "corr-5100";
const PID = "proc-1";

describe("Sprint 5.1 — Business Domain: Processo Licitatório", () => {

  // ─── procurementProcess ────────────────────────────────────────────────────

  describe("procurementProcess", () => {
    const mk = (start: Parameters<typeof createProcurementWorkspace>[0]["startOption"] = "criar_dfd") =>
      createProcurementWorkspace({ organizationId: ORG_ID, processNumber: "2024/0001", object: "Material de escritório", startOption: start, responsibleUser: 7, correlationId: CORR });

    it("cria processo com id determinístico e copilotos do domínio", () => {
      const a = mk(); const b = mk();
      expect(a.id).toBe(b.id);
      expect(a.activeCopilots).toEqual(DOMAIN_COPILOTS);
      expect(a.status).toBe("rascunho");
    });

    it("iniciar_etp começa direto na etapa ETP (Adaptive Process Engine)", () => {
      expect(mk("iniciar_etp").currentStage).toBe("ETP");
      expect(mk("criar_dfd").currentStage).toBe("NEW_PROCESS");
    });

    it("usesDFD reflete a opção de início", () => {
      expect(usesDFD(mk("criar_dfd"))).toBe(true);
      expect(usesDFD(mk("iniciar_etp"))).toBe(false);
    });

    it("advanceStage caminha na ordem canônica", () => {
      const p = advanceStage(mk("iniciar_etp")); // ETP → PRICE_RESEARCH
      expect(p.currentStage).toBe("PRICE_RESEARCH");
    });

    it("DFD é etapa opcional; demais são obrigatórias", () => {
      expect(isStageMandatory("DFD")).toBe(false);
      expect(isStageMandatory("ETP")).toBe(true);
    });

    it("STAGE_ORDER tem 10 etapas", () => {
      expect(STAGE_ORDER).toHaveLength(10);
    });

    it("nextStage: criar_dfd em NEW_PROCESS vai para DFD; iniciar_etp já parte de ETP", () => {
      expect(nextStage(mk("criar_dfd"))).toBe("DFD");
      // Com iniciar_etp o processo já nasce em ETP → próxima é PRICE_RESEARCH.
      expect(nextStage(mk("iniciar_etp"))).toBe("PRICE_RESEARCH");
    });
  });

  // ─── dfdState ──────────────────────────────────────────────────────────────

  describe("dfdState", () => {
    const mk = () => createDFDState({ processId: PID, organizationId: ORG_ID, correlationId: CORR });

    it("cria DFD inexistente por padrão", () => {
      expect(mk().status).toBe("inexistente");
    });

    it("transições válidas/ inválidas", () => {
      expect(canTransitionDFD("inexistente", "importado")).toBe(true);
      expect(canTransitionDFD("aprovado", "importado")).toBe(false);
      expect(() => transitionDFD(mk(), "aprovado")).toThrow();
    });

    it("importDFD estrutura campos e marca importado", () => {
      const dfd = importDFD(mk(), "pdf", { necessidade: "aquisição de material" });
      expect(dfd.status).toBe("importado");
      expect(dfd.source).toBe("pdf");
      expect(dfd.extractedFields.necessidade).toBe("aquisição de material");
    });

    it("isDFDReady só quando aprovado", () => {
      const dfd = transitionDFD(importDFD(mk(), "pdf", {}), "aprovado");
      expect(isDFDReady(dfd)).toBe(true);
    });
  });

  // ─── priceResearch ─────────────────────────────────────────────────────────

  describe("priceResearch", () => {
    it("extractItemsFromText extrai itens (descrição;qtd;unid;valor)", () => {
      const items = extractItemsFromText("Caneta azul;100;un;1,50\nPapel A4;50;resma;25,00", { researchId: "r1", processId: PID, organizationId: ORG_ID });
      expect(items).toHaveLength(2);
      expect(items[0].description).toBe("Caneta azul");
      expect(items[0].quantity).toBe(100);
      expect(items[0].value).toBeCloseTo(1.5);
    });

    it("createPriceResearchItem id determinístico", () => {
      const a = createPriceResearchItem({ researchId: "r1", processId: PID, organizationId: ORG_ID, description: "Caneta", index: 0 });
      const b = createPriceResearchItem({ researchId: "r1", processId: PID, organizationId: ORG_ID, description: "Caneta", index: 0 });
      expect(a.id).toBe(b.id);
    });

    it("averageValue ignora zeros", () => {
      const mkI = (v: number) => createPriceResearchItem({ researchId: "r1", processId: PID, organizationId: ORG_ID, description: "x", value: v, index: v });
      expect(averageValue([mkI(10), mkI(20), mkI(0)])).toBe(15);
    });

    it("createPriceResearchWorkspace determinístico", () => {
      const a = createPriceResearchWorkspace({ processId: PID, organizationId: ORG_ID, source: "colar", correlationId: CORR });
      const b = createPriceResearchWorkspace({ processId: PID, organizationId: ORG_ID, source: "colar", correlationId: "outro" });
      expect(a.id).toBe(b.id);
    });
  });

  // ─── intelligentItem ───────────────────────────────────────────────────────

  describe("intelligentItem", () => {
    const mk = () => createIntelligentItem({ processId: PID, organizationId: ORG_ID, sourceResearchId: "r1", description: "Caneta azul", quantity: 100, unit: "un", correlationId: CORR });

    it("cria item pendente com id determinístico", () => {
      const a = mk(); const b = mk();
      expect(a.id).toBe(b.id);
      expect(a.status).toBe("pendente");
    });

    it("approveItem registra aprovador; só aprovado entra no TR", () => {
      const approved = approveItem(mk(), 7);
      expect(approved.status).toBe("aprovado");
      expect(approved.approvedBy).toBe(7);
      expect(isReadyForTR(approved)).toBe(true);
      expect(isReadyForTR(mk())).toBe(false);
    });

    it("rejectItem muda status", () => {
      expect(rejectItem(mk()).status).toBe("rejeitado");
    });

    it("applyCATMAT define o CATMAT escolhido (nunca automático no domínio)", () => {
      expect(applyCATMAT(mk(), "123456").suggestedCATMAT).toBe("123456");
    });

    it("canTransitionItem valida", () => {
      expect(canTransitionItem("pendente", "aprovado")).toBe(true);
      expect(canTransitionItem("aprovado", "pendente")).toBe(false);
    });
  });

  // ─── catmatMatching ────────────────────────────────────────────────────────

  describe("catmatMatching", () => {
    const candidates = [
      { code: "111", description: "caneta esferográfica azul" },
      { code: "222", description: "papel sulfite a4 branco" },
    ];

    it("scoreMatch pontua por tokens", () => {
      expect(scoreMatch("caneta azul", "caneta esferográfica azul")).toBeGreaterThan(0);
    });

    it("rankCATMAT ordena e marca todos como sugerido (nunca aceito automático)", () => {
      const matches = rankCATMAT({ itemId: "i1", organizationId: ORG_ID, description: "caneta azul", candidates, correlationId: CORR });
      expect(matches.every(m => m.decision === "sugerido")).toBe(true);
      expect(matches[0].catmatCode).toBe("111");
    });

    it("suggestedAndAlternatives separa melhor rank das alternativas", () => {
      const matches = rankCATMAT({ itemId: "i1", organizationId: ORG_ID, description: "caneta azul", candidates, correlationId: CORR });
      const { suggested, alternatives } = suggestedAndAlternatives(matches);
      expect(suggested?.rank).toBe(0);
      expect(alternatives.length).toBe(matches.length - 1);
    });

    it("accept/reject/manual mudam a decisão", () => {
      const m = rankCATMAT({ itemId: "i1", organizationId: ORG_ID, description: "caneta", candidates, correlationId: CORR })[0];
      expect(acceptMatch(m).decision).toBe("aceito");
      expect(rejectMatch(m).decision).toBe("rejeitado");
      expect(manualMatch({ itemId: "i1", organizationId: ORG_ID, catmatCode: "999", catmatDescription: "x", correlationId: CORR }).decision).toBe("manual");
    });
  });

  // ─── itemRecommendation & risks ──────────────────────────────────────────────

  describe("itemRecommendation", () => {
    it("recomendação tem reasoning/explainability/provenance/confidence e é rejeitável", () => {
      const rec = createItemRecommendation({ itemId: "i1", organizationId: ORG_ID, type: "catmat", summary: "s", reasoning: "r", explainability: "e", provenance: "catmat_matching", confidence: 0.8, correlationId: CORR });
      expect(rec.rejectable).toBe(true);
      expect(rec.reasoning).toBe("r");
      expect(rec.explainability).toBe("e");
      expect(rec.provenance).toBe("catmat_matching");
      expect(rec.confidence).toBe(0.8);
      expect(rec.accepted).toBeNull();
    });

    it("accept/reject recomendação", () => {
      const rec = createItemRecommendation({ itemId: "i1", organizationId: ORG_ID, type: "preco", summary: "s", reasoning: "r", correlationId: CORR });
      expect(acceptRecommendation(rec).accepted).toBe(true);
      expect(rejectRecommendation(rec).accepted).toBe(false);
    });

    it("risco NUNCA bloqueia (blocking=false)", () => {
      const risk = createItemRisk({ itemId: "i1", organizationId: ORG_ID, type: "direcionamento", description: "d", correlationId: CORR });
      expect(risk.blocking).toBe(false);
    });

    it("detectPriceOutlier detecta desvio > 50%", () => {
      expect(detectPriceOutlier([10, 10, 100]).outlier).toBe(true);
      expect(detectPriceOutlier([10, 11, 12]).outlier).toBe(false);
    });
  });

  // ─── generatedDocument ───────────────────────────────────────────────────────

  describe("generatedDocument", () => {
    it("validateEdital: presencial exige justificativa", () => {
      const doc = createGeneratedDocument({ organizationId: ORG_ID, processId: PID, kind: "edital", title: "E", modality: "pregao", form: "presencial", correlationId: CORR });
      expect(validateEdital(doc).valid).toBe(false);
      const withJust = createGeneratedDocument({ organizationId: ORG_ID, processId: PID, kind: "edital", title: "E", modality: "pregao", form: "presencial", legalJustification: "justificado", correlationId: CORR });
      expect(validateEdital(withJust).valid).toBe(true);
    });

    it("validateEdital: eletronico exige plataforma", () => {
      const doc = createGeneratedDocument({ organizationId: ORG_ID, processId: PID, kind: "edital", title: "E", modality: "pregao", form: "eletronico", correlationId: CORR });
      expect(validateEdital(doc).valid).toBe(false);
      const withPlat = createGeneratedDocument({ organizationId: ORG_ID, processId: PID, kind: "edital", title: "E", modality: "pregao", form: "eletronico", platform: "compras_gov", correlationId: CORR });
      expect(validateEdital(withPlat).valid).toBe(true);
    });

    it("defaultPresencialJustification cita a Lei 14.133", () => {
      expect(defaultPresencialJustification("pregao")).toContain("14.133");
    });

    it("approveDocument muda status", () => {
      const doc = createGeneratedDocument({ organizationId: ORG_ID, processId: PID, kind: "etp", title: "ETP", correlationId: CORR });
      expect(approveDocument(doc).status).toBe("aprovado");
    });
  });

  // ─── itemIntelligenceService (o diferencial) ─────────────────────────────────

  describe("itemIntelligenceService", () => {
    it("catmatCandidates gera 3 candidatos determinísticos", () => {
      const a = catmatCandidates("caneta azul");
      const b = catmatCandidates("caneta azul");
      expect(a).toHaveLength(3);
      expect(a.map(c => c.code)).toEqual(b.map(c => c.code));
    });

    it("suggestSpecifications sugere mínima + equivalente + alerta de excesso", () => {
      const specs = suggestSpecifications("notebook");
      expect(specs.length).toBeGreaterThanOrEqual(3);
      expect(specs.join(" ")).toContain("equivalente");
    });

    it("enrichItem produz item + CATMAT sugerido + recomendações + riscos (graceful)", async () => {
      const e = await enrichItem({
        organizationId: ORG_ID, processId: PID, researchId: "r1", description: "Notebook i5 8GB",
        quantity: 10, unit: "un", supplierValues: [{ name: "A", value: 3000 }, { name: "B", value: 3200 }], correlationId: CORR,
      });
      expect(e.item.suggestedCATMAT).not.toBeNull();
      expect(e.item.alternativeCATMAT.length).toBeGreaterThanOrEqual(1);
      expect(e.recommendations.length).toBeGreaterThanOrEqual(1);
      // Menos de 3 fornecedores → risco de baixa competitividade
      expect(e.risks.some(r => r.type === "baixa_competitividade")).toBe(true);
      // Toda recomendação é rejeitável e fundamentada
      expect(e.recommendations.every(r => r.rejectable && r.reasoning.length > 0)).toBe(true);
    });

    it("enrichItem detecta preço fora da curva", async () => {
      const e = await enrichItem({
        organizationId: ORG_ID, processId: PID, researchId: "r1", description: "Cadeira",
        quantity: 5, unit: "un", supplierValues: [{ name: "A", value: 100 }, { name: "B", value: 100 }, { name: "C", value: 1000 }], correlationId: CORR,
      });
      expect(e.risks.some(r => r.type === "preco_fora_da_curva")).toBe(true);
    });

    it("getItemPanel degrada graciosamente sem DB", async () => {
      const panel = await getItemPanel("x", ORG_ID);
      expect(panel.item).toBeNull();
      expect(panel.catmat).toEqual([]);
      expect(panel.risks).toEqual([]);
    });
  });

  // ─── procurementProcessService ───────────────────────────────────────────────

  describe("procurementProcessService", () => {
    it("generateDocument (ETP) usa multi-copilot grounding-only e exige revisão", async () => {
      const { document: doc } = await generateDocument({
        organizationId: ORG_ID, processId: PID, kind: "etp", object: "Material de escritório",
        correlationId: CORR, invoke: async () => "", idempotencyKey: "t-sprint51-etp", actorUserId: 1,
      });
      expect(doc.kind).toBe("etp");
      expect(doc.content).toContain("Revisão obrigatória");
    });

    it("generateNotice presencial gera justificativa legal automática", async () => {
      const { document, validation } = await generateNotice({
        organizationId: ORG_ID, processId: PID, object: "Obra", modality: "concorrencia", form: "presencial", correlationId: CORR,
        idempotencyKey: "t-sprint51-edital-presencial", actorUserId: 1,
      });
      expect(validation.valid).toBe(true);
      expect(document.legalJustification).toContain("14.133");
    });

    it("generateNotice eletronico sem plataforma é inválido", async () => {
      const { validation } = await generateNotice({
        organizationId: ORG_ID, processId: PID, object: "Compra", modality: "pregao", form: "eletronico", correlationId: CORR,
        idempotencyKey: "t-sprint51-edital-invalido", actorUserId: 1,
      });
      expect(validation.valid).toBe(false);
    });

    it("generateNotice eletronico com plataforma é válido", async () => {
      const { validation, document } = await generateNotice({
        organizationId: ORG_ID, processId: PID, object: "Compra", modality: "pregao", form: "eletronico", platform: "compras_gov", correlationId: CORR,
        idempotencyKey: "t-sprint51-edital-valido", actorUserId: 1,
      });
      expect(validation.valid).toBe(true);
      expect(document.platform).toBe("compras_gov");
    });
  });

  // ─── Persistence: graceful degradation ───────────────────────────────────────

  describe("persistence — degradação graciosa sem DB", () => {
    it("insertProcess null / getProcess null / listProcesses []", async () => {
      const p = createProcurementWorkspace({ organizationId: ORG_ID, processNumber: "9999/9999", object: "x", startOption: "iniciar_etp", responsibleUser: 1, correlationId: CORR });
      await expect(insertProcess(p)).resolves.toBeNull();
      await expect(getProcess(p.id, ORG_ID)).resolves.toBeNull();
      await expect(listProcesses(ORG_ID)).resolves.toEqual([]);
    });

    it("listIntelligentItems / listProcessTimeline [] sem DB", async () => {
      await expect(listIntelligentItems(PID, ORG_ID)).resolves.toEqual([]);
      await expect(listProcessTimeline(PID, ORG_ID)).resolves.toEqual([]);
    });

    it("recordProcessEvent no-op sem DB", async () => {
      await expect(recordProcessEvent({ organizationId: ORG_ID, processId: PID, eventType: "change", actor: "u1", summary: "x", correlationId: CORR })).resolves.toBeUndefined();
    });
  });
});

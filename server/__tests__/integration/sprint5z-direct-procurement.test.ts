import { describe, it, expect } from "vitest";

// Domain — Workspace
import {
  createDirectProcurementWorkspace, defaultFlags, isStageSkipped, nextDirectStage,
  advanceDirectStage, setDirectStage, setProcedureType, setLegalBasis, configureFlags, usesDFD,
  DIRECT_STAGE_ORDER, DIRECT_DOMAIN_COPILOTS,
} from "../../domain/directProcurementWorkspace";
// Domain — Procedure / proposals / legal basis / need
import {
  createDirectProcurementProcedure, createProposalCollection, createProposalDocument,
  createNeedCharacterization, suggestLegalBasis, COMMON_LEGAL_BASIS,
} from "../../domain/directProcurementProcedure";
// Domain — Justifications / docs / ratification / publication
import {
  createContractJustification, createPriceJustification, baseRequiredDocuments,
  createRequiredDocument, attachRequiredDocument, validateRequiredDocument, pendRequiredDocument,
  createRatification, createGeneratedPublication,
} from "../../domain/directProcurementJustifications";

// Services
import {
  importDirectPriceResearch, generateContractJustification, generatePriceJustification,
  seedRequiredDocuments, requestLegalOpinion, getLegalOpinionResult, generatePublications,
} from "../../services/directProcurementService";
import {
  byProcurementType, byProcedureType, concludedProcesses, awaitingLegalOpinion, averageCycleMs,
} from "../../services/directProcurementObservabilityService";

// Persistence (degrada sem DB)
import {
  insertDirectProcurementWorkspace, getDirectProcurementWorkspace, listDirectProcurementWorkspaces,
  listProposalCollections, listRequiredDocuments,
} from "../../db/directProcurement";

// Arquitetura
import { getBusinessDomainDefinition } from "../../domain/businessDomain";
import { checkKernelAccess } from "../../services/kernelAccessService";
import { directProcurementRouter } from "../../routers/directProcurementRouter";

const ORG_ID = 10800;
const CORR = "corr-5z00";

describe("FASE 5 — Business Domain: Contratação Direta", () => {

  // ─── Workspace + Adaptive Process Engine ────────────────────────────────────

  describe("directProcurementWorkspace", () => {
    const mk = (type: "dispensa" | "inexigibilidade" = "dispensa", start: Parameters<typeof createDirectProcurementWorkspace>[0]["startOption"] = "criar_dfd") =>
      createDirectProcurementWorkspace({ organizationId: ORG_ID, processNumber: "2026/0001", object: "Aquisição de material", procurementType: type, startOption: start, responsibleUser: 7, correlationId: CORR });

    it("cria workspace com id determinístico e copilotos do domínio", () => {
      const a = mk(); const b = mk();
      expect(a.id).toBe(b.id);
      expect(a.activeCopilots).toEqual(DIRECT_DOMAIN_COPILOTS);
      expect(a.status).toBe("rascunho");
    });

    it("id isolado por organização (multi-tenant)", () => {
      const other = createDirectProcurementWorkspace({ organizationId: ORG_ID + 1, processNumber: "2026/0001", object: "x", procurementType: "dispensa", startOption: "criar_dfd", responsibleUser: 7, correlationId: CORR });
      expect(other.id).not.toBe(mk().id);
    });

    it("DFD opcional: 'sem_dfd' começa direto no LEGAL_BASIS", () => {
      expect(mk("dispensa", "sem_dfd").currentStage).toBe("LEGAL_BASIS");
      expect(mk("dispensa", "criar_dfd").currentStage).toBe("NEW");
      expect(usesDFD(mk("dispensa", "sem_dfd"))).toBe(false);
    });

    it("Adaptive Engine: dispensa exige pesquisa e propostas; inexigibilidade não (por padrão)", () => {
      const disp = defaultFlags("dispensa", "criar_dfd");
      const inex = defaultFlags("inexigibilidade", "criar_dfd");
      expect(disp.requiresPriceResearch).toBe(true);
      expect(disp.requiresProposalCollection).toBe(true);
      expect(inex.requiresPriceResearch).toBe(false);
      expect(inex.requiresProposalCollection).toBe(false);
    });

    it("isStageSkipped respeita as flags adaptativas", () => {
      const inex = mk("inexigibilidade");
      expect(isStageSkipped("PRICE_RESEARCH", inex.flags)).toBe(true);
      expect(isStageSkipped("PROPOSAL_COLLECTION", inex.flags)).toBe(true);
      expect(isStageSkipped("LEGAL_OPINION", inex.flags)).toBe(false);
      expect(isStageSkipped("RATIFICATION", inex.flags)).toBe(false);
    });

    it("nextDirectStage pula etapas condicionais desativadas", () => {
      // inexigibilidade sem pesquisa: NEED_CHARACTERIZATION → PROCEDURE (pula PRICE_RESEARCH)
      const inex = setDirectStage(mk("inexigibilidade"), "NEED_CHARACTERIZATION");
      expect(nextDirectStage(inex)).toBe("PROCEDURE");
    });

    it("advanceDirectStage caminha e configura status", () => {
      let ws = setDirectStage(mk("dispensa"), "RATIFICATION");
      expect(ws.status).toBe("ratificado");
      ws = advanceDirectStage(ws); // PUBLICATION
      expect(ws.currentStage).toBe("PUBLICATION");
      expect(ws.status).toBe("publicado");
    });

    it("configureFlags permite desligar parecer obrigatório (nunca fluxo fixo)", () => {
      const ws = configureFlags(mk(), { requiresLegalOpinion: false });
      expect(ws.flags.requiresLegalOpinion).toBe(false);
      expect(isStageSkipped("LEGAL_OPINION", ws.flags)).toBe(true);
    });

    it("setProcedureType / setLegalBasis atualizam o workspace", () => {
      expect(setProcedureType(mk(), "eletronico").procedureType).toBe("eletronico");
      expect(setLegalBasis(mk(), "Art. 75, II").legalBasis).toBe("Art. 75, II");
    });

    it("a ordem canônica cobre as 15 etapas", () => {
      expect(DIRECT_STAGE_ORDER).toHaveLength(15);
      expect(DIRECT_STAGE_ORDER[0]).toBe("NEW");
      expect(DIRECT_STAGE_ORDER[DIRECT_STAGE_ORDER.length - 1]).toBe("ARCHIVED");
    });
  });

  // ─── Procedimento, propostas, fundamento, necessidade ───────────────────────

  describe("procedure / proposals / legal basis", () => {
    it("procedimento eletrônico guarda plataforma; presencial guarda forma de recebimento", () => {
      const ele = createDirectProcurementProcedure({ organizationId: ORG_ID, workspaceId: "ws-1", procedureType: "eletronico", platform: "compras_gov", receiptMethod: "email", correlationId: CORR });
      expect(ele.platform).toBe("compras_gov");
      expect(ele.receiptMethod).toBeNull();
      const pres = createDirectProcurementProcedure({ organizationId: ORG_ID, workspaceId: "ws-1", procedureType: "presencial", platform: "bll", receiptMethod: "protocolo", correlationId: CORR });
      expect(pres.receiptMethod).toBe("protocolo");
      expect(pres.platform).toBeNull();
    });

    it("proposta e documento por referência (id determinístico)", () => {
      const p = createProposalCollection({ organizationId: ORG_ID, workspaceId: "ws-1", supplierName: "ACME", proposalValue: 1000, index: 0, correlationId: CORR });
      expect(p.id).toBe(createProposalCollection({ organizationId: ORG_ID, workspaceId: "ws-1", supplierName: "ACME", index: 0, correlationId: CORR }).id);
      const d = createProposalDocument({ organizationId: ORG_ID, proposalId: p.id, workspaceId: "ws-1", kind: "proposta_pdf", title: "Proposta", documentReference: "s3://k", correlationId: CORR });
      expect(d.documentReference).toBe("s3://k");
    });

    it("fundamentos legais sugeridos por modalidade (nunca bloqueia)", () => {
      expect(suggestLegalBasis("dispensa")).toEqual(COMMON_LEGAL_BASIS.dispensa);
      expect(suggestLegalBasis("inexigibilidade").length).toBeGreaterThan(0);
    });

    it("caracterização da necessidade", () => {
      const n = createNeedCharacterization({ workspaceId: "ws-1", organizationId: ORG_ID, description: "d", estimatedValue: 500, correlationId: CORR });
      expect(n.estimatedValue).toBe(500);
    });
  });

  // ─── Justificativas, documentação, ratificação, publicação ──────────────────

  describe("justifications / documents / ratification / publication", () => {
    it("justificativa da contratação (determinística, editável)", () => {
      const j = createContractJustification({ organizationId: ORG_ID, workspaceId: "ws-1", need: "n", correlationId: CORR });
      expect(j.id).toBe(createContractJustification({ organizationId: ORG_ID, workspaceId: "ws-1", correlationId: CORR }).id);
      expect(j.need).toBe("n");
    });

    it("justificativa do preço por pesquisa/manual/documento", () => {
      expect(createPriceJustification({ organizationId: ORG_ID, workspaceId: "ws-1", source: "pesquisa", researchId: "r1", correlationId: CORR }).source).toBe("pesquisa");
    });

    it("checklist dinâmico difere por modalidade", () => {
      const disp = baseRequiredDocuments("dispensa");
      const inex = baseRequiredDocuments("inexigibilidade");
      expect(disp).toContain("Pesquisa de preços");
      expect(inex.some(n => n.includes("inviabilidade de competição"))).toBe(true);
    });

    it("documento obrigatório: anexar → validar → pendenciar", () => {
      const d = createRequiredDocument({ organizationId: ORG_ID, workspaceId: "ws-1", name: "DFD", index: 0, correlationId: CORR });
      expect(d.status).toBe("pendente");
      expect(attachRequiredDocument(d, "s3://k").status).toBe("anexado");
      expect(validateRequiredDocument(d).status).toBe("validado");
      expect(pendRequiredDocument(validateRequiredDocument(d)).status).toBe("pendente");
    });

    it("ratificação registra responsável, decisão e evidências", () => {
      const r = createRatification({ organizationId: ORG_ID, workspaceId: "ws-1", responsible: 7, justification: "ok", evidence: ["e1"], correlationId: CORR });
      expect(r.decision).toBe("ratificado");
      expect(r.evidence).toEqual(["e1"]);
    });

    it("publicação determinística por tipo", () => {
      const p = createGeneratedPublication({ organizationId: ORG_ID, workspaceId: "ws-1", kind: "aviso", title: "Aviso", content: "c", correlationId: CORR });
      expect(p.id).toBe(createGeneratedPublication({ organizationId: ORG_ID, workspaceId: "ws-1", kind: "aviso", title: "x", content: "y", correlationId: CORR }).id);
    });
  });

  // ─── Arquitetura + reuso ────────────────────────────────────────────────────

  describe("arquitetura e reuso do Kernel", () => {
    it("contratacao_direta é um Business Domain registrado", () => {
      const def = getBusinessDomainDefinition("contratacao_direta");
      expect(def.name).toBe("Contratação Direta");
      expect(def.workspaceType).toBe("contratacao_direta");
    });

    it("acessa RAG, copilotos e document engine via Kernel Access Service", () => {
      expect(checkKernelAccess("contratacao_direta", "institutional_rag").allowed).toBe(true);
      expect(checkKernelAccess("contratacao_direta", "copilot_infrastructure").allowed).toBe(true);
      expect(checkKernelAccess("contratacao_direta", "document_engine").allowed).toBe(true);
    });

    it("router expõe todos os endpoints operacionais", () => {
      const procedures = Object.keys(directProcurementRouter._def.procedures);
      for (const ep of ["createProcess", "loadProcess", "updateStage", "importDFD", "selectLegalBasis", "characterizeNeed", "importPriceResearch", "configureProcedure", "registerProposal", "generateJustification", "generatePriceJustification", "validateDocuments", "requestLegalOpinion", "ratify", "publish"]) {
        expect(procedures).toContain(ep);
      }
    });
  });

  // ─── Observabilidade ────────────────────────────────────────────────────────

  describe("observabilidade", () => {
    const rows = [
      { procurementType: "dispensa", procedureType: "eletronico", currentStage: "CONTRACT", status: "concluido", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T05:00:00.000Z" },
      { procurementType: "dispensa", procedureType: "presencial", currentStage: "LEGAL_OPINION", status: "aguardando_parecer", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T01:00:00.000Z" },
      { procurementType: "inexigibilidade", procedureType: "eletronico", currentStage: "PUBLICATION", status: "publicado", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T03:00:00.000Z" },
    ];
    it("agrupa por modalidade e procedimento", () => {
      expect(byProcurementType(rows)).toEqual({ dispensa: 2, inexigibilidade: 1 });
      expect(byProcedureType(rows)).toEqual({ eletronico: 2, presencial: 1 });
    });
    it("conta concluídos e aguardando parecer", () => {
      expect(concludedProcesses(rows)).toBe(2); // CONTRACT + PUBLICATION
      expect(awaitingLegalOpinion(rows)).toBe(1);
    });
    it("tempo médio de ciclo dos concluídos", () => {
      expect(averageCycleMs(rows)).toBe(4 * 3600_000); // (5h + 3h)/2
    });
  });

  // ─── Serviço: reuso do Engine e degradação sem DB ───────────────────────────

  describe("directProcurementService (sem DB)", () => {
    it("importDirectPriceResearch reutiliza Price Research e degrada (0 persistência)", async () => {
      const res = await importDirectPriceResearch({ workspaceId: "ws-1", organizationId: ORG_ID, source: "colar", text: "Caneta;100;un;1,50", correlationId: CORR });
      expect(res.itemCount).toBeGreaterThanOrEqual(1);
      expect(typeof res.researchId).toBe("string");
    });

    it("operações que exigem workspace lançam sem DB", async () => {
      await expect(generateContractJustification({ workspaceId: "x", organizationId: ORG_ID, correlationId: CORR })).rejects.toThrow("não encontrado");
      await expect(generatePriceJustification({ workspaceId: "x", organizationId: ORG_ID, source: "manual", correlationId: CORR })).rejects.toThrow("não encontrado");
      await expect(seedRequiredDocuments({ workspaceId: "x", organizationId: ORG_ID, correlationId: CORR })).rejects.toThrow("não encontrado");
      await expect(requestLegalOpinion({ workspaceId: "x", organizationId: ORG_ID, requestedBy: 7, correlationId: CORR })).rejects.toThrow("não encontrado");
      await expect(generatePublications({ workspaceId: "x", organizationId: ORG_ID, correlationId: CORR })).rejects.toThrow("não encontrado");
    });

    it("getLegalOpinionResult degrada com resposta nula sem DB", async () => {
      const r = await getLegalOpinionResult("req-x", ORG_ID);
      expect(r.response).toBeNull();
      expect(r.documents).toEqual([]);
    });
  });

  // ─── Persistência degrada sem DB ────────────────────────────────────────────

  describe("persistência (degrada sem DB)", () => {
    it("insert retorna null e lists retornam vazio", async () => {
      const ws = createDirectProcurementWorkspace({ organizationId: ORG_ID, processNumber: "2026/0009", object: "x", procurementType: "dispensa", startOption: "criar_dfd", responsibleUser: 7, correlationId: CORR });
      expect(await insertDirectProcurementWorkspace(ws)).toBeNull();
      expect(await getDirectProcurementWorkspace(ws.id, ORG_ID)).toBeNull();
      expect(await listDirectProcurementWorkspaces(ORG_ID)).toEqual([]);
      expect(await listProposalCollections("ws-1", ORG_ID)).toEqual([]);
      expect(await listRequiredDocuments("ws-1", ORG_ID)).toEqual([]);
    });
  });
});

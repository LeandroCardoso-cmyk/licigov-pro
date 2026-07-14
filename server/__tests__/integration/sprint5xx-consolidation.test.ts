import { describe, it, expect } from "vitest";

import {
  recommendStep, acceptRecommendation, declineRecommendation,
} from "../../domain/adaptiveRecommendationEngine";
import { assembleProcess, recommendSteps } from "../../domain/adaptiveProcessEngine";
import {
  REQUIRED_OFFICIAL_FORMATS, officialOutputsFor, producesOfficialDocument, hasAllOfficialFormats,
  DOMAIN_OFFICIAL_DOCUMENTS,
} from "../../domain/documentFormats";
import {
  GOLDEN_RULE_QUESTIONS, ERP_FORBIDDEN_CONCERNS, isErpConcern, assertNotErp,
  evaluateFeature, SYSTEM_CAPABILITIES, SYSTEM_NON_CAPABILITIES,
} from "../../domain/domainPhilosophy";
import { BUSINESS_DOMAIN_DEFINITIONS, ALL_BUSINESS_DOMAIN_CODES } from "../../domain/businessDomain";
import { adaptiveRecommendationRouter } from "../../routers/adaptiveRecommendationRouter";

const CORR = "corr-5xx0";

describe("SPRINT 5.X.X — Business Domains Architectural Consolidation", () => {

  // ─── Adaptive Recommendation Engine (recomenda, nunca decide) ───────────────

  describe("adaptiveRecommendationEngine", () => {
    it("ETP é recomendado, porém NUNCA obrigatório (o servidor pode recusar)", () => {
      const rec = recommendStep({ step: "etp", objeto: "aquisição de material", valor: 100000 });
      expect(rec.recommended).toBe(true);
      expect(rec.allowDecline).toBe(true);
      expect(rec.requiresJustificationOnDecline).toBe(true);
      expect(rec.legalBasis.length).toBeGreaterThan(0);
      expect(rec.options.map(o => o.option)).toEqual(["accept", "decline"]);
    });

    it("toda recomendação traz reasoning, base legal e confiança (0–1)", () => {
      for (const step of ["dfd", "etp", "pesquisa_precos", "tr", "edital", "parecer_juridico", "aditivo", "apostilamento", "publicacao", "proposta"] as const) {
        const rec = recommendStep({ step });
        expect(rec.analysis.toLowerCase()).toContain("análise");
        expect(rec.analysis.toLowerCase()).toContain("decisão é sempre do servidor");
        expect(rec.reasoning.length).toBeGreaterThan(0);
        expect(rec.legalBasis.length).toBeGreaterThan(0);
        expect(rec.confidence).toBeGreaterThan(0);
        expect(rec.confidence).toBeLessThanOrEqual(1);
        expect(rec.provenance).toContain("adaptive_recommendation_engine");
      }
    });

    it("é determinístico (replay-safe): mesmo contexto → mesma recomendação", () => {
      const a = recommendStep({ step: "tr", objeto: "x" });
      const b = recommendStep({ step: "tr", objeto: "x" });
      expect(a).toEqual(b);
    });

    it("inexigibilidade: pesquisa e propostas NÃO são recomendadas por padrão", () => {
      expect(recommendStep({ step: "pesquisa_precos", variant: "inexigibilidade" }).recommended).toBe(false);
      expect(recommendStep({ step: "proposta", variant: "inexigibilidade" }).recommended).toBe(false);
    });

    it("recusar NUNCA bloqueia — apenas registra a escolha e a justificativa", () => {
      const rec = recommendStep({ step: "etp" });
      const declined = declineRecommendation(rec, "contratação de baixa complexidade");
      expect(declined.decision).toBe("declined");
      expect(declined.justification).toBe("contratação de baixa complexidade");
      const accepted = acceptRecommendation(rec);
      expect(accepted.decision).toBe("accepted");
    });

    it("aditivo de valor reforça a recomendação de parecer jurídico", () => {
      const semValor = recommendStep({ step: "parecer_juridico" });
      const comValor = recommendStep({ step: "parecer_juridico", variant: "valor" });
      expect(comValor.confidence).toBeGreaterThan(semValor.confidence);
    });
  });

  // ─── Adaptive Process Engine: filosofia revisada ────────────────────────────

  describe("adaptiveProcessEngine (recommendSteps)", () => {
    const def = {
      businessDomainCode: "processo_licitatorio" as const,
      workflowKey: "licitacao",
      steps: [
        { key: "dfd", name: "DFD", documents: ["dfd"], mandatory: false, requiresApproval: false, predominantCopilot: null, exceptions: [] },
        { key: "tr", name: "TR", documents: ["tr"], mandatory: true, requiresApproval: false, predominantCopilot: null, exceptions: [] },
      ],
    };
    it("nenhuma etapa é obrigatória — todas podem ser puladas pelo servidor", () => {
      const recs = recommendSteps(def);
      expect(recs.every(r => r.canSkip === true)).toBe(true);
      expect(recs.every(r => r.recommended === true)).toBe(true);
      expect(recs.find(r => r.key === "tr")?.stronglyRecommended).toBe(true);
      expect(recs.find(r => r.key === "dfd")?.stronglyRecommended).toBe(false);
    });
    it("assembleProcess permanece determinístico (sem regressão)", () => {
      expect(assembleProcess(def).signature).toBe(assembleProcess(def).signature);
    });
  });

  // ─── Documentos: DOCX + PDF sempre ──────────────────────────────────────────

  describe("documentFormats", () => {
    it("formatos oficiais obrigatórios são DOCX e PDF", () => {
      expect([...REQUIRED_OFFICIAL_FORMATS].sort()).toEqual(["docx", "pdf"]);
    });
    it("todo documento produzido na plataforma gera DOCX e PDF", () => {
      for (const kind of ["dfd", "etp", "tr", "edital", "contrato", "aditivo", "apostilamento", "parecer"]) {
        expect(hasAllOfficialFormats(officialOutputsFor(kind))).toBe(true);
      }
    });
    it("DFD, ETP, TR e Edital são documentos oficiais do Processo Licitatório", () => {
      expect(producesOfficialDocument("processo_licitatorio", "dfd")).toBe(true);
      expect(producesOfficialDocument("processo_licitatorio", "etp")).toBe(true);
      expect(producesOfficialDocument("processo_licitatorio", "tr")).toBe(true);
      expect(producesOfficialDocument("processo_licitatorio", "edital")).toBe(true);
      expect(DOMAIN_OFFICIAL_DOCUMENTS.contratos).toContain("aditivo");
    });
  });

  // ─── Filosofia e guarda anti-ERP ────────────────────────────────────────────

  describe("domainPhilosophy", () => {
    it("a Regra de Ouro tem 5 perguntas", () => {
      expect(GOLDEN_RULE_QUESTIONS).toHaveLength(5);
    });
    it("o sistema recomenda mas nunca decide/obriga/executa", () => {
      expect(SYSTEM_CAPABILITIES).toContain("recomendar");
      expect(SYSTEM_CAPABILITIES).not.toContain("decidir");
      expect(SYSTEM_NON_CAPABILITIES).toContain("decidir");
      expect(SYSTEM_NON_CAPABILITIES).toContain("executar_atos_administrativos");
    });
    it("identifica preocupações típicas de ERP", () => {
      for (const c of ["pagamentos", "empenhos", "financeiro", "patrimônio", "almoxarifado", "folha", "execução orçamentária"]) {
        expect(isErpConcern(c)).toBe(true);
      }
      expect(isErpConcern("geração de edital")).toBe(false);
      expect(ERP_FORBIDDEN_CONCERNS.length).toBeGreaterThan(0);
    });
    it("assertNotErp bloqueia capacidades de ERP", () => {
      expect(() => assertNotErp("controle de empenhos")).toThrow();
      expect(() => assertNotErp("geração de minuta de contrato")).not.toThrow();
    });
    it("evaluateFeature: ERP → remove; falta req → future_evolution; ok → keep", () => {
      expect(evaluateFeature({ reducesOperationalTime: true, improvesDocumentQuality: true, increasesLegalSecurity: true, producesOfficialDocuments: true, belongsToProcurement: true, isErpTypical: true }).verdict).toBe("remove");
      expect(evaluateFeature({ reducesOperationalTime: true, improvesDocumentQuality: false, increasesLegalSecurity: true, producesOfficialDocuments: true, belongsToProcurement: true, isErpTypical: false }).verdict).toBe("future_evolution");
      expect(evaluateFeature({ reducesOperationalTime: true, improvesDocumentQuality: true, increasesLegalSecurity: true, producesOfficialDocuments: true, belongsToProcurement: true, isErpTypical: false }).verdict).toBe("keep");
    });
  });

  // ─── Guarda: nenhum Business Domain declara workflow de ERP ─────────────────

  describe("guarda anti-ERP nos Business Domains", () => {
    it("nenhum domínio declara workflows típicos de ERP", () => {
      for (const code of ALL_BUSINESS_DOMAIN_CODES) {
        for (const wf of BUSINESS_DOMAIN_DEFINITIONS[code].supportedWorkflows) {
          expect(isErpConcern(wf), `Domínio ${code} declara workflow de ERP: ${wf}`).toBe(false);
        }
      }
    });
  });

  // ─── Router reutilizável ────────────────────────────────────────────────────

  describe("adaptiveRecommendationRouter", () => {
    it("expõe recommend e decide", () => {
      const procedures = Object.keys(adaptiveRecommendationRouter._def.procedures);
      expect(procedures).toContain("recommend");
      expect(procedures).toContain("decide");
    });
  });
});

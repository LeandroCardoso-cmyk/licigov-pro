import { describe, it, expect } from "vitest";

// Domain — Workspace
import {
  createContractWorkspace, canContractTransition, transitionContractStatus,
  updateContractFields, isContractTerminal, CONTRACT_DOMAIN_COPILOTS,
} from "../../domain/contractWorkspace";
// Domain — Instruments
import {
  createContractAddendum, advanceAddendum, createContractApostille,
  createContractOccurrence, createContractGeneratedDocument, createMinutaMetadata,
  ADDENDUM_REQUEST_ORIGINS,
} from "../../domain/contractInstruments";
// Domain — Reconstrução Assistida
import {
  reconstructContractFields, reconstructionConfidence, createAssistedReconstruction, RECONSTRUCTION_DISCLAIMER,
} from "../../domain/contractReconstruction";

// Services
import {
  createFromProcurement, createFromDirectProcurement, importExternalContract,
  createManualContract,
  generateContractDocument, createAddendum, createApostille, registerOccurrence,
  requestContractLegalOpinion, getContractLegalOpinion,
} from "../../services/contractService";
import {
  byOrigin, byStatus, importedCount, averageElaborationMs,
} from "../../services/contractObservabilityService";

// Persistence (degrada sem DB)
import {
  insertContractWorkspace, getContractWorkspace, listContractWorkspaces,
  listContractAddenda, listContractApostilles, listImportedContractWorkspaces,
} from "../../db/contractWorkspace";

// Arquitetura
import { getBusinessDomainDefinition } from "../../domain/businessDomain";
import { checkKernelAccess } from "../../services/kernelAccessService";
import { contractWorkspaceRouter } from "../../routers/contractWorkspaceRouter";

const ORG_ID = 10900;
const CORR = "corr-5w00";

describe("FASE 5 — Business Domain: Contratos", () => {

  // ─── Workspace ──────────────────────────────────────────────────────────────

  describe("contractWorkspace", () => {
    const mk = (origin: "processo_licitatorio" | "contratacao_direta" | "externo" | "avulso" = "externo") =>
      createContractWorkspace({ organizationId: ORG_ID, originType: origin, contractNumber: "CT-2026/001", contractor: "ACME", object: "Serviços", value: 100000, correlationId: CORR });

    it("cria contrato com id determinístico e copilotos do domínio", () => {
      const a = mk(); const b = mk();
      expect(a.id).toBe(b.id);
      expect(a.activeCopilots).toEqual(CONTRACT_DOMAIN_COPILOTS);
      expect(a.status).toBe("minuta");
    });

    it("id isolado por organização (multi-tenant)", () => {
      const other = createContractWorkspace({ organizationId: ORG_ID + 1, originType: "externo", contractNumber: "CT-2026/001", correlationId: CORR });
      expect(other.id).not.toBe(mk().id);
    });

    it("gestor e fiscal não são obrigatórios", () => {
      const ws = mk();
      expect(ws.manager).toBe("");
      expect(ws.inspector).toBe("");
    });

    it("máquina de status: transições válidas/inválidas", () => {
      expect(canContractTransition("minuta", "vigente")).toBe(true);
      expect(canContractTransition("vigente", "aditado")).toBe(true);
      expect(canContractTransition("vigente", "apostilado")).toBe(true);
      expect(canContractTransition("minuta", "encerrado")).toBe(false);
      expect(() => transitionContractStatus(mk(), "encerrado")).toThrow();
    });

    it("updateContractFields edita campos supervisionados", () => {
      const ws = updateContractFields(mk(), { manager: "João", inspector: "Maria", value: 200000 });
      expect(ws.manager).toBe("João");
      expect(ws.value).toBe(200000);
    });

    it("arquivado é terminal", () => {
      const arch = transitionContractStatus(transitionContractStatus(mk(), "vigente"), "arquivado");
      expect(isContractTerminal(arch)).toBe(true);
    });
  });

  // ─── Instruments ────────────────────────────────────────────────────────────

  describe("contractInstruments", () => {
    it("aditivo: fluxo solicitar→justificar→minuta→finalizado", () => {
      const a = createContractAddendum({ organizationId: ORG_ID, contractId: "c1", addendumType: "prazo", sequence: 1, justification: "prorrogação", correlationId: CORR });
      expect(a.status).toBe("justificado");
      const minuta = advanceAddendum(a, "minuta");
      expect(minuta.status).toBe("minuta");
      expect(advanceAddendum(minuta, "finalizado").status).toBe("finalizado");
      expect(() => advanceAddendum(a, "finalizado")).toThrow();
    });

    it("apostilamento determinístico por sequência", () => {
      const p = createContractApostille({ organizationId: ORG_ID, contractId: "c1", kind: "reajuste", sequence: 1, correlationId: CORR });
      expect(p.id).toBe(createContractApostille({ organizationId: ORG_ID, contractId: "c1", kind: "reajuste", sequence: 1, correlationId: CORR }).id);
    });

    it("ocorrência: registro simples", () => {
      const o = createContractOccurrence({ organizationId: ORG_ID, contractId: "c1", description: "atraso", notes: "n", index: 0, correlationId: CORR });
      expect(o.description).toBe("atraso");
    });

    it("documento gerado por referência (determinístico)", () => {
      const d = createContractGeneratedDocument({ organizationId: ORG_ID, contractId: "c1", kind: "contrato", title: "T", content: "c", correlationId: CORR });
      expect(d.id).toBe(createContractGeneratedDocument({ organizationId: ORG_ID, contractId: "c1", kind: "contrato", title: "x", content: "y", correlationId: CORR }).id);
    });

    // AJUSTE 3 — metadados institucionais auditáveis da minuta
    it("minuta registra metadados institucionais auditáveis", () => {
      const meta = createMinutaMetadata({ template: "contrato_aditivo", legalBasis: ["art. 124"], copilots: ["juridico"], confidence: 0.8, reasoning: "r", provenance: "p" });
      const d = createContractGeneratedDocument({ organizationId: ORG_ID, contractId: "c1", kind: "aditivo", title: "T", content: "c", metadata: meta, correlationId: CORR });
      expect(d.metadata.template).toBe("contrato_aditivo");
      expect(d.metadata.legalBasis).toContain("art. 124");
      expect(d.metadata.copilots).toContain("juridico");
      expect(d.metadata.templateVersion).toBe("1.0");
      expect(d.metadata.confidence).toBe(0.8);
    });

    // AJUSTE 4 — origem da solicitação do aditivo
    it("aditivo registra a origem da solicitação (padrão contract_workspace)", () => {
      expect(createContractAddendum({ organizationId: ORG_ID, contractId: "c1", addendumType: "prazo", sequence: 1, justification: "j", correlationId: CORR }).requestOrigin).toBe("contract_workspace");
      expect(createContractAddendum({ organizationId: ORG_ID, contractId: "c1", addendumType: "valor", sequence: 2, justification: "j", requestOrigin: "institutional_request", correlationId: CORR }).requestOrigin).toBe("institutional_request");
      expect(ADDENDUM_REQUEST_ORIGINS).toEqual(["contract_workspace", "institutional_request", "documento_externo", "solicitacao_manual"]);
    });
  });

  // ─── AJUSTE 1 — Reconstrução Assistida (antes "extração") ───────────────────

  describe("contractReconstruction (assistida)", () => {
    const SAMPLE = [
      "CONTRATO Nº 045/2026",
      "CONTRATADO: Empresa XPTO LTDA",
      "OBJETO: Aquisição de equipamentos de informática",
      "VALOR GLOBAL: R$ 150.000,00",
      "VIGÊNCIA: 12 (doze) meses",
      "CLÁUSULA PRIMEIRA - Do objeto",
      "CLÁUSULA SEGUNDA - Do valor",
    ].join("\n");

    it("reconstrói campos do texto de forma determinística", () => {
      const f = reconstructContractFields(SAMPLE);
      expect(f.contractNumber).toContain("045/2026");
      expect(f.contractor).toContain("XPTO");
      expect(f.object.toLowerCase()).toContain("equipamentos");
      expect(f.value).toBe(150000);
      expect(f.clauses.length).toBe(2);
    });

    it("confiança reflete campos identificados", () => {
      expect(reconstructionConfidence(reconstructContractFields(SAMPLE))).toBeGreaterThan(0.5);
      expect(reconstructionConfidence(reconstructContractFields("texto irrelevante"))).toBeLessThan(0.5);
    });

    it("a reconstrução é ASSISTIDA e pendente de revisão do servidor", () => {
      const rec = createAssistedReconstruction({ organizationId: ORG_ID, source: "pdf", rawText: SAMPLE, correlationId: CORR });
      expect(rec.assisted).toBe(true);
      expect(rec.reviewedByServer).toBe(false);
      expect(rec.disclaimer).toBe(RECONSTRUCTION_DISCLAIMER);
      expect(rec.disclaimer.toLowerCase()).toContain("assistida");
    });

    it("é replay-safe (mesmo texto → mesmo id/hash)", () => {
      const a = createAssistedReconstruction({ organizationId: ORG_ID, source: "pdf", rawText: SAMPLE, correlationId: CORR });
      const b = createAssistedReconstruction({ organizationId: ORG_ID, source: "pdf", rawText: SAMPLE, correlationId: CORR });
      expect(a.id).toBe(b.id);
      expect(a.rawTextHash).toBe(b.rawTextHash);
    });
  });

  // ─── Arquitetura + reuso ────────────────────────────────────────────────────

  describe("arquitetura e reuso do Kernel", () => {
    it("contratos é um Business Domain registrado", () => {
      const def = getBusinessDomainDefinition("contratos");
      expect(def.name).toBe("Contratos e Aditivos");
      expect(def.workspaceType).toBe("contrato");
    });

    it("acessa Document Engine, RAG e copilotos via Kernel Access Service", () => {
      expect(checkKernelAccess("contratos", "document_engine").allowed).toBe(true);
      expect(checkKernelAccess("contratos", "institutional_rag").allowed).toBe(true);
      expect(checkKernelAccess("contratos", "copilot_infrastructure").allowed).toBe(true);
    });

    it("router expõe todos os endpoints operacionais", () => {
      const procedures = Object.keys(contractWorkspaceRouter._def.procedures);
      for (const ep of ["createFromProcurement", "createFromDirectProcurement", "createManual", "importExternalContract", "loadContract", "updateContract", "createAddendum", "createApostille", "registerOccurrence", "requestLegalOpinion", "generateDocuments"]) {
        expect(procedures).toContain(ep);
      }
    });
  });

  // ─── Observabilidade ────────────────────────────────────────────────────────

  describe("observabilidade", () => {
    const rows = [
      { originType: "processo_licitatorio", status: "vigente", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T02:00:00.000Z" },
      { originType: "externo", status: "vigente", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T04:00:00.000Z" },
      { originType: "contratacao_direta", status: "aditado", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" },
    ];
    it("agrupa por origem e status", () => {
      expect(byOrigin(rows)).toEqual({ processo_licitatorio: 1, externo: 1, contratacao_direta: 1 });
      expect(byStatus(rows)).toEqual({ vigente: 2, aditado: 1 });
    });
    it("conta importados e tempo médio de elaboração", () => {
      expect(importedCount(rows)).toBe(1);
      expect(averageElaborationMs(rows)).toBe((2 + 4 + 0) / 3 * 3600_000);
    });
  });

  // ─── Serviço: 3 fluxos degradam sem DB, reuso do Engine ─────────────────────

  describe("contractService (sem DB)", () => {
    it("FLUXO 1 — createFromProcurement cria contrato mesmo sem processo (degrada)", async () => {
      const ws = await createFromProcurement({ organizationId: ORG_ID, processId: "proc-x", contractNumber: "CT-1", correlationId: CORR });
      expect(ws.originType).toBe("processo_licitatorio");
      expect(ws.originProcess).toBe("proc-x");
    });

    it("FLUXO 2 — createFromDirectProcurement", async () => {
      const ws = await createFromDirectProcurement({ organizationId: ORG_ID, directWorkspaceId: "dp-x", contractNumber: "CT-2", correlationId: CORR });
      expect(ws.originType).toBe("contratacao_direta");
    });

    it("FLUXO 3 — importExternalContract faz reconstrução assistida (minuta pendente de revisão)", async () => {
      const res = await importExternalContract({ organizationId: ORG_ID, source: "pdf", rawText: "CONTRATO Nº 9/2026\nCONTRATADO: Fulano ME\nVALOR: R$ 1.000,00", correlationId: CORR });
      expect(res.workspace.originType).toBe("externo");
      expect(res.workspace.status).toBe("minuta"); // depende da validação do servidor
      expect(res.assisted).toBe(true);
      expect(res.confidence).toBeGreaterThan(0);
      expect(res.reconstructed.contractNumber).toContain("9/2026");
    });

    it("FLUXO 4 — createManualContract cria contrato AVULSO (sem processo de origem), com createdBy real", async () => {
      const ws = await createManualContract({
        organizationId: ORG_ID, contractNumber: "CT-2026/AVULSO-1", contractor: "Fornecedor XYZ",
        object: "Manutenção predial", value: 500000, term: "12 meses", correlationId: CORR, createdBy: 42,
      });
      expect(ws.originType).toBe("avulso");
      expect(ws.originProcess).toBe("");
      expect(ws.status).toBe("minuta");
      expect(ws.contractor).toBe("Fornecedor XYZ");
      expect(ws.value).toBe(500000);
      expect(ws.createdBy).toBe(42); // nunca "sistema" quando há usuário autenticado real
    });

    it("createManualContract funciona só com número do contrato (demais campos opcionais)", async () => {
      const ws = await createManualContract({ organizationId: ORG_ID, contractNumber: "CT-2026/AVULSO-2", correlationId: CORR, createdBy: 42 });
      expect(ws.originType).toBe("avulso");
      expect(ws.contractNumber).toBe("CT-2026/AVULSO-2");
    });

    // A checagem de colisão (findManualContractByNumber) exige DB real para ter efeito —
    // este arquivo degrada sem DB (insertContractWorkspace vira no-op), então o teste de
    // colisão fica no smoke MySQL real: contrato-avulso-mysql-smoke.test.ts.

    it("operações que exigem contrato existente lançam sem DB", async () => {
      await expect(generateContractDocument({ organizationId: ORG_ID, contractId: "x", kind: "contrato", correlationId: CORR })).rejects.toThrow("não encontrado");
      await expect(createAddendum({ organizationId: ORG_ID, contractId: "x", addendumType: "prazo", justification: "j", correlationId: CORR })).rejects.toThrow("não encontrado");
      await expect(createApostille({ organizationId: ORG_ID, contractId: "x", kind: "reajuste", correlationId: CORR })).rejects.toThrow("não encontrado");
      await expect(registerOccurrence({ organizationId: ORG_ID, contractId: "x", description: "d", correlationId: CORR })).rejects.toThrow("não encontrado");
      await expect(requestContractLegalOpinion({ organizationId: ORG_ID, contractId: "x", requestType: "LEGAL_OPINION_INITIAL", requestedBy: 7, correlationId: CORR })).rejects.toThrow("não encontrado");
    });

    it("getContractLegalOpinion degrada com resposta nula", async () => {
      const r = await getContractLegalOpinion("req-x", ORG_ID);
      expect(r.response).toBeNull();
      expect(r.documents).toEqual([]);
    });
  });

  // ─── Persistência degrada sem DB ────────────────────────────────────────────

  describe("persistência (degrada sem DB)", () => {
    it("insert retorna null e lists retornam vazio", async () => {
      const ws = createContractWorkspace({ organizationId: ORG_ID, originType: "externo", contractNumber: "CT-9", correlationId: CORR });
      expect(await insertContractWorkspace(ws)).toBeNull();
      expect(await getContractWorkspace(ws.id, ORG_ID)).toBeNull();
      expect(await listContractWorkspaces(ORG_ID)).toEqual([]);
      expect(await listImportedContractWorkspaces(ORG_ID)).toEqual([]);
      expect(await listContractAddenda("c1", ORG_ID)).toEqual([]);
      expect(await listContractApostilles("c1", ORG_ID)).toEqual([]);
    });
  });
});

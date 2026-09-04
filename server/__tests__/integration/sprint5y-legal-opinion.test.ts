import { describe, it, expect } from "vitest";

// Domain — Workspace
import {
  createLegalOpinionWorkspace, canLegalTransition, transitionLegalStage, assignLawyer,
  isLegalTerminal, isLegalActive, LEGAL_OPINION_STAGE_ORDER,
} from "../../domain/legalOpinionWorkspace";
// Domain — Draft (parecer)
import {
  createLegalOpinionDraft, updateLegalOpinionDraft, signLegalOpinionDraft, draftContentHash,
  isSignatureMethodImplemented, IMPLEMENTED_SIGNATURE_METHODS,
} from "../../domain/legalOpinionDraft";
// Domain — Lawyer assignment
import { createLawyerAssignment, prioritizeAssignments } from "../../domain/lawyerAssignment";

// Services
import {
  openWorkspaceFromRequest, loadWorkspaceContext, loadWorkspaceReasoning, createOpinionDraft,
  updateOpinionDraft, signOpinion, returnOpinion, archiveWorkspace,
} from "../../services/legalOpinionWorkspaceService";
import {
  emittedOpinions, requestsByOrigin, averageAnalysisMs, pendingOpinions, productivity,
} from "../../services/legalOpinionObservabilityService";

// Persistence (degrada sem DB)
import {
  insertLegalOpinionWorkspace, getLegalOpinionWorkspace, listLegalOpinionWorkspaces,
  listLegalOpinionHistory, listLawyerAssignments,
} from "../../db/legalOpinionWorkspace";

// Kernel / arquitetura
import { getBusinessDomainDefinition } from "../../domain/businessDomain";
import { checkKernelAccess } from "../../services/kernelAccessService";
import { legalOpinionWorkspaceRouter } from "../../routers/legalOpinionWorkspaceRouter";

const ORG_ID = 10700;
const CORR = "corr-5y00";
const REQ = "req-parecer-1";

describe("FASE 5 — Business Domain: Parecer Jurídico", () => {

  // ─── LegalOpinionWorkspace ─────────────────────────────────────────────────

  describe("legalOpinionWorkspace", () => {
    const mk = () => createLegalOpinionWorkspace({
      organizationId: ORG_ID, requestId: REQ, sourceDomain: "processo_licitatorio",
      referenceProcessId: "proc-1", requestType: "LEGAL_OPINION_INITIAL", correlationId: CORR,
    });

    it("cria workspace na INBOX com id determinístico", () => {
      const a = mk(); const b = mk();
      expect(a.id).toBe(b.id);
      expect(a.currentStage).toBe("INBOX");
      expect(a.status).toBe("na_caixa");
      expect(a.assignedLawyer).toBeNull();
    });

    it("id é isolado por organização (multi-tenant)", () => {
      const other = createLegalOpinionWorkspace({
        organizationId: ORG_ID + 1, requestId: REQ, sourceDomain: "processo_licitatorio",
        referenceProcessId: "proc-1", requestType: "LEGAL_OPINION_INITIAL", correlationId: CORR,
      });
      expect(other.id).not.toBe(mk().id);
    });

    it("máquina de estados: transições válidas e inválidas", () => {
      expect(canLegalTransition("INBOX", "RECEIVED")).toBe(true);
      expect(canLegalTransition("RECEIVED", "UNDER_ANALYSIS")).toBe(true);
      expect(canLegalTransition("UNDER_ANALYSIS", "DRAFT")).toBe(true);
      expect(canLegalTransition("DRAFT", "REVIEW")).toBe(true);
      expect(canLegalTransition("REVIEW", "SIGNED")).toBe(true);
      expect(canLegalTransition("SIGNED", "RETURNED")).toBe(true);
      expect(canLegalTransition("INBOX", "SIGNED")).toBe(false);
      expect(canLegalTransition("ARCHIVED", "RECEIVED")).toBe(false);
    });

    it("transitionLegalStage lança em transição inválida", () => {
      expect(() => transitionLegalStage(mk(), "SIGNED")).toThrow();
    });

    it("percorre o fluxo INBOX → RETURNED por transições válidas", () => {
      let ws = mk();
      for (const stage of ["RECEIVED", "UNDER_ANALYSIS", "DRAFT", "REVIEW", "SIGNED", "RETURNED"] as const) {
        ws = transitionLegalStage(ws, stage);
        expect(ws.currentStage).toBe(stage);
      }
      expect(isLegalTerminal(ws)).toBe(false); // RETURNED → ARCHIVED ainda possível
      expect(isLegalActive(ws)).toBe(false);
    });

    it("WAITING_INFORMATION volta para UNDER_ANALYSIS", () => {
      let ws = transitionLegalStage(transitionLegalStage(mk(), "RECEIVED"), "UNDER_ANALYSIS");
      ws = transitionLegalStage(ws, "WAITING_INFORMATION");
      expect(canLegalTransition(ws.currentStage, "UNDER_ANALYSIS")).toBe(true);
    });

    it("assignLawyer define o procurador responsável", () => {
      expect(assignLawyer(mk(), 42).assignedLawyer).toBe(42);
    });

    it("ARCHIVED é terminal", () => {
      const archived = transitionLegalStage(mk(), "ARCHIVED");
      expect(isLegalTerminal(archived)).toBe(true);
    });

    it("a ordem canônica cobre as 9 etapas", () => {
      expect(LEGAL_OPINION_STAGE_ORDER).toHaveLength(9);
      expect(LEGAL_OPINION_STAGE_ORDER[0]).toBe("INBOX");
      expect(LEGAL_OPINION_STAGE_ORDER[LEGAL_OPINION_STAGE_ORDER.length - 1]).toBe("ARCHIVED");
    });
  });

  // ─── LegalOpinionDraft (parecer) ────────────────────────────────────────────

  describe("legalOpinionDraft", () => {
    const mk = () => createLegalOpinionDraft({
      organizationId: ORG_ID, workspaceId: "ws-1", requestId: REQ,
      opinionType: "LEGAL_OPINION_INITIAL", author: 7, report: "Relatório", correlationId: CORR,
    });

    it("cria parecer rascunho versão 1, não assinado", () => {
      const d = mk();
      expect(d.version).toBe(1);
      expect(d.signed).toBe(false);
      expect(d.status).toBe("rascunho");
    });

    it("id determinístico (replay-safe)", () => {
      expect(mk().id).toBe(mk().id);
    });

    it("update incrementa versão e não pode alterar assinado", () => {
      const updated = updateLegalOpinionDraft(mk(), { conclusion: "Favorável" });
      expect(updated.version).toBe(2);
      expect(updated.conclusion).toBe("Favorável");
      const signed = signLegalOpinionDraft(mk(), "manual", 7);
      expect(() => updateLegalOpinionDraft(signed, { report: "x" })).toThrow();
    });

    it("assinatura MANUAL implementada; demais métodos lançam", () => {
      expect(isSignatureMethodImplemented("manual")).toBe(true);
      expect(isSignatureMethodImplemented("icp_brasil")).toBe(false);
      expect(IMPLEMENTED_SIGNATURE_METHODS).toEqual(["manual"]);
      const signed = signLegalOpinionDraft(mk(), "manual", 9);
      expect(signed.signed).toBe(true);
      expect(signed.signatureMethod).toBe("manual");
      expect(signed.signedBy).toBe(9);
      expect(() => signLegalOpinionDraft(mk(), "icp_brasil", 9)).toThrow();
      expect(() => signLegalOpinionDraft(mk(), "gov_br", 9)).toThrow();
      expect(() => signLegalOpinionDraft(mk(), "certificado_a1", 9)).toThrow();
    });

    it("draftContentHash é determinístico e muda com o conteúdo", () => {
      expect(draftContentHash(mk())).toBe(draftContentHash(mk()));
      expect(draftContentHash(mk())).not.toBe(draftContentHash(updateLegalOpinionDraft(mk(), { report: "outro" })));
    });
  });

  // ─── LawyerAssignment ───────────────────────────────────────────────────────

  describe("lawyerAssignment", () => {
    it("cria atribuição determinística", () => {
      const a = createLawyerAssignment({ organizationId: ORG_ID, workspaceId: "ws-1", requestId: REQ, lawyerId: 5, correlationId: CORR });
      const b = createLawyerAssignment({ organizationId: ORG_ID, workspaceId: "ws-1", requestId: REQ, lawyerId: 5, correlationId: CORR });
      expect(a.id).toBe(b.id);
    });

    it("prioriza urgente → baixa de forma determinística", () => {
      const mk = (p: "baixa" | "media" | "alta" | "urgente") =>
        createLawyerAssignment({ organizationId: ORG_ID, workspaceId: "ws-" + p, requestId: REQ, priority: p, correlationId: CORR });
      const ordered = prioritizeAssignments([mk("baixa"), mk("urgente"), mk("media"), mk("alta")]);
      expect(ordered.map(a => a.priority)).toEqual(["urgente", "alta", "media", "baixa"]);
    });
  });

  // ─── Arquitetura: domínio e Kernel Access ──────────────────────────────────

  describe("arquitetura", () => {
    it("parecer_juridico é um Business Domain registrado", () => {
      const def = getBusinessDomainDefinition("parecer_juridico");
      expect(def.name).toBe("Parecer Jurídico");
      expect(def.category).toBe("juridico");
    });

    it("parecer_juridico pode acessar RAG, copilotos e explainability via Kernel", () => {
      expect(checkKernelAccess("parecer_juridico", "institutional_rag").allowed).toBe(true);
      expect(checkKernelAccess("parecer_juridico", "copilot_infrastructure").allowed).toBe(true);
      expect(checkKernelAccess("parecer_juridico", "explainability").allowed).toBe(true);
    });

    it("router expõe os endpoints operacionais do domínio", () => {
      const procedures = Object.keys(legalOpinionWorkspaceRouter._def.procedures);
      for (const ep of ["listInbox", "receiveRequest", "loadContext", "createDraft", "updateOpinion", "signOpinion", "returnOpinion", "archiveOpinion"]) {
        expect(procedures).toContain(ep);
      }
    });
  });

  // ─── Observabilidade ───────────────────────────────────────────────────────

  describe("observabilidade", () => {
    const rows = [
      { sourceDomain: "processo_licitatorio", currentStage: "RETURNED", status: "devolvido", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T02:00:00.000Z" },
      { sourceDomain: "processo_licitatorio", currentStage: "UNDER_ANALYSIS", status: "em_analise", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T01:00:00.000Z" },
      { sourceDomain: "contratacao_direta", currentStage: "SIGNED", status: "assinado", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T04:00:00.000Z" },
    ];

    it("conta pareceres emitidos", () => {
      expect(emittedOpinions(rows)).toBe(2); // RETURNED + SIGNED
    });

    it("agrupa solicitações por origem", () => {
      expect(requestsByOrigin(rows)).toEqual({ processo_licitatorio: 2, contratacao_direta: 1 });
    });

    it("calcula tempo médio de análise dos concluídos", () => {
      // (2h + 4h) / 2 = 3h em ms
      expect(averageAnalysisMs(rows)).toBe(3 * 3600_000);
    });

    it("conta pendentes e mede produtividade", () => {
      expect(pendingOpinions(rows)).toBe(1);
      const prod = productivity(rows);
      expect(prod.emitted).toBe(2);
      expect(prod.pending).toBe(1);
    });
  });

  // ─── Serviço: reutiliza o Engine e degrada sem DB ──────────────────────────

  describe("legalOpinionWorkspaceService (sem DB)", () => {
    it("openWorkspaceFromRequest lança quando a solicitação não existe", async () => {
      await expect(openWorkspaceFromRequest({ requestId: "inexistente", organizationId: ORG_ID, lawyerId: 7, correlationId: CORR }))
        .rejects.toThrow("Solicitação não encontrada");
    });

    it("createOpinionDraft/updateOpinion/sign/return/archive lançam sem workspace", async () => {
      await expect(createOpinionDraft({ workspaceId: "x", organizationId: ORG_ID, author: 7, opinionType: "LEGAL_OPINION_INITIAL", correlationId: CORR }))
        .rejects.toThrow("Workspace de parecer não encontrado");
      await expect(updateOpinionDraft({ workspaceId: "x", organizationId: ORG_ID, author: 7, patch: { conclusion: "y" }, correlationId: CORR }))
        .rejects.toThrow("Workspace de parecer não encontrado");
      await expect(signOpinion({ workspaceId: "x", organizationId: ORG_ID, signedBy: 7, correlationId: CORR }))
        .rejects.toThrow("Workspace de parecer não encontrado");
      await expect(returnOpinion({ workspaceId: "x", organizationId: ORG_ID, responder: 7, correlationId: CORR }))
        .rejects.toThrow("Workspace de parecer não encontrado");
      await expect(archiveWorkspace({ workspaceId: "x", organizationId: ORG_ID, userId: 7 }))
        .rejects.toThrow("Workspace de parecer não encontrado");
    });

    it("loadWorkspaceContext degrada com contexto vazio (SÓ conteúdo operacional, sem LLM/Kernel)", async () => {
      const ctx = await loadWorkspaceContext({ workspaceId: "x", organizationId: ORG_ID, correlationId: CORR });
      expect(ctx.workspace).toBeNull();
      expect(ctx.documents).toEqual([]);
      expect(ctx.timeline).toEqual([]);
      expect(ctx.history).toEqual([]);
      expect(ctx.versions).toEqual([]);
      expect(ctx.snapshots).toEqual([]);
      // O contexto operacional NÃO carrega Reasoning/Explainability — apoio vem à parte.
      expect(ctx).not.toHaveProperty("reasoning");
      expect(ctx).not.toHaveProperty("explainability");
      expect(ctx).not.toHaveProperty("risks");
      expect(ctx).not.toHaveProperty("recommendations");
      expect(ctx).not.toHaveProperty("confidence");
    });

    it("loadWorkspaceReasoning (apoio) traz reasoning do copiloto — SEPARADO da abertura", async () => {
      const r = await loadWorkspaceReasoning({ workspaceId: "x", organizationId: ORG_ID, correlationId: CORR });
      expect(typeof r.reasoning.summary).toBe("string");
      expect(Array.isArray(r.recommendations)).toBe(true);
      expect(Array.isArray(r.risks)).toBe(true);
      expect(r.confidence).toBeGreaterThan(0);
    });
  });

  // ─── Persistência: degradação graciosa (getDb null) ───────────────────────

  describe("persistência (degrada sem DB)", () => {
    it("inserts retornam null e lists retornam vazio", async () => {
      const ws = createLegalOpinionWorkspace({ organizationId: ORG_ID, requestId: REQ, sourceDomain: "processo_licitatorio", referenceProcessId: "proc-1", requestType: "LEGAL_OPINION_INITIAL", correlationId: CORR });
      expect(await insertLegalOpinionWorkspace(ws)).toBeNull();
      expect(await getLegalOpinionWorkspace(ws.id, ORG_ID)).toBeNull();
      expect(await listLegalOpinionWorkspaces(ORG_ID)).toEqual([]);
      expect(await listLegalOpinionHistory("ws-1", ORG_ID)).toEqual([]);
      expect(await listLawyerAssignments(ORG_ID)).toEqual([]);
    });
  });
});

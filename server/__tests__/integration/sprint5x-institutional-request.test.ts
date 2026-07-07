import { describe, it, expect } from "vitest";

// Domain
import {
  createInstitutionalRequest, canTransition, transition, assignTo, isTerminal, isPendingForDestination,
} from "../../domain/institutionalRequest";
import { createInstitutionalResponse, signResponse, SUPPORTED_SIGNATURE_METHODS } from "../../domain/institutionalResponse";
import { createRequestTimelineEntry, appendRequestTimeline, requestTimelineSnapshot } from "../../domain/requestTimeline";
import { createRequestAssignment, prioritizeAssignments } from "../../domain/requestAssignment";
import { createRequestNotification, markDelivered, markRead, isChannelImplemented } from "../../domain/requestNotification";
import { createDocumentReference, verifySnapshot } from "../../domain/documentReference";
import { KERNEL_SERVICES, isKernelService } from "../../domain/cognitiveKernel";

// Services
import { requestInstitutionalReview, receiveRequest, respondRequest, archiveRequest } from "../../services/institutionalRequestService";
import { pendingByDomain, averageResponseMs, bottleneckDomain } from "../../services/requestObservabilityService";

// Persistence
import { insertRequest, getRequest, listPendingForDomain, listRequestTimeline, listDocumentReferences } from "../../db/institutionalRequests";

const ORG_ID = 10600;
const CORR = "corr-5x00";

describe("Sprint 5.X — Institutional Request Engine (Kernel)", () => {

  // ─── Kernel registration ───────────────────────────────────────────────────

  it("registrado como Kernel Service institutional_request_engine", () => {
    expect(isKernelService("institutional_request_engine")).toBe(true);
    expect(KERNEL_SERVICES.institutional_request_engine.name).toBe("Institutional Request Engine");
  });

  // ─── institutionalRequest ──────────────────────────────────────────────────

  describe("institutionalRequest", () => {
    const mk = () => createInstitutionalRequest({
      organizationId: ORG_ID, sourceDomain: "processo_licitatorio", destinationDomain: "parecer_juridico",
      requestType: "LEGAL_OPINION_INITIAL", referenceProcessId: "proc-1", title: "Solicitar parecer inicial",
      requestedBy: 7, correlationId: CORR,
    });

    it("cria solicitação NEW com id determinístico", () => {
      const a = mk(); const b = mk();
      expect(a.id).toBe(b.id);
      expect(a.status).toBe("NEW");
      expect(a.assignedTo).toBeNull();
    });

    it("máquina de estados: transições válidas/ inválidas", () => {
      expect(canTransition("NEW", "PENDING")).toBe(true);
      expect(canTransition("NEW", "COMPLETED")).toBe(false);
      expect(canTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
      expect(() => transition(mk(), "COMPLETED")).toThrow();
    });

    it("assignTo define o responsável", () => {
      expect(assignTo(mk(), 9).assignedTo).toBe(9);
    });

    it("isPendingForDestination reflete estados de trabalho", () => {
      expect(isPendingForDestination(transition(mk(), "PENDING"))).toBe(true);
      const archived = transition(transition(mk(), "PENDING"), "ARCHIVED");
      expect(isPendingForDestination(archived)).toBe(false);
      expect(isTerminal(archived)).toBe(true);
    });

    it("multi-tenant: org diferente → id diferente", () => {
      const other = createInstitutionalRequest({ organizationId: 99999, sourceDomain: "processo_licitatorio", destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_INITIAL", referenceProcessId: "proc-1", title: "x", requestedBy: 7, correlationId: CORR });
      expect(mk().id).not.toBe(other.id);
    });
  });

  // ─── institutionalResponse ─────────────────────────────────────────────────

  describe("institutionalResponse", () => {
    const mk = () => createInstitutionalResponse({ requestId: "req-1", organizationId: ORG_ID, responder: 7, responseType: "parecer", responseStatus: "favoravel", correlationId: CORR });

    it("cria resposta não assinada", () => {
      const r = mk();
      expect(r.signed).toBe(false);
      expect(r.signatureMethod).toBeNull();
    });

    it("signResponse é placeholder (registra método, não assina de verdade)", () => {
      const signed = signResponse(mk(), "gov_br", "2026-07-06T00:00:00.000Z");
      expect(signed.signed).toBe(true);
      expect(signed.signatureMethod).toBe("gov_br");
    });

    it("SUPPORTED_SIGNATURE_METHODS lista os 4 métodos previstos", () => {
      expect(SUPPORTED_SIGNATURE_METHODS).toEqual(["manual", "icp_brasil", "gov_br", "certificado_a1"]);
    });
  });

  // ─── requestTimeline ───────────────────────────────────────────────────────

  describe("requestTimeline", () => {
    it("appendRequestTimeline calcula ordem", () => {
      let e = appendRequestTimeline([], { requestId: "req-1", organizationId: ORG_ID, eventType: "created", actor: "u1", summary: "a", correlationId: CORR });
      e = appendRequestTimeline(e, { requestId: "req-1", organizationId: ORG_ID, eventType: "forwarded", actor: "kernel", summary: "b", correlationId: CORR });
      expect(e).toHaveLength(2);
      expect(e[1].order).toBe(1);
    });

    it("requestTimelineSnapshot é determinístico", () => {
      const e = [createRequestTimelineEntry({ requestId: "req-1", organizationId: ORG_ID, order: 0, eventType: "responded", actor: "u1", summary: "s", correlationId: CORR })];
      expect(requestTimelineSnapshot(e)).toBe(requestTimelineSnapshot(e));
    });
  });

  // ─── requestAssignment ─────────────────────────────────────────────────────

  describe("requestAssignment", () => {
    it("prioritizeAssignments ordena por prioridade", () => {
      const low = createRequestAssignment({ requestId: "r1", organizationId: ORG_ID, priority: "baixa", queue: "juridico", correlationId: CORR });
      const urgent = createRequestAssignment({ requestId: "r2", organizationId: ORG_ID, priority: "urgente", queue: "juridico", correlationId: CORR });
      expect(prioritizeAssignments([low, urgent])[0].priority).toBe("urgente");
    });
  });

  // ─── requestNotification ───────────────────────────────────────────────────

  describe("requestNotification", () => {
    it("apenas canal 'sistema' está implementado", () => {
      expect(isChannelImplemented("sistema")).toBe(true);
      expect(isChannelImplemented("email")).toBe(false);
      expect(isChannelImplemented("whatsapp")).toBe(false);
    });

    it("markDelivered/markRead mudam status", () => {
      const n = createRequestNotification({ requestId: "r1", organizationId: ORG_ID, recipientUser: 7, title: "t", correlationId: CORR });
      expect(markDelivered(n).status).toBe("entregue");
      expect(markRead(n).status).toBe("lida");
    });
  });

  // ─── documentReference ─────────────────────────────────────────────────────

  describe("documentReference", () => {
    it("cria referência com snapshot (documento NUNCA copiado)", () => {
      const ref = createDocumentReference({ organizationId: ORG_ID, requestId: "req-1", originDomain: "processo_licitatorio", documentId: "doc-1", version: 2, snapshotSource: "conteudo", correlationId: CORR });
      expect(ref.snapshot).toMatch(/^[a-f0-9]{32}$/);
      expect(ref.version).toBe(2);
    });

    it("verifySnapshot confirma integridade do conteúdo referenciado", () => {
      const ref = createDocumentReference({ organizationId: ORG_ID, requestId: "req-1", originDomain: "processo_licitatorio", documentId: "doc-1", snapshotSource: "conteudo-x", correlationId: CORR });
      expect(verifySnapshot(ref, "conteudo-x")).toBe(true);
      expect(verifySnapshot(ref, "conteudo-alterado")).toBe(false);
    });
  });

  // ─── institutionalRequestService (a API única) ──────────────────────────────

  describe("institutionalRequestService", () => {
    it("requestInstitutionalReview cria, encaminha (PENDING) e monta contexto por referência", async () => {
      const result = await requestInstitutionalReview({
        organizationId: ORG_ID, sourceDomain: "processo_licitatorio", destinationDomain: "parecer_juridico",
        requestType: "LEGAL_OPINION_INITIAL", referenceProcessId: "proc-1", title: "Parecer inicial", requestedBy: 7,
        documents: [{ documentId: "tr-1", title: "TR" }, { documentId: "etp-1", title: "ETP" }], correlationId: CORR,
      });
      expect(result.request.status).toBe("PENDING");
      expect(result.request.sourceDomain).toBe("processo_licitatorio");
      expect(result.request.destinationDomain).toBe("parecer_juridico");
      expect(result.context.documentReferenceIds).toHaveLength(2);
      expect(result.context.referenceProcessId).toBe("proc-1");
    });

    it("requestInstitutionalReview rejeita origem == destino", async () => {
      await expect(requestInstitutionalReview({
        organizationId: ORG_ID, sourceDomain: "contratos", destinationDomain: "contratos",
        requestType: "DOCUMENT_REVIEW", referenceProcessId: "p", title: "x", requestedBy: 1, correlationId: CORR,
      })).rejects.toThrow();
    });

    it("é determinístico (mesma solicitação → mesmo id)", async () => {
      const a = await requestInstitutionalReview({ organizationId: ORG_ID, sourceDomain: "contratos", destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_FINAL", referenceProcessId: "c-1", title: "t", requestedBy: 1, correlationId: CORR });
      const b = await requestInstitutionalReview({ organizationId: ORG_ID, sourceDomain: "contratos", destinationDomain: "parecer_juridico", requestType: "LEGAL_OPINION_FINAL", referenceProcessId: "c-1", title: "t", requestedBy: 1, correlationId: CORR });
      expect(a.request.id).toBe(b.request.id);
    });

    it("receiveRequest/respondRequest/archiveRequest degradam sem DB (não encontrada)", async () => {
      await expect(receiveRequest("x", ORG_ID, 7)).rejects.toThrow();
      await expect(respondRequest({ id: "x", organizationId: ORG_ID, responder: 7, responseType: "parecer", responseStatus: "favoravel", correlationId: CORR })).rejects.toThrow();
      await expect(archiveRequest("x", ORG_ID, 7)).rejects.toThrow();
    });
  });

  // ─── requestObservabilityService ─────────────────────────────────────────────

  describe("requestObservabilityService", () => {
    const rows = [
      { destinationDomain: "parecer_juridico", status: "PENDING", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { destinationDomain: "parecer_juridico", status: "IN_PROGRESS", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { destinationDomain: "controle_interno", status: "COMPLETED", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T01:00:00.000Z" },
    ];

    it("pendingByDomain conta pendências por destino", () => {
      const p = pendingByDomain(rows);
      expect(p.parecer_juridico).toBe(2);
      expect(p.controle_interno ?? 0).toBe(0);
    });

    it("bottleneckDomain identifica o maior gargalo", () => {
      expect(bottleneckDomain(rows)).toBe("parecer_juridico");
    });

    it("averageResponseMs calcula tempo médio de concluídas", () => {
      expect(averageResponseMs(rows)).toBe(3600000); // 1h para a única concluída
    });
  });

  // ─── Persistence: graceful degradation ───────────────────────────────────────

  describe("persistence — degradação graciosa sem DB", () => {
    it("insertRequest null / getRequest null / listPendingForDomain []", async () => {
      const r = createInstitutionalRequest({ organizationId: ORG_ID, sourceDomain: "processo_licitatorio", destinationDomain: "parecer_juridico", requestType: "APPROVAL", referenceProcessId: "p", title: "t", requestedBy: 1, correlationId: CORR });
      await expect(insertRequest(r)).resolves.toBeNull();
      await expect(getRequest(r.id, ORG_ID)).resolves.toBeNull();
      await expect(listPendingForDomain(ORG_ID, "parecer_juridico")).resolves.toEqual([]);
    });

    it("listRequestTimeline / listDocumentReferences [] sem DB", async () => {
      await expect(listRequestTimeline("x", ORG_ID)).resolves.toEqual([]);
      await expect(listDocumentReferences("x", ORG_ID)).resolves.toEqual([]);
    });
  });
});

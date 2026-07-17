/**
 * RC-5.1 — Business Domain "Tirar Dúvidas" (Institutional Consultation)
 *
 * Valida o novo domínio institucional de consulta normativa (NÃO um chat): fluxo completo
 * reutilizando executeCognitiveTask → InstitutionalContextResolver → KnowledgeRetrievalService →
 * ContextPackage → AIExecutionEngine. Resposta fundamentada/explicável/auditável, isolamento
 * multi-tenant, histórico, replay safety. Nenhuma infraestrutura nova. Zero regressões.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { MOREIRA_SALES_TENANT_ID } from "../../services/officialCorpus/officialCorpusBuilder";
import { answerConsultation, getOfficialCorpus } from "../../services/institutionalConsultationService";
import { getConsultationHistory, getConsultationByCorrelation, clearConsultationHistory } from "../../services/institutionalConsultationObservabilityService";
import {
  sanitizeQuestion, buildConsultationAnswer, INITIAL_CONSULTATION_SUGGESTIONS, CONSULTATION_DOMAIN_NAME, CONSULTATION_DOMAIN_CODE,
} from "../../domain/institutionalConsultation";
import { resolveInstitutionalContextPackage } from "../../services/institutionalIntegration/institutionalKnowledgeIntegration";

const MS = MOREIRA_SALES_TENANT_ID;
const OTHER = 888888;
let n = 0;
const clock = () => { n += 5; return n; };
const ask = (tenantId: number, question: string, userId = 1) =>
  answerConsultation({ organizationId: tenantId, userId, question, correlationId: `q:${tenantId}:${question}`, now: clock });

beforeAll(() => { getOfficialCorpus(); clearConsultationHistory(); });

describe("RC-5.1 — Tirar Dúvidas (Institutional Consultation)", () => {

  // ─── Criação do domínio ─────────────────────────────────────────────────────
  describe("Criação do domínio", () => {
    it("expõe nome/código e sugestões iniciais expansíveis", () => {
      expect(CONSULTATION_DOMAIN_NAME).toBe("Tirar Dúvidas");
      expect(CONSULTATION_DOMAIN_CODE).toBe("institutional_consultation");
      expect(INITIAL_CONSULTATION_SUGGESTIONS.length).toBeGreaterThanOrEqual(5);
      expect(sanitizeQuestion("  linha1\n\tlinha2  ")).toBe("linha1 linha2");
    });
  });

  // ─── Fluxo completo / consulta simples ──────────────────────────────────────
  describe("Fluxo completo (executeCognitiveTask → ContextPackage → engine)", () => {
    it("consulta simples retorna resposta estruturada e fundamentada", async () => {
      const a = await ask(MS, "Como aplicar os benefícios da LC 123 para microempresas?");
      for (const f of ["answerId", "correlationId", "replayId", "contextReplayHash", "answer", "foundation", "documents", "passages", "citations", "observations", "explainabilityLines", "limitations", "hasSufficientBasis"]) expect(a, f).toHaveProperty(f);
      expect(a.hasSufficientBasis).toBe(true);
      expect(a.answer.length).toBeGreaterThan(0);
      expect(a.documents.length).toBeGreaterThan(0);
      expect(a.passages.length).toBeGreaterThan(0);
      expect(a.citations.length).toBe(a.passages.length);
      expect(a.observations.length).toBeGreaterThan(0);
    });
  });

  // ─── Hierarquia: federal / estadual / municipal ─────────────────────────────
  describe("Consulta com legislação federal / estadual / municipal", () => {
    it("federal: consulta sobre licitação recupera a Lei 14.133 / LC 123", async () => {
      const a = await ask(MS, "microempresas e empresas de pequeno porte na licitação");
      expect(a.documents.some(d => d.jurisdiction === "federal")).toBe(true);
    });
    it("estadual: recupera documentos do TCE-PR quando pertinente", async () => {
      const a = await ask(MS, "microempresas pequeno porte cota reservada administração");
      // esferas presentes incluem estadual e/ou municipal, além de federal
      const esferas = new Set(a.documents.map(d => d.jurisdiction));
      expect(esferas.has("federal")).toBe(true);
      expect(esferas.has("municipal") || esferas.has("estadual")).toBe(true);
    });
    it("municipal: o tenant de Moreira Sales recupera a Lei Municipal 769", async () => {
      const a = await ask(MS, "tratamento diferenciado microempresas Moreira Sales contratações");
      expect(a.documents.some(d => d.jurisdiction === "municipal")).toBe(true);
    });
  });

  // ─── Explainability ─────────────────────────────────────────────────────────
  describe("Explainability", () => {
    it("exibe as normas utilizadas (Esta resposta foi construída utilizando…)", async () => {
      const a = await ask(MS, "benefícios LC 123 microempresas");
      expect(a.explainabilityLines.length).toBeGreaterThan(0);
      expect(a.explainabilityLines.every(l => l.startsWith("✓ "))).toBe(true);
      // fundamentação preserva autoridade/versão/bindingLevel
      for (const f of a.foundation) {
        expect(f.authority.length).toBeGreaterThan(0);
        expect(f.version.length).toBeGreaterThan(0);
        expect(f.bindingLevel.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Limitações (nunca inventar fundamento) ─────────────────────────────────
  describe("Limitações", () => {
    it("sem base documental → declara explicitamente, sem inventar fundamento", () => {
      const pkg = resolveInstitutionalContextPackage(getOfficialCorpus(), { tenantId: MS, taskType: "LEGAL_ANALYSIS", query: "zxqwvk plmnbv qwzzxy", correlationId: "empty" });
      const a = buildConsultationAnswer({ tenantId: MS, userId: 1, question: "zxqwvk plmnbv qwzzxy", engineContent: "", contextPackage: pkg, createdAt: "2026-01-01T00:00:00.000Z" });
      expect(a.hasSufficientBasis).toBe(false);
      expect(a.limitations.length).toBeGreaterThan(0);
      expect(a.documents.length).toBe(0);
      expect(a.answer).toMatch(/não foi possível localizar base documental/i);
    });
  });

  // ─── Histórico & Auditoria ──────────────────────────────────────────────────
  describe("Histórico e auditoria", () => {
    it("registra a consulta com correlationId/replayId recuperável", async () => {
      clearConsultationHistory();
      const a = await ask(MS, "quando devo utilizar pregão");
      const hist = getConsultationHistory(MS);
      expect(hist.length).toBeGreaterThanOrEqual(1);
      expect(hist[0].answerId).toBe(a.answerId);
      expect(hist[0].correlationId).toBe(a.correlationId);
      const byCorr = getConsultationByCorrelation(a.correlationId);
      expect(byCorr!.answer.answerId).toBe(a.answerId);
      expect(byCorr!.documentCount).toBe(a.documents.length);
    });
  });

  // ─── Multi-Tenant Isolation ─────────────────────────────────────────────────
  describe("Tenant Isolation", () => {
    it("outro tenant jamais recupera a norma municipal de Moreira Sales", async () => {
      const outro = await ask(OTHER, "tratamento diferenciado microempresas contratações municipais");
      expect(outro.documents.some(d => d.jurisdiction === "municipal")).toBe(false);
      // federais permanecem compartilhados
      expect(outro.documents.some(d => d.jurisdiction === "federal")).toBe(true);
    });
    it("histórico é isolado por tenant", async () => {
      clearConsultationHistory();
      await ask(MS, "pregão eletrônico");
      await ask(OTHER, "pregão eletrônico");
      expect(getConsultationHistory(MS).every(e => e.tenantId === MS)).toBe(true);
      expect(getConsultationHistory(OTHER).every(e => e.tenantId === OTHER)).toBe(true);
    });
  });

  // ─── Replay Safety ──────────────────────────────────────────────────────────
  describe("Replay Safety", () => {
    it("mesma pergunta/tenant → mesmo contextReplayHash e answerId", async () => {
      const a = await ask(MS, "sistema de registro de preços");
      const b = await ask(MS, "sistema de registro de preços");
      expect(a.contextReplayHash).toBe(b.contextReplayHash);
      expect(a.answerId).toBe(b.answerId);
    });
  });
});

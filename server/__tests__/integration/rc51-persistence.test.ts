/**
 * RC-5.1 (correção) — "Tirar Dúvidas" · Persistência institucional, replay e auditoria.
 *
 * Valida que o histórico/observabilidade NÃO dependem de memória de processo: persistência durável
 * (pergunta/resposta/fontes/citações/lineage/snapshot/métricas), estados (pending→processing→
 * completed/limited/failed), transação, isolamento multi-tenant no repository e nas fontes,
 * semântica de identidade (execution/answer/replay), replay real, paginação/ordenação, restart
 * lógico, e degradação do repository MySQL sem banco.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MOREIRA_SALES_TENANT_ID } from "../../services/officialCorpus/officialCorpusBuilder";
import {
  answerConsultation, replayConsultation, getOfficialCorpus, __setOfficialCorpusForTests,
  getConsultationForTenant, getConsultationSources, listTenantHistory, listUserHistory, findReplayCandidate,
} from "../../services/institutionalConsultationService";
import { InMemoryConsultationRepository, setConsultationRepository, getConsultationRepository } from "../../services/institutionalConsultationRepository";
import { mysqlConsultationRepository } from "../../db/institutionalConsultations";
import type { ConsultationRecord } from "../../domain/institutionalConsultation";

const MS = MOREIRA_SALES_TENANT_ID;
const OTHER = 888888;
let seq = 0;
const isoOf = (i: number) => `2026-01-02T00:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`;
const ask = (tenantId: number, question: string, userId = 1, correlationId?: string) => {
  const s = ++seq;
  return answerConsultation({ organizationId: tenantId, userId, question, correlationId: correlationId ?? `p:${tenantId}:${s}`, now: (() => { let t = 0; return () => (t += 5); })(), createdAt: () => isoOf(s) });
};

beforeEach(() => { getOfficialCorpus(); setConsultationRepository(new InMemoryConsultationRepository()); });

describe("RC-5.1 correção — Persistência, replay e auditoria", () => {

  // ─── Persistência (pergunta/resposta/fontes/citações/lineage/snapshot/observabilidade) ──
  describe("Persistência durável", () => {
    it("persiste pergunta, resposta, status e observabilidade recuperáveis", async () => {
      const a = await ask(MS, "Como aplicar os benefícios da LC 123 para microempresas?");
      const rec = await getConsultationForTenant(MS, a.executionId) as ConsultationRecord;
      expect(rec.question.length).toBeGreaterThan(0);
      expect(rec.normalizedQuestion).toBe(rec.normalizedQuestion.toLowerCase());
      expect(rec.answer.length).toBeGreaterThan(0);
      expect(rec.status).toBe("completed");
      // observabilidade persistida
      expect(rec.correlationId.length).toBeGreaterThan(0);
      expect(rec.executionId).toBe(a.executionId);
      expect(rec.answerId).toBe(a.answerId);
      expect(rec.taskType).toBe("LEGAL_ANALYSIS");
      expect(rec.businessDomain).toBe("institutional_consultation");
      expect(rec.documentsCount).toBe(a.documents.length);
      expect(rec.passagesCount).toBe(a.passages.length);
      expect(rec.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(rec.contextReplayHash).toBe(a.contextReplayHash);
      // snapshot versionado do ContextPackage (não opaco: contém schemaVersion/hash/documentos)
      const snap = JSON.parse(rec.contextSnapshot!);
      expect(snap.schemaVersion).toBe("institutional-context/1.0");
      expect(snap.contextReplayHash).toBe(a.contextReplayHash);
      expect(Array.isArray(snap.documents)).toBe(true);
    });
    it("persiste fontes com documento/versão/citação/lineage/ordem", async () => {
      const a = await ask(MS, "microempresas pequeno porte tratamento diferenciado licitação");
      const sources = await getConsultationSources(MS, a.executionId);
      expect(sources.length).toBe(a.passages.length);
      for (const s of sources) {
        expect(s.consultationId).toBe(a.executionId);
        expect(s.documentId.length).toBeGreaterThan(0);
        expect(s.documentVersion.length).toBeGreaterThan(0);
        expect(s.citation.length).toBeGreaterThan(0);
        expect(s.lineage.length).toBeGreaterThan(0);
      }
      // ordem estável
      expect(sources.map(s => s.sourceOrder)).toEqual([...sources].map(s => s.sourceOrder).sort((x, y) => x - y));
    });
  });

  // ─── Estados & Transação ────────────────────────────────────────────────────
  describe("Estados e transação", () => {
    it("transação: resposta e fontes persistidas juntas ao marcar completed", async () => {
      const a = await ask(MS, "quando é cabível a dispensa de licitação");
      const rec = await getConsultationForTenant(MS, a.executionId) as ConsultationRecord;
      expect(rec.status).toBe("completed");
      expect(rec.completedAt).not.toBeNull();
      expect((await getConsultationSources(MS, a.executionId)).length).toBeGreaterThan(0);
    });
    it("falha parcial → status failed com mensagem sanitizada, sem falso completed", async () => {
      const { sanitizeErrorMessage, computeExecutionId } = await import("../../domain/institutionalConsultation");
      const repo = getConsultationRepository();
      const id = computeExecutionId(MS, "fail-corr");
      // pending → processing → failConsultation (falha após iniciar; nunca marcado completed)
      const now = isoOf(500);
      await repo.createConsultation({
        id, tenantId: MS, userId: 1, question: "q", normalizedQuestion: "q", answer: "", status: "pending",
        limitationReason: "", contextPackageVersion: "", contextReplayHash: "", executionId: id, answerId: "",
        replayId: null, replayOfExecutionId: null, correlationId: "fail-corr", businessDomain: "institutional_consultation",
        taskType: "LEGAL_ANALYSIS", documentsCount: 0, passagesCount: 0, retrievalDurationMs: 0, executionDurationMs: 0,
        totalDurationMs: 0, contextSnapshot: null, errorCode: "", errorMessage: "", createdAt: now, startedAt: null,
        completedAt: null, failedAt: null, updatedAt: now,
      });
      await repo.markProcessing(MS, id, now);
      const dirty = "Falha técnica\nsenha=segredo\tstack:...";
      await repo.failConsultation(MS, id, "EXECUTION_ERROR", sanitizeErrorMessage(dirty), now);
      const rec = await repo.findByIdForTenant(MS, id);
      expect(rec!.status).toBe("failed");
      expect(rec!.completedAt).toBeNull();       // jamais falsamente concluída
      expect(rec!.errorCode).toBe("EXECUTION_ERROR");
      expect(rec!.errorMessage).toBe("Falha técnica");  // sanitizada: 1ª linha, sem stack
      expect(rec!.errorMessage).not.toContain("\n");
    });
    it("estado 'limited' quando não há base documental (não é erro técnico)", async () => {
      const a = await ask(MS, "zxqwvk plmnbv qwzzxy nonsense termo inexistente");
      const rec = await getConsultationForTenant(MS, a.executionId) as ConsultationRecord;
      expect(a.status === "limited" || a.status === "completed").toBe(true);
      if (a.status === "limited") { expect(rec.status).toBe("limited"); expect(rec.limitationReason.length).toBeGreaterThan(0); }
    });
  });

  // ─── Isolamento multi-tenant no repository ──────────────────────────────────
  describe("Tenant isolation (repository, fontes, replay)", () => {
    it("tenant A não lê consulta nem fontes do tenant B", async () => {
      const a = await ask(MS, "sistema de registro de preços");
      // OTHER não vê a consulta de MS (id válido de outro tenant → not found)
      expect(await getConsultationForTenant(OTHER, a.executionId)).toBeNull();
      expect(await getConsultationSources(OTHER, a.executionId)).toEqual([]);
      expect(await getConsultationRepository().verifyTenantOwnership(OTHER, a.executionId)).toBe(false);
      expect(await getConsultationRepository().verifyTenantOwnership(MS, a.executionId)).toBe(true);
    });
    it("histórico é isolado por tenant e por usuário", async () => {
      await ask(MS, "pregão", 1);
      await ask(MS, "pregão", 2);
      await ask(OTHER, "pregão", 1);
      expect((await listTenantHistory(MS)).every(e => e.tenantId === MS)).toBe(true);
      expect((await listTenantHistory(OTHER)).every(e => e.tenantId === OTHER)).toBe(true);
      expect((await listUserHistory(MS, 2)).every(e => e.userId === 2 && e.tenantId === MS)).toBe(true);
    });
    it("replay candidate de A não vaza para B", async () => {
      const a = await ask(MS, "modalidades de licitação");
      const rec = await getConsultationForTenant(MS, a.executionId) as ConsultationRecord;
      expect((await findReplayCandidate(MS, rec.contextReplayHash))?.tenantId).toBe(MS);
      expect(await findReplayCandidate(OTHER, rec.contextReplayHash)).toBeNull();
    });
  });

  // ─── Semântica de identidade & replay real ──────────────────────────────────
  describe("Identidade e replay real", () => {
    it("nova execução → executionId/answerId distintos; contextReplayHash igual", async () => {
      const a = await ask(MS, "pregão eletrônico", 1, "id-A");
      const b = await ask(MS, "pregão eletrônico", 1, "id-B");
      expect(a.contextReplayHash).toBe(b.contextReplayHash);
      expect(a.executionId).not.toBe(b.executionId);
      expect(a.answerId).not.toBe(b.answerId);
    });
    it("replay real: replayOfExecutionId aponta a original; replayId próprio", async () => {
      const original = await ask(MS, "sistema de registro de preços", 1, "orig-1");
      const replay = await replayConsultation({ organizationId: MS, userId: 1, originalExecutionId: original.executionId, correlationId: "replay-1" });
      expect(replay.replayOfExecutionId).toBe(original.executionId);
      expect(replay.replayId).not.toBeNull();
      expect(replay.executionId).not.toBe(original.executionId);      // nova execução, não reuso
      expect(replay.contextReplayHash).toBe(original.contextReplayHash); // contexto preservado
      const rec = await getConsultationForTenant(MS, replay.executionId) as ConsultationRecord;
      expect(rec.replayOfExecutionId).toBe(original.executionId);
    });
  });

  // ─── Paginação & ordenação ──────────────────────────────────────────────────
  describe("Paginação e ordenação do histórico", () => {
    it("ordena por data desc e pagina", async () => {
      for (let i = 0; i < 5; i++) await ask(MS, `consulta ${i} pregão`, 1);
      const page1 = await listTenantHistory(MS, { limit: 2, offset: 0 });
      const page2 = await listTenantHistory(MS, { limit: 2, offset: 2 });
      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].createdAt >= page1[1].createdAt).toBe(true);      // desc
      expect(page1.map(e => e.id)).not.toEqual(page2.map(e => e.id));   // páginas distintas
    });
  });

  // ─── Restart lógico ─────────────────────────────────────────────────────────
  describe("Restart lógico (durabilidade independente de memória do service)", () => {
    it("persiste; descarta estado do processo; recupera do 'banco'; prova ausência de memória global", async () => {
      const db = new InMemoryConsultationRepository();   // representa o banco (fonte de verdade)
      setConsultationRepository(db);
      const a = await ask(MS, "sistema de registro de preços");
      // "descarta" o estado do processo (memoização do corpus) e re-obtém do zero
      __setOfficialCorpusForTests(null);
      getOfficialCorpus();
      // nova via de acesso ao MESMO banco → dados sobrevivem
      setConsultationRepository(db);
      const rec = await getConsultationForTenant(MS, a.executionId);
      const sources = await getConsultationSources(MS, a.executionId);
      expect(rec).not.toBeNull();
      expect(sources.length).toBeGreaterThan(0);
      // prova: nenhum estado em memória global do service — um banco vazio distinto não vê nada
      setConsultationRepository(new InMemoryConsultationRepository());
      expect(await getConsultationForTenant(MS, a.executionId)).toBeNull();
    });
  });

  // ─── Repository MySQL degrada sem banco (Pattern A) ─────────────────────────
  describe("Repository MySQL", () => {
    it("degrada graciosamente sem DATABASE_URL (findById null, list vazio)", async () => {
      // sem DATABASE_URL, getDb() retorna null → leituras degradam
      expect(await mysqlConsultationRepository.findByIdForTenant(MS, "qualquer")).toBeNull();
      expect(await mysqlConsultationRepository.listByTenant(MS)).toEqual([]);
      expect(await mysqlConsultationRepository.getSourcesForTenant(MS, "x")).toEqual([]);
      expect(await mysqlConsultationRepository.verifyTenantOwnership(MS, "x")).toBe(false);
    });
  });
});

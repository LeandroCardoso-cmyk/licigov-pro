/**
 * RC-4.2.2 — Production Monitoring
 *
 * Valida o Monitor Operacional Institucional: Database/Storage/Provider/Cognitive/
 * Environment Health, Health Score determinístico, Production Report, endpoint público
 * (sem secrets) e observabilidade do próprio Health Check. Sem executar IA/providers.
 */

import { describe, it, expect } from "vitest";
import {
  runProductionHealthCheck, computeHealthScore, scoreBand, toPublicSummary,
  getHealthCheckRuns, clearHealthCheckRuns, type ModuleHealth,
} from "../../services/productionMonitoringService";
import { systemRouter } from "../../_core/systemRouter";

const mod = (status: ModuleHealth["status"]): ModuleHealth => ({ module: "m", status, message: "", detail: "", recommendation: "" });

describe("RC-4.2.2 — Production Monitoring", () => {

  // ─── Part 9 — Health Score determinístico ───────────────────────────────────
  describe("Health Score determinístico", () => {
    it("100 sem problemas; −10 por WARNING; −30 por CRITICAL; clamp [0,100]", () => {
      expect(computeHealthScore([mod("OK"), mod("OK")])).toBe(100);
      expect(computeHealthScore([mod("OK"), mod("WARNING")])).toBe(90);
      expect(computeHealthScore([mod("CRITICAL"), mod("WARNING")])).toBe(60);
      expect(computeHealthScore(Array.from({ length: 10 }, () => mod("CRITICAL")))).toBe(0);
    });

    it("bandas institucionais por faixa", () => {
      expect(scoreBand(100)).toMatch(/totalmente operacional/);
      expect(scoreBand(90)).toMatch(/Pronto para produção/);
      expect(scoreBand(70)).toMatch(/observações/);
      expect(scoreBand(50)).toMatch(/intervenção/);
      expect(scoreBand(0)).toMatch(/indisponível/);
    });
  });

  // ─── Parts 2-7 — Production Report ──────────────────────────────────────────
  describe("Production Report (diagnóstico consolidado)", () => {
    it("avalia todos os módulos com status/mensagem/detalhe/recomendação", async () => {
      const r = await runProductionHealthCheck({ correlationId: "corr-rc422-a", now: 1_000 });
      const names = r.modules.map(m => m.module);
      for (const n of ["database", "storage", "provider_layer", "cognitive_kernel", "institutional_rules", "reasoning_framework", "replay_safety", "explainability", "document_engine", "observability", "knowledge_graph", "rag", "environment"]) {
        expect(names, `módulo ${n}`).toContain(n);
      }
      for (const m of r.modules) {
        expect(["OK", "WARNING", "CRITICAL"]).toContain(m.status);
        for (const f of ["module", "status", "message", "detail", "recommendation"]) expect(m).toHaveProperty(f);
      }
      expect(typeof r.healthScore).toBe("number");
      expect(r.healthScore).toBeGreaterThanOrEqual(0);
      expect(r.healthScore).toBeLessThanOrEqual(100);
      expect(["OK", "WARNING", "CRITICAL"]).toContain(r.overallStatus);
    });

    it("é determinístico: duas execuções → mesmo score e mesmos status por módulo", async () => {
      const a = await runProductionHealthCheck({ correlationId: "x", now: 1 });
      const b = await runProductionHealthCheck({ correlationId: "y", now: 1 });
      expect(a.healthScore).toBe(b.healthScore);
      expect(a.modules.map(m => `${m.module}:${m.status}`)).toEqual(b.modules.map(m => `${m.module}:${m.status}`));
    });

    it("Cognitive Health é estrutural (13 tasks, 12 etapas, replay determinístico) sem executar IA", async () => {
      const r = await runProductionHealthCheck();
      expect(r.modules.find(m => m.module === "cognitive_kernel")!.status).toBe("OK");
      expect(r.modules.find(m => m.module === "reasoning_framework")!.status).toBe("OK");
      expect(r.modules.find(m => m.module === "replay_safety")!.status).toBe("OK");
      expect(r.modules.find(m => m.module === "provider_layer")!.status).toBe("OK");
    });
  });

  // ─── Part 8 — Endpoint + sumário público (sem secrets) ──────────────────────
  describe("Endpoint institucional /system/health (sem secrets)", () => {
    it("expõe productionHealth e retorna sumário seguro", async () => {
      expect(Object.keys(systemRouter._def.procedures)).toContain("productionHealth");
      const r = await runProductionHealthCheck();
      const pub = toPublicSummary(r);
      for (const f of ["overallStatus", "healthScore", "scoreBand", "warnings", "criticalIssues", "infrastructure"]) {
        expect(pub, f).toHaveProperty(f);
      }
      // Nunca expõe VALORES de secrets (nomes de variáveis são permitidos).
      const original = process.env.JWT_SECRET;
      process.env.JWT_SECRET = "SENTINEL_SECRET_VALUE_123";
      try {
        const pub2 = toPublicSummary(await runProductionHealthCheck());
        const serialized = JSON.stringify(pub2);
        expect(serialized).not.toContain("SENTINEL_SECRET_VALUE_123");
        // infra só carrega status por módulo (nunca valores).
        for (const v of Object.values(pub2.infrastructure)) expect(["OK", "WARNING", "CRITICAL"]).toContain(v);
      } finally {
        if (original === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = original;
      }
      expect(pub.infrastructure.database).toBeDefined();
    });
  });

  // ─── Part 10 — Observabilidade do Health Check (retenção simples) ───────────
  describe("Observabilidade do Health Check", () => {
    it("cada execução gera um run com correlationId/timestamp/duration/status", async () => {
      clearHealthCheckRuns();
      await runProductionHealthCheck({ correlationId: "run-1", now: 100 });
      await runProductionHealthCheck({ correlationId: "run-2", now: 200 });
      const runs = getHealthCheckRuns();
      expect(runs.length).toBe(2);
      expect(runs[0].correlationId).toBe("run-1");
      for (const f of ["correlationId", "timestamp", "durationMs", "overallStatus", "healthScore", "modulesEvaluated", "warnings", "criticalIssues"]) {
        expect(runs[1]).toHaveProperty(f);
      }
    });

    it("retenção simples: mantém no máximo os últimos 50 registros", async () => {
      clearHealthCheckRuns();
      for (let i = 0; i < 55; i++) await runProductionHealthCheck({ correlationId: `r${i}`, now: i });
      expect(getHealthCheckRuns().length).toBeLessThanOrEqual(50);
      clearHealthCheckRuns();
      expect(getHealthCheckRuns().length).toBe(0);
    });
  });
});

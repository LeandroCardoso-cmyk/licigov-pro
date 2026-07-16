/**
 * RC-4.2.1 — Production Readiness
 *
 * Valida as pendências operacionais: observabilidade persistente + recuperação por
 * correlationId, Storage validado, Provider Adapter íntegro, Health Check institucional,
 * validação explícita de ambiente (sem fallback silencioso). Kernel inalterado.
 */

import { describe, it, expect } from "vitest";

import { executeCognitiveTask } from "../../services/aiExecutionEngine";
import { recoverCognitiveObservability, getCognitiveObservability } from "../../services/cognitive/cognitiveObservabilityService";
import { persistObservability, recoverObservabilityRow } from "../../services/cognitive/observabilityRepository";
import { insertObservability, getObservabilityByCorrelation } from "../../db/cognitiveObservability";
import { storageReadiness, storageSignedUrl, isStorageConfigured } from "../../storage";
import { providerReadiness, operationalHealth, productionReadinessReport } from "../../services/operationalHealthService";
import { environmentDiagnostic, validateRequiredEnv, PRODUCTION_REQUIRED_ENV } from "../../config/env";

const ORG = 12000;

describe("RC-4.2.1 — Production Readiness", () => {

  // ─── Part 1/2 — Observabilidade persistente + recuperação ───────────────────
  describe("Observabilidade persistente", () => {
    it("recordCognitiveObservability é recuperável por correlationId (memória)", async () => {
      await executeCognitiveTask({ task: "RISK_ANALYSIS", tenantId: ORG, userId: "1", correlationId: "corr-rc421-a", query: "x", businessDomain: "contratos" });
      const rec = await recoverCognitiveObservability("corr-rc421-a");
      expect(rec).not.toBeNull();
      expect(rec!.correlationId).toBe("corr-rc421-a");
      expect(rec!.reasoningPlanId.length).toBeGreaterThan(0);
      // cache em memória também disponível
      expect(getCognitiveObservability("corr-rc421-a")).not.toBeNull();
    });

    it("a persistência degrada sem DB (nunca lança) e o repo retorna null", async () => {
      // sem DATABASE_URL, insert/get degradam
      expect(await insertObservability({
        tenantId: ORG, correlationId: "corr-rc421-b", task: "GENERATE_DOCUMENT", replayHash: "h".repeat(32),
        reasoningPlanId: "p", reasoningPlanHash: "q".repeat(32), provider: "mock", latencyMs: 0, totalTokens: 0,
        structuredOutputValid: true, executionStatus: "completed", payload: { a: 1 },
      })).toBeNull();
      expect(await getObservabilityByCorrelation("corr-rc421-b")).toBeNull();
      // facade nunca lança
      await expect(persistObservability({ correlationId: "c", task: "GENERATE_DOCUMENT" } as any, { tenantId: ORG, replayHash: "z".repeat(32), provider: "mock" })).resolves.toBeUndefined();
      expect(await recoverObservabilityRow("inexistente")).toBeNull();
    });

    it("recuperação de correlationId inexistente → null", async () => {
      expect(await recoverCognitiveObservability("nao-existe")).toBeNull();
    });
  });

  // ─── Part 3 — Storage Readiness ─────────────────────────────────────────────
  describe("Storage validado", () => {
    it("storageReadiness expõe o diagnóstico completo (sem acessar AWS)", () => {
      const r = storageReadiness();
      for (const f of ["configured", "fallbackAllowed", "bucketConfigured", "regionConfigured", "credentialsConfigured", "publicUrlConfigured"]) {
        expect(r, f).toHaveProperty(f);
      }
      // Em dev/testes sem AWS: não configurado, mas fallback permitido.
      expect(r.configured).toBe(isStorageConfigured());
      expect(r.fallbackAllowed).toBe(true);
    });

    it("signedUrl existe e falha explicitamente sem storage (nunca fallback silencioso)", async () => {
      expect(typeof storageSignedUrl).toBe("function");
      await expect(storageSignedUrl("k")).rejects.toThrow(/not configured/);
    });
  });

  // ─── Part 4 — Provider Readiness ────────────────────────────────────────────
  describe("Provider Adapter íntegro (sem conectar providers)", () => {
    it("gemini/mock implementados; claude/openai placeholders; seleção e fallback resolvem", () => {
      const p = providerReadiness();
      expect(p.implementedCount).toBe(2);
      expect(p.placeholderCount).toBe(2);
      expect(p.selectionResolves).toBe(true);
      expect(p.fallbackResolves).toBe(true);
      expect(p.providers.find(x => x.name === "gemini")!.implemented).toBe(true);
      expect(p.providers.find(x => x.name === "claude")!.implemented).toBe(false);
    });
  });

  // ─── Part 6 — Operational Health ────────────────────────────────────────────
  describe("Health Check institucional", () => {
    it("valida todos os componentes de infraestrutura sem acessar providers reais", () => {
      const h = operationalHealth();
      const names = h.components.map(c => c.name);
      for (const n of ["database", "storage_service", "provider_adapter", "document_engine", "official_document_lifecycle", "cognitive_observability", "cognitive_kernel", "knowledge_graph", "rag"]) {
        expect(names, `componente ${n}`).toContain(n);
      }
      expect(h.components.find(c => c.name === "provider_adapter")!.status).toBe("ok");
    });
  });

  // ─── Part 7 — Environment Validation ────────────────────────────────────────
  describe("Environment Validation (sem fallback silencioso)", () => {
    it("AWS_* são obrigatórias só em produção; GEMINI não é obrigatório de produção", () => {
      const awsKeys = ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_S3_REGION", "AWS_S3_BUCKET"];
      for (const k of awsKeys) {
        const entry = PRODUCTION_REQUIRED_ENV.find(v => v.key === k);
        expect(entry, k).toBeDefined();
        expect(entry!.productionOnly).toBe(true);
      }
      expect(PRODUCTION_REQUIRED_ENV.find(v => v.key === "GEMINI_API_KEY")).toBeUndefined();
      // Em dev, as AWS não são exigidas agora.
      const diag = environmentDiagnostic();
      for (const k of awsKeys) expect(diag.vars.find(v => v.key === k)!.requiredNow).toBe(false);
    });

    it("validateRequiredEnv falha explicitamente sem JWT_SECRET", () => {
      const orig = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      try { expect(() => validateRequiredEnv()).toThrow(/JWT_SECRET|obrigatórias/); }
      finally { if (orig !== undefined) process.env.JWT_SECRET = orig; }
    });
  });

  // ─── Part 8 — Production Configuration Report ───────────────────────────────
  describe("Production Configuration Report (diagnóstico)", () => {
    it("agrega ambiente, storage, provider, health e kernel", () => {
      const r = productionReadinessReport();
      for (const f of ["environment", "storage", "provider", "health", "kernel", "summary"]) {
        expect(r, f).toHaveProperty(f);
      }
      expect(r.kernel.cognitiveTasks).toBe(13);
      expect(r.kernel.providers).toBe(4);
      expect(r.summary.providerReady).toBe(true);
      expect(r.summary.storageReadyOrDev).toBe(true);
    });
  });
});

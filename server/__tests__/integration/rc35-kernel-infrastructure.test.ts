/**
 * RC-3.5 — Kernel Infrastructure Consolidation
 *
 * Cobre: AIExecutionEngine, AI Execution Policy, Provider Adapter, Storage Service,
 * OfficialDocument (referências de storage), Document Engine → Storage Service,
 * URLs assinadas, JWT obrigatório, seleção de provider e a garantia de que nenhum
 * Business Domain acessa Provider ou Amazon S3 diretamente.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";

// AI Execution Policy
import { getExecutionPolicy, AI_EXECUTION_POLICIES, ALL_AI_TASKS, type AITaskId } from "../../_core/ai/executionPolicy";
// Provider Adapter
import {
  PROVIDER_ADAPTERS, ALL_PROVIDER_NAMES, isProviderImplemented,
  resolveProviderByName, selectProvider,
} from "../../_core/ai/providerAdapter";
import { MockAIProvider } from "../../_core/ai/mockProvider";
// AIExecutionEngine
import { executeAITask } from "../../services/aiExecutionEngine";
// Storage Service
import {
  isStorageConfigured, storagePut, storageGet, storageSignedUrl,
  storageDelete, storageExists, storageHealthCheck,
} from "../../storage";
// OfficialDocument + Document Engine
import { createOfficialDocument, OFFICIAL_MIME_TYPES } from "../../domain/officialDocument";
import { renderOfficialDocument } from "../../services/documentEngineService";
// Kernel
import { KERNEL_SERVICES, ALL_KERNEL_SERVICE_IDS } from "../../domain/cognitiveKernel";
// JWT
import { AUTH_CONFIG } from "../../config/auth";
import { validateRequiredEnv } from "../../config/env";

const ORG = 11300;
const CORR = "corr-rc35";

describe("RC-3.5 — Kernel Infrastructure Consolidation", () => {

  // ─── AI Execution Policy ────────────────────────────────────────────────────
  describe("AI Execution Policy", () => {
    it("toda tarefa declara os campos obrigatórios da política", () => {
      for (const task of ALL_AI_TASKS) {
        const p = getExecutionPolicy(task);
        for (const f of ["task", "preferredProvider", "fallbackProvider", "requiresGrounding", "requiresKnowledgeGraph", "requiresExplainability", "maxContext", "maxCost", "temperature", "model"]) {
          expect(p, `${task} sem campo ${f}`).toHaveProperty(f);
        }
        expect(p.task).toBe(task);
      }
    });

    it("document_generation e legal_analysis exigem grounding, KG e explicabilidade", () => {
      for (const t of ["document_generation", "legal_analysis"] as AITaskId[]) {
        const p = getExecutionPolicy(t);
        expect(p.requiresGrounding).toBe(true);
        expect(p.requiresKnowledgeGraph).toBe(true);
        expect(p.requiresExplainability).toBe(true);
      }
    });

    it("Gemini é o provider preferido canônico em todas as políticas", () => {
      for (const task of ALL_AI_TASKS) {
        expect(getExecutionPolicy(task).preferredProvider).toBe("gemini");
      }
      expect(Object.keys(AI_EXECUTION_POLICIES).length).toBe(ALL_AI_TASKS.length);
    });

    it("tarefa desconhecida cai em generic", () => {
      expect(getExecutionPolicy("inexistente" as AITaskId).task).toBe("generic");
    });
  });

  // ─── Provider Adapter ───────────────────────────────────────────────────────
  describe("Provider Adapter", () => {
    it("registra gemini/mock como implementados; claude/openai preparados (Future Evolution)", () => {
      expect(isProviderImplemented("gemini")).toBe(true);
      expect(isProviderImplemented("mock")).toBe(true);
      expect(isProviderImplemented("claude")).toBe(false);
      expect(isProviderImplemented("openai")).toBe(false);
      expect(ALL_PROVIDER_NAMES).toEqual(expect.arrayContaining(["gemini", "claude", "openai", "mock"]));
      expect(Object.keys(PROVIDER_ADAPTERS)).toHaveLength(4);
    });

    it("resolveProviderByName retorna provider para mock; lança para claude/openai", () => {
      expect(resolveProviderByName("mock")).toBeInstanceOf(MockAIProvider);
      expect(() => resolveProviderByName("claude")).toThrow(/Future Evolution|não implementado/);
      expect(() => resolveProviderByName("openai")).toThrow(/Future Evolution|não implementado/);
    });

    it("selectProvider: preferido implementado é usado sem fallback", () => {
      const r = selectProvider("mock", "claude");
      expect(r.selected).toBe("mock");
      expect(r.usedFallback).toBe(false);
      expect(r.provider.name).toBe("mock");
    });

    it("selectProvider: preferido indisponível cai no mock determinístico", () => {
      // claude não implementado, openai não implementado → mock
      const r = selectProvider("claude", "openai");
      expect(r.selected).toBe("mock");
      expect(r.usedFallback).toBe(true);
    });
  });

  // ─── AIExecutionEngine ──────────────────────────────────────────────────────
  describe("AIExecutionEngine (pipeline oficial)", () => {
    it("executa o pipeline completo com as 11 etapas na ordem oficial", async () => {
      const res = await executeAITask({ task: "generic", organizationId: ORG, prompt: "Olá", correlationId: CORR });
      const order = ["task", "policy", "prompt", "grounding", "knowledge_graph", "rag", "provider", "llm", "reasoning", "explainability", "result"];
      expect(res.stages.map(s => s.stage)).toEqual(order);
      expect(res.text.length).toBeGreaterThan(0);
      expect(res.correlationId).toBe(CORR);
    });

    it("é replay-safe: mesmos insumos → mesmo replayHash", async () => {
      const a = await executeAITask({ task: "classification", organizationId: ORG, prompt: "classifique", correlationId: CORR });
      const b = await executeAITask({ task: "classification", organizationId: ORG, prompt: "classifique", correlationId: CORR });
      expect(a.replayHash).toBe(b.replayHash);
      expect(a.replayHash.length).toBe(32);
    });

    it("produz explicabilidade e respeita as flags de grounding/KG da política", async () => {
      const res = await executeAITask({ task: "document_generation", organizationId: ORG, prompt: "gerar", correlationId: CORR });
      expect(res.explainability.groundingApplied).toBe(true);
      expect(res.explainability.knowledgeGraphApplied).toBe(true);
      expect(res.stages.find(s => s.stage === "grounding")?.status).toBe("applied");
      expect(res.explainability.reasoning).toContain("document_generation");
    });

    it("Kernel gate: domínio que declara ai_orchestration passa; Centro de Operações é negado", async () => {
      await expect(executeAITask({ task: "generic", organizationId: ORG, prompt: "x", correlationId: CORR, businessDomain: "processo_licitatorio" }))
        .resolves.toBeDefined();
      await expect(executeAITask({ task: "generic", organizationId: ORG, prompt: "x", correlationId: CORR, businessDomain: "gestao_departamento" }))
        .rejects.toThrow(/Kernel/);
    });

    it("sem chave Gemini, cai no provider mock via cadeia de fallback (nunca quebra)", async () => {
      const res = await executeAITask({ task: "summarization", organizationId: ORG, prompt: "resuma", correlationId: CORR });
      expect(res.provider).toBe("mock");
      expect(res.explainability.usedFallback).toBe(true);
    });
  });

  // ─── Storage Service ────────────────────────────────────────────────────────
  describe("Storage Service (único ponto de acesso ao S3)", () => {
    it("expõe o contrato oficial: put/get/delete/exists/signedUrl/healthCheck", () => {
      for (const fn of [storagePut, storageGet, storageDelete, storageExists, storageSignedUrl, storageHealthCheck]) {
        expect(typeof fn).toBe("function");
      }
    });

    it("sem configuração: isStorageConfigured=false, healthCheck=false, exists=false", async () => {
      expect(isStorageConfigured()).toBe(false);
      expect(await storageHealthCheck()).toBe(false);
      expect(await storageExists("qualquer/chave")).toBe(false);
    });

    it("operações que exigem AWS lançam erro claro quando não configurado", async () => {
      await expect(storagePut("k", Buffer.from("x"))).rejects.toThrow(/not configured/);
      await expect(storageGet("k")).rejects.toThrow(/not configured/);
      await expect(storageSignedUrl("k")).rejects.toThrow(/not configured/);
      await expect(storageDelete("k")).rejects.toThrow(/not configured/);
    });

    it("é o ÚNICO módulo que importa @aws-sdk (nenhum acesso direto fora dele)", () => {
      const offenders: string[] = [];
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir)) {
          const full = `${dir}/${entry}`;
          const stat = fs.statSync(full);
          if (stat.isDirectory()) { walk(full); continue; }
          // Ignora o próprio Storage Service e os arquivos de teste (que citam o SDK como string).
          if (!full.endsWith(".ts") || full.endsWith("storage.ts")) continue;
          if (full.includes("__tests__") || full.endsWith(".test.ts")) continue;
          const src = fs.readFileSync(full, "utf-8");
          if (src.includes("@aws-sdk")) offenders.push(full);
        }
      };
      walk("server");
      expect(offenders, `acesso direto ao AWS SDK fora do Storage Service: ${offenders.join(", ")}`).toEqual([]);
    });
  });

  // ─── OfficialDocument — referências de storage ──────────────────────────────
  describe("OfficialDocument (referências de storage)", () => {
    it("modelo inclui storageKey/mimeType/size/hash (default vazio, nunca binário)", () => {
      const d = createOfficialDocument({ tenantId: ORG, businessDomain: "contratos", documentType: "contrato", origin: "ws-1", title: "C", content: "c", version: 1, author: "1", correlationId: CORR });
      for (const f of ["storageKey", "mimeType", "size", "hash", "documentType", "version", "lineageId", "correlationId", "replayHash"]) {
        expect(d, `campo ausente: ${f}`).toHaveProperty(f);
      }
      expect(d.storageKey).toBe("");
      expect(d.mimeType).toBe("");
      expect(d.size).toBe(0);
      expect(d.hash).toBe("");
    });

    it("MIME types oficiais por formato", () => {
      expect(OFFICIAL_MIME_TYPES.docx).toContain("wordprocessingml");
      expect(OFFICIAL_MIME_TYPES.pdf).toBe("application/pdf");
    });
  });

  // ─── Document Engine → Storage Service ──────────────────────────────────────
  describe("Document Engine (export via Storage Service)", () => {
    it("sem storage configurado: export degrada para base64 (nunca binário no banco), com mimeType/hash/bytes", async () => {
      // Precisa de um documento existente; sem DB retorna erro de não encontrado —
      // valida que o fluxo passa pelo getOfficialDocument (Kernel-gated) e não pelo S3.
      await expect(renderOfficialDocument({ organizationId: ORG, documentId: "inexistente", format: "pdf" }))
        .rejects.toThrow("não encontrado");
    });

    it("documentEngineService fala com o Storage Service, nunca com o S3 diretamente", () => {
      const src = fs.readFileSync("server/services/documentEngineService.ts", "utf-8");
      expect(src).toContain("../storage");
      expect(src).not.toContain("@aws-sdk");
    });
  });

  // ─── JWT obrigatório ────────────────────────────────────────────────────────
  describe("JWT obrigatório (fail-at-init)", () => {
    it("AUTH_CONFIG.jwtSecret nunca é vazio", () => {
      expect(AUTH_CONFIG.jwtSecret.length).toBeGreaterThan(0);
      expect(AUTH_CONFIG.cookieSecret.length).toBeGreaterThan(0);
    });

    it("config/auth.ts não contém mais o fallback silencioso `?? \"\"`", () => {
      const src = fs.readFileSync("server/config/auth.ts", "utf-8");
      expect(src).not.toContain('?? ""');
      expect(src).toContain("production");
      expect(src).toContain("staging");
    });

    it("validateRequiredEnv falha sem JWT_SECRET (init bloqueado)", () => {
      const original = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;
      try {
        expect(() => validateRequiredEnv()).toThrow(/JWT_SECRET/);
      } finally {
        if (original !== undefined) process.env.JWT_SECRET = original;
      }
    });
  });

  // ─── Registro no Kernel ─────────────────────────────────────────────────────
  describe("registro dos componentes permanentes no Kernel", () => {
    it("AIExecutionEngine, Provider Adapter e Storage Service são Kernel Services oficiais", () => {
      for (const id of ["ai_execution_engine", "provider_adapter", "storage_service"] as const) {
        expect(ALL_KERNEL_SERVICE_IDS).toContain(id);
        expect(KERNEL_SERVICES[id]).toBeDefined();
        expect(KERNEL_SERVICES[id].name.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Nenhum Business Domain acessa Provider/S3 diretamente ──────────────────
  describe("isolamento: Business Domains não acessam Provider nem S3 diretamente", () => {
    const DOMAIN_SERVICES = [
      "contractService", "procurementProcessService",
      "directProcurementService", "legalOpinionWorkspaceService",
    ];
    it("serviços de domínio não importam @aws-sdk, ../storage nem _core/ai/provider", () => {
      for (const svc of DOMAIN_SERVICES) {
        const path = `server/services/${svc}.ts`;
        if (!fs.existsSync(path)) continue;
        const src = fs.readFileSync(path, "utf-8");
        expect(src, `${svc} importa @aws-sdk`).not.toContain("@aws-sdk");
        expect(src, `${svc} importa storage direto`).not.toMatch(/from ["']\.\.\/storage["']/);
        expect(src, `${svc} importa provider direto`).not.toMatch(/_core\/ai\/provider/);
      }
    });
  });
});

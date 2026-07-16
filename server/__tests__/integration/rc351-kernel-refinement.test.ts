/**
 * RC-3.5.1 — Kernel Infrastructure Refinement
 *
 * Valida a separação definitiva de responsabilidades do Cognitive Kernel:
 * OfficialDocumentLifecycleService (ciclo de vida), Document Engine (apenas gera),
 * Provider Adapter (única porta de IA + único instanciador de providers), Storage
 * Service (única porta AWS + Storage Policy), placeholders Claude/OpenAI, e o
 * isolamento dos Business Domains.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";

// Lifecycle
import { createDocument, storeRenderedArtifact, storageFallbackAllowed } from "../../services/officialDocumentLifecycleService";
// Document Engine (facade)
import { generateOfficialDocument, renderOfficialDocument } from "../../services/documentEngineService";
// Domain
import { createOfficialDocument } from "../../domain/officialDocument";
// Provider Adapter + placeholders
import { resolveProviderByName, selectProvider, PROVIDER_ADAPTERS } from "../../_core/ai/providerAdapter";
import { ClaudeProvider, OpenAIProvider, ProviderNotImplemented } from "../../_core/ai/placeholderProviders";
// Storage Policy
import { storageFallbackAllowed as storagePolicyFlag, assertStorageUsable, isStorageConfigured } from "../../storage";
// Kernel
import { KERNEL_SERVICES, ALL_KERNEL_SERVICE_IDS } from "../../domain/cognitiveKernel";

const ORG = 11400;
const CORR = "corr-rc351";

// ─── Helpers de varredura de fonte ────────────────────────────────────────────

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (full.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

const SERVER_TS = walk("server").filter(f => !f.includes("__tests__") && !f.endsWith(".test.ts"));

describe("RC-3.5.1 — Kernel Infrastructure Refinement", () => {

  // ─── OfficialDocumentLifecycleService ───────────────────────────────────────
  describe("OfficialDocumentLifecycleService (ciclo de vida documental)", () => {
    it("createDocument versiona e é replay-safe (degrada sem DB → v1)", async () => {
      const doc = await createDocument({
        organizationId: ORG, businessDomain: "contratos", documentType: "contrato",
        origin: "ws-rc351", title: "Contrato Y", content: "# Contrato\nconteúdo", author: "1", correlationId: CORR,
      });
      expect(doc.version).toBe(1);
      expect(doc.replayHash.length).toBe(32);
      expect(doc.businessDomain).toBe("contratos");
    });

    it("storeRenderedArtifact devolve base64 em dev, com mimeType/hash/bytes (nunca binário no banco)", async () => {
      const doc = createOfficialDocument({ tenantId: ORG, businessDomain: "contratos", documentType: "contrato", origin: "ws-rc351", title: "X", content: "c", version: 1, author: "1", correlationId: CORR });
      const buffer = Buffer.from("PK-fake-docx-bytes");
      const res = await storeRenderedArtifact({ doc, format: "docx", buffer });
      expect(res.mimeType).toContain("wordprocessingml");
      expect(res.contentHash).toHaveLength(64);
      expect(res.bytes).toBe(buffer.length);
      expect(res.base64).toBe(buffer.toString("base64"));
      expect(res.storageKey).toBeUndefined();
    });

    it("controla todo o ciclo: expõe createDocument e storeRenderedArtifact", () => {
      const src = fs.readFileSync("server/services/officialDocumentLifecycleService.ts", "utf-8");
      expect(typeof createDocument).toBe("function");
      expect(typeof storeRenderedArtifact).toBe("function");
      // Versão, timeline, hash e storage vivem AQUI.
      expect(src).toContain("insertDocumentTimelineEntry");
      expect(src).toContain("updateOfficialDocumentStorageRefs");
      expect(src).toContain("../storage");
    });
  });

  // ─── Document Engine (apenas gera) ──────────────────────────────────────────
  describe("Document Engine (responsabilidade única: gerar)", () => {
    const engine = fs.readFileSync("server/services/documentEngineService.ts", "utf-8");

    it("NÃO faz upload, NÃO acessa Storage, NÃO conhece o S3", () => {
      expect(engine).not.toContain("@aws-sdk");
      expect(engine).not.toMatch(/from ["']\.\.\/storage["']/);
      expect(engine).not.toContain("storagePut");
      expect(engine).not.toContain("storageSignedUrl");
    });

    it("NÃO versiona nem registra timeline diretamente (delega ao Lifecycle)", () => {
      expect(engine).not.toContain("insertDocumentTimelineEntry");
      expect(engine).not.toContain("insertOfficialDocument");
      expect(engine).not.toContain("countVersions");
      expect(engine).toContain("officialDocumentLifecycleService");
    });

    it("gera/versiona via facade preservando a API dos Business Domains", async () => {
      const doc = await generateOfficialDocument({
        organizationId: ORG, businessDomain: "processo_licitatorio", documentType: "etp",
        origin: "proc-rc351", title: "ETP", content: "# ETP", author: "1", correlationId: CORR,
      });
      expect(doc.documentType).toBe("etp");
      // render de documento inexistente → erro claro (passa pelo Kernel gate, não pelo S3).
      await expect(renderOfficialDocument({ organizationId: ORG, documentId: "nope", format: "pdf" }))
        .rejects.toThrow("não encontrado");
    });
  });

  // ─── Provider Adapter: única porta + único instanciador ─────────────────────
  describe("Provider Adapter (única porta de IA)", () => {
    it("é o ÚNICO módulo que instancia GeminiProvider", () => {
      const offenders = SERVER_TS.filter(f =>
        !f.endsWith("_core/ai/providerAdapter.ts") && fs.readFileSync(f, "utf-8").includes("new GeminiProvider(")
      );
      expect(offenders, `instanciação de GeminiProvider fora do Provider Adapter: ${offenders.join(", ")}`).toEqual([]);
    });

    it("placeholders Claude/OpenAI existem e lançam ProviderNotImplemented no uso", async () => {
      expect(PROVIDER_ADAPTERS.claude.implemented).toBe(false);
      expect(PROVIDER_ADAPTERS.openai.implemented).toBe(false);
      const c = new ClaudeProvider();
      const o = new OpenAIProvider();
      await expect(c.generateText()).rejects.toBeInstanceOf(ProviderNotImplemented);
      await expect(o.generate({ messages: [{ role: "user", content: "x" }] })).rejects.toBeInstanceOf(ProviderNotImplemented);
    });

    it("resolveProviderByName entrega os contratos; seleção automática nunca escolhe claude/openai", () => {
      expect(resolveProviderByName("claude")).toBeInstanceOf(ClaudeProvider);
      expect(resolveProviderByName("openai")).toBeInstanceOf(OpenAIProvider);
      // preferido claude (não implementado) + fallback openai (não implementado) → mock.
      expect(selectProvider("claude", "openai").selected).toBe("mock");
    });
  });

  // ─── Fronteira de Providers (Parte 9) ───────────────────────────────────────
  describe("fronteira: acesso a modelos de IA restrito à camada oficial", () => {
    // Camada de IA sancionada (+ legados explicitamente classificados).
    const AI_LAYER_ALLOWLIST = [
      "server/_core/ai/gemini.ts",            // GeminiProvider (definição do provider)
      "server/services/embeddings.ts",        // infra de embeddings (text-embedding-004)
      "server/services/gemini.ts",            // LEGADO (classificado)
      "server/services/ai/suggestions.ts",    // LEGADO (classificado)
    ];

    it("apenas a camada de IA importa @google/generative-ai", () => {
      const importers = SERVER_TS.filter(f =>
        /from ["']@google\/generative-ai["']/.test(fs.readFileSync(f, "utf-8"))
      );
      const offenders = importers.filter(f => !AI_LAYER_ALLOWLIST.includes(f));
      expect(offenders, `importam @google/generative-ai fora da camada de IA: ${offenders.join(", ")}`).toEqual([]);
    });

    it("model.generateContent só aparece na definição do provider e nos legados classificados", () => {
      const callers = SERVER_TS.filter(f => fs.readFileSync(f, "utf-8").includes(".generateContent("));
      const offenders = callers.filter(f => !AI_LAYER_ALLOWLIST.includes(f));
      expect(offenders, `chamam model.generateContent fora da camada de IA: ${offenders.join(", ")}`).toEqual([]);
    });
  });

  // ─── Storage Policy (Parte 6) ───────────────────────────────────────────────
  describe("Storage Policy (decisão exclusiva do Storage Service)", () => {
    it("Base64 permitido apenas em Development/Testes", () => {
      // APP_ENV=development na suíte → fallback permitido.
      expect(storagePolicyFlag()).toBe(true);
      expect(storageFallbackAllowed()).toBe(true);
    });

    it("assertStorageUsable não lança em dev sem storage; a política referencia produção/staging", () => {
      expect(isStorageConfigured()).toBe(false);
      expect(() => assertStorageUsable()).not.toThrow();
      const src = fs.readFileSync("server/storage.ts", "utf-8");
      expect(src).toContain("IS_PRODUCTION");
      expect(src).toContain("IS_STAGING");
      // Nenhum Business Domain conhece a política de storage.
      expect(src).toContain("storageFallbackAllowed");
    });
  });

  // ─── Registro no Kernel (Parte 12) ──────────────────────────────────────────
  describe("registro do OfficialDocumentLifecycleService no Kernel", () => {
    it("official_document_lifecycle é Kernel Service oficial", () => {
      expect(ALL_KERNEL_SERVICE_IDS).toContain("official_document_lifecycle");
      expect(KERNEL_SERVICES.official_document_lifecycle.category).toBe("document");
    });
  });

  // ─── Isolamento dos Business Domains ────────────────────────────────────────
  describe("Business Domains consomem apenas serviços do Kernel", () => {
    const DOMAIN_SERVICES = ["contractService", "procurementProcessService", "directProcurementService", "legalOpinionWorkspaceService"];
    it("não acessam Storage, AWS nem Providers diretamente", () => {
      for (const svc of DOMAIN_SERVICES) {
        const path = `server/services/${svc}.ts`;
        if (!fs.existsSync(path)) continue;
        const src = fs.readFileSync(path, "utf-8");
        expect(src, `${svc} → @aws-sdk`).not.toContain("@aws-sdk");
        expect(src, `${svc} → storage`).not.toMatch(/from ["']\.\.\/storage["']/);
        expect(src, `${svc} → @google`).not.toContain("@google/generative-ai");
        expect(src, `${svc} → provider`).not.toMatch(/_core\/ai\/provider/);
        expect(src, `${svc} → generateContent`).not.toContain(".generateContent(");
      }
    });
  });
});

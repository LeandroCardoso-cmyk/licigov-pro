/**
 * RC-3.5.2 — Kernel Boundary Enforcement
 *
 * Transforma as fronteiras arquiteturais do Cognitive Kernel em regras OBRIGATÓRIAS
 * do código. Toda exceção vive na allowlist central
 * (`server/kernel/architecture/legacyBoundaries.ts`); qualquer novo componente que
 * cruze uma fronteira sem estar registrado ali FALHA aqui.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import {
  PROVIDER_INSTANTIATION_ALLOWLIST, AI_SDK_ALLOWLIST, EXECUTION_POLICY_ALLOWLIST,
  DOCUMENT_CONVERTER_ALLOWLIST, OFFICIAL_EXPORT_ENGINE_ALLOWLIST, AWS_SDK_ALLOWLIST,
  LEGACY_EXPORTERS, KNOWLEDGE_GRAPH_EMBEDDINGS, BUSINESS_DOMAIN_SERVICES, isAllowed,
} from "../../kernel/architecture/legacyBoundaries";

// ─── Varredura de fonte ───────────────────────────────────────────────────────

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
const read = (f: string) => fs.readFileSync(f, "utf-8");

/** Arquivos (repo-relativos) cujo fonte casa com o predicado. */
function filesMatching(pred: (src: string) => boolean): string[] {
  return SERVER_TS.filter(f => pred(read(f)));
}

describe("RC-3.5.2 — Kernel Boundary Enforcement", () => {

  // ─── Allowlist central íntegra ──────────────────────────────────────────────
  describe("allowlist central (legacyBoundaries.ts)", () => {
    it("todo caminho registrado existe em disco (sem entradas obsoletas)", () => {
      const all = [
        ...PROVIDER_INSTANTIATION_ALLOWLIST, ...AI_SDK_ALLOWLIST, ...EXECUTION_POLICY_ALLOWLIST,
        ...DOCUMENT_CONVERTER_ALLOWLIST, ...OFFICIAL_EXPORT_ENGINE_ALLOWLIST, ...AWS_SDK_ALLOWLIST,
        ...LEGACY_EXPORTERS, ...KNOWLEDGE_GRAPH_EMBEDDINGS, ...BUSINESS_DOMAIN_SERVICES,
      ];
      const missing = all.filter(p => !fs.existsSync(p));
      expect(missing, `entradas obsoletas na allowlist: ${missing.join(", ")}`).toEqual([]);
    });
  });

  // ─── Providers ──────────────────────────────────────────────────────────────
  describe("Providers", () => {
    it("somente o Provider Adapter instancia Providers (new GeminiProvider)", () => {
      const offenders = filesMatching(s => s.includes("new GeminiProvider("))
        .filter(f => !isAllowed(f, PROVIDER_INSTANTIATION_ALLOWLIST));
      expect(offenders, `instanciam Provider fora do Adapter: ${offenders.join(", ")}`).toEqual([]);
    });

    it("somente a camada de IA acessa o SDK do modelo (@google/generative-ai)", () => {
      const offenders = filesMatching(s => /from ["']@google\/generative-ai["']/.test(s) || s.includes("new GoogleGenerativeAI("))
        .filter(f => !isAllowed(f, AI_SDK_ALLOWLIST));
      expect(offenders, `acessam @google/generative-ai fora da allowlist: ${offenders.join(", ")}`).toEqual([]);
    });

    it("model.generateContent só na camada de IA (allowlist)", () => {
      const offenders = filesMatching(s => s.includes(".generateContent("))
        .filter(f => !isAllowed(f, AI_SDK_ALLOWLIST));
      expect(offenders, `chamam model.generateContent fora da allowlist: ${offenders.join(", ")}`).toEqual([]);
    });
  });

  // ─── AIExecutionEngine / Policy ─────────────────────────────────────────────
  describe("AIExecutionEngine e AIExecutionPolicy", () => {
    it("somente o AIExecutionEngine acessa a AIExecutionPolicy", () => {
      const offenders = filesMatching(s => /getExecutionPolicy|AI_EXECUTION_POLICIES/.test(s))
        .filter(f => !isAllowed(f, EXECUTION_POLICY_ALLOWLIST) && !f.endsWith("_core/ai/executionPolicy.ts"));
      expect(offenders, `acessam AIExecutionPolicy fora do engine: ${offenders.join(", ")}`).toEqual([]);
    });

    it("CopilotReasoning roteia pelo AIExecutionEngine (não chama generateText/invokeLLM direto)", () => {
      const src = read("server/services/copilotReasoningService.ts");
      // RC-4.1 — ativação cognitiva: o default roteia por executeCognitiveTask.
      expect(src).toContain("executeCognitiveTask");
      expect(src).not.toMatch(/from ["']\.\.\/_core\/llm["']/);
      expect(src).not.toContain("invokeLLM");
    });
  });

  // ─── Document Engine / Converter ────────────────────────────────────────────
  describe("Document Engine e DocumentConverter (renderer interno)", () => {
    it("somente o Document Engine (+ legados na allowlist) chamam o DocumentConverter", () => {
      const offenders = filesMatching(s => /convert(ToDOCX|ToPDF)\(/.test(s))
        .filter(f => !f.endsWith("services/documentConverter.ts"))
        .filter(f => !isAllowed(f, DOCUMENT_CONVERTER_ALLOWLIST));
      expect(offenders, `chamam DocumentConverter fora da allowlist: ${offenders.join(", ")}`).toEqual([]);
    });

    it("somente o OfficialDocumentLifecycleService gerencia versionamento/timeline/persistência", () => {
      const writers = filesMatching(s =>
        /insertOfficialDocument\(|insertDocumentTimelineEntry\(|updateOfficialDocumentStorageRefs\(|createOfficialDocument\(/.test(s)
      ).filter(f => !f.endsWith("db/officialDocuments.ts") && !f.endsWith("domain/officialDocument.ts"));
      expect(writers).toEqual(["server/services/officialDocumentLifecycleService.ts"]);
    });
  });

  // ─── Official Export Engine (interno especializado) ─────────────────────────
  describe("OfficialExportEngine permanece interno", () => {
    it("nenhum novo componente usa o OfficialExportEngine diretamente", () => {
      const users = filesMatching(s => /officialExportEngine/.test(s))
        .filter(f => !f.endsWith("services/officialExportEngine.ts"))
        .filter(f => !isAllowed(f, OFFICIAL_EXPORT_ENGINE_ALLOWLIST));
      expect(users, `usam OfficialExportEngine fora da allowlist: ${users.join(", ")}`).toEqual([]);
    });
  });

  // ─── Storage / AWS ──────────────────────────────────────────────────────────
  describe("Storage Service (única porta AWS)", () => {
    it("somente o Storage Service acessa o AWS SDK", () => {
      const offenders = filesMatching(s => s.includes("@aws-sdk"))
        .filter(f => !isAllowed(f, AWS_SDK_ALLOWLIST));
      expect(offenders, `acessam @aws-sdk fora do Storage Service: ${offenders.join(", ")}`).toEqual([]);
    });
  });

  // ─── Legacy Exporters ───────────────────────────────────────────────────────
  describe("Legacy Exporters (compatibilidade controlada)", () => {
    it("todos os exportadores legados carregam a classificação LEGACY", () => {
      for (const f of LEGACY_EXPORTERS) {
        expect(read(f), `${f} sem classificação LEGACY`).toMatch(/LEGACY|Legacy|legado/);
      }
    });
  });

  // ─── Embeddings = Knowledge Graph ───────────────────────────────────────────
  describe("Embeddings pertencem ao Knowledge Graph, não ao AIExecutionEngine", () => {
    it("o AIExecutionEngine não importa embeddings", () => {
      const engine = read("server/services/aiExecutionEngine.ts");
      expect(engine).not.toContain("embeddings");
    });

    it("embeddings.ts está classificado como infraestrutura de embeddings/KG", () => {
      const src = read("server/services/embeddings.ts");
      expect(src.toLowerCase()).toMatch(/embedding|knowledge graph|kg/);
      expect(KNOWLEDGE_GRAPH_EMBEDDINGS).toContain("server/services/embeddings.ts");
    });
  });

  // ─── Business Domains ───────────────────────────────────────────────────────
  describe("Business Domains consomem apenas serviços do Kernel", () => {
    const FORBIDDEN: Array<[string, RegExp]> = [
      ["Provider direto", /_core\/ai\/provider|new GeminiProvider\(/],
      ["@google/generative-ai", /@google\/generative-ai/],
      ["model.generateContent", /\.generateContent\(/],
      ["generateText", /\bgenerateText\(/],
      ["invokeLLM", /\binvokeLLM\(/],
      ["DocumentConverter", /convert(ToDOCX|ToPDF)\(/],
      ["Storage", /from ["']\.\.\/storage["']/],
      ["AWS SDK", /@aws-sdk/],
    ];
    it("nenhum Business Domain oficial cruza uma fronteira do Kernel", () => {
      for (const svc of BUSINESS_DOMAIN_SERVICES) {
        const src = read(svc);
        for (const [label, re] of FORBIDDEN) {
          expect(re.test(src), `${svc} acessa ${label} diretamente`).toBe(false);
        }
      }
    });
  });
});

/**
 * Regressão de ORQUESTRAÇÃO DO FRONTEND do Parecer (não apenas dos serviços).
 *
 * Protege ESPECIFICAMENTE contra o batching do tRPC (`httpBatchLink`): prova que
 * `loadReasoning` NÃO pode ser habilitado no mesmo tick de `loadContext` — só depois
 * do SUCCESS operacional — de modo que a IA (Kernel/RAG/LLM) nunca compartilha o batch
 * inicial que entrega o conteúdo operacional. Também prova a distinção entre
 * "resultado cognitivo vazio válido" e "falha/indisponibilidade do apoio".
 */
import { describe, it, expect } from "vitest";
import {
  reasoningQueryEnabled, reasoningViewState,
} from "./legalOpinionQueryOrchestration";

describe("Parecer · orquestração de queries (anti-batching do httpBatchLink)", () => {
  describe("reasoningQueryEnabled — loadReasoning fica em requisição SEPARADA", () => {
    it("ANTES de loadContext retornar, loadReasoning NÃO está habilitado", () => {
      // Workspace selecionado, mas conteúdo operacional ainda não chegou.
      expect(reasoningQueryEnabled({ workspaceSelected: true, contextLoaded: false })).toBe(false);
    });

    it("DEPOIS do SUCCESS de loadContext, loadReasoning passa a poder executar", () => {
      expect(reasoningQueryEnabled({ workspaceSelected: true, contextLoaded: true })).toBe(true);
    });

    it("sem workspace selecionado, loadReasoning nunca executa (nem em batch)", () => {
      expect(reasoningQueryEnabled({ workspaceSelected: false, contextLoaded: false })).toBe(false);
      // Guard defensivo: mesmo com um contextLoaded residual, sem workspace não roda.
      expect(reasoningQueryEnabled({ workspaceSelected: false, contextLoaded: true })).toBe(false);
    });

    it("INVARIANTE anti-batch: enquanto o contexto não carregou, o gate é sempre false", () => {
      // Se algum refactor re-habilitasse reasoning junto de loadContext (mesmo batch),
      // este caso — contexto ainda não carregado — passaria a true e QUEBRARIA aqui.
      for (const workspaceSelected of [true, false]) {
        expect(reasoningQueryEnabled({ workspaceSelected, contextLoaded: false })).toBe(false);
      }
    });
  });

  describe("reasoningViewState — falha ≠ vazio válido; conteúdo operacional independe", () => {
    it("idle antes de habilitar (conteúdo operacional ainda mandando)", () => {
      expect(reasoningViewState({ enabled: false, isFetching: false, isError: false, hasData: false })).toBe("idle");
    });

    it("loading ao processar o apoio cognitivo", () => {
      expect(reasoningViewState({ enabled: true, isFetching: true, isError: false, hasData: false })).toBe("loading");
    });

    it("ready quando há resultado válido (mantém-se mesmo em refetch de fundo)", () => {
      expect(reasoningViewState({ enabled: true, isFetching: false, isError: false, hasData: true })).toBe("ready");
      expect(reasoningViewState({ enabled: true, isFetching: true, isError: false, hasData: true })).toBe("ready");
    });

    it("error quando a query falha SEM dado — nunca confundido com vazio válido", () => {
      expect(reasoningViewState({ enabled: true, isFetching: false, isError: true, hasData: false })).toBe("error");
    });

    it("tentar novamente (refetch em andamento) mostra loading, não erro piscando", () => {
      expect(reasoningViewState({ enabled: true, isFetching: true, isError: true, hasData: false })).toBe("loading");
    });
  });
});

/**
 * RC-3.5.1 — Provider placeholders (Future Evolution).
 *
 * Claude e OpenAI existem apenas como CONTRATOS (classes base que implementam
 * AIProvider). A arquitetura está preparada, mas NÃO há chamadas reais: qualquer
 * uso retorna erro explícito (ProviderNotImplemented). Instanciados exclusivamente
 * pelo Provider Adapter — nenhum outro componente deve tocá-los.
 */

import type { AIGenerateOptions, AIGenerateResult, AIProvider } from "./types";

/** Erro explícito: provider previsto na arquitetura, porém ainda não implementado. */
export class ProviderNotImplemented extends Error {
  constructor(provider: string) {
    super(`Provider "${provider}" não implementado (Future Evolution). Contrato preparado, sem execução real.`);
    this.name = "ProviderNotImplemented";
  }
}

/** Erro explícito: provider implementado, porém indisponível (config/credencial ausente). */
export class ProviderUnavailable extends Error {
  constructor(provider: string, reason?: string) {
    super(`Provider "${provider}" indisponível${reason ? `: ${reason}` : ""}.`);
    this.name = "ProviderUnavailable";
  }
}

/** Contrato preparado para Anthropic Claude — sem implementação real nesta fase. */
export class ClaudeProvider implements AIProvider {
  readonly name = "claude";
  async generateText(): Promise<string> {
    throw new ProviderNotImplemented("claude");
  }
  async generate(_options: AIGenerateOptions): Promise<AIGenerateResult> {
    throw new ProviderNotImplemented("claude");
  }
}

/** Contrato preparado para OpenAI — sem implementação real nesta fase. */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  async generateText(): Promise<string> {
    throw new ProviderNotImplemented("openai");
  }
  async generate(_options: AIGenerateOptions): Promise<AIGenerateResult> {
    throw new ProviderNotImplemented("openai");
  }
}

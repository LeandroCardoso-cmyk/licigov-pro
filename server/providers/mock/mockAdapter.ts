import { createHash } from "crypto";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export interface ProviderAdapterResult {
  content: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  metadata: Record<string, unknown>;
}

export interface ProviderAdapter {
  providerType: string;
  execute(params: { model: string; prompt: string; organizationId: number; options?: Record<string, unknown> }): ProviderAdapterResult;
  healthCheck(): boolean;
  estimateCost(promptTokens: number, completionTokens: number): number;
  supportsModel(model: string): boolean;
  validateCapability(capability: string): boolean;
  normalizeResponse(raw: unknown): Record<string, unknown>;
  normalizeError(error: unknown): string;
}

export const mockAdapter: ProviderAdapter = {
  providerType: "mock",
  execute({ model, prompt, organizationId }) {
    const content = sha256(`${model}:${prompt}:${organizationId}`).slice(0, 20);
    return { content, model, promptTokens: Math.ceil(prompt.length / 4), completionTokens: 10, latencyMs: 0, metadata: { provider: "mock", deterministic: true } };
  },
  healthCheck: () => true,
  estimateCost: () => 0,
  supportsModel: () => true,
  validateCapability: () => true,
  normalizeResponse: (raw) => ({ content: raw }),
  normalizeError: (err) => String(err),
};

import { createHash } from "crypto";
import { type ProviderAdapter, type ProviderAdapterResult } from "../mock/mockAdapter";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export const openaiAdapter: ProviderAdapter = {
  providerType: "openai",
  execute({ model, prompt, organizationId }) {
    const content = sha256(`openai:${model}:${prompt}`).slice(0, 20);
    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = 150;
    return { content, model, promptTokens, completionTokens, latencyMs: 320, metadata: { provider: "openai", model, simulated: true } };
  },
  healthCheck: () => true,
  estimateCost: (p, c) => p * 0.001 + c * 0.002,
  supportsModel: (m) => m.startsWith("gpt-") || m === "text-embedding-ada-002",
  validateCapability: (cap) => ["inference","embedding","completion","classification"].includes(cap),
  normalizeResponse: (raw) => ({ content: raw, provider: "openai" }),
  normalizeError: (err) => `OpenAI error: ${String(err)}`,
};

import { createHash } from "crypto";
import { type ProviderAdapter } from "../mock/mockAdapter";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export const geminiAdapter: ProviderAdapter = {
  providerType: "gemini",
  execute({ model, prompt }) {
    const content = sha256(`gemini:${model}:${prompt}`).slice(0, 20);
    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = 175;
    return { content, model, promptTokens, completionTokens, latencyMs: 250, metadata: { provider: "gemini", model, simulated: true } };
  },
  healthCheck: () => true,
  estimateCost: (p, c) => p * 0.0005 + c * 0.0015,
  supportsModel: (m) => m.startsWith("gemini-"),
  validateCapability: (cap) => ["inference","embedding","completion"].includes(cap),
  normalizeResponse: (raw) => ({ content: raw, provider: "gemini" }),
  normalizeError: (err) => `Gemini error: ${String(err)}`,
};

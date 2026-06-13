import { createHash } from "crypto";
import { type ProviderAdapter } from "../mock/mockAdapter";

function sha256(x: string) { return createHash("sha256").update(x,"utf8").digest("hex"); }

export const claudeAdapter: ProviderAdapter = {
  providerType: "claude",
  execute({ model, prompt }) {
    const content = sha256(`claude:${model}:${prompt}`).slice(0, 20);
    const promptTokens = Math.ceil(prompt.length / 4);
    const completionTokens = 200;
    return { content, model, promptTokens, completionTokens, latencyMs: 280, metadata: { provider: "claude", model, simulated: true } };
  },
  healthCheck: () => true,
  estimateCost: (p, c) => p * 0.0008 + c * 0.0024,
  supportsModel: (m) => m.startsWith("claude-"),
  validateCapability: (cap) => ["inference","completion","classification"].includes(cap),
  normalizeResponse: (raw) => ({ content: raw, provider: "claude" }),
  normalizeError: (err) => `Claude error: ${String(err)}`,
};

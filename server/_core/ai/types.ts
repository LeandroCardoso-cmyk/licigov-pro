// ─── AI Provider Interface ───────────────────────────────────────────────────
// Extend this interface to add new providers (OpenAI, Llama, Claude, etc.)
// without touching call sites.

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AITool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

export interface AIToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AIGenerateOptions {
  messages: AIMessage[];
  tools?: AITool[];
  /** Force the model to call a specific tool or "auto" / "none" */
  toolChoice?: "auto" | "none" | { name: string };
  maxTokens?: number;
  /** JSON schema the model must conform to */
  responseSchema?: {
    name: string;
    schema: Record<string, unknown>;
  };
}

export interface AIGenerateResult {
  text: string;
  toolCalls?: AIToolCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: "stop" | "tool_calls" | "max_tokens" | "other";
}

/** Core provider contract — implement this for any LLM backend. */
export interface AIProvider {
  readonly name: string;

  /** Simple single-turn text generation */
  generateText(prompt: string): Promise<string>;

  /** Full multi-turn, tool-capable generation */
  generate(options: AIGenerateOptions): Promise<AIGenerateResult>;

  // ── Planned — not yet implemented ──────────────────────────────────────────
  // embedText(text: string): Promise<number[]>
  // embedBatch(texts: string[]): Promise<number[][]>
  // analyzeDocument(url: string, prompt: string): Promise<string>
  // ragQuery(query: string, chunks: string[]): Promise<string>
}

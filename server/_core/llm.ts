import { getProvider } from "./ai/provider";

// ─── Public Types (backward compatible) ──────────────────────────────────────

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: { name: string };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

// ─── Simple text helper ───────────────────────────────────────────────────────

/** Convenience wrapper for single-prompt text generation. */
export async function generateText(prompt: string): Promise<string> {
  return getProvider().generateText(prompt);
}

// ─── Full invocation (OpenAI-compatible interface) ────────────────────────────

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    maxTokens,
    max_tokens,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
  } = params;

  const provider = getProvider();

  // Collapse all message content to plain strings for the AI layer
  const aiMessages = messages
    .filter((m) => m.role === "system" || m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: flattenContent(m.content),
    }));

  // Resolve schema from either outputSchema or responseFormat
  const schema = resolveSchema({ outputSchema, output_schema, responseFormat, response_format });

  // Resolve tool choice
  const resolvedToolChoice = resolveToolChoice(toolChoice ?? tool_choice, tools);

  const result = await provider.generate({
    messages: aiMessages,
    tools: tools?.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
    toolChoice: resolvedToolChoice,
    maxTokens: maxTokens ?? max_tokens,
    responseSchema: schema,
  });

  const toolCalls: ToolCall[] | undefined = result.toolCalls?.map((tc) => ({
    id: tc.id,
    type: "function",
    function: { name: tc.name, arguments: tc.arguments },
  }));

  return {
    id: `llm_${Date.now()}`,
    created: Math.floor(Date.now() / 1000),
    model: provider.name,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: result.text,
          ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: result.finishReason,
      },
    ],
    usage: result.usage
      ? {
          prompt_tokens: result.usage.inputTokens,
          completion_tokens: result.usage.outputTokens,
          total_tokens: result.usage.totalTokens,
        }
      : undefined,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flattenContent(content: MessageContent | MessageContent[]): string {
  const parts = Array.isArray(content) ? content : [content];
  return parts
    .map((p) => {
      if (typeof p === "string") return p;
      if (p.type === "text") return p.text;
      if (p.type === "image_url") return `[image: ${p.image_url.url}]`;
      if (p.type === "file_url") return `[file: ${p.file_url.url}]`;
      return "";
    })
    .join("\n");
}

function resolveSchema(params: {
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
}): { name: string; schema: Record<string, unknown> } | undefined {
  const fmt = params.responseFormat ?? params.response_format;
  if (fmt?.type === "json_schema") {
    return { name: fmt.json_schema.name, schema: fmt.json_schema.schema };
  }

  const schema = params.outputSchema ?? params.output_schema;
  if (schema) {
    return { name: schema.name, schema: schema.schema };
  }

  return undefined;
}

function resolveToolChoice(
  choice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "auto" | "none" | { name: string } | undefined {
  if (!choice) return undefined;
  if (choice === "none") return "none";
  if (choice === "auto") return "auto";
  if (choice === "required") {
    if (tools && tools.length === 1) return { name: tools[0].function.name };
    return "auto";
  }
  if ("name" in choice) return { name: choice.name };
  if ("type" in choice && choice.type === "function") return { name: choice.function.name };
  return undefined;
}

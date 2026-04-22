import {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResult,
  type Tool as GeminiTool,
} from "@google/generative-ai";
import type {
  AIGenerateOptions,
  AIGenerateResult,
  AIProvider,
  AIToolCall,
} from "./types";

const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";

  private readonly client: GoogleGenerativeAI;
  private readonly modelId: string;

  constructor(apiKey: string, modelId = "gemini-2.5-pro") {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelId = modelId;
  }

  async generateText(prompt: string): Promise<string> {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      safetySettings: SAFETY_SETTINGS,
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  async generate(options: AIGenerateOptions): Promise<AIGenerateResult> {
    const { messages, tools, toolChoice, maxTokens, responseSchema } = options;

    // Separate system instruction from conversation history
    const systemMessage = messages.find((m) => m.role === "system");
    const history = messages.filter((m) => m.role !== "system");

    // Build Gemini tools
    const geminiTools: GeminiTool[] | undefined =
      tools && tools.length > 0
        ? [
            {
              functionDeclarations: tools.map(
                (t): FunctionDeclaration => ({
                  name: t.name,
                  description: t.description ?? "",
                  parameters: t.parameters as any,
                })
              ),
            },
          ]
        : undefined;

    // Build tool config
    let toolConfig: any = undefined;
    if (toolChoice === "none") {
      toolConfig = { functionCallingConfig: { mode: "NONE" } };
    } else if (toolChoice && typeof toolChoice === "object" && "name" in toolChoice) {
      toolConfig = {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [toolChoice.name],
        },
      };
    } else if (tools && tools.length > 0) {
      toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    }

    // Build response schema (JSON mode)
    const generationConfig: Record<string, unknown> = {};
    if (maxTokens) generationConfig.maxOutputTokens = maxTokens;
    if (responseSchema) {
      generationConfig.responseMimeType = "application/json";
      generationConfig.responseSchema = responseSchema.schema;
    }

    const model = this.client.getGenerativeModel({
      model: this.modelId,
      safetySettings: SAFETY_SETTINGS,
      ...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
      ...(geminiTools ? { tools: geminiTools } : {}),
      ...(toolConfig ? { toolConfig } : {}),
      generationConfig: Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
    });

    // Convert messages to Gemini Content[]
    const contents: Content[] = history.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const result: GenerateContentResult = await model.generateContent({ contents });
    const response = result.response;

    // Extract tool calls
    const toolCalls: AIToolCall[] = [];
    const candidate = response.candidates?.[0];
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args ?? {}),
          });
        }
      }
    }

    const finishReason = mapFinishReason(candidate?.finishReason);

    return {
      text: response.text(),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: response.usageMetadata
        ? {
            inputTokens: response.usageMetadata.promptTokenCount ?? 0,
            outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: response.usageMetadata.totalTokenCount ?? 0,
          }
        : undefined,
      finishReason,
    };
  }
}

function mapFinishReason(
  reason: string | undefined
): AIGenerateResult["finishReason"] {
  if (!reason) return "stop";
  if (reason === "STOP") return "stop";
  if (reason === "MAX_TOKENS") return "max_tokens";
  if (reason === "SAFETY" || reason === "RECITATION") return "other";
  return "stop";
}

import { trackAIUsage } from "../db";

/**
 * Custos por modelo (em USD por 1M tokens)
 * Fonte: https://ai.google.dev/pricing
 */
const MODEL_COSTS = {
  "text-embedding-004": {
    input: 0.00001, // US$ 0.00001 por 1k tokens
    output: 0,
  },
  "gemini-1.5-flash": {
    input: 0.075 / 1000, // US$ 0.075 por 1M tokens = 0.000075 por 1k
    output: 0.3 / 1000, // US$ 0.3 por 1M tokens = 0.0003 por 1k
  },
  "gemini-1.5-pro": {
    input: 1.25 / 1000,
    output: 5.0 / 1000,
  },
};

/**
 * Estima tokens baseado em caracteres
 * Aproximação: 1 token ≈ 4 caracteres em português
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Calcula custo estimado
 */
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[model as keyof typeof MODEL_COSTS];
  if (!costs) {
    console.warn(`[AI Tracker] Modelo desconhecido: ${model}, usando custo padrão`);
    return (inputTokens * 0.00001 + outputTokens * 0.00001) / 1000;
  }

  return (inputTokens * costs.input + outputTokens * costs.output) / 1000;
}

/**
 * Helper para rastrear geração de embeddings
 */
export async function trackEmbedding(params: {
  userId: number;
  processId?: number;
  text: string;
}) {
  const inputTokens = estimateTokens(params.text);
  const cost = calculateCost("text-embedding-004", inputTokens, 0);

  await trackAIUsage({
    userId: params.userId,
    processId: params.processId,
    operationType: "embedding",
    model: "text-embedding-004",
    inputTokens,
    outputTokens: 0,
    estimatedCostUSD: cost,
  });
}

/**
 * Helper para rastrear consultas RAG
 */
export async function trackRAGQuery(params: {
  userId: number;
  processId?: number;
  query: string;
  chunksRetrieved: number;
}) {
  const inputTokens = estimateTokens(params.query);
  const cost = calculateCost("text-embedding-004", inputTokens, 0);

  await trackAIUsage({
    userId: params.userId,
    processId: params.processId,
    operationType: "rag_query",
    model: "text-embedding-004",
    inputTokens,
    outputTokens: 0,
    estimatedCostUSD: cost,
    metadata: {
      chunksRetrieved: params.chunksRetrieved,
    },
  });
}

/**
 * Helper para rastrear matching CATMAT
 */
export async function trackCATMATMatching(params: {
  userId: number;
  processId?: number;
  itemDescription: string;
  suggestionsCount: number;
  model?: string;
}) {
  const model = params.model || "gemini-1.5-flash";
  
  // Estimativa: prompt + descrição do item + resposta JSON com 3 sugestões
  const inputTokens = estimateTokens(
    `Encontre códigos CATMAT para: ${params.itemDescription}`
  );
  const outputTokens = estimateTokens(JSON.stringify({
    suggestions: Array(params.suggestionsCount).fill({
      code: "123456",
      description: "Descrição média de item CATMAT",
      confidence: 85,
      reasoning: "Justificativa técnica média com 50 caracteres",
    }),
  }));

  const cost = calculateCost(model, inputTokens, outputTokens);

  await trackAIUsage({
    userId: params.userId,
    processId: params.processId,
    operationType: "catmat_matching",
    model,
    inputTokens,
    outputTokens,
    estimatedCostUSD: cost,
    metadata: {
      itemDescription: params.itemDescription.substring(0, 100),
      suggestionsCount: params.suggestionsCount,
    },
  });
}

/**
 * Helper para rastrear geração de documentos
 */
export async function trackDocumentGeneration(params: {
  userId: number;
  processId: number;
  documentType: "ETP" | "TR" | "DFD" | "Edital";
  inputText: string;
  outputText: string;
  model?: string;
}) {
  const model = params.model || "gemini-1.5-flash";
  const inputTokens = estimateTokens(params.inputText);
  const outputTokens = estimateTokens(params.outputText);
  const cost = calculateCost(model, inputTokens, outputTokens);

  await trackAIUsage({
    userId: params.userId,
    processId: params.processId,
    operationType: "document_generation",
    model,
    inputTokens,
    outputTokens,
    estimatedCostUSD: cost,
    metadata: {
      documentType: params.documentType,
      outputLength: params.outputText.length,
    },
  });
}

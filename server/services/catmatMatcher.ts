/**
 * RC-4.1 → A3 — Correspondência CATMAT/CATSER via **Cognitive Kernel**.
 *
 * MIGRADO (A3 — Cognitive Authoring Extension & Legacy Chain Retirement):
 * este serviço NÃO usa mais `invokeLLM`/SDK bruto. Ele solicita a Cognitive Task
 * `CATMAT_MATCHING` ao AIExecutionEngine (`executeCognitiveTask`) — provider, modelo
 * (pinado), proveniência (A1) e replay são governados pelo Kernel. O structured output
 * é declarado por `responseSchema`; o parse é governado (JSON + Zod) e **fail-closed**
 * (nunca fabrica código/descrição).
 *
 * Multi-tenant: o `tenantId` (organizationId) e o `correlationId` são obrigatórios e
 * fluem do router (`tenantProcedure`) para o Kernel.
 */
import { z } from "zod";
import { executeCognitiveTask } from "./aiExecutionEngine";

export interface CatmatMatch {
  code: string;
  description: string;
  confidence: number; // 0-100
  reasoning: string;
}

export interface CatmatMatchRequest {
  itemDescription: string;
  itemType?: "material" | "service";
  /** Boundary institucional obrigatório (tenant). */
  organizationId: number;
  /** Correlation do fluxo de negócio (propagado do request). */
  correlationId: string;
  /** Ator do pedido. */
  userId: number;
}

/** JSON Schema que o provider DEVE preencher (o servidor revalida com Zod). */
const CATMAT_RESPONSE_SCHEMA = {
  name: "catmat_matches",
  schema: {
    type: "object",
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: {
            code: { type: "string", description: "Código CATMAT/CATSER de 6 dígitos" },
            description: { type: "string", description: "Descrição oficial completa" },
            confidence: { type: "integer", description: "Score de confiança 0-100" },
            reasoning: { type: "string", description: "Justificativa técnica da escolha" },
          },
          required: ["code", "description", "confidence", "reasoning"],
          additionalProperties: false,
        },
      },
    },
    required: ["matches"],
    additionalProperties: false,
  },
} as const;

const matchesSchema = z.object({
  matches: z
    .array(
      z.object({
        code: z.string().min(1),
        description: z.string().min(1),
        confidence: z.number().int().min(0).max(100),
        reasoning: z.string().min(1),
      })
    )
    .min(1),
});

/**
 * Sugere os 3 códigos CATMAT/CATSER mais adequados para um item, via Cognitive Kernel.
 * @returns Array com até 3 sugestões ordenadas por relevância. Fail-closed em resposta inválida.
 */
export async function findCatmatMatches(req: CatmatMatchRequest): Promise<CatmatMatch[]> {
  const itemType = req.itemType ?? "material";
  const catalogType = itemType === "material" ? "CATMAT" : "CATSER";

  const query = `Você é um especialista em catalogação de materiais e serviços do governo federal brasileiro.

**TAREFA**: Encontre os 3 códigos ${catalogType} mais adequados para o seguinte item:

**DESCRIÇÃO DO ITEM**: "${req.itemDescription}"

**INSTRUÇÕES**:
1. Busque no catálogo oficial ${catalogType} (use seu conhecimento do sistema de catalogação governamental)
2. Retorne EXATAMENTE 3 sugestões, ordenadas por relevância (mais relevante primeiro)
3. Para cada sugestão: código ${catalogType} (6 dígitos), descrição oficial completa, score de confiança (0-100) e justificativa técnica.

**CRITÉRIOS**: correspondência de palavras-chave (40%), similaridade semântica (30%), categoria/subcategoria (20%), unidade de medida (10%).

**IMPORTANTE**:
- Use APENAS códigos reais do catálogo ${catalogType}. NÃO invente códigos ou descrições.
- Se não tiver certeza absoluta, reduza o score de confiança (melhor 60% correto do que 95% inventado).`;

  const execution = await executeCognitiveTask({
    task: "CATMAT_MATCHING",
    tenantId: req.organizationId,
    userId: String(req.userId),
    correlationId: req.correlationId,
    businessDomain: "processo_licitatorio",
    query,
    responseSchema: CATMAT_RESPONSE_SCHEMA,
  });

  let parsed: z.infer<typeof matchesSchema>;
  try {
    parsed = matchesSchema.parse(JSON.parse(execution.response.content ?? ""));
  } catch {
    // Fail-closed: sem estrutura válida não há sugestão — nunca fabricar.
    throw new Error("Falha ao gerar sugestões CATMAT. Por favor, tente novamente.");
  }

  return parsed.matches.slice(0, 3);
}

/**
 * RC-4.1 → A3 — Sugestão ASSISTIVA de códigos CATMAT/CATSER via **Cognitive Kernel**.
 *
 * MIGRADO (A3 — Cognitive Authoring Extension & Legacy Chain Retirement):
 * este serviço NÃO usa mais `invokeLLM`/SDK bruto. Ele solicita a Cognitive Task
 * `CATMAT_MATCHING` ao AIExecutionEngine (`executeCognitiveTask`) — provider, modelo
 * (pinado), proveniência (A1) e replay são governados pelo Kernel. O structured output
 * é declarado por `responseSchema`; o parse é governado (JSON + Zod) e **fail-closed**
 * (nunca fabrica estrutura de resposta).
 *
 * NATUREZA (NÃO-GROUNDED — assistiva): esta task é declarada `usesGrounding: false`
 * (ver `CATMAT_MATCHING` em `server/domain/cognitiveTask.ts`). Ela NÃO consulta o
 * catálogo oficial CATMAT/CATSER de compras.gov.br nem produz evidência tenant-safe;
 * portanto os resultados são **CANDIDATOS/SUGESTÕES gerados por IA**, não códigos
 * verificados. O código e a descrição precisam ser **validados por um humano** contra
 * o catálogo oficial antes de qualquer uso no processo. Nenhum `evidenceFingerprint`
 * é fabricado e nenhum resultado é marcado como grounded.
 *
 * Multi-tenant: o `tenantId` (organizationId) e o `correlationId` são obrigatórios e
 * fluem do router (`tenantProcedure`) para o Kernel.
 */
import { z } from "zod";
import { executeCognitiveTask } from "./aiExecutionEngine";

export interface CatmatMatch {
  /** Código CANDIDATO sugerido pela IA — NÃO verificado contra o catálogo oficial. */
  code: string;
  /** Descrição sugerida pela IA para o candidato — NÃO é a descrição oficial do catálogo. */
  description: string;
  /** Confiança da SUGESTÃO (0-100). Não representa probabilidade de o código existir no catálogo. */
  confidence: number;
  /** Justificativa técnica da sugestão. */
  reasoning: string;
  /**
   * Marca invariável: todo resultado é um candidato assistivo que requer validação
   * humana contra o catálogo oficial CATMAT/CATSER antes de qualquer uso.
   */
  requiresHumanValidation: true;
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
            code: { type: "string", description: "Código CATMAT/CATSER candidato de 6 dígitos (a validar)" },
            description: { type: "string", description: "Descrição sugerida para o item candidato" },
            confidence: { type: "integer", description: "Confiança da sugestão 0-100" },
            reasoning: { type: "string", description: "Justificativa técnica da sugestão" },
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
 * Sugere até 3 códigos CATMAT/CATSER **candidatos** para um item, via Cognitive Kernel.
 *
 * ⚠️ Assistivo: os resultados são sugestões geradas por IA, NÃO consultas ao catálogo
 * oficial. Cada candidato precisa ser validado por um humano contra o catálogo oficial
 * antes de uso. Fail-closed em resposta inválida (nunca fabrica estrutura de resposta).
 *
 * @returns Array com até 3 candidatos ordenados por relevância aparente.
 */
export async function findCatmatMatches(req: CatmatMatchRequest): Promise<CatmatMatch[]> {
  const itemType = req.itemType ?? "material";
  const catalogType = itemType === "material" ? "CATMAT" : "CATSER";

  const query = `Você é um assistente de catalogação de materiais e serviços do governo federal brasileiro.

**TAREFA**: Sugira até 3 códigos ${catalogType} CANDIDATOS que provavelmente correspondem ao seguinte item. Estas são sugestões para orientar a busca de um servidor — NÃO uma consulta ao catálogo oficial.

**DESCRIÇÃO DO ITEM**: "${req.itemDescription}"

**INSTRUÇÕES**:
1. Com base no seu conhecimento da estrutura de catalogação ${catalogType}, proponha até 3 candidatos ordenados por relevância aparente (mais relevante primeiro).
2. Para cada candidato: o código ${catalogType} provável (6 dígitos), uma descrição sugerida para o item, um score de confiança da SUGESTÃO (0-100) e a justificativa técnica.

**CRITÉRIOS**: correspondência de palavras-chave (40%), similaridade semântica (30%), categoria/subcategoria (20%), unidade de medida (10%).

**IMPORTANTE**:
- Estes candidatos NÃO substituem a consulta ao catálogo oficial. O servidor DEVE validar cada código e descrição no catálogo ${catalogType} oficial antes de usá-los.
- Se não tiver certeza, reduza o score de confiança para sinalizar a incerteza da sugestão (melhor sinalizar 60% do que aparentar 95% de certeza).`;

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

  // Todo resultado carrega a marca de candidato assistivo (validação humana obrigatória).
  // Nenhuma evidência/grounding é anexada: a task é declarada não-grounded.
  return parsed.matches.slice(0, 3).map((m) => ({ ...m, requiresHumanValidation: true as const }));
}

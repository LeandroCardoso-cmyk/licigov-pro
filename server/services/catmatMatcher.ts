import { invokeLLM } from "../_core/llm";

export interface CatmatMatch {
  code: string;
  description: string;
  confidence: number; // 0-100
  reasoning: string;
}

/**
 * Busca os 3 códigos CATMAT/CATSER mais adequados para um item usando IA Gemini
 * @param itemDescription - Descrição do item a ser catalogado
 * @param itemType - Tipo do item: "material" ou "service"
 * @returns Array com 3 sugestões ordenadas por relevância
 */
export async function findCatmatMatches(
  itemDescription: string,
  itemType: "material" | "service" = "material"
): Promise<CatmatMatch[]> {
  
  const catalogType = itemType === "material" ? "CATMAT" : "CATSER";
  
  const prompt = `Você é um especialista em catalogação de materiais e serviços do governo federal brasileiro.

**TAREFA**: Encontre os 3 códigos ${catalogType} mais adequados para o seguinte item:

**DESCRIÇÃO DO ITEM**: "${itemDescription}"

**INSTRUÇÕES**:
1. Busque no catálogo oficial ${catalogType} (use seu conhecimento interno do sistema de catalogação governamental)
2. Retorne EXATAMENTE 3 sugestões, ordenadas por relevância (mais relevante primeiro)
3. Para cada sugestão, forneça:
   - Código ${catalogType} (formato: 6 dígitos numéricos, ex: 123456)
   - Descrição oficial completa do catálogo
   - Score de confiança (0-100, onde 100 = correspondência perfeita)
   - Justificativa técnica detalhada da escolha

**CRITÉRIOS DE AVALIAÇÃO**:
- Correspondência exata de palavras-chave (peso 40%)
- Similaridade semântica da descrição (peso 30%)
- Categoria e subcategoria corretas (peso 20%)
- Unidade de medida compatível (peso 10%)

**EXEMPLOS DE MATCHING CORRETO**:
- "Caneta esferográfica azul ponta média" → Código CATMAT com descrição "CANETA ESFEROGRAFICA, MATERIAL PLASTICO, COR AZUL, PONTA MEDIA"
- "Papel sulfite A4 75g/m² branco" → Código CATMAT com descrição "PAPEL SULFITE, FORMATO A4, GRAMATURA 75G/M2, COR BRANCA"
- "Serviço de limpeza predial" → Código CATSER com descrição "SERVICO DE LIMPEZA E CONSERVACAO PREDIAL"

**IMPORTANTE**:
- Use APENAS códigos reais do catálogo ${catalogType}
- NÃO invente códigos ou descrições
- Se não tiver certeza absoluta, reduza o score de confiança
- Seja conservador: é melhor ter score 60% correto do que 95% inventado

**FORMATO DE RESPOSTA** (JSON estrito):
{
  "matches": [
    {
      "code": "123456",
      "description": "Descrição oficial completa do ${catalogType}",
      "confidence": 85,
      "reasoning": "Este código é ideal porque corresponde exatamente à descrição fornecida em termos de tipo de material, cor e especificação técnica. A categoria está correta e a unidade de medida é compatível."
    }
  ]
}`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: "Você é um especialista em catalogação governamental brasileira (CATMAT/CATSER)." },
        { role: "user", content: prompt }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "catmat_matches",
          strict: true,
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
                    reasoning: { type: "string", description: "Justificativa técnica da escolha" }
                  },
                  required: ["code", "description", "confidence", "reasoning"],
                  additionalProperties: false
                }
              }
            },
            required: ["matches"],
            additionalProperties: false
          }
        }
      }
    });

    const result = JSON.parse(response.choices[0].message.content as string);
    
    // Validar que temos exatamente 3 sugestões
    if (!result.matches || result.matches.length === 0) {
      throw new Error("IA não retornou sugestões válidas");
    }
    
    // Garantir que temos no máximo 3 sugestões
    return result.matches.slice(0, 3);
    
  } catch (error) {
    console.error(`[CATMAT Matcher] Erro ao buscar matches para "${itemDescription}":`, error);
    throw new Error("Falha ao gerar sugestões CATMAT. Por favor, tente novamente.");
  }
}

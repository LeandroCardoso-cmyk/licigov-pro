import { invokeLLM } from "../_core/llm";

interface GenerateLegalOpinionParams {
  title: string;
  legalQuestion: string;
  context?: string;
  sourceType: "process" | "direct_contract" | "contract" | "other";
  sourceData?: any; // Dados do processo, contratação ou contrato relacionado
}

interface LegalOpinionResult {
  opinion: string; // Parecer completo em Markdown
  conclusion: "favorable" | "unfavorable" | "with_reservations";
  citedArticles: string[]; // Artigos da Lei 14.133/2021 citados
  jurisprudence: Array<{
    court: string;
    number: string;
    summary: string;
  }>;
}

/**
 * Gerar parecer jurídico automatizado com IA
 * Baseado na Lei 14.133/2021 e jurisprudências
 */
export async function generateLegalOpinion(
  params: GenerateLegalOpinionParams
): Promise<LegalOpinionResult> {
  const { title, legalQuestion, context, sourceType, sourceData } = params;

  // Construir contexto adicional baseado na fonte
  let additionalContext = "";
  if (sourceData) {
    if (sourceType === "process") {
      additionalContext = `
**Dados do Processo Licitatório:**
- Nome: ${sourceData.name || "N/A"}
- Objeto: ${sourceData.object || "N/A"}
- Modalidade: ${sourceData.modality || "N/A"}
- Valor Estimado: ${sourceData.estimatedValue ? `R$ ${(sourceData.estimatedValue / 100).toFixed(2)}` : "N/A"}
`;
    } else if (sourceType === "direct_contract") {
      additionalContext = `
**Dados da Contratação Direta:**
- Tipo: ${sourceData.type || "N/A"}
- Objeto: ${sourceData.object || "N/A"}
- Valor: ${sourceData.value ? `R$ ${(sourceData.value / 100).toFixed(2)}` : "N/A"}
- Artigo Legal: ${sourceData.legalArticle || "N/A"}
`;
    } else if (sourceType === "contract") {
      additionalContext = `
**Dados do Contrato:**
- Número: ${sourceData.number || "N/A"}
- Objeto: ${sourceData.object || "N/A"}
- Valor: ${sourceData.value ? `R$ ${(sourceData.value / 100).toFixed(2)}` : "N/A"}
- Vigência: ${sourceData.startDate || "N/A"} a ${sourceData.endDate || "N/A"}
`;
    }
  }

  // Prompt para geração do parecer
  const systemPrompt = `Você é um especialista em Direito Administrativo e Licitações, com profundo conhecimento da Lei 14.133/2021 (Nova Lei de Licitações e Contratos Administrativos).

Sua função é elaborar pareceres jurídicos fundamentados, objetivos e tecnicamente precisos sobre questões relacionadas a processos licitatórios, contratações diretas e contratos administrativos.

**Diretrizes para o Parecer:**
1. Estrutura clara: Relatório, Fundamentação, Conclusão
2. Citar artigos específicos da Lei 14.133/2021 quando aplicável
3. Mencionar jurisprudências relevantes do TCU, STJ ou tribunais superiores quando pertinente
4. Linguagem técnica mas acessível
5. Conclusão objetiva: Favorável, Desfavorável ou Com Ressalvas
6. Formato Markdown para melhor legibilidade

**Base Legal Principal:**
- Lei 14.133/2021 (Nova Lei de Licitações e Contratos)
- Decreto 11.462/2023 (Regulamentação)
- Jurisprudências do TCU e tribunais superiores

**Formato de Resposta (JSON):**
{
  "opinion": "Parecer completo em Markdown com seções: Relatório, Fundamentação Legal, Análise, Conclusão",
  "conclusion": "favorable" | "unfavorable" | "with_reservations",
  "citedArticles": ["Art. 6º, inciso XXII", "Art. 75, § 1º", ...],
  "jurisprudence": [
    {
      "court": "TCU",
      "number": "Acórdão 1234/2023",
      "summary": "Resumo da jurisprudência"
    }
  ]
}`;

  const userPrompt = `**Título do Parecer:** ${title}

**Questão Jurídica:**
${legalQuestion}

${context ? `**Contexto Adicional:**\n${context}\n` : ""}

${additionalContext}

Por favor, elabore um parecer jurídico completo sobre a questão apresentada, fundamentado na Lei 14.133/2021 e jurisprudências aplicáveis.`;

  try {
    const response = await invokeLLM({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "legal_opinion",
          strict: true,
          schema: {
            type: "object",
            properties: {
              opinion: {
                type: "string",
                description: "Parecer completo em Markdown",
              },
              conclusion: {
                type: "string",
                enum: ["favorable", "unfavorable", "with_reservations"],
                description: "Conclusão do parecer",
              },
              citedArticles: {
                type: "array",
                items: { type: "string" },
                description: "Artigos da Lei 14.133/2021 citados",
              },
              jurisprudence: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    court: { type: "string" },
                    number: { type: "string" },
                    summary: { type: "string" },
                  },
                  required: ["court", "number", "summary"],
                  additionalProperties: false,
                },
                description: "Jurisprudências citadas",
              },
            },
            required: ["opinion", "conclusion", "citedArticles", "jurisprudence"],
            additionalProperties: false,
          },
        },
      },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Resposta vazia da IA");
    }

    const result: LegalOpinionResult = JSON.parse(content);
    return result;
  } catch (error) {
    console.error("Erro ao gerar parecer jurídico:", error);
    throw new Error("Falha ao gerar parecer jurídico com IA");
  }
}

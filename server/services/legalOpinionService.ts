/**
 * RC-4.1 → A3 — Parecer jurídico via **Cognitive Kernel**.
 *
 * MIGRADO (A3 — Cognitive Authoring Extension & Legacy Chain Retirement): este serviço
 * NÃO usa mais `invokeLLM`. Ele solicita a Cognitive Task `LEGAL_ANALYSIS` ao
 * AIExecutionEngine (`executeCognitiveTask`) — provider, modelo (pinado), proveniência
 * (A1), replay e o prompt tipado por tarefa são governados pelo Kernel. O structured
 * output é declarado por `responseSchema` (parse governado JSON) e a validação de
 * citações legais permanece obrigatória e fail-closed (nunca emite artigo inexistente).
 *
 * Multi-tenant: `tenantId` (organizationId), `correlationId` e o ator (userId) são
 * obrigatórios e fluem do router (`tenantProcedure`) para o Kernel.
 */
import { executeCognitiveTask } from "./aiExecutionEngine";
import { validateLegalCitations, extractCitedArticles } from "./legalValidation";

/** Boundary institucional obrigatório propagado do router (`tenantProcedure`). */
export interface LegalOpinionMeta {
  organizationId: number;
  correlationId: string;
  userId: number;
}

interface GenerateLegalOpinionParams {
  title: string;
  legalQuestion: string;
  context?: string;
  sourceType: "process" | "direct_contract" | "contract" | "other";
  // União ampla de 3 origens distintas (processo/contratação direta/contrato), cada uma com
  // colunas próprias — mantida dinâmica de propósito (apenas lida para montar o contexto textual).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sourceData?: any; // Dados do processo, contratação ou contrato relacionado
  /** Boundary institucional (tenant + correlation + ator). */
  meta: LegalOpinionMeta;
}

/** JSON Schema do parecer que o provider DEVE preencher (o servidor revalida). */
const LEGAL_OPINION_SCHEMA = {
  name: "legal_opinion",
  schema: {
    type: "object",
    properties: {
      opinion: { type: "string", description: "Parecer completo em Markdown" },
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
} as const;

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
  const { title, legalQuestion, context, sourceType, sourceData, meta } = params;

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

  // Objetivo + diretrizes jurídicas obrigatórias (o Kernel governa persona/prompt/provider).
  // A estrutura da resposta é declarada por `responseSchema` (LEGAL_OPINION_SCHEMA).
  const query = `Elabore um parecer jurídico completo e fundamentado na Lei 14.133/2021 e jurisprudências aplicáveis.

**Título do Parecer:** ${title}

**Questão Jurídica:**
${legalQuestion}
${context ? `\n**Contexto Adicional:**\n${context}\n` : ""}
${additionalContext}

**DIRETRIZES OBRIGATÓRIAS:**
- A Lei 14.133/2021 possui APENAS 194 artigos (Art. 1 a Art. 194). NUNCA cite artigos fora desse intervalo nem inexistentes.
- Estrutura clara em Markdown: Relatório, Fundamentação Legal, Análise, Conclusão.
- Cite APENAS artigos válidos da Lei 14.133/2021 (1–194).
- Mencione jurisprudências relevantes do TCU, STJ ou tribunais superiores quando pertinente.
- Conclusão objetiva: favorable, unfavorable ou with_reservations.
- Preencha os campos "opinion" (Markdown), "conclusion", "citedArticles" e "jurisprudence".`;

  try {
    const execution = await executeCognitiveTask({
      task: "LEGAL_ANALYSIS",
      tenantId: meta.organizationId,
      userId: String(meta.userId),
      correlationId: meta.correlationId,
      businessDomain: "parecer_juridico",
      query,
      responseSchema: LEGAL_OPINION_SCHEMA,
    });

    const content = execution.response.content;
    if (!content) {
      throw new Error("Resposta vazia da IA");
    }

    const result: LegalOpinionResult = JSON.parse(content);
    
    // VALIDAÇÃO DE ARTIGOS LEGAIS (Auditoria Técnica - Item 6.5)
    const validation = validateLegalCitations(result.opinion);
    
    if (!validation.isValid) {
      console.error("[Legal Opinion] Artigos inválidos detectados:", validation.invalidArticles);
      console.error("[Legal Opinion] Avisos:", validation.warnings);
      
      throw new Error(
        `Parecer contém citações legais inválidas:\n${validation.warnings.join('\n')}\n\n` +
        `O parecer não pode ser gerado com artigos inexistentes. Por favor, tente novamente.`
      );
    }
    
    // Log de sucesso
    const citedArticles = extractCitedArticles(result.opinion);
    console.info("[Legal Opinion] Parecer gerado com sucesso");
    console.info("[Legal Opinion] Artigos citados:", citedArticles.length);
    
    if (validation.suggestions.length > 0) {
      console.warn("[Legal Opinion] Sugestões:", validation.suggestions);
    }
    
    return result;
  } catch (error) {
    console.error("Erro ao gerar parecer jurídico:", error);
    throw new Error("Falha ao gerar parecer jurídico com IA");
  }
}

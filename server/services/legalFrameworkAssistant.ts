import { invokeLLM } from "../_core/llm";
import * as db from "../db";

/**
 * Assistente de Enquadramento Legal com IA
 * Analisa a situação descrita e sugere o artigo legal aplicável (Art. 74 ou 75 da Lei 14.133/2021)
 */

interface SuggestLegalArticleParams {
  situation: string; // Descrição da situação pelo usuário
  object: string; // Objeto da contratação
  estimatedValue: number; // Valor estimado em centavos
  urgency?: string; // Nível de urgência (opcional)
  hasExclusiveSupplier?: boolean; // Se há fornecedor exclusivo (opcional)
}

interface LegalArticleSuggestion {
  articleId: number;
  articleType: "dispensa" | "inexigibilidade";
  articleNumber: string; // Ex: "Art. 75, I"
  confidence: number; // 0-100
  reasoning: string; // Explicação da IA
  warnings: string[]; // Alertas importantes
  requiredDocuments: string[]; // Documentos obrigatórios
}

/**
 * Sugere artigo legal baseado na situação descrita
 */
export async function suggestLegalArticle(
  params: SuggestLegalArticleParams
): Promise<LegalArticleSuggestion> {
  const { situation, object, estimatedValue, urgency, hasExclusiveSupplier } = params;

  // Buscar todos os artigos legais do banco
  const articles = await db.getLegalArticles();

  // Preparar contexto para a IA
  const articlesContext = articles
    .map(
      (art) =>
        `${art.article} ${art.inciso ? art.inciso : ""}: ${art.summary}\n` +
        `Descrição: ${art.description}\n` +
        `Limite de valor: ${art.valueLimit || "Não especificado"}\n` +
        `Exemplos: ${art.examples || "Não especificado"}\n`
    )
    .join("\n---\n");

  const valueInReais = estimatedValue / 100;

  const prompt = `Você é um assistente jurídico especializado em Licitações e Contratos Públicos (Lei 14.133/2021).

**ARTIGOS LEGAIS DISPONÍVEIS:**
${articlesContext}

**SITUAÇÃO DESCRITA PELO USUÁRIO:**
- Objeto da contratação: ${object}
- Valor estimado: R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
- Situação: ${situation}
${urgency ? `- Urgência: ${urgency}` : ""}
${hasExclusiveSupplier !== undefined ? `- Fornecedor exclusivo: ${hasExclusiveSupplier ? "Sim" : "Não"}` : ""}

**TAREFA:**
Analise a situação e sugira o artigo legal mais adequado (Art. 74 ou Art. 75 da Lei 14.133/2021).

**RESPONDA EM JSON:**
{
  "articleNumber": "Art. 75, I" (exemplo),
  "articleType": "dispensa" ou "inexigibilidade",
  "confidence": 85 (0-100, quanto maior mais confiante),
  "reasoning": "Explicação clara e objetiva do porquê este artigo se aplica",
  "warnings": ["Alerta 1", "Alerta 2"] (alertas importantes, como limites de valor, prazos, etc.),
  "requiredDocuments": ["Documento 1", "Documento 2"] (documentos obrigatórios para este tipo de contratação)
}

**IMPORTANTE:**
- Seja preciso e objetivo
- Considere os limites de valor (Art. 75, I: até R$ 100.000 para obras, até R$ 50.000 para outros)
- Considere a urgência (Art. 75, III: emergência, Art. 75, IV: urgência)
- Considere exclusividade (Art. 74, I: fornecedor exclusivo)
- Liste todos os alertas relevantes (prazos, limites, condições)
- Liste todos os documentos obrigatórios`;

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "Você é um assistente jurídico especializado em Licitações Públicas. Responda APENAS em JSON válido, sem texto adicional.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "legal_article_suggestion",
        strict: true,
        schema: {
          type: "object",
          properties: {
            articleNumber: { type: "string" },
            articleType: { type: "string", enum: ["dispensa", "inexigibilidade"] },
            confidence: { type: "number" },
            reasoning: { type: "string" },
            warnings: { type: "array", items: { type: "string" } },
            requiredDocuments: { type: "array", items: { type: "string" } },
          },
          required: [
            "articleNumber",
            "articleType",
            "confidence",
            "reasoning",
            "warnings",
            "requiredDocuments",
          ],
          additionalProperties: false,
        },
      },
    },
  });

  const result = JSON.parse(response.choices[0].message.content || "{}");

  // Encontrar o artigo correspondente no banco
  const matchedArticle = articles.find(
    (art) => `${art.article} ${art.inciso || ""}`.trim() === result.articleNumber
  );

  if (!matchedArticle) {
    throw new Error(`Artigo sugerido não encontrado: ${result.articleNumber}`);
  }

  return {
    articleId: matchedArticle.id,
    articleType: result.articleType,
    articleNumber: result.articleNumber,
    confidence: result.confidence,
    reasoning: result.reasoning,
    warnings: result.warnings,
    requiredDocuments: result.requiredDocuments,
  };
}

/**
 * Gera justificativa inicial para a contratação direta
 */
export async function generateJustification(params: {
  articleId: number;
  object: string;
  situation: string;
  estimatedValue: number;
}): Promise<string> {
  const { articleId, object, situation, estimatedValue } = params;

  // Buscar artigo legal
  const article = await db.getLegalArticleById(articleId);
  if (!article) {
    throw new Error("Artigo legal não encontrado");
  }

  const valueInReais = estimatedValue / 100;

  const prompt = `Você é um servidor público especializado em elaborar justificativas para contratações diretas.

**ARTIGO LEGAL APLICÁVEL:**
${article.article} ${article.inciso || ""}: ${article.summary}
Descrição: ${article.description}

**DADOS DA CONTRATAÇÃO:**
- Objeto: ${object}
- Valor estimado: R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
- Situação: ${situation}

**TAREFA:**
Elabore uma justificativa técnica e jurídica COMPLETA para a contratação direta, seguindo este modelo:

1. **INTRODUÇÃO**
   - Apresentar o objeto da contratação
   - Citar o artigo legal aplicável

2. **FUNDAMENTAÇÃO LEGAL**
   - Explicar detalhadamente por que o artigo se aplica
   - Citar a Lei 14.133/2021 e outros normativos relevantes

3. **JUSTIFICATIVA TÉCNICA**
   - Explicar a necessidade da contratação
   - Descrever as características do objeto
   - Justificar a escolha do fornecedor (se inexigibilidade)

4. **ANÁLISE DE VALOR**
   - Demonstrar que o valor está dentro dos limites legais
   - Justificar a razoabilidade do preço

5. **CONCLUSÃO**
   - Resumir os pontos principais
   - Afirmar a legalidade da contratação

**IMPORTANTE:**
- Use linguagem formal e técnica
- Cite a legislação aplicável
- Seja objetivo mas completo
- Formate em Markdown com títulos e subtítulos
- Mínimo 500 palavras`;

  const response = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "Você é um servidor público especializado em elaborar justificativas para contratações diretas. Use linguagem formal e técnica.",
      },
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  return response.choices[0].message.content || "";
}

/**
 * Valida se o valor está dentro dos limites legais
 */
export function validateValue(params: {
  articleId: number;
  articleType: "dispensa" | "inexigibilidade";
  estimatedValue: number;
  category: "obras" | "servicos" | "compras";
}): {
  isValid: boolean;
  message: string;
  limit?: number;
} {
  const { articleType, estimatedValue, category } = params;

  // Inexigibilidade não tem limite de valor
  if (articleType === "inexigibilidade") {
    return {
      isValid: true,
      message: "Inexigibilidade não possui limite de valor.",
    };
  }

  // Limites de dispensa (Art. 75, I da Lei 14.133/2021)
  const limits = {
    obras: 10000000, // R$ 100.000 em centavos
    servicos: 5000000, // R$ 50.000 em centavos
    compras: 5000000, // R$ 50.000 em centavos
  };

  const limit = limits[category];
  const valueInReais = estimatedValue / 100;
  const limitInReais = limit / 100;

  if (estimatedValue > limit) {
    return {
      isValid: false,
      message: `Valor estimado (R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) excede o limite legal para dispensa de ${category} (R$ ${limitInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}).`,
      limit,
    };
  }

  return {
    isValid: true,
    message: `Valor dentro do limite legal para dispensa de ${category}.`,
    limit,
  };
}

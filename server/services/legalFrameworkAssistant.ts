/**
 * RC-4.1 → A3 — Assistente de Enquadramento Legal via **Cognitive Kernel**.
 *
 * MIGRADO (A3 — Cognitive Authoring Extension & Legacy Chain Retirement): este serviço
 * NÃO usa mais `invokeLLM`. Ele solicita a Cognitive Task `DIRECT_PROCUREMENT_REASONING`
 * (domínio contratacao_direta) ao AIExecutionEngine (`executeCognitiveTask`) — provider,
 * modelo (pinado), proveniência (A1), replay e o prompt tipado são governados pelo Kernel.
 * O structured output é declarado por `responseSchema`; a validação de citações legais
 * permanece obrigatória e fail-closed (nunca emite artigo inexistente).
 *
 * Multi-tenant: `tenantId` (organizationId), `correlationId` e o ator (userId) são
 * obrigatórios e fluem do router (`tenantProcedure`) para o Kernel.
 */
import { executeCognitiveTask } from "./aiExecutionEngine";
import * as db from "../db";
import { validateLegalCitations } from "./legalValidation";
import { z } from "zod";
import { findUniqueLegalArticle, formatCatalogArticleDisplay } from "../domain/legalArticleLocator";

/**
 * A3 — Validação ESTRITA (autoridade final) da resposta de DIRECT_PROCUREMENT_REASONING.
 * O response schema do provider apenas ORIENTA a geração; o Zod é a autoridade de validação.
 */
const legalArticleResponseSchema = z
  .object({
    articleNumber: z.string().min(1),
    articleType: z.enum(["dispensa", "inexigibilidade"]),
    confidence: z.number().min(0).max(100),
    reasoning: z.string().min(1),
    warnings: z.array(z.string()),
    requiredDocuments: z.array(z.string()),
  })
  .strict();

/** Boundary institucional obrigatório propagado do router (`tenantProcedure`). */
export interface LegalFrameworkMeta {
  organizationId: number;
  correlationId: string;
  userId: number;
}

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

/** JSON Schema da sugestão de artigo que o provider DEVE preencher (o servidor revalida). */
export const LEGAL_ARTICLE_SCHEMA = {
  name: "legal_article_suggestion",
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
    required: ["articleNumber", "articleType", "confidence", "reasoning", "warnings", "requiredDocuments"],
    additionalProperties: false,
  },
} as const;

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
  params: SuggestLegalArticleParams,
  meta: LegalFrameworkMeta
): Promise<LegalArticleSuggestion> {
  const { situation, object, estimatedValue, urgency, hasExclusiveSupplier } = params;

  // Buscar todos os artigos legais do banco
  const articles = await db.getLegalArticles();

  // Preparar contexto para a IA — usa o display CANÔNICO (nunca duplica inciso; ex.: "Art. 75, I").
  const articlesContext = articles
    .map(
      (art) =>
        `${formatCatalogArticleDisplay(art) ?? art.article}: ${art.summary}\n` +
        `Descrição: ${art.description}\n` +
        `Limite de valor: ${art.valueLimit || "Não especificado"}\n` +
        `Exemplos: ${art.examples || "Não especificado"}\n`
    )
    .join("\n---\n");

  const valueInReais = estimatedValue / 100;

  const query = `Analise a situação de contratação direta e sugira o artigo legal mais adequado (Art. 74 ou Art. 75 da Lei 14.133/2021).

**ARTIGOS LEGAIS DISPONÍVEIS:**
${articlesContext}

**SITUAÇÃO DESCRITA PELO USUÁRIO:**
- Objeto da contratação: ${object}
- Valor estimado: R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
- Situação: ${situation}
${urgency ? `- Urgência: ${urgency}` : ""}
${hasExclusiveSupplier !== undefined ? `- Fornecedor exclusivo: ${hasExclusiveSupplier ? "Sim" : "Não"}` : ""}

**DIRETRIZES:**
- Seja preciso e objetivo; use "articleNumber" no formato "Art. 75, I" (artigo e inciso).
- Baseie-se EXCLUSIVAMENTE nos DADOS DE REFERÊNCIA acima (artigo, inciso, summary, description, limite de valor e exemplos fornecidos pelo servidor) — não use limites ou hipóteses de memória.
- Liste todos os alertas relevantes (prazos, limites, condições) em "warnings".
- Liste todos os documentos obrigatórios em "requiredDocuments".
- "articleType" deve ser "dispensa" ou "inexigibilidade"; "confidence" entre 0 e 100.`;

  const execution = await executeCognitiveTask({
    task: "DIRECT_PROCUREMENT_REASONING",
    tenantId: meta.organizationId,
    userId: String(meta.userId),
    correlationId: meta.correlationId,
    businessDomain: "contratacao_direta",
    query,
    responseSchema: LEGAL_ARTICLE_SCHEMA,
  });

  // Validação ESTRITA server-side (autoridade final): fail-closed em qualquer desvio de contrato.
  let parsed: z.infer<typeof legalArticleResponseSchema>;
  try {
    parsed = legalArticleResponseSchema.parse(JSON.parse(execution.response.content || "{}"));
  } catch {
    throw new Error("Sugestão de artigo inválida (estrutura fora do contrato).");
  }

  // Casamento SEMÂNTICO determinístico contra o catálogo — vírgula/ponto/espaço/casing NÃO fazem
  // parte da identidade jurídica. Exatamente 1 casamento é aceito; 0 ou 2+ → fail-closed.
  const match = findUniqueLegalArticle(articles, parsed.articleNumber);
  if (match.status === "malformed") {
    throw new Error(`Número de artigo inválido na sugestão: ${parsed.articleNumber}`);
  }
  if (match.status === "not_found") {
    // Pode indicar defeito de DADOS DE REFERÊNCIA (artigo ausente no catálogo) — reportar, nunca fabricar.
    throw new Error(`Artigo sugerido não encontrado no catálogo: ${parsed.articleNumber}`);
  }
  if (match.status === "ambiguous") {
    throw new Error(`Artigo sugerido ambíguo no catálogo: ${parsed.articleNumber}`);
  }

  // Autoridade do CATÁLOGO: id/type/display canônicos vêm do registro do servidor. Se o articleType
  // gerado pela IA divergir do type do registro → fail-closed (a IA nunca fabrica a identidade).
  const matched = match.item;
  if (parsed.articleType !== matched.type) {
    throw new Error(`Tipo divergente do catálogo para ${matched.article}: IA="${parsed.articleType}" vs catálogo="${matched.type}".`);
  }

  return {
    articleId: matched.id,
    articleType: matched.type, // autoridade do catálogo
    articleNumber: matched.article, // display canônico do catálogo
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    warnings: parsed.warnings,
    requiredDocuments: parsed.requiredDocuments,
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
}, meta: LegalFrameworkMeta): Promise<string> {
  const { articleId, object, situation, estimatedValue } = params;

  // Buscar artigo legal
  const article = await db.getLegalArticleById(articleId);
  if (!article) {
    throw new Error("Artigo legal não encontrado");
  }

  const valueInReais = estimatedValue / 100;

  const query = `Elabore uma justificativa técnica e jurídica COMPLETA para a contratação direta.

**ARTIGO LEGAL APLICÁVEL:**
${article.article} ${article.inciso || ""}: ${article.summary}
Descrição: ${article.description}

**DADOS DA CONTRATAÇÃO:**
- Objeto: ${object}
- Valor estimado: R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
- Situação: ${situation}

**ESTRUTURA OBRIGATÓRIA:**

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

  const execution = await executeCognitiveTask({
    task: "DIRECT_PROCUREMENT_REASONING",
    tenantId: meta.organizationId,
    userId: String(meta.userId),
    correlationId: meta.correlationId,
    businessDomain: "contratacao_direta",
    query,
    responseType: "text",
    maxOutputTokens: 2048,
  });

  const content = execution.response.content || "";

  // VALIDAÇÃO DE ARTIGOS LEGAIS (Auditoria Técnica - Item 6.5)
  const validation = validateLegalCitations(content);
  
  if (!validation.isValid) {
    console.error("[Legal Framework] Artigos inválidos:", validation.invalidArticles);
    throw new Error(
      `Justificativa contém citações legais inválidas:\n${validation.warnings.join('\n')}\n\n` +
      `Por favor, gere novamente a justificativa.`
    );
  }
  
  console.info("[Legal Framework] Justificativa validada com sucesso");
  
  return content;
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

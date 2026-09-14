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
import { findUniqueLegalArticle } from "../domain/legalArticleLocator";

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
  /** Data de resolução temporal (ISO YYYY-MM-DD). Explícita no boundary; nunca "hoje" implícito no domínio. */
  asOfDate?: string;
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

/**
 * A3-RD1 — saída GOVERNADA. Identidade explícita do domínio governado (legalReferenceEntryId,
 * canonicalLocator, referenceSetVersion) — NUNCA reutiliza o `legalArticleId` legado.
 * `suggestedDocuments` é ASSISTIVO (não autoritativo); `requiresHumanValidation` sempre true.
 */
export interface GovernedLegalArticleSuggestion {
  legalReferenceEntryId: number;
  canonicalLocator: string;
  referenceSetVersion: number;
  articleType: "dispensa" | "inexigibilidade";
  articleNumber: string; // display canônico (ex.: "Art. 75, I")
  confidence: number;
  reasoning: string;
  warnings: string[];
  requiresHumanValidation: true;
  suggestedDocuments: string[]; // assistivo — requer validação humana; não é obrigação legal
  resolvedValueCents: number | null; // limite vigente resolvido do value override governado
}

/**
 * A3-RD1 — Sugere artigo legal a partir do REFERENCE SET GOVERNADO (readiness fail-closed):
 * set ativo aprovado → entries dentro da cobertura → valores resolvidos na data → prompt →
 * Cognitive Kernel → Zod strict → casamento por locator canônico → autoridade do set governado.
 * NÃO usa mais o catálogo legado `getLegalArticles()` nem valores/exemplos ungoverned.
 * Fail-closed se não houver set ativo aprovado (comportamento correto até a ativação humana).
 */
export async function suggestLegalArticle(
  params: SuggestLegalArticleParams,
  meta: LegalFrameworkMeta
): Promise<GovernedLegalArticleSuggestion> {
  const { situation, object, estimatedValue, urgency, hasExclusiveSupplier } = params;
  const asOfDate = params.asOfDate ?? new Date().toISOString().slice(0, 10);

  // Catálogo GOVERNADO vigente na data (fail-closed via readiness se set ausente/não aprovado).
  const catalog = await db.getGovernedCatalog(asOfDate);

  // Contexto para a IA: SOMENTE dados governados (display canônico, hipótese verificada, valor resolvido).
  const articlesContext = catalog.items
    .map((i) =>
      `${i.canonicalDisplay} (${i.procurementType}): ${i.hypothesisSummary}\n` +
      (i.valueCents != null
        ? `Limite de valor vigente: R$ ${(i.valueCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
        : `Limite de valor: não se aplica (sem limite governado)`)
    )
    .join("\n---\n");

  const valueInReais = estimatedValue / 100;

  const query = `Analise a situação de contratação direta e sugira o artigo legal mais adequado dentre os DADOS DE REFERÊNCIA GOVERNADOS abaixo (Lei 14.133/2021).

**DADOS DE REFERÊNCIA GOVERNADOS (autoridade oficial):**
${articlesContext}

**SITUAÇÃO DESCRITA PELO USUÁRIO:**
- Objeto da contratação: ${object}
- Valor estimado: R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
- Situação: ${situation}
${urgency ? `- Urgência: ${urgency}` : ""}
${hasExclusiveSupplier !== undefined ? `- Fornecedor exclusivo: ${hasExclusiveSupplier ? "Sim" : "Não"}` : ""}

**DIRETRIZES:**
- Escolha APENAS um dos dispositivos listados acima; use "articleNumber" no display exato mostrado (ex.: "Art. 75, I").
- Baseie-se EXCLUSIVAMENTE nos dados governados acima — NÃO use limites, hipóteses ou exemplos de memória.
- "warnings": alertas relevantes (prazos, limites, condições).
- "requiredDocuments": documentos SUGERIDOS (assistivos, a validar por humano — não são obrigação legal).
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

  // Casamento SEMÂNTICO por locator contra o catálogo GOVERNADO (não fuzzy). Exatamente 1 → aceito.
  const match = findUniqueLegalArticle(
    catalog.items.map((i) => ({ ...i, article: i.canonicalDisplay })),
    parsed.articleNumber,
  );
  if (match.status === "malformed") throw new Error(`Número de artigo inválido na sugestão: ${parsed.articleNumber}`);
  if (match.status === "not_found") throw new Error(`Artigo sugerido fora do reference set governado: ${parsed.articleNumber}`);
  if (match.status === "ambiguous") throw new Error(`Artigo sugerido ambíguo no reference set: ${parsed.articleNumber}`);

  // Autoridade do REFERENCE SET: identidade/type/display/valor vêm do registro governado (nunca da IA).
  const matched = match.item;
  if (parsed.articleType !== matched.procurementType) {
    throw new Error(`Tipo divergente do reference set para ${matched.canonicalDisplay}: IA="${parsed.articleType}" vs governado="${matched.procurementType}".`);
  }

  return {
    legalReferenceEntryId: matched.legalReferenceEntryId,
    canonicalLocator: matched.canonicalLocator,
    referenceSetVersion: catalog.referenceSetVersion,
    articleType: matched.procurementType, // autoridade do set governado
    articleNumber: matched.canonicalDisplay, // display canônico governado
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    warnings: parsed.warnings,
    requiresHumanValidation: true,
    suggestedDocuments: parsed.requiredDocuments, // assistivo (não autoritativo)
    resolvedValueCents: matched.valueCents,
  };
}

/**
 * A3-RD1 — Entrada da justificativa com resolução de autoridade legal em DOIS DOMÍNIOS DISJUNTOS:
 *  - GOVERNADO (preferencial): `canonicalLocator` (+ `asOfDate` opcional) → resolvido no reference
 *    set ativo aprovado via `resolveGovernedReference`; autoridade/valor vêm do registro governado.
 *  - LEGADO (compatibilidade): `articleId` → catálogo legado `getLegalArticleById`.
 * Os dois caminhos são MUTUAMENTE EXCLUSIVOS; IDs nunca são misturados. Se ambos forem informados,
 * o governado tem precedência e o `articleId` é ignorado (nunca combinado).
 */
export type GenerateJustificationParams =
  & { object: string; situation: string; estimatedValue: number }
  & (
      | { canonicalLocator: string; asOfDate?: string; articleId?: undefined }
      | { articleId: number; canonicalLocator?: undefined; asOfDate?: undefined }
    );

/** Contexto legal normalizado (display + descrição) resolvido de um único domínio de autoridade. */
interface ResolvedLegalContext {
  readonly display: string;
  readonly description: string;
}

/**
 * A3-RD1 — Gera justificativa inicial para a contratação direta.
 * Resolve a autoridade legal a partir do domínio GOVERNADO (canonicalLocator) ou, como
 * compatibilidade, do catálogo LEGADO (articleId). A geração passa pelo Cognitive Kernel e a
 * validação de citações permanece fail-closed.
 */
export async function generateJustification(
  params: GenerateJustificationParams,
  meta: LegalFrameworkMeta
): Promise<string> {
  const { object, situation, estimatedValue } = params;

  // Resolução de autoridade em DOMÍNIO ÚNICO (governado preferencial; legado como compatibilidade).
  let legal: ResolvedLegalContext;
  if (params.canonicalLocator) {
    const asOfDate = params.asOfDate ?? new Date().toISOString().slice(0, 10);
    const resolved = await db.resolveGovernedReference(params.canonicalLocator, asOfDate);
    legal = {
      display: resolved.entry.canonicalDisplay,
      description:
        `${resolved.entry.hypothesisSummary}` +
        (resolved.valueCents != null
          ? `\nLimite de valor vigente (reference set v${resolved.referenceSetVersion}): R$ ${(resolved.valueCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
          : ""),
    };
  } else {
    // Caminho LEGADO (consumidores antigos): NUNCA busca autoridade governada aqui.
    if (params.articleId == null) {
      throw new Error("Informe canonicalLocator (governado) ou articleId (legado).");
    }
    const article = await db.getLegalArticleById(params.articleId);
    if (!article) {
      throw new Error("Artigo legal não encontrado");
    }
    legal = {
      display: `${article.article} ${article.inciso || ""}`.trim() + `: ${article.summary}`,
      description: article.description,
    };
  }

  const valueInReais = estimatedValue / 100;

  const query = `Elabore uma justificativa técnica e jurídica COMPLETA para a contratação direta.

**ARTIGO LEGAL APLICÁVEL:**
${legal.display}
Descrição: ${legal.description}

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
 * A3-RD1 — Validação de valor GOVERNADA (autoridade oficial via value override do reference set).
 * Resolve o limite vigente na data para o `canonicalLocator` e compara o valor estimado. Fail-closed:
 * qualquer falha de readiness (set ausente/não aprovado, locator fora da cobertura, ausência de
 * override) propaga o `LegalReferenceError` — nunca cai em limite hardcoded. Inexigibilidade e
 * dispensas sem limite governado (valueCents = null) → sem restrição de valor.
 */
export async function validateGovernedValue(params: {
  canonicalLocator: string;
  estimatedValue: number; // centavos
  asOfDate?: string;
}): Promise<{ isValid: boolean; message: string; limitCents: number | null; referenceSetVersion: number }> {
  const asOfDate = params.asOfDate ?? new Date().toISOString().slice(0, 10);
  const resolved = await db.resolveGovernedReference(params.canonicalLocator, asOfDate);
  const limitCents = resolved.valueCents;

  if (limitCents == null) {
    return {
      isValid: true,
      message: `${resolved.entry.canonicalDisplay}: sem limite de valor governado aplicável.`,
      limitCents: null,
      referenceSetVersion: resolved.referenceSetVersion,
    };
  }

  const valueInReais = params.estimatedValue / 100;
  const limitInReais = limitCents / 100;
  if (params.estimatedValue > limitCents) {
    return {
      isValid: false,
      message: `Valor estimado (R$ ${valueInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) excede o limite vigente de ${resolved.entry.canonicalDisplay} (R$ ${limitInReais.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}, reference set v${resolved.referenceSetVersion}).`,
      limitCents,
      referenceSetVersion: resolved.referenceSetVersion,
    };
  }
  return {
    isValid: true,
    message: `Valor dentro do limite vigente de ${resolved.entry.canonicalDisplay} (reference set v${resolved.referenceSetVersion}).`,
    limitCents,
    referenceSetVersion: resolved.referenceSetVersion,
  };
}

/**
 * @legacy — Validação de valor com limites HARDCODED (Art. 75, I nominal de 2021).
 * Preservada APENAS para o consumidor legado `directContracts.assistant.validateValue`.
 * O fluxo governado (A3-RD1) NÃO usa esta função — o limite vigente é resolvido do value override
 * governado via `validateGovernedValue` / `resolveGovernedReference`. NÃO usar em código novo.
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

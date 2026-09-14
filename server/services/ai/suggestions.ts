/**
 * RC-3.5.1 → A3 — Sugestões contextuais via **Cognitive Kernel**.
 *
 * MIGRADO (A3 — Cognitive Authoring Extension & Legacy Chain Retirement):
 * este serviço NÃO instancia mais o Gemini diretamente (`new GoogleGenerativeAI`).
 * Cada sugestão é uma Cognitive Task solicitada ao AIExecutionEngine
 * (`executeCognitiveTask`) — provider, modelo (pinado), proveniência (A1), replay e o
 * prompt tipado por tarefa são governados pelo Kernel. O contexto legal recuperado via
 * RAG é passado como `groundingBlock` (o engine nunca acessa o Corpus por conta própria).
 *
 * Multi-tenant: `tenantId` (organizationId), `correlationId` e o ator (userId) são
 * obrigatórios e fluem do router (`tenantProcedure`) para o Kernel.
 *
 * Natureza: apoio supervisionado — toda saída é editável, revisável e validada por humano.
 */

import { retrieveRelevantLaw, formatRetrievedContext } from "../rag";
import { executeCognitiveTask } from "../aiExecutionEngine";
import type { CognitiveTaskId } from "../../domain/cognitiveTask";
import type { BusinessDomainCode } from "../../domain/businessDomain";
import {
  ProcessContext, processBlock, documentsBlock, outputInstruction, truncate,
} from "./promptBuilder";

/** Boundary institucional obrigatório propagado do router (`tenantProcedure`). */
export interface SuggestionMeta {
  /** Tenant (organizationId). */
  organizationId: number;
  /** Correlation do fluxo de negócio. */
  correlationId: string;
  /** Ator do pedido. */
  userId: number;
}

/**
 * Executa uma Cognitive Task de saída textual (markdown supervisionado) pelo Kernel.
 * Fail-closed: sem conteúdo válido não há sugestão (nunca retorna string vazia).
 */
async function runTextSuggestion(params: {
  task: CognitiveTaskId;
  businessDomain: BusinessDomainCode;
  query: string;
  groundingBlock?: string;
  maxOutputTokens: number;
  meta: SuggestionMeta;
}): Promise<string> {
  const execution = await executeCognitiveTask({
    task: params.task,
    tenantId: params.meta.organizationId,
    userId: String(params.meta.userId),
    correlationId: params.meta.correlationId,
    businessDomain: params.businessDomain,
    query: params.query,
    groundingBlock: params.groundingBlock,
    responseType: "text",
    maxOutputTokens: params.maxOutputTokens,
  });
  const content = execution.response.content?.trim();
  if (!content) {
    throw new Error("Não foi possível gerar a sugestão no momento. Por favor, tente novamente.");
  }
  return content;
}

/** Sugere a modalidade de licitação mais adequada */
export async function suggestModality(ctx: ProcessContext, meta: SuggestionMeta): Promise<string> {
  const law = formatRetrievedContext(
    await retrieveRelevantLaw("modalidade licitação limites valor Lei 14.133/21 pregão concorrência dispensa", 4)
  );
  const query = `${processBlock(ctx)}

Analise os dados acima e recomende:
1. **Modalidade mais adequada** (Pregão Eletrônico, Concorrência, Dispensa, etc.) com justificativa legal
2. **Critério de julgamento** recomendado
3. **Alertas** caso o valor ou objeto impliquem restrições ou exigências específicas

${outputInstruction("Use Markdown com seções numeradas. Seja objetivo (máx. 400 palavras).")}`;

  return runTextSuggestion({
    task: "PROCUREMENT_REASONING", businessDomain: "processo_licitatorio",
    query, groundingBlock: law, maxOutputTokens: 1024, meta,
  });
}

/** Identifica riscos no processo */
export async function suggestRisks(ctx: ProcessContext, meta: SuggestionMeta): Promise<string> {
  const law = formatRetrievedContext(
    await retrieveRelevantLaw("riscos contratos públicos irregularidades licitação Lei 14.133", 3)
  );
  const query = `${processBlock(ctx)}

**DOCUMENTOS DO PROCESSO:**
${documentsBlock(ctx)}

Identifique os principais **riscos jurídicos, operacionais e financeiros** deste processo licitatório.

${outputInstruction(`Retorne uma lista de riscos no formato:
### 🔴 Riscos Altos
- **[Nome do risco]:** descrição + fundamentação legal

### 🟡 Riscos Médios
- ...

### 🟢 Observações Positivas
- ...

Máximo 600 palavras.`)}`;

  return runTextSuggestion({
    task: "RISK_ANALYSIS", businessDomain: "processo_licitatorio",
    query, groundingBlock: law, maxOutputTokens: 1536, meta,
  });
}

/** Sugere cláusulas contratuais */
export async function suggestClauses(ctx: ProcessContext, clauseType: string, meta: SuggestionMeta): Promise<string> {
  const law = formatRetrievedContext(
    await retrieveRelevantLaw(`cláusulas obrigatórias contrato administrativo ${clauseType} Lei 14.133`, 4)
  );
  const query = `${processBlock(ctx)}

**CONTEXTO DO CONTRATO:**
${truncate(ctx.contratoContent || ctx.editalContent, 1000)}

Sugira o texto completo da cláusula sobre **"${clauseType}"** para este contrato, conforme a Lei 14.133/21.

${outputInstruction("Retorne apenas o texto da cláusula em Markdown, pronto para inserção no contrato. Inclua o número da cláusula e o embasamento legal.")}`;

  return runTextSuggestion({
    task: "CONTRACT_REASONING", businessDomain: "contratos",
    query, groundingBlock: law, maxOutputTokens: 1536, meta,
  });
}

/** Sugere exigências técnicas para o TR */
export async function suggestTechnicalRequirements(ctx: ProcessContext, meta: SuggestionMeta): Promise<string> {
  const law = formatRetrievedContext(
    await retrieveRelevantLaw("especificações técnicas termo referência habilitação requisitos Lei 14.133", 3)
  );
  const query = `${processBlock(ctx)}

**ETP disponível:**
${truncate(ctx.etpContent, 1200)}

Sugira as **exigências técnicas** que devem constar no Termo de Referência para este objeto, incluindo:
1. Qualificação técnica da empresa
2. Qualificação técnica dos profissionais (se aplicável)
3. Especificações mínimas do objeto
4. Critérios de aceitação e garantia

${outputInstruction("Use Markdown com listas numeradas. Máximo 500 palavras. Cite os artigos da Lei 14.133/21 quando relevante.")}`;

  return runTextSuggestion({
    task: "PROCUREMENT_REASONING", businessDomain: "processo_licitatorio",
    query, groundingBlock: law, maxOutputTokens: 1280, meta,
  });
}

/** Sugere fundamentação jurídica para qualquer decisão do processo */
export async function suggestLegalBasis(ctx: ProcessContext, question: string, meta: SuggestionMeta): Promise<string> {
  const law = formatRetrievedContext(
    await retrieveRelevantLaw(question, 5)
  );
  const query = `${processBlock(ctx)}

**PERGUNTA / SITUAÇÃO:**
${question}

Forneça a **fundamentação jurídica** completa para esta situação, citando:
- Artigos aplicáveis da Lei 14.133/21
- Jurisprudência do TCU relevante (se houver)
- Conclusão e recomendação objetiva

${outputInstruction("Use Markdown. Máximo 500 palavras. Seja preciso nas citações legais.")}`;

  return runTextSuggestion({
    task: "LEGAL_REASONING", businessDomain: "parecer_juridico",
    query, groundingBlock: law, maxOutputTokens: 1280, meta,
  });
}

/** Melhora um trecho de texto de documento licitatório */
export async function improveText(ctx: ProcessContext, docType: string, textSnippet: string, meta: SuggestionMeta): Promise<string> {
  const query = `${processBlock(ctx)}

**TIPO DE DOCUMENTO:** ${docType.toUpperCase()}

**TRECHO A MELHORAR:**
${truncate(textSnippet, 1500)}

Reescreva este trecho para que seja:
1. Tecnicamente preciso e completo
2. Alinhado com a linguagem jurídica administrativa brasileira
3. Claro e objetivo

${outputInstruction("Retorne apenas o texto reescrito em Markdown, sem explicações adicionais.")}`;

  return runTextSuggestion({
    task: "DOCUMENT_IMPROVEMENT", businessDomain: "processo_licitatorio",
    query, maxOutputTokens: 1536, meta,
  });
}

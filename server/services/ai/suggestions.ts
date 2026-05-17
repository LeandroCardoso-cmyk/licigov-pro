/**
 * Funções de sugestão contextual usando Gemini.
 * Cada função usa processBlock/documentsBlock do promptBuilder
 * para manter os prompts enxutos e reutilizáveis.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { retrieveRelevantLaw, formatRetrievedContext } from "../rag";
import {
  ProcessContext, processBlock, documentsBlock, outputInstruction, fmtBrl, truncate,
} from "./promptBuilder";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

function getModel(maxTokens = 2048) {
  return genAI.getGenerativeModel({
    model: "gemini-2.0-flash-exp",
    generationConfig: { temperature: 0.4, topP: 0.85, maxOutputTokens: maxTokens },
  });
}

/** Sugere a modalidade de licitação mais adequada */
export async function suggestModality(ctx: ProcessContext): Promise<string> {
  const law = formatRetrievedContext(
    await retrieveRelevantLaw("modalidade licitação limites valor Lei 14.133/21 pregão concorrência dispensa", 4)
  );
  const prompt = `Você é especialista em licitações públicas (Lei 14.133/21).

${processBlock(ctx)}

**CONTEXTO LEGAL:**
${law}

Analise os dados acima e recomende:
1. **Modalidade mais adequada** (Pregão Eletrônico, Concorrência, Dispensa, etc.) com justificativa legal
2. **Critério de julgamento** recomendado
3. **Alertas** caso o valor ou objeto impliquem restrições ou exigências específicas

${outputInstruction("Use Markdown com seções numeradas. Seja objetivo (máx. 400 palavras).")}`;

  const result = await getModel(1024).generateContent(prompt);
  return result.response.text();
}

/** Identifica riscos no processo */
export async function suggestRisks(ctx: ProcessContext): Promise<string> {
  const law = formatRetrievedContext(
    await retrieveRelevantLaw("riscos contratos públicos irregularidades licitação Lei 14.133", 3)
  );
  const prompt = `Você é auditor especializado em controle interno de licitações públicas (Lei 14.133/21).

${processBlock(ctx)}

**DOCUMENTOS DO PROCESSO:**
${documentsBlock(ctx)}

**CONTEXTO LEGAL:**
${law}

Identifique os principais **riscos jurídicos, operacionais e financeiros** deste processo licitatório.

${outputInstruction(`Retorne uma lista de riscos no formato:
### 🔴 Riscos Altos
- **[Nome do risco]:** descrição + fundamentação legal

### 🟡 Riscos Médios
- ...

### 🟢 Observações Positivas
- ...

Máximo 600 palavras.`)}`;

  const result = await getModel(1536).generateContent(prompt);
  return result.response.text();
}

/** Sugere cláusulas contratuais */
export async function suggestClauses(ctx: ProcessContext, clauseType: string): Promise<string> {
  const law = formatRetrievedContext(
    await retrieveRelevantLaw(`cláusulas obrigatórias contrato administrativo ${clauseType} Lei 14.133`, 4)
  );
  const prompt = `Você é especialista em contratos administrativos (Lei 14.133/21).

${processBlock(ctx)}

**CONTEXTO DO CONTRATO:**
${truncate(ctx.contratoContent || ctx.editalContent, 1000)}

**CONTEXTO LEGAL:**
${law}

Sugira o texto completo da cláusula sobre **"${clauseType}"** para este contrato, conforme a Lei 14.133/21.

${outputInstruction("Retorne apenas o texto da cláusula em Markdown, pronto para inserção no contrato. Inclua o número da cláusula e o embasamento legal.")}`;

  const result = await getModel(1536).generateContent(prompt);
  return result.response.text();
}

/** Sugere exigências técnicas para o TR */
export async function suggestTechnicalRequirements(ctx: ProcessContext): Promise<string> {
  const law = formatRetrievedContext(
    await retrieveRelevantLaw("especificações técnicas termo referência habilitação requisitos Lei 14.133", 3)
  );
  const prompt = `Você é especialista em elaboração de Termos de Referência (Lei 14.133/21).

${processBlock(ctx)}

**ETP disponível:**
${truncate(ctx.etpContent, 1200)}

**CONTEXTO LEGAL:**
${law}

Sugira as **exigências técnicas** que devem constar no Termo de Referência para este objeto, incluindo:
1. Qualificação técnica da empresa
2. Qualificação técnica dos profissionais (se aplicável)
3. Especificações mínimas do objeto
4. Critérios de aceitação e garantia

${outputInstruction("Use Markdown com listas numeradas. Máximo 500 palavras. Cite os artigos da Lei 14.133/21 quando relevante.")}`;

  const result = await getModel(1280).generateContent(prompt);
  return result.response.text();
}

/** Sugere fundamentação jurídica para qualquer decisão do processo */
export async function suggestLegalBasis(ctx: ProcessContext, question: string): Promise<string> {
  const law = formatRetrievedContext(
    await retrieveRelevantLaw(question, 5)
  );
  const prompt = `Você é assessor jurídico especializado em licitações e contratos públicos (Lei 14.133/21).

${processBlock(ctx)}

**PERGUNTA / SITUAÇÃO:**
${question}

**DISPOSITIVOS LEGAIS RELEVANTES:**
${law}

Forneça a **fundamentação jurídica** completa para esta situação, citando:
- Artigos aplicáveis da Lei 14.133/21
- Jurisprudência do TCU relevante (se houver)
- Conclusão e recomendação objetiva

${outputInstruction("Use Markdown. Máximo 500 palavras. Seja preciso nas citações legais.")}`;

  const result = await getModel(1280).generateContent(prompt);
  return result.response.text();
}

/** Melhora um trecho de texto de documento licitatório */
export async function improveText(ctx: ProcessContext, docType: string, textSnippet: string): Promise<string> {
  const prompt = `Você é especialista em redação de documentos licitatórios conforme a Lei 14.133/21.

${processBlock(ctx)}

**TIPO DE DOCUMENTO:** ${docType.toUpperCase()}

**TRECHO A MELHORAR:**
${truncate(textSnippet, 1500)}

Reescreva este trecho para que seja:
1. Tecnicamente preciso e completo
2. Alinhado com a linguagem jurídica administrativa brasileira
3. Claro e objetivo

${outputInstruction("Retorne apenas o texto reescrito em Markdown, sem explicações adicionais.")}`;

  const result = await getModel(1536).generateContent(prompt);
  return result.response.text();
}

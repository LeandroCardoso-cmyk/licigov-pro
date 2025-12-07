/**
 * Módulo de Validação Legal
 * 
 * Correção da Auditoria Técnica - Item 6.5 (Prioridade 95/100)
 * Problema: IA pode citar artigos inexistentes da Lei 14.133/2021
 * Solução: Validar todas as citações legais contra lista oficial de artigos
 */

// Lei 14.133/2021 possui 194 artigos
const VALID_ARTICLES_14133 = Array.from({ length: 194 }, (_, i) => i + 1);

// Outros diplomas legais relevantes
const VALID_ARTICLES_8666 = Array.from({ length: 126 }, (_, i) => i + 1); // Lei 8.666/93 (revogada, mas ainda citada)
const VALID_ARTICLES_10520 = Array.from({ length: 16 }, (_, i) => i + 1); // Lei 10.520/02 (Pregão)

export interface LegalCitationValidation {
  isValid: boolean;
  invalidArticles: Array<{
    article: number;
    law: string;
    context: string;
  }>;
  warnings: string[];
  suggestions: string[];
}

/**
 * Valida citações de artigos da Lei 14.133/2021
 */
export function validateLegalCitations(content: string): LegalCitationValidation {
  const warnings: string[] = [];
  const suggestions: string[] = [];
  const invalidArticles: Array<{ article: number; law: string; context: string }> = [];

  // Regex para detectar citações de artigos
  // Padrões suportados:
  // - Art. 123
  // - Artigo 123
  // - art 123
  // - Art. 123 da Lei 14.133/2021
  const articleRegex = /(?:Art\.?|Artigo)\s*(\d+)(?:\s*(?:da|,)\s*Lei\s*([\d.\/]+))?/gi;
  const matches = content.matchAll(articleRegex);

  for (const match of matches) {
    const articleNumber = parseInt(match[1]);
    const lawNumber = match[2] || '14.133/2021'; // Assume Lei 14.133/2021 se não especificada
    const context = match[0];

    // Validar conforme a lei citada
    if (lawNumber.includes('14.133') || lawNumber.includes('14133')) {
      if (!VALID_ARTICLES_14133.includes(articleNumber)) {
        invalidArticles.push({
          article: articleNumber,
          law: '14.133/2021',
          context,
        });
        warnings.push(
          `Artigo ${articleNumber} não existe na Lei 14.133/2021 (máximo: 194 artigos)`
        );
      }
    } else if (lawNumber.includes('8.666') || lawNumber.includes('8666')) {
      if (!VALID_ARTICLES_8666.includes(articleNumber)) {
        invalidArticles.push({
          article: articleNumber,
          law: '8.666/93',
          context,
        });
        warnings.push(
          `Artigo ${articleNumber} não existe na Lei 8.666/93 (máximo: 126 artigos)`
        );
      }
      suggestions.push(
        `Lei 8.666/93 foi revogada pela Lei 14.133/2021. Considere atualizar a fundamentação legal.`
      );
    } else if (lawNumber.includes('10.520') || lawNumber.includes('10520')) {
      if (!VALID_ARTICLES_10520.includes(articleNumber)) {
        invalidArticles.push({
          article: articleNumber,
          law: '10.520/02',
          context,
        });
        warnings.push(
          `Artigo ${articleNumber} não existe na Lei 10.520/02 (máximo: 16 artigos)`
        );
      }
    }
  }

  return {
    isValid: invalidArticles.length === 0,
    invalidArticles,
    warnings,
    suggestions,
  };
}

/**
 * Valida e corrige documento gerado por IA
 * Tenta regenerar se artigos inválidos forem detectados
 */
export async function validateAndCorrectDocument(
  content: string,
  regenerateFn?: () => Promise<string>,
  maxRetries: number = 2
): Promise<{
  content: string;
  validation: LegalCitationValidation;
  wasRegenerated: boolean;
  retries: number;
}> {
  let currentContent = content;
  let retries = 0;
  let wasRegenerated = false;

  while (retries < maxRetries) {
    const validation = validateLegalCitations(currentContent);

    if (validation.isValid) {
      return {
        content: currentContent,
        validation,
        wasRegenerated,
        retries,
      };
    }

    // Se há artigos inválidos e função de regeneração foi fornecida
    if (regenerateFn && retries < maxRetries - 1) {
      console.warn(
        `[Legal Validation] Artigos inválidos detectados (tentativa ${retries + 1}/${maxRetries}):`,
        validation.invalidArticles
      );

      // Tentar regenerar
      currentContent = await regenerateFn();
      wasRegenerated = true;
      retries++;
    } else {
      // Sem função de regeneração ou máximo de tentativas atingido
      throw new Error(
        `Documento contém citações legais inválidas:\n${validation.warnings.join('\n')}`
      );
    }
  }

  // Se chegou aqui, todas as tentativas falharam
  const finalValidation = validateLegalCitations(currentContent);
  throw new Error(
    `Falha ao gerar documento válido após ${maxRetries} tentativas:\n${finalValidation.warnings.join('\n')}`
  );
}

/**
 * Extrai todos os artigos citados em um documento
 */
export function extractCitedArticles(content: string): Array<{
  article: number;
  law: string;
  context: string;
}> {
  const articles: Array<{ article: number; law: string; context: string }> = [];
  const articleRegex = /(?:Art\.?|Artigo)\s*(\d+)(?:\s*(?:da|,)\s*Lei\s*([\d.\/]+))?/gi;
  const matches = content.matchAll(articleRegex);

  for (const match of matches) {
    const articleNumber = parseInt(match[1]);
    const lawNumber = match[2] || '14.133/2021';
    const context = match[0];

    articles.push({
      article: articleNumber,
      law: lawNumber,
      context,
    });
  }

  return articles;
}

/**
 * Gera relatório de conformidade legal de um documento
 */
export function generateComplianceReport(content: string): {
  totalCitations: number;
  validCitations: number;
  invalidCitations: number;
  complianceRate: number;
  details: LegalCitationValidation;
} {
  const validation = validateLegalCitations(content);
  const totalCitations = extractCitedArticles(content).length;
  const invalidCitations = validation.invalidArticles.length;
  const validCitations = totalCitations - invalidCitations;
  const complianceRate = totalCitations > 0 ? (validCitations / totalCitations) * 100 : 100;

  return {
    totalCitations,
    validCitations,
    invalidCitations,
    complianceRate,
    details: validation,
  };
}

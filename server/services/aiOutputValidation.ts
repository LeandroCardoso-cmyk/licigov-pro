/**
 * Módulo de Validação de Outputs de IA
 * 
 * Correção da Auditoria Técnica - Item 6.2 (Prioridade 75/100)
 * Problema: IA pode retornar JSON, texto plano ou formato corrompido
 * Solução: Validar formato e estrutura dos documentos gerados
 */

export interface DocumentValidation {
  isValid: boolean;
  format: 'markdown' | 'json' | 'plain_text' | 'unknown';
  hasRequiredSections: boolean;
  missingSections: string[];
  warnings: string[];
  errors: string[];
}

/**
 * Configuração de seções obrigatórias por tipo de documento
 */
const REQUIRED_SECTIONS: Record<string, string[]> = {
  etp: [
    'DESCRIÇÃO DA NECESSIDADE',
    'JUSTIFICATIVA',
    'ESTIMATIVA DE VALOR',
    'MODALIDADE SUGERIDA',
  ],
  tr: [
    'OBJETO',
    'ESPECIFICAÇÕES TÉCNICAS',
    'QUANTITATIVOS',
    'PRAZO DE EXECUÇÃO',
    'CONDIÇÕES DE RECEBIMENTO',
  ],
  dfd: [
    'CARACTERIZAÇÃO DO OBJETO',
    'ESTIMATIVA DE VALOR',
    'JUSTIFICATIVA DA CONTRATAÇÃO',
  ],
  edital: [
    'OBJETO',
    'CONDIÇÕES DE PARTICIPAÇÃO',
    'CRITÉRIO DE JULGAMENTO',
    'PRAZO DE VALIDADE DAS PROPOSTAS',
    'CONDIÇÕES DE PAGAMENTO',
  ],
  parecer: [
    'RELATÓRIO',
    'FUNDAMENTAÇÃO',
    'CONCLUSÃO',
  ],
};

/**
 * Detecta o formato do conteúdo gerado
 */
export function detectFormat(content: string): 'markdown' | 'json' | 'plain_text' | 'unknown' {
  const trimmed = content.trim();

  // Detectar JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // Não é JSON válido
    }
  }

  // Detectar Markdown (presença de headers)
  if (trimmed.includes('##') || trimmed.includes('###') || trimmed.includes('# ')) {
    return 'markdown';
  }

  // Detectar se tem alguma estrutura
  if (trimmed.includes('\n\n') || trimmed.includes('  ')) {
    return 'plain_text';
  }

  return 'unknown';
}

/**
 * Valida se o conteúdo é Markdown válido
 */
export function isValidMarkdown(content: string): boolean {
  // Verificar se contém headers Markdown
  if (!content.includes('##') && !content.includes('###') && !content.includes('# ')) {
    return false;
  }

  // Verificar se não é JSON
  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    return false;
  }

  // Verificar tamanho mínimo (documentos muito curtos são suspeitos)
  if (content.length < 500) {
    return false;
  }

  // Verificar se contém texto significativo (não apenas headers)
  const withoutHeaders = content.replace(/#{1,6}\s+.+/g, '');
  if (withoutHeaders.trim().length < 200) {
    return false;
  }

  return true;
}

/**
 * Verifica se o documento contém as seções obrigatórias
 */
export function hasRequiredSections(
  content: string,
  documentType: string
): { hasAll: boolean; missing: string[] } {
  const requiredSections = REQUIRED_SECTIONS[documentType.toLowerCase()] || [];
  const missing: string[] = [];

  for (const section of requiredSections) {
    // Busca case-insensitive
    const regex = new RegExp(section, 'i');
    if (!regex.test(content)) {
      missing.push(section);
    }
  }

  return {
    hasAll: missing.length === 0,
    missing,
  };
}

/**
 * Valida completamente um documento gerado por IA
 */
export function validateDocument(
  content: string,
  documentType: string
): DocumentValidation {
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1. Detectar formato
  const format = detectFormat(content);

  if (format !== 'markdown') {
    errors.push(`Formato inválido: esperado Markdown, recebido ${format}`);
  }

  // 2. Validar Markdown
  if (!isValidMarkdown(content)) {
    errors.push('Conteúdo não é Markdown válido');
  }

  // 3. Verificar seções obrigatórias
  const sectionsCheck = hasRequiredSections(content, documentType);

  if (!sectionsCheck.hasAll) {
    errors.push(`Seções obrigatórias ausentes: ${sectionsCheck.missing.join(', ')}`);
  }

  // 4. Verificar tamanho
  if (content.length < 1000) {
    warnings.push('Documento muito curto (menos de 1000 caracteres)');
  }

  if (content.length > 50000) {
    warnings.push('Documento muito longo (mais de 50000 caracteres)');
  }

  // 5. Verificar estrutura de headers
  const headerRegex = /^#{1,6}\s+.+$/gm;
  const headers = content.match(headerRegex);

  if (!headers || headers.length < 3) {
    warnings.push('Documento possui poucos headers (estrutura fraca)');
  }

  // 6. Verificar parágrafos
  const paragraphs = content.split('\n\n').filter(p => p.trim().length > 50);

  if (paragraphs.length < 5) {
    warnings.push('Documento possui poucos parágrafos (conteúdo insuficiente)');
  }

  return {
    isValid: errors.length === 0,
    format,
    hasRequiredSections: sectionsCheck.hasAll,
    missingSections: sectionsCheck.missing,
    warnings,
    errors,
  };
}

/**
 * Valida e corrige documento com tentativas de regeneração
 */
export async function validateAndCorrectAIOutput(
  content: string,
  documentType: string,
  regenerateFn?: (feedback: string) => Promise<string>,
  maxRetries: number = 2
): Promise<{
  content: string;
  validation: DocumentValidation;
  wasRegenerated: boolean;
  retries: number;
}> {
  let currentContent = content;
  let retries = 0;
  let wasRegenerated = false;

  while (retries < maxRetries) {
    const validation = validateDocument(currentContent, documentType);

    if (validation.isValid) {
      return {
        content: currentContent,
        validation,
        wasRegenerated,
        retries,
      };
    }

    // Se há erros e função de regeneração foi fornecida
    if (regenerateFn && retries < maxRetries - 1) {
      console.warn(
        `[AI Output Validation] Documento inválido (tentativa ${retries + 1}/${maxRetries}):`,
        validation.errors
      );

      // Gerar feedback para IA
      const feedback = `
O documento gerado está inválido. Corrija os seguintes problemas:

${validation.errors.map(e => `- ${e}`).join('\n')}

${validation.warnings.length > 0 ? `\nAvisos:\n${validation.warnings.map(w => `- ${w}`).join('\n')}` : ''}

Gere novamente o documento em formato Markdown válido, incluindo todas as seções obrigatórias.
      `.trim();

      // Tentar regenerar
      currentContent = await regenerateFn(feedback);
      wasRegenerated = true;
      retries++;
    } else {
      // Sem função de regeneração ou máximo de tentativas atingido
      throw new Error(
        `Documento inválido:\n${validation.errors.join('\n')}`
      );
    }
  }

  // Se chegou aqui, todas as tentativas falharam
  const finalValidation = validateDocument(currentContent, documentType);
  throw new Error(
    `Falha ao gerar documento válido após ${maxRetries} tentativas:\n${finalValidation.errors.join('\n')}`
  );
}

/**
 * Configuração de temperatura por tipo de documento
 * 
 * Correção da Auditoria Técnica - Item 6.3 (Prioridade 65/100)
 */
export const TEMPERATURE_CONFIG: Record<string, number> = {
  etp: 0.5,        // Estudo Técnico: moderado
  tr: 0.4,         // Termo de Referência: baixo
  dfd: 0.4,        // DFD: baixo
  edital: 0.3,     // Edital: muito baixo (preciso)
  parecer: 0.2,    // Parecer Jurídico: mínimo (sem criatividade)
  contrato: 0.2,   // Contratos: mínimo
  default: 0.5,    // Padrão para outros tipos
};

/**
 * Obtém temperatura adequada para tipo de documento
 */
export function getTemperatureForDocument(documentType: string): number {
  return TEMPERATURE_CONFIG[documentType.toLowerCase()] || TEMPERATURE_CONFIG.default;
}

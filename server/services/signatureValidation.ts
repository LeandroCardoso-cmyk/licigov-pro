/**
 * Validação de Assinaturas Digitais
 * 
 * Implementa validações de integridade e segurança para assinaturas digitais
 * conforme identificado na Auditoria Técnica (Itens 1.1, 1.2, 1.3)
 */

import crypto from 'crypto';

/**
 * Gera hash SHA-256 do conteúdo do documento
 * 
 * AUDITORIA TÉCNICA - Item 1.1: Validação de Integridade
 * 
 * @param content - Conteúdo do documento em texto
 * @returns Hash SHA-256 em formato hexadecimal
 */
export function generateDocumentHash(content: string): string {
  return crypto
    .createHash('sha256')
    .update(content, 'utf8')
    .digest('hex');
}

/**
 * Valida se o documento não foi alterado após assinatura
 * 
 * AUDITORIA TÉCNICA - Item 1.1: Validação de Integridade Documental
 * 
 * Compara o hash atual do documento com o hash armazenado na primeira assinatura.
 * Se forem diferentes, o documento foi alterado e a assinatura é inválida.
 * 
 * @param currentContent - Conteúdo atual do documento
 * @param originalHash - Hash armazenado na primeira assinatura
 * @returns Resultado da validação
 */
export function validateDocumentIntegrity(
  currentContent: string,
  originalHash: string
): {
  isValid: boolean;
  currentHash: string;
  tampered: boolean;
  error?: string;
} {
  const currentHash = generateDocumentHash(currentContent);
  const tampered = currentHash !== originalHash;
  
  return {
    isValid: !tampered,
    currentHash,
    tampered,
    error: tampered 
      ? 'Documento foi alterado após assinatura. Hash não corresponde ao original.'
      : undefined,
  };
}

/**
 * Valida se o documento pode ser editado
 * 
 * AUDITORIA TÉCNICA - Item 1.2: Bloqueio de Edição Após Assinatura
 * 
 * RN-022: "Uma vez que um parecer é assinado digitalmente, o documento não pode mais ser editado"
 * 
 * @param signatureCount - Número de assinaturas no documento
 * @returns Se o documento pode ser editado
 */
export function canEditDocument(signatureCount: number): {
  canEdit: boolean;
  reason?: string;
} {
  if (signatureCount > 0) {
    return {
      canEdit: false,
      reason: 'Documento já possui assinaturas digitais e não pode ser editado (RN-022)',
    };
  }
  
  return {
    canEdit: true,
  };
}

/**
 * Valida se uma nova assinatura pode ser adicionada
 * 
 * AUDITORIA TÉCNICA - Item 1.3: Proteção Contra Race Condition
 * 
 * Previne que duas assinaturas sejam adicionadas simultaneamente,
 * o que poderia causar inconsistência nos dados.
 * 
 * @param documentId - ID do documento
 * @param expectedSignatureCount - Número esperado de assinaturas
 * @param actualSignatureCount - Número real de assinaturas no banco
 * @returns Se a assinatura pode ser adicionada
 */
export function validateSignatureSequence(
  documentId: number,
  expectedSignatureCount: number,
  actualSignatureCount: number
): {
  isValid: boolean;
  error?: string;
} {
  if (expectedSignatureCount !== actualSignatureCount) {
    return {
      isValid: false,
      error: `Race condition detectada: esperava ${expectedSignatureCount} assinaturas, mas encontrou ${actualSignatureCount}. Tente novamente.`,
    };
  }
  
  return {
    isValid: true,
  };
}

/**
 * Valida todas as regras de assinatura antes de adicionar nova assinatura
 * 
 * Combina todas as validações em uma única função para facilitar uso
 * 
 * @param params - Parâmetros de validação
 * @returns Resultado consolidado de todas as validações
 */
export function validateBeforeSign(params: {
  documentContent: string;
  currentSignatureCount: number;
  expectedSignatureCount: number;
  originalHash?: string; // Hash da primeira assinatura (se existir)
}): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // 1. Validar integridade (se já houver assinaturas)
  if (params.originalHash) {
    const integrityCheck = validateDocumentIntegrity(
      params.documentContent,
      params.originalHash
    );
    
    if (!integrityCheck.isValid) {
      errors.push(integrityCheck.error!);
    }
  }
  
  // 2. Validar sequência (race condition)
  const sequenceCheck = validateSignatureSequence(
    0, // documentId não é usado na lógica atual
    params.expectedSignatureCount,
    params.currentSignatureCount
  );
  
  if (!sequenceCheck.isValid) {
    errors.push(sequenceCheck.error!);
  }
  
  // 3. Avisos adicionais
  if (params.currentSignatureCount >= 3) {
    warnings.push(
      `Documento já possui ${params.currentSignatureCount} assinaturas. Verifique se todas são necessárias.`
    );
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Valida se documento pode ser exportado
 * 
 * Documentos com assinaturas inválidas não devem ser exportados
 * 
 * @param hasSignatures - Se o documento possui assinaturas
 * @param integrityValid - Se a integridade está válida
 * @returns Se o documento pode ser exportado
 */
export function canExportDocument(
  hasSignatures: boolean,
  integrityValid: boolean
): {
  canExport: boolean;
  warning?: string;
} {
  if (hasSignatures && !integrityValid) {
    return {
      canExport: false,
      warning: 'Documento foi alterado após assinatura e não pode ser exportado. Restaure a versão original.',
    };
  }
  
  return {
    canExport: true,
  };
}

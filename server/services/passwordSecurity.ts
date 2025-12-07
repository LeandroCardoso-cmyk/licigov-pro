/**
 * Módulo de Segurança de Senhas
 * 
 * Correção da Auditoria Técnica - Item 3.1 (Prioridade 80/100)
 * Problema: bcrypt com salt factor 10 é considerado baixo para 2025
 * Solução: Aumentar para salt factor 12 (recomendação OWASP 2024)
 */

import bcrypt from 'bcrypt';

/**
 * Salt rounds recomendado pela OWASP 2024
 * Aumentado de 10 para 12 para maior segurança
 */
export const SALT_ROUNDS = 12;

/**
 * Hash de senha com bcrypt (salt factor 12)
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/**
 * Verificar senha contra hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Verificar se hash precisa ser atualizado (salt factor antigo)
 */
export function needsRehash(hash: string): boolean {
  try {
    // Extrair salt rounds do hash
    const rounds = bcrypt.getRounds(hash);
    return rounds < SALT_ROUNDS;
  } catch {
    return true; // Se não conseguiu extrair, assume que precisa rehash
  }
}

/**
 * Validar força da senha
 */
export interface PasswordStrength {
  isValid: boolean;
  score: number; // 0-5
  feedback: string[];
  requirements: {
    minLength: boolean;
    hasUppercase: boolean;
    hasLowercase: boolean;
    hasNumber: boolean;
    hasSpecialChar: boolean;
  };
}

export function validatePasswordStrength(password: string): PasswordStrength {
  const feedback: string[] = [];
  const requirements = {
    minLength: password.length >= 8,
    hasUppercase: /[A-Z]/.test(password),
    hasLowercase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
  };

  // Calcular score (0-5)
  let score = 0;
  if (requirements.minLength) score++;
  if (requirements.hasUppercase) score++;
  if (requirements.hasLowercase) score++;
  if (requirements.hasNumber) score++;
  if (requirements.hasSpecialChar) score++;

  // Gerar feedback
  if (!requirements.minLength) {
    feedback.push('Senha deve ter no mínimo 8 caracteres');
  }
  if (!requirements.hasUppercase) {
    feedback.push('Senha deve conter pelo menos uma letra maiúscula');
  }
  if (!requirements.hasLowercase) {
    feedback.push('Senha deve conter pelo menos uma letra minúscula');
  }
  if (!requirements.hasNumber) {
    feedback.push('Senha deve conter pelo menos um número');
  }
  if (!requirements.hasSpecialChar) {
    feedback.push('Senha deve conter pelo menos um caractere especial (!@#$%^&*...)');
  }

  // Verificações adicionais
  if (password.length < 12) {
    feedback.push('Recomendado: use pelo menos 12 caracteres para maior segurança');
  }

  // Verificar padrões comuns fracos
  const commonPatterns = [
    '123456',
    'password',
    'qwerty',
    'abc123',
    '111111',
    '123123',
    'admin',
    'letmein',
  ];

  for (const pattern of commonPatterns) {
    if (password.toLowerCase().includes(pattern)) {
      feedback.push('Senha contém padrão comum. Use uma senha mais única.');
      score = Math.max(0, score - 1);
      break;
    }
  }

  const isValid = Object.values(requirements).every(r => r);

  return {
    isValid,
    score,
    feedback,
    requirements,
  };
}

/**
 * Gerar senha aleatória segura
 */
export function generateSecurePassword(length: number = 16): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  const all = uppercase + lowercase + numbers + special;

  let password = '';

  // Garantir pelo menos um de cada tipo
  password += uppercase[Math.floor(Math.random() * uppercase.length)];
  password += lowercase[Math.floor(Math.random() * lowercase.length)];
  password += numbers[Math.floor(Math.random() * numbers.length)];
  password += special[Math.floor(Math.random() * special.length)];

  // Preencher o restante aleatoriamente
  for (let i = password.length; i < length; i++) {
    password += all[Math.floor(Math.random() * all.length)];
  }

  // Embaralhar caracteres
  return password
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

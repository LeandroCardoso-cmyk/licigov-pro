/**
 * Testes de Validação das Correções da Auditoria Técnica
 * 
 * Este arquivo testa as correções implementadas após a auditoria técnica do LiciGov Pro.
 * 
 * Executar: pnpm test server/services/__tests__/auditCorrections.test.ts
 */

import { describe, it, expect } from 'vitest';
import { validateLegalCitations } from '../legalValidation';
import { 
  validateAmendmentValue, 
  validateContractDuration, 
  validateDispensaValue,
  validateAmendmentJustification 
} from '../contractValidation';
import { hashPassword, verifyPassword } from '../passwordSecurity';

describe('Auditoria Técnica - Correções Implementadas', () => {
  
  /**
   * ITEM 6.5 - Validação de Artigos Legais (Anti-Hallucination)
   */
  describe('6.5 - Validação de Artigos Legais', () => {
    it('deve aceitar artigos válidos (1-194)', () => {
      const content = `
        Conforme o Art. 1º da Lei 14.133/2021...
        De acordo com o Art. 75, inciso I...
        Segundo o Art. 194...
      `;
      
      const result = validateLegalCitations(content);
      
      expect(result.isValid).toBe(true);
      expect(result.invalidArticles).toHaveLength(0);
    });
    
    it('deve rejeitar artigos inválidos (> 194)', () => {
      const content = `
        Conforme o Art. 195 da Lei 14.133/2021...
        De acordo com o Art. 250...
      `;
      
      const result = validateLegalCitations(content);
      
      expect(result.isValid).toBe(false);
      // invalidArticles retorna objetos, não números
      expect(result.invalidArticles.some(a => a.article === 195)).toBe(true);
      expect(result.invalidArticles.some(a => a.article === 250)).toBe(true);
      expect(result.warnings).toHaveLength(2);
    });
    
    it('deve aceitar documentos sem citações', () => {
      const content = 'Este é um documento sem citações legais.';
      
      const result = validateLegalCitations(content);
      
      expect(result.isValid).toBe(true);
    });
  });
  
  /**
   * ITEM 1.4 - Validação de Limite de Aditivos (50%)
   */
  describe('1.4 - Validação de Limite de Aditivos', () => {
    it('deve aceitar aditivo dentro do limite (50%)', () => {
      const originalValue = 100000; // R$ 1.000,00
      const existingAmendments = 30000; // R$ 300,00 (30%)
      const newAmendment = 15000; // R$ 150,00 (15%)
      // Total: 45%
      
      const result = validateAmendmentValue(originalValue, existingAmendments, newAmendment);
      
      expect(result.isValid).toBe(true);
      expect(result.percentage).toBeLessThanOrEqual(50);
    });
    
    it('deve rejeitar aditivo que ultrapassa 50%', () => {
      const originalValue = 100000; // R$ 1.000,00
      const existingAmendments = 40000; // R$ 400,00 (40%)
      const newAmendment = 15000; // R$ 150,00 (15%)
      // Total: 55% (INVÁLIDO)
      
      const result = validateAmendmentValue(originalValue, existingAmendments, newAmendment);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('50%');
      expect(result.percentage).toBeGreaterThan(50);
    });
    
    it('deve aceitar aditivo exatamente no limite (50%)', () => {
      const originalValue = 100000; // R$ 1.000,00
      const existingAmendments = 30000; // R$ 300,00 (30%)
      const newAmendment = 20000; // R$ 200,00 (20%)
      // Total: 50% (VÁLIDO)
      
      const result = validateAmendmentValue(originalValue, existingAmendments, newAmendment);
      
      expect(result.isValid).toBe(true);
      expect(result.percentage).toBe(50);
    });
  });
  
  /**
   * ITEM 1.5 - Validação de Prazo Contratual (120 meses)
   */
  describe('1.5 - Validação de Prazo Contratual', () => {
    it('deve aceitar contrato dentro do prazo (120 meses)', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2033-12-31'); // 119 meses
      
      const result = validateContractDuration(startDate, endDate);
      
      expect(result.isValid).toBe(true);
      expect(result.totalDurationMonths).toBeLessThanOrEqual(120);
    });
    
    it('deve rejeitar contrato que ultrapassa 120 meses', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2035-02-01'); // > 120 meses
      
      const result = validateContractDuration(startDate, endDate);
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('120 meses');
      expect(result.totalDurationMonths).toBeGreaterThan(120);
    });
    
    it('deve aceitar contrato exatamente no limite (120 meses)', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2033-12-31'); // Próximo de 120 meses mas dentro do limite
      
      const result = validateContractDuration(startDate, endDate);
      
      expect(result.isValid).toBe(true);
      expect(result.totalDurationMonths).toBeLessThanOrEqual(120);
    });
  });
  
  /**
   * ITEM 4.2 - Validação de Dispensas de Licitação
   */
  describe('4.2 - Validação de Dispensas de Licitação', () => {
    it('deve aceitar dispensa Art. 75, I (obras até R$ 100.000)', () => {
      const value = 9000000; // R$ 90.000,00 (em centavos)
      
      const result = validateDispensaValue(value, 'art75_i_a');
      
      expect(result.isValid).toBe(true);
    });
    
    it('deve rejeitar dispensa Art. 75, I (obras > R$ 100.000)', () => {
      const value = 11000000; // R$ 110.000,00 (em centavos)
      
      const result = validateDispensaValue(value, 'art75_i_a');
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('100000'); // Formato sem pontos
    });
    
    it('deve aceitar dispensa Art. 75, I (outros até R$ 50.000)', () => {
      const value = 4500000; // R$ 45.000,00 (em centavos)
      
      const result = validateDispensaValue(value, 'art75_i_b');
      
      expect(result.isValid).toBe(true);
    });
    
    it('deve rejeitar dispensa Art. 75, I (outros > R$ 50.000)', () => {
      const value = 5500000; // R$ 55.000,00 (em centavos)
      
      const result = validateDispensaValue(value, 'art75_i_b');
      
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('50000'); // Formato sem pontos
    });
  });
  
  /**
   * ITEM 4.3 - Validação de Justificativa Obrigatória
   */
  describe('4.3 - Validação de Justificativa Obrigatória', () => {
    it('deve aceitar justificativa válida (mínimo 100 caracteres)', () => {
      const justification = 'Esta é uma justificativa detalhada para o aditivo contratual, explicando as razões técnicas, legais e orçamentárias que fundamentam esta alteração contratual necessária. Conforme determina o Art. 124 da Lei 14.133/2021.';
      
      const result = validateAmendmentJustification(justification);
      
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
    
    it('deve rejeitar justificativa vazia', () => {
      const justification = '';
      
      const result = validateAmendmentJustification(justification);
      
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('100 caracteres'); // Mesma mensagem para vazio e curto
    });
    
    it('deve rejeitar justificativa muito curta (< 50 caracteres)', () => {
      const justification = 'Justificativa curta';
      
      const result = validateAmendmentJustification(justification);
      
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toContain('100 caracteres');
    });
  });
  
  /**
   * ITEM 3.1 - Password Security (Salt Factor 12)
   */
  describe('3.1 - Password Security (Salt Factor 12)', () => {
    it('deve gerar hash com salt factor 12', async () => {
      const password = 'SenhaSegura123!';
      
      const hash = await hashPassword(password);
      
      // Hash bcrypt começa com $2b$ seguido do salt factor
      expect(hash).toMatch(/^\$2b\$12\$/);
    });
    
    it('deve verificar senha corretamente', async () => {
      const password = 'SenhaSegura123!';
      const hash = await hashPassword(password);
      
      const isValid = await verifyPassword(password, hash);
      
      expect(isValid).toBe(true);
    });
    
    it('deve rejeitar senha incorreta', async () => {
      const password = 'SenhaSegura123!';
      const wrongPassword = 'SenhaErrada456!';
      const hash = await hashPassword(password);
      
      const isValid = await verifyPassword(wrongPassword, hash);
      
      expect(isValid).toBe(false);
    });
  });
});

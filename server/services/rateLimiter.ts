/**
 * Módulo de Rate Limiting
 * 
 * Correção da Auditoria Técnica - Item 3.2 (Prioridade 85/100)
 * Problema: Ausência de rate limiting em procedures críticas
 * Solução: Implementar rate limiting para proteger contra DoS e abuso de IA
 */

import { TRPCError } from '@trpc/server';

/**
 * Armazenamento em memória para rate limiting
 * Em produção, usar Redis para persistência entre instâncias
 */
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Configuração de limites por tipo de operação
 */
export const RATE_LIMITS = {
  // Assinaturas digitais: 10 por 15 minutos
  signature: {
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: 'Muitas tentativas de assinatura. Tente novamente em 15 minutos.',
  },

  // Geração de documentos com IA: 50 por hora
  documentGeneration: {
    windowMs: 60 * 60 * 1000,
    max: 50,
    message: 'Limite de gerações de documentos atingido. Tente novamente em 1 hora.',
  },

  // API geral: 100 requisições por minuto
  api: {
    windowMs: 60 * 1000,
    max: 100,
    message: 'Muitas requisições. Tente novamente em 1 minuto.',
  },

  // Login: 5 tentativas por 15 minutos
  login: {
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
  },

  // Exportação de documentos: 30 por hora
  export: {
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: 'Limite de exportações atingido. Tente novamente em 1 hora.',
  },
};

/**
 * Verifica e aplica rate limiting
 */
export function checkRateLimit(
  identifier: string,
  limitType: keyof typeof RATE_LIMITS
): { allowed: boolean; remaining: number; resetAt: number } {
  const config = RATE_LIMITS[limitType];
  const key = `${limitType}:${identifier}`;
  const now = Date.now();

  // Buscar entrada existente
  let entry = rateLimitStore.get(key);

  // Se não existe ou expirou, criar nova
  if (!entry || now > entry.resetAt) {
    entry = {
      count: 0,
      resetAt: now + config.windowMs,
    };
    rateLimitStore.set(key, entry);
  }

  // Incrementar contador
  entry.count++;

  // Verificar se excedeu limite
  const allowed = entry.count <= config.max;
  const remaining = Math.max(0, config.max - entry.count);

  return {
    allowed,
    remaining,
    resetAt: entry.resetAt,
  };
}

/**
 * Middleware para tRPC procedures
 */
export function rateLimitMiddleware(limitType: keyof typeof RATE_LIMITS) {
  return async (opts: { ctx: { user?: { id: number }; req: any }; next: () => Promise<any> }) => {
    const limitConfig = RATE_LIMITS[limitType];
    
    // Usar ID do usuário ou IP como identificador
    const identifier = opts.ctx.user?.id?.toString() || 
                      opts.ctx.req?.ip || 
                      opts.ctx.req?.headers?.['x-forwarded-for'] || 
                      'anonymous';

    const result = checkRateLimit(identifier, limitType);

    if (!result.allowed) {
      const resetIn = Math.ceil((result.resetAt - Date.now()) / 1000 / 60); // minutos

      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `${limitConfig.message} (Tente novamente em ${resetIn} minutos)`,
      });
    }

    // Adicionar headers de rate limit na resposta
    if (opts.ctx.req?.res) {
      opts.ctx.req.res.setHeader('X-RateLimit-Limit', limitConfig.max.toString());
      opts.ctx.req.res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      opts.ctx.req.res.setHeader('X-RateLimit-Reset', result.resetAt.toString());
    }

    return opts.next();
  };
}

/**
 * Limpar entradas expiradas periodicamente
 */
export function cleanupExpiredEntries() {
  const now = Date.now();
  let cleaned = 0;

  const entries = Array.from(rateLimitStore.entries());
  for (const [key, entry] of entries) {
    if (now > entry.resetAt) {
      rateLimitStore.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[Rate Limiter] Limpou ${cleaned} entradas expiradas`);
  }
}

// Executar limpeza a cada 5 minutos
setInterval(cleanupExpiredEntries, 5 * 60 * 1000);

/**
 * Resetar rate limit para um identificador específico
 * Útil para testes ou casos excepcionais
 */
export function resetRateLimit(
  identifier: string,
  limitType: keyof typeof RATE_LIMITS
) {
  const key = `${limitType}:${identifier}`;
  rateLimitStore.delete(key);
}

/**
 * Obter estatísticas de rate limiting
 */
export function getRateLimitStats(
  identifier: string,
  limitType: keyof typeof RATE_LIMITS
): { count: number; limit: number; remaining: number; resetAt: number } | null {
  const limitConfig = RATE_LIMITS[limitType];
  const key = `${limitType}:${identifier}`;
  const entry = rateLimitStore.get(key);

  if (!entry) {
    return null;
  }

  return {
    count: entry.count,
    limit: limitConfig.max,
    remaining: Math.max(0, limitConfig.max - entry.count),
    resetAt: entry.resetAt,
  };
}

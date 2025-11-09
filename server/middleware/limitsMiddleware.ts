import { TRPCError } from '@trpc/server';
import * as db from '../db';

/**
 * Verificar se usuário pode criar um novo processo
 */
export async function checkProcessLimit(userId: number): Promise<void> {
  const subscription = await db.getUserSubscription(userId);
  
  if (!subscription || subscription.status !== 'active') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Você precisa de uma assinatura ativa para criar processos',
    });
  }

  const plan = await db.getSubscriptionPlanById(subscription.planId);
  if (!plan) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Plano de assinatura não encontrado',
    });
  }

  // Se o plano tem processos ilimitados (-1), liberar
  if (plan.maxProcessesPerMonth === -1) {
    return;
  }

  const usage = await db.getCurrentMonthUsage(userId);
  const processesUsed = usage?.processesCreated || 0;

  if (processesUsed >= plan.maxProcessesPerMonth) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Você atingiu o limite de ${plan.maxProcessesPerMonth} processos por mês do seu plano. Faça upgrade para criar mais processos.`,
    });
  }
}

/**
 * Verificar se usuário pode adicionar mais membros
 */
export async function checkUserLimit(userId: number, currentUserCount: number): Promise<void> {
  const subscription = await db.getUserSubscription(userId);
  
  if (!subscription || subscription.status !== 'active') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Você precisa de uma assinatura ativa para adicionar membros',
    });
  }

  const plan = await db.getSubscriptionPlanById(subscription.planId);
  if (!plan) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Plano de assinatura não encontrado',
    });
  }

  // Se o plano tem usuários ilimitados (-1), liberar
  if (plan.maxUsers === -1) {
    return;
  }

  if (currentUserCount >= plan.maxUsers) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Você atingiu o limite de ${plan.maxUsers} usuários do seu plano. Faça upgrade para adicionar mais membros.`,
    });
  }
}

/**
 * Verificar se usuário pode fazer upload (limite de armazenamento)
 */
export async function checkStorageLimit(userId: number, fileSizeMB: number): Promise<void> {
  const subscription = await db.getUserSubscription(userId);
  
  if (!subscription || subscription.status !== 'active') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Você precisa de uma assinatura ativa para fazer upload de arquivos',
    });
  }

  const plan = await db.getSubscriptionPlanById(subscription.planId);
  if (!plan) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Plano de assinatura não encontrado',
    });
  }

  // Se o plano tem armazenamento ilimitado (-1), liberar
  if (plan.maxStorageGB === -1) {
    return;
  }

  const usage = await db.getCurrentMonthUsage(userId);
  const storageUsedMB = usage?.storageUsedMB || 0;
  const maxStorageMB = plan.maxStorageGB * 1024;

  if (storageUsedMB + fileSizeMB > maxStorageMB) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Você atingiu o limite de ${plan.maxStorageGB}GB de armazenamento do seu plano. Faça upgrade para ter mais espaço.`,
    });
  }
}

/**
 * Verificar se usuário tem acesso a um módulo específico
 */
export async function checkModuleAccess(userId: number, module: string): Promise<void> {
  const subscription = await db.getUserSubscription(userId);
  
  if (!subscription || subscription.status !== 'active') {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Você precisa de uma assinatura ativa para acessar este módulo',
    });
  }

  const plan = await db.getSubscriptionPlanById(subscription.planId);
  if (!plan) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Plano de assinatura não encontrado',
    });
  }

  const moduleAccess: Record<string, boolean> = {
    'document_generation': plan.hasDocumentGeneration,
    'direct_contracting': plan.hasDirectContracting,
    'legal_opinion': plan.hasLegalOpinion,
    'pca': plan.hasPCA,
    'contracts': plan.hasContracts,
    'department_management': plan.hasDepartmentManagement,
    'collaboration': plan.hasCollaboration,
    'comments': plan.hasComments,
    'versioning': plan.hasVersioning,
  };

  if (!moduleAccess[module]) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `Este módulo não está disponível no seu plano. Faça upgrade para ter acesso.`,
    });
  }
}

/**
 * Obter informações de uso e limites do usuário
 */
export async function getUserLimitsInfo(userId: number) {
  const subscription = await db.getUserSubscription(userId);
  
  if (!subscription || subscription.status !== 'active') {
    return {
      hasActiveSubscription: false,
      plan: null,
      usage: null,
      limits: null,
    };
  }

  const plan = await db.getSubscriptionPlanById(subscription.planId);
  const usage = await db.getCurrentMonthUsage(userId);

  return {
    hasActiveSubscription: true,
    plan: {
      name: plan?.name || 'Desconhecido',
      maxProcessesPerMonth: plan?.maxProcessesPerMonth || 0,
      maxUsers: plan?.maxUsers || 0,
      maxStorageGB: plan?.maxStorageGB || 0,
    },
    usage: {
      processesCreated: usage?.processesCreated || 0,
      storageUsedMB: usage?.storageUsedMB || 0,
      activeUsers: usage?.activeUsers || 0,
    },
    limits: {
      processesRemaining: plan?.maxProcessesPerMonth === -1 
        ? 'Ilimitado' 
        : Math.max(0, (plan?.maxProcessesPerMonth || 0) - (usage?.processesCreated || 0)),
      storageRemainingMB: plan?.maxStorageGB === -1 
        ? 'Ilimitado' 
        : Math.max(0, (plan?.maxStorageGB || 0) * 1024 - (usage?.storageUsedMB || 0)),
      usersRemaining: plan?.maxUsers === -1 
        ? 'Ilimitado' 
        : Math.max(0, (plan?.maxUsers || 0) - (usage?.activeUsers || 0)),
    },
  };
}

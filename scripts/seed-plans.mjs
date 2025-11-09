/**
 * Script para popular planos de assinatura no banco de dados
 * 
 * IMPORTANTE: Execute este script ANTES de lançar em produção
 * 
 * Como executar:
 * node scripts/seed-plans.mjs
 */

import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

// Conectar ao banco
const connection = await mysql.createConnection(process.env.DATABASE_URL);
const db = drizzle(connection);

const plans = [
  {
    name: 'Individual',
    slug: 'individual',
    description: 'Para servidores públicos que querem usar a plataforma individualmente',
    price: 9700, // R$ 97,00 em centavos
    stripePriceId: null, // Preencher depois de criar no Stripe
    maxUsers: 1,
    maxProcessesPerMonth: 10,
    maxStorageGB: 2,
    hasDocumentGeneration: true,
    hasDirectContracting: false,
    hasLegalOpinion: false,
    hasPCA: false,
    hasContracts: false,
    hasDepartmentManagement: false,
    hasCollaboration: false,
    hasComments: true,
    hasVersioning: true,
    hasPrioritySupport: false,
    hasSLA: false,
    isActive: true,
  },
  {
    name: 'Municipal Básico',
    slug: 'municipal-basico',
    description: 'Para municípios até 15 mil habitantes',
    price: 39900, // R$ 399,00
    stripePriceId: null,
    maxUsers: 10,
    maxProcessesPerMonth: 100,
    maxStorageGB: 20,
    hasDocumentGeneration: true,
    hasDirectContracting: false,
    hasLegalOpinion: false,
    hasPCA: false,
    hasContracts: false,
    hasDepartmentManagement: false,
    hasCollaboration: true,
    hasComments: true,
    hasVersioning: true,
    hasPrioritySupport: false,
    hasSLA: false,
    isActive: true,
  },
  {
    name: 'Municipal Intermediário',
    slug: 'municipal-intermediario',
    description: 'Para municípios de 15 a 50 mil habitantes',
    price: 99900, // R$ 999,00
    stripePriceId: null,
    maxUsers: 25,
    maxProcessesPerMonth: 300,
    maxStorageGB: 100,
    hasDocumentGeneration: true,
    hasDirectContracting: true,
    hasLegalOpinion: true,
    hasPCA: true,
    hasContracts: false,
    hasDepartmentManagement: true,
    hasCollaboration: true,
    hasComments: true,
    hasVersioning: true,
    hasPrioritySupport: true,
    hasSLA: false,
    isActive: true,
  },
  {
    name: 'Municipal Completo',
    slug: 'municipal-completo',
    description: 'Para municípios acima de 50 mil habitantes',
    price: 249900, // R$ 2.499,00
    stripePriceId: null,
    maxUsers: -1, // Ilimitado
    maxProcessesPerMonth: -1, // Ilimitado
    maxStorageGB: 500,
    hasDocumentGeneration: true,
    hasDirectContracting: true,
    hasLegalOpinion: true,
    hasPCA: true,
    hasContracts: true,
    hasDepartmentManagement: true,
    hasCollaboration: true,
    hasComments: true,
    hasVersioning: true,
    hasPrioritySupport: true,
    hasSLA: true,
    isActive: true,
  },
];

console.log('🌱 Populando planos de assinatura...\n');

for (const plan of plans) {
  try {
    await db.execute(`
      INSERT INTO subscription_plans (
        name, slug, description, price, stripePriceId,
        maxUsers, maxProcessesPerMonth, maxStorageGB,
        hasDocumentGeneration, hasDirectContracting, hasLegalOpinion,
        hasPCA, hasContracts, hasDepartmentManagement,
        hasCollaboration, hasComments, hasVersioning,
        hasPrioritySupport, hasSLA, isActive
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        description = VALUES(description),
        price = VALUES(price),
        maxUsers = VALUES(maxUsers),
        maxProcessesPerMonth = VALUES(maxProcessesPerMonth),
        maxStorageGB = VALUES(maxStorageGB),
        hasDocumentGeneration = VALUES(hasDocumentGeneration),
        hasDirectContracting = VALUES(hasDirectContracting),
        hasLegalOpinion = VALUES(hasLegalOpinion),
        hasPCA = VALUES(hasPCA),
        hasContracts = VALUES(hasContracts),
        hasDepartmentManagement = VALUES(hasDepartmentManagement),
        hasCollaboration = VALUES(hasCollaboration),
        hasComments = VALUES(hasComments),
        hasVersioning = VALUES(hasVersioning),
        hasPrioritySupport = VALUES(hasPrioritySupport),
        hasSLA = VALUES(hasSLA),
        isActive = VALUES(isActive)
    `, [
      plan.name,
      plan.slug,
      plan.description,
      plan.price,
      plan.stripePriceId,
      plan.maxUsers,
      plan.maxProcessesPerMonth,
      plan.maxStorageGB,
      plan.hasDocumentGeneration,
      plan.hasDirectContracting,
      plan.hasLegalOpinion,
      plan.hasPCA,
      plan.hasContracts,
      plan.hasDepartmentManagement,
      plan.hasCollaboration,
      plan.hasComments,
      plan.hasVersioning,
      plan.hasPrioritySupport,
      plan.hasSLA,
      plan.isActive,
    ]);

    const priceInReais = (plan.price / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });

    console.log(`✅ ${plan.name} - ${priceInReais}/mês`);
  } catch (error) {
    console.error(`❌ Erro ao criar plano ${plan.name}:`, error.message);
  }
}

console.log('\n🎉 Planos populados com sucesso!');
console.log('\n📝 Próximos passos:');
console.log('1. Criar produtos no Stripe Dashboard');
console.log('2. Copiar os Price IDs do Stripe');
console.log('3. Atualizar stripePriceId de cada plano no banco');
console.log('4. Testar checkout em modo de teste');

await connection.end();

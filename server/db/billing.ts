import { eq, and, desc, gte } from "drizzle-orm";
import {
  subscriptionPlans, subscriptions, usageTracking, payments, contractRenewals,
  users, InsertSubscriptionPlan, InsertSubscription, InsertPayment,
} from "../../drizzle/schema";
import { getDb } from "./connection";

export async function createSubscriptionPlan(plan: InsertSubscriptionPlan) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(subscriptionPlans).values(plan);
}

export async function getAllSubscriptionPlans() {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.isActive, true))
    .orderBy(subscriptionPlans.price);
}

export async function getSubscriptionPlanById(planId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, planId))
    .limit(1);
  return result[0];
}

export async function getSubscriptionPlanBySlug(slug: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(subscriptionPlans)
    .where(eq(subscriptionPlans.slug, slug))
    .limit(1);
  return result[0];
}

export async function createSubscription(subscription: InsertSubscription) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db.insert(subscriptions).values(subscription);
}

export async function getUserSubscription(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return result[0];
}

export async function updateSubscription(subscriptionId: number, data: Partial<InsertSubscription>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(subscriptions).set(data).where(eq(subscriptions.id, subscriptionId));
}

export async function getSubscriptionByStripeId(stripeSubscriptionId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1);
  return result[0];
}

export async function getAllSubscriptionsWithDetails() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db
    .select({
      id: subscriptions.id, userId: subscriptions.userId, planId: subscriptions.planId,
      status: subscriptions.status, currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      stripeCustomerId: subscriptions.stripeCustomerId,
      userName: users.name, userEmail: users.email,
      planName: subscriptionPlans.name, planPrice: subscriptionPlans.price,
    })
    .from(subscriptions)
    .leftJoin(users, eq(subscriptions.userId, users.id))
    .leftJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id));
}

export async function getCurrentMonthUsage(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const result = await db
    .select()
    .from(usageTracking)
    .where(and(eq(usageTracking.userId, userId), eq(usageTracking.month, currentMonth)))
    .limit(1);
  return result[0];
}

export async function incrementProcessCount(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const existing = await getCurrentMonthUsage(userId);
  if (existing) {
    await db
      .update(usageTracking)
      .set({ processesCreated: existing.processesCreated + 1 })
      .where(eq(usageTracking.id, existing.id));
  } else {
    await db
      .insert(usageTracking)
      .values({ userId, month: currentMonth, processesCreated: 1, storageUsedMB: 0, activeUsers: 1 });
  }
}

export async function updateStorageUsage(userId: number, storageMB: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const existing = await getCurrentMonthUsage(userId);
  if (existing) {
    await db
      .update(usageTracking)
      .set({ storageUsedMB: storageMB })
      .where(eq(usageTracking.id, existing.id));
  } else {
    await db
      .insert(usageTracking)
      .values({ userId, month: currentMonth, processesCreated: 0, storageUsedMB: storageMB, activeUsers: 1 });
  }
}

export async function createPayment(payment: InsertPayment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(payments).values(payment);
}

export async function getUserPayments(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return await db
    .select()
    .from(payments)
    .where(eq(payments.userId, userId))
    .orderBy(desc(payments.createdAt));
}

export async function updatePaymentStatus(
  paymentIntentId: string,
  status: "succeeded" | "failed" | "refunded",
  paidAt?: Date
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateData: any = { status };
  if (paidAt) updateData.paidAt = paidAt;
  await db
    .update(payments)
    .set(updateData)
    .where(eq(payments.stripePaymentIntentId, paymentIntentId));
}

export async function renewContract(
  subscriptionId: number,
  renewedBy: number,
  termoAditivoFileUrl?: string,
  termoAditivoFileKey?: string,
  numeroEmpenho?: string,
  valorRenovacao?: number,
  observacoes?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const subscription = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);

  if (subscription.length === 0) throw new Error("Assinatura não encontrada");

  const sub = subscription[0];
  if (sub.renewalCount >= 9) throw new Error("Limite máximo de renovações atingido (9 renovações = 10 anos total)");

  const previousEndDate = sub.currentPeriodEnd || new Date();
  const newEndDate = new Date(previousEndDate);
  newEndDate.setFullYear(newEndDate.getFullYear() + 1);
  const newRenewalCount = sub.renewalCount + 1;

  await db
    .update(subscriptions)
    .set({
      currentPeriodEnd: newEndDate, renewalCount: newRenewalCount, lastRenewalDate: new Date(),
      originalStartDate: sub.originalStartDate || sub.currentPeriodStart, updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscriptionId));

  await db.insert(contractRenewals).values({
    subscriptionId, renewalNumber: newRenewalCount, previousEndDate, newEndDate,
    termoAditivoFileUrl, termoAditivoFileKey, numeroEmpenho, valorRenovacao, renewedBy, observacoes,
  });

  return { success: true, newEndDate, renewalNumber: newRenewalCount };
}

export async function getContractRenewals(subscriptionId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return await db
    .select()
    .from(contractRenewals)
    .where(eq(contractRenewals.subscriptionId, subscriptionId))
    .orderBy(desc(contractRenewals.createdAt));
}

export async function canRenewContract(subscriptionId: number): Promise<{ canRenew: boolean; reason?: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const subscription = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);

  if (subscription.length === 0) return { canRenew: false, reason: "Assinatura não encontrada" };

  const sub = subscription[0];
  if (sub.stripeSubscriptionId) return { canRenew: false, reason: "Apenas assinaturas via empenho podem ser renovadas" };
  if (sub.renewalCount >= 9) return { canRenew: false, reason: "Limite máximo de 9 renovações atingido (10 anos total)" };
  if (sub.status !== "active") return { canRenew: false, reason: "Apenas assinaturas ativas podem ser renovadas" };

  return { canRenew: true };
}

export async function getContractsNearLimit() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const contracts = await db
    .select({
      id: subscriptions.id, userId: subscriptions.userId, planId: subscriptions.planId,
      status: subscriptions.status, currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd, renewalCount: subscriptions.renewalCount,
      userName: users.name, userEmail: users.email,
      planName: subscriptionPlans.name, planPrice: subscriptionPlans.price,
    })
    .from(subscriptions)
    .leftJoin(users, eq(subscriptions.userId, users.id))
    .leftJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(and(eq(subscriptions.status, "active"), gte(subscriptions.renewalCount, 7)))
    .orderBy(desc(subscriptions.renewalCount), subscriptions.currentPeriodEnd);

  return {
    contracts,
    total: contracts.length,
    atLimit: contracts.filter((c) => c.renewalCount >= 9).length,
    critical: contracts.filter((c) => c.renewalCount === 8).length,
    warning: contracts.filter((c) => c.renewalCount === 7).length,
  };
}

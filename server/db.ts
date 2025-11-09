import { eq, desc, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, 
  users,
  processes,
  documents,
  editalParameters,
  documentSettings,
  activityLogs,
  processMembers,
  notifications,
  comments,
  userConsents,
  auditLogs,
  subscriptionPlans,
  subscriptions,
  usageTracking,
  payments,
  proposalRequests,
  companyDocuments,
  InsertProcess,
  InsertDocument,
  InsertEditalParameter,
  InsertDocumentSettings,
  InsertActivityLog,
  InsertProcessMember,
  InsertNotification,
  InsertComment,
  InsertUserConsent,
  InsertAuditLog,
  InsertSubscriptionPlan,
  InsertSubscription,
  InsertUsageTracking,
  InsertPayment,
  InsertProposalRequest,
  InsertCompanyDocument
} from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserByEmail(email: string) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Process queries
export async function createProcess(process: InsertProcess) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(processes).values(process);
  return result;
}

export async function getProcessesByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(processes)
    .where(eq(processes.ownerId, userId))
    .orderBy(desc(processes.updatedAt));
}

export async function getProcessById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(processes).where(eq(processes.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function updateProcessStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(processes).set({ status: status as any }).where(eq(processes.id, id));
}

// Document queries
export async function createDocument(document: InsertDocument) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(documents).values(document);
  return result;
}

export async function getDocumentsByProcess(processId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(documents)
    .where(eq(documents.processId, processId))
    .orderBy(desc(documents.createdAt));
}

export async function getDocumentById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function getDocumentByProcessAndType(processId: number, type: string) {
  const db = await getDb();
  if (!db) return undefined;
  

  const result = await db
    .select()
    .from(documents)
    .where(and(
      eq(documents.processId, processId),
      eq(documents.type, type as any)
    ))
    .orderBy(desc(documents.version))
    .limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

export async function getDocumentVersions(processId: number, type: string) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(documents)
    .where(and(
      eq(documents.processId, processId),
      eq(documents.type, type as any)
    ))
    .orderBy(desc(documents.version));
}

// Edital parameters queries
export async function upsertEditalParameters(params: InsertEditalParameter) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(editalParameters).values(params).onDuplicateKeyUpdate({
    set: {
      modalidade: params.modalidade,
      formato: params.formato,
      criterioJulgamento: params.criterioJulgamento,
      regimeContratacao: params.regimeContratacao,
    },
  });
}

export async function getEditalParametersByProcess(processId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db
    .select()
    .from(editalParameters)
    .where(eq(editalParameters.processId, processId))
    .limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

// Activity log queries
export async function createActivityLog(log: InsertActivityLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(activityLogs).values(log);
}

export async function getActivityLogsByProcess(processId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(activityLogs)
    .where(eq(activityLogs.processId, processId))
    .orderBy(desc(activityLogs.createdAt));
}

// Document Settings queries
export async function upsertDocumentSettings(settings: InsertDocumentSettings) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(documentSettings).values(settings).onDuplicateKeyUpdate({
    set: {
      organizationName: settings.organizationName,
      logoUrl: settings.logoUrl,
      address: settings.address,
      cnpj: settings.cnpj,
      phone: settings.phone,
      email: settings.email,
      website: settings.website,
      footerText: settings.footerText,
    },
  });
}

export async function getDocumentSettingsByUser(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db
    .select()
    .from(documentSettings)
    .where(eq(documentSettings.userId, userId))
    .limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

// Process Members (Collaboration) queries
export async function addProcessMember(member: InsertProcessMember) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(processMembers).values(member);
}

export async function removeProcessMember(processId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .delete(processMembers)
    .where(and(
      eq(processMembers.processId, processId),
      eq(processMembers.userId, userId)
    ));
}

export async function updateProcessMemberPermission(
  processId: number, 
  userId: number, 
  permission: "viewer" | "editor" | "approver" | "owner"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(processMembers)
    .set({ permission })
    .where(and(
      eq(processMembers.processId, processId),
      eq(processMembers.userId, userId)
    ));
}

export async function getProcessMembers(processId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select({
      id: processMembers.id,
      userId: processMembers.userId,
      permission: processMembers.permission,
      invitedBy: processMembers.invitedBy,
      createdAt: processMembers.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(processMembers)
    .leftJoin(users, eq(processMembers.userId, users.id))
    .where(eq(processMembers.processId, processId))
    .orderBy(desc(processMembers.createdAt));
}

export async function getProcessMember(processId: number, userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db
    .select()
    .from(processMembers)
    .where(and(
      eq(processMembers.processId, processId),
      eq(processMembers.userId, userId)
    ))
    .limit(1);
  
  return result.length > 0 ? result[0] : undefined;
}

export async function getUserProcesses(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  // Get processes where user is owner OR member
  const ownedProcesses = await db
    .select()
    .from(processes)
    .where(eq(processes.ownerId, userId))
    .orderBy(desc(processes.updatedAt));
  
  const memberProcessIds = await db
    .select({ processId: processMembers.processId })
    .from(processMembers)
    .where(eq(processMembers.userId, userId));
  
  if (memberProcessIds.length === 0) {
    return ownedProcesses;
  }
  
  const memberProcesses = await db
    .select()
    .from(processes)
    .where(
      and(
        ...memberProcessIds.map(m => eq(processes.id, m.processId))
      )
    )
    .orderBy(desc(processes.updatedAt));
  
  // Merge and deduplicate
  const allProcesses = [...ownedProcesses, ...memberProcesses];
  const uniqueProcesses = Array.from(
    new Map(allProcesses.map(p => [p.id, p])).values()
  );
  
  return uniqueProcesses;
}

// Notifications queries
export async function createNotification(notification: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(notifications).values(notification);
}

export async function getUserNotifications(userId: number, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function getUnreadNotificationsCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db
    .select()
    .from(notifications)
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false)
    ));
  
  return result.length;
}

export async function markNotificationAsRead(notificationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(eq(notifications.id, notificationId));
}

export async function markAllNotificationsAsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.isRead, false)
    ));
}

// ==================== COMENTÁRIOS ====================

export async function createComment(comment: InsertComment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(comments).values(comment);
}

export async function getCommentsByDocument(documentId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(comments)
    .where(eq(comments.documentId, documentId))
    .orderBy(desc(comments.createdAt));
}

export async function updateComment(commentId: number, content: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(comments)
    .set({ content, updatedAt: new Date() })
    .where(eq(comments.id, commentId));
}

export async function deleteComment(commentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(comments).where(eq(comments.id, commentId));
}

export async function getCommentById(commentId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ==================== LGPD - CONSENTIMENTOS ====================

export async function createUserConsent(consent: InsertUserConsent) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(userConsents).values(consent);
}

export async function getUserConsents(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(userConsents)
    .where(eq(userConsents.userId, userId))
    .orderBy(desc(userConsents.createdAt));
}

export async function hasUserAcceptedConsent(userId: number, consentType: string, version: string) {
  const db = await getDb();
  if (!db) return false;
  
  const result = await db
    .select()
    .from(userConsents)
    .where(and(
      eq(userConsents.userId, userId),
      eq(userConsents.consentType, consentType as any),
      eq(userConsents.version, version),
      eq(userConsents.accepted, true)
    ))
    .limit(1);
  
  return result.length > 0;
}

// ==================== LGPD - EXCLUSÃO DE DADOS ====================

export async function deleteUserData(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Deletar em cascata: comentários, notificações, membros, atividades, documentos, processos
  await db.delete(comments).where(eq(comments.userId, userId));
  await db.delete(notifications).where(eq(notifications.userId, userId));
  await db.delete(processMembers).where(eq(processMembers.userId, userId));
  await db.delete(activityLogs).where(eq(activityLogs.userId, userId));
  
  // Deletar processos e seus documentos
  const userProcesses = await db.select().from(processes).where(eq(processes.userId, userId));
  for (const process of userProcesses) {
    await db.delete(documents).where(eq(documents.processId, process.id));
    await db.delete(editalParameters).where(eq(editalParameters.processId, process.id));
  }
  await db.delete(processes).where(eq(processes.userId, userId));
  
  // Deletar consentimentos
  await db.delete(userConsents).where(eq(userConsents.userId, userId));
  
  // Deletar usuário
  await db.delete(users).where(eq(users.id, userId));
}

export async function exportUserData(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const user = await getUserById(userId);
  const userProcesses = await db.select().from(processes).where(eq(processes.userId, userId));
  const userComments = await db.select().from(comments).where(eq(comments.userId, userId));
  const userNotifications = await db.select().from(notifications).where(eq(notifications.userId, userId));
  const userConsentsData = await getUserConsents(userId);
  const userActivities = await db.select().from(activityLogs).where(eq(activityLogs.userId, userId));
  
  // Buscar documentos de todos os processos
  const allDocuments = [];
  for (const process of userProcesses) {
    const docs = await db.select().from(documents).where(eq(documents.processId, process.id));
    allDocuments.push(...docs);
  }
  
  return {
    user,
    processes: userProcesses,
    documents: allDocuments,
    comments: userComments,
    notifications: userNotifications,
    consents: userConsentsData,
    activities: userActivities,
    exportedAt: new Date().toISOString(),
  };
}

// ==================== ADMIN - GERENCIAMENTO DE USUÁRIOS ====================

export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];
  
  return await db.select().from(users).orderBy(desc(users.createdAt));
}

export async function updateUserRole(userId: number, role: "user" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(users).set({ role }).where(eq(users.id, userId));
}

export async function getUserStats(userId: number) {
  const db = await getDb();
  if (!db) return { processCount: 0, documentCount: 0, commentCount: 0 };
  
  const userProcesses = await db.select().from(processes).where(eq(processes.userId, userId));
  const processIds = userProcesses.map(p => p.id);
  
  let documentCount = 0;
  for (const processId of processIds) {
    const docs = await db.select().from(documents).where(eq(documents.processId, processId));
    documentCount += docs.length;
  }
  
  const userComments = await db.select().from(comments).where(eq(comments.userId, userId));
  
  return {
    processCount: userProcesses.length,
    documentCount,
    commentCount: userComments.length,
  };
}

// ==================== ADMIN - AUDITORIA ====================

export async function createAuditLog(log: InsertAuditLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(auditLogs).values(log);
}

export async function getAuditLogs(limit: number = 100) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(auditLogs)
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}

export async function getAuditLogsByAdmin(adminId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.adminId, adminId))
    .orderBy(desc(auditLogs.createdAt));
}

// ==================== ANALYTICS ====================

export async function getProcessCountByStatus() {
  const db = await getDb();
  if (!db) return [];
  
  const allProcesses = await db.select().from(processes);
  
  const statusCounts: Record<string, number> = {};
  for (const process of allProcesses) {
    statusCounts[process.status] = (statusCounts[process.status] || 0) + 1;
  }
  
  return Object.entries(statusCounts).map(([status, count]) => ({ status, count }));
}

export async function getDocumentCountByMonth(months: number = 6) {
  const db = await getDb();
  if (!db) return [];
  
  const allDocuments = await db.select().from(documents);
  
  const monthCounts: Record<string, number> = {};
  const now = new Date();
  
  for (const doc of allDocuments) {
    const docDate = new Date(doc.createdAt);
    const monthDiff = (now.getFullYear() - docDate.getFullYear()) * 12 + (now.getMonth() - docDate.getMonth());
    
    if (monthDiff < months) {
      const monthKey = `${docDate.getFullYear()}-${String(docDate.getMonth() + 1).padStart(2, '0')}`;
      monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
    }
  }
  
  return Object.entries(monthCounts)
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export async function getMostActiveMembers(limit: number = 10) {
  const db = await getDb();
  if (!db) return [];
  
  const allActivities = await db.select().from(activityLogs);
  
  const userActivityCounts: Record<number, number> = {};
  for (const activity of allActivities) {
    userActivityCounts[activity.userId] = (userActivityCounts[activity.userId] || 0) + 1;
  }
  
  const sortedUsers = Object.entries(userActivityCounts)
    .map(([userId, count]) => ({ userId: parseInt(userId), activityCount: count }))
    .sort((a, b) => b.activityCount - a.activityCount)
    .slice(0, limit);
  
  // Buscar dados dos usuários
  const result = [];
  for (const { userId, activityCount } of sortedUsers) {
    const user = await getUserById(userId);
    if (user) {
      result.push({
        userId: user.id,
        userName: user.name || 'Usuário sem nome',
        userEmail: user.email || '',
        activityCount,
      });
    }
  }
  
  return result;
}

// ==================== BILLING & SUBSCRIPTIONS ====================

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
  
  const result = await db.insert(subscriptions).values(subscription);
  return result;
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
  
  await db
    .update(subscriptions)
    .set(data)
    .where(eq(subscriptions.id, subscriptionId));
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

// ==================== USAGE TRACKING ====================

export async function getCurrentMonthUsage(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const result = await db
    .select()
    .from(usageTracking)
    .where(
      and(
        eq(usageTracking.userId, userId),
        eq(usageTracking.month, currentMonth)
      )
    )
    .limit(1);
  
  return result[0];
}

export async function incrementProcessCount(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const existing = await getCurrentMonthUsage(userId);
  
  if (existing) {
    await db
      .update(usageTracking)
      .set({ processesCreated: existing.processesCreated + 1 })
      .where(eq(usageTracking.id, existing.id));
  } else {
    await db.insert(usageTracking).values({
      userId,
      month: currentMonth,
      processesCreated: 1,
      storageUsedMB: 0,
      activeUsers: 1,
    });
  }
}

export async function updateStorageUsage(userId: number, storageMB: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const existing = await getCurrentMonthUsage(userId);
  
  if (existing) {
    await db
      .update(usageTracking)
      .set({ storageUsedMB: storageMB })
      .where(eq(usageTracking.id, existing.id));
  } else {
    await db.insert(usageTracking).values({
      userId,
      month: currentMonth,
      processesCreated: 0,
      storageUsedMB: storageMB,
      activeUsers: 1,
    });
  }
}

// ==================== PAYMENTS ====================

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

export async function updatePaymentStatus(paymentIntentId: string, status: 'succeeded' | 'failed' | 'refunded', paidAt?: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const updateData: any = { status };
  if (paidAt) {
    updateData.paidAt = paidAt;
  }
  
  await db
    .update(payments)
    .set(updateData)
    .where(eq(payments.stripePaymentIntentId, paymentIntentId));
}

// ============================================================================
// PROPOSAL REQUESTS & COMPANY DOCUMENTS
// ============================================================================

export async function createProposalRequest(data: InsertProposalRequest) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(proposalRequests).values(data);
  return result[0].insertId;
}

export async function getProposalRequestById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db
    .select()
    .from(proposalRequests)
    .where(eq(proposalRequests.id, id))
    .limit(1);
    
  return result[0];
}

export async function getAllProposalRequests() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db
    .select()
    .from(proposalRequests)
    .orderBy(desc(proposalRequests.createdAt));
}

export async function updateProposalRequestStatus(
  id: number,
  status: 'pending' | 'documents_sent' | 'empenho_received' | 'activated' | 'cancelled'
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(proposalRequests)
    .set({ status, updatedAt: new Date() })
    .where(eq(proposalRequests.id, id));
}

export async function updateProposalWithEmpenho(
  id: number,
  numeroEmpenho: string,
  dataEmpenho: Date,
  valorEmpenho: number
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(proposalRequests)
    .set({
      numeroEmpenho,
      dataEmpenho,
      valorEmpenho,
      status: 'empenho_received',
      updatedAt: new Date()
    })
    .where(eq(proposalRequests.id, id));
}

export async function createCompanyDocument(data: InsertCompanyDocument) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(companyDocuments).values(data);
  return result[0].insertId;
}

export async function getAllCompanyDocuments() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db
    .select()
    .from(companyDocuments)
    .orderBy(desc(companyDocuments.createdAt));
}

export async function getCompanyDocumentsByType(type: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  return await db
    .select()
    .from(companyDocuments)
    .where(eq(companyDocuments.type, type as any))
    .orderBy(desc(companyDocuments.version));
}

export async function getLatestCompanyDocuments() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Pegar a versão mais recente de cada tipo de documento
  const allDocs = await db
    .select()
    .from(companyDocuments)
    .orderBy(desc(companyDocuments.version));
  
  // Agrupar por tipo e pegar apenas a primeira (mais recente) de cada tipo
  const latestDocs = new Map();
  for (const doc of allDocs) {
    if (!latestDocs.has(doc.type)) {
      latestDocs.set(doc.type, doc);
    }
  }
  
  return Array.from(latestDocs.values());
}

export async function updateCompanyDocumentStatus(id: number, status: 'valid' | 'expiring_soon' | 'expired') {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(companyDocuments)
    .set({ status, updatedAt: new Date() })
    .where(eq(companyDocuments.id, id));
}

export async function deleteCompanyDocument(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .delete(companyDocuments)
    .where(eq(companyDocuments.id, id));
}

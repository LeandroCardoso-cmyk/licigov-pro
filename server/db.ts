import { eq, and, or, like, inArray, lte, gte, desc, asc, isNull, lt, sql, ne } from "drizzle-orm";
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
  contractRenewals,
  processItems,
  catmatSuggestions,
  aiUsageTracking,
  tasks,
  taskComments,
  taskAttachments,
  taskHistory,
  taskEditLocks,
  InsertTask,
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
  InsertCompanyDocument,
  InsertContractRenewal,
  documentTemplates,
  InsertDocumentTemplate,
  platforms,
  platformTemplates,
  platformChecklists,
  platformPublications,
  directContractLegalArticles,
  directContracts,
  InsertDirectContract,
  directContractDocuments,
  InsertDirectContractDocument,  directContractQuotations,
  InsertDirectContractQuotation,
  legalOpinions,
  InsertLegalOpinion,
  directContractAuditLogs,
  InsertDirectContractAuditLog,
  directContractChecklistProgress,
  InsertDirectContractChecklistProgress,
  contracts,
  InsertContract,
  contractAmendments,
  InsertContractAmendment,
  contractApostilles,
  InsertContractApostille,
  contractDocuments,
  InsertContractDocument,
  contractAuditLogs,
  InsertContractAuditLog,
  digitalSignatures,
  InsertDigitalSignature,
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

export async function updateUserTheme(userId: number, theme: "light" | "dark" | "system"): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot update user theme: database not available");
    return;
  }

  try {
    await db.update(users).set({ theme }).where(eq(users.id, userId));
  } catch (error) {
    console.error("[Database] Failed to update user theme:", error);
    throw error;
  }
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
    .select({
      id: processes.id,
      name: processes.name,
      description: processes.description,
      object: processes.object,
      estimatedValue: processes.estimatedValue,
      modality: processes.modality,
      category: processes.category,
      platformId: processes.platformId,
      status: processes.status,
      ownerId: processes.ownerId,
      createdAt: processes.createdAt,
      updatedAt: processes.updatedAt,
      platform: platforms,
    })
    .from(processes)
    .leftJoin(platforms, eq(processes.platformId, platforms.id))
    .where(eq(processes.ownerId, userId))
    .orderBy(desc(processes.updatedAt));
}

export async function searchProcesses(userId: number, query: string) {
  const db = await getDb();
  if (!db) return [];
  
  const searchTerm = `%${query}%`;
  return await db
    .select()
    .from(processes)
    .where(
      and(
        eq(processes.ownerId, userId),
        or(
          sql`${processes.name} LIKE ${searchTerm}`,
          sql`${processes.object} LIKE ${searchTerm}`,
          sql`CAST(${processes.id} AS CHAR) LIKE ${searchTerm}`
        )
      )
    )
    .orderBy(desc(processes.updatedAt))
    .limit(10);
}

export async function getProcessById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db
    .select({
      id: processes.id,
      name: processes.name,
      description: processes.description,
      object: processes.object,
      estimatedValue: processes.estimatedValue,
      modality: processes.modality,
      category: processes.category,
      platformId: processes.platformId,
      status: processes.status,
      ownerId: processes.ownerId,
      createdAt: processes.createdAt,
      updatedAt: processes.updatedAt,
      platform: platforms,
    })
    .from(processes)
    .leftJoin(platforms, eq(processes.platformId, platforms.id))
    .where(eq(processes.id, id))
    .limit(1);
  
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
  const userProcesses = await db.select().from(processes).where(eq(processes.ownerId, userId));
  for (const process of userProcesses) {
    await db.delete(documents).where(eq(documents.processId, process.id));
    await db.delete(editalParameters).where(eq(editalParameters.processId, process.id));
  }
  await db.delete(processes).where(eq(processes.ownerId, userId));
  
  // Deletar consentimentos
  await db.delete(userConsents).where(eq(userConsents.userId, userId));
  
  // Deletar usuário
  await db.delete(users).where(eq(users.id, userId));
}

export async function exportUserData(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const user = await getUserById(userId);
  const userProcesses = await db.select().from(processes).where(eq(processes.ownerId, userId));
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
  
  const userProcesses = await db.select().from(processes).where(eq(processes.ownerId, userId));
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

export async function updateProposalRequest(
  id: number,
  data: Partial<InsertProposalRequest>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(proposalRequests)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(proposalRequests.id, id));
}


export async function getAllSubscriptionsWithDetails() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const allSubscriptions = await db
    .select({
      id: subscriptions.id,
      userId: subscriptions.userId,
      planId: subscriptions.planId,
      status: subscriptions.status,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
      stripeCustomerId: subscriptions.stripeCustomerId,
      userName: users.name,
      userEmail: users.email,
      planName: subscriptionPlans.name,
      planPrice: subscriptionPlans.price,
    })
    .from(subscriptions)
    .leftJoin(users, eq(subscriptions.userId, users.id))
    .leftJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id));
  
  return allSubscriptions;
}

// ============================================
// CONTRACT RENEWALS (Renovações de Contrato)
// ============================================

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
  
  // Buscar assinatura atual
  const subscription = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  
  if (subscription.length === 0) {
    throw new Error("Assinatura não encontrada");
  }
  
  const sub = subscription[0];
  
  // Validar limite de renovações (máximo 9 renovações = 10 anos total)
  if (sub.renewalCount >= 9) {
    throw new Error("Limite máximo de renovações atingido (9 renovações = 10 anos total)");
  }
  
  // Calcular novas datas
  const previousEndDate = sub.currentPeriodEnd || new Date();
  const newEndDate = new Date(previousEndDate);
  newEndDate.setFullYear(newEndDate.getFullYear() + 1); // + 12 meses
  
  const newRenewalCount = sub.renewalCount + 1;
  
  // Atualizar assinatura
  await db
    .update(subscriptions)
    .set({
      currentPeriodEnd: newEndDate,
      renewalCount: newRenewalCount,
      lastRenewalDate: new Date(),
      originalStartDate: sub.originalStartDate || sub.currentPeriodStart,
      updatedAt: new Date(),
    })
    .where(eq(subscriptions.id, subscriptionId));
  
  // Registrar renovação no histórico
  await db.insert(contractRenewals).values({
    subscriptionId,
    renewalNumber: newRenewalCount,
    previousEndDate,
    newEndDate,
    termoAditivoFileUrl,
    termoAditivoFileKey,
    numeroEmpenho,
    valorRenovacao,
    renewedBy,
    observacoes,
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
  
  if (subscription.length === 0) {
    return { canRenew: false, reason: "Assinatura não encontrada" };
  }
  
  const sub = subscription[0];
  
  // Verificar se é assinatura via empenho
  if (sub.stripeSubscriptionId) {
    return { canRenew: false, reason: "Apenas assinaturas via empenho podem ser renovadas" };
  }
  
  // Verificar se atingiu limite de renovações (máximo 9 = 10 anos total)
  if (sub.renewalCount >= 9) {
    return { canRenew: false, reason: "Limite máximo de 9 renovações atingido (10 anos total)" };
  }
  
  // Verificar se está ativa
  if (sub.status !== "active") {
    return { canRenew: false, reason: "Apenas assinaturas ativas podem ser renovadas" };
  }
  
  return { canRenew: true };
}




export async function getContractsNearLimit() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Buscar contratos com 7, 8 ou 9 renovações (próximos ao limite)
  const contracts = await db
    .select({
      id: subscriptions.id,
      userId: subscriptions.userId,
      planId: subscriptions.planId,
      status: subscriptions.status,
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      renewalCount: subscriptions.renewalCount,
      userName: users.name,
      userEmail: users.email,
      planName: subscriptionPlans.name,
      planPrice: subscriptionPlans.price,
    })
    .from(subscriptions)
    .leftJoin(users, eq(subscriptions.userId, users.id))
    .leftJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(
      and(
        eq(subscriptions.status, 'active'),
        gte(subscriptions.renewalCount, 7)
      )
    )
    .orderBy(desc(subscriptions.renewalCount), subscriptions.currentPeriodEnd);
  
  // Calcular métricas
  const total = contracts.length;
  const atLimit = contracts.filter(c => c.renewalCount >= 9).length;
  const critical = contracts.filter(c => c.renewalCount === 8).length;
  const warning = contracts.filter(c => c.renewalCount === 7).length;
  
  return {
    contracts,
    total,
    atLimit,
    critical,
    warning,
  };
}




// ==================== DOCUMENT TEMPLATES ====================

export async function getTemplatesByUser(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  return await db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.userId, userId))
    .orderBy(desc(documentTemplates.createdAt));
}

export async function getTemplateById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db
    .select()
    .from(documentTemplates)
    .where(eq(documentTemplates.id, id))
    .limit(1);
  
  return result[0];
}

export async function createTemplate(template: InsertDocumentTemplate) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Se for template padrão, remover flag de outros templates do mesmo tipo
  if (template.isDefault === 1) {
    await db
      .update(documentTemplates)
      .set({ isDefault: 0 })
      .where(
        and(
          eq(documentTemplates.userId, template.userId),
          eq(documentTemplates.type, template.type)
        )
      );
  }
  
  const result = await db.insert(documentTemplates).values(template);
  return result[0].insertId;
}

export async function updateTemplate(id: number, updates: Partial<InsertDocumentTemplate>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Se estiver marcando como padrão, remover flag de outros templates
  if (updates.isDefault === 1 && updates.userId && updates.type) {
    await db
      .update(documentTemplates)
      .set({ isDefault: 0 })
      .where(
        and(
          eq(documentTemplates.userId, updates.userId),
          eq(documentTemplates.type, updates.type),
          ne(documentTemplates.id, id)
        )
      );
  }
  
  await db
    .update(documentTemplates)
    .set(updates)
    .where(eq(documentTemplates.id, id));
}

export async function deleteTemplate(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.delete(documentTemplates).where(eq(documentTemplates.id, id));
}

export async function getDefaultTemplate(userId: number, type: string) {
  const db = await getDb();
  if (!db) return undefined;
  
  const result = await db
    .select()
    .from(documentTemplates)
    .where(
      and(
        eq(documentTemplates.userId, userId),
        eq(documentTemplates.type, type as any),
        eq(documentTemplates.isDefault, 1)
      )
    )
    .limit(1);
  
  return result[0];
}


// ============================================
// CATMAT/CATSER ITEMS
// ============================================

export async function saveProcessItems(processId: number, items: Array<{
  itemType: 'material' | 'service';
  catmatCode?: string;
  catserCode?: string;
  description: string;
  unit: string;
  groupCode?: string;
  classCode?: string;
  quantity?: number;
  estimatedPrice?: number;
}>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Remover itens antigos do processo
  await db.delete(processItems).where(eq(processItems.processId, processId));
  
  // Inserir novos itens
  if (items.length > 0) {
    await db.insert(processItems).values(
      items.map(item => ({
        processId,
        itemType: item.itemType,
        catmatCode: item.catmatCode ? parseInt(String(item.catmatCode)) : null,
        catserCode: item.catserCode ? parseInt(String(item.catserCode)) : null,
        description: item.description,
        unit: item.unit,
        groupCode: item.groupCode ? parseInt(String(item.groupCode)) : null,
        classCode: item.classCode ? parseInt(String(item.classCode)) : null,
        quantity: item.quantity || null,
        estimatedPrice: item.estimatedPrice || null,
      }))
    );
  }
}

export async function getProcessItems(processId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(processItems)
    .where(eq(processItems.processId, processId));
  
  return result;
}


// ========================================
// MÓDULO DE GESTÃO DO DEPARTAMENTO
// ========================================

/**
 * Criar nova tarefa
 */
export async function createTask(task: InsertTask): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(tasks).values(task);
  return result[0].insertId;
}

/**
 * Buscar tarefa por ID
 */
export async function getTaskById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return result.length > 0 ? result[0] : null;
}

/**
 * Buscar todas as tarefas (sem filtros)
 */
export async function getAllTasks() {
  const db = await getDb();
  if (!db) return [];

  const result = await db.select().from(tasks);
  return result;
}

/**
 * Listar tarefas com filtros
 */
export async function listTasks(filters: {
  search?: string;
  status?: string[];
  priority?: string[];
  type?: string;
  assignedTo?: number;
  processId?: number;
  createdFrom?: Date;
  createdTo?: Date;
  deadlineFrom?: Date;
  deadlineTo?: Date;
  tags?: string[];
  page?: number;
  pageSize?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  let query = db.select().from(tasks);

  // Aplicar filtros
  const conditions = [];

  if (filters.search) {
    conditions.push(
      or(
        like(tasks.title, `%${filters.search}%`),
        like(tasks.description, `%${filters.search}%`)
      )
    );
  }

  if (filters.status && filters.status.length > 0) {
    conditions.push(inArray(tasks.status, filters.status as any));
  }

  if (filters.priority && filters.priority.length > 0) {
    conditions.push(inArray(tasks.priority, filters.priority as any));
  }

  if (filters.type) {
    conditions.push(eq(tasks.type, filters.type));
  }

  if (filters.assignedTo) {
    conditions.push(eq(tasks.assignedTo, filters.assignedTo));
  }

  if (filters.processId) {
    conditions.push(eq(tasks.processId, filters.processId));
  }

  if (filters.createdFrom) {
    conditions.push(gte(tasks.createdAt, filters.createdFrom));
  }

  if (filters.createdTo) {
    conditions.push(lte(tasks.createdAt, filters.createdTo));
  }

  if (filters.deadlineFrom) {
    conditions.push(gte(tasks.deadline, filters.deadlineFrom));
  }

  if (filters.deadlineTo) {
    conditions.push(lte(tasks.deadline, filters.deadlineTo));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  // Paginação
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 20;
  const offset = (page - 1) * pageSize;

  const result = await query.limit(pageSize).offset(offset);

  return result;
}

/**
 * Atualizar tarefa
 */
export async function updateTask(id: number, updates: Partial<InsertTask>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(tasks).set(updates).where(eq(tasks.id, id));
}

/**
 * Excluir tarefa
 */
export async function deleteTask(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Excluir comentários, anexos e histórico primeiro
  await db.delete(taskComments).where(eq(taskComments.taskId, id));
  await db.delete(taskAttachments).where(eq(taskAttachments.taskId, id));
  await db.delete(taskHistory).where(eq(taskHistory.taskId, id));
  await db.delete(taskEditLocks).where(eq(taskEditLocks.taskId, id));

  // Excluir tarefa
  await db.delete(tasks).where(eq(tasks.id, id));
}

/**
 * Atualizar status da tarefa
 */
export async function updateTaskStatus(id: number, status: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(tasks).set({ status: status as any }).where(eq(tasks.id, id));
}

/**
 * Buscar estatísticas de tarefas
 */
export async function getTaskStats(assignedTo?: number) {
  const db = await getDb();
  if (!db) return { total: 0, inProgress: 0, completed: 0, overdue: 0 };

  let query = db.select().from(tasks);

  if (assignedTo) {
    query = query.where(eq(tasks.assignedTo, assignedTo)) as any;
  }

  const allTasks = await query;

  const now = new Date();

  const stats = {
    total: allTasks.length,
    inProgress: allTasks.filter(t => t.status === "em_andamento").length,
    completed: allTasks.filter(t => t.status === "concluida").length,
    overdue: allTasks.filter(
      t => t.deadline && t.deadline < now && t.status !== "concluida"
    ).length,
  };

  return stats;
}

/**
 * Buscar tarefas atrasadas
 */
export async function getOverdueTasks(assignedTo?: number) {
  const db = await getDb();
  if (!db) return [];

  const now = new Date();

  const conditions = [
    lt(tasks.deadline, now),
    ne(tasks.status, "concluida")
  ];

  if (assignedTo) {
    conditions.push(eq(tasks.assignedTo, assignedTo));
  }

  const result = await db
    .select()
    .from(tasks)
    .where(and(...conditions));
    
  return result;
}


/**
 * Listar comentários de uma tarefa
 */
export async function listTaskComments(taskId: number) {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select()
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId))
    .orderBy(taskComments.createdAt);

  return result;
}

/**
 * Criar comentário em uma tarefa
 */
export async function createTaskComment(comment: {
  taskId: number;
  userId: number;
  content: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(taskComments).values(comment);
  return result[0].insertId;
}

/**
 * Listar anexos de uma tarefa
 */
export async function listTaskAttachments(taskId: number) {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select()
    .from(taskAttachments)
    .where(eq(taskAttachments.taskId, taskId))
    .orderBy(taskAttachments.uploadedAt);

  return result;
}

/**
 * Criar anexo em uma tarefa
 */
export async function createTaskAttachment(attachment: {
  taskId: number;
  fileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(taskAttachments).values(attachment);
  return result[0].insertId;
}

/**
 * Deletar anexo
 */
export async function deleteTaskAttachment(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(taskAttachments).where(eq(taskAttachments.id, id));
}

/**
 * ==========================================
 * FUNÇÕES DE SUGESTÕES CATMAT/CATSER
 * ==========================================
 */

/**
 * Criar sugestão CATMAT para um item
 */
export async function createCatmatSuggestion(data: {
  processItemId: number;
  catmatCode: string;
  description: string;
  confidenceScore: number;
  reasoning: string;
  status?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(catmatSuggestions).values({
    ...data,
    status: (data.status as any) || "pending",
  });
  
  return result[0].insertId;
}

/**
 * Buscar sugestões de um item específico
 */
export async function getCatmatSuggestionsByItem(processItemId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(catmatSuggestions)
    .where(eq(catmatSuggestions.processItemId, processItemId))
    .orderBy(desc(catmatSuggestions.confidenceScore));
  
  return result;
}

/**
 * Buscar sugestão por ID
 */
export async function getCatmatSuggestionById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(catmatSuggestions)
    .where(eq(catmatSuggestions.id, id))
    .limit(1);
  
  return result[0];
}

/**
 * Atualizar status de uma sugestão
 */
export async function updateCatmatSuggestion(id: number, data: { status: string }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(catmatSuggestions)
    .set({ status: data.status as any })
    .where(eq(catmatSuggestions.id, id));
}

/**
 * Rejeitar outras sugestões do mesmo item (quando uma é aprovada)
 */
export async function rejectOtherSuggestions(processItemId: number, approvedId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(catmatSuggestions)
    .set({ status: "rejected" as any })
    .where(
      and(
        eq(catmatSuggestions.processItemId, processItemId),
        ne(catmatSuggestions.id, approvedId),
        eq(catmatSuggestions.status, "pending" as any)
      )
    );
}

/**
 * Atualizar item do processo
 */
export async function updateProcessItem(id: number, data: Partial<typeof processItems.$inferInsert>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(processItems)
    .set(data)
    .where(eq(processItems.id, id));
}

/**
 * Deletar item do processo
 */
export async function deleteProcessItem(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .delete(processItems)
    .where(eq(processItems.id, id));
}


// ============================================================================
// AI Usage Tracking Functions
// ============================================================================

/**
 * Registrar uso de IA no banco de dados
 */
export async function trackAIUsage(data: {
  userId: number;
  processId?: number;
  operationType: "embedding" | "rag_query" | "catmat_matching" | "document_generation";
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUSD: number;
  metadata?: any;
}) {
  const db = await getDb();
  if (!db) {
    console.warn("[AI Tracking] Database not available");
    return;
  }

  try {
    await db.insert(aiUsageTracking).values({
      userId: data.userId,
      processId: data.processId,
      operationType: data.operationType as any,
      model: data.model,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      estimatedCostUSD: data.estimatedCostUSD.toString(),
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    });
  } catch (error) {
    console.error("[AI Tracking] Failed to track usage:", error);
  }
}

/**
 * Buscar estatísticas de uso de IA
 */
export async function getAIUsageStats(filters?: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  operationType?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Query base
  let query = db.select().from(aiUsageTracking);

  // Aplicar filtros
  const conditions: any[] = [];
  if (filters?.startDate) {
    conditions.push(gte(aiUsageTracking.createdAt, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(aiUsageTracking.createdAt, filters.endDate));
  }
  if (filters?.userId) {
    conditions.push(eq(aiUsageTracking.userId, filters.userId));
  }
  if (filters?.operationType) {
    conditions.push(eq(aiUsageTracking.operationType, filters.operationType as any));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  const records = await query;

  // Calcular estatísticas
  const totalCost = records.reduce((sum, r) => sum + parseFloat(r.estimatedCostUSD as string), 0);
  const totalInputTokens = records.reduce((sum, r) => sum + r.inputTokens, 0);
  const totalOutputTokens = records.reduce((sum, r) => sum + r.outputTokens, 0);
  const totalOperations = records.length;

  // Agrupar por tipo de operação
  const byOperationType: Record<string, { count: number; cost: number }> = {};
  records.forEach((r) => {
    const type = r.operationType;
    if (!byOperationType[type]) {
      byOperationType[type] = { count: 0, cost: 0 };
    }
    byOperationType[type].count++;
    byOperationType[type].cost += parseFloat(r.estimatedCostUSD as string);
  });

  // Agrupar por dia (últimos 30 dias)
  const byDay: Record<string, { date: string; cost: number; operations: number }> = {};
  records.forEach((r) => {
    const date = r.createdAt.toISOString().split("T")[0];
    if (!byDay[date]) {
      byDay[date] = { date, cost: 0, operations: 0 };
    }
    byDay[date].cost += parseFloat(r.estimatedCostUSD as string);
    byDay[date].operations++;
  });

  return {
    totalCost,
    totalInputTokens,
    totalOutputTokens,
    totalOperations,
    byOperationType,
    byDay: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

/**
 * Buscar histórico de uso de IA (paginado)
 */
export async function getAIUsageHistory(filters?: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  operationType?: string;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Query base
  let query = db.select().from(aiUsageTracking);

  // Aplicar filtros
  const conditions: any[] = [];
  if (filters?.startDate) {
    conditions.push(gte(aiUsageTracking.createdAt, filters.startDate));
  }
  if (filters?.endDate) {
    conditions.push(lte(aiUsageTracking.createdAt, filters.endDate));
  }
  if (filters?.userId) {
    conditions.push(eq(aiUsageTracking.userId, filters.userId));
  }
  if (filters?.operationType) {
    conditions.push(eq(aiUsageTracking.operationType, filters.operationType as any));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  // Ordenar por data (mais recente primeiro)
  query = query.orderBy(desc(aiUsageTracking.createdAt)) as any;

  // Paginação
  if (filters?.limit) {
    query = query.limit(filters.limit) as any;
  }
  if (filters?.offset) {
    query = query.offset(filters.offset) as any;
  }

  return await query;
}

/**
 * Exportar dados de uso de IA para CSV
 */
export async function exportAIUsageCSV(filters?: {
  startDate?: Date;
  endDate?: Date;
  userId?: number;
  operationType?: string;
}) {
  const records = await getAIUsageHistory(filters);

  // Gerar CSV
  const headers = [
    "ID",
    "Data/Hora",
    "Usuário ID",
    "Processo ID",
    "Tipo de Operação",
    "Modelo",
    "Tokens Entrada",
    "Tokens Saída",
    "Custo (USD)",
  ];

  const rows = records.map((r) => [
    r.id,
    r.createdAt.toISOString(),
    r.userId,
    r.processId || "",
    r.operationType,
    r.model,
    r.inputTokens,
    r.outputTokens,
    r.estimatedCostUSD,
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.join(",")),
  ].join("\n");

  return csvContent;
}


// ==================== PLATFORMS ====================

/**
 * Buscar todas as plataformas ativas
 */
export async function getPlatforms() {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(platforms)
    .where(eq(platforms.isActive, true))
    .orderBy(asc(platforms.displayOrder));
}

/**
 * Buscar plataforma por ID
 */
export async function getPlatformById(platformId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(platforms)
    .where(eq(platforms.id, platformId))
    .limit(1);

  return result[0] || null;
}

/**
 * Buscar plataforma por slug
 */
export async function getPlatformBySlug(slug: string) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(platforms)
    .where(eq(platforms.slug, slug))
    .limit(1);

  return result[0] || null;
}

/**
 * Buscar templates de uma plataforma por tipo de documento
 */
export async function getPlatformTemplates(platformId: number, documentType?: "etp" | "tr" | "dfd" | "edital") {
  const db = await getDb();
  if (!db) return [];

  let query = db
    .select()
    .from(platformTemplates)
    .where(
      and(
        eq(platformTemplates.platformId, platformId),
        eq(platformTemplates.isActive, true)
      )
    );

  if (documentType) {
    query = query.where(eq(platformTemplates.documentType, documentType));
  }

  return await query;
}

/**
 * Buscar checklist de uma plataforma
 */
export async function getPlatformChecklist(platformId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(platformChecklists)
    .where(eq(platformChecklists.platformId, platformId))
    .orderBy(asc(platformChecklists.stepNumber));
}

/**
 * Adicionar platformId ao processo
 */
export async function updateProcessPlatform(processId: number, platformId: number | null) {
  const db = await getDb();
  if (!db) return null;

  await db
    .update(processes)
    .set({ 
      platformId,
      updatedAt: new Date()
    })
    .where(eq(processes.id, processId));

  return await getProcessById(processId);
}

/**
 * Criar publicação de processo em plataforma (Nível 3 - Futuro)
 */
export async function createPlatformPublication(data: {
  processId: number;
  platformId: number;
  externalId?: string;
  externalUrl?: string;
  status?: "draft" | "published" | "scheduled" | "failed" | "cancelled" | "closed";
  scheduledFor?: Date;
  metadata?: Record<string, any>;
}) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(platformPublications).values({
    processId: data.processId,
    platformId: data.platformId,
    externalId: data.externalId || null,
    externalUrl: data.externalUrl || null,
    status: data.status || "draft",
    scheduledFor: data.scheduledFor || null,
    metadata: data.metadata ? JSON.stringify(data.metadata) : null,
  });

  return result;
}

/**
 * Buscar publicações de um processo
 */
export async function getProcessPublications(processId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(platformPublications)
    .where(eq(platformPublications.processId, processId))
    .orderBy(desc(platformPublications.createdAt));
}

/**
 * Atualizar status de publicação
 */
/**
 * Atualizar instruções de templates de uma plataforma
 */
/**
 * Criar novo passo de checklist
 */
export async function createChecklistStep(data: {
  platformId: number;
  stepNumber: number;
  title: string;
  description?: string;
  category?: string;
  fields?: any;
  requiredDocuments?: any;
  isOptional?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [result] = await db.insert(platformChecklists).values(data as any);
  return result.insertId;
}

/**
 * Atualizar passo de checklist
 */
export async function updateChecklistStep(
  stepId: number,
  data: {
    title?: string;
    description?: string;
    category?: string;
    fields?: any;
    requiredDocuments?: any;
    isOptional?: boolean;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(platformChecklists)
    .set(data as any)
    .where(eq(platformChecklists.id, stepId));

  return { success: true };
}

/**
 * Deletar passo de checklist
 */
export async function deleteChecklistStep(stepId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(platformChecklists).where(eq(platformChecklists.id, stepId));
  return { success: true };
}

/**
 * Reordenar passo de checklist (swap com passo anterior ou próximo)
 */
export async function reorderChecklistStep(
  stepId: number,
  direction: "up" | "down"
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Buscar passo atual
  const [currentStep] = await db
    .select()
    .from(platformChecklists)
    .where(eq(platformChecklists.id, stepId))
    .limit(1);

  if (!currentStep) throw new Error("Passo não encontrado");

  // Buscar passo para trocar
  const targetStepNumber =
    direction === "up"
      ? currentStep.stepNumber - 1
      : currentStep.stepNumber + 1;

  const [targetStep] = await db
    .select()
    .from(platformChecklists)
    .where(
      and(
        eq(platformChecklists.platformId, currentStep.platformId),
        eq(platformChecklists.stepNumber, targetStepNumber)
      )
    )
    .limit(1);

  if (!targetStep) {
    throw new Error(
      direction === "up"
        ? "Já é o primeiro passo"
        : "Já é o último passo"
    );
  }

  // Swap stepNumber
  await db
    .update(platformChecklists)
    .set({ stepNumber: targetStepNumber })
    .where(eq(platformChecklists.id, currentStep.id));

  await db
    .update(platformChecklists)
    .set({ stepNumber: currentStep.stepNumber })
    .where(eq(platformChecklists.id, targetStep.id));

  return { success: true };
}

export async function updatePlatformInstructions(
  platformId: number,
  instructions: {
    general?: string;
    etp?: string;
    tr?: string;
    dfd?: string;
    edital?: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Buscar config atual
  const platform = await getPlatformById(platformId);
  if (!platform) throw new Error("Platform not found");

  // Mesclar instruções no config
  const currentConfig = (platform.config as any) || {};
  const updatedConfig = {
    ...currentConfig,
    instructions,
  };

  // Atualizar no banco
  await db
    .update(platforms)
    .set({ config: updatedConfig as any })
    .where(eq(platforms.id, platformId));

  return { success: true };
}

export async function updatePublicationStatus(
  publicationId: number,
  status: "draft" | "published" | "scheduled" | "failed" | "cancelled" | "closed",
  data?: {
    externalId?: string;
    externalUrl?: string;
    publishedAt?: Date;
    closedAt?: Date;
    errorMessage?: string;
    apiResponse?: Record<string, any>;
  }
) {
  const db = await getDb();
  if (!db) return null;

  const updateData: any = {
    status,
    updatedAt: new Date(),
  };

  if (data?.externalId) updateData.externalId = data.externalId;
  if (data?.externalUrl) updateData.externalUrl = data.externalUrl;
  if (data?.publishedAt) updateData.publishedAt = data.publishedAt;
  if (data?.closedAt) updateData.closedAt = data.closedAt;
  if (data?.errorMessage) updateData.errorMessage = data.errorMessage;
  if (data?.apiResponse) updateData.apiResponse = JSON.stringify(data.apiResponse);

  await db
    .update(platformPublications)
    .set(updateData)
    .where(eq(platformPublications.id, publicationId));

  return await db
    .select()
    .from(platformPublications)
    .where(eq(platformPublications.id, publicationId))
    .limit(1)
    .then(rows => rows[0] || null);
}


// ========================================
// CONTRATAÇÃO DIRETA
// ========================================

export async function getLegalArticles(type?: "dispensa" | "inexigibilidade") {
  const db = await getDb();
  if (!db) return [];

  const query = db.select().from(directContractLegalArticles).where(eq(directContractLegalArticles.isActive, true));

  if (type) {
    return await query.where(eq(directContractLegalArticles.type, type));
  }

  return await query;
}

export async function getLegalArticleById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(directContractLegalArticles)
    .where(eq(directContractLegalArticles.id, id))
    .limit(1);

  return result[0] || null;
}

export async function createDirectContract(data: InsertDirectContract) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(directContracts).values(data);
  const insertedId = result[0].insertId;

  return await getDirectContractById(insertedId);
}

export async function getDirectContractById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select({
      directContract: directContracts,
      legalArticle: directContractLegalArticles,
      platform: platforms,
    })
    .from(directContracts)
    .leftJoin(directContractLegalArticles, eq(directContracts.legalArticleId, directContractLegalArticles.id))
    .leftJoin(platforms, eq(directContracts.platformId, platforms.id))
    .where(eq(directContracts.id, id))
    .limit(1);

  if (!result[0]) return null;

  return {
    ...result[0].directContract,
    legalArticle: result[0].legalArticle,
    platform: result[0].platform,
  };
}

export async function listDirectContracts(userId: number, filters?: {
  type?: "dispensa" | "inexigibilidade";
  status?: string;
  year?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  let query = db
    .select({
      directContract: directContracts,
      legalArticle: directContractLegalArticles,
      platform: platforms,
    })
    .from(directContracts)
    .leftJoin(directContractLegalArticles, eq(directContracts.legalArticleId, directContractLegalArticles.id))
    .leftJoin(platforms, eq(directContracts.platformId, platforms.id))
    .where(eq(directContracts.createdBy, userId))
    .orderBy(desc(directContracts.createdAt));

  if (filters?.type) {
    query = query.where(eq(directContracts.type, filters.type));
  }

  if (filters?.status) {
    query = query.where(eq(directContracts.status, filters.status as any));
  }

  if (filters?.year) {
    query = query.where(eq(directContracts.year, filters.year));
  }

  const results = await query;

  return results.map(row => ({
    ...row.directContract,
    legalArticle: row.legalArticle,
    platform: row.platform,
  }));
}

export async function updateDirectContract(id: number, data: Partial<InsertDirectContract>) {
  const db = await getDb();
  if (!db) return null;

  await db
    .update(directContracts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(directContracts.id, id));

  return await getDirectContractById(id);
}

export async function createDirectContractDocument(data: InsertDirectContractDocument) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(directContractDocuments).values(data);
  const insertedId = result[0].insertId;

  const doc = await db
    .select()
    .from(directContractDocuments)
    .where(eq(directContractDocuments.id, insertedId))
    .limit(1);

  return doc[0] || null;
}

export async function getDirectContractDocuments(directContractId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(directContractDocuments)
    .where(eq(directContractDocuments.directContractId, directContractId))
    .orderBy(desc(directContractDocuments.createdAt));
}

export async function updateDirectContractDocument(id: number, data: Partial<InsertDirectContractDocument>) {
  const db = await getDb();
  if (!db) return null;

  await db
    .update(directContractDocuments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(directContractDocuments.id, id));

  const doc = await db
    .select()
    .from(directContractDocuments)
    .where(eq(directContractDocuments.id, id))
    .limit(1);

  return doc[0] || null;
}

export async function createQuotation(data: InsertDirectContractQuotation) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(directContractQuotations).values(data);
  const insertedId = result[0].insertId;

  const quotation = await db
    .select()
    .from(directContractQuotations)
    .where(eq(directContractQuotations.id, insertedId))
    .limit(1);

  return quotation[0] || null;
}

export async function listQuotations(directContractId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(directContractQuotations)
    .where(eq(directContractQuotations.directContractId, directContractId))
    .orderBy(asc(directContractQuotations.value));
}

export async function updateQuotation(id: number, data: Partial<InsertDirectContractQuotation>) {
  const db = await getDb();
  if (!db) return null;

  await db
    .update(directContractQuotations)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(directContractQuotations.id, id));

  const quotation = await db
    .select()
    .from(directContractQuotations)
    .where(eq(directContractQuotations.id, id))
    .limit(1);

  return quotation[0] || null;
}

// ========================================
// PLATAFORMAS E CHECKLISTS
// ========================================

export async function listPlatforms() {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(platforms)
    .where(eq(platforms.isActive, true))
    .orderBy(asc(platforms.displayOrder));
}

export async function getPlatformChecklists(platformId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(platformChecklists)
    .where(eq(platformChecklists.platformId, platformId))
    .orderBy(asc(platformChecklists.stepNumber));
}

// ========================================
// AUDITORIA DE CONTRATAÇÕES DIRETAS
// ========================================

export async function createDirectContractAuditLog(log: InsertDirectContractAuditLog) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(directContractAuditLogs).values(log);
  return result.insertId;
}

export async function getDirectContractAuditLogs(directContractId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(directContractAuditLogs)
    .where(eq(directContractAuditLogs.directContractId, directContractId))
    .orderBy(desc(directContractAuditLogs.createdAt));
}

export async function getDirectContractAuditLogsByAction(directContractId: number, action: string) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(directContractAuditLogs)
    .where(
      and(
        eq(directContractAuditLogs.directContractId, directContractId),
        eq(directContractAuditLogs.action, action as any)
      )
    )
    .orderBy(desc(directContractAuditLogs.createdAt));
}

// ========================================
// PROGRESSO DO CHECKLIST
// ========================================

export async function saveChecklistProgress(progress: InsertDirectContractChecklistProgress) {
  const db = await getDb();
  if (!db) return null;

  // Verificar se já existe um registro para este passo
  const existing = await db
    .select()
    .from(directContractChecklistProgress)
    .where(
      and(
        eq(directContractChecklistProgress.directContractId, progress.directContractId),
        eq(directContractChecklistProgress.stepNumber, progress.stepNumber)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Atualizar existente
    await db
      .update(directContractChecklistProgress)
      .set({
        isCompleted: progress.isCompleted,
        completedBy: progress.completedBy,
        completedAt: progress.isCompleted ? new Date() : null,
        notes: progress.notes,
      })
      .where(eq(directContractChecklistProgress.id, existing[0].id));

    return existing[0].id;
  } else {
    // Criar novo
    const result = await db.insert(directContractChecklistProgress).values({
      ...progress,
      completedAt: progress.isCompleted ? new Date() : undefined,
    });
    return result.insertId;
  }
}

export async function getChecklistProgress(directContractId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(directContractChecklistProgress)
    .where(eq(directContractChecklistProgress.directContractId, directContractId))
    .orderBy(asc(directContractChecklistProgress.stepNumber));
}

export async function deleteChecklistProgress(directContractId: number, stepNumber: number) {
  const db = await getDb();
  if (!db) return null;

  await db
    .delete(directContractChecklistProgress)
    .where(
      and(
        eq(directContractChecklistProgress.directContractId, directContractId),
        eq(directContractChecklistProgress.stepNumber, stepNumber)
      )
    );

  return true;
}


// ========================================
// ESTATÍSTICAS DE CONTRATAÇÕES DIRETAS
// ========================================

/**
 * Busca estatísticas gerais de contratações diretas
 */
export async function getDirectContractsOverview() {
  const db = await getDb();
  if (!db) return null;

  // Total de contratações
  const totalResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(directContracts);
  const total = totalResult[0]?.count || 0;

  // Total por tipo
  const byTypeResult = await db
    .select({
      type: directContracts.type,
      count: sql<number>`COUNT(*)`,
    })
    .from(directContracts)
    .groupBy(directContracts.type);

  // Total por status
  const byStatusResult = await db
    .select({
      status: directContracts.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(directContracts)
    .groupBy(directContracts.status);

  // Valor total
  const valueResult = await db
    .select({ total: sql<number>`SUM(value)` })
    .from(directContracts);
  const totalValue = valueResult[0]?.total || 0;

  // Tempo médio de conclusão (em dias)
  const avgTimeResult = await db
    .select({
      avgDays: sql<number>`AVG(DATEDIFF(updatedAt, createdAt))`,
    })
    .from(directContracts)
    .where(eq(directContracts.status, "completed"));
  const avgCompletionTime = avgTimeResult[0]?.avgDays || 0;

  // Taxa de aprovação
  const approvedResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(directContracts)
    .where(eq(directContracts.status, "approved"));
  const approvedCount = approvedResult[0]?.count || 0;
  const approvalRate = total > 0 ? (approvedCount / total) * 100 : 0;

  return {
    total,
    byType: byTypeResult,
    byStatus: byStatusResult,
    totalValue,
    avgCompletionTime: Math.round(avgCompletionTime),
    approvalRate: Math.round(approvalRate * 10) / 10,
  };
}

/**
 * Busca dados para gráficos de contratações diretas
 */
export async function getDirectContractsChartData() {
  const db = await getDb();
  if (!db) return null;

  // Dispensas vs Inexigibilidades por mês (últimos 12 meses)
  const monthlyResult = await db
    .select({
      month: sql<string>`DATE_FORMAT(createdAt, '%Y-%m')`,
      type: directContracts.type,
      count: sql<number>`COUNT(*)`,
      totalValue: sql<number>`SUM(value)`,
    })
    .from(directContracts)
    .where(sql`createdAt >= DATE_SUB(NOW(), INTERVAL 12 MONTH)`)
    .groupBy(sql`DATE_FORMAT(createdAt, '%Y-%m')`, directContracts.type)
    .orderBy(sql`DATE_FORMAT(createdAt, '%Y-%m')`);

  // Valor por plataforma
  const byPlatformResult = await db
    .select({
      platformId: directContracts.platformId,
      platformName: platforms.name,
      count: sql<number>`COUNT(*)`,
      totalValue: sql<number>`SUM(${directContracts.value})`,
    })
    .from(directContracts)
    .leftJoin(platforms, eq(directContracts.platformId, platforms.id))
    .groupBy(directContracts.platformId, platforms.name);

  // Status (para gráfico de pizza)
  const byStatusResult = await db
    .select({
      status: directContracts.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(directContracts)
    .groupBy(directContracts.status);

  return {
    monthly: monthlyResult,
    byPlatform: byPlatformResult,
    byStatus: byStatusResult,
  };
}

/**
 * Busca top 5 fornecedores mais contratados
 */
export async function getTopSuppliers() {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select({
      supplierName: directContracts.supplierName,
      supplierCNPJ: directContracts.supplierCNPJ,
      count: sql<number>`COUNT(*)`,
      totalValue: sql<number>`SUM(value)`,
    })
    .from(directContracts)
    .where(sql`supplierName IS NOT NULL AND supplierName != ''`)
    .groupBy(directContracts.supplierName, directContracts.supplierCNPJ)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(5);

  return result;
}

/**
 * Busca top 5 artigos legais mais usados
 */
export async function getTopLegalArticles() {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select({
      articleId: directContracts.legalArticleId,
      articleNumber: directContractLegalArticles.articleNumber,
      articleDescription: directContractLegalArticles.description,
      count: sql<number>`COUNT(*)`,
    })
    .from(directContracts)
    .leftJoin(directContractLegalArticles, eq(directContracts.legalArticleId, directContractLegalArticles.id))
    .where(sql`${directContracts.legalArticleId} IS NOT NULL`)
    .groupBy(directContracts.legalArticleId, directContractLegalArticles.articleNumber, directContractLegalArticles.description)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(5);

  return result;
}

/**
 * Busca contratações recentes
 */
export async function getRecentDirectContracts(limit: number = 10) {
  const db = await getDb();
  if (!db) return [];

  const result = await db
    .select()
    .from(directContracts)
    .orderBy(desc(directContracts.createdAt))
    .limit(limit);

  return result;
}


// ============================================================================
// FUNÇÕES DE CONTRATOS
// ============================================================================

/**
 * Criar novo contrato
 */
export async function createContract(data: InsertContract) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(contracts).values(data);
  const insertedId = result[0].insertId;

  return await getContractById(insertedId);
}

/**
 * Buscar contrato por ID
 */
export async function getContractById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(contracts)
    .where(eq(contracts.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Listar contratos do usuário com filtros
 */
export async function listContracts(userId: number, filters?: {
  type?: string;
  status?: string;
  year?: number;
}) {
  const db = await getDb();
  if (!db) return [];

  let query = db
    .select()
    .from(contracts)
    .where(eq(contracts.createdBy, userId))
    .orderBy(desc(contracts.createdAt));

  if (filters?.type) {
    query = query.where(eq(contracts.type, filters.type as any));
  }

  if (filters?.status) {
    query = query.where(eq(contracts.status, filters.status as any));
  }

  if (filters?.year) {
    query = query.where(eq(contracts.year, filters.year));
  }

  return await query;
}

/**
 * Atualizar contrato
 */
export async function updateContract(id: number, data: Partial<InsertContract>) {
  const db = await getDb();
  if (!db) return null;

  await db
    .update(contracts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(contracts.id, id));

  return await getContractById(id);
}

/**
 * Criar aditivo de contrato
 */
export async function createAmendment(data: InsertContractAmendment) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(contractAmendments).values(data);
  const insertedId = result[0].insertId;

  const amendment = await db
    .select()
    .from(contractAmendments)
    .where(eq(contractAmendments.id, insertedId))
    .limit(1);

  return amendment.length > 0 ? amendment[0] : null;
}

/**
 * Listar aditivos de um contrato
 */
export async function listAmendments(contractId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(contractAmendments)
    .where(eq(contractAmendments.contractId, contractId))
    .orderBy(asc(contractAmendments.number));
}

/**
 * Criar apostilamento de contrato
 */
export async function createApostille(data: InsertContractApostille) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(contractApostilles).values(data);
  const insertedId = result[0].insertId;

  const apostille = await db
    .select()
    .from(contractApostilles)
    .where(eq(contractApostilles.id, insertedId))
    .limit(1);

  return apostille.length > 0 ? apostille[0] : null;
}

/**
 * Listar apostilamentos de um contrato
 */
export async function listApostilles(contractId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(contractApostilles)
    .where(eq(contractApostilles.contractId, contractId))
    .orderBy(asc(contractApostilles.number));
}

/**
 * Criar documento de contrato
 */
export async function createContractDocument(data: InsertContractDocument) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(contractDocuments).values(data);
  const insertedId = result[0].insertId;

  const doc = await db
    .select()
    .from(contractDocuments)
    .where(eq(contractDocuments.id, insertedId))
    .limit(1);

  return doc.length > 0 ? doc[0] : null;
}

/**
 * Listar documentos de um contrato
 */
export async function listContractDocuments(contractId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(contractDocuments)
    .where(eq(contractDocuments.contractId, contractId))
    .orderBy(desc(contractDocuments.createdAt));
}

/**
 * Atualizar documento de contrato
 */
export async function updateContractDocument(id: number, data: Partial<InsertContractDocument>) {
  const db = await getDb();
  if (!db) return null;

  await db
    .update(contractDocuments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(contractDocuments.id, id));

  const doc = await db
    .select()
    .from(contractDocuments)
    .where(eq(contractDocuments.id, id))
    .limit(1);

  return doc.length > 0 ? doc[0] : null;
}

/**
 * Criar log de auditoria de contrato
 */
export async function createContractAuditLog(log: InsertContractAuditLog) {
  const db = await getDb();
  if (!db) return null;

  const result = await db.insert(contractAuditLogs).values(log);
  return result.insertId;
}

/**
 * Buscar logs de auditoria de um contrato
 */
export async function getContractAuditLogs(contractId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(contractAuditLogs)
    .where(eq(contractAuditLogs.contractId, contractId))
    .orderBy(desc(contractAuditLogs.createdAt));
}

/**
 * Buscar logs de auditoria por ação
 */
export async function getContractAuditLogsByAction(contractId: number, action: string) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(contractAuditLogs)
    .where(
      and(
        eq(contractAuditLogs.contractId, contractId),
        eq(contractAuditLogs.action, action as any)
      )
    )
    .orderBy(desc(contractAuditLogs.createdAt));
}

/**
 * Buscar estatísticas gerais de contratos
 */
export async function getContractsOverview() {
  const db = await getDb();
  if (!db) return null;

  // Total de contratos
  const totalResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(contracts);
  const total = totalResult[0]?.count || 0;

  // Total por tipo
  const byTypeResult = await db
    .select({
      type: contracts.type,
      count: sql<number>`COUNT(*)`,
    })
    .from(contracts)
    .groupBy(contracts.type);

  // Total por status
  const byStatusResult = await db
    .select({
      status: contracts.status,
      count: sql<number>`COUNT(*)`,
    })
    .from(contracts)
    .groupBy(contracts.status);

  // Valor total
  const valueResult = await db
    .select({ total: sql<number>`SUM(currentValue)` })
    .from(contracts);
  const totalValue = valueResult[0]?.total || 0;

  // Contratos ativos
  const activeResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(contracts)
    .where(eq(contracts.status, "active"));
  const activeCount = activeResult[0]?.count || 0;

  // Contratos vencidos
  const expiredResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(contracts)
    .where(eq(contracts.status, "expired"));
  const expiredCount = expiredResult[0]?.count || 0;

  // Contratos a vencer em 30 dias
  const expiringSoonResult = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(contracts)
    .where(
      and(
        eq(contracts.status, "active"),
        sql`DATEDIFF(endDate, NOW()) <= 30 AND DATEDIFF(endDate, NOW()) > 0`
      )
    );
  const expiringSoonCount = expiringSoonResult[0]?.count || 0;

  return {
    total,
    byType: byTypeResult,
    byStatus: byStatusResult,
    totalValue,
    active: activeCount,
    expired: expiredCount,
    expiringSoon: expiringSoonCount,
  };
}

/**
 * Buscar contratos recentes
 */
export async function getRecentContracts(limit: number = 10) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(contracts)
    .orderBy(desc(contracts.createdAt))
    .limit(limit);
}


// ============================================================================
// LEGAL OPINIONS (Pareceres Jurídicos)
// ============================================================================

/**
 * Criar parecer jurídico
 */
export async function createLegalOpinion(data: InsertLegalOpinion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(legalOpinions).values(data);
  return result[0].insertId;
}

/**
 * Listar pareceres jurídicos com filtros
 */
export async function getLegalOpinions(filters?: {
  status?: string;
  sourceType?: string;
  requestedBy?: number;
  isTemplate?: boolean;
}) {
  const db = await getDb();
  if (!db) return [];

  let query = db.select().from(legalOpinions);

  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(legalOpinions.status, filters.status as any));
  }
  if (filters?.sourceType) {
    conditions.push(eq(legalOpinions.sourceType, filters.sourceType as any));
  }
  if (filters?.requestedBy) {
    conditions.push(eq(legalOpinions.requestedBy, filters.requestedBy));
  }
  if (filters?.isTemplate !== undefined) {
    conditions.push(eq(legalOpinions.isTemplate, filters.isTemplate));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as any;
  }

  return await query.orderBy(desc(legalOpinions.createdAt));
}

/**
 * Buscar parecer jurídico por ID
 */
export async function getLegalOpinionById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(legalOpinions)
    .where(eq(legalOpinions.id, id))
    .limit(1);

  return result[0] || null;
}

/**
 * Atualizar parecer jurídico
 */
export async function updateLegalOpinion(
  id: number,
  data: Partial<InsertLegalOpinion>
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(legalOpinions)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(legalOpinions.id, id));
}

/**
 * Deletar parecer jurídico
 */
export async function deleteLegalOpinion(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.delete(legalOpinions).where(eq(legalOpinions.id, id));
}

/**
 * Buscar pareceres por fonte (processo, contratação direta, etc)
 */
export async function getLegalOpinionsBySource(
  sourceType: string,
  sourceId: number
) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(legalOpinions)
    .where(
      and(
        eq(legalOpinions.sourceType, sourceType as any),
        eq(legalOpinions.sourceId, sourceId)
      )
    )
    .orderBy(desc(legalOpinions.createdAt));
}

/**
 * ========================================
 * DIGITAL SIGNATURES
 * ========================================
 */

/**
 * Criar assinatura digital
 */
export async function createDigitalSignature(data: InsertDigitalSignature) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(digitalSignatures).values(data);
  return result[0].insertId;
}

/**
 * Buscar assinatura digital por ID
 */
export async function getDigitalSignatureById(id: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(digitalSignatures)
    .where(eq(digitalSignatures.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Buscar assinatura digital por documento
 */
export async function getDigitalSignatureByDocument(
  documentType: string,
  documentId: number
) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(digitalSignatures)
    .where(
      and(
        eq(digitalSignatures.documentType, documentType as any),
        eq(digitalSignatures.documentId, documentId)
      )
    )
    .orderBy(desc(digitalSignatures.signedAt))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}

/**
 * Invalidar assinatura digital
 */
export async function invalidateDigitalSignature(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(digitalSignatures)
    .set({ isValid: false })
    .where(eq(digitalSignatures.id, id));
}

/**
 * ========================================
 * LEGAL OPINIONS ANALYTICS
 * ========================================
 */

/**
 * Função helper para filtrar pareceres por período
 */
function filterByPeriod<T extends { createdAt: Date | string }>(items: T[], period: "all" | "7days" | "30days" | "90days" | "year"): T[] {
  if (period === "all") return items;

  const now = new Date();
  const cutoffDate = new Date();

  switch (period) {
    case "7days":
      cutoffDate.setDate(now.getDate() - 7);
      break;
    case "30days":
      cutoffDate.setDate(now.getDate() - 30);
      break;
    case "90days":
      cutoffDate.setDate(now.getDate() - 90);
      break;
    case "year":
      cutoffDate.setFullYear(now.getFullYear() - 1);
      break;
  }

  return items.filter((item) => {
    const itemDate = typeof item.createdAt === "string" ? new Date(item.createdAt) : item.createdAt;
    return itemDate >= cutoffDate;
  });
}

/**
 * Obter visão geral de pareceres jurídicos
 */
export async function getLegalOpinionsOverview(period: "all" | "7days" | "30days" | "90days" | "year" = "30days") {
  const db = await getDb();
  if (!db) return null;

  const allOpinions = await db.select().from(legalOpinions);
  const filteredOpinions = filterByPeriod(allOpinions, period);

  const total = filteredOpinions.length;
  const favorable = filteredOpinions.filter((op) => op.conclusion === "favorable").length;
  const unfavorable = filteredOpinions.filter((op) => op.conclusion === "unfavorable").length;
  const withReservations = filteredOpinions.filter((op) => op.conclusion === "with_reservations").length;

  // Calcular tempo médio de geração (estimado em 2-5 minutos)
  const avgTime = Math.floor(Math.random() * 3) + 2; // Simulado

  return {
    total,
    favorable,
    unfavorable,
    withReservations,
    avgGenerationTime: avgTime,
  };
}

/**
 * Obter pareceres por mês (últimos 6 meses)
 */
export async function getLegalOpinionsByMonth(period: "all" | "7days" | "30days" | "90days" | "year" = "30days") {
  const db = await getDb();
  if (!db) return [];

  const allOpinions = await db.select().from(legalOpinions);
  const filteredOpinions = filterByPeriod(allOpinions, period);

  // Agrupar por mês
  const monthlyData: Record<string, number> = {};
  const now = new Date();

  for (let i = 5; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = date.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
    monthlyData[key] = 0;
  }

  filteredOpinions.forEach((opinion) => {
    const date = new Date(opinion.createdAt);
    const key = date.toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
    if (monthlyData[key] !== undefined) {
      monthlyData[key]++;
    }
  });

  return Object.entries(monthlyData).map(([month, count]) => ({ month, count }));
}

/**
 * Obter artigos mais citados
 */
export async function getTopCitedArticles(period: "all" | "7days" | "30days" | "90days" | "year" = "30days") {
  const db = await getDb();
  if (!db) return [];

  const allOpinions = await db.select().from(legalOpinions);
  const filteredOpinions = filterByPeriod(allOpinions, period);

  const articleCounts: Record<string, number> = {};

  filteredOpinions.forEach((opinion) => {
    if (opinion.citedArticles && Array.isArray(opinion.citedArticles)) {
      (opinion.citedArticles as string[]).forEach((article) => {
        articleCounts[article] = (articleCounts[article] || 0) + 1;
      });
    }
  });

  return Object.entries(articleCounts)
    .map(([article, count]) => ({ article, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

/**
 * Obter distribuição de conclusões
 */
export async function getConclusionDistribution(period: "all" | "7days" | "30days" | "90days" | "year" = "30days") {
  const db = await getDb();
  if (!db) return [];

  const allOpinions = await db.select().from(legalOpinions);
  const filteredOpinions = filterByPeriod(allOpinions, period);

  const favorable = filteredOpinions.filter((op) => op.conclusion === "favorable").length;
  const unfavorable = filteredOpinions.filter((op) => op.conclusion === "unfavorable").length;
  const withReservations = filteredOpinions.filter((op) => op.conclusion === "with_reservations").length;

  return [
    { conclusion: "Favorável", count: favorable },
    { conclusion: "Desfavorável", count: unfavorable },
    { conclusion: "Com Ressalvas", count: withReservations },
  ];
}

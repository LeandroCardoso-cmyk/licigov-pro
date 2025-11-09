import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Processos licitatórios
 */
export const processes = mysqlTable("processes", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  object: text("object"), // Objeto da contratação
  estimatedValue: int("estimatedValue"), // Valor estimado em centavos
  modality: varchar("modality", { length: 100 }), // Modalidade: pregão, concorrência, etc
  category: varchar("category", { length: 100 }), // Categoria: obras, serviços, compras
  status: mysqlEnum("status", ["em_etp", "em_tr", "em_dfd", "em_edital", "concluido"]).default("em_etp").notNull(),
  ownerId: int("ownerId").notNull(), // Usuário que criou o processo
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Process = typeof processes.$inferSelect;
export type InsertProcess = typeof processes.$inferInsert;

/**
 * Documentos gerados (ETP, TR, DFD, Edital)
 */
export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  processId: int("processId").notNull(),
  type: mysqlEnum("type", ["etp", "tr", "dfd", "edital"]).notNull(),
  content: text("content"), // Conteúdo do documento em markdown ou HTML
  version: int("version").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

/**
 * Parâmetros do edital
 */
export const editalParameters = mysqlTable("edital_parameters", {
  id: int("id").autoincrement().primaryKey(),
  processId: int("processId").notNull().unique(),
  modalidade: varchar("modalidade", { length: 100 }), // Ex: Pregão, Concorrência
  formato: mysqlEnum("formato", ["presencial", "eletronico"]),
  criterioJulgamento: varchar("criterioJulgamento", { length: 100 }), // Ex: Menor preço, Melhor técnica
  regimeContratacao: varchar("regimeContratacao", { length: 100 }), // Ex: Empreitada por preço global
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type EditalParameter = typeof editalParameters.$inferSelect;
export type InsertEditalParameter = typeof editalParameters.$inferInsert;

/**
 * Configurações de personalização de documentos por usuário
 */
export const documentSettings = mysqlTable("documentSettings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // Cabeçalho
  organizationName: text("organizationName"),
  logoUrl: text("logoUrl"),
  address: text("address"),
  cnpj: varchar("cnpj", { length: 18 }),
  // Rodapé
  phone: varchar("phone", { length: 20 }),
  email: varchar("email", { length: 320 }),
  website: varchar("website", { length: 255 }),
  footerText: text("footerText"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DocumentSettings = typeof documentSettings.$inferSelect;
export type InsertDocumentSettings = typeof documentSettings.$inferInsert;

/**
 * Membros de processos (colaboração)
 */
export const processMembers = mysqlTable("process_members", {
  id: int("id").autoincrement().primaryKey(),
  processId: int("processId").notNull(),
  userId: int("userId").notNull(),
  permission: mysqlEnum("permission", ["viewer", "editor", "approver", "owner"]).default("viewer").notNull(),
  invitedBy: int("invitedBy").notNull(), // ID do usuário que convidou
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProcessMember = typeof processMembers.$inferSelect;
export type InsertProcessMember = typeof processMembers.$inferInsert;

/**
 * Notificações
 */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: mysqlEnum("type", ["member_added", "document_edited", "document_approved", "comment_added", "general"]).default("general").notNull(),
  processId: int("processId"), // Opcional: link para processo relacionado
  documentId: int("documentId"), // Opcional: link para documento relacionado
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
 * Comentários em documentos
 */
export const comments = mysqlTable("comments", {
  id: int("id").autoincrement().primaryKey(),
  documentId: int("documentId").notNull(),
  processId: int("processId").notNull(),
  userId: int("userId").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Comment = typeof comments.$inferSelect;
export type InsertComment = typeof comments.$inferInsert;

/**
 * Consentimentos LGPD
 */
export const userConsents = mysqlTable("user_consents", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  consentType: mysqlEnum("consentType", ["terms_of_use", "privacy_policy", "data_processing"]).notNull(),
  version: varchar("version", { length: 20 }).notNull(), // ex: "1.0", "1.1"
  accepted: boolean("accepted").default(true).notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UserConsent = typeof userConsents.$inferSelect;
export type InsertUserConsent = typeof userConsents.$inferInsert;

/**
 * Logs de auditoria administrativa
 */
export const auditLogs = mysqlTable("audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  adminId: int("adminId").notNull(), // ID do admin que executou a ação
  targetUserId: int("targetUserId"), // ID do usuário afetado (se aplicável)
  action: mysqlEnum("action", [
    "promote_to_admin",
    "demote_from_admin",
    "deactivate_user",
    "activate_user",
    "delete_user",
    "view_user_data",
    "export_user_data",
    "other"
  ]).notNull(),
  details: text("details"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

/**
 * Log de atividades
 */
export const activityLogs = mysqlTable("activity_logs", {
  id: int("id").autoincrement().primaryKey(),
  processId: int("processId").notNull(),
  userId: int("userId").notNull(),
  action: varchar("action", { length: 255 }).notNull(), // Ex: "criou o ETP", "editou o TR"
  details: text("details"), // Detalhes adicionais em JSON
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ActivityLog = typeof activityLogs.$inferSelect;
export type InsertActivityLog = typeof activityLogs.$inferInsert;

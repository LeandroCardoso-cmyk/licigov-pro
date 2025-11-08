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
 * Colaboradores em processos
 */
export const processCollaborators = mysqlTable("process_collaborators", {
  id: int("id").autoincrement().primaryKey(),
  processId: int("processId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["administrador", "editor", "leitor"]).default("leitor").notNull(),
  invitedBy: int("invitedBy").notNull(), // ID do usuário que fez o convite
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ProcessCollaborator = typeof processCollaborators.$inferSelect;
export type InsertProcessCollaborator = typeof processCollaborators.$inferInsert;

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

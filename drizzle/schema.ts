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

/**
 * Planos de assinatura disponíveis
 */
export const subscriptionPlans = mysqlTable("subscription_plans", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(), // Ex: "Individual", "Municipal Básico"
  slug: varchar("slug", { length: 100 }).notNull().unique(), // Ex: "individual", "municipal-basico"
  description: text("description"),
  price: int("price").notNull(), // Preço em centavos (R$ 97,00 = 9700)
  interval: mysqlEnum("interval", ["monthly", "yearly"]).default("monthly").notNull(),
  // Limites do plano
  maxUsers: int("maxUsers").default(1).notNull(), // -1 = ilimitado
  maxProcessesPerMonth: int("maxProcessesPerMonth").default(10).notNull(), // -1 = ilimitado
  maxStorageGB: int("maxStorageGB").default(2).notNull(), // -1 = ilimitado
  // Módulos habilitados
  hasDocumentGeneration: boolean("hasDocumentGeneration").default(true).notNull(),
  hasDirectContracting: boolean("hasDirectContracting").default(false).notNull(),
  hasLegalOpinion: boolean("hasLegalOpinion").default(false).notNull(),
  hasPCA: boolean("hasPCA").default(false).notNull(),
  hasContracts: boolean("hasContracts").default(false).notNull(),
  hasDepartmentManagement: boolean("hasDepartmentManagement").default(false).notNull(),
  // Recursos
  hasCollaboration: boolean("hasCollaboration").default(false).notNull(),
  hasComments: boolean("hasComments").default(false).notNull(),
  hasVersioning: boolean("hasVersioning").default(false).notNull(),
  hasPrioritySupport: boolean("hasPrioritySupport").default(false).notNull(),
  hasSLA: boolean("hasSLA").default(false).notNull(),
  // Metadata
  isActive: boolean("isActive").default(true).notNull(),
  stripeProductId: varchar("stripeProductId", { length: 255 }), // ID do produto no Stripe
  stripePriceId: varchar("stripePriceId", { length: 255 }), // ID do preço no Stripe
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SubscriptionPlan = typeof subscriptionPlans.$inferSelect;
export type InsertSubscriptionPlan = typeof subscriptionPlans.$inferInsert;

/**
 * Assinaturas dos usuários
 */
export const subscriptions = mysqlTable("subscriptions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  planId: int("planId").notNull(),
  status: mysqlEnum("status", [
    "active",
    "canceled",
    "past_due",
    "unpaid",
    "trialing",
    "incomplete"
  ]).default("active").notNull(),
  // Stripe
  stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }).unique(),
  stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
  // Datas
  currentPeriodStart: timestamp("currentPeriodStart"),
  currentPeriodEnd: timestamp("currentPeriodEnd"),
  trialStart: timestamp("trialStart"),
  trialEnd: timestamp("trialEnd"),
  canceledAt: timestamp("canceledAt"),
  cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = typeof subscriptions.$inferInsert;

/**
 * Rastreamento de uso (para limites)
 */
export const usageTracking = mysqlTable("usage_tracking", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  month: varchar("month", { length: 7 }).notNull(), // Ex: "2025-01"
  processesCreated: int("processesCreated").default(0).notNull(),
  storageUsedMB: int("storageUsedMB").default(0).notNull(),
  activeUsers: int("activeUsers").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UsageTracking = typeof usageTracking.$inferSelect;
export type InsertUsageTracking = typeof usageTracking.$inferInsert;

/**
 * Histórico de pagamentos
 */
export const payments = mysqlTable("payments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  subscriptionId: int("subscriptionId").notNull(),
  amount: int("amount").notNull(), // Valor em centavos
  currency: varchar("currency", { length: 3 }).default("BRL").notNull(),
  status: mysqlEnum("status", ["succeeded", "pending", "failed", "refunded"]).default("pending").notNull(),
  stripePaymentIntentId: varchar("stripePaymentIntentId", { length: 255 }).unique(),
  stripeInvoiceId: varchar("stripeInvoiceId", { length: 255 }),
  invoiceUrl: text("invoiceUrl"), // URL da nota fiscal
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

/**
 * Base de conhecimento para RAG (preparada para futuro)
 */
export const knowledgeBase = mysqlTable("knowledge_base", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"), // null = conhecimento global (leis, jurisprudência)
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  type: mysqlEnum("type", ["law", "jurisprudence", "template", "user_document"]).notNull(),
  source: varchar("source", { length: 255 }), // Ex: "Lei 14.133/21 Art. 18"
  metadata: text("metadata"), // JSON com metadados adicionais
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type KnowledgeBase = typeof knowledgeBase.$inferSelect;
export type InsertKnowledgeBase = typeof knowledgeBase.$inferInsert;

/**
 * Embeddings de documentos para RAG (preparada para futuro)
 */
export const documentEmbeddings = mysqlTable("document_embeddings", {
  id: int("id").autoincrement().primaryKey(),
  knowledgeBaseId: int("knowledgeBaseId").notNull(),
  embedding: text("embedding").notNull(), // JSON array de vetores
  chunkIndex: int("chunkIndex").default(0).notNull(), // Índice do chunk (para documentos grandes)
  chunkText: text("chunkText").notNull(), // Texto do chunk
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DocumentEmbedding = typeof documentEmbeddings.$inferSelect;
export type InsertDocumentEmbedding = typeof documentEmbeddings.$inferInsert;

/**
 * Solicitações de proposta comercial
 */
export const proposalRequests = mysqlTable("proposal_requests", {
  id: int("id").autoincrement().primaryKey(),
  // Dados do órgão solicitante
  orgaoNome: varchar("orgaoNome", { length: 255 }).notNull(),
  orgaoCnpj: varchar("orgaoCnpj", { length: 18 }).notNull(),
  orgaoEndereco: text("orgaoEndereco").notNull(),
  orgaoCidade: varchar("orgaoCidade", { length: 100 }).notNull(),
  orgaoEstado: varchar("orgaoEstado", { length: 2 }).notNull(),
  orgaoCep: varchar("orgaoCep", { length: 9 }).notNull(),
  // Dados do responsável
  responsavelNome: varchar("responsavelNome", { length: 255 }).notNull(),
  responsavelCargo: varchar("responsavelCargo", { length: 100 }),
  responsavelEmail: varchar("responsavelEmail", { length: 320 }).notNull(),
  responsavelTelefone: varchar("responsavelTelefone", { length: 20 }).notNull(),
  // Plano solicitado
  planSlug: varchar("planSlug", { length: 50 }).notNull(),
  planName: varchar("planName", { length: 100 }).notNull(),
  planPrice: int("planPrice").notNull(), // Preço em centavos
  // Status da solicitação
  status: mysqlEnum("status", ["pending", "documents_sent", "empenho_received", "activated", "cancelled"])
    .default("pending")
    .notNull(),
  // Observações
  observacoes: text("observacoes"),
  // Dados do empenho (preenchido após receber)
  numeroEmpenho: varchar("numeroEmpenho", { length: 50 }),
  dataEmpenho: timestamp("dataEmpenho"),
  valorEmpenho: int("valorEmpenho"), // Valor em centavos
  // Documentos contratuais
  empenhoFileUrl: text("empenhoFileUrl"), // URL da nota de empenho no S3
  empenhoFileKey: varchar("empenhoFileKey", { length: 255 }), // Chave do arquivo no S3
  contratoFileUrl: text("contratoFileUrl"), // URL do contrato assinado no S3
  contratoFileKey: varchar("contratoFileKey", { length: 255 }), // Chave do arquivo no S3
  // Vigência contratual
  dataAssinatura: timestamp("dataAssinatura"), // Data de assinatura do contrato
  dataInicioVigencia: timestamp("dataInicioVigencia"), // Início da vigência
  dataFimVigencia: timestamp("dataFimVigencia"), // Término da vigência
  statusVigencia: mysqlEnum("statusVigencia", ["vigente", "vence_30_dias", "vence_60_dias", "vence_90_dias", "vencido"]).default("vigente"),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  activatedAt: timestamp("activatedAt"), // Quando a assinatura foi ativada
});

export type ProposalRequest = typeof proposalRequests.$inferSelect;
export type InsertProposalRequest = typeof proposalRequests.$inferInsert;

/**
 * Documentos da empresa (LiciGov Pro) para envio em propostas
 */
export const companyDocuments = mysqlTable("company_documents", {
  id: int("id").autoincrement().primaryKey(),
  // Tipo de documento
  type: mysqlEnum("type", [
    "contrato_social",
    "cartao_cnpj",
    "certidao_federal",
    "certidao_estadual",
    "certidao_municipal",
    "certidao_fgts",
    "certidao_trabalhista",
    "alvara_funcionamento",
    "outros"
  ]).notNull(),
  name: varchar("name", { length: 255 }).notNull(), // Nome do documento
  description: text("description"), // Descrição opcional
  // Arquivo
  fileUrl: text("fileUrl").notNull(), // URL do arquivo no S3
  fileKey: varchar("fileKey", { length: 255 }).notNull(), // Chave do arquivo no S3
  fileName: varchar("fileName", { length: 255 }).notNull(), // Nome original do arquivo
  fileSize: int("fileSize").notNull(), // Tamanho em bytes
  mimeType: varchar("mimeType", { length: 100 }).notNull(),
  // Validade
  expiresAt: timestamp("expiresAt"), // null = sem validade (Contrato Social, CNPJ)
  status: mysqlEnum("status", ["valid", "expiring_soon", "expired"]).default("valid").notNull(),
  // Versão (para histórico)
  version: int("version").default(1).notNull(),
  previousVersionId: int("previousVersionId"), // ID da versão anterior
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  uploadedBy: int("uploadedBy").notNull(), // ID do admin que fez upload
});

export type CompanyDocument = typeof companyDocuments.$inferSelect;
export type InsertCompanyDocument = typeof companyDocuments.$inferInsert;

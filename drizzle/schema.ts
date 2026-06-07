import { int, mysqlEnum, mysqlTable, text, longtext, timestamp, varchar, boolean, json, decimal, primaryKey, unique, tinyint, smallint, double, datetime, bigint } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

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
  theme: mysqlEnum("theme", ["light", "dark", "system"]).default("system").notNull(),
  passwordHash: varchar("passwordHash", { length: 255 }),           // Hash bcrypt do login (auth próprio)
  signaturePassword: varchar("signaturePassword", { length: 255 }), // Hash bcrypt da senha de assinatura
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
  organizationId: int("organizationId"), // Sprint 1: nullable → NOT NULL em sprint futura
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  object: text("object"), // Objeto da contratação
  estimatedValue: int("estimatedValue"), // Valor estimado em centavos
  modality: varchar("modality", { length: 100 }), // Modalidade: pregão, concorrência, etc
  category: varchar("category", { length: 100 }), // Categoria: obras, serviços, compras
  platformId: int("platformId"), // Plataforma de pregão selecionada (Compras.gov.br, BLL, etc)
  status: mysqlEnum("status", ["em_dfd", "em_etp", "em_tr", "em_edital", "em_contrato", "em_ata", "em_parecer", "concluido"]).default("em_dfd").notNull(),
  ownerId: int("ownerId").notNull(), // Usuário que criou o processo
  // Sprint 1.8 — Optimistic locking
  version: int("version").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Process = typeof processes.$inferSelect;
export type InsertProcess = typeof processes.$inferInsert;

/**
/**
 * Documentos gerados (ETP, TR, DFD, Edital)
 */
export const documents = mysqlTable("documents", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"), // Sprint 1: nullable → NOT NULL em sprint futura
  processId: int("processId").notNull(),
  // Sprint 2: tipo estendido com aditivo + minuta
  type: mysqlEnum("type", ["etp", "tr", "dfd", "edital", "contrato", "ata", "parecer", "aditivo", "minuta"]).notNull(),
  title: varchar("title", { length: 500 }),
  content: text("content"), // Conteúdo legado em markdown (gerado por IA)
  structuredContent: json("structuredContent"), // Sprint 2: modelo estruturado (IA-ready)
  sourceType: mysqlEnum("sourceType", ["ai", "upload"]).default("ai").notNull(),
  s3Key: varchar("s3Key", { length: 500 }),
  fileUrl: varchar("fileUrl", { length: 1000 }),
  version: int("version").default(1).notNull(),
  currentVersionId: int("currentVersionId"),
  createdBy: int("createdBy"),
  updatedBy: int("updatedBy"),
  approvedBy: int("approvedBy"),
  // Sprint 2: status estendido com archived
  documentStatus: mysqlEnum("documentStatus", ["draft", "in_review", "approved", "rejected", "archived"]).default("draft").notNull(),
  // Sprint 2: edit locking
  isLocked: int("isLocked").default(0).notNull(),
  lockedBy: int("lockedBy"),
  lockReason: varchar("lockReason", { length: 255 }),
  lockExpiresAt: timestamp("lockExpiresAt"),
  // Sprint 2: metadata + archival
  metadata: json("metadata"),
  archivedAt: timestamp("archivedAt"),
  // Sprint 2.5: integrity
  contentHash:         varchar("contentHash",         { length: 64 }),
  snapshotFingerprint: varchar("snapshotFingerprint", { length: 64 }),
  // Sprint 2.5: retention
  retentionClass: varchar("retentionClass", { length: 50 }).default("operational_3years").notNull(),
  legalHold:      int("legalHold").default(0).notNull(),
  purgeAfter:     timestamp("purgeAfter"),
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
  functionalRole: mysqlEnum("functionalRole", ["solicitante", "compras", "juridico", "controle_interno", "gestor", "fiscal", "administrador"]),
  invitedBy: int("invitedBy").notNull(), // ID do usuário que convidou
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProcessMember = typeof processMembers.$inferSelect;
export type InsertProcessMember = typeof processMembers.$inferInsert;

/**
 * Responsáveis por etapa de documento (Fase 5 — Workflow Multiusuário)
 */
export const stageAssignments = mysqlTable("stage_assignments", {
  id: int("id").autoincrement().primaryKey(),
  processId: int("processId").notNull(),
  docType: mysqlEnum("docType", ["dfd", "etp", "tr", "edital", "contrato", "ata", "parecer"]).notNull(),
  assignedUserId: int("assignedUserId").notNull(),
  assignedBy: int("assignedBy").notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type StageAssignment = typeof stageAssignments.$inferSelect;
export type InsertStageAssignment = typeof stageAssignments.$inferInsert;

/**
 * Notificações
 */
export const notifications = mysqlTable("notifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: mysqlEnum("type", ["member_added", "document_edited", "document_approved", "comment_added", "stage_assigned", "general"]).default("general").notNull(),
  processId: int("processId"), // Opcional: link para processo relacionado
  documentId: int("documentId"), // Opcional: link para documento relacionado
  isRead: boolean("isRead").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

/**
/**
 * Comentários em documentos — Sprint 2: threading, resolução e ancoragem
 */
export const comments = mysqlTable("comments", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"),
  // Sprint 2: threading
  parentId: int("parentId"),
  // Sprint 2: ancoragem em seção do documento
  anchorSection: varchar("anchorSection", { length: 100 }),
  // Sprint 2: status de resolução
  status: mysqlEnum("status", ["open", "resolved", "dismissed"]).default("open").notNull(),
  resolvedBy: int("resolvedBy"),
  resolvedAt: timestamp("resolvedAt"),
  resolvedNote: text("resolvedNote"),
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
  organizationId: int("organizationId"),
  correlationId: varchar("correlationId", { length: 36 }),
  requestId: varchar("requestId", { length: 36 }),
  actorName: varchar("actorName", { length: 255 }),
  // Sprint 1.5 — snapshots imutáveis (sobrevivem a mutações do usuário/org)
  actorEmail: varchar("actorEmail", { length: 320 }),
  actorRole: varchar("actorRole", { length: 50 }),
  orgName: varchar("orgName", { length: 255 }),
  sourceContext: mysqlEnum("sourceContext", ["api", "job", "system", "test", "webhook"]).default("api").notNull(),
  ipAddress: varchar("ipAddress", { length: 45 }),
  entityType: varchar("entityType", { length: 50 }),
  entityId: int("entityId"),
  processId: int("processId"), // nullable: suporta logs org-level sem processo
  userId: int("userId").notNull(),
  action: varchar("action", { length: 255 }).notNull(),
  details: text("details"),
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
  // Campos de renovação (para contratos via empenho)
  renewalCount: int("renewalCount").default(0).notNull(), // Número de renovações (máx 9 = 10 anos total)
  originalStartDate: timestamp("originalStartDate"), // Data inicial do contrato original
  lastRenewalDate: timestamp("lastRenewalDate"), // Data da última renovação
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

/**
 * Parcelas mensais de assinaturas (para pagamento por empenho)
 */

/**
 * Histórico de renovações de contratos (empenho)
 */
export const contractRenewals = mysqlTable("contract_renewals", {
  id: int("id").autoincrement().primaryKey(),
  subscriptionId: int("subscriptionId").notNull(), // Referência à assinatura
  renewalNumber: int("renewalNumber").notNull(), // Número da renovação (1, 2, 3... até 9)
  previousEndDate: timestamp("previousEndDate").notNull(), // Data de fim anterior
  newEndDate: timestamp("newEndDate").notNull(), // Nova data de fim (+ 12 meses)
  // Documentos da renovação
  termoAditivoFileUrl: text("termoAditivoFileUrl"), // URL do termo aditivo
  termoAditivoFileKey: text("termoAditivoFileKey"), // Chave S3 do termo aditivo
  numeroEmpenho: varchar("numeroEmpenho", { length: 100 }), // Número do novo empenho (se houver)
  valorRenovacao: int("valorRenovacao"), // Valor da renovação em centavos
  // Auditoria
  renewedBy: int("renewedBy").notNull(), // ID do admin que fez a renovação
  observacoes: text("observacoes"), // Observações sobre a renovação
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ContractRenewal = typeof contractRenewals.$inferSelect;
export type InsertContractRenewal = typeof contractRenewals.$inferInsert;

/**
/**
 * Templates personalizáveis para documentos — Sprint 2: multi-tenant + structured
 */
export const documentTemplates = mysqlTable("document_templates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  // Sprint 2: suporte multi-tenant (null = template global)
  organizationId: int("organizationId"),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  // Sprint 2: tipo estendido
  type: mysqlEnum("type", ["etp", "tr", "dfd", "edital", "contrato", "ata", "parecer", "aditivo", "minuta"]).notNull(),
  content: text("content").notNull(),
  // Sprint 2: modelo estruturado com placeholders e variáveis
  structuredContent: json("structuredContent"),
  variables: json("variables"),
  isDefault: int("isDefault").default(0).notNull(),
  // Sprint 2: versionamento de templates
  version: int("version").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DocumentTemplate = typeof documentTemplates.$inferSelect;
export type InsertDocumentTemplate = typeof documentTemplates.$inferInsert;

/**
 * Itens CATMAT/CATSER selecionados para processos
 */
export const processItems = mysqlTable("process_items", {
  id: int("id").autoincrement().primaryKey(),
  processId: int("processId").notNull(), // Referência ao processo
  itemType: mysqlEnum("itemType", ["material", "service"]).notNull(), // Material (CATMAT) ou Serviço (CATSER)
  // Dados do CATMAT/CATSER
  catmatCode: int("catmatCode"), // Código CATMAT (se material)
  catserCode: int("catserCode"), // Código CATSER (se serviço)
  description: text("description").notNull(), // Descrição detalhada do item
  unit: varchar("unit", { length: 50 }).notNull(), // Unidade de medida/fornecimento
  // Dados adicionais (opcionais)
  groupCode: int("groupCode"), // Código do grupo
  groupDescription: text("groupDescription"), // Descrição do grupo
  classCode: int("classCode"), // Código da classe
  classDescription: text("classDescription"), // Descrição da classe
  // Quantidade e preço (preenchidos pelo usuário)
  quantity: int("quantity"), // Quantidade estimada
  estimatedPrice: int("estimatedPrice"), // Preço estimado em centavos
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ProcessItem = typeof processItems.$inferSelect;
export type InsertProcessItem = typeof processItems.$inferInsert;


/**
 * ========================================
 * MÓDULO DE GESTÃO DO DEPARTAMENTO
 * ========================================
 */

/**
 * Tarefas do departamento de licitações
 */
export const tasks = mysqlTable("tasks", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"), // Sprint 1: nullable → NOT NULL em sprint futura
  title: varchar("title", { length: 200 }).notNull(), // Título da tarefa
  description: text("description"), // Descrição detalhada
  type: varchar("type", { length: 50 }).notNull(), // Tipo de atividade (Pregão Eletrônico, Análise de Documentação, etc.)
  status: mysqlEnum("status", [
    "pendente",
    "em_andamento",
    "pausada",
    "atrasada",
    "aguardando_informacao",
    "concluida",
    "cancelada"
  ]).default("pendente").notNull(),
  priority: mysqlEnum("priority", ["baixa", "media", "alta", "urgente"]).default("media").notNull(),
  assignedTo: int("assignedTo").notNull(), // ID do usuário responsável
  deadline: timestamp("deadline"), // Prazo final
  processId: int("processId"), // Vinculação com processo licitatório (opcional)
  tags: text("tags"), // JSON array de tags personalizadas
  createdBy: int("createdBy").notNull(), // Usuário que criou
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Task = typeof tasks.$inferSelect;
export type InsertTask = typeof tasks.$inferInsert;

/**
 * Comentários em tarefas
 */
export const taskComments = mysqlTable("task_comments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(), // Referência à tarefa
  userId: int("userId").notNull(), // Usuário que comentou
  content: text("content").notNull(), // Conteúdo do comentário
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskComment = typeof taskComments.$inferSelect;
export type InsertTaskComment = typeof taskComments.$inferInsert;

/**
 * Anexos de tarefas
 */
export const taskAttachments = mysqlTable("task_attachments", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(), // Referência à tarefa
  fileName: varchar("fileName", { length: 255 }).notNull(), // Nome do arquivo
  fileUrl: varchar("fileUrl", { length: 500 }).notNull(), // URL do arquivo no S3
  fileSize: int("fileSize"), // Tamanho em bytes
  uploadedBy: int("uploadedBy").notNull(), // Usuário que fez upload
  uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
});

export type TaskAttachment = typeof taskAttachments.$inferSelect;
export type InsertTaskAttachment = typeof taskAttachments.$inferInsert;

/**
 * Histórico de alterações em tarefas
 */
export const taskHistory = mysqlTable("task_history", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull(), // Referência à tarefa
  userId: int("userId").notNull(), // Usuário que fez a alteração
  action: varchar("action", { length: 100 }).notNull(), // Tipo de ação (criou, editou, comentou, etc.)
  details: text("details"), // JSON com detalhes da alteração (valores antigos e novos)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskHistory = typeof taskHistory.$inferSelect;
export type InsertTaskHistory = typeof taskHistory.$inferInsert;

/**
 * Locks de edição colaborativa
 */
export const taskEditLocks = mysqlTable("task_edit_locks", {
  id: int("id").autoincrement().primaryKey(),
  taskId: int("taskId").notNull().unique(), // Referência à tarefa (único por tarefa)
  userId: int("userId").notNull(), // Usuário que está editando
  userName: varchar("userName", { length: 100 }).notNull(), // Nome do usuário (para exibição)
  expiresAt: timestamp("expiresAt").notNull(), // Quando o lock expira (5 minutos)
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TaskEditLock = typeof taskEditLocks.$inferSelect;
export type InsertTaskEditLock = typeof taskEditLocks.$inferInsert;

/**
 * Chunks da Lei 14.133/21 para sistema RAG
 */
export const lawChunks = mysqlTable("law_chunks", {
  id: int("id").autoincrement().primaryKey(),
  lawName: varchar("lawName", { length: 100 }).notNull(), // "Lei 14.133/21"
  chunkIndex: int("chunkIndex").notNull(), // Ordem do chunk
  articleNumber: varchar("articleNumber", { length: 20 }), // "Art. 6º"
  content: text("content").notNull(), // Texto do chunk
  embedding: json("embedding").notNull(), // Vector de embeddings
  metadata: json("metadata"), // { section: "...", topic: "..." }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type LawChunk = typeof lawChunks.$inferSelect;
export type InsertLawChunk = typeof lawChunks.$inferInsert;

/**
 * Sugestões de códigos CATMAT/CATSER geradas por IA
 */
export const catmatSuggestions = mysqlTable("catmat_suggestions", {
  id: int("id").autoincrement().primaryKey(),
  processItemId: int("processItemId").notNull(), // FK para processItems
  catmatCode: varchar("catmatCode", { length: 20 }).notNull(),
  description: text("description").notNull(),
  confidenceScore: int("confidenceScore").notNull(), // 0-100
  reasoning: text("reasoning"), // Explicação da IA
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CatmatSuggestion = typeof catmatSuggestions.$inferSelect;
export type InsertCatmatSuggestion = typeof catmatSuggestions.$inferInsert;

/**
 * Rastreamento de uso de IA (custos e métricas)
 */
export const aiUsageTracking = mysqlTable("ai_usage_tracking", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // Usuário que executou a operação
  processId: int("processId"), // Processo relacionado (opcional)
  operationType: mysqlEnum("operationType", [
    "embedding", // Geração de embeddings
    "rag_query", // Consulta RAG
    "catmat_matching", // Matching CATMAT com IA
    "document_generation", // Geração de documentos (ETP, TR, DFD, Edital)
  ]).notNull(),
  model: varchar("model", { length: 50 }).notNull(), // "text-embedding-004", "gemini-1.5-flash", etc
  inputTokens: int("inputTokens").notNull(), // Tokens de entrada
  outputTokens: int("outputTokens").notNull(), // Tokens de saída
  estimatedCostUSD: decimal("estimatedCostUSD", { precision: 10, scale: 6 }).notNull(), // Custo estimado em USD
  metadata: json("metadata"), // { documentType: "ETP", itemsCount: 10, etc }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AIUsageTracking = typeof aiUsageTracking.$inferSelect;
export type InsertAIUsageTracking = typeof aiUsageTracking.$inferInsert;

/**
 * Cache de embeddings para queries frequentes
 * Reduz custos de API armazenando embeddings de textos já processados
 */
export const embeddingCache = mysqlTable("embedding_cache", {
  id: int("id").autoincrement().primaryKey(),
  textHash: varchar("textHash", { length: 64 }).notNull().unique(), // SHA-256 do texto
  text: text("text").notNull(), // Texto original (para debug)
  embedding: json("embedding").notNull(), // Vector de embeddings
  model: varchar("model", { length: 50 }).notNull(), // "text-embedding-004"
  hitCount: int("hitCount").default(0).notNull(), // Número de vezes que foi reutilizado
  lastUsedAt: timestamp("lastUsedAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type EmbeddingCache = typeof embeddingCache.$inferSelect;
export type InsertEmbeddingCache = typeof embeddingCache.$inferInsert;

/**
 * Plataformas de pregão eletrônico
 * Armazena informações sobre plataformas (Compras.gov.br, BLL, Licitanet, BBMnet, etc)
 */
export const platforms = mysqlTable("platforms", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(), // Ex: "Compras.gov.br"
  slug: varchar("slug", { length: 100 }).notNull().unique(), // Ex: "compras-gov-br"
  description: text("description"), // Descrição da plataforma
  logoUrl: text("logoUrl"), // URL do logo da plataforma
  websiteUrl: text("websiteUrl"), // URL do site da plataforma
  // Configurações específicas da plataforma
  config: json("config"), // { requiresLogin: true, supportedModalities: ["pregao", "concorrencia"], etc }
  // Integração API (Nível 3 - Futuro)
  hasApiIntegration: boolean("hasApiIntegration").default(false).notNull(),
  apiBaseUrl: text("apiBaseUrl"), // URL base da API
  apiAuthType: mysqlEnum("apiAuthType", ["none", "api_key", "oauth2", "basic_auth"]),
  apiDocumentationUrl: text("apiDocumentationUrl"), // URL da documentação da API
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  displayOrder: int("displayOrder").default(0).notNull(), // Ordem de exibição
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Platform = typeof platforms.$inferSelect;
export type InsertPlatform = typeof platforms.$inferInsert;

/**
 * Templates de documentos específicos por plataforma
 * Armazena variações de templates (ETP, TR, DFD, Edital) adaptadas para cada plataforma
 */
export const platformTemplates = mysqlTable("platform_templates", {
  id: int("id").autoincrement().primaryKey(),
  platformId: int("platformId").notNull(), // Referência à plataforma
  documentType: mysqlEnum("documentType", ["etp", "tr", "dfd", "edital"]).notNull(),
  name: varchar("name", { length: 255 }).notNull(), // Ex: "Template Edital BLL Compras"
  description: text("description"), // Descrição do template
  // Conteúdo do template (instruções para IA)
  templateInstructions: text("templateInstructions").notNull(), // Instruções específicas para IA adaptar o documento
  // Metadados específicos da plataforma
  metadata: json("metadata"), // { requiredFields: [], formatRules: {}, annexNaming: {}, etc }
  // Cláusulas obrigatórias
  mandatoryClauses: json("mandatoryClauses"), // Array de cláusulas obrigatórias específicas da plataforma
  // Nomenclaturas específicas
  terminology: json("terminology"), // { "sessao_publica": "disputa de lances", "licitante": "fornecedor", etc }
  // Versão do template
  version: int("version").default(1).notNull(),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlatformTemplate = typeof platformTemplates.$inferSelect;
export type InsertPlatformTemplate = typeof platformTemplates.$inferInsert;

/**
 * Checklists de publicação por plataforma
 * Guia passo-a-passo para publicar edital em cada plataforma
 */
export const platformChecklists = mysqlTable("platform_checklists", {
  id: int("id").autoincrement().primaryKey(),
  platformId: int("platformId").notNull(), // Referência à plataforma
  stepNumber: int("stepNumber").notNull(), // Ordem do passo (1, 2, 3...)
  title: varchar("title", { length: 255 }).notNull(), // Ex: "Login na plataforma"
  description: text("description").notNull(), // Descrição detalhada do passo
  // Campos a serem preenchidos neste passo
  fields: json("fields"), // [{ name: "numero_processo", label: "Número do Processo", copyFrom: "process.name" }]
  // Documentos a serem anexados neste passo
  requiredDocuments: json("requiredDocuments"), // [{ type: "edital", filename: "EDITAL_PREGAO_001_2024.pdf" }]
  // URL ou screenshot de ajuda
  helpUrl: text("helpUrl"), // URL de tutorial
  screenshotUrl: text("screenshotUrl"), // URL de screenshot do passo
  // Ordem e agrupamento
  category: varchar("category", { length: 100 }), // Ex: "Dados Básicos", "Upload de Documentos", "Configurações"
  isOptional: boolean("isOptional").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlatformChecklist = typeof platformChecklists.$inferSelect;
export type InsertPlatformChecklist = typeof platformChecklists.$inferInsert;

/**
 * Configurações de API por plataforma (Nível 3 - Futuro)
 * Armazena credenciais e configurações de integração API
 */
export const platformApiConfigs = mysqlTable("platform_api_configs", {
  id: int("id").autoincrement().primaryKey(),
  platformId: int("platformId").notNull().unique(), // Referência à plataforma
  // Credenciais (armazenar criptografadas em produção)
  apiKey: text("apiKey"), // API Key
  apiSecret: text("apiSecret"), // API Secret
  clientId: text("clientId"), // OAuth Client ID
  clientSecret: text("clientSecret"), // OAuth Client Secret
  accessToken: text("accessToken"), // Token de acesso (OAuth)
  refreshToken: text("refreshToken"), // Token de refresh (OAuth)
  tokenExpiresAt: timestamp("tokenExpiresAt"), // Expiração do token
  // Configurações adicionais
  webhookUrl: text("webhookUrl"), // URL para receber webhooks da plataforma
  webhookSecret: text("webhookSecret"), // Secret para validar webhooks
  // Status
  isActive: boolean("isActive").default(false).notNull(),
  lastTestedAt: timestamp("lastTestedAt"), // Última vez que a conexão foi testada
  lastTestStatus: mysqlEnum("lastTestStatus", ["success", "failed", "not_tested"]).default("not_tested"),
  lastTestError: text("lastTestError"), // Mensagem de erro do último teste
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlatformApiConfig = typeof platformApiConfigs.$inferSelect;
export type InsertPlatformApiConfig = typeof platformApiConfigs.$inferInsert;

/**
 * Publicações de processos em plataformas (Nível 3 - Futuro)
 * Rastreia processos publicados via API em plataformas externas
 */
export const platformPublications = mysqlTable("platform_publications", {
  id: int("id").autoincrement().primaryKey(),
  processId: int("processId").notNull(), // Referência ao processo
  platformId: int("platformId").notNull(), // Referência à plataforma
  // Identificadores externos
  externalId: varchar("externalId", { length: 255 }), // ID do pregão na plataforma externa
  externalUrl: text("externalUrl"), // URL do pregão na plataforma externa
  // Status da publicação
  status: mysqlEnum("status", [
    "draft", // Rascunho criado
    "published", // Publicado com sucesso
    "scheduled", // Agendado para publicação
    "failed", // Falha na publicação
    "cancelled", // Cancelado
    "closed" // Encerrado
  ]).default("draft").notNull(),
  // Dados da publicação
  publishedAt: timestamp("publishedAt"), // Data/hora da publicação
  scheduledFor: timestamp("scheduledFor"), // Data/hora agendada (se aplicável)
  closedAt: timestamp("closedAt"), // Data/hora de encerramento
  // Resposta da API
  apiResponse: json("apiResponse"), // Resposta completa da API (para debug)
  errorMessage: text("errorMessage"), // Mensagem de erro (se houver)
  // Metadados
  metadata: json("metadata"), // { proposalCount: 5, winnerCompany: "...", etc }
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type PlatformPublication = typeof platformPublications.$inferSelect;
export type InsertPlatformPublication = typeof platformPublications.$inferInsert;

/**
 * Notificações recebidas de plataformas via webhook (Nível 3 - Futuro)
 * Armazena eventos recebidos das plataformas (nova proposta, impugnação, etc)
 */
export const platformNotifications = mysqlTable("platform_notifications", {
  id: int("id").autoincrement().primaryKey(),
  publicationId: int("publicationId").notNull(), // Referência à publicação
  platformId: int("platformId").notNull(), // Referência à plataforma
  // Tipo de notificação
  type: mysqlEnum("type", [
    "new_proposal", // Nova proposta recebida
    "proposal_updated", // Proposta atualizada
    "impugnation", // Impugnação recebida
    "clarification_request", // Pedido de esclarecimento
    "session_started", // Sessão pública iniciada
    "session_ended", // Sessão pública encerrada
    "winner_declared", // Vencedor declarado
    "other" // Outro tipo
  ]).notNull(),
  // Conteúdo da notificação
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  // Dados brutos do webhook
  webhookPayload: json("webhookPayload"), // Payload completo do webhook
  // Status
  isRead: boolean("isRead").default(false).notNull(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PlatformNotification = typeof platformNotifications.$inferSelect;
export type InsertPlatformNotification = typeof platformNotifications.$inferInsert;


/**
 * ========================================
 * MÓDULO: CONTRATAÇÃO DIRETA
 * ========================================
 * Tabelas para gerenciar dispensas e inexigibilidades de licitação
 */

/**
 * Artigos legais para enquadramento de contratações diretas
 * Base: Lei 14.133/2021 - Art. 74 (Inexigibilidade) e Art. 75 (Dispensa)
 */
export const directContractLegalArticles = mysqlTable("direct_contract_legal_articles", {
  id: int("id").autoincrement().primaryKey(),
  // Tipo de contratação
  type: mysqlEnum("type", ["dispensa", "inexigibilidade"]).notNull(),
  // Artigo e inciso
  article: varchar("article", { length: 20 }).notNull(), // Ex: "Art. 75, I"
  inciso: varchar("inciso", { length: 10 }), // Ex: "I", "II", "III"
  // Descrição legal
  description: text("description").notNull(), // Texto completo do artigo
  summary: varchar("summary", { length: 500 }).notNull(), // Resumo para exibição
  // Limites de valor (em centavos)
  valueLimit: int("valueLimit"), // Limite de valor (null = sem limite)
  // Exemplos práticos
  examples: json("examples"), // Array de exemplos de aplicação
  // Documentação obrigatória
  requiredDocuments: json("requiredDocuments"), // Array de documentos necessários
  // Status
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DirectContractLegalArticle = typeof directContractLegalArticles.$inferSelect;
export type InsertDirectContractLegalArticle = typeof directContractLegalArticles.$inferInsert;

/**
 * Contratações diretas (dispensas e inexigibilidades)
 */
export const directContracts = mysqlTable("direct_contracts", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"), // Sprint 1: nullable → NOT NULL em sprint futura
  // Vinculação com processo (se houver)
  processId: int("processId"), // FK para processes (opcional)
  // Identificação
  number: varchar("number", { length: 50 }).notNull(), // Ex: "001/2025"
  year: int("year").notNull(),
  // Tipo de contratação
  type: mysqlEnum("type", ["dispensa", "inexigibilidade"]).notNull(),
  // Enquadramento legal
  legalArticleId: int("legalArticleId").notNull(), // FK para direct_contract_legal_articles
  // Dados da contratação
  object: text("object").notNull(), // Objeto da contratação
  justification: text("justification").notNull(), // Justificativa legal
  value: int("value").notNull(), // Valor estimado (em centavos)
  executionDeadline: int("executionDeadline"), // Prazo de execução (em dias)
  // Fornecedor (obrigatório em inexigibilidade, opcional em dispensa)
  supplierName: varchar("supplierName", { length: 255 }),
  supplierCNPJ: varchar("supplierCNPJ", { length: 18 }),
  supplierAddress: text("supplierAddress"),
  supplierContact: varchar("supplierContact", { length: 100 }),
  // Modo de execução
  mode: mysqlEnum("mode", ["presencial", "eletronico"]).default("presencial").notNull(),
  platformId: int("platformId"), // FK para platforms (se eletrônico)
  // Status
  status: mysqlEnum("status", [
    "draft", // Rascunho
    "pending_approval", // Aguardando aprovação
    "approved", // Aprovado
    "published", // Publicado
    "in_execution", // Em execução
    "completed", // Concluído
    "cancelled" // Cancelado
  ]).default("draft").notNull(),
  // Datas
  approvedAt: timestamp("approvedAt"),
  publishedAt: timestamp("publishedAt"),
  ratifiedAt: timestamp("ratifiedAt"), // Data de ratificação
  completedAt: timestamp("completedAt"),
  // Metadados
  metadata: json("metadata"), // { urgency: "alta", category: "obras", etc }
  // Responsável
  createdBy: int("createdBy").notNull(), // FK para users
  approvedBy: int("approvedBy"), // FK para users
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DirectContract = typeof directContracts.$inferSelect;
export type InsertDirectContract = typeof directContracts.$inferInsert;

/**
 * Documentos gerados para contratações diretas
 */
export const directContractDocuments = mysqlTable("direct_contract_documents", {
  id: int("id").autoincrement().primaryKey(),
  directContractId: int("directContractId").notNull(), // FK para direct_contracts
  // Tipo de documento
  type: mysqlEnum("type", [
    "termo_dispensa", // Termo de Dispensa
    "termo_inexigibilidade", // Termo de Inexigibilidade
    "dfd", // Documento de Formalização da Demanda
    "tr", // Termo de Referência
    "minuta_contrato", // Minuta de Contrato
    "planilha_cotacao", // Planilha de Cotação (3 orçamentos)
    "mapa_comparativo", // Mapa Comparativo de Preços
    "ata_ratificacao", // Ata de Ratificação
    "outro" // Outro tipo
  ]).notNull(),
  // Conteúdo
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(), // Conteúdo em Markdown
  // Versão
  version: int("version").default(1).notNull(),
  // Status
  status: mysqlEnum("status", ["draft", "final", "archived"]).default("draft").notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DirectContractDocument = typeof directContractDocuments.$inferSelect;
export type InsertDirectContractDocument = typeof directContractDocuments.$inferInsert;

/**
 * Cotações de preço (para dispensas que exigem 3 orçamentos)
 */
export const directContractQuotations = mysqlTable("direct_contract_quotations", {
  id: int("id").autoincrement().primaryKey(),
  directContractId: int("directContractId").notNull(), // FK para direct_contracts
  // Fornecedor
  supplierName: varchar("supplierName", { length: 255 }).notNull(),
  supplierCNPJ: varchar("supplierCNPJ", { length: 18 }),
  supplierContact: varchar("supplierContact", { length: 100 }),
  // Proposta
  value: int("value").notNull(), // Valor proposto (em centavos)
  deliveryDeadline: int("deliveryDeadline"), // Prazo de entrega (em dias)
  paymentTerms: varchar("paymentTerms", { length: 255 }), // Condições de pagamento
  // Arquivo da proposta
  attachmentUrl: varchar("attachmentUrl", { length: 500 }),
  // Observações
  notes: text("notes"),
  // Status
  isSelected: boolean("isSelected").default(false).notNull(), // Se foi o vencedor
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DirectContractQuotation = typeof directContractQuotations.$inferSelect;
export type InsertDirectContractQuotation = typeof directContractQuotations.$inferInsert;

/**
 * Logs de auditoria para contratações diretas
 * Registra todas as ações realizadas (criar, editar, gerar documento, download, etc)
 */
export const directContractAuditLogs = mysqlTable("direct_contract_audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  directContractId: int("directContractId").notNull(), // FK para direct_contracts
  // Ação realizada
  action: mysqlEnum("action", [
    "created", // Contratação criada
    "updated", // Contratação editada
    "status_changed", // Status alterado
    "document_generated", // Documento gerado
    "document_downloaded", // Documento baixado
    "quotation_added", // Cotação adicionada
    "quotation_deleted", // Cotação removida
    "package_generated", // Pacote presencial gerado
    "checklist_updated", // Checklist atualizado
    "approved", // Contratação aprovada
    "published", // Contratação publicada
    "ratified", // Contratação ratificada
    "completed", // Contratação concluída
  ]).notNull(),
  // Usuário que realizou a ação
  userId: int("userId").notNull(), // FK para users
  userName: varchar("userName", { length: 255 }), // Nome do usuário (cache)
  // Detalhes da ação (JSON)
  details: json("details"), // { documentType: "termo_dispensa", oldStatus: "draft", newStatus: "approved", etc }
  // Timestamp
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type DirectContractAuditLog = typeof directContractAuditLogs.$inferSelect;
export type InsertDirectContractAuditLog = typeof directContractAuditLogs.$inferInsert;
/**
 * Progresso do checklist de plataforma por contratação direta
 * Salva quais passos foram concluídos
 */
export const directContractChecklistProgress = mysqlTable("direct_contract_checklist_progress", {
  id: int("id").autoincrement().primaryKey(),
  directContractId: int("directContractId").notNull(), // FK para direct_contracts
  stepNumber: int("stepNumber").notNull(), // Número do passo (1, 2, 3, 4)
  isCompleted: boolean("isCompleted").default(false).notNull(),
  completedBy: int("completedBy"), // FK para users
  completedAt: timestamp("completedAt"),
  notes: text("notes"), // Observações sobre o passo
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DirectContractChecklistProgress = typeof directContractChecklistProgress.$inferSelect;
export type InsertDirectContractChecklistProgress = typeof directContractChecklistProgress.$inferInsert;

// ============================================================================
// MÓDULO DE CONTRATOS
// ============================================================================

/**
 * Contratos administrativos
 * Gerencia contratos originados de processos licitatórios ou contratações diretas
 */
export const contracts = mysqlTable("contracts", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"), // Sprint 1: nullable → NOT NULL em sprint futura
  // Número e identificação
  number: varchar("number", { length: 50 }).notNull().unique(), // Ex: "001/2025"
  year: int("year").notNull(),
  // Objeto
  object: text("object").notNull(), // Descrição do objeto contratado
  // Tipo de contrato
  type: mysqlEnum("type", [
    "fornecimento", // Fornecimento de materiais
    "servico", // Prestação de serviços
    "obra", // Execução de obra
    "concessao", // Concessão de serviço público
    "outro" // Outro tipo
  ]).notNull(),
  // Origem (opcional - pode ser criado manualmente)
  originType: mysqlEnum("originType", ["processo", "contratacao_direta", "manual"]),
  originId: int("originId"), // ID do processo ou contratação direta
  // Contratado
  contractorName: varchar("contractorName", { length: 255 }).notNull(),
  contractorCNPJ: varchar("contractorCNPJ", { length: 18 }),
  contractorAddress: text("contractorAddress"),
  contractorContact: varchar("contractorContact", { length: 100 }),
  // Valores
  value: int("value").notNull(), // Valor original (em centavos)
  currentValue: int("currentValue").notNull(), // Valor atual (após aditivos)
  // Vigência
  startDate: timestamp("startDate").notNull(), // Data de início
  endDate: timestamp("endDate").notNull(), // Data de término
  // Renovação automática
  autoRenewal: boolean("autoRenewal").default(false).notNull(),
  maxRenewals: int("maxRenewals").default(0), // Número máximo de renovações
  currentRenewals: int("currentRenewals").default(0), // Renovações já realizadas
  // Fiscal do contrato
  fiscalUserId: int("fiscalUserId"), // FK para users
  fiscalUserName: varchar("fiscalUserName", { length: 255 }),
  // Status
  status: mysqlEnum("status", [
    "draft", // Rascunho
    "active", // Ativo/Vigente
    "suspended", // Suspenso
    "terminated", // Rescindido
    "expired", // Vencido
    "completed" // Concluído
  ]).default("draft").notNull(),
  // Observações
  notes: text("notes"),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").notNull(), // FK para users
});

export type Contract = typeof contracts.$inferSelect;
export type InsertContract = typeof contracts.$inferInsert;

/**
 * Aditivos de contrato
 * Registra alterações de prazo, valor ou escopo
 */
export const contractAmendments = mysqlTable("contract_amendments", {
  id: int("id").autoincrement().primaryKey(),
  contractId: int("contractId").notNull(), // FK para contracts
  // Número do aditivo
  number: int("number").notNull(), // 1º, 2º, 3º aditivo
  // Tipo de aditivo
  type: mysqlEnum("type", [
    "prazo", // Aditivo de prazo
    "valor", // Aditivo de valor
    "escopo", // Aditivo de escopo/objeto
    "misto" // Aditivo misto (prazo + valor, etc)
  ]).notNull(),
  // Justificativa
  justification: text("justification").notNull(),
  // Alterações de prazo
  newEndDate: timestamp("newEndDate"), // Nova data de término
  daysAdded: int("daysAdded"), // Dias adicionados
  // Alterações de valor
  valueChange: int("valueChange"), // Valor adicionado/reduzido (em centavos)
  newTotalValue: int("newTotalValue"), // Novo valor total do contrato
  // Alterações de escopo
  scopeChanges: text("scopeChanges"), // Descrição das mudanças no escopo
  // Data de assinatura
  signedAt: timestamp("signedAt"),
  // Observações
  notes: text("notes"),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").notNull(), // FK para users
});

export type ContractAmendment = typeof contractAmendments.$inferSelect;
export type InsertContractAmendment = typeof contractAmendments.$inferInsert;

/**
 * Apostilamentos de contrato
 * Registra alterações que não exigem termo aditivo
 */
export const contractApostilles = mysqlTable("contract_apostilles", {
  id: int("id").autoincrement().primaryKey(),
  contractId: int("contractId").notNull(), // FK para contracts
  // Número do apostilamento
  number: int("number").notNull(), // 1º, 2º, 3º apostilamento
  // Tipo de apostilamento
  type: mysqlEnum("type", [
    "reajuste", // Reajuste de preços por índice
    "correcao", // Correção de dados cadastrais
    "designacao", // Designação de fiscal
    "outro" // Outro tipo
  ]).notNull(),
  // Descrição
  description: text("description").notNull(),
  // Valor (para reajustes)
  valueChange: int("valueChange"), // Valor do reajuste (em centavos)
  newTotalValue: int("newTotalValue"), // Novo valor total
  // Índice de reajuste (para reajustes)
  indexType: varchar("indexType", { length: 50 }), // IPCA, IGP-M, etc
  indexValue: varchar("indexValue", { length: 20 }), // Ex: "5.79%"
  // Data de assinatura
  signedAt: timestamp("signedAt"),
  // Observações
  notes: text("notes"),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdBy: int("createdBy").notNull(), // FK para users
});

export type ContractApostille = typeof contractApostilles.$inferSelect;
export type InsertContractApostille = typeof contractApostilles.$inferInsert;

/**
 * Documentos gerados para contratos
 */
export const contractDocuments = mysqlTable("contract_documents", {
  id: int("id").autoincrement().primaryKey(),
  contractId: int("contractId").notNull(), // FK para contracts
  // Tipo de documento
  type: mysqlEnum("type", [
    "minuta", // Minuta de contrato
    "aditivo", // Termo de aditivo
    "apostilamento", // Termo de apostilamento
    "rescisao", // Termo de rescisão
    "outro" // Outro tipo
  ]).notNull(),
  // Referência (para aditivos e apostilamentos)
  referenceId: int("referenceId"), // ID do aditivo ou apostilamento
  // Conteúdo
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(), // Conteúdo em Markdown
  // Versão
  version: int("version").default(1).notNull(),
  // Status
  status: mysqlEnum("status", ["draft", "final", "archived"]).default("draft").notNull(),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ContractDocument = typeof contractDocuments.$inferSelect;
export type InsertContractDocument = typeof contractDocuments.$inferInsert;

/**
 * Logs de auditoria para contratos
 * Registra todas as ações realizadas
 */
export const contractAuditLogs = mysqlTable("contract_audit_logs", {
  id: int("id").autoincrement().primaryKey(),
  contractId: int("contractId").notNull(), // FK para contracts
  // Ação realizada
  action: mysqlEnum("action", [
    "created", // Contrato criado
    "updated", // Contrato editado
    "status_changed", // Status alterado
    "amendment_added", // Aditivo adicionado
    "apostille_added", // Apostilamento adicionado
    "document_generated", // Documento gerado
    "document_downloaded", // Documento baixado
    "renewed", // Contrato renovado
    "suspended", // Contrato suspenso
    "terminated", // Contrato rescindido
    "completed", // Contrato concluído
  ]).notNull(),
  // Usuário que realizou a ação
  userId: int("userId").notNull(), // FK para users
  userName: varchar("userName", { length: 255 }), // Nome do usuário (cache)
  // Detalhes da ação (JSON)
  details: json("details"), // { documentType: "minuta", oldStatus: "draft", newStatus: "active", etc }
  // Timestamp
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ContractAuditLog = typeof contractAuditLogs.$inferSelect;
export type InsertContractAuditLog = typeof contractAuditLogs.$inferInsert;

/**
 * Pareceres Jurídicos
 * Análises jurídicas automatizadas com IA baseadas na Lei 14.133/2021
 */
export const legalOpinions = mysqlTable("legal_opinions", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId"), // Sprint 1: nullable → NOT NULL em sprint futura
  // Título e descrição
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  // Tipo de origem (processo licitatório ou contratação direta)
  sourceType: mysqlEnum("sourceType", ["process", "direct_contract", "contract", "other"]).notNull(),
  sourceId: int("sourceId"), // ID do processo, contratação direta ou contrato relacionado
  // Questão jurídica a ser analisada
  legalQuestion: text("legalQuestion").notNull(),
  // Contexto adicional fornecido pelo usuário
  context: text("context"),
  // Parecer gerado pela IA
  opinion: text("opinion"), // Conteúdo do parecer em Markdown
  // Conclusão (Favorável, Desfavorável, Com Ressalvas)
  conclusion: mysqlEnum("conclusion", ["favorable", "unfavorable", "with_reservations"]),
  // Artigos da Lei 14.133/2021 citados (JSON array)
  citedArticles: json("citedArticles"), // ["Art. 6º", "Art. 75", etc]
  // Jurisprudências citadas (JSON array)
  jurisprudence: json("jurisprudence"), // [{court: "TCU", number: "123/2022", summary: "..."}]
  // Status
  status: mysqlEnum("status", ["draft", "in_review", "approved", "archived"]).default("draft").notNull(),
  // Template (se este parecer é um template reutilizável)
  isTemplate: boolean("isTemplate").default(false).notNull(),
  // Número de assinaturas necessárias (1-3)
  requiredSignatures: int("requiredSignatures").default(1).notNull(),
  // Usuário que solicitou
  requestedBy: int("requestedBy").notNull(), // FK para users
  // Usuário que revisou (se houver)
  reviewedBy: int("reviewedBy"),
  reviewedAt: timestamp("reviewedAt"),
  // Timestamps
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LegalOpinion = typeof legalOpinions.$inferSelect;
export type InsertLegalOpinion = typeof legalOpinions.$inferInsert;

/**
 * Assinaturas Digitais
 * Sistema de assinatura digital para validação jurídica de documentos
 */
export const digitalSignatures = mysqlTable("digital_signatures", {
  id: int("id").autoincrement().primaryKey(),
  // Tipo de documento assinado
  documentType: mysqlEnum("documentType", ["legal_opinion", "contract", "amendment", "apostille", "rescission"]).notNull(),
  // ID do documento assinado
  documentId: int("documentId").notNull(),
  // Hash SHA-256 do conteúdo do documento
  contentHash: varchar("contentHash", { length: 64 }).notNull(),
  // Assinatura digital (simulada com hash + chave privada)
  signature: text("signature").notNull(),
  // Usuário que assinou
  signedBy: int("signedBy").notNull(), // FK para users
  signedByName: text("signedByName").notNull(),
  signedByEmail: varchar("signedByEmail", { length: 320 }),
  // Informações do certificado (simulado)
  certificateInfo: json("certificateInfo"), // { issuer: "...", validFrom: "...", validUntil: "..." }
  // Timestamp da assinatura
  signedAt: timestamp("signedAt").defaultNow().notNull(),
  // Validade da assinatura
  isValid: boolean("isValid").default(true).notNull(),
  // Observações
  notes: text("notes"),
});

export type DigitalSignature = typeof digitalSignatures.$inferSelect;
export type InsertDigitalSignature = typeof digitalSignatures.$inferInsert;

/**
 * Histórico de assinaturas digitais (múltiplas assinaturas por parecer)
 */
export const signatureHistory = mysqlTable("signature_history", {
  id: int("id").autoincrement().primaryKey(),
  // Parecer assinado
  opinionId: int("opinionId").notNull(), // FK para legalOpinions
  // Usuário que assinou
  userId: int("userId").notNull(), // FK para users
  userName: varchar("userName", { length: 255 }).notNull(), // Nome do usuário no momento da assinatura
  userEmail: varchar("userEmail", { length: 320 }), // Email do usuário no momento da assinatura
  // Role escolhido pelo assinante (Advogado Revisor, Advogado Responsável, Gestor Jurídico)
  signerRole: mysqlEnum("signerRole", ["revisor", "responsavel", "gestor"]).notNull(),
  // Hash SHA-256 do documento no momento da assinatura
  documentHash: varchar("documentHash", { length: 64 }).notNull(),
  // Assinatura criptográfica (hash assinado com chave privada simulada)
  signature: text("signature").notNull(),
  // Informações do certificado (simulado)
  certificateInfo: json("certificateInfo"),
  // Validação
  isValid: boolean("isValid").default(true).notNull(),
  // Timestamp
  signedAt: timestamp("signedAt").defaultNow().notNull(),
});

export type SignatureHistory = typeof signatureHistory.$inferSelect;
export type InsertSignatureHistory = typeof signatureHistory.$inferInsert;

// ============================================================================
// SPRINT 1 — MULTI-TENANT FOUNDATION
// ============================================================================

/**
 * Organizações (tenants)
 * Âncora do modelo multi-tenant. Cada organização é um município/órgão isolado.
 */
export const organizations = mysqlTable("organizations", {
  id: int("id").autoincrement().primaryKey(),
  nome: varchar("nome", { length: 255 }).notNull(),
  cnpj: varchar("cnpj", { length: 18 }),
  slug: varchar("slug", { length: 100 }).notNull(),
  esfera: mysqlEnum("esfera", ["federal", "estadual", "municipal", "outro"]).default("municipal"),
  uf: varchar("uf", { length: 2 }),
  municipio: varchar("municipio", { length: 100 }),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  unique("organizations_cnpj_unique").on(table.cnpj),
  unique("organizations_slug_unique").on(table.slug),
]);

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = typeof organizations.$inferInsert;

/**
 * Membros de organizações com papel (RBAC nível organização)
 */
export const organizationMembers = mysqlTable("organization_members", {
  id: int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  userId: int("userId").notNull(),
  role: mysqlEnum("role", ["owner", "admin", "manager", "operator", "viewer"]).default("operator").notNull(),
  invitedBy: int("invitedBy"),
  ativo: boolean("ativo").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => [
  unique("org_members_org_user_unique").on(table.organizationId, table.userId),
]);

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type InsertOrganizationMember = typeof organizationMembers.$inferInsert;
export type OrgRole = OrganizationMember["role"];

// ============================================================================
// SPRINT 1 — OUTBOX FOUNDATION
// ============================================================================

/**
 * Eventos do outbox transacional.
 * Garantia de entrega: escrita no mesmo tx do agregado → dispatcher consome assincronamente.
 */
export const outboxEvents = mysqlTable("outbox_events", {
  id: varchar("id", { length: 36 }).primaryKey(),
  organizationId: int("organizationId"),
  eventType: varchar("eventType", { length: 100 }).notNull(),
  aggregateType: varchar("aggregateType", { length: 50 }).notNull(),
  aggregateId: varchar("aggregateId", { length: 50 }).notNull(),
  correlationId: varchar("correlationId", { length: 36 }),
  requestId: varchar("requestId", { length: 36 }),
  // Sprint 1.5 — Envelope v2: actor + tenant propagados até o dispatcher
  actorId: int("actorId"),
  actorName: varchar("actorName", { length: 255 }),
  tenantContext: json("tenantContext"),
  payload: json("payload").notNull(),
  status: mysqlEnum("status", ["pending", "processing", "delivered", "failed"]).default("pending").notNull(),
  attempts: int("attempts").default(0).notNull(),
  lastError: text("lastError"),
  lockedBy: varchar("lockedBy", { length: 100 }),
  lockedUntil: timestamp("lockedUntil"),
  scheduledAfter: timestamp("scheduledAfter"),
  processedAt: timestamp("processedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type InsertOutboxEvent = typeof outboxEvents.$inferInsert;

/**
 * Dead letter queue para eventos do outbox que falharam após max retries.
 */
export const outboxDeadLetters = mysqlTable("outbox_dead_letters", {
  id: varchar("id", { length: 36 }).primaryKey(),
  organizationId: int("organizationId"),
  eventType: varchar("eventType", { length: 100 }).notNull(),
  aggregateType: varchar("aggregateType", { length: 50 }).notNull(),
  aggregateId: varchar("aggregateId", { length: 50 }).notNull(),
  correlationId: varchar("correlationId", { length: 36 }),
  payload: json("payload").notNull(),
  attempts: int("attempts").notNull(),
  lastError: text("lastError"),
  movedAt: timestamp("movedAt").defaultNow().notNull(),
  resolution: mysqlEnum("resolution", ["pending", "resolved", "discarded"]).default("pending").notNull(),
  resolvedBy: int("resolvedBy"),
  resolvedAt: timestamp("resolvedAt"),
  resolvedNote: text("resolvedNote"),
});

export type OutboxDeadLetter = typeof outboxDeadLetters.$inferSelect;
export type InsertOutboxDeadLetter = typeof outboxDeadLetters.$inferInsert;

/**
 * Chaves de idempotência para prevenir duplo processamento.
 * Expiração: 24h. Limpeza via job agendado.
 */
export const idempotencyKeys = mysqlTable("idempotency_keys", {
  id: varchar("id", { length: 36 }).primaryKey(),
  organizationId: int("organizationId").notNull(),
  userId: int("userId").notNull(),
  key: varchar("key", { length: 255 }).notNull(),
  operation: varchar("operation", { length: 100 }).notNull(),
  status: mysqlEnum("status", ["processing", "completed", "failed"]).default("processing").notNull(),
  requestPayloadHash: varchar("requestPayloadHash", { length: 64 }),
  responsePayload: json("responsePayload"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
}, (table) => [
  unique("idempotency_org_user_key").on(table.organizationId, table.userId, table.key),
]);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type InsertIdempotencyKey = typeof idempotencyKeys.$inferInsert;

// ============================================================================
// SPRINT 1 — FEATURE FLAGS FOUNDATION
// ============================================================================

/**
 * Feature flags globais (afetam todos os tenants).
 * Tipos: Release flags, Ops flags (emergência), Experiment flags, Plan flags.
 */
export const featureFlags = mysqlTable("feature_flags", {
  name: varchar("name", { length: 100 }).primaryKey(),
  enabled: boolean("enabled").default(false).notNull(),
  reason: varchar("reason", { length: 255 }),
  updatedBy: int("updatedBy"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type FeatureFlag = typeof featureFlags.$inferSelect;
export type InsertFeatureFlag = typeof featureFlags.$inferInsert;

/**
 * Feature flags por tenant (override do flag global para organização específica).
 * Suporta rollout gradual via campo `percentage` (0-100).
 */
export const tenantFeatureFlags = mysqlTable("tenant_feature_flags", {
  organizationId: int("organizationId").notNull(),
  flagName: varchar("flagName", { length: 100 }).notNull(),
  enabled: boolean("enabled").default(false).notNull(),
  percentage: int("percentage").default(100),
  expiresAt: timestamp("expiresAt"),
  createdBy: int("createdBy"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.flagName] }),
]);

export type TenantFeatureFlag = typeof tenantFeatureFlags.$inferSelect;
export type InsertTenantFeatureFlag = typeof tenantFeatureFlags.$inferInsert;

// ─── Sprint 2: Core Documental ────────────────────────────────────────────────

/**
 * Versões imutáveis de documentos.
 * Cada snapshot captura o estado completo do documento num ponto no tempo.
 */
export const documentVersions = mysqlTable("document_versions", {
  id:                 int("id").autoincrement().primaryKey(),
  organizationId:     int("organizationId").notNull(),
  documentId:         int("documentId").notNull(),
  versionNumber:      int("versionNumber").notNull(),
  contentSnapshot:    text("contentSnapshot"),
  structuredSnapshot: json("structuredSnapshot"),
  diffMetadata:       json("diffMetadata"),
  changeReason:       varchar("changeReason", { length: 500 }),
  sourceContext:      mysqlEnum("sourceContext", ["manual", "autosave_publish", "ai", "import", "restore", "workflow"]).default("manual").notNull(),
  actorSnapshot:      json("actorSnapshot").notNull(),
  workflowSnapshot:    json("workflowSnapshot"),
  correlationId:       varchar("correlationId",       { length: 36 }),
  requestId:           varchar("requestId",           { length: 36 }),
  snapshotFingerprint: varchar("snapshotFingerprint", { length: 64 }),
  createdBy:           int("createdBy").notNull(),
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
});

export type DocumentVersion = typeof documentVersions.$inferSelect;
export type InsertDocumentVersion = typeof documentVersions.$inferInsert;

/**
 * Rascunhos de autosave — um por usuário por documento.
 * Expiram automaticamente após 7 dias sem atividade.
 */
export const documentDrafts = mysqlTable("document_drafts", {
  id:              int("id").autoincrement().primaryKey(),
  organizationId:  int("organizationId").notNull(),
  documentId:      int("documentId").notNull(),
  userId:          int("userId").notNull(),
  contentDraft:    text("contentDraft"),
  structuredDraft: json("structuredDraft"),
  baseVersionId:   int("baseVersionId"),
  version:         int("version").default(1).notNull(),
  lastSavedAt:     timestamp("lastSavedAt").defaultNow().notNull(),
  expiresAt:       timestamp("expiresAt").notNull(),
  correlationId:   varchar("correlationId", { length: 36 }),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DocumentDraft = typeof documentDrafts.$inferSelect;
export type InsertDocumentDraft = typeof documentDrafts.$inferInsert;

/**
 * Timeline operacional de documentos — registro cronológico imutável.
 */
export const documentTimeline = mysqlTable("document_timeline", {
  id:             int("id").autoincrement().primaryKey(),
  organizationId: int("organizationId").notNull(),
  documentId:     int("documentId").notNull(),
  eventType:      varchar("eventType", { length: 100 }).notNull(),
  actorId:        int("actorId").notNull(),
  actorName:      varchar("actorName", { length: 255 }),
  actorEmail:     varchar("actorEmail", { length: 320 }),
  actorRole:      varchar("actorRole", { length: 50 }),
  versionId:      int("versionId"),
  fromState:      varchar("fromState", { length: 50 }),
  toState:        varchar("toState", { length: 50 }),
  details:        json("details"),
  correlationId:  varchar("correlationId", { length: 36 }),
  requestId:      varchar("requestId", { length: 36 }),
  occurredAt:     timestamp("occurredAt").defaultNow().notNull(),
});

export type DocumentTimelineEvent = typeof documentTimeline.$inferSelect;
export type InsertDocumentTimelineEvent = typeof documentTimeline.$inferSelect;

/**
 * Sprint 2.5 — Anexos documentais tenant-safe.
 */
export const documentAttachments = mysqlTable("document_attachments", {
  id:               int("id").autoincrement().primaryKey(),
  organizationId:   int("organizationId").notNull(),
  documentId:       int("documentId").notNull(),
  versionId:        int("versionId"),
  filename:         varchar("filename",         { length: 255 }).notNull(),
  originalFilename: varchar("originalFilename", { length: 255 }).notNull(),
  mimeType:         varchar("mimeType",         { length: 100 }).notNull(),
  fileSize:         int("fileSize").notNull(),
  storageKey:       varchar("storageKey",       { length: 500 }).notNull(),
  contentHash:      varchar("contentHash",      { length: 64 }),
  scanStatus:       mysqlEnum("scanStatus", ["pending", "clean", "infected", "error"]).default("pending").notNull(),
  uploadedBy:       int("uploadedBy").notNull(),
  deletedAt:        timestamp("deletedAt"),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
});

export type DocumentAttachment = typeof documentAttachments.$inferSelect;
export type InsertDocumentAttachment = typeof documentAttachments.$inferInsert;

/**
 * Sprint 2.5 — Cache de renders documentais (HTML/DOCX/PDF) por versão.
 */
export const documentRenderCache = mysqlTable("document_render_cache", {
  id:              int("id").autoincrement().primaryKey(),
  organizationId:  int("organizationId").notNull(),
  documentId:      int("documentId").notNull(),
  versionId:       int("versionId"),
  format:          mysqlEnum("format", ["html", "docx", "pdf"]).notNull(),
  renderHash:      varchar("renderHash",      { length: 32 }).notNull(),
  renderedContent: longtext("renderedContent"),
  renderedAt:      timestamp("renderedAt"),
  expiresAt:       timestamp("expiresAt"),
  status:          mysqlEnum("status", ["pending", "processing", "ready", "failed"]).default("pending").notNull(),
  storageKey:      varchar("storageKey",      { length: 500 }),
  fileSize:        int("fileSize"),
  errorMessage:    text("errorMessage"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
});

export type DocumentRenderCacheEntry = typeof documentRenderCache.$inferSelect;
export type InsertDocumentRenderCacheEntry = typeof documentRenderCache.$inferInsert;

/**
 * Sprint 2.8 — Import Sessions aggregate.
 * Lifecycle: uploaded → queued → parsing → extracted → normalized → awaiting_review → approved/rejected
 */
export const importSessions = mysqlTable("import_sessions", {
  id:                 int("id").autoincrement().primaryKey(),
  organizationId:     int("organizationId").notNull(),
  uploadedBy:         int("uploadedBy").notNull(),
  sourceFileId:       varchar("sourceFileId",   { length: 255 }).notNull(),
  sourceFileName:     varchar("sourceFileName", { length: 255 }).notNull(),
  sourceMimeType:     varchar("sourceMimeType", { length: 100 }).notNull(),
  sourceSize:         int("sourceSize").notNull().default(0),
  importType:         varchar("importType",     { length: 50  }).notNull().default("generic"),
  parserType:         varchar("parserType",     { length: 20  }).notNull().default("auto"),
  parserVersion:      varchar("parserVersion",  { length: 20  }).notNull().default("1.0.0"),
  status:             mysqlEnum("status", [
    "uploaded","queued","parsing","extracted",
    "normalized","awaiting_review","approved","rejected",
    "failed","archived",
  ]).notNull().default("uploaded"),
  progress:           int("progress").notNull().default(0),
  stage:              varchar("stage",            { length: 100 }),
  confidenceScore:    decimal("confidenceScore",  { precision: 5, scale: 4 }),
  extractionSummary:  json("extractionSummary"),
  warnings:           json("warnings"),
  errors:             json("errors"),
  correlationId:      varchar("correlationId",    { length: 36 }),
  retryCount:         int("retryCount").notNull().default(0),
  startedAt:          timestamp("startedAt"),
  finishedAt:         timestamp("finishedAt"),
  failedAt:           timestamp("failedAt"),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ImportSession       = typeof importSessions.$inferSelect;
export type InsertImportSession = typeof importSessions.$inferInsert;

/**
 * Sprint 2.8 — Import Staging Items.
 * Raw extracted items awaiting validation → normalization → human review.
 * NEVER maps directly to domain tables — staging isolation layer only.
 */
export const importStagingItems = mysqlTable("import_staging_items", {
  id:                  int("id").autoincrement().primaryKey(),
  importSessionId:     int("importSessionId").notNull(),
  organizationId:      int("organizationId").notNull(),
  rawDescription:      text("rawDescription"),
  rawQuantity:         varchar("rawQuantity",    { length: 100 }),
  rawUnit:             varchar("rawUnit",        { length: 50  }),
  rawUnitPrice:        varchar("rawUnitPrice",   { length: 100 }),
  rawTotalPrice:       varchar("rawTotalPrice",  { length: 100 }),
  rawMetadata:         json("rawMetadata"),
  sourceLocation:      json("sourceLocation"),
  parserMetadata:      json("parserMetadata"),
  confidenceMetadata:  json("confidenceMetadata"),
  extractionWarnings:  json("extractionWarnings"),
  extractionErrors:    json("extractionErrors"),
  reviewStatus:        mysqlEnum("reviewStatus", ["pending","approved","rejected","skipped"]).notNull().default("pending"),
  reviewedBy:          int("reviewedBy"),
  reviewedAt:          timestamp("reviewedAt"),
  reviewNote:          text("reviewNote"),
  expiresAt:           timestamp("expiresAt"),
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
  updatedAt:           timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ImportStagingItem       = typeof importStagingItems.$inferSelect;
export type InsertImportStagingItem = typeof importStagingItems.$inferInsert;

/**
 * Sprint 2.9 — Import Review Transitions.
 * Histórico imutável de transições de estado de revisão por item de staging.
 */
export const importReviewTransitions = mysqlTable("import_review_transitions", {
  id:             varchar("id",             { length: 26 }).notNull().primaryKey(),
  stagingItemId:  varchar("stagingItemId",  { length: 26 }).notNull(),
  fromState:      mysqlEnum("fromState", [
    "extracted","normalized","review_pending","reviewed",
    "approved","rejected","corrected","catmat_linked","finalized",
  ]).notNull(),
  toState:        mysqlEnum("toState", [
    "extracted","normalized","review_pending","reviewed",
    "approved","rejected","corrected","catmat_linked","finalized",
  ]).notNull(),
  actorType:      mysqlEnum("actorType",  ["system","human","ai_assist"]).notNull().default("system"),
  actorUserId:    int("actorUserId"),
  actorOrgId:     int("actorOrgId").notNull(),
  actorAgentId:   varchar("actorAgentId", { length: 128 }),
  reason:         text("reason"),
  metadata:       json("metadata"),
  occurredAt:     timestamp("occurredAt").defaultNow().notNull(),
});

export type ImportReviewTransitionRow       = typeof importReviewTransitions.$inferSelect;
export type InsertImportReviewTransitionRow = typeof importReviewTransitions.$inferInsert;

/**
 * Sprint 2.9 — Semantic Candidates.
 * Candidatos de normalização semântica gerados pelo pipeline.
 */
export const semanticCandidates = mysqlTable("semantic_candidates", {
  id:                   varchar("id",                   { length: 26 }).notNull().primaryKey(),
  stagingItemId:        varchar("stagingItemId",        { length: 26 }).notNull(),
  importSessionId:      int("importSessionId").notNull(),
  organizationId:       int("organizationId").notNull(),
  proposedDescription:  text("proposedDescription").notNull(),
  proposedUnit:         varchar("proposedUnit",         { length: 50  }),
  proposedQuantity:     decimal("proposedQuantity",     { precision: 15, scale: 4 }),
  proposedUnitPrice:    decimal("proposedUnitPrice",    { precision: 15, scale: 4 }),
  score:                decimal("score",                { precision: 5,  scale: 4 }).notNull(),
  rank:                 int("rank").notNull().default(1),
  source:               mysqlEnum("source", [
    "exact_match","alias_match","fuzzy_match","prefix_match",
    "token_match","ngram_match","rule_based","catmat_lookup",
  ]).notNull(),
  status:               mysqlEnum("status", ["pending","accepted","rejected","superseded","expired"]).notNull().default("pending"),
  explanationReason:    text("explanationReason"),
  explanationMatched:   json("explanationMatched"),
  explanationPenalty:   decimal("explanationPenalty",   { precision: 4, scale: 3 }).default("0"),
  explanationBonus:     decimal("explanationBonus",     { precision: 4, scale: 3 }).default("0"),
  originalRaw:          text("originalRaw").notNull(),
  catmatCode:           varchar("catmatCode",           { length: 20  }),
  catmatDesc:           text("catmatDesc"),
  catmatGroup:          varchar("catmatGroup",          { length: 128 }),
  indexEntryId:         varchar("indexEntryId",         { length: 26  }),
  generatedAt:          timestamp("generatedAt").defaultNow().notNull(),
  evaluatedAt:          timestamp("evaluatedAt"),
  evaluatedBy:          int("evaluatedBy"),
});

export type SemanticCandidateRow       = typeof semanticCandidates.$inferSelect;
export type InsertSemanticCandidateRow = typeof semanticCandidates.$inferInsert;

/**
 * Sprint 2.9 — Extraction Evidence.
 * Cadeia de evidências de transformação por item (rastreabilidade jurídica).
 */
export const extractionEvidenceTable = mysqlTable("extraction_evidence", {
  id:                varchar("id",               { length: 26 }).notNull().primaryKey(),
  stagingItemId:     varchar("stagingItemId",    { length: 26 }).notNull().unique(),
  importSessionId:   int("importSessionId").notNull(),
  organizationId:    int("organizationId").notNull(),
  provenanceSheet:   varchar("provenanceSheet",  { length: 128 }),
  provenancePage:    int("provenancePage"),
  provenanceRow:     int("provenanceRow"),
  provenanceCol:     varchar("provenanceCol",    { length: 32  }),
  chain:             json("chain").notNull(),
  createdAt:         timestamp("createdAt").defaultNow().notNull(),
  updatedAt:         timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ExtractionEvidenceRow       = typeof extractionEvidenceTable.$inferSelect;
export type InsertExtractionEvidenceRow = typeof extractionEvidenceTable.$inferInsert;

/**
 * Sprint 2.9 — Semantic Search Entries.
 * Índice de busca semântica local por organização.
 */
export const semanticSearchEntries = mysqlTable("semantic_search_entries", {
  id:             varchar("id",             { length: 26  }).notNull().primaryKey(),
  organizationId: int("organizationId").notNull(),
  canonicalText:  text("canonicalText").notNull(),
  displayText:    text("displayText").notNull(),
  category:       varchar("category",       { length: 128 }),
  subcategory:    varchar("subcategory",    { length: 128 }),
  tokens:         json("tokens").notNull(),
  aliases:        json("aliases").notNull(),
  synonymTokens:  json("synonymTokens").notNull(),
  frequency:      int("frequency").notNull().default(0),
  lastSeenAt:     timestamp("lastSeenAt"),
  source:         mysqlEnum("source", ["manual","learned","catmat","imported"]).notNull().default("manual"),
  catmatCode:     varchar("catmatCode",     { length: 20  }),
  catmatGroup:    varchar("catmatGroup",    { length: 128 }),
  catmatClass:    varchar("catmatClass",    { length: 128 }),
  isActive:       boolean("isActive").notNull().default(true),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type SemanticSearchEntryRow       = typeof semanticSearchEntries.$inferSelect;
export type InsertSemanticSearchEntryRow = typeof semanticSearchEntries.$inferInsert;

/**
 * Sprint 2.9 — Parser Capabilities.
 * Registro de capacidades e limitações de cada parser.
 */
export const parserCapabilitiesTable = mysqlTable("parser_capabilities", {
  id:                          varchar("id",           { length: 26 }).notNull().primaryKey(),
  parserType:                  mysqlEnum("parserType", ["xlsx","xls","csv","docx","pdf","auto"]).notNull(),
  parserVersion:               varchar("parserVersion",{ length: 20 }).notNull(),
  supportsMultiSheet:          boolean("supportsMultiSheet").notNull().default(false),
  supportsMultiPage:           boolean("supportsMultiPage").notNull().default(false),
  supportsFormulas:            boolean("supportsFormulas").notNull().default(false),
  supportsMergedCells:         boolean("supportsMergedCells").notNull().default(false),
  supportsImages:              boolean("supportsImages").notNull().default(false),
  supportsHeaders:             boolean("supportsHeaders").notNull().default(true),
  supportsFooters:             boolean("supportsFooters").notNull().default(false),
  descriptionConfidence:       decimal("descriptionConfidence", { precision: 4, scale: 3 }).notNull(),
  quantityConfidence:          decimal("quantityConfidence",    { precision: 4, scale: 3 }).notNull(),
  unitConfidence:              decimal("unitConfidence",        { precision: 4, scale: 3 }).notNull(),
  priceConfidence:             decimal("priceConfidence",       { precision: 4, scale: 3 }).notNull(),
  limitations:                 json("limitations"),
  requiresManualUnitReview:    boolean("requiresManualUnitReview").notNull().default(false),
  requiresManualPriceReview:   boolean("requiresManualPriceReview").notNull().default(false),
  likelihoodMergedHeaders:     decimal("likelihoodMergedHeaders", { precision: 4, scale: 3 }).notNull().default("0"),
  likelihoodFooterRows:        decimal("likelihoodFooterRows",    { precision: 4, scale: 3 }).notNull().default("0"),
  registeredAt:                timestamp("registeredAt").defaultNow().notNull(),
});

export type ParserCapabilityRow       = typeof parserCapabilitiesTable.$inferSelect;
export type InsertParserCapabilityRow = typeof parserCapabilitiesTable.$inferInsert;

/**
 * Sprint 2.9 — Import Analytics Snapshots.
 * Snapshots periódicos dos 10 KPIs por organização.
 */
export const importAnalyticsSnapshots = mysqlTable("import_analytics_snapshots", {
  id:             varchar("id",           { length: 26 }).notNull().primaryKey(),
  organizationId: int("organizationId").notNull(),
  periodStart:    timestamp("periodStart").notNull(),
  periodEnd:      timestamp("periodEnd").notNull(),
  sessionCount:   int("sessionCount").notNull().default(0),
  itemCount:      int("itemCount").notNull().default(0),
  kpis:           json("kpis").notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type ImportAnalyticsSnapshotRow       = typeof importAnalyticsSnapshots.$inferSelect;
export type InsertImportAnalyticsSnapshotRow = typeof importAnalyticsSnapshots.$inferInsert;

/**
 * Sprint 2.95 — Candidate Consensus.
 * Resultado determinístico de consenso entre candidatos semânticos.
 */
export const candidateConsensusTable = mysqlTable("candidate_consensus", {
  id:                  varchar("id",               { length: 26 }).notNull().primaryKey(),
  stagingItemId:       varchar("stagingItemId",    { length: 26 }).notNull(),
  importSessionId:     int("importSessionId").notNull(),
  organizationId:      int("organizationId").notNull(),
  winningCandidateId:  varchar("winningCandidateId", { length: 26 }),
  consensusScore:      decimal("consensusScore",   { precision: 5, scale: 4 }).notNull(),
  consensusReasoning:  text("consensusReasoning").notNull(),
  confidenceBreakdown: json("confidenceBreakdown").notNull(),
  rankingMetadata:     json("rankingMetadata").notNull(),
  evidenceSummary:     text("evidenceSummary").notNull(),
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
});

export type CandidateConsensusRow       = typeof candidateConsensusTable.$inferSelect;
export type InsertCandidateConsensusRow = typeof candidateConsensusTable.$inferInsert;

/**
 * Sprint 2.95 — Review Decisions.
 * Decisões imutáveis de revisão por item de staging.
 */
export const reviewDecisionsTable = mysqlTable("review_decisions", {
  id:              varchar("id",           { length: 26  }).notNull().primaryKey(),
  stagingItemId:   varchar("stagingItemId",{ length: 26  }).notNull(),
  importSessionId: int("importSessionId").notNull(),
  organizationId:  int("organizationId").notNull(),
  operation:       mysqlEnum("operation", [
    "compare_candidates","approve_candidate","reject_candidate","override_candidate",
    "request_manual_entry","request_new_search","attach_evidence","justify_decision","escalate_review",
  ]).notNull(),
  actorType:       mysqlEnum("actorType", ["system","human","ai_assist"]).notNull().default("human"),
  actorUserId:     int("actorUserId"),
  actorOrgId:      int("actorOrgId").notNull(),
  candidateId:     varchar("candidateId",  { length: 26  }),
  overrideValue:   json("overrideValue"),
  justification:   text("justification").notNull(),
  evidenceRefs:    json("evidenceRefs").notNull(),
  escalateTo:      int("escalateTo"),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
});

export type ReviewDecisionRow       = typeof reviewDecisionsTable.$inferSelect;
export type InsertReviewDecisionRow = typeof reviewDecisionsTable.$inferInsert;

/**
 * Sprint 2.95 — Semantic Drift Snapshots.
 * Snapshots periódicos de métricas de drift semântico.
 */
export const semanticDriftSnapshotsTable = mysqlTable("semantic_drift_snapshots", {
  id:             varchar("id",           { length: 26 }).notNull().primaryKey(),
  organizationId: int("organizationId").notNull(),
  periodStart:    timestamp("periodStart").notNull(),
  periodEnd:      timestamp("periodEnd").notNull(),
  metrics:        json("metrics").notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type SemanticDriftSnapshotRow       = typeof semanticDriftSnapshotsTable.$inferSelect;
export type InsertSemanticDriftSnapshotRow = typeof semanticDriftSnapshotsTable.$inferInsert;

/**
 * Sprint 2.95 — Catalog Sync Snapshots.
 * Snapshots de sincronização de catálogos CATMAT/CATSER.
 */
export const catalogSyncSnapshotsTable = mysqlTable("catalog_sync_snapshots", {
  id:               varchar("id",              { length: 26  }).notNull().primaryKey(),
  organizationId:   int("organizationId").notNull(),
  catalogType:      mysqlEnum("catalogType",   ["catmat","catser","custom"]).notNull(),
  version:          varchar("version",         { length: 50  }).notNull(),
  sourceUrl:        varchar("sourceUrl",       { length: 500 }),
  checksum:         varchar("checksum",        { length: 64  }).notNull(),
  totalEntries:     int("totalEntries").notNull().default(0),
  indexedEntries:   int("indexedEntries").notNull().default(0),
  syncStatus:       mysqlEnum("syncStatus",    ["pending","syncing","synced","failed","stale"]).notNull().default("pending"),
  snapshotLineage:  varchar("snapshotLineage", { length: 26  }),
  importLineage:    json("importLineage").notNull(),
  integrityMetadata: json("integrityMetadata").notNull(),
  cacheMetadata:    json("cacheMetadata").notNull(),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CatalogSyncSnapshotRow       = typeof catalogSyncSnapshotsTable.$inferSelect;
export type InsertCatalogSyncSnapshotRow = typeof catalogSyncSnapshotsTable.$inferInsert;

/**
 * Sprint 2.95 — Catalog Sync History.
 * Histórico de operações de sincronização de catálogo.
 */
export const catalogSyncHistoryTable = mysqlTable("catalog_sync_history", {
  id:             varchar("id",            { length: 26  }).notNull().primaryKey(),
  snapshotId:     varchar("snapshotId",    { length: 26  }).notNull(),
  organizationId: int("organizationId").notNull(),
  operation:      mysqlEnum("operation",   ["create","update","verify","invalidate","expire"]).notNull(),
  beforeVersion:  varchar("beforeVersion", { length: 50  }),
  afterVersion:   varchar("afterVersion",  { length: 50  }).notNull(),
  actor:          varchar("actor",         { length: 128 }).notNull(),
  reason:         text("reason").notNull(),
  occurredAt:     timestamp("occurredAt").defaultNow().notNull(),
});

export type CatalogSyncHistoryRow       = typeof catalogSyncHistoryTable.$inferSelect;
export type InsertCatalogSyncHistoryRow = typeof catalogSyncHistoryTable.$inferInsert;

/**
 * Sprint 2.95 — Candidate Explainability.
 * Explainability completa por candidato semântico.
 */
export const candidateExplainabilityTable = mysqlTable("candidate_explainability", {
  id:                    varchar("id",           { length: 26 }).notNull().primaryKey(),
  candidateId:           varchar("candidateId",  { length: 26 }).notNull(),
  stagingItemId:         varchar("stagingItemId",{ length: 26 }).notNull(),
  organizationId:        int("organizationId").notNull(),
  whySuggested:          text("whySuggested").notNull(),
  whyRanked:             text("whyRanked").notNull(),
  whyRejected:           text("whyRejected"),
  influencingTokens:     json("influencingTokens").notNull(),
  aliasesUsed:           json("aliasesUsed").notNull(),
  parserInfluence:       json("parserInfluence").notNull(),
  normalizationInfluence: json("normalizationInfluence").notNull(),
  semanticInfluence:     json("semanticInfluence").notNull(),
  rankingRationale:      text("rankingRationale").notNull(),
  consensusRationale:    text("consensusRationale"),
  confidenceRationale:   text("confidenceRationale").notNull(),
  generatedAt:           timestamp("generatedAt").defaultNow().notNull(),
});

export type CandidateExplainabilityRow       = typeof candidateExplainabilityTable.$inferSelect;
export type InsertCandidateExplainabilityRow = typeof candidateExplainabilityTable.$inferInsert;

/**
 * Sprint 2.95 — TR Composition Rules.
 * Regras de composição de Termos de Referência por organização.
 */
export const trCompositionRulesTable = mysqlTable("tr_composition_rules", {
  id:             varchar("id",           { length: 26  }).notNull().primaryKey(),
  organizationId: int("organizationId").notNull(),
  name:           varchar("name",         { length: 255 }).notNull(),
  conditionExpr:  text("conditionExpr").notNull(),
  action:         mysqlEnum("action",     ["include_section","exclude_section","replace_clause","append_clause"]).notNull(),
  targetId:       varchar("targetId",     { length: 26  }).notNull(),
  priority:       int("priority").notNull().default(0),
  isActive:       boolean("isActive").notNull().default(true),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TrCompositionRuleRow       = typeof trCompositionRulesTable.$inferSelect;
export type InsertTrCompositionRuleRow = typeof trCompositionRulesTable.$inferInsert;

/**
 * Sprint 3.0 — ItemTR aggregate root.
 * Item consolidado do Termo de Referência (promovido do staging ao domínio).
 */
export const itemTrTable = mysqlTable("item_tr", {
  id:                    varchar("id",                    { length: 64 }).notNull().primaryKey(),
  organizationId:        int("organizationId").notNull(),
  processId:             int("processId").notNull(),
  sourceImportSessionId: int("sourceImportSessionId"),
  itemNumber:            int("itemNumber").notNull(),
  description:           text("description").notNull(),
  normalizedDescription: text("normalizedDescription").notNull(),
  detailedSpecification: text("detailedSpecification"),
  quantity:              decimal("quantity",            { precision: 18, scale: 4 }).notNull().default("0"),
  unit:                  varchar("unit",                  { length: 32 }).notNull(),
  canonicalUnit:         varchar("canonicalUnit",         { length: 32 }),
  estimatedUnitPrice:    decimal("estimatedUnitPrice",   { precision: 18, scale: 4 }),
  estimatedTotalPrice:   decimal("estimatedTotalPrice",  { precision: 18, scale: 4 }),
  catmatCode:            varchar("catmatCode",            { length: 32 }),
  catmatDescription:     text("catmatDescription"),
  catserCode:            varchar("catserCode",            { length: 32 }),
  selectedCandidateId:   varchar("selectedCandidateId",   { length: 32 }),
  consensusId:           varchar("consensusId",           { length: 32 }),
  confidenceScore:       decimal("confidenceScore",      { precision: 6, scale: 4 }).notNull().default("0"),
  reviewState:           mysqlEnum("reviewState", ["pending_match","candidate_generated","awaiting_review","approved","rejected","overridden","manual_entry","finalized"]).notNull().default("pending_match"),
  approvedBy:            int("approvedBy"),
  approvedAt:            timestamp("approvedAt"),
  evidenceRef:           varchar("evidenceRef",           { length: 64 }),
  provenance:            json("provenance").notNull(),
  warnings:              json("warnings").notNull(),
  metadata:              json("metadata").notNull(),
  correlationId:         varchar("correlationId",         { length: 64 }),
  createdAt:             timestamp("createdAt").defaultNow().notNull(),
  updatedAt:             timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ItemTrRow       = typeof itemTrTable.$inferSelect;
export type InsertItemTrRow = typeof itemTrTable.$inferInsert;

/**
 * Sprint 3.0 — Item Review History (append-only).
 * Histórico imutável de transições de estado de revisão de ItemTR.
 */
export const itemReviewHistoryTable = mysqlTable("item_review_history", {
  id:             varchar("id",            { length: 32 }).notNull().primaryKey(),
  itemId:         varchar("itemId",        { length: 64 }).notNull(),
  organizationId: int("organizationId").notNull(),
  fromState:      mysqlEnum("fromState", ["pending_match","candidate_generated","awaiting_review","approved","rejected","overridden","manual_entry","finalized"]).notNull(),
  toState:        mysqlEnum("toState",   ["pending_match","candidate_generated","awaiting_review","approved","rejected","overridden","manual_entry","finalized"]).notNull(),
  actorType:      mysqlEnum("actorType", ["system","human","ai_assist"]).notNull(),
  actorUserId:    int("actorUserId"),
  actorEmail:     varchar("actorEmail",   { length: 255 }),
  reason:         text("reason"),
  justification:  text("justification"),
  evidenceRefs:   json("evidenceRefs").notNull(),
  metadata:       json("metadata"),
  correlationId:  varchar("correlationId", { length: 64 }),
  occurredAt:     timestamp("occurredAt").defaultNow().notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type ItemReviewHistoryRow       = typeof itemReviewHistoryTable.$inferSelect;
export type InsertItemReviewHistoryRow = typeof itemReviewHistoryTable.$inferInsert;

/**
 * Sprint 3.0 — Catalog Snapshots (CATMAT/CATSER versioned snapshots).
 */
export const catalogSnapshotsTable = mysqlTable("catalog_snapshots", {
  id:               varchar("id",               { length: 32 }).notNull().primaryKey(),
  organizationId:   int("organizationId").notNull(),
  catalogType:      mysqlEnum("catalogType", ["catmat","catser","custom"]).notNull(),
  version:          varchar("version",          { length: 50 }).notNull(),
  checksum:         varchar("checksum",         { length: 64 }).notNull(),
  totalEntries:     int("totalEntries").notNull().default(0),
  indexedEntries:   int("indexedEntries").notNull().default(0),
  syncStatus:       mysqlEnum("syncStatus", ["pending","syncing","synced","failed","stale"]).notNull().default("pending"),
  snapshotLineage:  varchar("snapshotLineage",  { length: 32 }),
  importLineage:    json("importLineage").notNull(),
  integrityMetadata: json("integrityMetadata").notNull(),
  cacheMetadata:    json("cacheMetadata").notNull(),
  correlationId:    varchar("correlationId",    { length: 64 }),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CatalogSnapshotRow       = typeof catalogSnapshotsTable.$inferSelect;
export type InsertCatalogSnapshotRow = typeof catalogSnapshotsTable.$inferInsert;

/**
 * Sprint 3.0 — Catalog Entries (CATMAT/CATSER normalized entries).
 */
export const catalogEntriesTable = mysqlTable("catalog_entries", {
  id:                    varchar("id",                    { length: 32 }).notNull().primaryKey(),
  organizationId:        int("organizationId").notNull(),
  code:                  varchar("code",                  { length: 32 }).notNull(),
  catalogType:           mysqlEnum("catalogType", ["catmat","catser"]).notNull(),
  description:           text("description").notNull(),
  normalizedDescription: text("normalizedDescription").notNull(),
  unit:                  varchar("unit",                  { length: 32 }),
  canonicalUnit:         varchar("canonicalUnit",         { length: 32 }),
  catalogGroup:          varchar("catalogGroup",          { length: 255 }),
  aliases:               json("aliases").notNull(),
  tokens:                json("tokens").notNull(),
  active:                boolean("active").notNull().default(true),
  snapshotId:            varchar("snapshotId",            { length: 32 }),
  createdAt:             timestamp("createdAt").defaultNow().notNull(),
  updatedAt:             timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CatalogEntryRow       = typeof catalogEntriesTable.$inferSelect;
export type InsertCatalogEntryRow = typeof catalogEntriesTable.$inferInsert;

/**
 * Sprint 3.0 — Clause Templates (TR clause recommendation templates).
 */
export const clauseTemplatesTable = mysqlTable("clause_templates", {
  id:             varchar("id",            { length: 32 }).notNull().primaryKey(),
  organizationId: int("organizationId").notNull(),
  clauseType:     mysqlEnum("clauseType", ["header","body","item_list","legal_basis","justification","specification","price_ref","footer"]).notNull(),
  title:          varchar("title",         { length: 255 }).notNull(),
  content:        text("content").notNull(),
  legalBasis:     varchar("legalBasis",    { length: 255 }),
  priority:       int("priority").notNull().default(0),
  appliesTo:      json("appliesTo").notNull(),
  baseRelevance:  decimal("baseRelevance", { precision: 6, scale: 4 }).notNull().default("0"),
  isActive:       boolean("isActive").notNull().default(true),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type ClauseTemplateRow       = typeof clauseTemplatesTable.$inferSelect;
export type InsertClauseTemplateRow = typeof clauseTemplatesTable.$inferInsert;

/**
 * Sprint 3.0 — TR Compositions (intelligent TR composition results).
 */
export const trCompositionsTable = mysqlTable("tr_compositions", {
  id:                  varchar("id",                  { length: 32 }).notNull().primaryKey(),
  organizationId:      int("organizationId").notNull(),
  processId:           int("processId").notNull(),
  replayKey:           varchar("replayKey",           { length: 64 }).notNull(),
  correlationId:       varchar("correlationId",       { length: 64 }),
  composedSections:    json("composedSections").notNull(),
  recommendedClauses:  json("recommendedClauses").notNull(),
  itemGroups:          json("itemGroups").notNull(),
  compositionRationale: text("compositionRationale").notNull(),
  itemCount:           int("itemCount").notNull().default(0),
  createdBy:           int("createdBy"),
  createdAt:           timestamp("createdAt").defaultNow().notNull(),
  updatedAt:           timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type TrCompositionRow       = typeof trCompositionsTable.$inferSelect;
export type InsertTrCompositionRow = typeof trCompositionsTable.$inferInsert;

/**
 * Sprint 3.0 — Item Candidate Links (item ↔ semantic candidate lineage).
 */
export const itemCandidateLinksTable = mysqlTable("item_candidate_links", {
  id:              varchar("id",              { length: 32 }).notNull().primaryKey(),
  organizationId:  int("organizationId").notNull(),
  itemId:          varchar("itemId",          { length: 64 }).notNull(),
  candidateId:     varchar("candidateId",     { length: 32 }).notNull(),
  stagingItemId:   varchar("stagingItemId",   { length: 26 }),
  importSessionId: int("importSessionId"),
  score:           decimal("score",           { precision: 6, scale: 4 }).notNull().default("0"),
  candidateRank:   int("candidateRank").notNull().default(1),
  source:          varchar("source",          { length: 32 }).notNull(),
  status:          mysqlEnum("status", ["pending","accepted","rejected","superseded","expired"]).notNull().default("pending"),
  catmatCode:      varchar("catmatCode",      { length: 32 }),
  isSelected:      boolean("isSelected").notNull().default(false),
  replayKey:       varchar("replayKey",       { length: 64 }),
  correlationId:   varchar("correlationId",   { length: 64 }),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
});

export type ItemCandidateLinkRow       = typeof itemCandidateLinksTable.$inferSelect;
export type InsertItemCandidateLinkRow = typeof itemCandidateLinksTable.$inferInsert;

/**
 * Sprint 3.0 — Item Explainability (per-candidate explainability for ItemTR).
 */
export const itemExplainabilityTable = mysqlTable("item_explainability", {
  id:                    varchar("id",                    { length: 32 }).notNull().primaryKey(),
  organizationId:        int("organizationId").notNull(),
  itemId:                varchar("itemId",                { length: 64 }).notNull(),
  candidateId:           varchar("candidateId",           { length: 32 }).notNull(),
  whySuggested:          text("whySuggested").notNull(),
  whyRanked:             text("whyRanked").notNull(),
  whyRejected:           text("whyRejected"),
  influencingTokens:     json("influencingTokens").notNull(),
  parserInfluence:       json("parserInfluence").notNull(),
  normalizationInfluence: json("normalizationInfluence").notNull(),
  semanticInfluence:     json("semanticInfluence").notNull(),
  rankingRationale:      text("rankingRationale").notNull(),
  consensusRationale:    text("consensusRationale"),
  confidenceRationale:   text("confidenceRationale").notNull(),
  replayKey:             varchar("replayKey",             { length: 64 }),
  correlationId:         varchar("correlationId",         { length: 64 }),
  generatedAt:           timestamp("generatedAt").defaultNow().notNull(),
  createdAt:             timestamp("createdAt").defaultNow().notNull(),
});

export type ItemExplainabilityRow       = typeof itemExplainabilityTable.$inferSelect;
export type InsertItemExplainabilityRow = typeof itemExplainabilityTable.$inferInsert;

// ============================================================================
// SPRINT 3.2 — PRODUCTION HARDENING
// ============================================================================

/**
 * Sprint 3.2 — Catalog Ingestion Jobs.
 */
export const catalogIngestionJobsTable = mysqlTable("catalog_ingestion_jobs", {
  id:                varchar("id",               { length: 32 }).notNull().primaryKey(),
  organizationId:    int("organization_id").notNull(),
  catalogType:       mysqlEnum("catalog_type",   ["catmat","catser"]).notNull(),
  status:            mysqlEnum("status",         ["pending","processing","completed","failed","partial"]).notNull().default("pending"),
  totalEntries:      int("total_entries").notNull().default(0),
  processedEntries:  int("processed_entries").notNull().default(0),
  failedEntries:     int("failed_entries").notNull().default(0),
  duplicatesSkipped: int("duplicates_skipped").notNull().default(0),
  snapshotId:        varchar("snapshot_id",      { length: 32 }),
  correlationId:     varchar("correlation_id",   { length: 64 }),
  resumeToken:       varchar("resume_token",     { length: 255 }),
  checksumBefore:    varchar("checksum_before",  { length: 64 }).notNull(),
  checksumAfter:     varchar("checksum_after",   { length: 64 }),
  startedAt:         timestamp("started_at").defaultNow().notNull(),
  completedAt:       timestamp("completed_at"),
  errors:            json("errors"),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
});

export type CatalogIngestionJobRow       = typeof catalogIngestionJobsTable.$inferSelect;
export type InsertCatalogIngestionJobRow = typeof catalogIngestionJobsTable.$inferInsert;

/**
 * Sprint 3.2 — Distributed Cache Entries.
 */
export const distributedCacheEntriesTable = mysqlTable("distributed_cache_entries", {
  key:              varchar("key",              { length: 512 }).notNull(),
  organizationId:   int("organization_id").notNull(),
  value:            json("value").notNull(),
  ttlMs:            int("ttl_ms").notNull().default(300000),
  snapshotVersion:  varchar("snapshot_version", { length: 64 }),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  expiresAt:        timestamp("expires_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.organizationId, table.key] }),
]);

export type DistributedCacheEntryRow       = typeof distributedCacheEntriesTable.$inferSelect;
export type InsertDistributedCacheEntryRow = typeof distributedCacheEntriesTable.$inferInsert;

/**
 * Sprint 3.2 — Official Exports.
 */
export const officialExportsTable = mysqlTable("official_exports", {
  id:              varchar("id",              { length: 64 }).notNull().primaryKey(),
  organizationId:  int("organization_id").notNull(),
  processId:       int("process_id").notNull(),
  format:          mysqlEnum("format",        ["docx","pdf"]).notNull(),
  filename:        varchar("filename",        { length: 255 }).notNull(),
  contentHash:     varchar("content_hash",    { length: 64 }).notNull(),
  pageCount:       int("page_count").notNull().default(1),
  templateId:      varchar("template_id",     { length: 64 }),
  watermark:       varchar("watermark",       { length: 255 }),
  correlationId:   varchar("correlation_id",  { length: 64 }),
  generatedAt:     timestamp("generated_at").defaultNow().notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

export type OfficialExportRow       = typeof officialExportsTable.$inferSelect;
export type InsertOfficialExportRow = typeof officialExportsTable.$inferInsert;

/**
 * Sprint 3.2 — Institutional Workflows.
 */
export const institutionalWorkflowsTable = mysqlTable("institutional_workflows", {
  id:              varchar("id",              { length: 64 }).notNull().primaryKey(),
  organizationId:  int("organization_id").notNull(),
  processId:       int("process_id").notNull(),
  currentStage:    mysqlEnum("current_stage", ["elaboration","technical_review","legal_review","authority_approval","director_approval","publication","completed","cancelled"]).notNull().default("elaboration"),
  stages:          json("stages").notNull(),
  assignedTo:      json("assigned_to").notNull(),
  deadlines:       json("deadlines").notNull(),
  escalationRules: json("escalation_rules").notNull(),
  status:          varchar("status",          { length: 32 }).notNull().default("active"),
  correlationId:   varchar("correlation_id",  { length: 64 }),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
  updatedAt:       timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
});

export type InstitutionalWorkflowRow       = typeof institutionalWorkflowsTable.$inferSelect;
export type InsertInstitutionalWorkflowRow = typeof institutionalWorkflowsTable.$inferInsert;

/**
 * Sprint 3.2 — Operational Audit Events.
 */
export const operationalAuditEventsTable = mysqlTable("operational_audit_events", {
  id:              varchar("id",              { length: 64 }).notNull().primaryKey(),
  organizationId:  int("organization_id").notNull(),
  category:        mysqlEnum("category",      ["export","approval","override","clause_change","item_change","semantic_override","workflow_transition","tenant_operation"]).notNull(),
  action:          varchar("action",          { length: 255 }).notNull(),
  actorId:         int("actor_id").notNull(),
  actorRole:       varchar("actor_role",      { length: 100 }).notNull(),
  targetType:      varchar("target_type",     { length: 100 }).notNull(),
  targetId:        varchar("target_id",       { length: 100 }).notNull(),
  beforeState:     json("before_state"),
  afterState:      json("after_state"),
  justification:   text("justification"),
  correlationId:   varchar("correlation_id",  { length: 64 }),
  occurredAt:      timestamp("occurred_at").defaultNow().notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

export type OperationalAuditEventRow       = typeof operationalAuditEventsTable.$inferSelect;
export type InsertOperationalAuditEventRow = typeof operationalAuditEventsTable.$inferInsert;

/**
 * Sprint 3.2 — Tenant Integrity Reports.
 */
export const tenantIntegrityReportsTable = mysqlTable("tenant_integrity_reports", {
  id:              varchar("id",              { length: 64 }).notNull().primaryKey(),
  organizationId:  int("organization_id").notNull(),
  scanType:        varchar("scan_type",       { length: 64 }).notNull(),
  findingsCount:   int("findings_count").notNull().default(0),
  healthy:         boolean("healthy").notNull().default(true),
  findings:        json("findings").notNull(),
  scannedAt:       timestamp("scanned_at").defaultNow().notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

export type TenantIntegrityReportRow       = typeof tenantIntegrityReportsTable.$inferSelect;
export type InsertTenantIntegrityReportRow = typeof tenantIntegrityReportsTable.$inferInsert;

/**
 * Sprint 3.2 — Security Incidents.
 */
export const securityIncidentsTable = mysqlTable("security_incidents", {
  id:              varchar("id",              { length: 64 }).notNull().primaryKey(),
  organizationId:  int("organization_id").notNull(),
  eventType:       mysqlEnum("event_type",    ["brute_force","suspicious_access","permission_anomaly","session_anomaly","audit_anomaly","rate_limit_exceeded"]).notNull(),
  severity:        mysqlEnum("severity",      ["info","warning","critical"]).notNull().default("info"),
  actorId:         int("actor_id"),
  description:     text("description").notNull(),
  metadata:        json("metadata"),
  correlationId:   varchar("correlation_id",  { length: 64 }),
  detectedAt:      timestamp("detected_at").defaultNow().notNull(),
  createdAt:       timestamp("created_at").defaultNow().notNull(),
});

export type SecurityIncidentRow       = typeof securityIncidentsTable.$inferSelect;
export type InsertSecurityIncidentRow = typeof securityIncidentsTable.$inferInsert;

/**
 * Sprint 3.2 — Catalog Snapshots V2.
 */
export const catalogSnapshotsV2Table = mysqlTable("catalog_snapshots_v2", {
  id:                 varchar("id",                  { length: 64 }).notNull().primaryKey(),
  organizationId:     int("organization_id").notNull(),
  catalogType:        mysqlEnum("catalog_type",      ["catmat","catser","custom"]).notNull(),
  version:            varchar("version",             { length: 50 }).notNull(),
  totalEntries:       int("total_entries").notNull().default(0),
  indexedEntries:     int("indexed_entries").notNull().default(0),
  checksum:           varchar("checksum",            { length: 64 }).notNull(),
  previousSnapshotId: varchar("previous_snapshot_id",{ length: 64 }),
  ingestionJobId:     varchar("ingestion_job_id",    { length: 32 }),
  createdAt:          timestamp("created_at").defaultNow().notNull(),
});

export type CatalogSnapshotV2Row       = typeof catalogSnapshotsV2Table.$inferSelect;
export type InsertCatalogSnapshotV2Row = typeof catalogSnapshotsV2Table.$inferInsert;

// ============================================================================
// Sprint 3.3 — Collaboration + Interoperability + Institutional Workflow
// ============================================================================

/**
 * Sprint 3.3 — Collaboration Comments.
 */
export const collaborationCommentsTable = mysqlTable("collaboration_comments", {
  id:              varchar("id",           { length: 64  }).notNull().primaryKey(),
  organizationId:  int("organizationId").notNull(),
  entityType:      varchar("entityType",   { length: 50  }).notNull(),
  entityId:        varchar("entityId",     { length: 64  }).notNull(),
  threadId:        varchar("threadId",     { length: 64  }),
  content:         text("content").notNull(),
  authorId:        int("authorId").notNull(),
  authorName:      varchar("authorName",   { length: 255 }).notNull(),
  mentions:        json("mentions").notNull(),
  status:          mysqlEnum("status", ["active","resolved","deleted"]).notNull().default("active"),
  editHistoryJson: json("editHistoryJson").notNull(),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
  updatedAt:       timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CollaborationCommentRow       = typeof collaborationCommentsTable.$inferSelect;
export type InsertCollaborationCommentRow = typeof collaborationCommentsTable.$inferInsert;

/**
 * Sprint 3.3 — Discussion Threads.
 */
export const discussionThreadsTable = mysqlTable("discussion_threads", {
  id:             varchar("id",          { length: 64  }).notNull().primaryKey(),
  organizationId: int("organizationId").notNull(),
  entityType:     varchar("entityType",  { length: 50  }).notNull(),
  entityId:       varchar("entityId",    { length: 64  }).notNull(),
  title:          varchar("title",       { length: 500 }).notNull(),
  status:         mysqlEnum("status", ["open","resolved"]).notNull().default("open"),
  resolvedBy:     int("resolvedBy"),
  resolvedAt:     timestamp("resolvedAt"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type DiscussionThreadRow       = typeof discussionThreadsTable.$inferSelect;
export type InsertDiscussionThreadRow = typeof discussionThreadsTable.$inferInsert;

/**
 * Sprint 3.3 — Webhook Deliveries.
 */
export const webhookDeliveriesTable = mysqlTable("webhook_deliveries", {
  id:             varchar("id",            { length: 64  }).notNull().primaryKey(),
  organizationId: int("organizationId").notNull(),
  endpointId:     varchar("endpointId",    { length: 64  }).notNull(),
  eventType:      varchar("eventType",     { length: 100 }).notNull(),
  payloadJson:    json("payloadJson").notNull(),
  signature:      varchar("signature",     { length: 256 }).notNull(),
  status:         mysqlEnum("status", ["pending","delivered","failed","dead_letter"]).notNull().default("pending"),
  attempts:       int("attempts").notNull().default(0),
  lastError:      text("lastError"),
  correlationId:  varchar("correlationId", { length: 64  }).notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  deliveredAt:    timestamp("deliveredAt"),
});

export type WebhookDeliveryRow       = typeof webhookDeliveriesTable.$inferSelect;
export type InsertWebhookDeliveryRow = typeof webhookDeliveriesTable.$inferInsert;

/**
 * Sprint 3.3 — Public API Tokens.
 */
export const publicApiTokensTable = mysqlTable("public_api_tokens", {
  id:             varchar("id",          { length: 64  }).notNull().primaryKey(),
  organizationId: int("organizationId").notNull(),
  name:           varchar("name",        { length: 255 }).notNull(),
  tokenHash:      varchar("tokenHash",   { length: 255 }).notNull(),
  scopes:         json("scopes").notNull(),
  active:         boolean("active").notNull().default(true),
  expiresAt:      timestamp("expiresAt"),
  lastUsedAt:     timestamp("lastUsedAt"),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type PublicApiTokenRow       = typeof publicApiTokensTable.$inferSelect;
export type InsertPublicApiTokenRow = typeof publicApiTokensTable.$inferInsert;

/**
 * Sprint 3.3 — Document Version Diffs.
 */
export const documentVersionDiffsTable = mysqlTable("document_version_diffs", {
  id:             varchar("id",            { length: 64  }).notNull().primaryKey(),
  organizationId: int("organizationId").notNull(),
  entityType:     varchar("entityType",    { length: 50  }).notNull(),
  entityId:       varchar("entityId",      { length: 64  }).notNull(),
  fromVersionId:  varchar("fromVersionId", { length: 64  }).notNull(),
  toVersionId:    varchar("toVersionId",   { length: 64  }).notNull(),
  changesJson:    json("changesJson").notNull(),
  summary:        varchar("summary",       { length: 500 }).notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type DocumentVersionDiffRow       = typeof documentVersionDiffsTable.$inferSelect;
export type InsertDocumentVersionDiffRow = typeof documentVersionDiffsTable.$inferInsert;

/**
 * Sprint 3.3 — External Storage Snapshots.
 */
export const externalStorageSnapshotsTable = mysqlTable("external_storage_snapshots", {
  id:             varchar("id",          { length: 64  }).notNull().primaryKey(),
  organizationId: int("organizationId").notNull(),
  adapterId:      varchar("adapterId",   { length: 64  }).notNull(),
  totalFiles:     int("totalFiles").notNull().default(0),
  syncedFiles:    int("syncedFiles").notNull().default(0),
  conflictsCount: int("conflictsCount").notNull().default(0),
  checksum:       varchar("checksum",    { length: 255 }).notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type ExternalStorageSnapshotRow       = typeof externalStorageSnapshotsTable.$inferSelect;
export type InsertExternalStorageSnapshotRow = typeof externalStorageSnapshotsTable.$inferInsert;

/**
 * Sprint 3.3 — Structured Exports.
 */
export const structuredExportsTable = mysqlTable("structured_exports", {
  id:             varchar("id",            { length: 64  }).notNull().primaryKey(),
  organizationId: int("organizationId").notNull(),
  schema:         varchar("schema",        { length: 100 }).notNull(),
  format:         varchar("format",        { length: 20  }).notNull(),
  version:        varchar("version",       { length: 20  }).notNull().default("1.0"),
  payloadJson:    json("payloadJson").notNull(),
  checksum:       varchar("checksum",      { length: 255 }).notNull(),
  correlationId:  varchar("correlationId", { length: 64  }).notNull(),
  generatedAt:    timestamp("generatedAt").notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type StructuredExportRow       = typeof structuredExportsTable.$inferSelect;
export type InsertStructuredExportRow = typeof structuredExportsTable.$inferInsert;

/**
 * Sprint 3.3 — Communication Events.
 */
export const communicationEventsTable = mysqlTable("communication_events", {
  id:              varchar("id",            { length: 64  }).notNull().primaryKey(),
  organizationId:  int("organizationId").notNull(),
  recipientUserId: int("recipientUserId").notNull(),
  senderUserId:    int("senderUserId"),
  type:            varchar("type",          { length: 100 }).notNull(),
  priority:        varchar("priority",      { length: 20  }).notNull().default("normal"),
  title:           varchar("title",         { length: 500 }).notNull(),
  message:         text("message").notNull(),
  entityType:      varchar("entityType",    { length: 50  }),
  entityId:        varchar("entityId",      { length: 64  }),
  readStatus:      boolean("readStatus").notNull().default(false),
  readAt:          timestamp("readAt"),
  correlationId:   varchar("correlationId", { length: 64  }).notNull(),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
});

export type CommunicationEventRow       = typeof communicationEventsTable.$inferSelect;
export type InsertCommunicationEventRow = typeof communicationEventsTable.$inferInsert;

/**
 * Sprint 3.4 — Operational Templates.
 */
export const operationalTemplatesTable = mysqlTable("operational_templates", {
  id:                    varchar("id",          { length: 128 }).notNull().primaryKey(),
  organizationId:        int("organization_id").notNull().default(0),
  category:              varchar("category",    { length: 64  }).notNull(),
  name:                  varchar("name",        { length: 256 }).notNull(),
  description:           text("description").notNull(),
  clauseTemplates:       json("clause_templates").notNull(),
  itemTRTemplates:       json("item_tr_templates").notNull(),
  workflowTemplate:      json("workflow_template").notNull(),
  legalBasis:            json("legal_basis").notNull(),
  estimatedDurationDays: int("estimated_duration_days").notNull().default(30),
  approvalLevels:        int("approval_levels").notNull().default(2),
  version:               varchar("version",     { length: 32  }).notNull().default("1.0.0"),
  versionHistory:        json("version_history").notNull(),
  active:                boolean("active").notNull().default(true),
  createdAt:             timestamp("createdAt").defaultNow().notNull(),
  updatedAt:             timestamp("updatedAt").defaultNow().notNull(),
});

export type OperationalTemplateRow       = typeof operationalTemplatesTable.$inferSelect;
export type InsertOperationalTemplateRow = typeof operationalTemplatesTable.$inferInsert;

/**
 * Sprint 3.4 — Pilot Organizations.
 */
export const pilotOrganizationsTable = mysqlTable("pilot_organizations", {
  id:                varchar("id",          { length: 128 }).notNull().primaryKey(),
  organizationId:    int("organization_id").notNull(),
  municipio:         varchar("municipio",   { length: 256 }).notNull(),
  estado:            varchar("estado",      { length: 2   }).notNull(),
  populacao:         int("populacao").notNull().default(0),
  pilotPhase:        varchar("pilot_phase", { length: 32  }).notNull().default("onboarding"),
  pilotStartedAt:    timestamp("pilot_started_at").defaultNow().notNull(),
  pilotGoLiveAt:     timestamp("pilot_go_live_at"),
  rolloutPercentage: int("rollout_percentage").notNull().default(0),
  features:          json("features").notNull(),
  metrics:           json("metrics").notNull(),
  health:            json("health").notNull(),
  auditTrail:        json("audit_trail").notNull(),
  createdAt:         timestamp("createdAt").defaultNow().notNull(),
  updatedAt:         timestamp("updatedAt").defaultNow().notNull(),
});

export type PilotOrganizationRow       = typeof pilotOrganizationsTable.$inferSelect;
export type InsertPilotOrganizationRow = typeof pilotOrganizationsTable.$inferInsert;

/**
 * Sprint 3.4 — Department Permissions.
 */
export const departmentPermissionsTable = mysqlTable("department_permissions", {
  id:             varchar("id",         { length: 128 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  userId:         int("user_id").notNull(),
  department:     varchar("department", { length: 128 }).notNull(),
  resource:       varchar("resource",   { length: 64  }).notNull(),
  actions:        json("actions").notNull(),
  scope:          varchar("scope",      { length: 32  }).notNull().default("own"),
  grantedBy:      int("granted_by").notNull(),
  grantedAt:      timestamp("granted_at").defaultNow().notNull(),
  expiresAt:      timestamp("expires_at"),
  active:         boolean("active").notNull().default(true),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type DepartmentPermissionRow       = typeof departmentPermissionsTable.$inferSelect;
export type InsertDepartmentPermissionRow = typeof departmentPermissionsTable.$inferInsert;

/**
 * Sprint 3.4 — Workflow Permissions.
 */
export const workflowPermissionsTable = mysqlTable("workflow_permissions", {
  id:             varchar("id",             { length: 128 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  userId:         int("user_id").notNull(),
  workflowStage:  varchar("workflow_stage", { length: 64  }).notNull(),
  canAdvance:     boolean("can_advance").notNull().default(false),
  canReject:      boolean("can_reject").notNull().default(false),
  canEscalate:    boolean("can_escalate").notNull().default(false),
  canDelegate:    boolean("can_delegate").notNull().default(false),
  maxDelegations: int("max_delegations").notNull().default(1),
  grantedBy:      int("granted_by").notNull(),
  grantedAt:      timestamp("granted_at").defaultNow().notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type WorkflowPermissionRow       = typeof workflowPermissionsTable.$inferSelect;
export type InsertWorkflowPermissionRow = typeof workflowPermissionsTable.$inferInsert;

/**
 * Sprint 3.4 — Environments.
 */
export const environmentsTable = mysqlTable("environments", {
  id:             varchar("id",   { length: 128 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  name:           varchar("name", { length: 256 }).notNull(),
  type:           varchar("type", { length: 32  }).notNull().default("development"),
  status:         varchar("status", { length: 32 }).notNull().default("active"),
  config:         json("config").notNull(),
  version:        varchar("version", { length: 32 }).notNull().default("1.0.0"),
  promotedFrom:   varchar("promoted_from", { length: 128 }),
  createdBy:      int("created_by").notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
  updatedAt:      timestamp("updatedAt").defaultNow().notNull(),
});

export type EnvironmentRow       = typeof environmentsTable.$inferSelect;
export type InsertEnvironmentRow = typeof environmentsTable.$inferInsert;

/**
 * Sprint 3.4 — UX Events.
 */
export const uxEventsTable = mysqlTable("ux_events", {
  id:             varchar("id",          { length: 128 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  userId:         int("user_id").notNull(),
  sessionId:      varchar("session_id",  { length: 128 }).notNull(),
  eventType:      varchar("event_type",  { length: 64  }).notNull(),
  feature:        varchar("feature",     { length: 128 }).notNull(),
  metadata:       json("metadata").notNull(),
  durationMs:     int("duration_ms"),
  occurredAt:     timestamp("occurred_at").defaultNow().notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type UXEventRow       = typeof uxEventsTable.$inferSelect;
export type InsertUXEventRow = typeof uxEventsTable.$inferInsert;

/**
 * Sprint 3.4 — Workflow Analytics Snapshots.
 */
export const workflowAnalyticsSnapshotsTable = mysqlTable("workflow_analytics_snapshots", {
  id:                   varchar("id", { length: 128 }).notNull().primaryKey(),
  organizationId:       int("organization_id").notNull(),
  periodStart:          timestamp("period_start").notNull(),
  periodEnd:            timestamp("period_end").notNull(),
  totalProcesses:       int("total_processes").notNull().default(0),
  completedProcesses:   int("completed_processes").notNull().default(0),
  avgCompletionDays:    decimal("avg_completion_days", { precision: 10, scale: 2 }).notNull().default("0"),
  bottleneckStages:     json("bottleneck_stages").notNull(),
  dropOffPoints:        json("drop_off_points").notNull(),
  userEngagementScore:  int("user_engagement_score").notNull().default(0),
  computedAt:           timestamp("computed_at").defaultNow().notNull(),
  createdAt:            timestamp("createdAt").defaultNow().notNull(),
});

export type WorkflowAnalyticsSnapshotRow       = typeof workflowAnalyticsSnapshotsTable.$inferSelect;
export type InsertWorkflowAnalyticsSnapshotRow = typeof workflowAnalyticsSnapshotsTable.$inferInsert;

/**
 * Sprint 3.5 — Pilot Execution Snapshots.
 */
export const pilotExecutionSnapshotsTable = mysqlTable("pilot_execution_snapshots", {
  id:               varchar("id",               { length: 128 }).notNull().primaryKey(),
  organizationId:   int("organization_id").notNull(),
  municipio:        varchar("municipio",        { length: 256 }).notNull(),
  activationState:  varchar("activation_state", { length: 64  }).notNull().default("inactive"),
  maturityLevel:    varchar("maturity_level",   { length: 32  }).notNull().default("initial"),
  adoptionScore:    json("adoption_score").notNull(),
  healthIndicators: json("health_indicators").notNull(),
  riskIndicators:   json("risk_indicators").notNull(),
  rolloutStages:    json("rollout_stages").notNull(),
  executionHistory: json("execution_history").notNull(),
  startedAt:        timestamp("started_at").defaultNow().notNull(),
  lastActivityAt:   timestamp("last_activity_at").defaultNow().notNull(),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
  updatedAt:        timestamp("updatedAt").defaultNow().notNull(),
});

export type PilotExecutionSnapshotRow       = typeof pilotExecutionSnapshotsTable.$inferSelect;
export type InsertPilotExecutionSnapshotRow = typeof pilotExecutionSnapshotsTable.$inferInsert;

/**
 * Sprint 3.5 — Operational Feedback.
 */
export const operationalFeedbackTable = mysqlTable("operational_feedback", {
  id:             varchar("id",       { length: 128 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  userHash:       varchar("user_hash", { length: 32  }).notNull(),
  category:       varchar("category", { length: 64  }).notNull(),
  severity:       varchar("severity", { length: 16  }).notNull().default("low"),
  feature:        varchar("feature",  { length: 256 }).notNull(),
  message:        text("message").notNull(),
  rating:         int("rating"),
  metadata:       json("metadata").notNull(),
  collectedAt:    timestamp("collected_at").defaultNow().notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type OperationalFeedbackRow       = typeof operationalFeedbackTable.$inferSelect;
export type InsertOperationalFeedbackRow = typeof operationalFeedbackTable.$inferInsert;

/**
 * Sprint 3.5 — Workload Metrics.
 */
export const workloadMetricsTable = mysqlTable("workload_metrics", {
  id:                    varchar("id", { length: 128 }).notNull().primaryKey(),
  organizationId:        int("organization_id").notNull(),
  periodStart:           timestamp("period_start").notNull(),
  periodEnd:             timestamp("period_end").notNull(),
  reviewerWorkloads:     json("reviewer_workloads").notNull(),
  alerts:                json("alerts").notNull(),
  queueHealth:           json("queue_health").notNull(),
  avgApprovalLatencyMs:  int("avg_approval_latency_ms").notNull().default(0),
  totalPending:          int("total_pending").notNull().default(0),
  throughputPerHour:     decimal("throughput_per_hour", { precision: 10, scale: 4 }).notNull().default("0"),
  productivityScore:     int("productivity_score").notNull().default(100),
  computedAt:            timestamp("computed_at").defaultNow().notNull(),
  createdAt:             timestamp("createdAt").defaultNow().notNull(),
});

export type WorkloadMetricsRow       = typeof workloadMetricsTable.$inferSelect;
export type InsertWorkloadMetricsRow = typeof workloadMetricsTable.$inferInsert;

/**
 * Sprint 3.5 — Support Incidents.
 */
export const supportIncidentsTable = mysqlTable("support_incidents", {
  id:                 varchar("id",          { length: 128 }).notNull().primaryKey(),
  organizationId:     int("organization_id").notNull(),
  title:              varchar("title",       { length: 512 }).notNull(),
  description:        text("description").notNull(),
  severity:           varchar("severity",    { length: 16  }).notNull().default("low"),
  category:           varchar("category",    { length: 32  }).notNull(),
  status:             varchar("status",      { length: 32  }).notNull().default("open"),
  reportedBy:         int("reported_by").notNull(),
  assignedTo:         int("assigned_to"),
  escalations:        json("escalations").notNull(),
  history:            json("history").notNull(),
  relatedProcessIds:  json("related_process_ids").notNull(),
  resolution:         text("resolution"),
  resolvedAt:         timestamp("resolved_at"),
  closedAt:           timestamp("closed_at"),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
  updatedAt:          timestamp("updatedAt").defaultNow().notNull(),
});

export type SupportIncidentRow       = typeof supportIncidentsTable.$inferSelect;
export type InsertSupportIncidentRow = typeof supportIncidentsTable.$inferInsert;

/**
 * Sprint 3.5 — Pilot Readiness Scores.
 */
export const pilotReadinessScoresTable = mysqlTable("pilot_readiness_scores", {
  id:              varchar("id",         { length: 128 }).notNull().primaryKey(),
  organizationId:  int("organization_id").notNull(),
  totalScore:      int("total_score").notNull().default(0),
  tier:            varchar("tier",       { length: 16  }).notNull().default("not_ready"),
  dimensions:      json("dimensions").notNull(),
  replayKey:       varchar("replay_key", { length: 64  }).notNull(),
  recommendations: json("recommendations").notNull(),
  computedAt:      timestamp("computed_at").defaultNow().notNull(),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
});

export type PilotReadinessScoreRow       = typeof pilotReadinessScoresTable.$inferSelect;
export type InsertPilotReadinessScoreRow = typeof pilotReadinessScoresTable.$inferInsert;

/**
 * Sprint 3.5 — Operational Health Snapshots.
 */
export const operationalHealthSnapshotsTable = mysqlTable("operational_health_snapshots", {
  id:               varchar("id", { length: 128 }).notNull().primaryKey(),
  organizationId:   int("organization_id").notNull(),
  overallStatus:    varchar("overall_status",    { length: 16 }).notNull().default("healthy"),
  avgScore:         int("avg_score").notNull().default(100),
  workflowHealth:   int("workflow_health").notNull().default(100),
  reviewHealth:     int("review_health").notNull().default(100),
  approvalHealth:   int("approval_health").notNull().default(100),
  onboardingHealth: int("onboarding_health").notNull().default(100),
  supportHealth:    int("support_health").notNull().default(100),
  activeIncidents:  int("active_incidents").notNull().default(0),
  activeRisks:      int("active_risks").notNull().default(0),
  snapshotAt:       timestamp("snapshot_at").defaultNow().notNull(),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
});

export type OperationalHealthSnapshotRow       = typeof operationalHealthSnapshotsTable.$inferSelect;
export type InsertOperationalHealthSnapshotRow = typeof operationalHealthSnapshotsTable.$inferInsert;

/**
 * Sprint 3.5 — Training Analytics.
 */
export const trainingAnalyticsTable = mysqlTable("training_analytics", {
  id:             varchar("id",          { length: 128 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  userHash:       varchar("user_hash",   { length: 32  }).notNull(),
  moduleId:       varchar("module_id",   { length: 128 }).notNull(),
  moduleName:     varchar("module_name", { length: 256 }).notNull(),
  role:           varchar("role",        { length: 64  }).notNull(),
  startedAt:      timestamp("started_at").defaultNow().notNull(),
  completedAt:    timestamp("completed_at"),
  durationMs:     int("duration_ms").notNull().default(0),
  score:          int("score"),
  attempts:       int("attempts").notNull().default(1),
  isSimulation:   boolean("is_simulation").notNull().default(false),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export type TrainingAnalyticsRow       = typeof trainingAnalyticsTable.$inferSelect;
export type InsertTrainingAnalyticsRow = typeof trainingAnalyticsTable.$inferInsert;

// ─── Sprint 3.6 ───────────────────────────────────────────────────────────────

export const institutionalDeploymentsTable = mysqlTable("institutional_deployments", {
  id:                 varchar("id", { length: 64 }).primaryKey(),
  organizationId:     int("organization_id").notNull(),
  municipio:          varchar("municipio", { length: 255 }).notNull(),
  phase:              varchar("phase", { length: 50 }).notNull().default("planning"),
  status:             varchar("status", { length: 50 }).notNull().default("scheduled"),
  targetVersion:      varchar("target_version", { length: 50 }).notNull(),
  currentVersion:     varchar("current_version", { length: 50 }).notNull(),
  rolloutPercentage:  tinyint("rollout_percentage").notNull().default(0),
  healthScore:        tinyint("health_score").notNull().default(100),
  validationResults:  json("validation_results"),
  rollbackPoint:      varchar("rollback_point", { length: 64 }),
  activatedAt:        datetime("activated_at", { fsp: 3 }),
  completedAt:        datetime("completed_at", { fsp: 3 }),
  createdAt:          timestamp("createdAt").defaultNow().notNull(),
});

export const deploymentValidationSnapshotsTable = mysqlTable("deployment_validation_snapshots", {
  id:              varchar("id", { length: 64 }).primaryKey(),
  organizationId:  int("organization_id").notNull(),
  deploymentId:    varchar("deployment_id", { length: 64 }).notNull(),
  passedCount:     smallint("passed_count").notNull().default(0),
  warningCount:    smallint("warning_count").notNull().default(0),
  errorCount:      smallint("error_count").notNull().default(0),
  criticalCount:   smallint("critical_count").notNull().default(0),
  overallPassed:   tinyint("overall_passed").notNull().default(0),
  replayKey:       varchar("replay_key", { length: 64 }).notNull(),
  generatedAt:     datetime("generated_at", { fsp: 3 }).notNull(),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
});

export const serviceHealthSnapshotsTable = mysqlTable("service_health_snapshots", {
  id:               varchar("id", { length: 64 }).primaryKey(),
  organizationId:   int("organization_id").notNull(),
  overallSlaScore:  tinyint("overall_sla_score").notNull().default(100),
  breachingMetrics: json("breaching_metrics"),
  warningMetrics:   json("warning_metrics"),
  snapshotAt:       datetime("snapshot_at", { fsp: 3 }).notNull(),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
});

export const operationalStabilityMetricsTable = mysqlTable("operational_stability_metrics", {
  id:             varchar("id", { length: 64 }).primaryKey(),
  organizationId: int("organization_id").notNull(),
  metricType:     varchar("metric_type", { length: 50 }).notNull(),
  value:          double("value").notNull(),
  unit:           varchar("unit", { length: 20 }).notNull().default("count"),
  threshold:      double("threshold").notNull(),
  isAnomalous:    tinyint("is_anomalous").notNull().default(0),
  recordedAt:     datetime("recorded_at", { fsp: 3 }).notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export const recoveryCheckpointsTable = mysqlTable("recovery_checkpoints", {
  id:             varchar("id", { length: 64 }).primaryKey(),
  organizationId: int("organization_id").notNull(),
  checkpointType: varchar("checkpoint_type", { length: 50 }).notNull(),
  snapshotData:   json("snapshot_data").notNull(),
  integrityHash:  varchar("integrity_hash", { length: 64 }).notNull(),
  isValid:        tinyint("is_valid").notNull().default(1),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export const governancePoliciesTable = mysqlTable("governance_policies", {
  id:             varchar("id", { length: 64 }).primaryKey(),
  organizationId: int("organization_id").notNull(),
  policyType:     varchar("policy_type", { length: 50 }).notNull(),
  name:           varchar("name", { length: 255 }).notNull(),
  description:    text("description"),
  rules:          json("rules").notNull(),
  isActive:       tinyint("is_active").notNull().default(1),
  effectiveFrom:  datetime("effective_from", { fsp: 3 }).notNull(),
  effectiveTo:    datetime("effective_to", { fsp: 3 }),
  createdBy:      int("created_by").notNull(),
  createdAt:      timestamp("createdAt").defaultNow().notNull(),
});

export const supportEscalationsTable = mysqlTable("support_escalations", {
  id:               int("id").autoincrement().primaryKey(),
  organizationId:   int("organization_id").notNull(),
  incidentId:       varchar("incident_id", { length: 64 }).notNull(),
  escalationLevel:  tinyint("escalation_level").notNull().default(1),
  escalatedTo:      varchar("escalated_to", { length: 255 }).notNull(),
  reason:           text("reason").notNull(),
  status:           varchar("status", { length: 50 }).notNull().default("open"),
  escalatedAt:      datetime("escalated_at", { fsp: 3 }).notNull(),
  resolvedAt:       datetime("resolved_at", { fsp: 3 }),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
});

export const continuousOperationMetricsTable = mysqlTable("continuous_operation_metrics", {
  id:              int("id").autoincrement().primaryKey(),
  organizationId:  int("organization_id").notNull(),
  periodDays:      smallint("period_days").notNull().default(30),
  workflowDecay:   tinyint("workflow_decay").notNull().default(0),
  adoptionDecay:   tinyint("adoption_decay").notNull().default(0),
  fatigue:         tinyint("fatigue").notNull().default(0),
  supportOverload: tinyint("support_overload").notNull().default(0),
  degradedMetrics: json("degraded_metrics"),
  severity:        varchar("severity", { length: 20 }).notNull().default("none"),
  recordedAt:      datetime("recorded_at", { fsp: 3 }).notNull(),
  createdAt:       timestamp("createdAt").defaultNow().notNull(),
});

export const stabilitySnapshotsTable = mysqlTable("stability_snapshots", {
  id:               varchar("id", { length: 64 }).primaryKey(),
  organizationId:   int("organization_id").notNull(),
  overallScore:     tinyint("overall_score").notNull().default(100),
  degradationLevel: varchar("degradation_level", { length: 20 }).notNull().default("none"),
  trend:            varchar("trend", { length: 20 }).notNull().default("stable"),
  activeAnomalies:  json("active_anomalies"),
  snapshotAt:       datetime("snapshot_at", { fsp: 3 }).notNull(),
  createdAt:        timestamp("createdAt").defaultNow().notNull(),
});

export type InstitutionalDeploymentRow      = typeof institutionalDeploymentsTable.$inferSelect;
export type DeploymentValidationSnapshotRow = typeof deploymentValidationSnapshotsTable.$inferSelect;
export type ServiceHealthSnapshotRow        = typeof serviceHealthSnapshotsTable.$inferSelect;
export type OperationalStabilityMetricRow   = typeof operationalStabilityMetricsTable.$inferSelect;
export type RecoveryCheckpointRow           = typeof recoveryCheckpointsTable.$inferSelect;
export type GovernancePolicyRow             = typeof governancePoliciesTable.$inferSelect;
export type SupportEscalationRow            = typeof supportEscalationsTable.$inferSelect;
export type ContinuousOperationMetricRow    = typeof continuousOperationMetricsTable.$inferSelect;
export type StabilitySnapshotRow            = typeof stabilitySnapshotsTable.$inferSelect;

// ─── Sprint 4.0: AI Foundation Layer ────────────────────────────────────────

export const aiOrchestrationsTable = mysqlTable("ai_orchestrations", {
  id:             varchar("id", { length: 20 }).primaryKey(),
  organizationId: int("organization_id").notNull(),
  sessionId:      varchar("session_id", { length: 40 }).notNull(),
  promptId:       varchar("prompt_id", { length: 20 }),
  provider:       varchar("provider", { length: 50 }).notNull().default("mock"),
  model:          varchar("model", { length: 100 }).notNull().default("mock-default"),
  status:         varchar("status", { length: 30 }).notNull().default("queued"),
  attempt:        smallint("attempt").notNull().default(1),
  maxAttempts:    smallint("max_attempts").notNull().default(3),
  lineage:        json("lineage"),
  inputs:         json("inputs"),
  outputs:        json("outputs"),
  error:          text("error"),
  history:        json("history"),
  replayKey:      varchar("replay_key", { length: 64 }).notNull(),
  startedAt:      datetime("started_at", { fsp: 3 }).notNull(),
  completedAt:    datetime("completed_at", { fsp: 3 }),
  updatedAt:      datetime("updated_at", { fsp: 3 }).notNull(),
  createdAt:      datetime("created_at", { fsp: 3 }).notNull(),
});

export const aiPromptVersionsTable = mysqlTable("ai_prompt_versions", {
  id:             varchar("id", { length: 20 }).primaryKey(),
  organizationId: int("organization_id").notNull(),
  promptKey:      varchar("prompt_key", { length: 100 }).notNull(),
  version:        varchar("version", { length: 20 }).notNull().default("1.0.0"),
  content:        longtext("content").notNull(),
  variables:      json("variables"),
  status:         varchar("status", { length: 30 }).notNull().default("draft"),
  approvedBy:     int("approved_by"),
  rejectedBy:     int("rejected_by"),
  rollbackFrom:   varchar("rollback_from", { length: 20 }),
  lineage:        json("lineage"),
  history:        json("history"),
  legalBasis:     text("legal_basis"),
  checksum:       varchar("checksum", { length: 64 }).notNull(),
  metadata:       json("metadata"),
  createdBy:      int("created_by").notNull(),
  updatedAt:      datetime("updated_at", { fsp: 3 }).notNull(),
  createdAt:      datetime("created_at", { fsp: 3 }).notNull(),
});

export const semanticMemoriesTable = mysqlTable("semantic_memories", {
  id:             varchar("id", { length: 20 }).primaryKey(),
  organizationId: int("organization_id").notNull(),
  memoryType:     varchar("memory_type", { length: 30 }).notNull().default("semantic"),
  key:            varchar("key", { length: 200 }).notNull(),
  value:          longtext("value").notNull(),
  sourceRef:      varchar("source_ref", { length: 255 }),
  context:        json("context"),
  relevanceScore: decimal("relevance_score", { precision: 4, scale: 3 }).notNull().default("0.500"),
  lastAccessedAt: datetime("last_accessed_at", { fsp: 3 }),
  accessCount:    int("access_count").notNull().default(0),
  ttlMs:          varchar("ttl_ms", { length: 20 }),
  isActive:       tinyint("is_active").notNull().default(1),
  updatedAt:      datetime("updated_at", { fsp: 3 }).notNull(),
  createdAt:      datetime("created_at", { fsp: 3 }).notNull(),
});

export const embeddingSnapshotsTable = mysqlTable("embedding_snapshots", {
  id:             varchar("id", { length: 20 }).primaryKey(),
  organizationId: int("organization_id").notNull(),
  textHash:       varchar("text_hash", { length: 64 }).notNull(),
  model:          varchar("model", { length: 100 }).notNull().default("mock-embed-v1"),
  dimensions:     smallint("dimensions").notNull().default(1536),
  checksum:       varchar("checksum", { length: 64 }).notNull(),
  vectorPreview:  json("vector_preview"),
  createdAt:      datetime("created_at", { fsp: 3 }).notNull(),
});

export const vectorIndexSnapshotsTable = mysqlTable("vector_index_snapshots", {
  id:             varchar("id", { length: 20 }).primaryKey(),
  organizationId: int("organization_id").notNull(),
  indexName:      varchar("index_name", { length: 100 }).notNull(),
  dimensions:     smallint("dimensions").notNull().default(1536),
  entryCount:     int("entry_count").notNull().default(0),
  metadata:       json("metadata"),
  updatedAt:      datetime("updated_at", { fsp: 3 }).notNull(),
  createdAt:      datetime("created_at", { fsp: 3 }).notNull(),
});

export const groundingEvidenceTable = mysqlTable("grounding_evidence", {
  id:             varchar("id", { length: 20 }).primaryKey(),
  organizationId: int("organization_id").notNull(),
  sourceRef:      varchar("source_ref", { length: 255 }).notNull(),
  content:        longtext("content").notNull(),
  relevanceScore: decimal("relevance_score", { precision: 4, scale: 3 }).notNull().default("0.500"),
  evidenceType:   varchar("evidence_type", { length: 30 }).notNull().default("document"),
  legalBasis:     text("legal_basis"),
  citationKey:    varchar("citation_key", { length: 100 }).notNull(),
  verified:       tinyint("verified").notNull().default(0),
  verifiedAt:     datetime("verified_at", { fsp: 3 }),
  metadata:       json("metadata"),
  createdAt:      datetime("created_at", { fsp: 3 }).notNull(),
});

export const aiExecutionAuditsTable = mysqlTable("ai_execution_audits", {
  id:                varchar("id", { length: 20 }).primaryKey(),
  organizationId:    int("organization_id").notNull(),
  sessionId:         varchar("session_id", { length: 40 }).notNull(),
  operation:         varchar("operation", { length: 30 }).notNull(),
  actorId:           int("actor_id"),
  provider:          varchar("provider", { length: 50 }),
  modelId:           varchar("model_id", { length: 100 }),
  promptId:          varchar("prompt_id", { length: 20 }),
  inputHash:         varchar("input_hash", { length: 64 }).notNull(),
  outputHash:        varchar("output_hash", { length: 64 }),
  durationMs:        int("duration_ms"),
  tokenCount:        int("token_count"),
  success:           tinyint("success").notNull().default(1),
  error:             text("error"),
  replayKey:         varchar("replay_key", { length: 64 }).notNull(),
  forensicSignature: varchar("forensic_signature", { length: 64 }).notNull(),
  immutable:         tinyint("immutable").notNull().default(1),
  recordedAt:        datetime("recorded_at", { fsp: 3 }).notNull(),
  createdAt:         datetime("created_at", { fsp: 3 }).notNull(),
});

export const aiTokenEstimationsTable = mysqlTable("ai_token_estimations", {
  id:               varchar("id", { length: 20 }).primaryKey(),
  organizationId:   int("organization_id").notNull(),
  sessionId:        varchar("session_id", { length: 40 }).notNull(),
  model:            varchar("model", { length: 100 }).notNull().default("mock-default"),
  maxTokens:        int("max_tokens").notNull().default(4096),
  usedTokens:       int("used_tokens").notNull().default(0),
  reservedTokens:   int("reserved_tokens").notNull().default(0),
  costEstimateUsd:  decimal("cost_estimate_usd", { precision: 10, scale: 6 }).notNull().default("0.000000"),
  warnings:         json("warnings"),
  hardLimit:        tinyint("hard_limit").notNull().default(0),
  updatedAt:        datetime("updated_at", { fsp: 3 }).notNull(),
  createdAt:        datetime("created_at", { fsp: 3 }).notNull(),
});

export const aiWorkflowStatesTable = mysqlTable("ai_workflow_states", {
  id:                     varchar("id", { length: 20 }).primaryKey(),
  organizationId:         int("organization_id").notNull(),
  workflowKey:            varchar("workflow_key", { length: 100 }).notNull(),
  currentStep:            varchar("current_step", { length: 30 }).notNull().default("ai_generation"),
  status:                 varchar("status", { length: 30 }).notNull().default("pending"),
  steps:                  json("steps"),
  overrides:              json("overrides"),
  approvals:              json("approvals"),
  actor:                  int("actor").notNull(),
  requiresHumanApproval:  tinyint("requires_human_approval").notNull().default(0),
  autoApprovalThreshold:  decimal("auto_approval_threshold", { precision: 4, scale: 3 }),
  explanation:            text("explanation"),
  lineage:                json("lineage"),
  history:                json("history"),
  updatedAt:              datetime("updated_at", { fsp: 3 }).notNull(),
  createdAt:              datetime("created_at", { fsp: 3 }).notNull(),
});

// ─── Sprint 4.1: Semantic Retrieval & Memory ─────────────────────────────────

export const semanticChunksTable = mysqlTable("semantic_chunks", {
  id: varchar("id", { length: 20 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  documentId: varchar("document_id", { length: 100 }).notNull(),
  documentType: varchar("document_type", { length: 50 }).notNull(),
  content: text("content"),
  tokenCount: int("token_count").notNull().default(0),
  chunkIndex: int("chunk_index").notNull().default(0),
  totalChunks: int("total_chunks").notNull().default(0),
  strategy: varchar("strategy", { length: 50 }).notNull(),
  sectionTitle: varchar("section_title", { length: 255 }),
  legalRef: varchar("legal_ref", { length: 255 }),
  overlapWithPrev: int("overlap_with_prev").notNull().default(0),
  lineage: json("lineage"),
  replayKey: varchar("replay_key", { length: 64 }).notNull(),
  metadata: json("metadata"),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});

export const retrievalQueriesTable = mysqlTable("retrieval_queries", {
  id: varchar("id", { length: 20 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  rawQuery: text("raw_query"),
  expandedTerms: json("expanded_terms"),
  synonymExpansion: json("synonym_expansion"),
  correctedQuery: varchar("corrected_query", { length: 500 }),
  filters: json("filters"),
  replayKey: varchar("replay_key", { length: 64 }).notNull(),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});

export const retrievalResultsTable = mysqlTable("retrieval_results", {
  id: varchar("id", { length: 20 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  queryId: varchar("query_id", { length: 20 }).notNull(),
  chunkId: varchar("chunk_id", { length: 20 }).notNull(),
  lexicalScore: decimal("lexical_score", { precision: 6, scale: 5 }).notNull().default("0"),
  semanticScore: decimal("semantic_score", { precision: 6, scale: 5 }).notNull().default("0"),
  contextualScore: decimal("contextual_score", { precision: 6, scale: 5 }).notNull().default("0"),
  hybridScore: decimal("hybrid_score", { precision: 6, scale: 5 }).notNull().default("0"),
  rankPosition: int("rank_position").notNull().default(0),
  retrievalStrategy: varchar("retrieval_strategy", { length: 50 }).notNull(),
  scoreBreakdown: json("score_breakdown"),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});

export const semanticRelationshipsTable = mysqlTable("semantic_relationships", {
  id: varchar("id", { length: 20 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  sourceNodeId: varchar("source_node_id", { length: 100 }).notNull(),
  sourceType: varchar("source_type", { length: 50 }).notNull(),
  targetNodeId: varchar("target_node_id", { length: 100 }).notNull(),
  targetType: varchar("target_type", { length: 50 }).notNull(),
  edgeType: varchar("edge_type", { length: 50 }).notNull(),
  weight: decimal("weight", { precision: 6, scale: 5 }).notNull().default("1"),
  propagatedScore: decimal("propagated_score", { precision: 6, scale: 5 }),
  hopDistance: int("hop_distance").notNull().default(0),
  metadata: json("metadata"),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});

export const institutionalMemoriesTable = mysqlTable("institutional_memories", {
  id: varchar("id", { length: 20 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  memoryType: varchar("memory_type", { length: 50 }).notNull(),
  content: text("content"),
  sourceId: varchar("source_id", { length: 100 }),
  sourceType: varchar("source_type", { length: 50 }),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull().default("0"),
  accessCount: int("access_count").notNull().default(0),
  tags: json("tags"),
  ttlMs: bigint("ttl_ms", { mode: "number" }),
  lineage: json("lineage"),
  replayKey: varchar("replay_key", { length: 64 }).notNull(),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime("updated_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});

export const evidenceChainsTable = mysqlTable("evidence_chains", {
  id: varchar("id", { length: 20 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  chainType: varchar("chain_type", { length: 50 }).notNull(),
  headEvidenceId: varchar("head_evidence_id", { length: 100 }).notNull(),
  links: json("links"),
  totalLinks: int("total_links").notNull().default(0),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull().default("0"),
  provenance: json("provenance"),
  isSuperseded: tinyint("is_superseded").notNull().default(0),
  supersededBy: varchar("superseded_by", { length: 20 }),
  lineage: json("lineage"),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});

export const retrievalExplanationsTable = mysqlTable("retrieval_explanations", {
  id: varchar("id", { length: 20 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  queryId: varchar("query_id", { length: 20 }).notNull(),
  correlationId: varchar("correlation_id", { length: 20 }).notNull(),
  explanationTree: json("explanation_tree"),
  rankingLineage: json("ranking_lineage"),
  traceSteps: json("trace_steps"),
  humanSummary: text("human_summary"),
  confidence: decimal("confidence", { precision: 4, scale: 3 }).notNull().default("0"),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});

export const semanticIndexesTable = mysqlTable("semantic_indexes", {
  id: varchar("id", { length: 20 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  indexName: varchar("index_name", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 50 }).notNull(),
  entityId: varchar("entity_id", { length: 100 }).notNull(),
  tokens: json("tokens"),
  tokenCount: int("token_count").notNull().default(0),
  indexHash: varchar("index_hash", { length: 64 }).notNull(),
  contentPreview: varchar("content_preview", { length: 500 }),
  metadata: json("metadata"),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});

export const retrievalObservabilityTable = mysqlTable("retrieval_observability", {
  id: varchar("id", { length: 20 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  correlationId: varchar("correlation_id", { length: 20 }).notNull(),
  operation: varchar("operation", { length: 100 }).notNull(),
  durationMs: int("duration_ms").notNull().default(0),
  resultCount: int("result_count").notNull().default(0),
  avgScore: decimal("avg_score", { precision: 6, scale: 5 }),
  p95LatencyMs: int("p95_latency_ms"),
  stageBreakdown: json("stage_breakdown"),
  tags: json("tags"),
  alertFired: tinyint("alert_fired").notNull().default(0),
  alertType: varchar("alert_type", { length: 50 }),
  recordedAt: datetime("recorded_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});

export const memoryRetentionSnapshotsTable = mysqlTable("memory_retention_snapshots", {
  id: varchar("id", { length: 20 }).notNull().primaryKey(),
  organizationId: int("organization_id").notNull(),
  policyId: varchar("policy_id", { length: 20 }).notNull(),
  snapshotType: varchar("snapshot_type", { length: 50 }).notNull(),
  totalMemories: int("total_memories").notNull().default(0),
  activeCount: int("active_count").notNull().default(0),
  expiringSoonCount: int("expiring_soon_count").notNull().default(0),
  expiredCount: int("expired_count").notNull().default(0),
  archivedCount: int("archived_count").notNull().default(0),
  avgConfidence: decimal("avg_confidence", { precision: 4, scale: 3 }),
  metrics: json("metrics"),
  lineage: json("lineage"),
  snapshotAt: datetime("snapshot_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  createdAt: datetime("created_at", { mode: "string", fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});

export type AIOrchestrationRow      = typeof aiOrchestrationsTable.$inferSelect;
export type AIPromptVersionRow      = typeof aiPromptVersionsTable.$inferSelect;
export type SemanticMemoryRow       = typeof semanticMemoriesTable.$inferSelect;
export type EmbeddingSnapshotRow    = typeof embeddingSnapshotsTable.$inferSelect;
export type VectorIndexSnapshotRow  = typeof vectorIndexSnapshotsTable.$inferSelect;
export type GroundingEvidenceRow    = typeof groundingEvidenceTable.$inferSelect;
export type AIExecutionAuditRow     = typeof aiExecutionAuditsTable.$inferSelect;
export type AITokenEstimationRow    = typeof aiTokenEstimationsTable.$inferSelect;
export type AIWorkflowStateRow      = typeof aiWorkflowStatesTable.$inferSelect;

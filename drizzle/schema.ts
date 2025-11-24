import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean, json, decimal } from "drizzle-orm/mysql-core";

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
  platformId: int("platformId"), // Plataforma de pregão selecionada (Compras.gov.br, BLL, etc)
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
 * Templates personalizáveis para documentos
 */
export const documentTemplates = mysqlTable("document_templates", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // Usuário que criou o template
  name: varchar("name", { length: 255 }).notNull(), // Nome do template
  description: text("description"), // Descrição do template
  type: mysqlEnum("type", ["etp", "tr", "dfd", "edital"]).notNull(), // Tipo de documento
  content: text("content").notNull(), // Conteúdo do template em markdown
  isDefault: int("isDefault").default(0).notNull(), // 1 se for template padrão do usuário
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

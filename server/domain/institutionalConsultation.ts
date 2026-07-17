/**
 * RC-5.1 — Business Domain "Tirar Dúvidas" (Institutional Consultation) · Domain Layer.
 *
 * Domínio institucional de consulta normativa — NÃO é chat/chatbot/ChatGPT. Toda resposta é
 * FUNDAMENTADA, EXPLICÁVEL e AUDITÁVEL, construída exclusivamente a partir do ContextPackage
 * institucional (RC-5.0) sobre o Official Knowledge Corpus (RC-4.9). Determinístico, multi-tenant.
 * Nunca inventa fundamento; nunca cita documento inexistente; nunca afirma certeza sem base oficial.
 */

import { createHash } from "crypto";
import type { ContextPackage } from "./institutionalIntegration/contextPackage";

export const CONSULTATION_DOMAIN_CODE = "institutional_consultation";
export const CONSULTATION_DOMAIN_NAME = "Tirar Dúvidas";

/**
 * Estados explícitos da consulta:
 * - pending: registrada, ainda não executada.
 * - processing: execução em andamento.
 * - completed: resposta válida COM base documental.
 * - limited: resposta VÁLIDA porém SEM base documental suficiente (não é erro técnico).
 * - failed: falha técnica na execução.
 */
export type ConsultationStatus = "pending" | "processing" | "completed" | "limited" | "failed";

/** Pergunta normalizada (para comparação/auditoria/contextReplayHash). Determinística. */
export function normalizeQuestion(raw: string): string {
  return sanitizeQuestion(raw).toLowerCase();
}

// ── Semântica de identidade (documentada em BUSINESS_DOMAIN_TIRAR_DUVIDAS.md) ──

/** executionId — identifica uma EXECUÇÃO concreta. Único por (tenant, correlationId); cada request
 *  novo (correlationId distinto) gera nova execução, MESMO com contexto idêntico. */
export function computeExecutionId(tenantId: number, correlationId: string): string {
  return createHash("sha256").update(`exec:${tenantId}:${correlationId}`).digest("hex").slice(0, 20);
}
/** answerId — identifica a RESPOSTA persistida de uma execução (uma resposta por execução). Não é
 *  derivado do contextReplayHash: contexto igual não implica resposta idêntica. */
export function computeAnswerId(executionId: string): string {
  return createHash("sha256").update(`ans:${executionId}`).digest("hex").slice(0, 20);
}
/** replayId — identifica uma OPERAÇÃO de replay institucional (só em replay real). */
export function computeReplayId(newCorrelationId: string, replayOfExecutionId: string): string {
  return createHash("sha256").update(`replay:${newCorrelationId}:${replayOfExecutionId}`).digest("hex").slice(0, 20);
}

/** Fonte/evidência utilizada em uma consulta (persistida e vinculada ao tenant+consulta). */
export interface ConsultationSource {
  readonly id: string;
  readonly tenantId: number;
  readonly consultationId: string;
  readonly documentId: string;
  readonly documentVersion: string;
  readonly documentTitle: string;
  readonly documentType: string;
  readonly authority: string;
  readonly jurisdiction: string;
  readonly bindingLevel: string;
  readonly citation: string;
  readonly passage: string;
  readonly lineage: string;
  readonly sourceOrder: number;
  readonly createdAt: string;
}

/** Registro persistido de uma consulta institucional (fonte de verdade = PostgreSQL/MySQL). */
export interface ConsultationRecord {
  readonly id: string; // = executionId (uma consulta por execução)
  readonly tenantId: number;
  readonly userId: number;
  readonly question: string;
  readonly normalizedQuestion: string;
  readonly answer: string;
  readonly status: ConsultationStatus;
  readonly limitationReason: string;
  readonly contextPackageVersion: string;
  readonly contextReplayHash: string;
  readonly executionId: string;
  readonly answerId: string;
  readonly replayId: string | null;
  readonly replayOfExecutionId: string | null;
  readonly correlationId: string;
  readonly businessDomain: string;
  readonly taskType: string;
  readonly documentsCount: number;
  readonly passagesCount: number;
  readonly retrievalDurationMs: number;
  readonly executionDurationMs: number;
  readonly totalDurationMs: number;
  /** Snapshot versionado do ContextPackage (schemaVersion/contextReplayHash/createdAt + críticos). */
  readonly contextSnapshot: string | null;
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly failedAt: string | null;
  readonly updatedAt: string;
}

/** Sanitiza mensagem de erro para persistência (sem stack trace/segredos expostos). */
export function sanitizeErrorMessage(raw: string): string {
  return raw.split("\n")[0].replace(new RegExp("[\\u0000-\\u001F\\u007F]", "g"), " ").trim().slice(0, 500);
}

export interface ListOpts { readonly limit?: number; readonly offset?: number; }

/**
 * Contrato do repositório de consultas — a FONTE DE VERDADE é o banco (PostgreSQL/MySQL). Toda
 * operação exige tenantId (boundary multi-tenant); nenhum método busca por id sem validar o tenant.
 */
export interface ConsultationRepository {
  createConsultation(record: ConsultationRecord): Promise<ConsultationRecord>;
  markProcessing(tenantId: number, id: string, startedAt: string): Promise<void>;
  /** Finalização atômica: persiste resposta + métricas + fontes e marca completed/limited. */
  completeConsultation(record: ConsultationRecord, sources: readonly ConsultationSource[]): Promise<ConsultationRecord>;
  failConsultation(tenantId: number, id: string, errorCode: string, errorMessage: string, failedAt: string): Promise<void>;
  saveSources(sources: readonly ConsultationSource[]): Promise<void>;
  findByIdForTenant(tenantId: number, id: string): Promise<ConsultationRecord | null>;
  getSourcesForTenant(tenantId: number, consultationId: string): Promise<ConsultationSource[]>;
  listByTenant(tenantId: number, opts?: ListOpts): Promise<ConsultationRecord[]>;
  listByUserForTenant(tenantId: number, userId: number, opts?: ListOpts): Promise<ConsultationRecord[]>;
  findReplayCandidate(tenantId: number, contextReplayHash: string): Promise<ConsultationRecord | null>;
  verifyTenantOwnership(tenantId: number, id: string): Promise<boolean>;
}

export interface ConsultationFoundationItem {
  readonly documentId: string;
  readonly reference: string;
  readonly authority: string;
  readonly jurisdiction: string;
  readonly bindingLevel: string;
  readonly version: string;
}
export interface ConsultationDocumentRef {
  readonly documentId: string;
  readonly title: string;
  readonly authority: string;
  readonly jurisdiction: string;
  readonly version: string;
  readonly bindingLevel: string;
}
export interface ConsultationPassageRef {
  readonly documentId: string;
  readonly identifier: string;
  readonly text: string;
  readonly score: number;
}
export interface ConsultationCitation {
  readonly reference: string;
  readonly authority: string;
  readonly jurisdiction: string;
  readonly version: string;
  readonly bindingLevel: string;
}

export interface InstitutionalConsultationAnswer {
  readonly answerId: string;
  readonly executionId: string;
  readonly status: ConsultationStatus;
  readonly correlationId: string;
  readonly replayId: string | null;
  readonly replayOfExecutionId: string | null;
  readonly contextReplayHash: string;
  readonly tenantId: number;
  readonly userId: number;
  readonly question: string;
  /** Resposta elaborada e ESTRUTURADA (nunca texto livre) — sempre aterrada nos documentos. */
  readonly answer: string;
  readonly foundation: readonly ConsultationFoundationItem[];
  readonly documents: readonly ConsultationDocumentRef[];
  readonly passages: readonly ConsultationPassageRef[];
  readonly citations: readonly ConsultationCitation[];
  readonly observations: readonly string[];
  /** Linhas "Esta resposta foi construída utilizando: ✓ Lei 14.133 …". */
  readonly explainabilityLines: readonly string[];
  readonly limitations: readonly string[];
  readonly hasSufficientBasis: boolean;
  readonly createdAt: string;
}

/**
 * Sanitiza a pergunta (camada AUXILIAR de segurança): remove caracteres de controle e limita
 * tamanho. NÃO é, por si só, proteção contra prompt injection — é apenas uma das camadas. As
 * proteções reais são estruturais (separação instrução/dado via prompt builder tipado, ContextPackage
 * tratado como evidência, sem execução autônoma de ferramentas, fluxo fechado pelo Orchestrator,
 * validação de saída, limites de tamanho e auditoria). Ver BUSINESS_DOMAIN_TIRAR_DUVIDAS.md.
 */
export function sanitizeQuestion(raw: string): string {
  // eslint-disable-next-line no-control-regex
  return raw.replace(new RegExp("[\\u0000-\\u001F\\u007F]", "g"), " ").replace(/\s+/g, " ").trim().slice(0, 2000);
}

const AUTHORITY_LABEL: Record<string, string> = {
  "Congresso Nacional": "Lei federal",
  "Presidência da República": "Decreto federal",
  "SEGES/ME": "Instrução Normativa SEGES",
  "Tribunal de Contas da União": "Manual/Entendimento TCU",
  "TCE-PR": "TCE-PR",
  "Município de Moreira Sales": "Norma Municipal",
};

/**
 * Constrói a resposta institucional a partir do ContextPackage e do conteúdo do engine.
 * Determinística. Quando não há base documental, declara a limitação explicitamente (nunca inventa).
 */
export function buildConsultationAnswer(params: {
  tenantId: number;
  userId: number;
  question: string;
  engineContent: string;
  contextPackage: ContextPackage;
  executionId: string;
  replayId?: string | null;
  replayOfExecutionId?: string | null;
  createdAt: string;
}): InstitutionalConsultationAnswer {
  const { contextPackage: pkg } = params;
  const hasSufficientBasis = pkg.documents.length > 0 && pkg.retrievedPassages.length > 0;

  const documents: ConsultationDocumentRef[] = pkg.documents.map(d => ({
    documentId: d.documentId, title: d.title, authority: d.authority, jurisdiction: d.jurisdiction, version: d.version, bindingLevel: d.bindingLevel,
  }));
  const passages: ConsultationPassageRef[] = pkg.retrievedPassages.map(p => ({
    documentId: p.documentId, identifier: p.identifier, text: p.text, score: p.score,
  }));
  const citations: ConsultationCitation[] = pkg.citations.map(c => ({
    reference: c.reference, authority: c.authority, jurisdiction: c.jurisdiction, version: c.version, bindingLevel: c.bindingLevel,
  }));
  const foundation: ConsultationFoundationItem[] = pkg.documents.map(d => ({
    documentId: d.documentId, reference: d.title, authority: d.authority, jurisdiction: d.jurisdiction, bindingLevel: d.bindingLevel, version: d.version,
  }));
  const explainabilityLines = [...new Set(pkg.documents.map(d => `✓ ${d.title} (${AUTHORITY_LABEL[d.authority] ?? d.authority})`))];

  const observations: string[] = [
    "Esta é uma orientação técnica fundamentada em normas oficiais — não substitui parecer jurídico nem decisão da autoridade competente.",
    "Toda resposta é supervisionada, explicável e auditável.",
  ];
  const limitations: string[] = [];
  let answer: string;
  if (hasSufficientBasis) {
    const esferas = [...new Set(pkg.documents.map(d => d.jurisdiction))];
    answer = params.engineContent && params.engineContent.trim().length > 0
      ? params.engineContent.trim()
      : `Consulta fundamentada nas normas aplicáveis (${esferas.join(" → ")}). Foram localizados ${pkg.retrievedPassages.length} trecho(s) oficial(is) pertinente(s) nos documentos abaixo; consulte a fundamentação e as citações para o texto oficial verbatim.`;
  } else {
    answer = "Não foi possível localizar base documental oficial suficiente no acervo institucional para fundamentar esta consulta. Recomenda-se refinar a pergunta ou consultar a autoridade competente. Nenhum fundamento é apresentado sem base oficial.";
    limitations.push("Base documental insuficiente no Official Knowledge Corpus para esta consulta.");
  }

  const answerId = computeAnswerId(params.executionId);
  return {
    answerId, executionId: params.executionId, status: hasSufficientBasis ? "completed" : "limited",
    correlationId: pkg.correlationId, replayId: params.replayId ?? null, replayOfExecutionId: params.replayOfExecutionId ?? null,
    contextReplayHash: pkg.replayHash,
    tenantId: params.tenantId, userId: params.userId, question: params.question,
    answer, foundation, documents, passages, citations, observations, explainabilityLines, limitations,
    hasSufficientBasis, createdAt: params.createdAt,
  };
}

/** Sugestões iniciais de consulta (a página não deve parecer um chat comum). Expansível. */
export const INITIAL_CONSULTATION_SUGGESTIONS: readonly string[] = [
  "Posso realizar contratação direta neste caso?",
  "Quando devo utilizar pregão?",
  "Como aplicar os benefícios da LC 123?",
  "Como funciona o Sistema de Registro de Preços?",
  "O que diz o Prejulgado nº 27?",
  "Quais são as modalidades de licitação da Lei 14.133?",
  "Quando é cabível a dispensa de licitação?",
  "Como funciona o tratamento diferenciado para ME/EPP no meu município?",
];

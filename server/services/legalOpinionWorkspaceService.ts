/**
 * FASE 5 — Legal Opinion Workspace Service (Parecer Jurídico)
 *
 * Orquestra o trabalho do Procurador sobre uma solicitação institucional:
 * receber → analisar → elaborar → assinar → devolver. NÃO cria processos e
 * NUNCA acessa outro Business Domain diretamente — consome e responde SEMPRE
 * pelo Institutional Request Engine. Documentos por REFERÊNCIA (nunca copiados).
 *
 * Todo acesso ao Kernel (RAG, copilotos, explainability) ocorre exclusivamente
 * via kernelAccessService. Degrada graciosamente sem DB. Determinístico.
 */

import { assertKernelAccess } from "./kernelAccessService";
import { generateOfficialDocument } from "./documentEngineService";
import { orchestrateMultiCopilot } from "./workspaceOrchestratorService";
import { receiveRequest as receiveInstitutionalRequest, respondRequest } from "./institutionalRequestService";
import {
  getRequest, listRequestTimeline, listDocumentReferences,
} from "../db/institutionalRequests";
import {
  createLegalOpinionWorkspace, transitionLegalStage, assignLawyer,
  type LegalOpinionWorkspace, type LegalOpinionPriority,
} from "../domain/legalOpinionWorkspace";
import {
  createLegalOpinionDraft, updateLegalOpinionDraft, signLegalOpinionDraft, draftContentHash,
  type LegalOpinionDraft, type LegalOpinionType, type LegalOpinionConclusion, type SignatureMethod,
} from "../domain/legalOpinionDraft";
import { createLawyerAssignment } from "../domain/lawyerAssignment";
import {
  insertLegalOpinionWorkspace, getLegalOpinionWorkspace, getLegalOpinionWorkspaceByRequest,
  updateLegalOpinionWorkspaceStage, insertLegalOpinionDraft, getLegalOpinionDraftByWorkspace,
  insertLegalOpinionVersion, countLegalOpinionHistory, insertLegalOpinionHistory,
  listLegalOpinionHistory, listLegalOpinionVersions, insertLawyerAssignment,
} from "../db/legalOpinionWorkspace";

const DOMAIN = "parecer_juridico" as const;

/** Registra um evento na história do parecer, calculando a ordem. */
async function recordHistory(ws: LegalOpinionWorkspace, eventType: string, actor: string, summary: string, refId?: string): Promise<void> {
  const order = await countLegalOpinionHistory(ws.id, ws.organizationId);
  await insertLegalOpinionHistory({
    organizationId: ws.organizationId, workspaceId: ws.id, order, eventType, actor, summary,
    refId, correlationId: ws.correlationId,
  });
}

/**
 * Abre (ou recupera) o Workspace do Procurador a partir de uma solicitação
 * institucional pendente. Reutiliza o Institutional Request Engine para marcar a
 * solicitação como recebida/em andamento e espelha o estado no workspace.
 */
export async function openWorkspaceFromRequest(params: {
  requestId: string;
  organizationId: number;
  lawyerId: number;
  sector?: string;
  correlationId: string;
}): Promise<LegalOpinionWorkspace> {
  const request = await getRequest(params.requestId, params.organizationId);
  if (!request) throw new Error("Solicitação não encontrada.");
  if (request.destinationDomain !== DOMAIN) {
    throw new Error("Esta solicitação não pertence ao domínio Parecer Jurídico.");
  }

  // Reutiliza o Engine: recebe e passa a trabalhar (RECEIVED → IN_PROGRESS).
  await receiveInstitutionalRequest(params.requestId, params.organizationId, params.lawyerId);

  // Espelha o trabalho no workspace do domínio (idempotente por requestId).
  const existing = await getLegalOpinionWorkspaceByRequest(params.requestId, params.organizationId);
  let ws = existing ?? createLegalOpinionWorkspace({
    organizationId: params.organizationId, requestId: params.requestId, sourceDomain: request.sourceDomain,
    referenceProcessId: request.referenceProcessId, requestType: request.requestType,
    assignedLawyer: params.lawyerId, responsibleSector: params.sector, priority: request.priority as LegalOpinionPriority,
    correlationId: params.correlationId,
  });
  if (!existing) {
    await insertLegalOpinionWorkspace(ws);
    await recordHistory(ws, "workspace_created", String(params.lawyerId), `Trabalho aberto a partir da solicitação ${params.requestId}.`, params.requestId);
    // Distribuição interna ao procurador.
    const assignment = createLawyerAssignment({
      organizationId: params.organizationId, workspaceId: ws.id, requestId: params.requestId,
      lawyerId: params.lawyerId, sector: params.sector, priority: ws.priority, correlationId: params.correlationId,
    });
    await insertLawyerAssignment(assignment);
    // INBOX → RECEIVED → UNDER_ANALYSIS
    ws = assignLawyer(transitionLegalStage(ws, "RECEIVED"), params.lawyerId);
    await updateLegalOpinionWorkspaceStage(ws.id, ws.organizationId, ws.currentStage, ws.status, ws.assignedLawyer, ws.updatedAt);
    await recordHistory(ws, "received", String(params.lawyerId), "Solicitação recebida pelo Procurador.");
    ws = transitionLegalStage(ws, "UNDER_ANALYSIS");
    await updateLegalOpinionWorkspaceStage(ws.id, ws.organizationId, ws.currentStage, ws.status, ws.assignedLawyer, ws.updatedAt);
    await recordHistory(ws, "under_analysis", String(params.lawyerId), "Análise do processo iniciada.");
  }
  return ws;
}

export interface LegalOpinionContextBundle {
  readonly workspace: LegalOpinionWorkspace | null;
  readonly draft: LegalOpinionDraft | null;
  readonly documents: Awaited<ReturnType<typeof listDocumentReferences>>;
  readonly timeline: Awaited<ReturnType<typeof listRequestTimeline>>;
  readonly history: Awaited<ReturnType<typeof listLegalOpinionHistory>>;
  readonly versions: Awaited<ReturnType<typeof listLegalOpinionVersions>>;
  readonly reasoning: { summary: string; inferences: readonly string[] };
  readonly explainability: string;
  readonly risks: readonly string[];
  readonly recommendations: readonly string[];
  readonly snapshots: readonly string[];
  readonly confidence: number;
}

/**
 * Carrega automaticamente TODO o contexto da solicitação: documentos
 * referenciados, timeline, histórico, reasoning, explainability, riscos,
 * recomendações e snapshots. Nunca exige upload nem busca manual. O reasoning
 * usa o Copiloto Jurídico via kernelAccessService (revisável, nunca automático).
 */
export async function loadWorkspaceContext(params: {
  workspaceId: string;
  organizationId: number;
  correlationId: string;
  invoke?: (prompt: string) => Promise<string>;
}): Promise<LegalOpinionContextBundle> {
  const ws = await getLegalOpinionWorkspace(params.workspaceId, params.organizationId);

  const requestId = ws?.requestId ?? "";
  const [documents, timeline, history, draft, versions] = await Promise.all([
    requestId ? listDocumentReferences(requestId, params.organizationId) : Promise.resolve([]),
    requestId ? listRequestTimeline(requestId, params.organizationId) : Promise.resolve([]),
    listLegalOpinionHistory(params.workspaceId, params.organizationId),
    getLegalOpinionDraftByWorkspace(params.workspaceId, params.organizationId),
    Promise.resolve([] as Awaited<ReturnType<typeof listLegalOpinionVersions>>),
  ]);
  const draftVersions = draft ? await listLegalOpinionVersions(draft.id, params.organizationId) : versions;

  // Reasoning/explainability via Copiloto Jurídico (Kernel, sempre via porta).
  assertKernelAccess(DOMAIN, "institutional_rag");
  assertKernelAccess(DOMAIN, "copilot_infrastructure");
  assertKernelAccess(DOMAIN, "explainability");
  const orchestration = await orchestrateMultiCopilot({
    organizationId: params.organizationId,
    request: `Analisar juridicamente a solicitação ${requestId} (${ws?.requestType ?? "parecer"}) referente ao processo ${ws?.referenceProcessId ?? ""}, com base na Lei 14.133/2021.`,
    copilotTypes: ["juridico"],
    correlationId: params.correlationId,
    invoke: params.invoke,
  });

  const snapshots = documents.map(d => d.snapshot).filter((s): s is string => Boolean(s));

  return {
    workspace: ws,
    draft,
    documents,
    timeline,
    history,
    versions: draftVersions,
    reasoning: {
      summary: orchestration.consolidated.summary,
      inferences: orchestration.consolidated.legalBasis,
    },
    explainability: orchestration.consolidated.suggestions.join(" · "),
    risks: orchestration.consolidated.legalBasis.slice(0, 3),
    recommendations: orchestration.consolidated.suggestions,
    snapshots,
    confidence: orchestration.consolidated.confidence ?? 0.7,
  };
}

/** Cria o rascunho do parecer e move o workspace para DRAFT. */
export async function createOpinionDraft(params: {
  workspaceId: string;
  organizationId: number;
  author: number;
  opinionType: LegalOpinionType;
  report?: string;
  foundation?: string;
  conclusion?: string;
  conclusionType?: LegalOpinionConclusion | null;
  recommendations?: string[];
  reservations?: string[];
  attachments?: string[];
  correlationId: string;
}): Promise<{ workspace: LegalOpinionWorkspace; draft: LegalOpinionDraft }> {
  const ws = await getLegalOpinionWorkspace(params.workspaceId, params.organizationId);
  if (!ws) throw new Error("Workspace de parecer não encontrado.");

  const draft = createLegalOpinionDraft({
    organizationId: params.organizationId, workspaceId: ws.id, requestId: ws.requestId,
    opinionType: params.opinionType, author: params.author, report: params.report, foundation: params.foundation,
    conclusion: params.conclusion, conclusionType: params.conclusionType, recommendations: params.recommendations,
    reservations: params.reservations, attachments: params.attachments, correlationId: params.correlationId,
  });
  await insertLegalOpinionDraft(draft);
  await insertLegalOpinionVersion({
    organizationId: params.organizationId, draftId: draft.id, workspaceId: ws.id, version: draft.version,
    contentHash: draftContentHash(draft), snapshot: JSON.stringify({ report: draft.report, conclusion: draft.conclusion }),
    author: params.author, correlationId: params.correlationId,
  });

  // RC-3 — parecer oficial pelo pipeline ÚNICO (Document Engine).
  await generateOfficialDocument({
    organizationId: params.organizationId, businessDomain: "parecer_juridico",
    documentType: params.opinionType === "LEGAL_OPINION_FINAL" ? "parecer_final" : "parecer_inicial",
    origin: ws.id, title: `Parecer — ${ws.referenceProcessId || ws.id}`,
    content: `# Parecer Jurídico\n\n## Relatório\n${draft.report}\n\n## Fundamentação\n${draft.foundation}\n\n## Conclusão\n${draft.conclusion}`,
    author: String(params.author), correlationId: params.correlationId,
    metadata: { opinionType: params.opinionType, conclusionType: draft.conclusionType },
  });

  const moved = ws.currentStage === "DRAFT" ? ws : transitionLegalStage(ws, "DRAFT");
  await updateLegalOpinionWorkspaceStage(moved.id, moved.organizationId, moved.currentStage, moved.status, moved.assignedLawyer, moved.updatedAt);
  await recordHistory(moved, "draft_created", String(params.author), `Parecer (${params.opinionType}) em elaboração.`, draft.id);
  return { workspace: moved, draft };
}

/** Atualiza o conteúdo do parecer (editável), gerando nova versão. */
export async function updateOpinionDraft(params: {
  workspaceId: string;
  organizationId: number;
  author: number;
  patch: Partial<Pick<LegalOpinionDraft, "report" | "foundation" | "conclusion" | "conclusionType" | "recommendations" | "reservations" | "attachments">>;
  correlationId: string;
}): Promise<LegalOpinionDraft> {
  const ws = await getLegalOpinionWorkspace(params.workspaceId, params.organizationId);
  if (!ws) throw new Error("Workspace de parecer não encontrado.");
  const current = await getLegalOpinionDraftByWorkspace(params.workspaceId, params.organizationId);
  if (!current) throw new Error("Parecer ainda não iniciado.");

  const updated = updateLegalOpinionDraft(current, params.patch);
  await insertLegalOpinionDraft(updated);
  await insertLegalOpinionVersion({
    organizationId: params.organizationId, draftId: updated.id, workspaceId: ws.id, version: updated.version,
    contentHash: draftContentHash(updated), snapshot: JSON.stringify({ report: updated.report, conclusion: updated.conclusion }),
    author: params.author, correlationId: params.correlationId,
  });
  await recordHistory(ws, "draft_updated", String(params.author), `Parecer atualizado (v${updated.version}).`, updated.id);
  return updated;
}

/**
 * Assina o parecer (apenas MANUAL nesta fase) e move o workspace para SIGNED.
 * Assinatura ICP-Brasil/GOV.BR/A1 têm arquitetura preparada mas não implementada.
 */
export async function signOpinion(params: {
  workspaceId: string;
  organizationId: number;
  signedBy: number;
  method?: SignatureMethod;
  correlationId: string;
}): Promise<{ workspace: LegalOpinionWorkspace; draft: LegalOpinionDraft }> {
  const ws = await getLegalOpinionWorkspace(params.workspaceId, params.organizationId);
  if (!ws) throw new Error("Workspace de parecer não encontrado.");
  const draft = await getLegalOpinionDraftByWorkspace(params.workspaceId, params.organizationId);
  if (!draft) throw new Error("Não há parecer para assinar.");

  const signed = signLegalOpinionDraft(draft, params.method ?? "manual", params.signedBy);
  await insertLegalOpinionDraft(signed);

  // Caminha até SIGNED por transições válidas (DRAFT → REVIEW → SIGNED).
  let moved = ws;
  if (moved.currentStage === "DRAFT") {
    moved = transitionLegalStage(moved, "REVIEW");
    await updateLegalOpinionWorkspaceStage(moved.id, moved.organizationId, moved.currentStage, moved.status, moved.assignedLawyer, moved.updatedAt);
  }
  if (moved.currentStage === "REVIEW") {
    moved = transitionLegalStage(moved, "SIGNED");
    await updateLegalOpinionWorkspaceStage(moved.id, moved.organizationId, moved.currentStage, moved.status, moved.assignedLawyer, moved.updatedAt);
  }
  await recordHistory(moved, "signed", String(params.signedBy), `Parecer assinado (${signed.signatureMethod}).`, signed.id);
  return { workspace: moved, draft: signed };
}

const CONCLUSION_TO_RESPONSE: Record<LegalOpinionConclusion, "favoravel" | "desfavoravel" | "com_ressalvas"> = {
  favoravel: "favoravel",
  desfavoravel: "desfavoravel",
  com_ressalvas: "com_ressalvas",
  parcialmente_favoravel: "com_ressalvas",
};

/**
 * Devolve o parecer ao domínio de origem. Reutiliza respondRequest do Engine:
 * cria a resposta institucional, conclui e RETORNA automaticamente à origem,
 * notificando. Move o workspace para RETURNED. Exige parecer assinado.
 */
export async function returnOpinion(params: {
  workspaceId: string;
  organizationId: number;
  responder: number;
  correlationId: string;
}): Promise<{ workspace: LegalOpinionWorkspace; responseId: string }> {
  const ws = await getLegalOpinionWorkspace(params.workspaceId, params.organizationId);
  if (!ws) throw new Error("Workspace de parecer não encontrado.");
  const draft = await getLegalOpinionDraftByWorkspace(params.workspaceId, params.organizationId);
  if (!draft) throw new Error("Não há parecer para devolver.");
  if (!draft.signed) throw new Error("O parecer precisa estar assinado antes da devolução.");

  const responseStatus = draft.conclusionType ? CONCLUSION_TO_RESPONSE[draft.conclusionType] : "concluido";
  const result = await respondRequest({
    id: ws.requestId, organizationId: params.organizationId, responder: params.responder,
    responseType: "parecer", responseStatus,
    comments: draft.conclusion || draft.report, attachedDocuments: [...draft.attachments],
    correlationId: params.correlationId,
  });

  const returned = transitionLegalStage(ws, "RETURNED");
  await updateLegalOpinionWorkspaceStage(returned.id, returned.organizationId, returned.currentStage, returned.status, returned.assignedLawyer, returned.updatedAt);
  await recordHistory(returned, "returned", String(params.responder), `Parecer devolvido automaticamente ao domínio ${ws.sourceDomain}.`, result.responseId);
  return { workspace: returned, responseId: result.responseId };
}

export async function archiveWorkspace(params: {
  workspaceId: string;
  organizationId: number;
  userId: number;
}): Promise<LegalOpinionWorkspace> {
  const ws = await getLegalOpinionWorkspace(params.workspaceId, params.organizationId);
  if (!ws) throw new Error("Workspace de parecer não encontrado.");
  const archived = transitionLegalStage(ws, "ARCHIVED");
  await updateLegalOpinionWorkspaceStage(archived.id, archived.organizationId, archived.currentStage, archived.status, archived.assignedLawyer, archived.updatedAt);
  await recordHistory(archived, "archived", String(params.userId), "Parecer arquivado.");
  return archived;
}

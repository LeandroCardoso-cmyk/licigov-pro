/**
 * Kernel — Institutional Request Service
 *
 * Orquestra o ciclo de vida das solicitações institucionais e expõe a API ÚNICA
 * `requestInstitutionalReview()` que TODOS os Business Domains usam para solicitar
 * serviços uns aos outros — sem acoplamento direto. Documentos por referência
 * (nunca copiados). Contexto entregue automaticamente. Degrada graciosamente sem DB.
 */

import {
  createInstitutionalRequest,
  transition,
  assignTo,
  type InstitutionalRequest,
  type BusinessDomainCode,
  type RequestType,
  type RequestPriority,
} from "../domain/institutionalRequest";
import {
  createInstitutionalResponse,
  signResponse,
  type ResponseType,
  type ResponseStatus,
  type SignatureMethod,
} from "../domain/institutionalResponse";
import { createRequestAssignment } from "../domain/requestAssignment";
import { createRequestNotification } from "../domain/requestNotification";
import { createDocumentReference } from "../domain/documentReference";
import { createRequestTimelineEntry, type RequestEventType } from "../domain/requestTimeline";
import {
  insertRequest, getRequest, updateRequestStatus,
  insertResponse, insertAssignment, insertRequestTimelineEntry, countTimeline,
  insertNotification, insertDocumentReference, listDocumentReferences,
} from "../db/institutionalRequests";

/** Registra um evento na timeline da solicitação, calculando a ordem. */
async function recordEvent(params: {
  request: InstitutionalRequest;
  eventType: RequestEventType;
  actor: string;
  summary: string;
  refId?: string;
}): Promise<void> {
  const order = await countTimeline(params.request.id, params.request.organizationId);
  const entry = createRequestTimelineEntry({
    requestId: params.request.id, organizationId: params.request.organizationId, order,
    eventType: params.eventType, actor: params.actor, summary: params.summary, refId: params.refId,
    correlationId: params.request.correlationId,
  });
  await insertRequestTimelineEntry(entry);
}

export interface ReviewContextBundle {
  readonly referenceProcessId: string;
  readonly documentReferenceIds: readonly string[];
  readonly timelineOrigin: string;
}

export interface ReviewResult {
  readonly request: InstitutionalRequest;
  readonly context: ReviewContextBundle;
}

/**
 * API ÚNICA de integração entre domínios. Cria a solicitação, encaminha ao domínio
 * de destino (PENDING), monta o contexto automático (referências documentais, sem
 * cópia), registra a timeline e notifica. Multi-tenant: jamais cruza organizações.
 */
export async function requestInstitutionalReview(params: {
  organizationId: number;
  sourceDomain: BusinessDomainCode;
  destinationDomain: BusinessDomainCode;
  requestType: RequestType;
  referenceProcessId: string;
  title: string;
  description?: string;
  priority?: RequestPriority;
  requestedBy: number;
  documents?: Array<{ documentId: string; title?: string; version?: number; snapshotSource?: string }>;
  correlationId: string;
}): Promise<ReviewResult> {
  if (params.sourceDomain === params.destinationDomain) {
    throw new Error("Origem e destino não podem ser o mesmo domínio.");
  }

  // 1) Cria e encaminha (NEW → PENDING)
  const created = createInstitutionalRequest({
    organizationId: params.organizationId, sourceDomain: params.sourceDomain, destinationDomain: params.destinationDomain,
    requestType: params.requestType, referenceProcessId: params.referenceProcessId, title: params.title,
    description: params.description, priority: params.priority, requestedBy: params.requestedBy, correlationId: params.correlationId,
  });
  await insertRequest(created);
  await recordEvent({ request: created, eventType: "created", actor: String(params.requestedBy), summary: `Solicitação "${created.title}" criada (${created.requestType}).`, refId: created.id });

  const forwarded = transition(created, "PENDING");
  await updateRequestStatus(forwarded.id, forwarded.organizationId, "PENDING", forwarded.assignedTo, forwarded.updatedAt);
  await recordEvent({ request: forwarded, eventType: "forwarded", actor: "kernel", summary: `Encaminhada para o domínio ${params.destinationDomain}.`, refId: params.destinationDomain });

  // 2) Distribuição na fila do domínio de destino
  const assignment = createRequestAssignment({
    requestId: forwarded.id, organizationId: params.organizationId, queue: params.destinationDomain,
    priority: params.priority, correlationId: params.correlationId,
  });
  await insertAssignment(assignment);

  // 3) Contexto automático: documentos por REFERÊNCIA (nunca copiados)
  const refIds: string[] = [];
  for (const d of params.documents ?? []) {
    const ref = createDocumentReference({
      organizationId: params.organizationId, requestId: forwarded.id, originDomain: params.sourceDomain,
      documentId: d.documentId, version: d.version, title: d.title, snapshotSource: d.snapshotSource, correlationId: params.correlationId,
    });
    await insertDocumentReference(ref);
    refIds.push(ref.id);
  }

  // 4) Notificação interna (canal sistema)
  const notification = createRequestNotification({
    requestId: forwarded.id, organizationId: params.organizationId, recipientUser: 0,
    channel: "sistema", title: `Nova solicitação: ${forwarded.title}`,
    message: `De ${params.sourceDomain} para ${params.destinationDomain}.`, correlationId: params.correlationId,
  });
  await insertNotification(notification);

  return {
    request: forwarded,
    context: { referenceProcessId: forwarded.referenceProcessId, documentReferenceIds: refIds, timelineOrigin: forwarded.correlationId },
  };
}

/** Domínio de destino recebe e passa a trabalhar a solicitação. */
export async function receiveRequest(id: string, orgId: number, userId: number): Promise<InstitutionalRequest> {
  const req = await getRequest(id, orgId);
  if (!req) throw new Error("Solicitação não encontrada.");
  const received = assignTo(transition(req, "RECEIVED"), userId);
  await updateRequestStatus(received.id, orgId, "RECEIVED", userId, received.updatedAt);
  await recordEvent({ request: received, eventType: "received", actor: String(userId), summary: "Solicitação recebida pelo domínio de destino." });
  const inProgress = transition(received, "IN_PROGRESS");
  await updateRequestStatus(inProgress.id, orgId, "IN_PROGRESS", userId, inProgress.updatedAt);
  await recordEvent({ request: inProgress, eventType: "in_progress", actor: String(userId), summary: "Em andamento." });
  return inProgress;
}

/**
 * Emite a resposta, conclui a solicitação e a devolve automaticamente ao domínio
 * de origem. Suporta placeholder de assinatura (não implementa assinatura real).
 */
export async function respondRequest(params: {
  id: string;
  organizationId: number;
  responder: number;
  responseType: ResponseType;
  responseStatus: ResponseStatus;
  comments?: string;
  attachedDocuments?: string[];
  sign?: SignatureMethod;
  signedAt?: string;
  correlationId: string;
}): Promise<{ request: InstitutionalRequest; responseId: string }> {
  const req = await getRequest(params.id, params.organizationId);
  if (!req) throw new Error("Solicitação não encontrada.");

  let response = createInstitutionalResponse({
    requestId: req.id, organizationId: params.organizationId, responder: params.responder,
    responseType: params.responseType, responseStatus: params.responseStatus, comments: params.comments,
    attachedDocuments: params.attachedDocuments, correlationId: params.correlationId,
  });
  if (params.sign) {
    response = signResponse(response, params.sign, params.signedAt ?? req.updatedAt);
  }
  await insertResponse(response);
  await recordEvent({ request: req, eventType: "responded", actor: String(params.responder), summary: `Resposta emitida (${params.responseStatus}).`, refId: response.id });
  if (response.signed) {
    await recordEvent({ request: req, eventType: "signed", actor: String(params.responder), summary: `Resposta assinada (${response.signatureMethod}).`, refId: response.id });
  }

  const completed = transition(req.status === "IN_PROGRESS" ? req : transition(req, "IN_PROGRESS"), "COMPLETED");
  await updateRequestStatus(completed.id, params.organizationId, "COMPLETED", completed.assignedTo, completed.updatedAt);

  // Devolve automaticamente ao domínio de origem
  const returned = transition(completed, "RETURNED");
  await updateRequestStatus(returned.id, params.organizationId, "RETURNED", returned.assignedTo, returned.updatedAt);
  await recordEvent({ request: returned, eventType: "returned", actor: "kernel", summary: `Devolvida automaticamente ao domínio ${req.sourceDomain}.`, refId: req.sourceDomain });

  // Notifica a origem
  await insertNotification(createRequestNotification({
    requestId: req.id, organizationId: params.organizationId, recipientUser: req.requestedBy,
    channel: "sistema", title: `Resposta disponível: ${req.title}`, message: `O domínio ${req.destinationDomain} respondeu.`, correlationId: params.correlationId,
  }));

  return { request: returned, responseId: response.id };
}

export async function archiveRequest(id: string, orgId: number, userId: number): Promise<InstitutionalRequest> {
  const req = await getRequest(id, orgId);
  if (!req) throw new Error("Solicitação não encontrada.");
  const archived = transition(req, "ARCHIVED");
  await updateRequestStatus(archived.id, orgId, "ARCHIVED", archived.assignedTo, archived.updatedAt);
  await recordEvent({ request: archived, eventType: "archived", actor: String(userId), summary: "Solicitação arquivada." });
  return archived;
}

export { listDocumentReferences };

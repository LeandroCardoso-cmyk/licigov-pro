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

import { createHash } from "crypto";
import { TRPCError } from "@trpc/server";
import { assertKernelAccess } from "./kernelAccessService";
import { generateOfficialDocument } from "./documentEngineService";
import { runWithIdempotency } from "./idempotencyService";
import { computeLineageId } from "../domain/officialDocument";
import { listVersions, getOfficialDocument } from "../db/officialDocuments";
import { orchestrateMultiCopilot } from "./workspaceOrchestratorService";
import { receiveRequest as receiveInstitutionalRequest, respondRequest } from "./institutionalRequestService";
import { getMembership } from "./tenantService";
import { getUserById } from "../db/users";
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
  readonly snapshots: readonly string[];
}

/**
 * Reasoning & Explainability do Parecer — produto do Copiloto Jurídico (Cognitive
 * Kernel → RAG/Retrieval → LLM). É APOIO à decisão humana, NÃO pré-condição para
 * abrir o workspace: carregado separadamente do conteúdo operacional (documentos,
 * rascunho, timeline) para não bloquear o trabalho do Procurador. Sempre revisável,
 * nunca automático; toda saída passa pela porta do Kernel (kernelAccessService).
 */
export interface LegalOpinionReasoningBundle {
  readonly reasoning: { summary: string; inferences: readonly string[] };
  readonly explainability: string;
  readonly risks: readonly string[];
  readonly recommendations: readonly string[];
  readonly confidence: number;
}

/**
 * Carrega o CONTEÚDO OPERACIONAL da solicitação: documentos referenciados,
 * timeline, histórico, rascunho e versões — tudo derivado do banco (LEITURA, sem
 * LLM/Kernel cognitivo). É o que o Procurador precisa para começar a trabalhar;
 * abre rápido e nunca depende de round-trip de IA. Nunca exige upload nem busca
 * manual. O Reasoning & Explainability (apoio) vem de `loadWorkspaceReasoning`,
 * carregado em paralelo/progressivamente sem bloquear a abertura do workspace.
 */
export async function loadWorkspaceContext(params: {
  workspaceId: string;
  organizationId: number;
  correlationId: string;
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

  const snapshots = documents.map(d => d.snapshot).filter((s): s is string => Boolean(s));

  return {
    workspace: ws,
    draft,
    documents,
    timeline,
    history,
    versions: draftVersions,
    snapshots,
  };
}

/**
 * Carrega o Reasoning & Explainability (apoio à decisão) via Copiloto Jurídico —
 * Cognitive Kernel (RAG/Retrieval → LLM), SEMPRE pela porta (kernelAccessService).
 * Separado de `loadWorkspaceContext` porque é APOIO, não pré-condição para o
 * trabalho humano: assim o round-trip de IA não bloqueia a abertura do workspace.
 * Preserva fronteira do Kernel, correlationId, tenant e proveniência da execução.
 */
export async function loadWorkspaceReasoning(params: {
  workspaceId: string;
  organizationId: number;
  correlationId: string;
  invoke?: (prompt: string) => Promise<string>;
}): Promise<LegalOpinionReasoningBundle> {
  const ws = await getLegalOpinionWorkspace(params.workspaceId, params.organizationId);
  const requestId = ws?.requestId ?? "";

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

  return {
    reasoning: {
      summary: orchestration.consolidated.summary,
      inferences: orchestration.consolidated.legalBasis,
    },
    explainability: orchestration.consolidated.suggestions.join(" · "),
    risks: orchestration.consolidated.legalBasis.slice(0, 3),
    recommendations: orchestration.consolidated.suggestions,
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
/** Tipo documental oficial derivado do tipo do parecer. */
function parecerDocumentType(opinionType: LegalOpinionType): "parecer_final" | "parecer_inicial" {
  return opinionType === "LEGAL_OPINION_FINAL" ? "parecer_final" : "parecer_inicial";
}

/** Conteúdo OFICIAL do parecer (representação canônica única — usada na materialização e na convergência). */
function buildSignedParecerContent(draft: LegalOpinionDraft): string {
  return `# Parecer Jurídico\n\n## Relatório\n${draft.report}\n\n## Fundamentação\n${draft.foundation}\n\n## Conclusão\n${draft.conclusion}`;
}

/** Caminha o workspace até SIGNED por transições válidas (idempotente se já em SIGNED). */
async function moveWorkspaceToSigned(ws: LegalOpinionWorkspace): Promise<LegalOpinionWorkspace> {
  let moved = ws;
  if (moved.currentStage === "DRAFT") {
    moved = transitionLegalStage(moved, "REVIEW");
    await updateLegalOpinionWorkspaceStage(moved.id, moved.organizationId, moved.currentStage, moved.status, moved.assignedLawyer, moved.updatedAt);
  }
  if (moved.currentStage === "REVIEW") {
    moved = transitionLegalStage(moved, "SIGNED");
    await updateLegalOpinionWorkspaceStage(moved.id, moved.organizationId, moved.currentStage, moved.status, moved.assignedLawyer, moved.updatedAt);
  }
  return moved;
}

/** Procura a versão OFICIAL `emitido` correspondente ao conteúdo EXATO assinado (convergência). */
async function findEmitidoForContent(
  organizationId: number, workspaceId: string, documentType: "parecer_final" | "parecer_inicial", expectedContent: string,
): Promise<boolean> {
  const lineageId = computeLineageId({ tenantId: organizationId, businessDomain: "parecer_juridico", documentType, origin: workspaceId });
  const versions = await listVersions(lineageId, organizationId);
  for (const v of versions.filter(x => x.status === "emitido")) {
    const doc = await getOfficialDocument(v.id, organizationId);
    if (doc && doc.content === expectedContent) return true;
  }
  return false;
}

/** Materializa a versão OFICIAL `emitido` do parecer assinado no Document Engine (pipeline ÚNICO). */
async function materializeSignedParecer(ws: LegalOpinionWorkspace, signed: LegalOpinionDraft, signedBy: number, correlationId: string): Promise<void> {
  // SNAPSHOT humano da assinatura no MOMENTO da emissão (identidade histórica imutável):
  // captura nome institucional e papel/função do signatário agora, para não depender de
  // lookup mutável posterior ao reconstruir quem assinou. Vira metadado da versão emitida.
  const signatureSnapshot = await buildSignatureSnapshot(ws.organizationId, signedBy, signed);
  await generateOfficialDocument({
    organizationId: ws.organizationId, businessDomain: "parecer_juridico",
    documentType: parecerDocumentType(signed.opinionType),
    origin: ws.id, title: `Parecer — ${ws.referenceProcessId || ws.id}`,
    content: buildSignedParecerContent(signed),
    author: String(signedBy), status: "emitido", correlationId,
    metadata: {
      draftId: signed.id, draftVersion: signed.version, contentHash: draftContentHash(signed),
      signed: true, signedBy, signatureMethod: signed.signatureMethod, signedAt: signed.signedAt,
      signatureSnapshot,
      requestId: ws.requestId, referenceProcessId: ws.referenceProcessId,
      opinionType: signed.opinionType, conclusionType: signed.conclusionType,
    },
  });
}

/**
 * Snapshot institucional imutável da assinatura (congelado na emissão): identidade do
 * signatário (id + nome), papel/função disponível, método e instante. Preserva a
 * identidade histórica mesmo que nome/papel do usuário mudem depois. Degrada com campos
 * vazios sem DB — nunca falha a emissão por ausência de lookup.
 */
async function buildSignatureSnapshot(organizationId: number, signedBy: number, signed: LegalOpinionDraft): Promise<{
  signed: true; signerUserId: number; signerName: string; signerRole: string;
  signatureMethod: SignatureMethod | null; signedAt: string | null;
}> {
  const [user, membership] = await Promise.all([
    getUserById(signedBy).catch(() => undefined),
    getMembership(signedBy, organizationId).catch(() => null),
  ]);
  return {
    signed: true,
    signerUserId: signedBy,
    signerName: user?.name ?? `Usuário ${signedBy}`,
    signerRole: membership?.role ?? "",
    signatureMethod: signed.signatureMethod,
    signedAt: signed.signedAt,
  };
}

/** Executa a lógica CONVERGENTE de assinatura (recovery por estado) — usada DENTRO da idempotência canônica. */
async function signOpinionConverge(
  ws: LegalOpinionWorkspace, draft: LegalOpinionDraft, signedBy: number, method: SignatureMethod, correlationId: string,
): Promise<{ workspace: LegalOpinionWorkspace; draft: LegalOpinionDraft }> {
  // Caminho CONVERGENTE: o draft já está assinado (retry com chave nova, ou reparo de falha parcial).
  if (draft.signed) {
    if ((draft.signedBy != null && draft.signedBy !== signedBy) || (draft.signatureMethod && draft.signatureMethod !== method)) {
      throw new TRPCError({ code: "CONFLICT", message: "Parecer já assinado com responsável/método distintos; nova assinatura recusada." });
    }
    const documentType = parecerDocumentType(draft.opinionType);
    const expectedContent = buildSignedParecerContent(draft);
    const hasEmitido = await findEmitidoForContent(ws.organizationId, ws.id, documentType, expectedContent);
    if (!hasEmitido) await materializeSignedParecer(ws, draft, signedBy, correlationId); // reparo único
    const moved = await moveWorkspaceToSigned(ws);
    return { workspace: moved, draft };
  }
  // Caminho NORMAL: primeira assinatura.
  const signed = signLegalOpinionDraft(draft, method, signedBy);
  await insertLegalOpinionDraft(signed);
  await materializeSignedParecer(ws, signed, signedBy, correlationId); // única materialização emitido
  const moved = await moveWorkspaceToSigned(ws);
  await recordHistory(moved, "signed", String(signedBy), `Parecer assinado (${signed.signatureMethod}).`, signed.id);
  return { workspace: moved, draft: signed };
}

/**
 * Assina o parecer (boundary institucional) de forma REENTRANTE / REPLAY-SAFE.
 *
 * Idempotência CANÔNICA (`runWithIdempotency`, operation `legal_opinion.sign`): mesma key + mesmo
 * payload → replay do resultado em cache (replayed=true); mesma key + payload diferente → CONFLICT;
 * mesma key em processamento → CONFLICT; falha → key liberada para retry. O payloadHash vincula
 * workspace, org, signer, método, tipo, draftId e a versão/hash do draft alvo.
 *
 * CONVERGÊNCIA por estado (dentro da operação canônica) é o mecanismo de RECOVERY: draft já assinado
 * compatível é reusado; a versão `emitido` correspondente é reparada uma única vez se ausente; o
 * workspace converge para SIGNED; signer/método incompatível → CONFLICT. As duas camadas trabalham
 * juntas. A IA nunca assina.
 */
export async function signOpinion(params: {
  workspaceId: string;
  organizationId: number;
  signedBy: number;
  method?: SignatureMethod;
  idempotencyKey: string;
  correlationId: string;
}): Promise<{ workspace: LegalOpinionWorkspace; draft: LegalOpinionDraft; replayed: boolean }> {
  const ws = await getLegalOpinionWorkspace(params.workspaceId, params.organizationId);
  if (!ws) throw new Error("Workspace de parecer não encontrado.");
  const draft = await getLegalOpinionDraftByWorkspace(params.workspaceId, params.organizationId);
  if (!draft) throw new Error("Não há parecer para assinar.");
  const method = params.method ?? "manual";

  const payloadHash = createHash("sha256").update(JSON.stringify({
    workspaceId: ws.id, organizationId: params.organizationId, signedBy: params.signedBy,
    signatureMethod: method, opinionType: draft.opinionType,
    draftId: draft.id, draftVersion: draft.version, contentHash: draftContentHash(draft),
  })).digest("hex");

  const { result, replayed } = await runWithIdempotency(
    { key: params.idempotencyKey, userId: params.signedBy, organizationId: params.organizationId, operation: "legal_opinion.sign", payloadHash },
    () => signOpinionConverge(ws, draft, params.signedBy, method, params.correlationId),
  );
  // O responsePayload cacheado volta como string em MariaDB e como objeto em MySQL 8 — revive para
  // devolver a MESMA resposta institucional (workspace + draft) em ambos no replay.
  const revived = (typeof result === "string" ? JSON.parse(result) : result) as { workspace: LegalOpinionWorkspace; draft: LegalOpinionDraft };
  return { workspace: revived.workspace, draft: revived.draft, replayed };
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

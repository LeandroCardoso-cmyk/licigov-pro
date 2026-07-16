/**
 * FASE 5 — Direct Procurement Service (Contratação Direta)
 *
 * Orquestra o ciclo de Dispensa/Inexigibilidade. REUTILIZA integralmente:
 * Price Research Workspace, Institutional Request Engine (→ Parecer Jurídico),
 * Timeline Engine, Multi-Copilot Orchestrator e Document Engine — nunca duplica
 * infraestrutura. Todo acesso ao Kernel via kernelAccessService. Degrada sem DB.
 *
 * Toda recomendação carrega reasoning, explainability, provenance, confidence e
 * pode ser rejeitada. Nenhuma funcionalidade de Future Evolution é implementada.
 */

import { assertKernelAccess } from "./kernelAccessService";
import { generateOfficialDocument } from "./documentEngineService";
import { orchestrateMultiCopilot } from "./workspaceOrchestratorService";
import { requestInstitutionalReview } from "./institutionalRequestService";
import { getResponseForRequest, listDocumentReferences } from "../db/institutionalRequests";
import { createPriceResearchWorkspace, extractItemsFromText } from "../domain/priceResearch";
import { insertResearch, insertResearchItem, recordProcessEvent } from "../db/procurement";
import {
  DIRECT_DOMAIN_COPILOTS,
  type DirectProcurementWorkspace,
} from "../domain/directProcurementWorkspace";
import {
  createContractJustification, createPriceJustification,
  createGeneratedPublication, baseRequiredDocuments, createRequiredDocument,
  type PublicationKind,
} from "../domain/directProcurementJustifications";
import {
  getDirectProcurementWorkspace, upsertContractJustification, upsertPriceJustification,
  insertGeneratedPublication, insertRequiredDocument, listRequiredDocuments, getDirectProcedure,
} from "../db/directProcurement";

const DOMAIN = "contratacao_direta" as const;

export interface Recommendation {
  readonly reasoning: string;
  readonly explainability: string;
  readonly provenance: string;
  readonly confidence: number;
  readonly rejectable: true;
}

async function requireWorkspace(id: string, orgId: number): Promise<DirectProcurementWorkspace> {
  const ws = await getDirectProcurementWorkspace(id, orgId);
  if (!ws) throw new Error("Processo de contratação direta não encontrado.");
  return ws;
}

// ─── Pesquisa de Preços (REUTILIZA o Price Research Workspace) ─────────────────

/** Importa pesquisa de preços reutilizando integralmente o Price Research Workspace. */
export async function importDirectPriceResearch(params: {
  workspaceId: string;
  organizationId: number;
  source: "pdf" | "docx" | "xlsx" | "csv" | "colar" | "manual";
  text: string;
  correlationId: string;
}): Promise<{ researchId: string; itemCount: number }> {
  const research = createPriceResearchWorkspace({
    processId: params.workspaceId, organizationId: params.organizationId, source: params.source, correlationId: params.correlationId,
  });
  const items = extractItemsFromText(params.text, { researchId: research.id, processId: params.workspaceId, organizationId: params.organizationId });
  await insertResearch({ ...research, itemCount: items.length });
  for (const it of items) await insertResearchItem(it);
  await recordProcessEvent({
    organizationId: params.organizationId, processId: params.workspaceId, eventType: "change",
    actor: "sistema", summary: `Pesquisa de preços importada (${params.source}): ${items.length} item(ns).`, refId: research.id, correlationId: params.correlationId,
  });
  return { researchId: research.id, itemCount: items.length };
}

// ─── Justificativa da Contratação (copilotos, revisável) ──────────────────────

export async function generateContractJustification(params: {
  workspaceId: string;
  organizationId: number;
  correlationId: string;
  invoke?: (prompt: string) => Promise<string>;
}): Promise<{ justification: Awaited<ReturnType<typeof upsertContractJustification>>; recommendation: Recommendation }> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  assertKernelAccess(DOMAIN, "institutional_rag");
  assertKernelAccess(DOMAIN, "copilot_infrastructure");

  const orchestration = await orchestrateMultiCopilot({
    organizationId: params.organizationId,
    request: `Elaborar justificativa de contratação direta (${ws.procurementType}) para "${ws.object}", com fundamento ${ws.legalBasis || "a definir"} (Lei 14.133/2021).`,
    copilotTypes: DIRECT_DOMAIN_COPILOTS,
    correlationId: params.correlationId,
    invoke: params.invoke,
  });

  const draft = createContractJustification({
    organizationId: params.organizationId, workspaceId: ws.id,
    need: orchestration.consolidated.summary,
    publicInterest: "Atendimento ao interesse público na contratação.",
    motivation: orchestration.consolidated.suggestions.join(" "),
    legalFoundation: orchestration.consolidated.legalBasis.join("; "),
    benefits: orchestration.consolidated.suggestions.slice(0, 2).join(" "),
    alternatives: "Avaliadas alternativas de mercado.",
    correlationId: params.correlationId,
  });
  const justification = await upsertContractJustification(draft);
  // RC-3 — justificativa oficial pelo pipeline ÚNICO (Document Engine).
  await generateOfficialDocument({
    organizationId: params.organizationId, businessDomain: DOMAIN, documentType: "justificativa_contratacao",
    origin: ws.id, title: `Justificativa da Contratação — ${ws.processNumber}`,
    content: `# Justificativa da Contratação\n\n## Necessidade\n${draft.need}\n\n## Motivação\n${draft.motivation}\n\n## Fundamento\n${draft.legalFoundation}`,
    author: "multi_copilot", correlationId: params.correlationId,
    metadata: { copilots: orchestration.selectedCopilots, confidence: orchestration.consolidated.confidence },
  });
  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "recommendation",
    actor: "multi_copilot", summary: "Justificativa da contratação gerada (rascunho revisável).", refId: draft.id, correlationId: params.correlationId,
  });
  return {
    justification,
    recommendation: {
      reasoning: orchestration.consolidated.summary,
      explainability: orchestration.consolidated.suggestions.join(" · "),
      provenance: `copilotos:${orchestration.selectedCopilots.join(",")}`,
      confidence: orchestration.consolidated.confidence,
      rejectable: true,
    },
  };
}

// ─── Justificativa do Preço ───────────────────────────────────────────────────

export async function generatePriceJustification(params: {
  workspaceId: string;
  organizationId: number;
  source: "pesquisa" | "manual" | "documento";
  justification?: string;
  referenceValue?: number;
  researchId?: string;
  documentReferences?: string[];
  correlationId: string;
}): Promise<{ priceJustification: Awaited<ReturnType<typeof upsertPriceJustification>>; recommendation: Recommendation }> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  assertKernelAccess(DOMAIN, "institutional_rag");

  const draft = createPriceJustification({
    organizationId: params.organizationId, workspaceId: ws.id, source: params.source,
    justification: params.justification, referenceValue: params.referenceValue, researchId: params.researchId,
    documentReferences: params.documentReferences, correlationId: params.correlationId,
  });
  const priceJustification = await upsertPriceJustification(draft);
  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "change",
    actor: "sistema", summary: `Justificativa do preço registrada (${params.source}).`, refId: draft.id, correlationId: params.correlationId,
  });
  return {
    priceJustification,
    recommendation: {
      reasoning: `Preço fundamentado por ${params.source}.`,
      explainability: params.source === "pesquisa" ? "Baseado na Pesquisa de Preços do processo." : "Justificativa registrada pelo servidor.",
      provenance: params.source === "pesquisa" ? `price_research:${params.researchId ?? ""}` : "manual",
      confidence: params.source === "pesquisa" ? 0.85 : 0.6,
      rejectable: true,
    },
  };
}

// ─── Documentação Obrigatória (checklist dinâmico) ────────────────────────────

/** Semeia o checklist dinâmico conforme modalidade/fundamento (idempotente). */
export async function seedRequiredDocuments(params: {
  workspaceId: string;
  organizationId: number;
  correlationId: string;
}): Promise<Array<{ id: string; name: string; required: boolean; status: string; documentReference: string }>> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  const existing = await listRequiredDocuments(ws.id, params.organizationId);
  if (existing.length > 0) return existing;
  const names = baseRequiredDocuments(ws.procurementType);
  let index = 0;
  for (const name of names) {
    const doc = createRequiredDocument({ organizationId: params.organizationId, workspaceId: ws.id, name, index: index++, correlationId: params.correlationId });
    await insertRequiredDocument(doc);
  }
  return listRequiredDocuments(ws.id, params.organizationId);
}

// ─── Parecer Jurídico (REUTILIZA o Institutional Request Engine) ──────────────

/**
 * Solicita o parecer jurídico ao Business Domain Parecer Jurídico via Institutional
 * Request Engine (LEGAL_OPINION_INITIAL). NUNCA gera parecer neste módulo.
 */
export async function requestLegalOpinion(params: {
  workspaceId: string;
  organizationId: number;
  requestedBy: number;
  documents?: Array<{ documentId: string; title?: string; version?: number }>;
  correlationId: string;
}): Promise<{ requestId: string }> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  const result = await requestInstitutionalReview({
    organizationId: params.organizationId,
    sourceDomain: "contratacao_direta",
    destinationDomain: "parecer_juridico",
    requestType: "LEGAL_OPINION_INITIAL",
    referenceProcessId: ws.id,
    title: `Parecer jurídico — Contratação Direta ${ws.processNumber}`,
    description: `Análise jurídica da ${ws.procurementType} referente a "${ws.object}".`,
    priority: "alta",
    requestedBy: params.requestedBy,
    documents: params.documents,
    correlationId: params.correlationId,
  });
  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "change",
    actor: String(params.requestedBy), summary: "Parecer jurídico solicitado ao domínio Parecer Jurídico.", refId: result.request.id, correlationId: params.correlationId,
  });
  return { requestId: result.request.id };
}

/**
 * Disponibiliza automaticamente o parecer retornado (sem upload/download): lê a
 * resposta institucional e as referências documentais associadas à solicitação.
 */
export async function getLegalOpinionResult(requestId: string, orgId: number): Promise<{ response: Awaited<ReturnType<typeof getResponseForRequest>>; documents: Awaited<ReturnType<typeof listDocumentReferences>> }> {
  const [response, documents] = await Promise.all([
    getResponseForRequest(requestId, orgId),
    listDocumentReferences(requestId, orgId),
  ]);
  return { response, documents };
}

// ─── Publicação (Document Engine) ─────────────────────────────────────────────

/** Gera as publicações conforme modalidade e procedimento. Reutiliza Document Engine. */
export async function generatePublications(params: {
  workspaceId: string;
  organizationId: number;
  correlationId: string;
}): Promise<Array<{ id: string; kind: string; title: string }>> {
  const ws = await requireWorkspace(params.workspaceId, params.organizationId);
  assertKernelAccess(DOMAIN, "document_engine");
  const procedure = await getDirectProcedure(ws.id, params.organizationId);

  const kinds: PublicationKind[] = ["aviso", "ratificacao", "extrato_contrato"];
  if (procedure?.procedureType === "presencial") kinds.push("instrucoes", "cronograma");

  const out: Array<{ id: string; kind: string; title: string }> = [];
  for (const kind of kinds) {
    const pub = createGeneratedPublication({
      organizationId: params.organizationId, workspaceId: ws.id, kind,
      title: `${titleForKind(kind)} — ${ws.processNumber}`,
      content: `# ${titleForKind(kind)}\nProcesso: ${ws.processNumber} · Modalidade: ${ws.procurementType} · Fundamento: ${ws.legalBasis || "—"}\nProcedimento: ${procedure?.procedureType ?? "indefinido"}${procedure?.platform ? ` · Plataforma: ${procedure.platform}` : ""}\n\n> Documento gerado a partir do fluxo. Revisão obrigatória pelo servidor competente.`,
      correlationId: params.correlationId,
    });
    await insertGeneratedPublication(pub);
    // RC-3 — publicação oficial pelo pipeline ÚNICO (Document Engine).
    const officialType = kind === "ratificacao" ? "ratificacao" : kind === "extrato_contrato" ? "extrato_contrato" : "aviso";
    await generateOfficialDocument({
      organizationId: params.organizationId, businessDomain: DOMAIN, documentType: officialType,
      origin: ws.id, title: pub.title, content: pub.content, author: "sistema", correlationId: params.correlationId,
      metadata: { kind, modality: ws.procurementType },
    });
    out.push({ id: pub.id, kind, title: pub.title });
  }
  await recordProcessEvent({
    organizationId: params.organizationId, processId: ws.id, eventType: "decision",
    actor: "sistema", summary: `Publicações geradas: ${out.map(o => o.kind).join(", ")}.`, refId: ws.id, correlationId: params.correlationId,
  });
  return out;
}

function titleForKind(kind: PublicationKind): string {
  switch (kind) {
    case "aviso": return "Aviso de Contratação Direta";
    case "ratificacao": return "Termo de Ratificação";
    case "extrato_contrato": return "Extrato de Contrato";
    case "instrucoes": return "Instruções aos Interessados";
    case "cronograma": return "Cronograma";
  }
}

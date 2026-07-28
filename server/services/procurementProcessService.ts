/**
 * Sprint 5.1 — Procurement Process Service
 *
 * Orquestra o ciclo do Processo Licitatório e a GERAÇÃO de documentos (ETP, TR,
 * Edital) como consequência do fluxo — nunca o contrário. Toda inferência usa o
 * Kernel (RAG + copilotos) exclusivamente via kernelAccessService. Documentos são
 * rascunhos fundamentados que o servidor REVISA. Degrada graciosamente sem DB.
 */

import { assertKernelAccess } from "./kernelAccessService";
import { generateOfficialDocument } from "./documentEngineService";
import { orchestrateMultiCopilot } from "./workspaceOrchestratorService";
import { DOMAIN_COPILOTS } from "../domain/procurementProcess";
import {
  buildDFDDraft,
  createGeneratedDocument,
  defaultPresencialJustification,
  validateEdital,
  type GeneratedDocument,
  type DocumentKind,
  type EditalModality,
  type EditalForm,
  type EditalPlatform,
} from "../domain/generatedDocument";
import { insertGeneratedDocument, recordProcessEvent, listIntelligentItems } from "../db/procurement";

const DOMAIN = "processo_licitatorio" as const;

/**
 * "Criar DFD do zero" (production-ready mínimo): estrutura um RASCUNHO editável do
 * DFD (art. 12, §1º) e persiste como documento canônico (kind "dfd", status
 * "rascunho"). NÃO usa Kernel/IA (template determinístico) — a geração assistida
 * por IA plena fica como evolução. Supervisão humana: sempre rascunho, nunca
 * aprovação automática. Idempotente: id determinístico por (processo, kind) →
 * retry não duplica.
 */
export async function generateDFDDraft(params: {
  organizationId: number; processId: string; object: string; correlationId: string;
}): Promise<GeneratedDocument> {
  const doc = createGeneratedDocument({
    processId: params.processId, organizationId: params.organizationId,
    kind: "dfd", title: `DFD — ${params.object}`,
    content: buildDFDDraft(params.object),
    sources: ["estrutura:art_12_par_1_lei_14133"],
    correlationId: params.correlationId,
  });
  await insertGeneratedDocument(doc);
  await recordProcessEvent({
    organizationId: params.organizationId, processId: params.processId, eventType: "change",
    actor: "sistema", summary: "DFD criado (rascunho estruturado).", refId: doc.id,
    correlationId: params.correlationId,
  });
  return doc;
}

/** Salva a edição do rascunho de DFD (mantém status rascunho; atualiza conteúdo). */
export async function saveDFDDraft(params: {
  organizationId: number; processId: string; object: string; content: string; correlationId: string;
}): Promise<GeneratedDocument> {
  const doc = createGeneratedDocument({
    processId: params.processId, organizationId: params.organizationId,
    kind: "dfd", title: `DFD — ${params.object}`,
    content: params.content,
    sources: ["edicao_manual"],
    correlationId: params.correlationId,
  });
  await insertGeneratedDocument(doc); // onDuplicateKeyUpdate → atualiza conteúdo do mesmo documento
  await recordProcessEvent({
    organizationId: params.organizationId, processId: params.processId, eventType: "change",
    actor: String(params.organizationId), summary: "DFD salvo (rascunho).", refId: doc.id,
    correlationId: params.correlationId,
  });
  return doc;
}

/**
 * Gera um documento (ETP/TR) a partir do fluxo: aciona os copilotos do domínio
 * (Planejamento, TR Intelligence, Pesquisa de Preços, Jurídico, Agente de
 * Contratação) via Multi-Copilot Orchestrator e consolida um rascunho fundamentado.
 */
export async function generateDocument(params: {
  organizationId: number;
  processId: string;
  kind: Exclude<DocumentKind, "edital">;
  object: string;
  correlationId: string;
  invoke?: (prompt: string) => Promise<string>;
}): Promise<GeneratedDocument> {
  // Regra de arquitetura: acesso ao Kernel só via kernelAccessService.
  assertKernelAccess(DOMAIN, "institutional_rag");
  assertKernelAccess(DOMAIN, "copilot_infrastructure");

  const items = await listIntelligentItems(params.processId, params.organizationId);
  const approved = items.filter(i => i.status === "aprovado");

  const request = params.kind === "tr"
    ? `Elaborar Termo de Referência para "${params.object}" com base em ${approved.length} item(ns) inteligente(s) aprovado(s), CATMAT, especificações e histórico.`
    : `Elaborar Estudo Técnico Preliminar (ETP) para "${params.object}" com fundamentação da necessidade, alternativas e riscos.`;

  const orchestration = await orchestrateMultiCopilot({
    organizationId: params.organizationId,
    request,
    copilotTypes: DOMAIN_COPILOTS,
    correlationId: params.correlationId,
    invoke: params.invoke,
  });

  const content = [
    `# ${params.kind === "tr" ? "Termo de Referência" : "Estudo Técnico Preliminar"} — ${params.object}`,
    orchestration.consolidated.summary,
    "",
    "## Sugestões consolidadas",
    ...orchestration.consolidated.suggestions.map(s => `- ${s}`),
    "",
    "## Base legal",
    ...orchestration.consolidated.legalBasis.map(l => `- ${l}`),
    "",
    "> Rascunho gerado a partir do fluxo. Revisão obrigatória pelo servidor competente.",
  ].join("\n");

  const doc = createGeneratedDocument({
    organizationId: params.organizationId,
    processId: params.processId,
    kind: params.kind,
    title: `${params.kind.toUpperCase()} — ${params.object}`,
    content,
    sources: [`itens_aprovados:${approved.length}`, `copilotos:${orchestration.selectedCopilots.join(",")}`],
    correlationId: params.correlationId,
  });
  await insertGeneratedDocument(doc);
  // RC-3 — documento oficial pelo pipeline ÚNICO (Document Engine).
  await generateOfficialDocument({
    organizationId: params.organizationId, businessDomain: DOMAIN, documentType: params.kind,
    origin: params.processId, title: doc.title, content, author: "multi_copilot", correlationId: params.correlationId,
    metadata: { copilots: orchestration.selectedCopilots, legalBasis: orchestration.consolidated.legalBasis, approvedItems: approved.length },
  });
  await recordProcessEvent({
    organizationId: params.organizationId, processId: params.processId, eventType: "recommendation",
    actor: "multi_copilot", summary: `${params.kind.toUpperCase()} gerado (rascunho) a partir de ${approved.length} item(ns).`,
    refId: doc.id, correlationId: params.correlationId,
  });
  return doc;
}

/**
 * Gera o Edital após aprovação do TR. Presencial exige justificativa legal
 * automática; eletrônico exige plataforma. Valida antes de persistir.
 */
export async function generateNotice(params: {
  organizationId: number;
  processId: string;
  object: string;
  modality: EditalModality;
  form: EditalForm;
  platform?: EditalPlatform;
  correlationId: string;
}): Promise<{ document: GeneratedDocument; validation: { valid: boolean; violations: string[] } }> {
  assertKernelAccess(DOMAIN, "document_engine");

  const legalJustification = params.form === "presencial"
    ? defaultPresencialJustification(params.modality)
    : "";

  const doc = createGeneratedDocument({
    organizationId: params.organizationId,
    processId: params.processId,
    kind: "edital",
    title: `Edital — ${params.object}`,
    content: `# Edital — ${params.object}\nModalidade: ${params.modality} | Forma: ${params.form}${params.platform ? ` | Plataforma: ${params.platform}` : ""}\n\n> Templates, cláusulas e cronograma aplicados conforme a modalidade. Revisão obrigatória.`,
    sources: ["tr_aprovado"],
    modality: params.modality,
    form: params.form,
    platform: params.form === "eletronico" ? (params.platform ?? null) : null,
    legalJustification,
    correlationId: params.correlationId,
  });
  const validation = validateEdital(doc);
  if (validation.valid) {
    await insertGeneratedDocument(doc);
    // RC-3 — documento oficial pelo pipeline ÚNICO (Document Engine).
    await generateOfficialDocument({
      organizationId: params.organizationId, businessDomain: DOMAIN, documentType: "edital",
      origin: params.processId, title: doc.title, content: doc.content, author: "sistema", correlationId: params.correlationId,
      metadata: { modality: params.modality, form: params.form, platform: params.platform ?? null },
    });
    await recordProcessEvent({
      organizationId: params.organizationId, processId: params.processId, eventType: "decision",
      actor: "sistema", summary: `Edital gerado: ${params.modality}/${params.form}.`, refId: doc.id,
      correlationId: params.correlationId,
    });
  }
  return { document: doc, validation };
}

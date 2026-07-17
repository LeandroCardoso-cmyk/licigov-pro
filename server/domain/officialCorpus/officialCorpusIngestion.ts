/**
 * RC-4.9 — Official Knowledge Corpus · Ingestão (Fases 1-4, 7).
 *
 * Orquestra a incorporação de um documento oficial VERBATIM usando EXCLUSIVAMENTE os frameworks
 * já existentes: Institutional Knowledge Framework (documento/blocos), Institutional Knowledge
 * Pipeline (validation/gates/publication), Normative Foundation (árvore) e a classificação oficial.
 * NÃO cria frameworks, NÃO usa IA/RAG, NÃO resume/interpreta. Determinístico, multi-tenant.
 */

import type { ParsedNorm } from "../../services/officialCorpus/officialTextParser";
import { createKnowledgeDocument, createSection, type KnowledgeDocument } from "../knowledge/knowledgeDocument";
import { createBlock, type KnowledgeBlock } from "../knowledge/knowledgeBlocks";
import { createInstitutionalPipelineDefinition, buildPipeline, type KnowledgePipeline } from "../knowledge/pipeline/knowledgePipeline";
import { executePipeline, type KnowledgePipelineResult } from "../knowledge/pipeline/pipelineExecution";
import { KnowledgePublisher, type PublishOutcome } from "../knowledge/pipeline/publicationEngine";
import { createNormativeNode, normativeNodeId, type NormativeNode } from "../legal/normative/normativeNode";
import { createNormativeTree, type NormativeTree } from "../legal/normative/normativeTree";
import type { NormativeLevelId } from "../legal/normative/normativeHierarchy";
import { classifyOfficialDocument, type OfficialDocument, type CreateOfficialDocumentParams } from "./officialDocument";

const T = "2026-01-01T00:00:00.000Z";

export interface IngestedDocument {
  readonly official: OfficialDocument;
  readonly knowledgeDocument: KnowledgeDocument;
  readonly execution: KnowledgePipelineResult;
  readonly publication: PublishOutcome;
  readonly normativeTree: NormativeTree | null;
}

export interface IngestNormParams {
  parsed: ParsedNorm;
  classification: Omit<CreateOfficialDocumentParams, "title" | "knowledgeDocumentId">;
  correlationId: string;
  /** Constrói a árvore normativa (Título/Capítulo/Artigo) — para a norma primária (Lei 14.133). */
  buildTree?: boolean;
}

/** Constrói o KnowledgeDocument verbatim (OfficialText por artigo + Explainability de origem). */
function buildKnowledgeDocument(parsed: ParsedNorm, normId: string, tenantId: number, source: string, effectiveDate: string | null): KnowledgeDocument {
  const docKey = normId;
  const officialBlocks: KnowledgeBlock[] = parsed.articles.map((a, i) => createBlock({
    docKey, kind: "OfficialText", order: i + 1, title: a.identifier,
    fragments: [{ text: a.fullText, metadata: { identifier: a.identifier, path: a.path } }],
    metadata: { identifier: a.identifier, path: a.path, paragraphs: a.paragraphs.length },
  }));
  // Explainability = origem factual (não é resumo/interpretação): fonte, URL, vigência.
  const explain = createBlock({
    docKey, kind: "Explainability", order: 0,
    fragments: [{ text: `Fonte oficial: ${source}. URL: ${parsed.url || "n/d"}. Vigência: ${effectiveDate ?? "n/d"}. Texto incorporado verbatim, sem resumo, interpretação ou IA.` }],
    metadata: { source, url: parsed.url, effectiveDate },
  });
  const sections = [
    createSection({ docKey, title: "Metadados", order: 0, blocks: [explain] }),
    createSection({ docKey, title: "Texto Oficial", order: 1, blocks: officialBlocks }),
  ];
  return createKnowledgeDocument({
    tenantId, docKey, title: parsed.title, sections, semver: "1.0.0", revision: 1,
    lifecycleState: "draft", metadata: { source, url: parsed.url, articles: parsed.articles.length },
    createdAt: T, updatedAt: T,
  });
}

/** Constrói a árvore normativa a partir dos artigos parseados (Título → Capítulo → Artigo). */
function buildNormTreeFromParsed(parsed: ParsedNorm, normId: string, tenantId: number, authority: string, scope: string): NormativeTree {
  const nodesById = new Map<string, NormativeNode>();
  const childrenByParent = new Map<string, string[]>();
  const idFor = (type: NormativeLevelId, identifier: string) => normativeNodeId(tenantId, normId, type, identifier);

  const ensure = (type: NormativeLevelId, identifier: string, parentId: string | null, order: number) => {
    const id = idFor(type, identifier);
    if (parentId) { const arr = childrenByParent.get(parentId) ?? []; if (!arr.includes(id)) arr.push(id); childrenByParent.set(parentId, arr); }
    if (!nodesById.has(id)) nodesById.set(id, createNormativeNode({ tenantId, normId, type, identifier, displayName: identifier, parent: parentId, order, authority, scope, metadata: {} }));
    return id;
  };

  // Raiz: a lei.
  const rootId = ensure("lei", parsed.title.split(",")[0].trim() || normId, null, 0);
  let order = 0;
  for (const a of parsed.articles) {
    let parentId = rootId;
    for (const seg of a.path) {
      const type: NormativeLevelId = /^Título/i.test(seg) ? "titulo" : /^Capítulo/i.test(seg) ? "capitulo" : /^Seção/i.test(seg) ? "secao" : "subsecao";
      parentId = ensure(type, seg, parentId, ++order);
    }
    ensure("artigo", a.identifier, parentId, ++order);
  }

  // Reconstrói nós com filhos preenchidos (determinístico).
  const finalNodes: NormativeNode[] = [...nodesById.values()].map(n => createNormativeNode({
    tenantId, normId, type: n.type, identifier: n.identifier, displayName: n.displayName,
    parent: n.parent, children: (childrenByParent.get(n.id) ?? []).slice().sort((a, b) => a.localeCompare(b)),
    order: n.order, authority, scope, metadata: n.metadata,
  })).sort((a, b) => a.id.localeCompare(b.id));

  return createNormativeTree(normId, rootId, finalNodes, []);
}

/** Incorpora uma norma oficial: monta documento, roda o pipeline com perfil oficial e publica. */
export function ingestNorm(params: IngestNormParams): IngestedDocument {
  const { parsed, classification, correlationId } = params;
  const tenantId = classification.tenantId ?? 0;
  const source = classification.source;
  const effectiveDate = classification.effectiveDate ?? null;

  const knowledgeDocument = buildKnowledgeDocument(parsed, classification.normId, tenantId, source, effectiveDate);

  const pipeline: KnowledgePipeline = buildPipeline(createInstitutionalPipelineDefinition(tenantId || 1));
  const execution = executePipeline(pipeline, {
    tenantId: tenantId || 1, correlationId, document: knowledgeDocument, bindingConsistent: true, qualityProfile: "official_norm",
    metadata: { normId: classification.normId },
  }, {}, { startedAt: T, finishedAt: T });

  const publication = KnowledgePublisher.publish({
    tenantId: tenantId || 1, correlationId, document: knowledgeDocument, approvedBy: classification.authority,
    reason: `Incorporação oficial verbatim de ${parsed.title}.`, bindingConsistent: true, profile: "official_norm", publishedAt: T,
  });

  const normativeTree = params.buildTree
    ? buildNormTreeFromParsed(parsed, classification.normId, tenantId, classification.authority, classification.jurisdiction)
    : null;

  const official = classifyOfficialDocument({
    ...classification, title: parsed.title, knowledgeDocumentId: publication.snapshot?.manifest.docId ?? knowledgeDocument.id,
  });

  return { official, knowledgeDocument, execution, publication, normativeTree };
}

/** Incorpora um documento longo (manuais) por blocos verbatim, via o mesmo pipeline oficial. */
export function ingestChunkedDocument(params: {
  title: string; url: string; chunks: readonly string[];
  classification: Omit<CreateOfficialDocumentParams, "title" | "knowledgeDocumentId">;
  correlationId: string;
}): IngestedDocument {
  const { classification, correlationId } = params;
  const tenantId = classification.tenantId ?? 0;
  const docKey = classification.normId;
  const officialBlocks: KnowledgeBlock[] = params.chunks.map((c, i) => createBlock({ docKey, kind: "OfficialText", order: i + 1, title: `Trecho ${i + 1}`, fragments: [{ text: c }] }));
  const explain = createBlock({ docKey, kind: "Explainability", order: 0, fragments: [{ text: `Fonte oficial: ${classification.source}. URL: ${params.url || "n/d"}. Documento incorporado verbatim em ${params.chunks.length} trechos, sem resumo/IA.` }] });
  const knowledgeDocument = createKnowledgeDocument({
    tenantId, docKey, title: params.title,
    sections: [createSection({ docKey, title: "Metadados", order: 0, blocks: [explain] }), createSection({ docKey, title: "Texto Oficial", order: 1, blocks: officialBlocks })],
    semver: "1.0.0", revision: 1, lifecycleState: "draft", metadata: { source: classification.source, chunks: params.chunks.length }, createdAt: T, updatedAt: T,
  });
  const pipeline = buildPipeline(createInstitutionalPipelineDefinition(tenantId || 1));
  const execution = executePipeline(pipeline, { tenantId: tenantId || 1, correlationId, document: knowledgeDocument, bindingConsistent: true, qualityProfile: "official_norm" }, {}, { startedAt: T, finishedAt: T });
  const publication = KnowledgePublisher.publish({ tenantId: tenantId || 1, correlationId, document: knowledgeDocument, approvedBy: classification.authority, reason: `Incorporação verbatim de ${params.title}.`, bindingConsistent: true, profile: "official_norm", publishedAt: T });
  const official = classifyOfficialDocument({ ...classification, title: params.title, knowledgeDocumentId: publication.snapshot?.manifest.docId ?? knowledgeDocument.id });
  return { official, knowledgeDocument, execution, publication, normativeTree: null };
}

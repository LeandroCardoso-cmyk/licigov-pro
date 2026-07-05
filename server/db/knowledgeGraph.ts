/**
 * Sprint 4.8.1 — Knowledge Graph Persistence Repository
 *
 * Persistência real do grafo via Drizzle ORM (MySQL). Segue o padrão canônico
 * getDb() do LiciGov Pro: quando não há conexão (ex.: ambiente de teste sem
 * DATABASE_URL), as funções degradam graciosamente retornando [] / null / no-op,
 * sem lançar — exatamente como os demais repositories da plataforma.
 *
 * Multi-tenant: TODA query é escopada por organization_id.
 * Serialização: aliases/metadata são armazenados como JSON string em colunas TEXT.
 * Replay safety: IDs determinísticos vindos do domínio; nenhum Date.now()/random.
 */

import { and, eq, inArray, like, or } from "drizzle-orm";
import { createHash } from "crypto";
import { getDb } from "./connection";
import {
  knowledgeNodesTable,
  knowledgeEdgesTable,
  entityResolutionsTable,
  graphChangeLogTable,
  graphMetricsTable,
  graphVersionsTable,
  procurementConceptsTable,
} from "../../drizzle/schema";
import type { ProcurementConcept } from "../domain/procurementConcept";
import type { KnowledgeNode, NodeType } from "../domain/knowledgeNode";
import { createKnowledgeNode } from "../domain/knowledgeNode";
import type { KnowledgeEdge, RelationshipType } from "../domain/knowledgeEdge";
import { createKnowledgeEdge } from "../domain/knowledgeEdge";
import type { EntityResolutionRecord } from "../domain/entityResolution";

// ─── Mapping helpers ──────────────────────────────────────────────────────────

function safeParseArray(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function safeParseObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

type NodeRow = typeof knowledgeNodesTable.$inferSelect;
type EdgeRow = typeof knowledgeEdgesTable.$inferSelect;

/** Reconstrói um KnowledgeNode a partir de uma linha do banco. */
export function rowToNode(row: NodeRow): KnowledgeNode {
  const metadata = safeParseObject(row.metadata);
  const lineageId = typeof metadata.__lineageId === "string" ? metadata.__lineageId : "";
  const graphVersion = typeof metadata.__graphVersion === "number" ? metadata.__graphVersion : 1;
  const createdBy = typeof metadata.__createdBy === "string" ? metadata.__createdBy : "system";
  const updatedBy = typeof metadata.__updatedBy === "string" ? metadata.__updatedBy : createdBy;
  // Remove chaves internas de lineage do metadata público
  const publicMetadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (!k.startsWith("__")) publicMetadata[k] = v;
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    nodeType: row.nodeType as NodeType,
    externalId: row.externalId ?? null,
    title: row.title,
    normalizedTitle: row.normalizedTitle,
    description: row.description ?? "",
    aliases: safeParseArray(row.aliases),
    metadata: publicMetadata,
    confidence: Number(row.confidence),
    source: row.source,
    version: row.version,
    active: row.active === 1,
    correlationId: row.correlationId,
    lineageId,
    graphVersion,
    createdBy,
    updatedBy,
    createdAt: row.createdAt,
  };
}

function nodeToRow(node: KnowledgeNode): typeof knowledgeNodesTable.$inferInsert {
  const metadataWithLineage = {
    ...node.metadata,
    __lineageId: node.lineageId,
    __graphVersion: node.graphVersion,
    __createdBy: node.createdBy,
    __updatedBy: node.updatedBy,
  };
  return {
    id: node.id,
    organizationId: node.organizationId,
    nodeType: node.nodeType,
    externalId: node.externalId,
    title: node.title,
    normalizedTitle: node.normalizedTitle,
    description: node.description,
    aliases: JSON.stringify(node.aliases),
    metadata: JSON.stringify(metadataWithLineage),
    confidence: String(node.confidence),
    source: node.source,
    version: node.version,
    active: node.active ? 1 : 0,
    correlationId: node.correlationId,
    createdAt: node.createdAt,
  };
}

/** Reconstrói um KnowledgeEdge a partir de uma linha (campos de replay recomputados deterministicamente). */
export function rowToEdge(row: EdgeRow): KnowledgeEdge {
  return createKnowledgeEdge({
    organizationId: row.organizationId,
    sourceNodeId: row.sourceNodeId,
    targetNodeId: row.targetNodeId,
    relationshipType: row.relationshipType as RelationshipType,
    weight: Number(row.weight),
    confidence: Number(row.confidence),
    justification: row.justification ?? "",
    provenance: row.provenance,
    direction: row.direction as "unidirectional" | "bidirectional",
    ontologyValidationResult: "valid",
    correlationId: row.correlationId,
    createdAt: row.createdAt,
  });
}

// ─── Node persistence ─────────────────────────────────────────────────────────

export async function insertKnowledgeNode(node: KnowledgeNode): Promise<KnowledgeNode | null> {
  const db = await getDb();
  if (!db) return null;
  await db
    .insert(knowledgeNodesTable)
    .values(nodeToRow(node))
    .onDuplicateKeyUpdate({
      set: {
        title: node.title,
        normalizedTitle: node.normalizedTitle,
        description: node.description,
        aliases: JSON.stringify(node.aliases),
        confidence: String(node.confidence),
        version: node.version,
        active: node.active ? 1 : 0,
      },
    });
  return node;
}

export async function getKnowledgeNodeById(
  id: string,
  organizationId: number,
): Promise<KnowledgeNode | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(knowledgeNodesTable)
    .where(and(eq(knowledgeNodesTable.id, id), eq(knowledgeNodesTable.organizationId, organizationId)))
    .limit(1);
  return rows.length > 0 ? rowToNode(rows[0]) : null;
}

/** Verifica se um nó pertence ao tenant (ownership enforcement para arestas). */
export async function nodeBelongsToOrg(id: string, organizationId: number): Promise<boolean> {
  const node = await getKnowledgeNodeById(id, organizationId);
  return node !== null && node.active;
}

export async function searchKnowledgeNodes(
  organizationId: number,
  opts: { query?: string; nodeType?: string; limit?: number; offset?: number } = {},
): Promise<KnowledgeNode[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    eq(knowledgeNodesTable.organizationId, organizationId),
    eq(knowledgeNodesTable.active, 1),
  ];
  if (opts.nodeType) conditions.push(eq(knowledgeNodesTable.nodeType, opts.nodeType));
  if (opts.query) {
    const q = `%${opts.query.toLowerCase()}%`;
    const textMatch = or(
      like(knowledgeNodesTable.normalizedTitle, q),
      like(knowledgeNodesTable.aliases, q),
    );
    if (textMatch) conditions.push(textMatch);
  }
  const rows = await db
    .select()
    .from(knowledgeNodesTable)
    .where(and(...conditions))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
  return rows.map(rowToNode);
}

export async function updateKnowledgeNode(node: KnowledgeNode): Promise<KnowledgeNode | null> {
  const db = await getDb();
  if (!db) return null;
  await db
    .update(knowledgeNodesTable)
    .set(nodeToRow(node))
    .where(and(eq(knowledgeNodesTable.id, node.id), eq(knowledgeNodesTable.organizationId, node.organizationId)));
  return node;
}

export async function deactivateKnowledgeNode(id: string, organizationId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db
    .update(knowledgeNodesTable)
    .set({ active: 0 })
    .where(and(eq(knowledgeNodesTable.id, id), eq(knowledgeNodesTable.organizationId, organizationId)));
  return true;
}

// ─── Edge persistence ─────────────────────────────────────────────────────────

export async function insertKnowledgeEdge(edge: KnowledgeEdge): Promise<KnowledgeEdge | null> {
  const db = await getDb();
  if (!db) return null;
  await db
    .insert(knowledgeEdgesTable)
    .values({
      id: edge.id,
      organizationId: edge.organizationId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      relationshipType: edge.relationshipType,
      weight: String(edge.weight),
      confidence: String(edge.confidence),
      justification: edge.justification,
      provenance: edge.provenance,
      direction: edge.direction,
      active: edge.active ? 1 : 0,
      correlationId: edge.correlationId,
      createdAt: edge.createdAt,
    })
    .onDuplicateKeyUpdate({
      set: {
        weight: String(edge.weight),
        confidence: String(edge.confidence),
        justification: edge.justification,
        active: edge.active ? 1 : 0,
      },
    });
  return edge;
}

export async function getEdgesForNode(nodeId: string, organizationId: number): Promise<KnowledgeEdge[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(knowledgeEdgesTable)
    .where(
      and(
        eq(knowledgeEdgesTable.organizationId, organizationId),
        eq(knowledgeEdgesTable.active, 1),
        or(eq(knowledgeEdgesTable.sourceNodeId, nodeId), eq(knowledgeEdgesTable.targetNodeId, nodeId)),
      ),
    );
  return rows.map(rowToEdge);
}

/** Carrega adjacência em lote (para traversal lazy sem carregar o grafo inteiro). */
export async function getEdgesForNodes(nodeIds: string[], organizationId: number): Promise<KnowledgeEdge[]> {
  const db = await getDb();
  if (!db || nodeIds.length === 0) return [];
  const rows = await db
    .select()
    .from(knowledgeEdgesTable)
    .where(
      and(
        eq(knowledgeEdgesTable.organizationId, organizationId),
        eq(knowledgeEdgesTable.active, 1),
        or(
          inArray(knowledgeEdgesTable.sourceNodeId, nodeIds),
          inArray(knowledgeEdgesTable.targetNodeId, nodeIds),
        ),
      ),
    );
  return rows.map(rowToEdge);
}

export async function getNodesByIds(ids: string[], organizationId: number): Promise<KnowledgeNode[]> {
  const db = await getDb();
  if (!db || ids.length === 0) return [];
  const rows = await db
    .select()
    .from(knowledgeNodesTable)
    .where(
      and(
        eq(knowledgeNodesTable.organizationId, organizationId),
        inArray(knowledgeNodesTable.id, ids),
      ),
    );
  return rows.map(rowToNode);
}

export async function deactivateKnowledgeEdge(id: string, organizationId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  await db
    .update(knowledgeEdgesTable)
    .set({ active: 0 })
    .where(and(eq(knowledgeEdgesTable.id, id), eq(knowledgeEdgesTable.organizationId, organizationId)));
  return true;
}

// ─── Entity resolution persistence ──────────────────────────────────────────

export async function insertEntityResolution(
  record: EntityResolutionRecord,
): Promise<EntityResolutionRecord | null> {
  const db = await getDb();
  if (!db) return null;
  const reasoningPayload = JSON.stringify({
    reason: record.reasoning,
    evidence: record.resolutionEvidence,
    trace: record.resolutionTrace,
    similarity: record.similarityMetadata,
  });
  await db
    .insert(entityResolutionsTable)
    .values({
      id: record.id,
      organizationId: record.organizationId,
      sourceEntityId: record.sourceEntityId,
      targetEntityId: record.targetEntityId,
      strategy: record.strategy,
      status: record.status,
      confidence: String(record.confidence),
      reasoning: reasoningPayload,
      resolvedBy: record.resolvedBy,
      correlationId: record.correlationId,
      createdAt: record.createdAt,
    })
    .onDuplicateKeyUpdate({
      set: { status: record.status, confidence: String(record.confidence), reasoning: reasoningPayload },
    });
  return record;
}

export async function listEntityResolutions(
  organizationId: number,
  status?: string,
): Promise<Array<{ id: string; sourceEntityId: string; targetEntityId: string; strategy: string; status: string; confidence: number }>> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(entityResolutionsTable.organizationId, organizationId)];
  if (status) conditions.push(eq(entityResolutionsTable.status, status));
  const rows = await db.select().from(entityResolutionsTable).where(and(...conditions));
  return rows.map(r => ({
    id: r.id,
    sourceEntityId: r.sourceEntityId,
    targetEntityId: r.targetEntityId,
    strategy: r.strategy,
    status: r.status,
    confidence: Number(r.confidence),
  }));
}

// ─── Lineage & observability persistence ─────────────────────────────────────

function deterministicRowId(prefix: string, parts: (string | number)[]): string {
  return createHash("sha256").update(`${prefix}:${parts.join(":")}`).digest("hex").slice(0, 20);
}

export async function insertGraphChangeLog(params: {
  organizationId: number;
  entityType: "node" | "edge" | "resolution";
  entityId: string;
  operation: "create" | "update" | "deactivate" | "resolve";
  beforeState: unknown;
  afterState: unknown;
  changedBy: string;
  correlationId: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const id = deterministicRowId("gcl", [
    params.organizationId,
    params.entityType,
    params.entityId,
    params.operation,
    params.correlationId,
  ]);
  await db
    .insert(graphChangeLogTable)
    .values({
      id,
      organizationId: params.organizationId,
      entityType: params.entityType,
      entityId: params.entityId,
      operation: params.operation,
      beforeState: params.beforeState == null ? null : JSON.stringify(params.beforeState),
      afterState: params.afterState == null ? null : JSON.stringify(params.afterState),
      changedBy: params.changedBy,
      correlationId: params.correlationId,
    })
    .onDuplicateKeyUpdate({ set: { afterState: params.afterState == null ? null : JSON.stringify(params.afterState) } });
}

export async function recordGraphMetricRow(params: {
  organizationId: number;
  correlationId: string;
  metricName: string;
  metricValue: number;
  metricUnit?: string;
  tags?: Record<string, string>;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const id = deterministicRowId("gm", [
    params.organizationId,
    params.metricName,
    params.correlationId,
    params.metricValue,
  ]);
  await db
    .insert(graphMetricsTable)
    .values({
      id,
      organizationId: params.organizationId,
      correlationId: params.correlationId,
      metricName: params.metricName,
      metricValue: String(params.metricValue),
      metricUnit: params.metricUnit ?? "count",
      tags: params.tags ? JSON.stringify(params.tags) : null,
    })
    .onDuplicateKeyUpdate({ set: { metricValue: String(params.metricValue) } });
}

export async function insertGraphVersion(params: {
  organizationId: number;
  versionNumber: number;
  nodeCount: number;
  edgeCount: number;
  changeSummary: string;
  createdBy: string;
  correlationId: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const id = deterministicRowId("gv", [
    params.organizationId,
    params.versionNumber,
    params.correlationId,
  ]);
  await db
    .insert(graphVersionsTable)
    .values({
      id,
      organizationId: params.organizationId,
      versionNumber: params.versionNumber,
      nodeCount: params.nodeCount,
      edgeCount: params.edgeCount,
      changeSummary: params.changeSummary,
      createdBy: params.createdBy,
      correlationId: params.correlationId,
    })
    .onDuplicateKeyUpdate({ set: { nodeCount: params.nodeCount, edgeCount: params.edgeCount } });
}

// ─── Lazy subgraph loading (SQL-first, batched adjacency) ────────────────────

/**
 * Carrega incrementalmente o subgrafo ao redor de um nó inicial, expandindo por
 * BFS em lotes (getEdgesForNodes). Evita carregar o grafo inteiro em memória:
 * limitado por maxDepth e maxNodes. Base para traversal/recommendation escaláveis.
 */
export async function loadSubgraph(
  organizationId: number,
  startId: string,
  maxDepth = 3,
  maxNodes = 200,
): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
  const db = await getDb();
  if (!db) return { nodes: [], edges: [] };
  const start = await getKnowledgeNodeById(startId, organizationId);
  if (!start) return { nodes: [], edges: [] };

  const nodeMap = new Map<string, KnowledgeNode>([[start.id, start]]);
  const edgeMap = new Map<string, KnowledgeEdge>();
  let frontier = [start.id];
  let depth = 0;

  while (frontier.length > 0 && depth < maxDepth && nodeMap.size < maxNodes) {
    const edges = await getEdgesForNodes(frontier, organizationId);
    const nextIds = new Set<string>();
    for (const e of edges) {
      edgeMap.set(e.id, e);
      if (!nodeMap.has(e.sourceNodeId)) nextIds.add(e.sourceNodeId);
      if (!nodeMap.has(e.targetNodeId)) nextIds.add(e.targetNodeId);
    }
    if (nextIds.size === 0) break;
    const newNodes = await getNodesByIds([...nextIds], organizationId);
    for (const n of newNodes) nodeMap.set(n.id, n);
    frontier = newNodes.map(n => n.id);
    depth++;
  }

  return { nodes: [...nodeMap.values()], edges: [...edgeMap.values()] };
}

// ─── Procurement concept (ontology) persistence ─────────────────────────────

export async function insertProcurementConcept(
  concept: ProcurementConcept,
  correlationId: string,
): Promise<ProcurementConcept | null> {
  const db = await getDb();
  if (!db) return null;
  await db
    .insert(procurementConceptsTable)
    .values({
      id: concept.id,
      organizationId: concept.organizationId,
      category: concept.category,
      name: concept.name,
      normalizedName: concept.normalizedName,
      definition: concept.definition,
      legalBasis: concept.legalBasis,
      parentConceptId: concept.parentConceptId,
      aliases: JSON.stringify(concept.aliases),
      examples: JSON.stringify(concept.examples),
      correlationId,
    })
    .onDuplicateKeyUpdate({
      set: {
        definition: concept.definition,
        legalBasis: concept.legalBasis,
        aliases: JSON.stringify(concept.aliases),
        examples: JSON.stringify(concept.examples),
      },
    });
  return concept;
}

export interface OntologyConceptRow {
  id: string;
  organizationId: number;
  category: string;
  name: string;
  normalizedName: string;
  definition: string;
  legalBasis: string;
  parentConceptId: string | null;
  aliases: string[];
  examples: string[];
}

function conceptRowToDto(row: typeof procurementConceptsTable.$inferSelect): OntologyConceptRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    category: row.category,
    name: row.name,
    normalizedName: row.normalizedName,
    definition: row.definition ?? "",
    legalBasis: row.legalBasis,
    parentConceptId: row.parentConceptId ?? null,
    aliases: safeParseArray(row.aliases),
    examples: safeParseArray(row.examples),
  };
}

export async function listProcurementConcepts(
  organizationId: number,
  category?: string,
): Promise<OntologyConceptRow[]> {
  const db = await getDb();
  if (!db) return [];
  const conditions = [eq(procurementConceptsTable.organizationId, organizationId)];
  if (category) conditions.push(eq(procurementConceptsTable.category, category));
  const rows = await db.select().from(procurementConceptsTable).where(and(...conditions));
  return rows.map(conceptRowToDto);
}

export async function searchProcurementConcepts(
  organizationId: number,
  query: string,
  limit = 50,
): Promise<OntologyConceptRow[]> {
  const db = await getDb();
  if (!db) return [];
  const q = `%${query.toLowerCase()}%`;
  const match = or(
    like(procurementConceptsTable.normalizedName, q),
    like(procurementConceptsTable.aliases, q),
  );
  const rows = await db
    .select()
    .from(procurementConceptsTable)
    .where(match ? and(eq(procurementConceptsTable.organizationId, organizationId), match) : eq(procurementConceptsTable.organizationId, organizationId))
    .limit(limit);
  return rows.map(conceptRowToDto);
}

// ─── Statistics ────────────────────────────────────────────────────────────

export async function graphStatistics(
  organizationId: number,
): Promise<{ totalNodes: number; totalEdges: number; avgDegree: number }> {
  const db = await getDb();
  if (!db) return { totalNodes: 0, totalEdges: 0, avgDegree: 0 };
  const nodeRows = await db
    .select({ id: knowledgeNodesTable.id })
    .from(knowledgeNodesTable)
    .where(and(eq(knowledgeNodesTable.organizationId, organizationId), eq(knowledgeNodesTable.active, 1)));
  const edgeRows = await db
    .select({ id: knowledgeEdgesTable.id })
    .from(knowledgeEdgesTable)
    .where(and(eq(knowledgeEdgesTable.organizationId, organizationId), eq(knowledgeEdgesTable.active, 1)));
  const totalNodes = nodeRows.length;
  const totalEdges = edgeRows.length;
  return {
    totalNodes,
    totalEdges,
    avgDegree: totalNodes > 0 ? (totalEdges * 2) / totalNodes : 0,
  };
}

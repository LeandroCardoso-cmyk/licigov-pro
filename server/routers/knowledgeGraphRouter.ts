/**
 * Sprint 4.8.1 — Knowledge Graph Router (operational).
 *
 * Sem stubs: cada endpoint executa o fluxo real (domínio → validação de
 * ontologia → ownership multi-tenant → persistência Drizzle → change log).
 * IDs 100% determinísticos vindos do domínio. Nenhum Date.now()/random.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import { createKnowledgeNode, updateNodeVersion, type NodeType } from "../domain/knowledgeNode";
import { createKnowledgeEdge, type RelationshipType } from "../domain/knowledgeEdge";
import { validateEdgeInstance } from "../services/ontologyValidationService";
import {
  recommendRelated,
} from "../services/graphRecommendationService";
import { bfs, dijkstra, explainPath } from "../services/graphTraversalService";
import {
  insertKnowledgeNode,
  getKnowledgeNodeById,
  searchKnowledgeNodes,
  updateKnowledgeNode,
  deactivateKnowledgeNode,
  insertKnowledgeEdge,
  getEdgesForNode,
  getNodesByIds,
  deactivateKnowledgeEdge,
  insertGraphChangeLog,
  recordGraphMetricRow,
  graphStatistics,
  loadSubgraph,
} from "../db/knowledgeGraph";

const NODE_TYPES = [
  "legislation", "article", "clause", "jurisprudence", "parecer", "catmat_item",
  "catser_item", "tr_item", "supplier", "public_body", "municipality", "process",
  "contract", "ata", "risk", "technical_requirement", "document", "concept",
] as const;

const RELATIONSHIP_TYPES = [
  "regulates", "references", "supersedes", "contradicts", "supports", "requires",
  "part_of", "instance_of", "related_to", "derived_from", "applies_to", "supplies",
  "risks", "mitigates", "justifies", "precedes", "follows",
] as const;

export const knowledgeGraphRouter = router({
  createNode: tenantProcedure
    .input(z.object({
      nodeType: z.enum(NODE_TYPES),
      title: z.string().min(1),
      description: z.string().optional(),
      externalId: z.string().optional(),
      aliases: z.array(z.string()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      confidence: z.number().min(0).max(1).optional(),
      source: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const node = createKnowledgeNode({
        organizationId: orgId,
        nodeType: input.nodeType,
        title: input.title,
        description: input.description,
        externalId: input.externalId,
        aliases: input.aliases,
        metadata: input.metadata,
        confidence: input.confidence,
        source: input.source,
        correlationId: ctx.correlationId,
        createdBy: String(ctx.user.id),
      });
      await insertKnowledgeNode(node);
      await insertGraphChangeLog({
        organizationId: orgId,
        entityType: "node",
        entityId: node.id,
        operation: "create",
        beforeState: null,
        afterState: { title: node.title, nodeType: node.nodeType },
        changedBy: String(ctx.user.id),
        correlationId: ctx.correlationId,
      });
      return { success: true, node };
    }),

  updateNode: tenantProcedure
    .input(z.object({
      nodeId: z.string().min(1),
      title: z.string().optional(),
      description: z.string().optional(),
      aliases: z.array(z.string()).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      confidence: z.number().min(0).max(1).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const existing = await getKnowledgeNodeById(input.nodeId, orgId);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Nó não encontrado nesta organização." });
      }
      const updated = updateNodeVersion(
        existing,
        {
          title: input.title,
          description: input.description,
          aliases: input.aliases,
          metadata: input.metadata,
          confidence: input.confidence,
        },
        String(ctx.user.id),
      );
      await updateKnowledgeNode(updated);
      await insertGraphChangeLog({
        organizationId: orgId,
        entityType: "node",
        entityId: updated.id,
        operation: "update",
        beforeState: { title: existing.title, version: existing.version },
        afterState: { title: updated.title, version: updated.version },
        changedBy: String(ctx.user.id),
        correlationId: ctx.correlationId,
      });
      return { success: true, node: updated };
    }),

  deleteNode: tenantProcedure
    .input(z.object({ nodeId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const existing = await getKnowledgeNodeById(input.nodeId, orgId);
      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Nó não encontrado nesta organização." });
      }
      await deactivateKnowledgeNode(input.nodeId, orgId);
      await insertGraphChangeLog({
        organizationId: orgId,
        entityType: "node",
        entityId: input.nodeId,
        operation: "deactivate",
        beforeState: { active: true },
        afterState: { active: false },
        changedBy: String(ctx.user.id),
        correlationId: ctx.correlationId,
      });
      return { success: true, nodeId: input.nodeId };
    }),

  findNode: tenantProcedure
    .input(z.object({ nodeId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const node = await getKnowledgeNodeById(input.nodeId, orgId);
      return { node };
    }),

  searchNode: tenantProcedure
    .input(z.object({
      query: z.string().min(1),
      nodeType: z.enum(NODE_TYPES).optional(),
      limit: z.number().min(1).max(100).optional(),
      offset: z.number().min(0).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const results = await searchKnowledgeNodes(orgId, {
        query: input.query,
        nodeType: input.nodeType,
        limit: input.limit,
        offset: input.offset,
      });
      return { results, total: results.length };
    }),

  createEdge: tenantProcedure
    .input(z.object({
      sourceNodeId: z.string().min(1),
      targetNodeId: z.string().min(1),
      relationshipType: z.enum(RELATIONSHIP_TYPES),
      weight: z.number().min(0).max(1).optional(),
      confidence: z.number().min(0).max(1).optional(),
      justification: z.string().optional(),
      direction: z.enum(["unidirectional", "bidirectional"]).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;

      // Ownership + tenant: ambos os nós devem pertencer à organização
      const [source, target] = await Promise.all([
        getKnowledgeNodeById(input.sourceNodeId, orgId),
        getKnowledgeNodeById(input.targetNodeId, orgId),
      ]);
      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Nó de origem não pertence a esta organização." });
      }
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Nó de destino não pertence a esta organização." });
      }

      // Validação de ontologia ANTES da persistência
      const validation = validateEdgeInstance({
        sourceNodeId: source.id,
        targetNodeId: target.id,
        sourceNodeType: source.nodeType,
        targetNodeType: target.nodeType,
        relationshipType: input.relationshipType as RelationshipType,
      });
      if (!validation.valid) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Relacionamento inválido pela ontologia: ${validation.violations.join(" ")}`,
        });
      }

      const edge = createKnowledgeEdge({
        organizationId: orgId,
        sourceNodeId: source.id,
        targetNodeId: target.id,
        relationshipType: input.relationshipType as RelationshipType,
        weight: input.weight,
        confidence: input.confidence,
        justification: input.justification,
        direction: input.direction,
        ontologyValidationResult: "valid",
        correlationId: ctx.correlationId,
      });
      await insertKnowledgeEdge(edge);
      await insertGraphChangeLog({
        organizationId: orgId,
        entityType: "edge",
        entityId: edge.id,
        operation: "create",
        beforeState: null,
        afterState: { relationshipType: edge.relationshipType, source: edge.sourceNodeId, target: edge.targetNodeId },
        changedBy: String(ctx.user.id),
        correlationId: ctx.correlationId,
      });
      return { success: true, edge };
    }),

  deleteEdge: tenantProcedure
    .input(z.object({ edgeId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      await deactivateKnowledgeEdge(input.edgeId, orgId);
      await insertGraphChangeLog({
        organizationId: orgId,
        entityType: "edge",
        entityId: input.edgeId,
        operation: "deactivate",
        beforeState: { active: true },
        afterState: { active: false },
        changedBy: String(ctx.user.id),
        correlationId: ctx.correlationId,
      });
      return { success: true, edgeId: input.edgeId };
    }),

  getNeighbors: tenantProcedure
    .input(z.object({ nodeId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const edges = await getEdgesForNode(input.nodeId, orgId);
      const neighborIds = new Set<string>();
      for (const e of edges) {
        if (e.sourceNodeId !== input.nodeId) neighborIds.add(e.sourceNodeId);
        if (e.targetNodeId !== input.nodeId) neighborIds.add(e.targetNodeId);
      }
      const neighbors = await getNodesByIds([...neighborIds], orgId);
      return { neighbors, edges, total: neighbors.length };
    }),

  traverse: tenantProcedure
    .input(z.object({
      startNodeId: z.string().min(1),
      depth: z.number().min(1).max(10).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const depth = input.depth ?? 3;
      const { nodes, edges } = await loadSubgraph(orgId, input.startNodeId, depth);
      const result = bfs(nodes, edges, input.startNodeId, orgId, depth);
      return {
        startNodeId: input.startNodeId,
        depth: result.depth,
        visitedNodes: result.visitedNodes,
        visitedEdges: result.visitedEdges,
        totalWeight: result.totalWeight,
      };
    }),

  shortestPath: tenantProcedure
    .input(z.object({
      fromNodeId: z.string().min(1),
      toNodeId: z.string().min(1),
      maxDepth: z.number().min(1).max(20).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const { nodes, edges } = await loadSubgraph(orgId, input.fromNodeId, input.maxDepth ?? 6);
      const result = dijkstra(nodes, edges, input.fromNodeId, input.toNodeId, orgId);
      const explanation = result.found ? explainPath(nodes, edges, result.path) : "";
      return {
        fromNodeId: input.fromNodeId,
        toNodeId: input.toNodeId,
        path: result.path,
        edges: result.edges,
        totalWeight: result.totalWeight,
        totalCost: result.totalCost,
        found: result.found,
        explanation,
      };
    }),

  recommend: tenantProcedure
    .input(z.object({
      nodeId: z.string().min(1),
      limit: z.number().min(1).max(50).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const { nodes, edges } = await loadSubgraph(orgId, input.nodeId, 3);
      const recommendations = recommendRelated(input.nodeId, nodes, edges, orgId, input.limit);
      return { nodeId: input.nodeId, recommendations };
    }),

  graphMetrics: tenantProcedure
    .query(async ({ ctx }) => {
      const orgId = ctx.organizationId!;
      const stats = await graphStatistics(orgId);
      await recordGraphMetricRow({
        organizationId: orgId,
        correlationId: ctx.correlationId,
        metricName: "graph.nodes.total",
        metricValue: stats.totalNodes,
      });
      return { metrics: stats };
    }),
});

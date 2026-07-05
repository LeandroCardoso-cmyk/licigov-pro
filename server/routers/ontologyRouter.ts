/**
 * Sprint 4.8.1 — Ontology Router (operational).
 *
 * Sem stubs: persistência real de conceitos + validação de ontologia real.
 * Multi-tenant via tenantProcedure. IDs determinísticos do domínio.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure } from "../_core/trpc";
import { createProcurementConcept, type ConceptCategory } from "../domain/procurementConcept";
import { validateEdge, allowedRelationships } from "../services/ontologyValidationService";
import type { RelationshipType } from "../domain/knowledgeEdge";
import {
  insertProcurementConcept,
  listProcurementConcepts,
  searchProcurementConcepts,
} from "../db/knowledgeGraph";

const CONCEPT_CATEGORIES = [
  "modalidade", "criterio_julgamento", "regime_contratacao", "tipo_documento",
  "tipo_risco", "tipo_objeto", "fase_licitacao", "qualificacao", "recurso", "sancao",
] as const;

const RELATIONSHIP_TYPES = [
  "regulates", "references", "supersedes", "contradicts", "supports", "requires",
  "part_of", "instance_of", "related_to", "derived_from", "applies_to", "supplies",
  "risks", "mitigates", "justifies", "precedes", "follows",
] as const;

export const ontologyRouter = router({
  createConcept: tenantProcedure
    .input(z.object({
      name: z.string().min(1),
      category: z.enum(CONCEPT_CATEGORIES),
      definition: z.string().min(1),
      legalBasis: z.string().optional(),
      parentConceptId: z.string().optional(),
      aliases: z.array(z.string()).optional(),
      examples: z.array(z.string()).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const concept = createProcurementConcept({
        organizationId: orgId,
        category: input.category as ConceptCategory,
        name: input.name,
        definition: input.definition,
        legalBasis: input.legalBasis,
        parentConceptId: input.parentConceptId,
        aliases: input.aliases,
        examples: input.examples,
      });
      await insertProcurementConcept(concept, ctx.correlationId);
      return { success: true, concept };
    }),

  searchOntology: tenantProcedure
    .input(z.object({
      query: z.string().min(1),
      limit: z.number().min(1).max(100).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const results = await searchProcurementConcepts(orgId, input.query, input.limit ?? 50);
      return { results, total: results.length };
    }),

  listConcepts: tenantProcedure
    .input(z.object({ category: z.enum(CONCEPT_CATEGORIES).optional() }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const concepts = await listProcurementConcepts(orgId, input.category);
      return { concepts, total: concepts.length };
    }),

  validateRelationship: tenantProcedure
    .input(z.object({
      sourceNodeType: z.string().min(1),
      targetNodeType: z.string().min(1),
      relationshipType: z.enum(RELATIONSHIP_TYPES),
    }))
    .query(async ({ input }) => {
      const result = validateEdge(
        input.sourceNodeType,
        input.targetNodeType,
        input.relationshipType as RelationshipType,
      );
      return result;
    }),

  allowedRelationships: tenantProcedure
    .input(z.object({
      sourceNodeType: z.string().min(1),
      targetNodeType: z.string().min(1),
    }))
    .query(async ({ input }) => {
      return { allowed: allowedRelationships(input.sourceNodeType, input.targetNodeType) };
    }),

  classifyDocument: tenantProcedure
    .input(z.object({
      documentContent: z.string().min(1),
      maxConcepts: z.number().min(1).max(20).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const concepts = await listProcurementConcepts(orgId);
      const content = input.documentContent.toLowerCase();
      const matches = concepts
        .filter(c =>
          content.includes(c.normalizedName) ||
          c.aliases.some(a => content.includes(a.toLowerCase())),
        )
        .slice(0, input.maxConcepts ?? 10)
        .map(c => ({ conceptId: c.id, conceptName: c.name, category: c.category }));
      if (concepts.length === 0) {
        // Sem base de conceitos persistida ainda: não é erro, apenas vazio.
        return { classifications: [] as Array<{ conceptId: string; conceptName: string; category: string }> };
      }
      return { classifications: matches };
    }),

  exportOntology: tenantProcedure
    .input(z.object({ category: z.enum(CONCEPT_CATEGORIES).optional() }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const concepts = await listProcurementConcepts(orgId, input.category);
      return {
        format: "json" as const,
        data: {
          concepts: concepts.map(c => ({ id: c.id, name: c.name, category: c.category })),
          metadata: { totalConcepts: concepts.length },
        },
      };
    }),
});

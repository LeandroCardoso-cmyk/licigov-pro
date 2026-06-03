/**
 * Sprint 3.1 — Clause Router.
 *
 * Procedimentos para recomendação e override de cláusulas do TR.
 */

import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  recommendClauses,
  selectClauseTemplate,
  inferProcurementType,
  type ClauseRecommendation,
  type ClauseTemplate,
  type ClauseItemInput,
  type ClauseRecommendationContext,
} from "../domain/clauseIntelligence";

// ─── Demo clause templates ────────────────────────────────────────────────────

const DEMO_TEMPLATES: ClauseTemplate[] = [
  {
    id:            "tmpl-001",
    type:          "legal_basis",
    title:         "Fundamentação Legal — Lei 14.133/2021",
    content:       "A presente contratação observa as disposições da Lei nº 14.133/2021 e seus regulamentos, notadamente o art. 6º, inciso XXIII, que define o Termo de Referência.",
    legalBasis:    "Art. 6º, XXIII, Lei 14.133/2021",
    priority:      10,
    appliesTo:     ["bem", "servico", "obra", "tic", "generico"],
    baseRelevance: 1.0,
  },
  {
    id:            "tmpl-002",
    type:          "body",
    title:         "Objeto da Contratação",
    content:       "O objeto da presente contratação é a aquisição de bens/serviços conforme especificações constantes neste Termo de Referência, nos termos do art. 18 da Lei nº 14.133/2021.",
    legalBasis:    "Art. 18, Lei 14.133/2021",
    priority:      9,
    appliesTo:     ["bem", "servico", "generico"],
    baseRelevance: 0.95,
  },
  {
    id:            "tmpl-003",
    type:          "justification",
    title:         "Justificativa da Necessidade",
    content:       "A contratação se justifica pela necessidade administrativa de atendimento às demandas institucionais, em conformidade com o planejamento anual de contratações (art. 12, VII, Lei 14.133/2021).",
    legalBasis:    "Art. 12, VII, Lei 14.133/2021",
    priority:      8,
    appliesTo:     ["bem", "servico", "obra", "tic", "generico"],
    baseRelevance: 0.85,
  },
  {
    id:            "tmpl-004",
    type:          "specification",
    title:         "Requisitos Técnicos — Bens de TIC",
    content:       "Os bens de Tecnologia da Informação e Comunicação deverão atender às especificações mínimas definidas neste instrumento, em conformidade com as normas técnicas pertinentes e a Política de Governança de TIC.",
    legalBasis:    "Art. 40, §1º, Lei 14.133/2021",
    priority:      7,
    appliesTo:     ["tic"],
    baseRelevance: 0.90,
  },
  {
    id:            "tmpl-005",
    type:          "body",
    title:         "Condições de Entrega",
    content:       "A entrega dos bens deverá ocorrer no prazo máximo de {{prazoEntrega}} dias úteis, contados da emissão da Ordem de Fornecimento, no local indicado pela Administração.",
    legalBasis:    "Art. 92, Lei 14.133/2021",
    priority:      6,
    appliesTo:     ["bem", "tic"],
    baseRelevance: 0.80,
  },
  {
    id:            "tmpl-006",
    type:          "body",
    title:         "Garantia dos Bens",
    content:       "Os bens fornecidos deverão ter garantia mínima de 12 (doze) meses contra defeitos de fabricação, assegurando-se a assistência técnica no local de instalação.",
    legalBasis:    "Art. 119, Lei 14.133/2021",
    priority:      5,
    appliesTo:     ["bem", "tic"],
    baseRelevance: 0.75,
  },
  {
    id:            "tmpl-007",
    type:          "price_ref",
    title:         "Condições de Pagamento",
    content:       "O pagamento será efetuado mediante apresentação de Nota Fiscal/Fatura devidamente atestada, no prazo de 30 (trinta) dias, observado o art. 141 da Lei nº 14.133/2021.",
    legalBasis:    "Art. 141, Lei 14.133/2021",
    priority:      5,
    appliesTo:     ["bem", "servico", "obra", "tic", "generico"],
    baseRelevance: 0.80,
  },
  {
    id:            "tmpl-008",
    type:          "body",
    title:         "Sustentabilidade Ambiental",
    content:       "A contratação observará critérios de sustentabilidade ambiental, nos termos do art. 11, §1º da Lei 14.133/2021 e demais normas ambientais aplicáveis.",
    legalBasis:    "Art. 11, §1º, Lei 14.133/2021",
    priority:      4,
    appliesTo:     ["bem", "servico", "obra", "generico"],
    baseRelevance: 0.60,
  },
];

// ─── Override store ───────────────────────────────────────────────────────────

interface ClauseOverrideRecord {
  itemId:        string;
  clauseId:      string;
  organizationId: number;
  actorUserId:   number;
  justification: string;
  newContent:    string;
  overriddenAt:  string;
}

const clauseOverrideStore = new Map<string, ClauseOverrideRecord>();

// ─── Router ───────────────────────────────────────────────────────────────────

export const clauseRouter = router({
  getRecommendations: protectedProcedure
    .input(z.object({
      itemId:         z.string(),
      organizationId: z.number(),
    }))
    .query(({ input }) => {
      // Mock item for recommendation
      const mockItem: ClauseItemInput = {
        id:                    input.itemId,
        normalizedDescription: "notebook computador equipamento ti processador",
        canonicalUnit:         "UN",
        catmatCode:            "CATMAT-001",
        catserCode:            null,
      };

      const procurementType = inferProcurementType(mockItem);

      const context: ClauseRecommendationContext = {
        procurementType,
        templates: DEMO_TEMPLATES,
        conditionals: [],
        semanticClauses: [
          {
            templateId:  "tmpl-004",
            matchTokens: ["computador", "notebook", "ti", "tecnologia"],
            bonus:       0.15,
          },
        ],
        compositionContext: {},
      };

      const recommendations: ClauseRecommendation[] = recommendClauses(mockItem, context);

      // Apply any stored overrides
      return recommendations.map(rec => {
        const overrideKey = `${input.itemId}:${rec.id}`;
        const override    = clauseOverrideStore.get(overrideKey);
        if (override) {
          return {
            ...rec,
            content:    override.newContent,
            isOverride: true,
            source:     "override" as const,
          };
        }
        return rec;
      });
    }),

  getTemplates: protectedProcedure
    .input(z.object({
      organizationId:  z.number(),
      procurementType: z.string().optional(),
    }))
    .query(({ input }) => {
      if (!input.procurementType) return DEMO_TEMPLATES;
      return DEMO_TEMPLATES.filter(t =>
        t.appliesTo.includes(input.procurementType as ClauseTemplate["appliesTo"][number]),
      );
    }),

  overrideClause: protectedProcedure
    .input(z.object({
      itemId:         z.string(),
      clauseId:       z.string(),
      organizationId: z.number(),
      actorUserId:    z.number(),
      justification:  z.string().min(5, "Justificativa deve ter no mínimo 5 caracteres"),
      newContent:     z.string().min(1, "Conteúdo da cláusula não pode estar vazio"),
    }))
    .mutation(({ input }) => {
      const overrideKey = `${input.itemId}:${input.clauseId}`;
      clauseOverrideStore.set(overrideKey, {
        itemId:         input.itemId,
        clauseId:       input.clauseId,
        organizationId: input.organizationId,
        actorUserId:    input.actorUserId,
        justification:  input.justification,
        newContent:     input.newContent,
        overriddenAt:   new Date().toISOString(),
      });
      return { success: true as const };
    }),
});

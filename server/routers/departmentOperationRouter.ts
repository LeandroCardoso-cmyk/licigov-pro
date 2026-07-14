/**
 * FASE 5 — Department Operation Router (Centro de Operações, operacional).
 *
 * Expõe as 5 áreas: Centro de Operações (dashboard), Painel de Acompanhamento,
 * Calendário, Timeline e Caixa de Entrada — além de indicadores, recomendações e
 * relatórios. Apenas consolida/acompanha/recomenda — nunca cria licitações/contratos/
 * pareceres. tenantProcedure, multi-tenant.
 */
import { z } from "zod";
import { router, tenantProcedure } from "../_core/trpc";
import {
  getDashboard, getMonitoringPanel, getCalendar, getTimeline, getInbox,
  getRecommendations, generateOperationalReport,
} from "../services/departmentOperationService";

/** Data de referência (hoje) para filtros de calendário/indicadores. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const REPORT_KINDS = ["operacional", "pendencias", "produtividade"] as const;

export const departmentOperationRouter = router({
  /** ÁREA 1 — Centro de Operações: indicadores + eventos de hoje e futuros. */
  dashboard: tenantProcedure
    .input(z.object({ today: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      return getDashboard({ organizationId: orgId, today: input?.today ?? todayIso() });
    }),

  /** Indicadores isolados (para o painel de indicadores). */
  indicators: tenantProcedure
    .input(z.object({ today: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const snapshot = await getDashboard({ organizationId: orgId, today: input?.today ?? todayIso() });
      return { indicators: snapshot.indicators };
    }),

  /** ÁREA 2 — Painel de Acompanhamento (substitui a planilha). */
  monitoringPanel: tenantProcedure
    .input(z.object({ today: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const rows = await getMonitoringPanel({ organizationId: orgId, today: input?.today ?? todayIso() });
      return { rows, total: rows.length };
    }),

  /** ÁREA 3 — Calendário Operacional (janela de datas). */
  calendar: tenantProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const events = await getCalendar({ organizationId: orgId, from: input.from, to: input.to });
      return { events, total: events.length };
    }),

  /** ÁREA 4 — Timeline Operacional (append-only). */
  timeline: tenantProcedure
    .input(z.object({ limit: z.number().min(1).max(500).optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const timeline = await getTimeline({ organizationId: orgId, limit: input?.limit ?? 100 });
      return { timeline, total: timeline.length };
    }),

  /** ÁREA 5 — Minha Caixa de Entrada. */
  inbox: tenantProcedure
    .query(async ({ ctx }) => {
      const orgId = ctx.organizationId!;
      return getInbox({ organizationId: orgId, userId: ctx.user.id });
    }),

  /** Recomendações operacionais (Adaptive Recommendation Engine). */
  recommendations: tenantProcedure
    .input(z.object({ today: z.string().optional() }).optional())
    .query(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      const recommendations = await getRecommendations({ organizationId: orgId, today: input?.today ?? todayIso() });
      return { recommendations, total: recommendations.length };
    }),

  /** Relatórios operacionais (DOCX/PDF). */
  generateReport: tenantProcedure
    .input(z.object({ kind: z.enum(REPORT_KINDS), today: z.string().optional() }))
    .mutation(async ({ input, ctx }) => {
      const orgId = ctx.organizationId!;
      return generateOperationalReport({ organizationId: orgId, kind: input.kind, today: input.today ?? todayIso() });
    }),
});

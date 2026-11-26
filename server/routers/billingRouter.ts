import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";
import { throwLegacyEndpointDisabled } from "../services/legacyEndpointGuard";

export const billingRouter = router({
  getPlans: publicProcedure
    .query(async () => {
      return await db.getAllSubscriptionPlans();
    }),

  getPlan: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      return await db.getSubscriptionPlanBySlug(input.slug);
    }),

  getMySubscription: protectedProcedure
    .query(async ({ ctx }) => {
      const subscription = await db.getUserSubscription(ctx.user.id);
      if (!subscription) return null;

      const plan = await db.getSubscriptionPlanById(subscription.planId);
      return { ...subscription, plan };
    }),

  getAllSubscriptions: protectedProcedure
    .query(async ({ ctx }) => {
      if (ctx.user.role !== "admin") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Acesso negado. Apenas administradores podem acessar.",
        });
      }
      return await db.getAllSubscriptionsWithDetails();
    }),

  getMyLimits: protectedProcedure
    .query(async ({ ctx }) => {
      const { getUserLimitsInfo } = await import('../middleware/limitsMiddleware');
      return await getUserLimitsInfo(ctx.user.id);
    }),

  /**
   * LICIGOV-LAUNCH-READY LR-07 — checkout por usuário (Stripe, teste grátis automático de 30 dias) RETIRADO da jornada
   * comercial ativa por decisão do Owner: o cliente é a organização pública, licenciada por proposta e procedimento
   * administrativo fora do LiciGov Pro. Nenhuma sessão de checkout/cliente Stripe é criada. O código Stripe
   * (`stripeService`, webhooks, tabelas) é preservado — não apagado.
   */
  createCheckoutSession: protectedProcedure
    .input(z.object({ planSlug: z.string(), successUrl: z.string(), cancelUrl: z.string() }))
    .mutation(({ ctx }) => throwLegacyEndpointDisabled(
      "billing.createCheckoutSession", "LR-07", ctx, "Solicitar proposta (/solicitar-proposta)",
    )),

  cancelSubscription: protectedProcedure
    .input(z.object({ immediately: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { cancelStripeSubscription } = await import('../services/stripeService');

      const subscription = await db.getUserSubscription(ctx.user.id);
      if (!subscription || !subscription.stripeSubscriptionId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Assinatura não encontrada' });
      }

      await cancelStripeSubscription({
        subscriptionId: subscription.stripeSubscriptionId,
        immediately: input.immediately || false,
      });

      await db.updateSubscription(subscription.id, {
        status: input.immediately ? 'canceled' : subscription.status,
        cancelAtPeriodEnd: !input.immediately,
        canceledAt: new Date(),
      });

      return { success: true };
    }),

  createBillingPortal: protectedProcedure
    .input(z.object({ returnUrl: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { createBillingPortalSession } = await import('../services/stripeService');

      const subscription = await db.getUserSubscription(ctx.user.id);
      if (!subscription || !subscription.stripeCustomerId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Assinatura não encontrada' });
      }

      const session = await createBillingPortalSession({
        customerId: subscription.stripeCustomerId,
        returnUrl: input.returnUrl,
      });

      return { portalUrl: session.url };
    }),

  getMyPayments: protectedProcedure
    .query(async ({ ctx }) => {
      return await db.getUserPayments(ctx.user.id);
    }),
});

import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "../db";

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

  createCheckoutSession: protectedProcedure
    .input(z.object({
      planSlug: z.string(),
      successUrl: z.string(),
      cancelUrl: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { createStripeCustomer, createCheckoutSession } = await import('../services/stripeService');

      const plan = await db.getSubscriptionPlanBySlug(input.planSlug);
      if (!plan || !plan.stripePriceId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Plano não encontrado' });
      }

      let subscription = await db.getUserSubscription(ctx.user.id);
      let customerId = subscription?.stripeCustomerId;

      if (!customerId) {
        const customer = await createStripeCustomer({
          email: ctx.user.email || '',
          name: ctx.user.name || '',
          metadata: { userId: ctx.user.id.toString() },
        });
        customerId = customer.id;
      }

      const session = await createCheckoutSession({
        customerId,
        priceId: plan.stripePriceId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        trialDays: 30,
        metadata: {
          userId: ctx.user.id.toString(),
          planId: plan.id.toString(),
        },
      });

      return { sessionUrl: session.url };
    }),

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

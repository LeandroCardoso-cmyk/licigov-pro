import Stripe from 'stripe';

// Inicializar Stripe em modo teste (trocar para live quando tiver conta empresarial)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2025-10-29.clover',
});

/**
 * Criar cliente Stripe para um usuário
 */
export async function createStripeCustomer(params: {
  email: string;
  name?: string;
  metadata?: Record<string, string>;
}): Promise<Stripe.Customer> {
  return await stripe.customers.create({
    email: params.email,
    name: params.name,
    metadata: params.metadata,
  });
}

/**
 * Criar assinatura Stripe
 */
export async function createStripeSubscription(params: {
  customerId: string;
  priceId: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}): Promise<Stripe.Subscription> {
  const subscriptionParams: Stripe.SubscriptionCreateParams = {
    customer: params.customerId,
    items: [{ price: params.priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
    metadata: params.metadata,
  };

  if (params.trialDays && params.trialDays > 0) {
    subscriptionParams.trial_period_days = params.trialDays;
  }

  return await stripe.subscriptions.create(subscriptionParams);
}

/**
 * Cancelar assinatura Stripe
 */
export async function cancelStripeSubscription(params: {
  subscriptionId: string;
  immediately?: boolean;
}): Promise<Stripe.Subscription> {
  if (params.immediately) {
    return await stripe.subscriptions.cancel(params.subscriptionId);
  } else {
    return await stripe.subscriptions.update(params.subscriptionId, {
      cancel_at_period_end: true,
    });
  }
}

/**
 * Atualizar assinatura Stripe (upgrade/downgrade)
 */
export async function updateStripeSubscription(params: {
  subscriptionId: string;
  newPriceId: string;
  prorationBehavior?: 'create_prorations' | 'none' | 'always_invoice';
}): Promise<Stripe.Subscription> {
  const subscription = await stripe.subscriptions.retrieve(params.subscriptionId);

  return await stripe.subscriptions.update(params.subscriptionId, {
    items: [
      {
        id: subscription.items.data[0].id,
        price: params.newPriceId,
      },
    ],
    proration_behavior: params.prorationBehavior || 'create_prorations',
  });
}

/**
 * Criar sessão de checkout Stripe
 */
export async function createCheckoutSession(params: {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
  metadata?: Record<string, string>;
}): Promise<Stripe.Checkout.Session> {
  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    customer: params.customerId,
    mode: 'subscription',
    line_items: [
      {
        price: params.priceId,
        quantity: 1,
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: params.metadata,
  };

  if (params.trialDays && params.trialDays > 0) {
    sessionParams.subscription_data = {
      trial_period_days: params.trialDays,
    };
  }

  return await stripe.checkout.sessions.create(sessionParams);
}

/**
 * Criar portal de billing Stripe (para gerenciar assinatura)
 */
export async function createBillingPortalSession(params: {
  customerId: string;
  returnUrl: string;
}): Promise<Stripe.BillingPortal.Session> {
  return await stripe.billingPortal.sessions.create({
    customer: params.customerId,
    return_url: params.returnUrl,
  });
}

/**
 * Obter assinatura Stripe
 */
export async function getStripeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  return await stripe.subscriptions.retrieve(subscriptionId);
}

/**
 * Listar faturas de um cliente
 */
export async function listCustomerInvoices(customerId: string): Promise<Stripe.Invoice[]> {
  const invoices = await stripe.invoices.list({
    customer: customerId,
    limit: 100,
  });

  return invoices.data;
}

/**
 * Verificar webhook signature (segurança)
 */
export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  secret: string
): Stripe.Event {
  return stripe.webhooks.constructEvent(payload, signature, secret);
}

/**
 * Criar produto e preço no Stripe (para setup inicial)
 */
export async function createStripeProduct(params: {
  name: string;
  description?: string;
  price: number; // Em centavos
  interval: 'month' | 'year';
  metadata?: Record<string, string>;
}): Promise<{ product: Stripe.Product; price: Stripe.Price }> {
  const product = await stripe.products.create({
    name: params.name,
    description: params.description,
    metadata: params.metadata,
  });

  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: params.price,
    currency: 'brl',
    recurring: {
      interval: params.interval,
    },
    metadata: params.metadata,
  });

  return { product, price };
}

export { stripe };

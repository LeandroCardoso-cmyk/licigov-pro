import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Plans() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const { data: plans, isLoading: plansLoading } = trpc.billing.getPlans.useQuery();
  const { data: mySubscription } = trpc.billing.getMySubscription.useQuery(undefined, {
    enabled: isAuthenticated,
  });
  const createCheckout = trpc.billing.createCheckoutSession.useMutation();

  const handleSubscribe = async (planSlug: string) => {
    if (!isAuthenticated) {
      toast.error("Faça login para assinar um plano");
      return;
    }

    try {
      const result = await createCheckout.mutateAsync({
        planSlug,
        successUrl: `${window.location.origin}/planos?success=true`,
        cancelUrl: `${window.location.origin}/planos?canceled=true`,
      });

      if (result.sessionUrl) {
        window.location.href = result.sessionUrl;
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar sessão de checkout");
    }
  };

  if (authLoading || plansLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const currentPlanId = mySubscription?.planId;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20 py-12 px-4">
      <div className="container max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Escolha seu plano</h1>
          <p className="text-xl text-muted-foreground">
            Planos flexíveis para órgãos públicos de todos os tamanhos
          </p>
        </div>

        {/* Plans Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans?.map((plan) => {
            const isCurrentPlan = plan.id === currentPlanId;
            const priceInReais = (plan.price / 100).toLocaleString("pt-BR", {
              style: "currency",
              currency: "BRL",
            });

            return (
              <Card
                key={plan.id}
                className={`relative ${isCurrentPlan ? "border-primary border-2" : ""}`}
              >
                {isCurrentPlan && (
                  <Badge className="absolute top-4 right-4">Plano Atual</Badge>
                )}

                <CardHeader>
                  <CardTitle className="text-2xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">{priceInReais}</span>
                    <span className="text-muted-foreground">/mês</span>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Limites */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span className="text-sm">
                        {plan.maxUsers === -1 ? "Usuários ilimitados" : `Até ${plan.maxUsers} usuários`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span className="text-sm">
                        {plan.maxProcessesPerMonth === -1
                          ? "Processos ilimitados"
                          : `${plan.maxProcessesPerMonth} processos/mês`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="h-4 w-4 text-primary" />
                      <span className="text-sm">
                        {plan.maxStorageGB === -1
                          ? "Armazenamento ilimitado"
                          : `${plan.maxStorageGB}GB de armazenamento`}
                      </span>
                    </div>
                  </div>

                  {/* Módulos */}
                  <div className="space-y-2 pt-4 border-t">
                    <p className="text-sm font-semibold">Módulos inclusos:</p>
                    {plan.hasDocumentGeneration && (
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        <span className="text-sm">Geração de Documentos</span>
                      </div>
                    )}
                    {plan.hasDirectContracting && (
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        <span className="text-sm">Contratação Direta</span>
                      </div>
                    )}
                    {plan.hasLegalOpinion && (
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        <span className="text-sm">Parecer Jurídico</span>
                      </div>
                    )}
                    {plan.hasPCA && (
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        <span className="text-sm">PCA</span>
                      </div>
                    )}
                    {plan.hasContracts && (
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        <span className="text-sm">Gestão de Contratos</span>
                      </div>
                    )}
                    {plan.hasDepartmentManagement && (
                      <div className="flex items-center gap-2">
                        <Check className="h-4 w-4 text-primary" />
                        <span className="text-sm">Gestão de Departamento</span>
                      </div>
                    )}
                  </div>

                  {/* Recursos */}
                  {(plan.hasCollaboration || plan.hasPrioritySupport || plan.hasSLA) && (
                    <div className="space-y-2 pt-4 border-t">
                      <p className="text-sm font-semibold">Recursos:</p>
                      {plan.hasCollaboration && (
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          <span className="text-sm">Colaboração</span>
                        </div>
                      )}
                      {plan.hasPrioritySupport && (
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          <span className="text-sm">Suporte Prioritário</span>
                        </div>
                      )}
                      {plan.hasSLA && (
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4 text-primary" />
                          <span className="text-sm">SLA 98%</span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>

                <CardFooter>
                  <Button
                    className="w-full"
                    variant={isCurrentPlan ? "outline" : "default"}
                    disabled={isCurrentPlan || createCheckout.isPending}
                    onClick={() => handleSubscribe(plan.slug)}
                  >
                    {createCheckout.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Processando...
                      </>
                    ) : isCurrentPlan ? (
                      "Plano Atual"
                    ) : (
                      "Assinar Agora"
                    )}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        {/* Trial Notice */}
        <div className="mt-12 text-center">
          <p className="text-muted-foreground">
            🎉 <strong>30 dias de teste grátis</strong> em todos os planos. Cancele quando quiser.
          </p>
        </div>
      </div>
    </div>
  );
}

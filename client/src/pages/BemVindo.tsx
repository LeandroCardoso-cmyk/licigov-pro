import { useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { APP_LOGO, APP_TITLE } from "@/const";
import { orgRoleLabel } from "@/utils/orgRoleLabels";
import { hasSeenWelcome, markWelcomeSeen } from "@/utils/welcomeGate";
import { CheckCircle2, Loader2 } from "lucide-react";

/**
 * PR A.1 (refinamento) — Tela de boas-vindas institucional. Aparece SÓ no primeiro acesso vindo do
 * fluxo de convite (AceitarConvite navega para cá após o aceite). Se já foi vista antes
 * (localStorage), redireciona direto ao início — nunca reaparece.
 */
export default function BemVindo() {
  const [, navigate] = useLocation();
  const alreadySeen = hasSeenWelcome(localStorage);

  const currentOrgQuery = trpc.organizations.getCurrent.useQuery(undefined, {
    enabled: !alreadySeen,
    retry: false,
  });

  useEffect(() => {
    if (alreadySeen) navigate("/dashboard");
  }, [alreadySeen, navigate]);

  const enter = () => {
    markWelcomeSeen(localStorage);
    navigate("/dashboard");
  };

  if (alreadySeen) return null;

  const orgName = currentOrgQuery.data?.org.nome;
  const role = currentOrgQuery.data?.role;

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url(/bg-architecture.jpg)", filter: "brightness(0.3)" }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background/40 to-accent/20" />

      <Card className="w-full max-w-md mx-4 relative z-10 shadow-2xl border-primary/20 text-center">
        <CardHeader className="space-y-4 pb-4">
          <div className="flex justify-center">
            <img src={APP_LOGO} alt={APP_TITLE} className="h-24 sm:h-28 w-auto drop-shadow-2xl" />
          </div>
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="h-7 w-7 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">Bem-vindo ao {APP_TITLE}</CardTitle>
          <CardDescription className="text-base">Sua conta foi criada com sucesso.</CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pb-8">
          {currentOrgQuery.isLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Você agora faz parte da organização</p>
                  <p className="text-lg font-semibold text-foreground mt-1">{orgName ?? "sua organização"}</p>
                </div>
                {role && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Perfil</p>
                    <Badge variant="secondary" className="mt-1">{orgRoleLabel(role)}</Badge>
                  </div>
                )}
              </div>
            </div>
          )}

          <Button className="w-full h-12 text-base font-semibold" size="lg" onClick={enter}>
            Entrar no sistema
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

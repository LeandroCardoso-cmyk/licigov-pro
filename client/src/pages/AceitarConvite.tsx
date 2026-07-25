import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_LOGO, APP_TITLE } from "@/const";
import { translateAuthError } from "@/utils/authErrorMessages";
import { resolveInviteView } from "@/utils/inviteState";
import { orgRoleLabel } from "@/utils/orgRoleLabels";

export default function AceitarConvite() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";
  const { user, loading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const validateQuery = trpc.invitations.validateToken.useQuery(
    { token },
    { enabled: token.length > 0, retry: false }
  );

  const acceptMutation = trpc.invitations.accept.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      navigate("/dashboard");
    },
    onError: (err) => setError(translateAuthError(err.message)),
  });

  const acceptExistingMutation = trpc.invitations.acceptExisting.useMutation({
    onSuccess: () => navigate("/dashboard"),
    onError: (err) => setError(translateAuthError(err.message)),
  });

  const view = resolveInviteView({
    isLoading: authLoading || (token.length > 0 && validateQuery.isLoading),
    data: token.length === 0 ? { valid: false, reason: "INVITATION_NOT_FOUND" } : validateQuery.data,
    currentUserEmail: user?.email ?? null,
  });

  const handleSubmitNewAccount = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    acceptMutation.mutate({ token, name, password });
  };

  const handleAcceptExisting = () => {
    setError("");
    acceptExistingMutation.mutate({ token });
  };

  const roleLabel = validateQuery.data?.role ? orgRoleLabel(validateQuery.data.role) : "";
  const organizationName = validateQuery.data?.organizationName ?? "";

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url(/bg-architecture.jpg)", filter: "brightness(0.3)" }}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background/40 to-accent/20" />

      <Card className="w-full max-w-md mx-4 relative z-10 shadow-2xl border-primary/20">
        <CardHeader className="space-y-4 text-center pb-6">
          <div className="flex justify-center mb-2">
            <img src={APP_LOGO} alt={APP_TITLE} className="h-32 sm:h-40 w-auto drop-shadow-2xl" />
          </div>
          <CardTitle className="text-3xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
            Convite institucional
          </CardTitle>
          {organizationName && view.kind !== "invalid" && (
            <CardDescription className="text-base">
              Você foi convidado para <strong>{organizationName}</strong> como {roleLabel}.
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="space-y-6 pb-8">
          {view.kind === "loading" && (
            <p className="text-sm text-center text-muted-foreground">Verificando o convite...</p>
          )}

          {view.kind === "invalid" && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-destructive bg-destructive/10 p-4 rounded-md">
                {translateAuthError(view.reason)}
              </p>
              <a href="/login" className="text-sm text-primary hover:underline font-medium">
                Ir para o login
              </a>
            </div>
          )}

          {view.kind === "email_mismatch" && (
            <div className="space-y-4 text-center">
              <p className="text-sm text-foreground bg-primary/10 p-4 rounded-md">
                Este convite foi enviado para <strong>{view.invitedEmail}</strong>, mas você está
                autenticado como <strong>{view.currentEmail}</strong>. Saia da conta atual e abra
                este link novamente, ou peça um novo convite para o e-mail correto.
              </p>
            </div>
          )}

          {view.kind === "accept_as_current_user" && (
            <div className="space-y-4">
              <p className="text-sm text-center text-muted-foreground">
                Você já está autenticado como <strong>{user?.email}</strong>. Confirme para entrar
                nesta organização com a conta atual.
              </p>
              {error && (
                <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</p>
              )}
              <Button
                type="button"
                className="w-full h-12 text-base font-semibold shadow-lg hover:shadow-xl transition-all"
                size="lg"
                disabled={acceptExistingMutation.isPending}
                onClick={handleAcceptExisting}
              >
                {acceptExistingMutation.isPending ? "Aceitando..." : "Aceitar convite"}
              </Button>
            </div>
          )}

          {view.kind === "create_account" && (
            <form onSubmit={handleSubmitNewAccount} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome completo</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Seu nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Criar senha</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full h-12 text-base font-semibold shadow-lg hover:shadow-xl transition-all"
                size="lg"
                disabled={acceptMutation.isPending}
              >
                {acceptMutation.isPending ? "Criando conta..." : "Criar conta e entrar"}
              </Button>

              <p className="text-sm text-center text-muted-foreground">
                Já tem uma conta?{" "}
                <a href={`/login?returnTo=${encodeURIComponent(`/convite?token=${token}`)}`} className="text-primary hover:underline font-medium">
                  Faça login
                </a>{" "}
                para aceitar com a conta existente.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

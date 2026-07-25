import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_LOGO, APP_TITLE } from "@/const";
import { translateAuthError } from "@/utils/authErrorMessages";

export default function RedefinirSenha() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const token = new URLSearchParams(search).get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const validateQuery = trpc.passwordReset.validateToken.useQuery(
    { token },
    { enabled: token.length > 0, retry: false }
  );

  const completeMutation = trpc.passwordReset.complete.useMutation({
    onSuccess: () => {
      // A sessão anterior (se existisse) já caiu no servidor (tokenVersion bumpado) — login novo.
      navigate("/login");
    },
    onError: (err) => setError(translateAuthError(err.message)),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    completeMutation.mutate({ token, newPassword: password });
  };

  const tokenMissing = token.length === 0;
  const tokenInvalid = !validateQuery.isLoading && validateQuery.data?.valid === false;

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
            Redefinir senha
          </CardTitle>
          {!tokenMissing && !tokenInvalid && (
            <CardDescription className="text-base">Escolha uma nova senha para sua conta.</CardDescription>
          )}
        </CardHeader>

        <CardContent className="space-y-6 pb-8">
          {tokenMissing || tokenInvalid ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-destructive bg-destructive/10 p-4 rounded-md">
                {tokenMissing
                  ? "Link de redefinição inválido — falta o token."
                  : translateAuthError(validateQuery.data?.reason)}
              </p>
              <a href="/esqueci-senha" className="text-sm text-primary hover:underline font-medium">
                Solicitar um novo link
              </a>
            </div>
          ) : validateQuery.isLoading ? (
            <p className="text-sm text-center text-muted-foreground">Verificando o link...</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="password">Nova senha</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  autoFocus
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="Repita a senha"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
                disabled={completeMutation.isPending}
              >
                {completeMutation.isPending ? "Salvando..." : "Redefinir senha"}
              </Button>

              <p className="text-xs text-center text-muted-foreground px-4">
                Ao redefinir, todas as sessões abertas com a senha anterior serão encerradas.
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

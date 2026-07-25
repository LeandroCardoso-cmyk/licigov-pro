import { useState } from "react";
import { useLocation, useSearch } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_DESCRIPTION, APP_LOGO, APP_TITLE } from "@/const";
import { isSafeReturnTo } from "@/utils/safeReturnTo";

export default function Login() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const utils = trpc.useUtils();

  // PR A.1 — se o usuário chegou aqui via redirect de sessão expirada (ex.: no meio do aceite de
  // um convite), volta para lá depois de logar em vez de sempre ir para /dashboard.
  const returnToParam = new URLSearchParams(search).get("returnTo");
  const destination = isSafeReturnTo(returnToParam) ? returnToParam : "/dashboard";

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      navigate(destination);
    },
    onError: (err) => {
      setError(err.message || "Erro ao fazer login. Tente novamente.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    loginMutation.mutate({ email, password });
  };

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
            {APP_TITLE}
          </CardTitle>
          <CardDescription className="text-base">
            {APP_DESCRIPTION}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pb-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                placeholder="seu@email.com.br"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                <a href="/esqueci-senha" className="text-xs text-primary hover:underline">
                  Esqueci minha senha
                </a>
              </div>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</p>
            )}

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold shadow-lg hover:shadow-xl transition-all"
              size="lg"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? "Entrando..." : "Entrar"}
            </Button>
          </form>

          <p className="text-sm text-center text-muted-foreground">
            Não tem conta?{" "}
            <a href="/register" className="text-primary hover:underline font-medium">
              Criar conta
            </a>
          </p>

          <p className="text-xs text-center text-muted-foreground px-4">
            Ao continuar, você concorda com nossos Termos de Serviço e Política de Privacidade
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

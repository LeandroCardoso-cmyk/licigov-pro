import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_LOGO, APP_TITLE } from "@/const";

export default function Register() {
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const utils = trpc.useUtils();

  const registerMutation = trpc.auth.register.useMutation({
    onSuccess: () => {
      utils.auth.me.invalidate();
      navigate("/dashboard");
    },
    onError: (err) => {
      setError(err.message || "Erro ao criar conta. Tente novamente.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    registerMutation.mutate({ name, email, password });
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
            Criar conta
          </CardTitle>
          <CardDescription className="text-base">
            {APP_TITLE} — Automação de processos licitatórios
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pb-8">
          <form onSubmit={handleSubmit} className="space-y-4">
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
              />
            </div>

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
              <Label htmlFor="password">Senha</Label>
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
              disabled={registerMutation.isPending}
            >
              {registerMutation.isPending ? "Criando conta..." : "Criar conta"}
            </Button>
          </form>

          <p className="text-sm text-center text-muted-foreground">
            Já tem conta?{" "}
            <a href="/login" className="text-primary hover:underline font-medium">
              Entrar
            </a>
          </p>

          <p className="text-xs text-center text-muted-foreground px-4">
            Ao criar sua conta, você concorda com nossos Termos de Serviço e Política de Privacidade
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

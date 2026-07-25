import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_LOGO, APP_TITLE } from "@/const";
import { translateAuthError } from "@/utils/authErrorMessages";

export default function EsqueciSenha() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  // PR A.1 — anti-enumeração: o backend SEMPRE responde {success:true}, quer o e-mail exista ou
  // não. A UI não deve (e não pode) diferenciar os dois casos.
  const requestMutation = trpc.passwordReset.request.useMutation({
    onError: (err) => setError(translateAuthError(err.message)),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    requestMutation.mutate({ email });
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
            Esqueci minha senha
          </CardTitle>
          <CardDescription className="text-base">
            Informe seu e-mail institucional e enviaremos um link para redefinir sua senha.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pb-8">
          {requestMutation.isSuccess ? (
            <div className="space-y-4 text-center">
              <p className="text-sm text-foreground bg-primary/10 p-4 rounded-md">
                Se este e-mail estiver cadastrado, você receberá um link de redefinição em instantes.
                Verifique também a caixa de spam.
              </p>
              <a href="/login" className="text-sm text-primary hover:underline font-medium">
                Voltar para o login
              </a>
            </div>
          ) : (
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
                  autoFocus
                />
              </div>

              {error && (
                <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full h-12 text-base font-semibold shadow-lg hover:shadow-xl transition-all"
                size="lg"
                disabled={requestMutation.isPending}
              >
                {requestMutation.isPending ? "Enviando..." : "Enviar link de redefinição"}
              </Button>

              <p className="text-sm text-center text-muted-foreground">
                Lembrou a senha?{" "}
                <a href="/login" className="text-primary hover:underline font-medium">
                  Voltar para o login
                </a>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

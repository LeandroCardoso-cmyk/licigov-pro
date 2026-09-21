import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import * as React from "react";

/**
 * PasswordInput — campo de senha canônico com toggle ACESSÍVEL de mostrar/ocultar.
 *
 * Compõe sobre o `Input` (shadcn) — NÃO altera arquitetura de auth, hashing, JWT, rate limiting,
 * política de senha ou reset. O toggle é EXCLUSIVAMENTE visual/local: alterna `type` password↔text
 * sem tocar no valor (nunca loga, persiste, envia a analytics ou expõe em URL/eventos). Todos os
 * demais props (`value`, `onChange`, `autoComplete`, `id`, `required`, `placeholder`, `minLength`,
 * `disabled`, `autoFocus`, …) são repassados intactos ao input — cada call-site preserva o seu
 * `autoComplete` correto (current-password no login; new-password em criação/reset).
 *
 * Acessibilidade: botão `type="button"` (não submete o form), `aria-label` dinâmico
 * ("Mostrar senha"/"Ocultar senha"), `aria-pressed`, alvo de toque adequado, foco por teclado
 * (herda o focus-state do Button via tokens), ícone `aria-hidden`. Estado é por instância — dois
 * campos (senha + confirmação) têm toggles independentes.
 */
function PasswordInput({ className, ...props }: React.ComponentProps<"input">) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={show ? "text" : "password"}
        className={cn("pr-10", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        aria-pressed={show}
        className="absolute right-0 top-0 h-full px-3 text-muted-foreground hover:text-foreground"
      >
        {show ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

export { PasswordInput };

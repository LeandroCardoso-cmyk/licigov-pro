import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Hook para atalhos de teclado de navegação
 * 
 * Atalhos implementados:
 * - ESC: Volta para a página anterior (history.back)
 * - Ctrl+Home / Cmd+Home: Vai para o dashboard
 * 
 * Uso: Adicione `useKeyboardNavigation()` no componente raiz (App.tsx)
 */
export function useKeyboardNavigation() {
  const [, navigate] = useLocation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignorar se estiver em um input, textarea ou contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      // ESC: Voltar para página anterior
      if (e.key === "Escape") {
        e.preventDefault();
        if (window.history.length > 1) {
          window.history.back();
        } else {
          navigate("/dashboard");
        }
      }

      // Ctrl+Home ou Cmd+Home: Ir para dashboard
      if ((e.ctrlKey || e.metaKey) && e.key === "Home") {
        e.preventDefault();
        navigate("/dashboard");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);
}

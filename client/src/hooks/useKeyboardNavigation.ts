import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Superfícies que tratam o próprio ESC (fechar): diálogos Radix/shadcn, drawers próprios (`role="dialog"`, ex.: painel do item)
 * e revisões inline de decisões (`role="dialog"`). Enquanto uma delas estiver aberta, ESC pertence a ela — nunca à navegação.
 */
export const ESCAPE_OWNER_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';

/** Campos de edição: ESC ali é do campo (desfazer/fechar sugestões), não da navegação. */
const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

export interface EscapeNavigationInput {
  readonly key: string;
  /** Já tratado por outra camada (o Radix chama `preventDefault()` ao fechar na fase de captura). */
  readonly defaultPrevented: boolean;
  /** Composição IME em curso: ESC cancela a composição. */
  readonly isComposing?: boolean;
  readonly targetTagName?: string | null;
  readonly targetIsContentEditable?: boolean;
  /** Há superfície aberta dona do ESC (ver `ESCAPE_OWNER_SELECTOR`). */
  readonly hasOpenEscapeOwner: boolean;
}

/**
 * M8 (homologação visual) — ESC só navega ("Voltar") quando NADA mais o reivindica. Antes, o atalho global rodava
 * `history.back()` mesmo com diálogo aberto: o diálogo fechava E o usuário saía do processo (o painel do item levava ao
 * /dashboard). Regra pura, testável sem DOM.
 */
export function shouldNavigateOnEscape(e: EscapeNavigationInput): boolean {
  if (e.key !== "Escape") return false;
  if (e.defaultPrevented || e.isComposing) return false;
  if (e.targetIsContentEditable) return false;
  if (e.targetTagName && EDITABLE_TAGS.has(e.targetTagName.toUpperCase())) return false;
  return !e.hasOpenEscapeOwner;
}

function hasOpenEscapeOwner(doc: Document): boolean {
  return doc.querySelector(ESCAPE_OWNER_SELECTOR) !== null;
}

/**
 * Hook para atalhos de teclado de navegação
 *
 * Atalhos implementados:
 * - ESC: Volta para a página anterior (history.back) — só quando nenhum diálogo/drawer/campo reivindica o ESC
 * - Ctrl+Home / Cmd+Home: Vai para o dashboard
 *
 * Uso: Adicione `useKeyboardNavigation()` no componente raiz (App.tsx)
 */
export function useKeyboardNavigation() {
  const [, navigate] = useLocation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;

      // ESC: Voltar para página anterior (nunca junto com o fechamento de um diálogo)
      if (e.key === "Escape") {
        if (!shouldNavigateOnEscape({
          key: e.key, defaultPrevented: e.defaultPrevented, isComposing: e.isComposing,
          targetTagName: target?.tagName ?? null, targetIsContentEditable: !!target?.isContentEditable,
          hasOpenEscapeOwner: hasOpenEscapeOwner(document),
        })) return;
        e.preventDefault();
        if (window.history.length > 1) {
          window.history.back();
        } else {
          navigate("/dashboard");
        }
        return;
      }

      // Ignorar se estiver em um input, textarea ou contenteditable
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
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

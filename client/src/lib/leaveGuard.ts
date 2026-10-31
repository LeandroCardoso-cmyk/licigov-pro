/**
 * Pós-homologação (Frente A) — proteção de edição não salva na navegação do SHELL (menu lateral, Sair).
 *
 * A tela com edição pendente registra uma mensagem enquanto há algo a perder; o shell consulta antes de trocar de rota.
 * Sem registro ⇒ segue sem perguntar. Com registro ⇒ UMA única confirmação (cancelar = permanecer, nada é descartado).
 * Não salva, não aprova e não altera nada: só decide se a navegação prossegue.
 */
import { useEffect } from "react";

type LeaveGuard = () => string | null;

const guards = new Set<LeaveGuard>();

/** Registra uma guarda; devolve a função que a remove. */
export function registerLeaveGuard(guard: LeaveGuard): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

/** Mensagem da primeira guarda com edição pendente (null = nada a perder). */
export function pendingLeaveMessage(): string | null {
  for (const guard of Array.from(guards)) {
    const message = guard();
    if (message) return message;
  }
  return null;
}

/** A navegação do shell pode prosseguir? Pergunta no máximo uma vez, mesmo com várias guardas pendentes. */
export function confirmPendingLeave(confirm: (message: string) => boolean = (m) => window.confirm(m)): boolean {
  const message = pendingLeaveMessage();
  return message === null || confirm(message);
}

const SENTINEL = "__licigovLeaveGuard";

type HistoryLike = { readonly state: unknown; pushState(data: unknown, unused: string): void; back(): void; forward(): void };
export type LeaveWindow = {
  readonly history: HistoryLike;
  addEventListener(type: "popstate" | "beforeunload", listener: (e: Event) => void): void;
  removeEventListener(type: "popstate" | "beforeunload", listener: (e: Event) => void): void;
};

const isSentinel = (state: unknown) => !!state && typeof state === "object" && (state as Record<string, unknown>)[SENTINEL] === true;

/**
 * Protege a tela enquanto há edição pendente:
 *  - recarregar/fechar a aba ⇒ o navegador pede confirmação (`beforeunload`);
 *  - botão Voltar ⇒ uma entrada-sentinela no histórico (mesma URL) absorve o primeiro "voltar": pergunta UMA vez; cancelar volta
 *    à sentinela (`forward`, a URL atual é preservada); confirmar segue o "voltar" de verdade (sem novo aviso do navegador).
 * Devolve a função que desfaz a proteção (a sentinela que sobrar só custa um "voltar" sem efeito).
 */
export function installLeaveProtection(win: LeaveWindow, confirm: (message: string) => boolean): () => void {
  let leaving = false;
  if (!isSentinel(win.history.state)) {
    const base = win.history.state && typeof win.history.state === "object" ? win.history.state as Record<string, unknown> : {};
    win.history.pushState({ ...base, [SENTINEL]: true }, "");
  }
  const onPopState = () => {
    if (leaving || isSentinel(win.history.state)) return;
    if (confirmPendingLeave(confirm)) { leaving = true; win.history.back(); return; }
    win.history.forward();
  };
  const onBeforeUnload = (e: Event) => {
    if (leaving || pendingLeaveMessage() === null) return;
    e.preventDefault();
    (e as BeforeUnloadEvent).returnValue = "";
  };
  win.addEventListener("popstate", onPopState);
  win.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    win.removeEventListener("popstate", onPopState);
    win.removeEventListener("beforeunload", onBeforeUnload);
  };
}

/**
 * Mantém a guarda registrada enquanto `message` não for null (a tela informa o que seria perdido): menu lateral/Sair (shell),
 * recarregar/fechar e Voltar do navegador usam a MESMA mensagem, uma confirmação por saída.
 */
export function useLeaveGuard(message: string | null): void {
  useEffect(() => {
    if (!message) return;
    const unregister = registerLeaveGuard(() => message);
    const uninstall = typeof window === "undefined" ? () => {} : installLeaveProtection(window, (m) => window.confirm(m));
    return () => { uninstall(); unregister(); };
  }, [message]);
}

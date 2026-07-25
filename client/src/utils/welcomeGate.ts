/**
 * PR A.1 (refinamento) — Controle de exibição única da tela de boas-vindas institucional.
 * A tela aparece APENAS no primeiro acesso vindo do fluxo de convite; depois de vista, nunca mais.
 * Lógica pura (recebe um storage injetável) para ser testável sem DOM.
 */

export const WELCOME_SEEN_KEY = "licigov:welcomeSeen";

export function hasSeenWelcome(storage: Pick<Storage, "getItem">): boolean {
  try {
    return storage.getItem(WELCOME_SEEN_KEY) === "true";
  } catch {
    return false; // storage indisponível → trata como não visto (falha aberta é inofensiva aqui)
  }
}

export function markWelcomeSeen(storage: Pick<Storage, "setItem">): void {
  try {
    storage.setItem(WELCOME_SEEN_KEY, "true");
  } catch {
    /* storage indisponível — ignorar; no pior caso a tela reaparece uma vez */
  }
}

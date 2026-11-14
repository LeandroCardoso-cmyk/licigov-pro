/**
 * Estado do navegador que pertence à SESSÃO (usuário/tenant), não ao dispositivo. Some no logout e no login de um novo
 * usuário: numa estação compartilhada (comum em prefeituras), o próximo usuário não herda a organização selecionada pelo
 * anterior, nem o perfil, nem o histórico de rotas (LGPD). Preferências do dispositivo (tema, largura do menu, dicas já
 * vistas) permanecem. O backend continua sendo a autoridade de tenant e permissões; isto só evita herança indevida.
 * Lógica pura (storage injetável) para ser testável sem DOM.
 */
import { SELECTED_ORGANIZATION_ID_STORAGE_KEY } from "@/const";

export const SESSION_SCOPED_STORAGE_KEYS = [
  SELECTED_ORGANIZATION_ID_STORAGE_KEY,
  // Legado: perfil do usuário gravado por versões anteriores (nunca lido); removido para não ficar em repouso.
  "licigov-user-info",
  "navigationHistory",
] as const;

export function clearSessionScopedState(storage: Pick<Storage, "removeItem"> | null | undefined): void {
  if (!storage) return;
  for (const key of SESSION_SCOPED_STORAGE_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      /* storage indisponível — nada a limpar */
    }
  }
}

/** `localStorage` quando acessível (pode lançar em modo privado ou com dados bloqueados). */
export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

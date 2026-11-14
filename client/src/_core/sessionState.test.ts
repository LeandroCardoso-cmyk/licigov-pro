/**
 * Estado de sessão no navegador: some no logout e no login (estação compartilhada; LGPD). Preferências permanecem.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { clearSessionScopedState, SESSION_SCOPED_STORAGE_KEYS } from "./sessionState";
import { SELECTED_ORGANIZATION_ID_STORAGE_KEY } from "@/const";

function fakeStorage(initial: Record<string, string>) {
  const m = new Map(Object.entries(initial));
  return { m, removeItem: (k: string) => { m.delete(k); } };
}
const read = (rel: string) => readFileSync(path.resolve(rel), "utf8");

describe("clearSessionScopedState", () => {
  it("remove exatamente a organização selecionada, o perfil legado e o histórico", () => {
    const s = fakeStorage({
      [SELECTED_ORGANIZATION_ID_STORAGE_KEY]: "2", "licigov-user-info": "{\"email\":\"x\"}", navigationHistory: "[]",
      theme: "dark", "sidebar-width": "280", hasSeenKeyboardShortcuts: "true", "licigov:welcomeSeen": "true",
    });
    clearSessionScopedState(s);
    expect([...s.m.keys()].sort()).toEqual(["hasSeenKeyboardShortcuts", "licigov:welcomeSeen", "sidebar-width", "theme"]);
    expect(SESSION_SCOPED_STORAGE_KEYS).toContain(SELECTED_ORGANIZATION_ID_STORAGE_KEY);
  });
  it("storage indisponível ou que lança não quebra o logout", () => {
    expect(() => clearSessionScopedState(null)).not.toThrow();
    expect(() => clearSessionScopedState({ removeItem: () => { throw new Error("bloqueado"); } })).not.toThrow();
  });
  it("logout e login limpam o estado de sessão; o perfil do usuário não é mais gravado no navegador", () => {
    const auth = read("client/src/_core/hooks/useAuth.ts");
    expect(auth).toMatch(/finally \{[\s\S]*?clearSessionScopedState\(browserStorage\(\)\)/);
    expect(auth).not.toMatch(/setItem\("licigov-user-info"/);
    const login = read("client/src/pages/Login.tsx");
    expect(login.indexOf("clearSessionScopedState(browserStorage())")).toBeGreaterThan(-1);
    expect(login.indexOf("clearSessionScopedState(browserStorage())")).toBeLessThan(login.indexOf("navigate(destination)"));
  });
});

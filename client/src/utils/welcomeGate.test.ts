/**
 * PR A.1 (homologação — Seção 5/8) — welcomeGate: exibição única da tela de boas-vindas.
 */

import { describe, it, expect } from "vitest";
import { WELCOME_SEEN_KEY, hasSeenWelcome, markWelcomeSeen } from "./welcomeGate";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    _map: map,
  };
}

describe("welcomeGate", () => {
  it("primeira vez: hasSeenWelcome=false; após markWelcomeSeen=true (não reaparece)", () => {
    const s = fakeStorage();
    expect(hasSeenWelcome(s)).toBe(false);
    markWelcomeSeen(s);
    expect(hasSeenWelcome(s)).toBe(true);
    expect(s._map.get(WELCOME_SEEN_KEY)).toBe("true");
  });

  it("valor diferente de 'true' conta como não visto", () => {
    expect(hasSeenWelcome(fakeStorage({ [WELCOME_SEEN_KEY]: "1" }))).toBe(false);
  });

  it("storage que lança em getItem/setItem não quebra (falha aberta inofensiva)", () => {
    const throwing = {
      getItem: () => { throw new Error("no storage"); },
      setItem: () => { throw new Error("no storage"); },
    };
    expect(hasSeenWelcome(throwing)).toBe(false);
    expect(() => markWelcomeSeen(throwing)).not.toThrow();
  });
});

/**
 * C.4B.2 (hardening) — Pin do review snapshot na confirmação de emissão oficial.
 *
 * Prova o contrato: o hash EMITIDO é o hash REVISADO/CONFIRMADO (pinado), nunca o estado mutável no
 * clique final. Se o rascunho mudar entre "Emitir" e "Confirmar", a confirmação é invalidada, NENHUMA
 * emissão é disparada e uma nova confirmação explícita passa a ser exigida. Testado sobre a primitive
 * pura (padrão do projeto — sem jsdom/testing-library).
 */
import { describe, it, expect } from "vitest";
import { pinReviewSnapshot, confirmationInvalidated } from "./reviewSnapshotPin";

const A = { id: "gd-1", title: "ETP — X", content: "conteúdo A", contentHash: "a".repeat(64), updatedAt: "2026-08-25T12:00:00.000Z" };
const B = { id: "gd-1", title: "ETP — X", content: "conteúdo B DIFERENTE", contentHash: "b".repeat(64), updatedAt: "2026-08-26T09:00:00.000Z" };

/** Modelo da decisão do clique final "Confirmar": só emite se a confirmação pinada NÃO foi invalidada. */
function wouldEmit(pinned: ReturnType<typeof pinReviewSnapshot>, current: { contentHash: string } | null) {
  if (!pinned) return { emit: false, expectedContentHash: null as string | null };
  if (confirmationInvalidated(pinned, current)) return { emit: false, expectedContentHash: null };
  return { emit: true, expectedContentHash: pinned.contentHash };
}

describe("C.4B.2 (hardening) — pin do review snapshot na confirmação", () => {
  it("pina apenas a IDENTIDADE mínima (id, contentHash, updatedAt) — não o conteúdo inteiro", () => {
    const pin = pinReviewSnapshot(A);
    expect(pin).toEqual({ id: A.id, contentHash: A.contentHash, updatedAt: A.updatedAt });
    expect(pin as unknown as { content?: string }).not.toHaveProperty("content");
  });

  it("sem snapshot vigente → pin nulo", () => {
    expect(pinReviewSnapshot(null)).toBeNull();
    expect(pinReviewSnapshot(undefined)).toBeNull();
  });

  it("fluxo: A confirmado → draft muda para B → confirmação A invalidada, NADA emitido, exige nova confirmação", () => {
    // 1. snapshot A entra em confirmação (pin).
    const pinA = pinReviewSnapshot(A);
    expect(pinA).not.toBeNull();

    // 2/3. reviewSnapshot muda para B antes do clique final → confirmação A é invalidada.
    expect(confirmationInvalidated(pinA, B)).toBe(true);

    // 4. o clique final NÃO dispara emissão (nenhum expectedContentHash produzido).
    const attempt = wouldEmit(pinA, B);
    expect(attempt.emit).toBe(false);
    expect(attempt.expectedContentHash).toBeNull();

    // 5. nova confirmação é necessária para B: repinar B e então emitir usa o hash de B.
    const pinB = pinReviewSnapshot(B);
    expect(confirmationInvalidated(pinB, B)).toBe(false);
    const emitB = wouldEmit(pinB, B);
    expect(emitB.emit).toBe(true);
    expect(emitB.expectedContentHash).toBe(B.contentHash);
  });

  it("snapshot inalterado (A permanece A) → não invalida; emite com o HASH PINADO", () => {
    const pinA = pinReviewSnapshot(A);
    expect(confirmationInvalidated(pinA, A)).toBe(false);
    const emit = wouldEmit(pinA, A);
    expect(emit.emit).toBe(true);
    expect(emit.expectedContentHash).toBe(A.contentHash); // hash revisado, não o mutável
  });

  it("snapshot some durante a confirmação → invalida (nada emitido)", () => {
    const pinA = pinReviewSnapshot(A);
    expect(confirmationInvalidated(pinA, null)).toBe(true);
    expect(wouldEmit(pinA, null).emit).toBe(false);
  });

  it("sem confirmação pinada → nada a invalidar (não bloqueia estado normal)", () => {
    expect(confirmationInvalidated(null, A)).toBe(false);
    expect(confirmationInvalidated(null, null)).toBe(false);
  });
});

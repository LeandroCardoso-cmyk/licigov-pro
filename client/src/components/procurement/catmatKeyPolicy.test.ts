import { describe, it, expect } from "vitest";
import {
  catmatPayloadFingerprint, isRetryableCatmatError, selectCatmatKey,
  type CatmatDecisionPayload, type CatmatKeyState,
} from "./catmatKeyPolicy";

describe("catmatKeyPolicy — idempotency key por tentativa lógica", () => {
  let n = 0;
  const gen = () => `key-${++n}`;
  const base: CatmatDecisionPayload = { itemId: "i1", decision: "rejeitado", suggestionId: "s1", justification: "não serve" };

  it("A) primeira tentativa gera uma key nova vinculada ao fingerprint", () => {
    const fp = catmatPayloadFingerprint(base);
    const st = selectCatmatKey(null, fp, false, gen);
    expect(st.key).toBeTruthy();
    expect(st.fingerprint).toBe(fp);
  });

  it("B+C) erro TRANSITÓRIO com MESMO payload → mesma key (retry replay-safe)", () => {
    const fp = catmatPayloadFingerprint(base);
    const first: CatmatKeyState = selectCatmatKey(null, fp, false, gen);
    // erro transitório (INTERNAL_SERVER_ERROR / rede) ⇒ retryable
    expect(isRetryableCatmatError("INTERNAL_SERVER_ERROR")).toBe(true);
    expect(isRetryableCatmatError(undefined)).toBe(true);
    const retry = selectCatmatKey(first, fp, true, gen);
    expect(retry.key).toBe(first.key); // MESMA key ⇒ backend faz replay, sem 2ª entrada no ledger
  });

  it("D) mudança de payload/decisão → nova logical attempt, nova key", () => {
    const fp1 = catmatPayloadFingerprint(base);
    const first = selectCatmatKey(null, fp1, false, gen);
    const changed: CatmatDecisionPayload = { ...base, decision: "substituido", catmatCode: "123", suggestionId: undefined };
    const fp2 = catmatPayloadFingerprint(changed);
    expect(fp2).not.toBe(fp1);
    const next = selectCatmatKey(first, fp2, true, gen); // mesmo "retryable", mas payload mudou
    expect(next.key).not.toBe(first.key);
  });

  it("E) erro de validação/negócio (BAD_REQUEST/CONFLICT) NÃO reutiliza — próxima é nova tentativa", () => {
    expect(isRetryableCatmatError("BAD_REQUEST")).toBe(false);
    expect(isRetryableCatmatError("CONFLICT")).toBe(false);
    expect(isRetryableCatmatError("FORBIDDEN")).toBe(false);
    const fp = catmatPayloadFingerprint(base);
    const first = selectCatmatKey(null, fp, false, gen);
    const afterValidation = selectCatmatKey(first, fp, /*retryable*/ false, gen);
    expect(afterValidation.key).not.toBe(first.key);
  });

  it("catmatDescription participa do fingerprint: descrição diferente → nova logical attempt", () => {
    const p1: CatmatDecisionPayload = { itemId: "i1", decision: "substituido", catmatCode: "888", catmatDescription: "desc A", justification: "manual" };
    const p2: CatmatDecisionPayload = { ...p1, catmatDescription: "desc B" };
    expect(catmatPayloadFingerprint(p1)).not.toBe(catmatPayloadFingerprint(p2));
    const first = selectCatmatKey(null, catmatPayloadFingerprint(p1), false, gen);
    const next = selectCatmatKey(first, catmatPayloadFingerprint(p2), true, gen);
    expect(next.key).not.toBe(first.key);
  });

  it("sucesso rotaciona: a próxima ação idêntica parte de prev=null → nova key", () => {
    const fp = catmatPayloadFingerprint(base);
    const first = selectCatmatKey(null, fp, false, gen);
    // após sucesso a UI limpa o estado (prev=null) ⇒ mesma decisão repetida ganha key nova
    const afterSuccess = selectCatmatKey(null, fp, true, gen);
    expect(afterSuccess.key).not.toBe(first.key);
  });
});

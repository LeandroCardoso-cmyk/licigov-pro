/**
 * PR B.2.2 — Testes do SHA-256 do cliente (Web Crypto) e da chave idempotente.
 * Usa o `crypto` global (Node 20+ expõe Web Crypto). O servidor é a autoridade do checksum.
 */
import { describe, it, expect } from "vitest";
import { sha256HexOfText, sha256HexOfBlob, newIdempotencyKey } from "./sha256";

describe("sha256HexOfText", () => {
  it('"abc" → vetor conhecido', async () => {
    expect(await sha256HexOfText("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("string vazia → vetor conhecido", async () => {
    expect(await sha256HexOfText("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("sha256HexOfBlob", () => {
  it("Blob de texto casa com o hash do texto (bytes UTF-8)", async () => {
    const blob = new Blob(["abc"], { type: "text/csv" });
    expect(await sha256HexOfBlob(blob)).toBe(await sha256HexOfText("abc"));
  });
});

describe("newIdempotencyKey", () => {
  it("gera chave 8–64 chars com prefixo, e única entre chamadas", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a.startsWith("ing_")).toBe(true);
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a).not.toBe(b);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../_core/env", () => ({
  ENV: { geminiApiKey: "test-gemini-key" },
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
}));

import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  buildEmbeddingCacheKey,
  generateEmbedding,
  isCompatibleCachedEmbedding,
  isValidEmbeddingVector,
} from "../embeddings";

function vector(value = 0.25): number[] {
  return Array.from({ length: EMBEDDING_DIM }, () => value);
}

describe("F-EMB1 embeddings", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fixa o espaço vetorial canônico em gemini-embedding-2 / 768", () => {
    expect(EMBEDDING_MODEL).toBe("gemini-embedding-2");
    expect(EMBEDDING_DIM).toBe(768);
  });

  it("gera identidade de cache determinística e normalizada", () => {
    const a = buildEmbeddingCacheKey("  Lei 14.133/2021  ");
    const b = buildEmbeddingCacheKey("lei 14.133/2021");

    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejeita cache de outro modelo e vetores fora do contrato", () => {
    expect(isCompatibleCachedEmbedding({ model: EMBEDDING_MODEL, embedding: vector() })).toBe(true);
    expect(isCompatibleCachedEmbedding({ model: "text-embedding-004", embedding: vector() })).toBe(false);
    expect(isValidEmbeddingVector(vector().slice(1))).toBe(false);
    const withNaN = vector();
    withNaN[20] = Number.NaN;
    expect(isValidEmbeddingVector(withNaN)).toBe(false);
  });

  it("chama a API atual com dimensionalidade explícita sem chave na URL", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      expect(url).toContain("/models/gemini-embedding-2:embedContent");
      expect(url).not.toContain("test-gemini-key");
      expect(init?.headers).toMatchObject({
        "Content-Type": "application/json",
        "x-goog-api-key": "test-gemini-key",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "models/gemini-embedding-2",
        content: { parts: [{ text: "modalidade da contratação" }] },
        outputDimensionality: 768,
      });
      return new Response(JSON.stringify({ embedding: { values: vector() } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateEmbedding("modalidade da contratação", false);

    expect(result).toHaveLength(768);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falha de forma sanitizada em erro HTTP do provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("provider detail must not escape", { status: 404 })));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(generateEmbedding("consulta sensível", false)).rejects.toThrow("EMBEDDING_PROVIDER_HTTP_404");
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("code=EMBEDDING_PROVIDER_HTTP_404 model=gemini-embedding-2 dim=768"),
    );
    expect(spy.mock.calls.flat().join(" ")).not.toContain("consulta sensível");
    expect(spy.mock.calls.flat().join(" ")).not.toContain("test-gemini-key");
  });
});

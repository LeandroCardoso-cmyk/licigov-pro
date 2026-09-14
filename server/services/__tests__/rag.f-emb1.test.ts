import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({
  getDb: vi.fn(),
}));

vi.mock("../embeddings", async () => {
  const actual = await vi.importActual<typeof import("../embeddings")>("../embeddings");
  return {
    ...actual,
    generateEmbedding: vi.fn(),
  };
});

import { getDb } from "../../db";
import {
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  generateEmbedding,
} from "../embeddings";
import { retrieveRelevantLaw } from "../rag";

function vector(value = 0.25): number[] {
  return Array.from({ length: EMBEDDING_DIM }, () => value);
}

function currentChunk(id: number, content = `current-${id}`) {
  return {
    id,
    lawName: "Lei 14.133/2021",
    chunkIndex: id,
    articleNumber: `Art. ${id}º`,
    content,
    embedding: vector(),
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIM,
    metadata: null,
    createdAt: new Date(),
  };
}

function legacyChunk(id: number, content = `legacy-${id}`) {
  return {
    ...currentChunk(id, content),
    embeddingModel: "text-embedding-004",
  };
}

function makeDb(rows: readonly unknown[]) {
  const where = vi.fn(async () => rows);
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return { db: { select }, select, from, where };
}

const mockedGetDb = vi.mocked(getDb);
const mockedGenerateEmbedding = vi.mocked(generateEmbedding);

describe("F-EMB1 RAG lineage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("não chama provider quando o espaço vetorial atual está vazio", async () => {
    const { db } = makeDb([]);
    mockedGetDb.mockResolvedValue(db as never);

    const result = await retrieveRelevantLaw("modalidade da contratação");

    expect(result).toEqual([]);
    expect(mockedGenerateEmbedding).not.toHaveBeenCalled();
  });

  it("faz fail-closed se o adapter devolver somente lineage incompatível", async () => {
    const sensitiveLegacyContent = "texto legado incompatível";
    const { db } = makeDb([legacyChunk(1, sensitiveLegacyContent)]);
    mockedGetDb.mockResolvedValue(db as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await retrieveRelevantLaw("consulta");

    expect(result).toEqual([]);
    expect(mockedGenerateEmbedding).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain("incompatible_chunk_lineage chunkId=1");
    expect(warn.mock.calls.flat().join(" ")).not.toContain(sensitiveLegacyContent);
  });

  it("ignora mixed-space inesperado e compara somente chunks do lineage atual", async () => {
    const current = currentChunk(1, "conteúdo atual");
    const legacy = legacyChunk(2, "conteúdo legado");
    const { db } = makeDb([current, legacy]);
    mockedGetDb.mockResolvedValue(db as never);
    mockedGenerateEmbedding.mockResolvedValue(vector());
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await retrieveRelevantLaw("consulta", 5);

    expect(mockedGenerateEmbedding).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      content: "conteúdo atual",
      articleNumber: "Art. 1º",
    });
    expect(result[0].similarity).toBeCloseTo(1, 8);
  });

  it("rejeita vetor corrente inválido antes do cosine similarity", async () => {
    const invalid = currentChunk(1);
    invalid.embedding = vector().slice(1);
    const { db } = makeDb([invalid]);
    mockedGetDb.mockResolvedValue(db as never);
    mockedGenerateEmbedding.mockResolvedValue(vector());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await retrieveRelevantLaw("consulta");

    expect(result).toEqual([]);
    expect(warn.mock.calls.flat().join(" ")).toContain("invalid_chunk_vector chunkId=1 reason=contract");
  });

  it("suporta escopo com múltiplos lawNames sem abandonar o lineage filter", async () => {
    const { db, where } = makeDb([currentChunk(1)]);
    mockedGetDb.mockResolvedValue(db as never);
    mockedGenerateEmbedding.mockResolvedValue(vector());

    const result = await retrieveRelevantLaw(
      "consulta",
      5,
      ["Lei 14.133/2021", "Decreto de referência"],
    );

    expect(where).toHaveBeenCalledTimes(1);
    expect(where.mock.calls[0][0]).toBeDefined();
    expect(result).toHaveLength(1);
  });
});

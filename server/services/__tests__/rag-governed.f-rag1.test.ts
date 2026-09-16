import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ getDb: vi.fn() }));
vi.mock("../embeddings", async () => {
  const actual = await vi.importActual<typeof import("../embeddings")>("../embeddings");
  return { ...actual, generateEmbedding: vi.fn() };
});

import { getDb } from "../../db";
import { EMBEDDING_DIM, EMBEDDING_MODEL, generateEmbedding } from "../embeddings";
import { GOVERNED_LAW_CONTENT_KIND } from "../governedLawCorpusMaterializer";
import { formatRetrievedContext, retrieveRelevantLaw } from "../rag";

function vector(): number[] {
  return Array.from({ length: EMBEDDING_DIM }, () => 0.5);
}

function governedChunk(activeReference: boolean) {
  return {
    id: 1,
    lawName: "Lei nº 14.133/2021",
    chunkIndex: 0,
    articleNumber: "Art. 74, I",
    content: "Art. 74, I: resumo governado",
    embedding: vector(),
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIM,
    metadata: {
      governedMaterialization: true,
      materializationKey: "k".repeat(64),
      materializerVersion: "f-rag1-v1",
      contentKind: GOVERNED_LAW_CONTENT_KIND,
      generatedFrom: "legal_reference_entries.hypothesisSummary",
      summaryNotVerbatimStatutoryText: true,
      referenceSetId: 10,
      referenceSetVersion: 1,
      referenceSetContentHash: "a".repeat(64),
      referenceEntryId: 20,
      sourceContentHash: "b".repeat(64),
      canonicalLocator: "lei-14.133-2021/art-74/inc-I",
      canonicalDisplay: "Art. 74, I",
      sourceAuthority: "Presidência da República / Planalto",
      sourceIdentifier: "Lei nº 14.133, de 1º de abril de 2021",
      sourceUrl: "https://www.planalto.gov.br/lei",
      publicationDate: "2021-04-01",
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIM,
      activeReference,
    },
    createdAt: new Date(),
  };
}

function dbWith(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => rows),
      })),
    })),
  };
}

describe("F-RAG1 governed RAG boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("não torna chunk governado parcial/inativo visível nem chama provider", async () => {
    vi.mocked(getDb).mockResolvedValue(dbWith([governedChunk(false)]) as never);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await retrieveRelevantLaw("consulta");

    expect(result).toEqual([]);
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(" ")).toContain("inactive_governed_chunk chunkId=1");
  });

  it("rotula resumo governado sem apresentá-lo como transcrição literal", async () => {
    vi.mocked(getDb).mockResolvedValue(dbWith([governedChunk(true)]) as never);
    vi.mocked(generateEmbedding).mockResolvedValue(vector());

    const result = await retrieveRelevantLaw("consulta");
    const context = formatRetrievedContext(result);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      contentKind: GOVERNED_LAW_CONTENT_KIND,
      canonicalLocator: "lei-14.133-2021/art-74/inc-I",
    });
    expect(context).toContain("Referência Jurídica Governada");
    expect(context).toContain("NÃO é transcrição literal da norma");
    expect(context).toContain("Lei nº 14.133, de 1º de abril de 2021");
  });
});

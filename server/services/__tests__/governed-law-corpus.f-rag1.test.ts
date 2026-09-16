import { describe, expect, it, vi } from "vitest";
import type {
  InsertLawChunk,
  LawChunk,
  LegalReferenceEntry,
  LegalReferenceSet,
} from "../../../drizzle/schema";
import { EMBEDDING_DIM, EMBEDDING_MODEL } from "../embeddings";
import {
  GOVERNED_LAW_CONTENT_KIND,
  buildGovernedMaterializationKey,
  materializeGovernedLawCorpus,
  readGovernedChunkMetadata,
  type GovernedLawCorpusDeps,
} from "../governedLawCorpusMaterializer";

function vector(value = 0.2): number[] {
  return Array.from({ length: EMBEDDING_DIM }, () => value);
}

function set(): LegalReferenceSet {
  return {
    id: 10,
    law: "Lei nº 14.133/2021",
    jurisdiction: "BR-FEDERAL",
    scope: "GLOBAL",
    version: 1,
    status: "active",
    coverageManifest: {},
    coverageManifestHash: "c".repeat(64),
    contentHash: "a".repeat(64),
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    sourceAuthority: "Planalto",
    sourceIdentifier: "Lei 14.133/2021",
    verificationMethod: "verified",
    approvedByUserId: 1,
    approvedAt: new Date(),
    approvalSource: "owner",
    approvedReferenceHash: "a".repeat(64),
    createdAt: new Date(),
  };
}

function entry(id: number, locator: string): LegalReferenceEntry {
  return {
    id,
    setId: 10,
    law: "Lei nº 14.133/2021",
    article: id === 1 ? "74" : "75",
    inciso: "I",
    alinea: null,
    canonicalLocator: locator,
    canonicalDisplay: id === 1 ? "Art. 74, I" : "Art. 75, I",
    procurementType: id === 1 ? "inexigibilidade" : "dispensa",
    hypothesisSummary: id === 1 ? "Resumo governado um" : "Resumo governado dois",
    sourceAuthority: "Presidência da República / Planalto",
    sourceIdentifier: "Lei nº 14.133, de 1º de abril de 2021",
    sourceUrl: "https://www.planalto.gov.br/lei",
    publicationDate: "2021-04-01",
    contentHash: String(id).repeat(64),
    createdAt: new Date(),
  };
}

function harness(options?: { failOnEmbedCall?: number }) {
  const referenceSet = set();
  const entries = [
    entry(1, "lei-14.133-2021/art-74/inc-I"),
    entry(2, "lei-14.133-2021/art-75/inc-I"),
  ];
  const chunks: LawChunk[] = [];
  const events: Array<{ action: string; details: unknown }> = [];
  let nextId = 1;
  let embedCalls = 0;

  const deps: GovernedLawCorpusDeps = {
    resolveGovernedSet: vi.fn(async () => ({ set: referenceSet, entries })),
    listChunks: vi.fn(async () => chunks),
    insertChunk: vi.fn(async (chunk: InsertLawChunk) => {
      chunks.push({
        id: nextId++,
        lawName: chunk.lawName,
        chunkIndex: chunk.chunkIndex,
        articleNumber: chunk.articleNumber ?? null,
        content: chunk.content,
        embedding: chunk.embedding,
        embeddingModel: chunk.embeddingModel,
        embeddingDimensions: chunk.embeddingDimensions,
        metadata: chunk.metadata ?? null,
        createdAt: new Date(),
      });
    }),
    listSetEvents: vi.fn(async () => events),
    appendSetEvent: vi.fn(async ({ action, details }) => {
      events.push({ action, details });
    }),
    finalizeActiveReference: vi.fn(async (hash: string) => {
      for (const chunk of chunks) {
        const metadata = readGovernedChunkMetadata(chunk.metadata);
        if (!metadata) continue;
        chunk.metadata = {
          ...metadata,
          activeReference: metadata.referenceSetContentHash === hash,
        };
      }
    }),
    embed: vi.fn(async () => {
      embedCalls += 1;
      if (options?.failOnEmbedCall === embedCalls) throw new Error("EMBEDDING_PROVIDER_TRANSPORT_ERROR");
      return vector();
    }),
  };

  return { deps, referenceSet, entries, chunks, events };
}

describe("F-RAG1 governed law corpus materialization", () => {
  it("dry-run não chama provider nem persiste", async () => {
    const h = harness();
    const result = await materializeGovernedLawCorpus({
      mode: "dry-run",
      environment: "staging",
      asOfDate: "2026-09-16",
    }, h.deps);

    expect(result.totalEntries).toBe(2);
    expect(result.alreadyMaterialized).toBe(0);
    expect(h.deps.embed).not.toHaveBeenCalled();
    expect(h.deps.insertChunk).not.toHaveBeenCalled();
    expect(h.deps.appendSetEvent).not.toHaveBeenCalled();
  });

  it("materializa somente resumo governado com lineage explícita e espaço vetorial canônico", async () => {
    const h = harness();
    const result = await materializeGovernedLawCorpus({
      mode: "apply",
      environment: "staging",
      asOfDate: "2026-09-16",
      runId: "11111111-1111-4111-8111-111111111111",
    }, h.deps);

    expect(result.materialized).toBe(2);
    expect(h.chunks).toHaveLength(2);
    expect(h.chunks.every((chunk) => chunk.embeddingModel === EMBEDDING_MODEL)).toBe(true);
    expect(h.chunks.every((chunk) => chunk.embeddingDimensions === EMBEDDING_DIM)).toBe(true);

    const metadata = readGovernedChunkMetadata(h.chunks[0].metadata);
    expect(metadata).toMatchObject({
      contentKind: GOVERNED_LAW_CONTENT_KIND,
      generatedFrom: "legal_reference_entries.hypothesisSummary",
      summaryNotVerbatimStatutoryText: true,
      activeReference: true,
    });
    expect(metadata?.materializationKey).toBe(
      buildGovernedMaterializationKey(h.referenceSet, h.entries[0]),
    );
    expect(h.chunks[0].content).toContain("Resumo governado");
  });

  it("replay do mesmo runId concluído não chama provider", async () => {
    const h = harness();
    const input = {
      mode: "apply" as const,
      environment: "staging" as const,
      asOfDate: "2026-09-16",
      runId: "22222222-2222-4222-8222-222222222222",
    };

    await materializeGovernedLawCorpus(input, h.deps);
    vi.mocked(h.deps.embed).mockClear();
    const replay = await materializeGovernedLawCorpus(input, h.deps);

    expect(replay.replayed).toBe(true);
    expect(h.deps.embed).not.toHaveBeenCalled();
    expect(h.chunks).toHaveLength(2);
  });

  it("falha parcial permanece inativa e novo runId retoma somente o restante", async () => {
    const h = harness({ failOnEmbedCall: 2 });
    await expect(materializeGovernedLawCorpus({
      mode: "apply",
      environment: "staging",
      asOfDate: "2026-09-16",
      runId: "33333333-3333-4333-8333-333333333333",
    }, h.deps)).rejects.toThrow("EMBEDDING_PROVIDER_TRANSPORT_ERROR");

    expect(h.chunks).toHaveLength(1);
    expect(readGovernedChunkMetadata(h.chunks[0].metadata)?.activeReference).toBe(false);
    expect(h.events.some((event) => event.action === "rag_materialization_failed")).toBe(true);

    vi.mocked(h.deps.embed).mockImplementation(async () => vector());
    vi.mocked(h.deps.embed).mockClear();
    const retry = await materializeGovernedLawCorpus({
      mode: "apply",
      environment: "staging",
      asOfDate: "2026-09-16",
      runId: "44444444-4444-4444-8444-444444444444",
    }, h.deps);

    expect(retry.alreadyMaterialized).toBe(1);
    expect(retry.materialized).toBe(1);
    expect(h.deps.embed).toHaveBeenCalledTimes(1);
    expect(h.chunks).toHaveLength(2);
    expect(h.chunks.every((chunk) => readGovernedChunkMetadata(chunk.metadata)?.activeReference === true)).toBe(true);
  });
});

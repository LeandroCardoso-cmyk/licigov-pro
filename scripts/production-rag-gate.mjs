import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const runId = "82dfa0a5-5b81-478d-a25d-06d59a0825dd";
const asOfDate = "2026-09-20";
const expectedHash = "332a9cb3ff8477eddc5cf94790a13d7ea9bd7a8c5855078f7f567f5400196832";
const phase = process.env.F_RAG1_PHASE ?? "disabled";
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const report = (event, data) => console.info("[PROD-GATE] " + JSON.stringify({event, phase, runId, asOfDate, ...data}));

async function main() {
  if (phase === "disabled") { report("disabled", {}); return; }
  assert(["apply", "replay", "embedding-dry-run", "a3-live"].includes(phase), "PHASE_INVALID");
  assert.equal(process.env.APP_ENV, "production", "APP_ENV_MISMATCH");
  assert.equal(process.env.RAILWAY_ENVIRONMENT_ID, "3efa7f99-8641-48e1-ad33-3c98bf5e91c7", "RAILWAY_ENVIRONMENT_MISMATCH");
  for (const key of ["DATABASE_URL", "GEMINI_API_KEY", "JWT_SECRET", "ADMIN_PASSWORD"]) assert(process.env[key]?.trim(), "REQUIRED_VARIABLE_MISSING");
  report("start", {sourceSha: process.env.RAILWAY_GIT_COMMIT_SHA ?? null, environment: "production"});
  let embeddingRequests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    if (String(args[0]).includes("generativelanguage.googleapis.com") && String(args[0]).includes(":embedContent")) embeddingRequests++;
    return originalFetch(...args);
  };
  const { defaultGovernedLawCorpusDeps: deps, readGovernedChunkMetadata } = await import("../server/services/governedLawCorpusMaterializer.ts");
  const { getDb } = await import("../server/db/index.ts");
  const { legalReferenceSetEvents } = await import("../drizzle/schema.ts");
  const { eq } = await import("drizzle-orm");
  const { set, entries } = await deps.resolveGovernedSet(asOfDate);
  assert.equal(set.id, 1, "REFERENCE_SET_ID_DRIFT");
  assert.equal(set.version, 1, "REFERENCE_SET_VERSION_DRIFT");
  assert.equal(set.contentHash, expectedHash, "REFERENCE_HASH_DRIFT");
  assert.equal(entries.length, 7, "REFERENCE_COUNT_DRIFT");
  const db = await getDb();
  assert(db, "DB_UNAVAILABLE");
  const corpus = async () => (await deps.listChunks()).sort((a,b) => a.id-b.id);
  const events = async () => (await db.select().from(legalReferenceSetEvents).where(eq(legalReferenceSetEvents.correlationId, runId))).sort((a,b) => a.id-b.id);
  const verifyCorpus = rows => {
    assert.equal(rows.length, 7, "CORPUS_COUNT_MISMATCH");
    const keys = new Set();
    for (const row of rows) {
      const m = readGovernedChunkMetadata(row.metadata);
      assert(m?.activeReference === true, "INACTIVE_OR_LEGACY_CHUNK");
      assert.equal(m.referenceSetContentHash, expectedHash, "CHUNK_REFERENCE_DRIFT");
      assert.equal(m.referenceSetId, 1, "CHUNK_SET_DRIFT");
      assert.equal(m.referenceSetVersion, 1, "CHUNK_VERSION_DRIFT");
      assert.equal(m.summaryNotVerbatimStatutoryText, true, "SUMMARY_LABEL_MISSING");
      assert.equal(row.embeddingModel, "gemini-embedding-2", "VECTOR_MODEL_DRIFT");
      assert.equal(row.embeddingDimensions, 768, "VECTOR_DIMENSION_DRIFT");
      assert(m.sourceIdentifier && m.sourceUrl?.startsWith("https://") && m.canonicalLocator, "PROVENANCE_MISSING");
      keys.add(m.materializationKey);
    }
    assert.equal(keys.size, 7, "DUPLICATE_MATERIALIZATION");
  };
  const before = await corpus();
  const beforeEvents = await events();
  report("preflight", {setId:set.id, setVersion:set.version, referenceHash:set.contentHash, chunks:before.length, corpusHash:hash(before), runEvents:beforeEvents.map(e=>e.action)});
  if (phase === "apply" || phase === "replay") {
    if (phase === "apply") assert([0,7].includes(before.length), "UNEXPECTED_PARTIAL_CORPUS");
    if (phase === "replay") {
      verifyCorpus(before);
      assert(beforeEvents.some(e=>e.action==="rag_materialization_completed"), "RUN_NOT_COMPLETED");
    }
    const { main: cli } = await import("./materialize-governed-law-corpus.ts");
    await cli(["--apply", "--environment", "production", "--production-approved", "--as-of-date", asOfDate, "--run-id", runId]);
    const after = await corpus();
    const afterEvents = await events();
    verifyCorpus(after);
    assert.equal(afterEvents.filter(e=>e.action==="rag_materialization_completed").length, 1, "COMPLETION_EVENT_MISMATCH");
    assert(!afterEvents.some(e=>e.action==="rag_materialization_failed"), "FAILED_RUN_EVENT");
    if (phase === "replay") {
      assert.equal(hash(after), hash(before), "REPLAY_CORPUS_CHANGED");
      assert.equal(hash(afterEvents), hash(beforeEvents), "REPLAY_EVENTS_CHANGED");
      assert.equal(embeddingRequests, 0, "REPLAY_PROVIDER_CALLED");
    }
    report("PASS", {chunks:after.length, uniqueKeys:7, corpusHash:hash(after), eventsHash:hash(afterEvents), embeddingRequests, runEvents:afterEvents.map(e=>({id:e.id,action:e.action,correlationId:e.correlationId,details:e.details}))});
  } else if (phase === "embedding-dry-run") {
    verifyCorpus(before);
    const { main: cli } = await import("./reindex-legal-embeddings.ts");
    process.argv = ["node", "reindex-legal-embeddings.ts", "--dry-run", "--environment", "production", "--production-approved"];
    await cli();
    const { getEmbeddingReindexRepository } = await import("../server/services/embeddingReindex.ts");
    const repository = await getEmbeddingReindexRepository();
    assert.equal(await repository.countAllChunks(), 7, "CURRENT_COUNT_MISMATCH");
    assert.equal((await repository.listStaleChunks()).length, 0, "STALE_CHUNKS_PRESENT");
    assert.equal(hash(await corpus()), hash(before), "DRY_RUN_CORPUS_CHANGED");
    assert.equal(embeddingRequests, 0, "DRY_RUN_PROVIDER_CALLED");
    report("PASS", {current:7, stale:0, skipped:7, embeddingRequests, corpusHash:hash(before)});
  } else {
    verifyCorpus(before);
    const { retrieveRelevantLaw, formatRetrievedContext } = await import("../server/services/rag.ts");
    const chunks = await retrieveRelevantLaw("Hipóteses de inexigibilidade de licitação por inviabilidade de competição na Lei 14.133/2021", 3);
    assert.equal(chunks.length, 3, "RAG_RESULT_COUNT_MISMATCH");
    assert(chunks.every(c=>c.contentKind==="governed_reference_summary" && c.canonicalLocator && c.sourceIdentifier && c.sourceUrl?.startsWith("https://")), "RAG_PROVENANCE_OR_LEGACY_FAILURE");
    const context = formatRetrievedContext(chunks);
    assert(context.includes("resumo verificado") && context.includes("NÃO é transcrição literal"), "SUMMARY_LABEL_MISSING");
    assert.equal(hash(await corpus()), hash(before), "LIVE_CORPUS_CHANGED");
    report("PASS", {count:chunks.length, governed:chunks.length, legacy:0, summaryLabel:true, embeddingRequests, corpusHash:hash(before), references:chunks.map(({articleNumber,canonicalLocator,sourceIdentifier,sourceUrl,similarity})=>({articleNumber,canonicalLocator,sourceIdentifier,sourceUrl,similarity}))});
  }
}
main().then(()=>process.exit(0)).catch(error=>{
  const code = error instanceof Error && /^[A-Z0-9_:-]{1,100}$/.test(error.message) ? error.message : error.name ?? "ERROR";
  report("FAIL", {code});
  process.exit(1);
});

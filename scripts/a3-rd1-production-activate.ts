/**
 * A3-RD1 — TEMPORARY production activation harness.
 *
 * Purpose: execute the already owner-authorized Reference Set V1 activation through the
 * canonical `db:reference:approve` boundary, with fail-closed pre/post checks and replay safety.
 * This file is operational scaffolding only and MUST be removed after the production gate passes.
 */
import { spawnSync } from "node:child_process";
import { and, eq } from "drizzle-orm";
import { legalReferenceSetEvents, users } from "../drizzle/schema";
import { getDb } from "../server/db/connection";
import { getReferenceSetsByLaw } from "../server/db/legalReference";

const LAW = "Lei nº 14.133/2021";
const JURISDICTION = "BR-FEDERAL";
const EXPECTED_VERSION = 1;
const EXPECTED_SET_ID = 1;
const EXPECTED_HASH = "332a9cb3ff8477eddc5cf94790a13d7ea9bd7a8c5855078f7f567f5400196832";
const ACTOR_USER_ID = 1;
const APPROVAL_SOURCE = "owner-chat-authorization";
const CORRELATION_ID = "9887c02a-2c0f-490a-b8b4-ef41248fc895";

function log(message: string): void {
  console.info(`[A3-RD1-PROD-ACTIVATE] ${message}`);
}

async function loadTargetSet() {
  const sets = await getReferenceSetsByLaw(LAW, JURISDICTION);
  const matching = sets.filter((set) => set.version === EXPECTED_VERSION);
  if (matching.length !== 1) {
    throw new Error(`TARGET_SET_CARDINALITY_INVALID: expected=1 actual=${matching.length}`);
  }
  return matching[0];
}

async function assertActivationEvent(setId: number): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");

  const events = await db
    .select({
      id: legalReferenceSetEvents.id,
      actorUserId: legalReferenceSetEvents.actorUserId,
      actorRole: legalReferenceSetEvents.actorRole,
      approvedReferenceHash: legalReferenceSetEvents.approvedReferenceHash,
    })
    .from(legalReferenceSetEvents)
    .where(and(
      eq(legalReferenceSetEvents.setId, setId),
      eq(legalReferenceSetEvents.action, "activated"),
      eq(legalReferenceSetEvents.correlationId, CORRELATION_ID),
    ));

  if (events.length !== 1) {
    throw new Error(`ACTIVATION_EVENT_CARDINALITY_INVALID: expected=1 actual=${events.length}`);
  }
  const event = events[0];
  if (
    event.actorUserId !== ACTOR_USER_ID ||
    event.actorRole !== "admin" ||
    event.approvedReferenceHash !== EXPECTED_HASH
  ) {
    throw new Error("ACTIVATION_EVENT_LINEAGE_INVALID");
  }
}

async function assertActor(): Promise<"admin"> {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_UNAVAILABLE");

  const actors = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, ACTOR_USER_ID))
    .limit(2);

  if (actors.length !== 1) {
    throw new Error(`ACTOR_CARDINALITY_INVALID: expected=1 actual=${actors.length}`);
  }
  if (actors[0].role !== "admin") {
    throw new Error(`ACTOR_ROLE_INVALID: expected=admin actual=${actors[0].role}`);
  }
  return "admin";
}

function assertTargetIntegrity(set: Awaited<ReturnType<typeof loadTargetSet>>): void {
  if (set.id !== EXPECTED_SET_ID) {
    throw new Error(`TARGET_SET_ID_INVALID: expected=${EXPECTED_SET_ID} actual=${set.id}`);
  }
  if (set.contentHash !== EXPECTED_HASH) {
    throw new Error("TARGET_HASH_INVALID");
  }
}

async function assertActiveLineage(): Promise<void> {
  const set = await loadTargetSet();
  assertTargetIntegrity(set);
  if (set.status !== "active") throw new Error(`POST_STATUS_INVALID: expected=active actual=${set.status}`);
  if (set.approvedReferenceHash !== EXPECTED_HASH) throw new Error("POST_APPROVED_HASH_INVALID");
  if (set.approvedByUserId !== ACTOR_USER_ID) throw new Error("POST_ACTOR_INVALID");
  if (set.approvalSource !== APPROVAL_SOURCE) throw new Error("POST_APPROVAL_SOURCE_INVALID");
  if (!set.approvedAt) throw new Error("POST_APPROVED_AT_MISSING");
  await assertActivationEvent(set.id);
}

async function main(): Promise<void> {
  if (process.env.APP_ENV !== "production") {
    throw new Error(`ENVIRONMENT_NOT_ALLOWED: APP_ENV=${process.env.APP_ENV ?? "unset"}`);
  }
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL_MISSING");

  const actorRole = await assertActor();
  const set = await loadTargetSet();
  assertTargetIntegrity(set);

  log(`gate actor=${ACTOR_USER_ID} role=${actorRole} setId=${set.id} version=${set.version} status=${set.status} hash=${EXPECTED_HASH.slice(0, 12)}… correlation=${CORRELATION_ID}`);

  if (set.status === "active") {
    // Replay is accepted ONLY when this exact authorized activation already produced its event.
    await assertActiveLineage();
    log(`NOOP replay-safe: setId=${set.id} already active with exact authorized lineage.`);
    return;
  }
  if (set.status !== "draft") {
    throw new Error(`PRE_STATUS_INVALID: expected=draft actual=${set.status}`);
  }

  // The mutation itself is performed only by the canonical supervised boundary.
  const child = spawnSync(
    "pnpm",
    [
      "run", "db:reference:approve", "--",
      "--version", String(EXPECTED_VERSION),
      "--expected-hash", EXPECTED_HASH,
      "--actor-user-id", String(ACTOR_USER_ID),
      "--approval-source", APPROVAL_SOURCE,
      "--correlation-id", CORRELATION_ID,
      "--actor-role", actorRole,
      "--law", LAW,
      "--jurisdiction", JURISDICTION,
    ],
    { stdio: "inherit", env: process.env },
  );

  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw new Error(`CANONICAL_APPROVAL_BOUNDARY_FAILED: exit=${child.status ?? "null"}`);
  }

  await assertActiveLineage();
  log(`PASS setId=${EXPECTED_SET_ID} version=${EXPECTED_VERSION} status=active actor=${ACTOR_USER_ID} source=${APPROVAL_SOURCE} correlation=${CORRELATION_ID}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[A3-RD1-PROD-ACTIVATE] FAIL: ${message}`);
  process.exitCode = 1;
});

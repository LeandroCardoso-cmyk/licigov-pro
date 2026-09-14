/**
 * A3-RD1 — smoke MySQL REAL do domínio governado de referência jurídica.
 * Só roda quando DATABASE_URL está definido (CI). Exercita installer replay-safe, readiness
 * fail-closed, resolução temporal e aprovação/ativação contra MySQL real.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mysql from "mysql2/promise";
import {
  installGovernedLegalReferenceV1, resolveActiveReferenceSet, resolveGovernedReference,
  approveAndActivateReferenceSet, getReferenceEntries, getReferenceSetsByLaw,
} from "../../db/legalReference";
import { computeManifestHashes, LEGAL_REFERENCE_V1_META } from "../../domain/legalReference/manifestV1";

const DB = process.env.DATABASE_URL;
const M = LEGAL_REFERENCE_V1_META;

async function clean(conn: mysql.Connection) {
  await conn.execute("DELETE FROM legal_reference_set_events");
  await conn.execute("DELETE FROM legal_value_overrides");
  await conn.execute("DELETE FROM legal_reference_entries");
  await conn.execute("DELETE FROM legal_reference_sets");
}

describe.skipIf(!DB)("A3-RD1 — governed legal reference (MySQL real)", () => {
  let conn: mysql.Connection;
  beforeAll(async () => { conn = await mysql.createConnection(DB!); });
  afterAll(async () => { await clean(conn); await conn.end(); });
  beforeEach(async () => { await clean(conn); });

  it("install → set draft + 7 entries + 2 overrides + evento; NÃO ativa", async () => {
    const r = await installGovernedLegalReferenceV1();
    expect(r.action).toBe("installed");
    const sets = await getReferenceSetsByLaw(M.law, M.jurisdiction);
    expect(sets).toHaveLength(1);
    expect(sets[0].status).toBe("draft");
    expect(sets[0].contentHash).toBe(computeManifestHashes().referenceSetContentHash);
    expect(await getReferenceEntries(sets[0].id)).toHaveLength(7);
    const [ov] = await conn.execute<mysql.RowDataPacket[]>("SELECT COUNT(*) c FROM legal_value_overrides");
    expect((ov as mysql.RowDataPacket[])[0].c).toBe(2);
    const [ev] = await conn.execute<mysql.RowDataPacket[]>("SELECT action FROM legal_reference_set_events");
    expect((ev as mysql.RowDataPacket[])[0].action).toBe("installed");
  });

  it("replay com mesmo hash → no-op (idempotente)", async () => {
    await installGovernedLegalReferenceV1();
    const r2 = await installGovernedLegalReferenceV1();
    expect(r2.action).toBe("noop");
    expect(await getReferenceSetsByLaw(M.law, M.jurisdiction)).toHaveLength(1);
  });

  it("mesma versão com conteúdo divergente → FAIL-CLOSED (CONTENT_HASH_INVALID)", async () => {
    await installGovernedLegalReferenceV1();
    await conn.execute("UPDATE legal_reference_sets SET content_hash = 'tampered' WHERE version = ?", [M.version]);
    await expect(installGovernedLegalReferenceV1()).rejects.toMatchObject({ code: "LEGAL_REFERENCE_CONTENT_HASH_INVALID" });
  });

  it("readiness antes da ativação → SET_MISSING (draft não resolve)", async () => {
    await installGovernedLegalReferenceV1();
    await expect(resolveActiveReferenceSet("2026-06-01")).rejects.toMatchObject({ code: "LEGAL_REFERENCE_SET_MISSING" });
  });

  it("aprovação com hash divergente → FAIL-CLOSED; com hash correto → ativa e resolve", async () => {
    await installGovernedLegalReferenceV1();
    const hash = computeManifestHashes().referenceSetContentHash;
    await expect(approveAndActivateReferenceSet({
      version: M.version, expectedReferenceHash: "wrong", actorUserId: 1, approvalSource: "test",
    })).rejects.toMatchObject({ code: "LEGAL_REFERENCE_CONTENT_HASH_INVALID" });

    await approveAndActivateReferenceSet({ version: M.version, expectedReferenceHash: hash, actorUserId: 7, actorRole: "platform_admin", approvalSource: "test", correlationId: "c1" });
    const resolved = await resolveGovernedReference("lei-14.133-2021/art-75/inc-I", "2026-06-01");
    expect(resolved.entry.canonicalLocator).toBe("lei-14.133-2021/art-75/inc-I");
    expect(resolved.entry.procurementType).toBe("dispensa");
    expect(resolved.valueCents).toBe(13098420);
    expect(resolved.referenceSetVersion).toBe(M.version);
    const [ev] = await conn.execute<mysql.RowDataPacket[]>("SELECT action FROM legal_reference_set_events WHERE action='activated'");
    expect((ev as mysql.RowDataPacket[]).length).toBe(1);
  });

  it("após ativação: locator fora da cobertura → UNSUPPORTED; data anterior à vigência → VERSION_GAP", async () => {
    await installGovernedLegalReferenceV1();
    const hash = computeManifestHashes().referenceSetContentHash;
    await approveAndActivateReferenceSet({ version: M.version, expectedReferenceHash: hash, actorUserId: 7, approvalSource: "test" });
    await expect(resolveGovernedReference("lei-14.133-2021/art-75/inc-III", "2026-06-01")).rejects.toMatchObject({ code: "LEGAL_REFERENCE_UNSUPPORTED" });
    await expect(resolveGovernedReference("lei-14.133-2021/art-75/inc-I", "2025-06-01")).rejects.toMatchObject({ code: "LEGAL_REFERENCE_VERSION_GAP" });
  });
});

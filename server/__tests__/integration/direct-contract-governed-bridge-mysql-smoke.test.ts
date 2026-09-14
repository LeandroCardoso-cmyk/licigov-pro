/**
 * A3-RD1 — smoke MySQL REAL da BRIDGE governada em `direct_contracts` (migration 0300).
 * Só roda com DATABASE_URL (CI). Prova, contra MySQL real:
 *   - registro GOVERNADO válido: legalReferenceEntryId != null & legalArticleId = null;
 *   - registro LEGADO válido: legalArticleId != null & legalReferenceEntryId = null;
 *   - os dois domínios de identidade coexistem separados (nunca comparam IDs de tabelas distintas).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import {
  installGovernedLegalReferenceV1, approveAndActivateReferenceSet, resolveGovernedReference,
  createDirectContract, getDirectContractById,
} from "../../db";
import { computeManifestHashes, LEGAL_REFERENCE_V1_META } from "../../domain/legalReference/manifestV1";

const DB = process.env.DATABASE_URL;
const M = LEGAL_REFERENCE_V1_META;
const NUM_PREFIX = "A3RD1-BRIDGE";

async function cleanLegal(conn: mysql.Connection) {
  await conn.execute("DELETE FROM legal_reference_set_events");
  await conn.execute("DELETE FROM legal_value_overrides");
  await conn.execute("DELETE FROM legal_reference_entries");
  await conn.execute("DELETE FROM legal_reference_sets");
}

describe.skipIf(!DB)("A3-RD1 — bridge governada em direct_contracts (MySQL real)", () => {
  let conn: mysql.Connection;
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await conn.execute("DELETE FROM direct_contracts WHERE number LIKE ?", [`${NUM_PREFIX}%`]);
    await cleanLegal(conn);
    await installGovernedLegalReferenceV1();
    await approveAndActivateReferenceSet({
      version: M.version, expectedReferenceHash: computeManifestHashes().referenceSetContentHash,
      actorUserId: 7, actorRole: "platform_admin", approvalSource: "bridge-smoke",
    });
  });
  afterAll(async () => {
    await conn.execute("DELETE FROM direct_contracts WHERE number LIKE ?", [`${NUM_PREFIX}%`]);
    await cleanLegal(conn);
    await conn.end();
  });

  it("registro GOVERNADO: persiste legalReferenceEntryId e mantém legalArticleId NULL", async () => {
    const resolved = await resolveGovernedReference("lei-14.133-2021/art-75/inc-I", "2026-06-01");
    const created = await createDirectContract({
      number: `${NUM_PREFIX}-GOV/2026`, year: 2026, type: "dispensa",
      object: "Aquisição governada de material de expediente", justification: "Justificativa governada suficiente.",
      value: 10000000, createdBy: 1, organizationId: 1, status: "draft", mode: "presencial",
      legalArticleId: null,
      legalReferenceEntryId: resolved.entry.id,
      legalReferenceSetVersion: resolved.referenceSetVersion,
      legalReferenceLocator: resolved.entry.canonicalLocator,
    });
    expect(created).toBeTruthy();
    const row = await getDirectContractById(created!.id);
    expect(row!.legalArticleId).toBeNull();
    expect(row!.legalReferenceEntryId).toBe(resolved.entry.id);
    expect(row!.legalReferenceSetVersion).toBe(resolved.referenceSetVersion);
    expect(row!.legalReferenceLocator).toBe("lei-14.133-2021/art-75/inc-I");
  });

  it("registro LEGADO: persiste legalArticleId e mantém governed fields NULL", async () => {
    const created = await createDirectContract({
      number: `${NUM_PREFIX}-LEG/2026`, year: 2026, type: "dispensa",
      object: "Aquisição legada de material de expediente", justification: "Justificativa legada suficiente.",
      value: 4000000, createdBy: 1, organizationId: 1, status: "draft", mode: "presencial",
      legalArticleId: 12345,
      legalReferenceEntryId: null, legalReferenceSetVersion: null, legalReferenceLocator: null,
    });
    expect(created).toBeTruthy();
    const row = await getDirectContractById(created!.id);
    expect(row!.legalArticleId).toBe(12345);
    expect(row!.legalReferenceEntryId).toBeNull();
    expect(row!.legalReferenceSetVersion).toBeNull();
    expect(row!.legalReferenceLocator).toBeNull();
  });
});

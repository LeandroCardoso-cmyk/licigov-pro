/**
 * P0 PILOTO (HARDENING) — Identidade institucional: composição canônica + REPLAY-SAFE (MySQL real).
 *
 * Prova, contra um MySQL/MariaDB real, que:
 *  A. `resolveInstitutionalIdentity` COMPÕE a identidade a partir da FONTE ÚNICA — nome/CNPJ vêm da
 *     tabela canônica `organizations`; logo/endereço/contato/rodapé vêm da EXTENSÃO `documentSettings`.
 *     Não há duas fontes independentes para o mesmo campo.
 *  B. Isolamento multi-tenant: organizações diferentes resolvem identidades independentes.
 *  C. REPLAY-SAFE temporal: um SNAPSHOT congelado (gravado no `metadata` do artefato) reproduz EXATAMENTE
 *     a identidade da época — mesmo depois de a identidade viva mudar. Sem snapshot (documento legado),
 *     a leitura cai para o vigente (fallback). O fingerprint acompanha o snapshot (lineage estável).
 *
 * Só roda com DATABASE_URL (CI com MySQL efêmero); PULADO sem banco.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations } from "../../bootstrap";
import {
  resolveInstitutionalIdentity,
  snapshotInstitutionalIdentity,
  institutionalIdentityFromMetadataOrLive,
  institutionalIdentityFingerprint,
} from "../../services/institutionalIdentityService";

const DB = process.env.DATABASE_URL;
const ORG_A = 993301;
const ORG_B = 993302;

let conn: mysql.Connection;

async function seedOrg(id: number, nome: string, cnpj: string | null, slug: string) {
  await conn.query(
    "INSERT INTO `organizations` (id, nome, cnpj, slug, esfera, uf, municipio, ativo, createdAt, updatedAt) " +
    "VALUES (?, ?, ?, ?, 'municipal', 'PR', 'Cidade', 1, NOW(3), NOW(3)) " +
    "ON DUPLICATE KEY UPDATE nome=VALUES(nome), cnpj=VALUES(cnpj)",
    [id, nome, cnpj, slug],
  );
}
async function seedExtension(orgId: number, address: string, phone: string) {
  await conn.query(
    "INSERT INTO `documentSettings` (organizationId, address, phone, createdAt, updatedAt) " +
    "VALUES (?, ?, ?, NOW(3), NOW(3)) ON DUPLICATE KEY UPDATE address=VALUES(address), phone=VALUES(phone)",
    [orgId, address, phone],
  );
}
async function cleanup() {
  for (const org of [ORG_A, ORG_B]) {
    await conn.query("DELETE FROM `documentSettings` WHERE organizationId = ?", [org]).catch(() => {});
    await conn.query("DELETE FROM `organizations` WHERE id = ?", [org]).catch(() => {});
  }
}

describe.skipIf(!DB)("InstitutionalIdentity — composição canônica + replay-safe (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await cleanup();
    await seedOrg(ORG_A, "Prefeitura Alfa", "11.111.111/1111-11", `alfa-${ORG_A}`);
    await seedOrg(ORG_B, "Prefeitura Beta", "22.222.222/2222-22", `beta-${ORG_B}`);
    await seedExtension(ORG_A, "Rua Alfa, 100", "(11) 1111-1111");
    await seedExtension(ORG_B, "Rua Beta, 200", "(22) 2222-2222");
  }, 120_000);

  afterAll(async () => {
    if (conn) {
      await cleanup();
      await conn.end();
    }
  }, 30_000);

  it("A. compõe canônica (organizations: nome/cnpj) + extensão (documentSettings: address/phone)", async () => {
    const id = await resolveInstitutionalIdentity(ORG_A);
    expect(id.organizationName).toBe("Prefeitura Alfa"); // organizations.nome (canônico)
    expect(id.cnpj).toBe("11.111.111/1111-11");          // organizations.cnpj (canônico)
    expect(id.esfera).toBe("municipal");
    expect(id.address).toBe("Rua Alfa, 100");            // documentSettings (extensão)
    expect(id.phone).toBe("(11) 1111-1111");
  });

  it("B. isolamento multi-tenant — organizações resolvem identidades independentes", async () => {
    const a = await resolveInstitutionalIdentity(ORG_A);
    const b = await resolveInstitutionalIdentity(ORG_B);
    expect(a.organizationName).not.toBe(b.organizationName);
    expect(a.cnpj).not.toBe(b.cnpj);
    expect(a.address).not.toBe(b.address);
    expect(institutionalIdentityFingerprint(a)).not.toBe(institutionalIdentityFingerprint(b));
  });

  it("C. snapshot congela a identidade — reexportação reproduz apesar de mudança posterior", async () => {
    // Snapshot no momento da "geração" do artefato.
    const snap = await snapshotInstitutionalIdentity(ORG_A);
    expect(snap.snapshot.organizationName).toBe("Prefeitura Alfa");
    expect(snap.snapshot.address).toBe("Rua Alfa, 100");
    const fpFrozen = snap.fingerprint;

    // A identidade VIVA muda depois (nome canônico e extensão).
    await conn.query("UPDATE `organizations` SET nome = ? WHERE id = ?", ["Prefeitura Alfa RENOMEADA", ORG_A]);
    await conn.query("UPDATE `documentSettings` SET address = ? WHERE organizationId = ?", ["Rua Nova, 999", ORG_A]);

    // Metadata COM snapshot → reproduz a identidade da época (congelada), não a viva.
    const frozen = await institutionalIdentityFromMetadataOrLive(
      { institutionalIdentitySnapshot: snap.snapshot }, ORG_A,
    );
    expect(frozen.organizationName).toBe("Prefeitura Alfa");   // congelado
    expect(frozen.address).toBe("Rua Alfa, 100");              // congelado
    expect(institutionalIdentityFingerprint(frozen)).toBe(fpFrozen);

    // Metadata SEM snapshot (documento legado) → fallback para a identidade viva (mudada).
    const live = await institutionalIdentityFromMetadataOrLive(null, ORG_A);
    expect(live.organizationName).toBe("Prefeitura Alfa RENOMEADA");
    expect(live.address).toBe("Rua Nova, 999");
    expect(institutionalIdentityFingerprint(live)).not.toBe(fpFrozen);
  });

  it("D. fingerprint é determinístico e sensível ao conteúdo", async () => {
    const base = { organizationId: 1, organizationName: "X", cnpj: "00.000.000/0000-00", address: "A" };
    expect(institutionalIdentityFingerprint(base)).toBe(institutionalIdentityFingerprint({ ...base }));
    expect(institutionalIdentityFingerprint(base)).not.toBe(
      institutionalIdentityFingerprint({ ...base, address: "B" }),
    );
    // organizationId NÃO entra no fingerprint (é o eixo do tenant, não conteúdo da identidade).
    expect(institutionalIdentityFingerprint(base)).toBe(
      institutionalIdentityFingerprint({ ...base, organizationId: 999 }),
    );
  });
});

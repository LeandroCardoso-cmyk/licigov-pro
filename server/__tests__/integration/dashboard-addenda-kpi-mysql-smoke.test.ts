/**
 * Aditivos KPI (homologação V1) — Central de Operações conta aditivos REAIS por tenant.
 *
 * Regressão do bug: `departmentOperationService.getDashboard` enviava `addendaCount: 0`
 * fixo a `computeIndicators`, exibindo "Aditivos: 0" mesmo com aditivo materializado. A
 * correção consome a fonte canônica do Contract Workspace (`contract_addenda`) por tenant
 * via `countContractAddendaByOrg`, sem segunda fonte nem cópia auxiliar.
 *
 * Exercita o SERVIÇO REAL (`getDashboard`) e o WRITER CANÔNICO REAL (`insertContractAddendum`)
 * contra MySQL. Prova: tenant sem aditivo → 0; 1 aditivo → 1; múltiplos → contagem correta;
 * aditivo do tenant B NÃO altera o KPI do tenant A; refresh mantém a contagem.
 *
 * Só roda com DATABASE_URL (CI com MySQL efêmero); PULADO sem banco.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mysql from "mysql2/promise";
import { runMigrations, ensureSchema } from "../../bootstrap";
import { createContractAddendum } from "../../domain/contractInstruments";
import { insertContractAddendum } from "../../db/contractWorkspace";
import { getDashboard } from "../../services/departmentOperationService";

const DB = process.env.DATABASE_URL;
const ORG_A = 993401;
const ORG_B = 993402;
const TODAY = "2026-08-30";

let conn: mysql.Connection;

/** Materializa um aditivo real do contrato via writer canônico (contract_addenda). */
async function seedAddendum(org: number, contractId: string, sequence: number) {
  const addendum = createContractAddendum({
    organizationId: org, contractId, addendumType: "prazo", sequence,
    justification: `Prorrogação ${sequence}`, newTerm: "2027-01-01",
    requestOrigin: "contract_workspace", correlationId: `corr-add-${org}-${contractId}-${sequence}`,
  });
  await insertContractAddendum(addendum);
  return addendum;
}

async function addendaKpi(org: number): Promise<number> {
  const snap = await getDashboard({ organizationId: org, today: TODAY });
  return snap.indicators.addenda;
}

async function cleanup() {
  for (const org of [ORG_A, ORG_B]) {
    await conn.query("DELETE FROM `contract_addenda` WHERE organization_id = ?", [org]).catch(() => {});
  }
}

describe.skipIf(!DB)("Aditivos KPI — Central conta aditivos reais por tenant (MySQL real)", () => {
  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    await runMigrations(conn);
    await ensureSchema(conn);
    await cleanup();
  }, 300_000);

  afterAll(async () => {
    await cleanup().catch(() => {});
    await conn?.end();
  });

  it("tenant sem aditivo → KPI 0", async () => {
    expect(await addendaKpi(ORG_A)).toBe(0);
  }, 60_000);

  it("tenant com 1 aditivo → KPI 1; múltiplos → contagem correta; refresh mantém", async () => {
    await seedAddendum(ORG_A, "contract-a1", 1);
    expect(await addendaKpi(ORG_A)).toBe(1);

    // Mais aditivos (mesmo contrato e outro contrato do mesmo tenant).
    await seedAddendum(ORG_A, "contract-a1", 2);
    await seedAddendum(ORG_A, "contract-a2", 1);
    expect(await addendaKpi(ORG_A)).toBe(3);

    // Refresh (nova consulta) mantém a contagem determinística.
    expect(await addendaKpi(ORG_A)).toBe(3);
  }, 60_000);

  it("isolamento multi-tenant: aditivo do tenant B não altera o KPI do tenant A", async () => {
    const before = await addendaKpi(ORG_A);
    await seedAddendum(ORG_B, "contract-b1", 1);
    await seedAddendum(ORG_B, "contract-b1", 2);
    expect(await addendaKpi(ORG_B)).toBe(2);
    // O KPI de A permanece inalterado pelo tenant B.
    expect(await addendaKpi(ORG_A)).toBe(before);
  }, 60_000);
});

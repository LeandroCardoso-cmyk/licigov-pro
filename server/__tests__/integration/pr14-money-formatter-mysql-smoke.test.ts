/**
 * R6 / PR-14 (SEM-012, INV-16) — formatador monetário ÚNICO e KPI rotulado pelo significado.
 *
 *  - unit: `formatCentsBRL` (centavos → "R$ 1.234,56", determinístico; string/null tolerados) e o formatador do
 *    servidor (`formatBRL`) é o MESMO;
 *  - guarda estática: as saídas da Contratação Direta (relatório de auditoria, relatório de processo, analytics,
 *    cards/estatísticas) não formatam centavos com `toLocaleString`/`Intl.NumberFormat` nem dividem por 100 à mão,
 *    e o KPI não se chama "Valor Total Contratado";
 *  - MySQL (com DATABASE_URL): o KPI `estimatedValueActiveCents` exclui rascunho e cancelada e é tenant-scoped.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";
import { formatCentsBRL, MONEY_MEANING } from "@shared/money";
import { formatBRL } from "../../domain/money";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("PR-14 — formatador monetário único", () => {
  it("centavos → pt-BR determinístico", () => {
    expect(formatCentsBRL(1234567)).toBe("R$ 12.345,67");
    expect(formatCentsBRL(5)).toBe("R$ 0,05");
    expect(formatCentsBRL(-150)).toBe("-R$ 1,50");
    expect(formatCentsBRL("250000")).toBe("R$ 2.500,00");
    expect(formatCentsBRL(null)).toBe("R$ 0,00");
    expect(formatCentsBRL(Number.NaN)).toBe("R$ 0,00");
  });

  it("o formatador do servidor é o mesmo", () => {
    for (const c of [0, 1, 99, 100, 123456789, -42]) expect(formatBRL(c)).toBe(formatCentsBRL(c));
  });

  it("rótulos dizem o significado do valor", () => {
    expect(MONEY_MEANING).toEqual({ estimated: "Valor estimado", reference: "Valor de referência", awarded: "Valor adjudicado", contracted: "Valor contratado" });
  });
});

describe("PR-14 — guarda estática das saídas de valor da Contratação Direta", () => {
  const SURFACES = [
    "server/services/directContractAuditReport.ts",
    "server/services/processReportService.ts",
    "client/src/components/direct-contracts-analytics/MetricsGrid.tsx",
    "client/src/components/direct-contracts-analytics/ChartsSection.tsx",
    "client/src/components/direct-contracts-analytics/RankingTables.tsx",
    "client/src/components/direct-contracts/DirectContractStats.tsx",
    "client/src/components/direct-contracts/DirectContractCard.tsx",
  ];

  it.each(SURFACES)("%s usa o formatador único", (rel) => {
    const src = code(rel);
    expect(src).toMatch(/formatCentsBRL\(/);
    expect(src).not.toMatch(/Intl\.NumberFormat\([^)]*currency/);
    expect(src).not.toMatch(/(value|Value)\s*(\/\s*100)?\)?\.toLocaleString\(/);
  });

  it("KPI não é rotulado como valor contratado", () => {
    expect(code("client/src/components/direct-contracts-analytics/MetricsGrid.tsx")).not.toContain("Valor Total Contratado");
    expect(code("client/src/components/direct-contracts-analytics/MetricsGrid.tsx")).toContain("estimatedValueActiveCents");
  });
});

const DB = process.env.DATABASE_URL;
const ORG = 960831;
const ORG_B = 960832;

describe.skipIf(!DB)("PR-14 — KPI de valor estimado (MySQL 8)", () => {
  let conn: mysql.Connection;
  let userId = 0;

  beforeAll(async () => {
    conn = await mysql.createConnection(DB!);
    const { runMigrations } = await import("../../bootstrap");
    await runMigrations(conn);
    for (const id of [ORG, ORG_B]) {
      await conn.execute("INSERT INTO organizations (id, nome, slug, ativo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE nome = VALUES(nome)", [id, `PR14 ${id}`, `pr14-${id}`]);
    }
    const [u] = await conn.execute<mysql.ResultSetHeader>(
      "INSERT INTO users (openId, name, email, loginMethod, role) VALUES (?, ?, ?, 'email', 'user')",
      [`pr14-${Date.now()}`, "PR14 Sintético", `pr14-${Date.now()}@teste.local`],
    );
    userId = u.insertId;
    await conn.execute("DELETE FROM direct_contracts WHERE organizationId IN (?, ?)", [ORG, ORG_B]);
    const rows: Array<[number, string, number]> = [
      [ORG, "draft", 100_00], [ORG, "cancelled", 200_00], [ORG, "approved", 1_234_567], [ORG, "completed", 33], [ORG_B, "approved", 999_999_99],
    ];
    let n = 0;
    for (const [org, status, value] of rows) {
      await conn.execute(
        "INSERT INTO direct_contracts (organizationId, number, year, type, object, justification, value, createdBy, status) VALUES (?, ?, 2026, 'dispensa', 'Objeto sintético', 'Justificativa sintética', ?, ?, ?)",
        [org, `PR14-${++n}`, value, userId, status],
      );
    }
  }, 300_000);

  afterAll(async () => {
    if (!conn) return;
    await conn.execute("DELETE FROM direct_contracts WHERE organizationId IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.execute("DELETE FROM users WHERE id = ?", [userId]).catch(() => {});
    await conn.execute("DELETE FROM organizations WHERE id IN (?, ?)", [ORG, ORG_B]).catch(() => {});
    await conn.end();
  });

  it("exclui rascunho e cancelada; só o órgão do contexto; valor em centavos", async () => {
    const { getEstimatedActiveValueCents } = await import("../../db/directContractsValueKpi");
    const { getDirectContractsOverviewForOrganization } = await import("../../db/directContracts");
    const kpi = await getEstimatedActiveValueCents(ORG);
    expect(kpi).toBe(1_234_567 + 33);
    expect(Number((await getDirectContractsOverviewForOrganization(ORG))!.totalValue)).toBe(100_00 + 200_00 + 1_234_567 + 33);
    expect(formatCentsBRL(kpi)).toBe("R$ 12.346,00");
    expect(await getEstimatedActiveValueCents(ORG_B)).toBe(999_999_99);
    expect(await getEstimatedActiveValueCents(960839)).toBe(0);
  }, 60_000);
});

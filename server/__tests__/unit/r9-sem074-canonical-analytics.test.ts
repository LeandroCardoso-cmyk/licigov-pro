/**
 * R9 / SEM-074 — Analytics/auditoria leem as fontes CANÔNICAS (procurement_processes / generated_documents),
 * agregadas em SQL — nunca as tabelas legadas sem escrita (`processes` / `documents`).
 *
 *   A. helpers puros (janela de meses UTC, chave de mês, ordenação por etapa canônica);
 *   B. guarda de fonte: `server/db/admin.ts` não importa nem consulta `processes`/`documents` e agrega em SQL.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import { monthKey, monthWindowStartUtc, toMonthCounts, toStageCounts } from "../../domain/canonicalAnalytics";

describe("R9 / SEM-074 — A. helpers puros", () => {
  it("janela de 6 meses termina no mês corrente (UTC) e começa no 1º dia, formato DATETIME(3)", () => {
    expect(monthWindowStartUtc(new Date("2026-10-02T12:00:00Z"), 6)).toBe("2026-05-01 00:00:00.000");
    expect(monthWindowStartUtc(new Date("2026-03-31T23:59:59Z"), 6)).toBe("2025-10-01 00:00:00.000"); // vira o ano
    expect(monthWindowStartUtc(new Date("2026-10-02T12:00:00Z"), 1)).toBe("2026-10-01 00:00:00.000");
    expect(monthWindowStartUtc(new Date("2026-10-02T12:00:00Z"), 0)).toBe("2026-10-01 00:00:00.000"); // mínimo 1 mês
  });

  it("toMonthCounts: chave YYYY-MM, números do driver como string, ordem cronológica", () => {
    expect(monthKey(2026, 9)).toBe("2026-09");
    expect(toMonthCounts([{ y: "2026", m: "10", count: "2" }, { y: 2026, m: 5, count: 3 }, { y: 2025, m: 12, count: 0 }]))
      .toEqual([{ month: "2026-05", count: 3 }, { month: "2026-10", count: 2 }]);
  });

  it("toStageCounts: contrato {status,count} com a etapa canônica, na ordem do fluxo; desconhecida ao final", () => {
    expect(toStageCounts([
      { stage: "TR", count: "1" }, { stage: "ZZZ", count: 1 }, { stage: "NEW_PROCESS", count: 4 }, { stage: "DFD", count: 2 },
    ])).toEqual([
      { status: "NEW_PROCESS", count: 4 }, { status: "DFD", count: 2 }, { status: "TR", count: 1 }, { status: "ZZZ", count: 1 },
    ]);
  });
});

describe("R9 / SEM-074 — B. guarda de fonte em server/db/admin.ts", () => {
  const src = fs.readFileSync("server/db/admin.ts", "utf-8");
  const importLine = src.match(/import\s*\{([^}]*)\}\s*from\s*"\.\.\/\.\.\/drizzle\/schema"/)?.[1] ?? "";
  const imported = importLine.split(",").map(s => s.trim()).filter(Boolean);

  it("não importa as tabelas legadas sem escrita", () => {
    expect(imported).not.toContain("processes");
    expect(imported).not.toContain("documents");
    expect(src).not.toMatch(/\.from\(\s*(processes|documents)\s*\)/);
  });

  it("lê as fontes canônicas e agrega em SQL (COUNT/GROUP BY), sem varrer tabelas em memória", () => {
    expect(imported).toEqual(expect.arrayContaining(["procurementProcessesTable", "generatedDocumentsTable"]));
    expect(src).toContain(".groupBy(procurementProcessesTable.currentStage)");
    expect(src).toMatch(/\.groupBy\(y, m\)/);
    expect(src).not.toMatch(/db\.select\(\)\.from\(activityLogs\)/); // ranking também agregado em SQL
    expect(src).not.toMatch(/for \(const \w+ of all(Processes|Documents|Activities)\)/);
  });
});

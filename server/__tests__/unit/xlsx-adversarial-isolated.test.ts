/**
 * SEC-AUD-07 — entradas ADVERSARIAIS contra o leitor XLSX de produção, executadas num PROCESSO FILHO com teto de
 * heap (nunca no processo dos testes/aplicação): metadado ZIP mentiroso, soma real de entradas, muitas abas,
 * intervalo esparso gigante, orçamento agregado entre abas, células reais acima do limite, tempo e memória
 * esgotados (o filho do leitor é morto) e concorrência entre tenants. O filho de teste roda com
 * NODE_OPTIONS=--max-old-space-size=4096 de propósito: o teto do leitor precisa valer mesmo assim.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { assertZipWithinLimits, scanZipRealContent, SPREADSHEET_LIMITS } from "../../parsers/spreadsheetLimits";
import { xlsxReaderEnv } from "../../parsers/xlsxReadIsolated";
import { rawZip, workbookBuffer } from "../helpers/xlsxFixture";

const ROOT = path.resolve(import.meta.dirname, "../../..");
type Line = Record<string, unknown> & { name: string; ms: number; maxLoopLagMs: number };
let results: Record<string, Line> = {};

beforeAll(() => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "--max-old-space-size=512", "server/__tests__/helpers/xlsxAdversarialRunner.ts"], {
    cwd: ROOT, encoding: "utf8", timeout: 300_000,
    env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=4096" },
  });
  expect(r.status, r.stderr).toBe(0);
  results = Object.fromEntries(r.stdout.trim().split("\n").map((l) => JSON.parse(l) as Line).map((l) => [l.name, l]));
}, 320_000);

describe("leitor XLSX × entradas adversariais (processo isolado)", () => {
  it("metadado mentiroso: o diretório declarado passa, a descompressão REAL barra (limites de produção)", () => {
    expect(results["metadado-inconsistente-limites-padrao"]).toMatchObject({ declaredCheck: "ok", outcome: "ZIP_TOO_LARGE" });
  });
  it("muitas entradas pequenas que somam além do orçamento real ⇒ ZIP_TOO_LARGE", () => {
    expect(results["soma-real-de-entradas"].outcome).toBe("ZIP_TOO_LARGE");
  });
  it("abas demais ⇒ recusado antes do leitor", () => {
    expect(results["muitas-abas"].outcome).toBe("TOO_MANY_SHEETS");
  });
  it("intervalo esparso A1:XFD1048576 ⇒ recusado sem alocar a matriz", () => {
    expect(results["intervalo-esparso-gigante"].outcome).toBe("TOO_MANY_CELLS");
  });
  it("cinco abas no limite individual somam além do orçamento agregado ⇒ recusado", () => {
    expect(results["orcamento-agregado-entre-abas"].outcome).toBe("TOO_MANY_CELLS");
  });
  it("células reais acima do limite ⇒ recusado antes do leitor", () => {
    expect(results["celulas-reais-acima-do-limite"].outcome).toBe("TOO_MANY_CELLS");
  });
  it("tempo esgotado ⇒ READ_TIMEOUT no prazo (o filho é morto, não apenas abandonado)", () => {
    const r = results["tempo-esgotado-encerra-o-filho"];
    expect(r.outcome).toBe("READ_TIMEOUT");
    expect(r.ms).toBeLessThan(2000);
  });
  it("memória esgotada ⇒ READ_MEMORY, mesmo com NODE_OPTIONS pedindo heap maior", () => {
    expect(results["memoria-esgotada-encerra-so-o-filho"].outcome).toBe("READ_MEMORY");
  });
  it("concorrência entre tenants: o arquivo hostil de A expira e a planilha de B é lida corretamente", () => {
    expect(results["concorrencia-entre-tenants"]).toMatchObject({ tenantA: "READ_TIMEOUT", tenantB: { matrix: [["Caneta", 1.5]] } });
  });
  it("planilha legítima grande (200 mil células) é lida dentro dos limites de produção", () => {
    expect(results["planilha-valida-dentro-dos-limites"]).toMatchObject({ outcome: "ok", rows: 20000 });
  });
  it("o event loop do processo que dispara a leitura fica livre em todos os casos", () => {
    for (const r of Object.values(results)) if ("maxLoopLagMs" in r) expect(r.maxLoopLagMs, r.name).toBeLessThan(250);
  });
});

describe("processo filho do leitor — ambiente mínimo", () => {
  it("não repassa segredos nem NODE_OPTIONS", () => {
    const saved = { ...process.env };
    Object.assign(process.env, { DATABASE_URL: "mysql://x:y@h/db", JWT_SECRET: "s", GEMINI_API_KEY: "k", NODE_OPTIONS: "--max-old-space-size=9999" });
    try {
      const env = xlsxReaderEnv();
      expect(Object.keys(env).sort()).toEqual(expect.arrayContaining(["NODE_ENV"]));
      for (const k of ["DATABASE_URL", "JWT_SECRET", "GEMINI_API_KEY", "NODE_OPTIONS", "AWS_SECRET_ACCESS_KEY"]) expect(env[k], k).toBeUndefined();
    } finally {
      process.env = saved;
    }
  });
});

describe("pré-varredura (unidade, sem leitor)", () => {
  it("conta abas e células reais de um XLSX normal; o diretório declarado bate com o real", async () => {
    const buf = await workbookBuffer((wb) => { const ws = wb.addWorksheet("S"); ws.addRow(["a", 1, true]); ws.addRow(["b", 2]); });
    const real = await scanZipRealContent(buf);
    expect(real).toMatchObject({ worksheets: 1, cells: 5 });
    expect(real.realUncompressedBytes).toBe(assertZipWithinLimits(buf).uncompressedBytes);
  });
  it("método de compressão desconhecido ⇒ ZIP_INVALID", async () => {
    const zip = rawZip([{ name: "xl/worksheets/sheet1.xml", data: Buffer.from("<c r=\"A1\"/>"), stored: true }]);
    zip.writeUInt16LE(12, 8); // local header: método 12 (bzip2)
    const cdh = zip.readUInt32LE(zip.length - 22 + 16);
    zip.writeUInt16LE(12, cdh + 10);
    await expect(scanZipRealContent(zip)).rejects.toMatchObject({ code: "ZIP_INVALID" });
  });
  it("o contador de células não confunde <col>/<cols>/<cfRule> e funciona entre pedaços do stream", async () => {
    const xml = `<worksheet><cols><col min="1"/></cols><conditionalFormatting><cfRule/></conditionalFormatting>${Array.from({ length: 70_000 }, (_, i) => `<c r="A${i + 1}" t="n"><v>${i * 7}</v></c>`).join("")}</worksheet>`;
    const real = await scanZipRealContent(rawZip([{ name: "xl/worksheets/sheet1.xml", data: Buffer.from(xml) }]));
    expect(real.cells).toBe(70_000);
    expect(SPREADSHEET_LIMITS.maxCellsPerWorkbook).toBeGreaterThan(70_000);
  });
});

describe("empacotamento", () => {
  it("o build gera a entrada do processo filho ao lado do bundle (dist/xlsxReadWorker.js)", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts.build).toContain("server/parsers/xlsxReadWorker.ts");
    expect(pkg.scripts.build).toContain("--entry-names=[name]");
    expect(pkg.scripts.start).toBe("node dist/index.js");
  });
});

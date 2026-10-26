/**
 * SEC-AUD-07 — entradas ADVERSARIAIS contra o leitor XLSX de produção (readXlsxIsolated). Executado SÓ em processo
 * filho com teto de heap (xlsx-adversarial-isolated.test.ts), nunca no processo da aplicação nem em produção.
 * Imprime uma linha JSON por caso: desfecho (código do limite ou "ok"), duração e o maior atraso observado no
 * event loop deste processo (prova de que a leitura não trava o processo que a dispara).
 */
import { performance } from "node:perf_hooks";
import { readXlsxIsolated } from "../../parsers/xlsxReadIsolated";
import { assertZipWithinLimits, SPREADSHEET_LIMITS, SpreadsheetLimitError, type SpreadsheetLimits } from "../../parsers/spreadsheetLimits";
import { rawZip, workbookBuffer } from "./xlsxFixture";

const limits = (over: Partial<SpreadsheetLimits>): SpreadsheetLimits => ({ ...SPREADSHEET_LIMITS, ...over });

async function outcome(p: Promise<unknown>): Promise<string> {
  try { await p; return "ok"; } catch (e) { return e instanceof SpreadsheetLimitError ? e.code : `erro:${(e as Error).name}`; }
}

/** `prepare` (montar o payload, fora da medição) → `run` (só a leitura, medida). */
type Case = { prepare: () => Promise<Buffer[]>; run: (bufs: Buffer[]) => Promise<Record<string, unknown>> };

async function measure(name: string, c: Case): Promise<void> {
  const bufs = await c.prepare();
  const run = () => c.run(bufs);
  let lag = 0;
  let last = performance.now();
  const timer = setInterval(() => { const now = performance.now(); lag = Math.max(lag, now - last - 10); last = now; }, 10);
  const t0 = performance.now();
  const extra = await run();
  clearInterval(timer);
  process.stdout.write(JSON.stringify({ name, ms: Math.round(performance.now() - t0), maxLoopLagMs: Math.round(lag), ...extra }) + "\n");
}

function denseRows(rows: number, cols: number) {
  return (wb: import("exceljs").Workbook) => {
    const ws = wb.addWorksheet("Dados");
    for (let r = 0; r < rows; r++) ws.addRow(Array.from({ length: cols }, (_, c) => (c % 2 ? r + c / 10 : `item ${r}-${c}`)));
  };
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const big = () => workbookBuffer(denseRows(30_000, 10));
  const cases: Record<string, Case> = {
    // Metadado mentiroso: diretório central declara 100 bytes; o conteúdo real expande para 300 MB.
    "metadado-inconsistente-limites-padrao": {
      prepare: async () => [rawZip([{ name: "xl/worksheets/sheet1.xml", data: Buffer.alloc(300 * 1024 * 1024, 0x20), declaredSize: 100 }])],
      run: async ([zip]) => {
        let declaredCheck = "ok";
        try { assertZipWithinLimits(zip); } catch (e) { declaredCheck = (e as SpreadsheetLimitError).code; }
        return { zipBytes: zip.length, declaredCheck, outcome: await outcome(readXlsxIsolated(zip)) };
      },
    },
    // Muitas entradas pequenas que, somadas, passam do orçamento real (cada uma declara 10 bytes).
    "soma-real-de-entradas": {
      prepare: async () => [rawZip(Array.from({ length: 300 }, (_, i) => ({ name: `xl/media/m${i}.bin`, data: Buffer.alloc(1024 * 1024), declaredSize: 10 })))],
      run: async ([zip]) => ({ outcome: await outcome(readXlsxIsolated(zip, limits({ maxUncompressedBytes: 64 * 1024 * 1024 }))) }),
    },
    "muitas-abas": {
      prepare: async () => [rawZip(Array.from({ length: 150 }, (_, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: Buffer.from("<worksheet/>") })))],
      run: async ([zip]) => ({ outcome: await outcome(readXlsxIsolated(zip)) }),
    },
    "intervalo-esparso-gigante": {
      prepare: async () => [await workbookBuffer((wb) => { const ws = wb.addWorksheet("S"); ws.getCell("A1").value = 1; ws.getCell("XFD1048576").value = 2; })],
      run: async ([buf]) => ({ outcome: await outcome(readXlsxIsolated(buf)) }),
    },
    "orcamento-agregado-entre-abas": {
      prepare: async () => [await workbookBuffer((wb) => {
        for (let i = 0; i < 5; i++) { const ws = wb.addWorksheet(`S${i}`); ws.getCell("A1").value = i; ws.getCell("CV10000").value = i; } // 1M por aba
      })],
      run: async ([buf]) => ({ outcome: await outcome(readXlsxIsolated(buf)) }),
    },
    "celulas-reais-acima-do-limite": {
      prepare: async () => [await workbookBuffer(denseRows(1000, 5))],
      run: async ([buf]) => ({ outcome: await outcome(readXlsxIsolated(buf, limits({ maxCellsPerWorkbook: 1000 }))) }),
    },
    "tempo-esgotado-encerra-o-filho": {
      prepare: async () => [await big()],
      run: async ([buf]) => ({ outcome: await outcome(readXlsxIsolated(buf, limits({ workerTimeoutMs: 300 }))) }),
    },
    "memoria-esgotada-encerra-so-o-filho": {
      prepare: async () => [await big()],
      run: async ([buf]) => ({ outcome: await outcome(readXlsxIsolated(buf, limits({ workerMaxOldGenerationMb: 24 }))) }),
    },
    // Tenant A envia arquivo que estoura o tempo; tenant B envia planilha normal ao mesmo tempo.
    "concorrencia-entre-tenants": {
      prepare: async () => [await big(), await workbookBuffer((wb) => wb.addWorksheet("Itens").addRow(["Caneta", 1.5]))],
      run: async ([heavy, small]) => {
        const t0 = performance.now();
        const [a, b] = await Promise.all([
          outcome(readXlsxIsolated(heavy, limits({ workerTimeoutMs: 800 }))),
          readXlsxIsolated(small).then((r) => ({ matrix: r.matrices.get("Itens"), ms: Math.round(performance.now() - t0) })),
        ]);
        return { tenantA: a, tenantB: b };
      },
    },
    "planilha-valida-dentro-dos-limites": {
      prepare: async () => [await workbookBuffer(denseRows(20_000, 10))],
      run: async ([buf]) => ({ outcome: "ok", rows: (await readXlsxIsolated(buf)).matrices.get("Dados")?.length }),
    },
  };
  for (const [name, c] of Object.entries(cases)) {
    if (only && only !== name) continue;
    await measure(name, c);
  }
  process.stdout.write(JSON.stringify({ name: "processo", rssMB: Math.round(process.memoryUsage().rss / 1e6) }) + "\n");
}

main().then(() => process.exit(0), (e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });

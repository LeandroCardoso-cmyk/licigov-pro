/**
 * SEC-AUD-07 — sonda executada em PROCESSO FILHO com `TZ` definido (xlsx-reader-goldens.test.ts): lê o corpus,
 * as fixtures e um XLSX de itens com o leitor de produção (worker isolado) e imprime JSON. Prova que a saída
 * não depende do fuso do processo (UTC × America/Sao_Paulo), sem pular teste.
 */
import { readXlsxIsolated } from "../../parsers/xlsxReadIsolated";
import { xlsxParser } from "../../parsers/xlsxParser";
import { fixture, workbookBuffer, xlsxBuffer, XLSX_MIME } from "./xlsxFixture";
import { SHEETJS_FIXTURES, toGolden, XLSX_CORPUS } from "./xlsxCorpus";

async function main(): Promise<void> {
  const goldens: Record<string, unknown> = {};
  for (const [k, build] of Object.entries(XLSX_CORPUS)) {
    const r = await readXlsxIsolated(await workbookBuffer(build));
    goldens[k] = toGolden(r.sheetNames, r.matrices);
  }
  for (const [k, file] of Object.entries(SHEETJS_FIXTURES)) {
    const r = await readXlsxIsolated(fixture(file));
    goldens[k] = toGolden(r.sheetNames, r.matrices);
  }
  const buf = await xlsxBuffer([["Itens", [
    ["Descrição", "Quantidade", "Valor unitário", "Data da cotação"],
    ["Caneta azul", 10, 1.234, new Date(Date.UTC(2026, 9, 25))],
    ["Papel A4", 2, 23.9, new Date(Date.UTC(2026, 0, 1))],
  ]]]);
  const parsed = await xlsxParser.parse(buf, {
    importSessionId: 1, organizationId: 1, sourceFileId: "k", sourceFileName: "itens.xlsx", sourceMimeType: XLSX_MIME, sourceChecksum: "c".repeat(64),
  });
  const items = parsed.items.map((i) => ({ d: i.rawDescription, p: i.rawUnitPrice, t: i.rawTypedValues?.rawUnitPrice, row: i.sourceLocation.rawRowData }));
  process.stdout.write(JSON.stringify({ tz: process.env.TZ, offsetJan: new Date(2026, 0, 1).getTimezoneOffset(), goldens, items }));
}

main().then(() => process.exit(0), (e) => { process.stderr.write(String(e?.stack ?? e)); process.exit(1); });

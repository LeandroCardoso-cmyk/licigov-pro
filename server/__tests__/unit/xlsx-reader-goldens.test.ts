/**
 * SEC-AUD-07 — leitor XLSX (`exceljs` em worker isolado) contra GOLDENS congelados do leitor anterior (SheetJS
 * 0.18.5, removido do produto e das dependências; ver fixtures/spreadsheets/README.md), bloqueio do `.xls`
 * (decisão do Owner), exportação e compatibilidade com sessões antigas. Dados fictícios.
 *
 * Fuso: a sonda roda em PROCESSO FILHO com TZ=UTC e TZ=America/Sao_Paulo e as duas saídas precisam ser iguais
 * ao golden — nenhum teste é pulado por fuso.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { readXlsxIsolated } from "../../parsers/xlsxReadIsolated";
import { detectSpreadsheetContainer } from "../../parsers/spreadsheetLimits";
import { xlsxParser } from "../../parsers/xlsxParser";
import { buildItemsWorkbook } from "../../services/excelService";
import { classifyRowsOutcome, isDeterministicParserError } from "../../domain/importOutcome";
import { detectParserType } from "../../domain/importTypes";
import { isDeclaredLegacyXls, XLS_SUSPENDED_MESSAGE } from "@shared/spreadsheetFormats";
import { fixture, FIXTURES_DIR, workbookBuffer, xlsxBuffer, XLSX_MIME, zipEntryText } from "../helpers/xlsxFixture";
import { SHEETJS_FIXTURES, toGolden, XLSX_CORPUS, type Golden } from "../helpers/xlsxCorpus";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const GOLDENS = JSON.parse(readFileSync(path.join(FIXTURES_DIR, "xlsx-goldens.json"), "utf8")) as Record<string, Golden>;
const XLS_MIME = "application/vnd.ms-excel";
const opts = (name: string, mime: string) => ({
  importSessionId: 1, organizationId: 1, sourceFileId: "k", sourceFileName: name, sourceMimeType: mime, sourceChecksum: "c".repeat(64),
});

describe("leitor XLSX × goldens do leitor anterior", () => {
  for (const [key, build] of Object.entries(XLSX_CORPUS)) {
    it(`(gerado por exceljs) ${key}`, async () => {
      const r = await readXlsxIsolated(await workbookBuffer(build));
      expect(toGolden(r.sheetNames, r.matrices)).toEqual(GOLDENS[key]);
    });
  }
  for (const [key, file] of Object.entries(SHEETJS_FIXTURES)) {
    it(`(escrito pelo SheetJS, outro gerador) ${key}`, async () => {
      const r = await readXlsxIsolated(fixture(file));
      expect(toGolden(r.sheetNames, r.matrices)).toEqual(GOLDENS[key]);
    });
  }

  it("aba vazia, mesclada secundária e fórmula: cache usado, nada executado", () => {
    expect(GOLDENS.abas.matrices.Vazia).toEqual([[""]]);
    expect(GOLDENS.mescladas.matrices.M[0]).toEqual(["Cabeçalho mesclado", "", ""]);
    expect(GOLDENS.formulas.matrices.F.map((r) => r[0])).toEqual([2, 6, "", "", "", "=HYPERLINK(\"http://evil.invalid\",\"x\")", "+5", "@SUM(A1)", "-2+3"]);
  });
});

describe("fuso horário — processo filho em UTC e em America/Sao_Paulo", () => {
  function probe(tz: string) {
    const r = spawnSync(process.execPath, ["--import", "tsx", "server/__tests__/helpers/xlsxTzProbe.ts"], {
      cwd: ROOT, env: { ...process.env, TZ: tz }, encoding: "utf8", timeout: 120_000,
    });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout) as { tz: string; offsetJan: number; goldens: Record<string, Golden>; items: unknown[] };
  }

  it("mesma matriz e mesmos itens nos dois fusos, iguais ao golden (datas, dinheiro)", () => {
    const utc = probe("UTC");
    const sp = probe("America/Sao_Paulo");
    expect(utc.offsetJan).toBe(0);
    expect(sp.offsetJan).toBe(180); // o processo filho estava de fato em UTC−3
    expect(sp.goldens).toEqual(utc.goldens);
    expect(sp.goldens).toEqual(GOLDENS);
    expect(sp.items).toEqual(utc.items);
    expect(sp.items).toEqual([
      { d: "Caneta azul", p: "1,234", t: { type: "number", value: "1.234" }, row: ["Caneta azul", "10", "1,234", "2026-10-25"] },
      { d: "Papel A4", p: "23,9", t: { type: "number", value: "23.9" }, row: ["Papel A4", "2", "23,9", "2026-01-01"] },
    ]);
  }, 240_000);
});

describe("XLS legado suspenso (decisão do Owner)", () => {
  const xls = fixture("itens-biff8.xls");

  it("a mensagem é exatamente a orientação de conversão combinada", () => {
    expect(XLS_SUSPENDED_MESSAGE).toBe(
      "O formato .xls está temporariamente indisponível. Abra o arquivo no Excel ou LibreOffice, salve como .xlsx e envie novamente.",
    );
  });

  it("XLS válido (BIFF8 real) ⇒ UNSUPPORTED_FORMAT com a orientação, sem itens", async () => {
    expect(detectSpreadsheetContainer(xls)).toBe("cfb");
    const r = await xlsxParser.safeParse(xls, opts("itens.xls", XLS_MIME));
    expect(r.items).toEqual([]);
    expect(r.errors).toEqual([{ code: "UNSUPPORTED_FORMAT", message: XLS_SUSPENDED_MESSAGE, fatal: true }]);
  });

  it("XLS disfarçado de XLSX (extensão e MIME de .xlsx, ou octet-stream) ⇒ bloqueado pelo conteúdo", async () => {
    for (const mime of [XLSX_MIME, "application/octet-stream"]) {
      const r = await xlsxParser.safeParse(xls, opts("itens.xlsx", mime));
      expect(r.errors[0]).toMatchObject({ code: "UNSUPPORTED_FORMAT", message: XLS_SUSPENDED_MESSAGE });
      expect(r.rawMetadata).toMatchObject({ detectedContainer: "cfb", unsupportedFormat: "xls" });
      expect(r.items).toEqual([]);
    }
  });

  it("arquivo declarado .xls é recusado mesmo com conteúdo XLSX (extensão/MIME incoerentes)", async () => {
    const real = await xlsxBuffer([["S", [["Descrição", "Valor"], ["Caneta", 1]]]]);
    for (const [name, mime] of [["itens.xls", "application/octet-stream"], ["itens.xlsx", XLS_MIME]] as const) {
      const r = await xlsxParser.safeParse(real, opts(name, mime));
      expect(r.errors[0]).toMatchObject({ code: "UNSUPPORTED_FORMAT", message: XLS_SUSPENDED_MESSAGE });
    }
  });

  it("XLSX válido ⇒ aceito pelo exceljs, versão do parser registrada", async () => {
    const r = await xlsxParser.safeParse(
      await xlsxBuffer([["Itens", [["Descrição", "Unidade", "Quantidade", "Valor unitário"], ["Caneta azul", "UN", 10, 2.5], ["Papel A4", "RS", 5, 23.9]]]]),
      opts("itens.xlsx", XLSX_MIME),
    );
    expect(r.errors).toEqual([]);
    expect(r.rawMetadata).toMatchObject({ engine: "exceljs", parserVersion: "1.4.0" });
    expect(r.items.map((i) => [i.rawDescription, i.rawUnitPrice])).toEqual([["Caneta azul", "2,5"], ["Papel A4", "23,9"]]);
  });

  it("não suportado ≠ corrompido: bytes que não são ZIP nem OLE com nome .xlsx ⇒ CORRUPT_FILE", async () => {
    for (const bad of [Buffer.from("texto qualquer"), Buffer.from("PK\u0003\u0004 não é xlsx")]) {
      const r = await xlsxParser.safeParse(bad, opts("x.xlsx", XLSX_MIME));
      expect(r.errors[0]?.code).toBe("CORRUPT_FILE");
    }
  });

  it("os dois códigos são determinísticos: falha final, sem reprocessamento automático", () => {
    for (const code of ["UNSUPPORTED_FORMAT", "CORRUPT_FILE"]) {
      expect(isDeterministicParserError(code)).toBe(true);
      expect(classifyRowsOutcome({ itemCount: 0, warningCodes: [], fatalCode: code, itemsNeedAttention: false })).toBe("PARSER_FAILED");
    }
  });

  it("capacidade anunciada só XLSX; declaração .xls reconhecida por extensão ou MIME", () => {
    expect(xlsxParser.capabilities.supportedExtensions).toEqual(["xlsx"]);
    expect(xlsxParser.capabilities.supportedMimeTypes).not.toContain(XLS_MIME);
    expect(isDeclaredLegacyXls("PLANILHA.XLS", "")).toBe(true);
    expect(isDeclaredLegacyXls("a.xlsx", XLS_MIME)).toBe(true);
    expect(isDeclaredLegacyXls("a.xlsx", XLSX_MIME)).toBe(false);
  });
});

describe("SheetJS fora do produto", () => {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as Record<string, Record<string, string> | undefined>;

  it("`xlsx` não está em nenhuma lista de dependências nem no lockfile", () => {
    for (const k of ["dependencies", "devDependencies", "optionalDependencies"]) expect(pkg[k]?.xlsx, k).toBeUndefined();
    expect(readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8")).not.toMatch(/^ {2}xlsx@/m);
  });

  it("nenhum import (estático ou dinâmico) de `xlsx` em server/, client/src/, shared/ ou scripts/", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir)) {
        const p = path.join(dir, e);
        if (e === "node_modules" || e === "fixtures") continue;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(m?[jt]sx?)$/.test(e) && /(from\s+|import\(\s*|require\(\s*)["']xlsx["']/.test(readFileSync(p, "utf8"))) hits.push(path.relative(ROOT, p));
      }
    };
    for (const d of ["server", "client/src", "shared", "scripts"]) if (existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
    expect(hits.filter((h) => h !== "server/__tests__/unit/xlsx-reader-goldens.test.ts")).toEqual([]);
  });
});

describe("compatibilidade com sessões antigas (sem reprocessar nada)", () => {
  it("tipo de parser `xls` continua reconhecido para sessões já gravadas (promoção, histórico)", () => {
    expect(detectParserType(XLS_MIME, "antiga.xls")).toBe("xls");
  });
});

describe("exportação de itens (exceljs)", () => {
  it("texto iniciado por '=' fica texto (sem <f> no XML), valores monetários como texto, aba e larguras", async () => {
    const data = [["Item", "Descrição", "Unidade"], [1, "=HYPERLINK(\"http://evil.invalid\")", "UN"], [], ["", "", "VALOR TOTAL:", "10.00"]];
    const buf = await buildItemsWorkbook(data);
    const sheetXml = zipEntryText(buf, "xl/worksheets/sheet1.xml") ?? "";
    expect(sheetXml).not.toContain("<f>");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Itens"]);
    const ws = wb.getWorksheet("Itens")!;
    expect(ws.getCell("B2").type).toBe(ExcelJS.ValueType.String);
    expect(ws.getCell("B2").value).toBe("=HYPERLINK(\"http://evil.invalid\")");
    expect(ws.getCell("D4").value).toBe("10.00");
    expect(ws.getColumn(3).width).toBe(50);
    const back = await readXlsxIsolated(buf);
    expect(back.matrices.get("Itens")).toEqual([
      ["Item", "Descrição", "Unidade", ""], [1, "=HYPERLINK(\"http://evil.invalid\")", "UN", ""], ["", "", "", ""], ["", "", "VALOR TOTAL:", "10.00"],
    ]);
  });
});

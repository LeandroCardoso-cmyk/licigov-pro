/**
 * SEC-AUD-07 — entrada do PROCESSO FILHO de leitura de XLSX (ver xlsxReadIsolated.ts). Roda fora do processo da
 * aplicação, com ambiente mínimo (sem DATABASE_URL, chaves ou sessão): recebe os bytes do arquivo pelo canal IPC,
 * devolve as matrizes ou um erro classificado e encerra.
 *
 * Empacotado como entrada própria do esbuild (`dist/xlsxReadWorker.js`, script `build` do package.json).
 */
import { readXlsxMatrices } from "./excelWorkbookMatrix";
import { SpreadsheetLimitError, type SpreadsheetLimits } from "./spreadsheetLimits";

export type XlsxWorkerRequest = { buffer: Uint8Array; limits: SpreadsheetLimits };
export type XlsxWorkerResponse =
  | { ok: true; sheetNames: string[]; matrices: Map<string, unknown[][]> }
  | { ok: false; kind: "limit"; code: string; message: string }
  | { ok: false; kind: "corrupt" };

function reply(res: XlsxWorkerResponse): void {
  process.send?.(res, () => process.exit(0));
}

if (process.send) {
  process.once("message", (req: XlsxWorkerRequest) => {
    readXlsxMatrices(Buffer.from(req.buffer.buffer, req.buffer.byteOffset, req.buffer.byteLength), req.limits)
      .then((r) => reply({ ok: true, sheetNames: r.sheetNames, matrices: r.matrices }))
      .catch((err: unknown) => reply(err instanceof SpreadsheetLimitError
        ? { ok: false, kind: "limit", code: err.code, message: err.message }
        : { ok: false, kind: "corrupt" }));
  });
}

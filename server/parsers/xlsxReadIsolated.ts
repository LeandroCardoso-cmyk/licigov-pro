/**
 * SEC-AUD-07 — leitura de XLSX enviado por usuário em PROCESSO FILHO isolado, nunca no processo da aplicação:
 *   - teto de heap próprio (`--max-old-space-size` do filho): estouro derruba só o filho. Um worker_thread NÃO
 *     serve: `--max-old-space-size` global (linha de comando ou NODE_OPTIONS) anula o `resourceLimits` dele
 *     (verificado em Node 22);
 *   - teto de tempo: SIGKILL no filho interrompe inclusive código síncrono (um Promise.race com timeout só para de
 *     esperar — o parser continua consumindo CPU e memória);
 *   - ambiente mínimo: o filho não recebe DATABASE_URL, chaves, sessão nem NODE_OPTIONS — só os bytes do arquivo;
 *   - um filho por vez por processo (fila FIFO): uploads simultâneos de tenants diferentes não somam memória, e o
 *     event loop da aplicação segue livre enquanto o filho trabalha.
 * Os limites de conteúdo (bytes reais, células, abas) continuam valendo DENTRO do filho (spreadsheetLimits.ts).
 */
import { fork, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { MatrixCell, WorkbookMatrices } from "./excelWorkbookMatrix";
import { SPREADSHEET_LIMITS, SpreadsheetLimitError, type SpreadsheetLimits } from "./spreadsheetLimits";
import type { XlsxWorkerRequest, XlsxWorkerResponse } from "./xlsxReadWorker";

/** Leitor indisponível (entrada ausente do pacote ou falha ao iniciar): erro de infraestrutura, não do arquivo. */
export class XlsxReaderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxReaderUnavailableError";
  }
}

/** Produção: `dist/xlsxReadWorker.js` ao lado do bundle. Dev/teste: o fonte .ts com o loader do tsx. */
function childEntry(): { path: string; execArgv: string[] } {
  const js = fileURLToPath(new URL("./xlsxReadWorker.js", import.meta.url));
  if (existsSync(js)) return { path: js, execArgv: [] };
  const ts = fileURLToPath(new URL("./xlsxReadWorker.ts", import.meta.url));
  if (existsSync(ts)) return { path: ts, execArgv: ["--import", "tsx"] };
  throw new XlsxReaderUnavailableError("Leitor de planilhas indisponível (entrada ausente do pacote).");
}

/** Só o necessário para o Node e o tsx rodarem; nenhum segredo da aplicação. */
export function xlsxReaderEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const k of ["PATH", "HOME", "TMPDIR", "TZ", "LANG"]) if (process.env[k]) env[k] = process.env[k];
  env.NODE_ENV = process.env.NODE_ENV === "production" ? "production" : "development";
  return env;
}

let running = false;
const waiting: Array<() => void> = [];

async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (running) await new Promise<void>((resolve) => waiting.push(resolve));
  running = true;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); else running = false;
  }
}

export function readXlsxIsolated(buffer: Buffer, limits: SpreadsheetLimits = SPREADSHEET_LIMITS): Promise<WorkbookMatrices> {
  return exclusive(() => runChild(buffer, limits));
}

function runChild(buffer: Buffer, limits: SpreadsheetLimits): Promise<WorkbookMatrices> {
  const entry = childEntry();
  return new Promise<WorkbookMatrices>((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = fork(entry.path, [], {
        execArgv: [`--max-old-space-size=${limits.workerMaxOldGenerationMb}`, ...entry.execArgv],
        env: xlsxReaderEnv(),
        serialization: "advanced", // Map/Date/Uint8Array atravessam o IPC sem conversão manual
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
    } catch {
      reject(new XlsxReaderUnavailableError("Falha ao iniciar o leitor de planilhas."));
      return;
    }
    let stderrTail = "";
    child.stderr?.on("data", (d: Buffer) => { stderrTail = (stderrTail + d.toString("utf8")).slice(-4096); });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new SpreadsheetLimitError(
      "READ_TIMEOUT", "A leitura da planilha excedeu o tempo máximo de processamento.",
    ))), limits.workerTimeoutMs);

    child.once("message", (res: XlsxWorkerResponse) => finish(() => {
      if (res.ok) resolve({ sheetNames: res.sheetNames, matrices: res.matrices as Map<string, MatrixCell[][]> });
      else if (res.kind === "limit") reject(new SpreadsheetLimitError(res.code as SpreadsheetLimitError["code"], res.message));
      else reject(new Error("CORRUPT"));
    }));
    child.once("error", () => finish(() => reject(new XlsxReaderUnavailableError("Falha no leitor de planilhas."))));
    // "close" (não "exit"): só dispara depois de o canal IPC e o stderr fecharem — a resposta já foi entregue.
    child.once("close", (code, signal) => finish(() => reject(
      /heap limit|out of memory|allocation failed/i.test(stderrTail)
        ? new SpreadsheetLimitError("READ_MEMORY", "A planilha excede o limite de memória para importação.")
        : new XlsxReaderUnavailableError(`Leitor de planilhas encerrou sem resposta (${signal ?? code}).`),
    )));

    child.send({ buffer: new Uint8Array(buffer), limits } satisfies XlsxWorkerRequest);
  });
}

/**
 * R11 — guardas TRANSVERSAIS de não-regressão da autoridade semântica (R11.1–R11.6). Estáticas e determinísticas:
 * falham quando um padrão que a remediação removeu volta ao código.
 *
 *  R11.1 autoridade semântica — documento oficial nunca tem autor "multi_copilot"; nenhuma referência fictícia
 *        (`s3://anexo`); nenhuma decisão por default (`?? "ratificado"`).
 *  R11.2 create ≠ upsert — os inserts de criação/ledger não usam ON DUPLICATE KEY UPDATE.
 *  R11.3 fonte do tenant — router que lê `input.organizationId` está atrás do gate experimental ou é admin.
 *  R11.4 ação cega — decisões/aceites exigem escolha explícita (sem pré-seleção) na UI.
 *  R11.5 IA nunca decide — serviços que registram decisão/emissão/lifecycle não importam IA.
 *  R11.6 imutabilidade — `official_documents` só recebe UPDATE de referências de storage; ledgers append-only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, e);
    if (e === "__tests__" || e === "node_modules") continue;
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(rel);
  }
  return out;
}
const SERVER = walk("server");
const CLIENT = walk("client/src");

function fnBody(src: string, name: string): string {
  const start = src.search(new RegExp(`export async function ${name}\\b`));
  expect(start, name).toBeGreaterThan(-1);
  const rest = src.slice(start + 10);
  const next = rest.search(/\nexport (async )?function |\nexport const |\nexport class /);
  return src.slice(start, next === -1 ? undefined : start + 10 + next);
}

describe("R11.1 — autoridade semântica", () => {
  it("nenhum documento oficial com autor multi_copilot", () => {
    const hits = SERVER.filter((f) => /author:\s*"multi_copilot"/.test(code(f)));
    expect(hits).toEqual([]);
  });
  it("nenhuma referência documental fictícia", () => {
    expect([...SERVER, ...CLIENT].filter((f) => /["'`]s3:\/\/anexo["'`]/.test(code(f)))).toEqual([]);
  });
  it("nenhuma decisão de ratificação por default", () => {
    expect(SERVER.filter((f) => /\?\?\s*"ratificado"/.test(code(f)))).toEqual([]);
  });
});

describe("R11.2 — criação não é upsert", () => {
  const CASES: Array<[string, string[]]> = [
    ["server/db/contractWorkspace.ts", ["insertNewContractWorkspace"]],
    ["server/db/institutionalDecisions.ts", ["insertDecision"]],
    ["server/db/processLifecycle.ts", ["insertLifecycleEvent", "insertNextGeneration"]],
  ];
  it.each(CASES)("%s", (file, fns) => {
    const src = code(file);
    for (const fn of fns) expect(fnBody(src, fn), fn).not.toMatch(/onDuplicateKeyUpdate/);
  });
});

describe("R11.3 — organizationId nunca vem do cliente fora do gate", () => {
  it("router que lê input.organizationId é experimental (fail-closed) ou admin", () => {
    const offenders = SERVER.filter((f) => f.startsWith("server/routers/")).filter((f) => {
      const src = code(f);
      if (!/input\.organizationId/.test(src)) return false;
      return !/experimentalProtectedProcedure|experimentalApiGate|adminProcedure|platformAdminProcedure/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});

describe("R11.4 — sem ação cega", () => {
  it("ratificação sem desfecho pré-selecionado", () => {
    const src = code("client/src/components/direct-procurement/RatificationWorkspace.tsx");
    expect(src).not.toMatch(/useState(<[^>]*>)?\(\s*"(ratificado|nao_ratificado)"/);
  });
  it("aceites explícitos nas justificativas e confirmação de regeneração", () => {
    expect(code("client/src/components/direct-procurement/ContractJustificationWorkspace.tsx")).toMatch(/confirmAccept:\s*true/);
    expect(code("client/src/components/direct-procurement/PriceJustificationWorkspace.tsx")).toMatch(/confirmOfficial:\s*true/);
    expect(CLIENT.some((f) => /RegenerationConfirmDialog/.test(f))).toBe(true);
  });
});

describe("R11.5 — IA nunca decide", () => {
  const DECIDERS = [
    "server/services/institutionalDecisionService.ts",
    "server/services/processLifecycleService.ts",
    "server/services/documentPromotionService.ts",
    "server/domain/institutionalDecision.ts",
    "server/domain/processLifecycle.ts",
    "server/domain/requiredDocumentEvidence.ts",
    "server/domain/legalReviewPolicy.ts",
  ];
  it.each(DECIDERS)("%s não importa IA/copilotos", (f) => {
    const imports = code(f).match(/^import .*$/gm) ?? [];
    expect(imports.filter((l) => /_core\/llm|\/ai\/|aiExecution|copilot|orchestrat|cognitive|structuredAuthoring/i.test(l))).toEqual([]);
  });
});

describe("R11.6 — imutabilidade do emitido e dos ledgers", () => {
  it("official_documents: o único UPDATE é de referências de storage", () => {
    const updates = SERVER.flatMap((f) => (code(f).match(/update\(officialDocumentsTable\)[\s\S]{0,200}/g) ?? []).map((m) => ({ f, m })));
    expect(updates.map((u) => u.f)).toEqual(["server/db/officialDocuments.ts"]);
    const set = updates[0]!.m.match(/\.set\(\{([^}]*)\}/)![1]!;
    expect(set).not.toMatch(/\bcontent\b|\bstatus\b|\bversion\b|\bmetadata\b/);
  });
  it("ledgers append-only: sem UPDATE/DELETE de decisões e eventos de lifecycle", () => {
    for (const t of ["institutionalDecisionsTable", "procurementProcessLifecycleEventsTable"]) {
      expect(SERVER.filter((f) => new RegExp(`(update|delete)\\(${t}\\)`).test(code(f))), t).toEqual([]);
    }
  });
});

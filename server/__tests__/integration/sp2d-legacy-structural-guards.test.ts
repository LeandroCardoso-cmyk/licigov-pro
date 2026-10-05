/**
 * SP2-D — guards ESTRUTURAIS (estáticos, sem banco) para que as mitigações de legado não regridam em silêncio:
 *  - SEM-034: nenhum escritor de itens/sugestões CATMAT legados é alcançável (só `db/processItems.ts` toca as tabelas;
 *    escritores não-escopados são privados; as 9 procedures de `processes` recusam como PRIMEIRA instrução);
 *    o código CATMAT do item só é gravado pelo caminho governado (ledger).
 *  - SEM-036: ninguém importa os geradores legados (`services/gemini`); nenhum `estimatedValue || 0` em routers/serviços.
 *  - SEM-078/079: nenhuma mutação de conteúdo de `documents` aprovado nem insert sem organização por caller de router;
 *    os 3 mutadores têm o guard de imutabilidade; `createDocument` legado é fail-closed.
 * Cada guard enumera os callers REAIS por varredura de código: um novo caller faz o teste falhar (precisa de decisão).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (name === "node_modules" || name === "__tests__" || name === "graphify-out") continue;
    const st = statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
  }
  return out;
}
const SERVER = walk("server");

/** Código sem comentários (linha e bloco) — evita falso positivo em docstrings. */
function code(rel: string): string {
  return read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
const filesMatching = (re: RegExp, except: string[] = []) =>
  SERVER.filter((f) => !except.includes(f) && re.test(code(f))).sort();

describe("SEM-034 — escritores CATMAT/itens legados", () => {
  const UNSCOPED_WRITERS = ["saveProcessItems", "updateProcessItem", "deleteProcessItem", "createCatmatSuggestion", "updateCatmatSuggestion", "rejectOtherSuggestions"];
  const SCOPED_WRITERS = [
    "saveProcessItemsForOrganization", "updateProcessItemForOrganization", "deleteProcessItemForOrganization",
    "createCatmatSuggestionForOrganization", "updateCatmatSuggestionForOrganization", "rejectOtherSuggestionsForOrganization",
  ];

  it("só server/db/processItems.ts escreve em process_items/catmat_suggestions", () => {
    expect(filesMatching(/\.(update|insert|delete)\((processItems|catmatSuggestions)\b/)).toEqual(["server/db/processItems.ts"]);
  });

  it("escritores NÃO-escopados são privados do módulo (não exportados)", () => {
    const src = code("server/db/processItems.ts");
    for (const fn of UNSCOPED_WRITERS) {
      expect(src, fn).toMatch(new RegExp(`^async function ${fn}\\(`, "m"));
      expect(src, fn).not.toMatch(new RegExp(`export\\s+(async\\s+)?function\\s+${fn}\\b`));
    }
  });

  it("ninguém além de db/processItems.ts chama escritores (escopados ou não) — processes.* legados estão desativados", () => {
    const callers = filesMatching(new RegExp(`\\b(${[...UNSCOPED_WRITERS, ...SCOPED_WRITERS].join("|")})\\(`), ["server/db/processItems.ts"]);
    // (procedimentos com o mesmo nome em processesRouter não são chamadas: o padrão exige `nome(`)
    expect(callers).toEqual([]);
  });

  it("as 9 procedures legadas de processes recusam como PRIMEIRA instrução (antes de qualquer leitura/escrita/IA)", () => {
    const src = read("server/routers/processesRouter.ts");
    const procs = ["addItemsToTR", "getProcessItems", "parseItemsFile", "generateCatmatSuggestions", "getCatmatSuggestions", "approveCatmatSuggestion", "rejectCatmatSuggestion", "updateProcessItem", "deleteProcessItem"];
    for (const proc of procs) {
      const start = src.indexOf(`\n  ${proc}: tenantProcedure`);
      expect(start, proc).toBeGreaterThan(-1);
      const end = src.indexOf("\n  }),", start) === -1 ? src.indexOf("\n    }),", start) : Math.min(...["\n    }),", "\n  }),"].map((m) => src.indexOf(m, start)).filter((i) => i > -1));
      const block = src.slice(start, end);
      const body = block.slice(block.indexOf("=> {") + 4);
      const statements = body.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
      expect(statements[0], proc).toBe(`throwLegacyEndpointDisabled("processes.${proc}", LEG005, ctx, LEG005_ALTERNATIVE);`);
      expect(block, proc).not.toMatch(/\bdb\.\w+\(|invokeLLM|findCatmatMatches/);
    }
  });

  it("o código CATMAT do item (suggestedCatmat) só é gravado pelo caminho governado: updateItemCatmat ← governedCatmatDecision ← ledger", () => {
    expect(filesMatching(/\bupdateItemCatmat\b/)).toEqual(["server/db/procurement.ts", "server/routers/itemIntelligenceRouter.ts"]);
    const router = code("server/routers/itemIntelligenceRouter.ts");
    expect(router.match(/\bupdateItemCatmat\(/g)).toHaveLength(1);
    // a escrita fica DEPOIS de decideCatmat (ledger) e só fora de replay
    const decideAt = router.indexOf("await decideCatmat(");
    const writeAt = router.indexOf("await updateItemCatmat(");
    expect(decideAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(decideAt);
    expect(router.slice(decideAt, writeAt)).toContain("if (!replayed)");
    // as 3 mutations que decidem passam por governedCatmatDecision (nenhuma escreve código direto)
    expect(router.match(/await governedCatmatDecision\(/g)).toHaveLength(3);
  });
});

describe("SEM-036 — geradores legados de ETP/TR/Edital", () => {
  it("nenhum arquivo de servidor (router/serviço/domínio) importa os geradores legados services/gemini", () => {
    const importers = SERVER.filter((f) => f !== "server/services/gemini.ts" && /from\s+["'][^"']*\/gemini["']/.test(code(f)) && /services\/gemini["']/.test(code(f)));
    expect(importers).toEqual([]);
    const dynamic = filesMatching(/import\(\s*["'][^"']*services\/gemini["']\s*\)|require\(\s*["'][^"']*services\/gemini["']\s*\)/);
    expect(dynamic).toEqual([]);
  });

  it("documents.generateNext/generateDocument continuam registradas e recusam como primeira instrução", () => {
    const src = read("server/routers/documentsRouter.ts");
    for (const proc of ["generateNext", "generateDocument"]) {
      const start = src.indexOf(`\n  ${proc}: tenantProcedure`);
      expect(start, proc).toBeGreaterThan(-1);
      const block = src.slice(start, src.indexOf("\n    }),", start));
      const body = block.slice(block.indexOf("=> {") + 4).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//"));
      expect(body[0], proc).toBe(`throwLegacyEndpointDisabled("documents.${proc}", "LEG-009", ctx, LEG009_ALTERNATIVE);`);
    }
  });

  it("os geradores do caminho canônico (procurementProcess.generate*) são os ÚNICOS chamadores de generateDocument de serviço", () => {
    expect(filesMatching(/\bgenerateDocument\(\{/)).toEqual(["server/routers/procurementProcessRouter.ts"]);
  });

  it("nenhum router/serviço fabrica valor estimado com `estimatedValue || 0` / `?? 0` (valor é autoria do servidor, nunca default)", () => {
    const offenders = SERVER.filter((f) => /^server\/(routers|services)\//.test(f) && /estimatedValue\s*(\|\||\?\?)\s*0\b/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("aiAssistant não injeta R$ 0,00: sem estimativa o contexto leva null e o prompt diz 'não informado'", async () => {
    const { processBlock } = await import("../../services/ai/promptBuilder");
    const none = processBlock({ name: "P", object: "O", estimatedValue: null });
    expect(none).toContain("não informado");
    expect(none).not.toMatch(/R\$\s*0,00/);
    expect(processBlock({ name: "P", object: "O", estimatedValue: 150000 })).toMatch(/R\$\s*1\.500,00/);
  });
});

describe("SEM-078 / SEM-079 — conteúdo de documents aprovado e inserts sem organização", () => {
  it("nenhum router/serviço fora dos 3 mutadores chama updateDocumento/publishDraft/restoreToVersion", () => {
    const callers = filesMatching(/\b(updateDocumento|publishDraft|restoreToVersion)\b/, [
      "server/services/documentService.ts", "server/services/documentDraftService.ts", "server/services/documentVersionService.ts",
    ]);
    expect(callers).toEqual([]);
  });

  it("os 3 mutadores aplicam assertDocumentContentMutable ANTES de qualquer escrita", () => {
    for (const [file, fn] of [
      ["server/services/documentService.ts", "updateDocumento"],
      ["server/services/documentDraftService.ts", "publishDraft"],
      ["server/services/documentVersionService.ts", "restoreToVersion"],
    ] as const) {
      const src = code(file);
      const assertAt = src.indexOf(`assertDocumentContentMutable(doc, "${fn}")`);
      expect(assertAt, fn).toBeGreaterThan(-1);
      const fnAt = src.indexOf(`function ${fn}(`);
      const firstWrite = src.slice(fnAt).search(/\.(update|insert)\(|createVersion\(/);
      expect(assertAt - fnAt, fn).toBeLessThan(firstWrite);
    }
  });

  it("db/processes: createDocument exige organizationId e o escritor sem organização (updateDocumentStatus) não existe mais", () => {
    const src = code("server/db/processes.ts");
    expect(src).toContain("export async function createDocument(document: InsertDocument & { organizationId: number })");
    expect(src).toContain("LEGACY_DOCUMENT_ORGANIZATION_REQUIRED");
    expect(src).toContain("LEGACY_DOCUMENT_PROCESS_ORGANIZATION_MISMATCH");
    expect(src).not.toMatch(/export async function updateDocumentStatus\(/);
    expect(src).toMatch(/export async function updateDocumentStatusForOrganization\(/);
  });

  it("todo `insert(documents)` de código de aplicação tem organizationId explícito ou passa pelo ciclo oficial", () => {
    // db/processes.ts (createDocument) tem teste dedicado acima: valida organização e processo ANTES do insert.
    const inserts = filesMatching(/\.insert\(documents\)/, ["server/db/processes.ts"]);
    for (const f of inserts) {
      const src = code(f);
      for (const m of src.matchAll(/\.insert\(documents\)\.values\(([\s\S]{0,400}?)\)/g)) {
        expect(m[1], f).toMatch(/organizationId|\.\.\.document\b/);
      }
    }
  });

  it("createDocument legado é fail-closed sem banco: sem organizationId ⇒ erro estável, sem tocar o banco", async () => {
    const { createDocument } = await import("../../db/processes");
    await expect(createDocument({ processId: 1, type: "dfd" } as never)).rejects.toThrow(/LEGACY_DOCUMENT_ORGANIZATION_REQUIRED/);
    await expect(createDocument({ processId: 1, type: "dfd", organizationId: -3 } as never)).rejects.toThrow(/LEGACY_DOCUMENT_ORGANIZATION_REQUIRED/);
  });

  it("assertDocumentContentMutable: só 'approved' é imutável (rascunho/revisão/rejeitado editam)", async () => {
    const { assertDocumentContentMutable, DOCUMENT_APPROVED_IMMUTABLE } = await import("../../domain/documentImmutability");
    for (const s of ["draft", "in_review", "rejected", null, undefined]) {
      expect(() => assertDocumentContentMutable({ id: 1, documentStatus: s }, "t"), String(s)).not.toThrow();
    }
    expect(() => assertDocumentContentMutable({ id: 1, documentStatus: "approved" }, "t")).toThrow(DOCUMENT_APPROVED_IMMUTABLE);
  });
});

describe("SEM-088 — verificador de amostra rotulado", () => {
  it("resultados do tenantIsolationAuditService declaram coverage=caller_supplied_sample", async () => {
    const svc = await import("../../services/tenantIsolationAuditService");
    expect(svc.scanCrossTenantAccess(1, []).coverage).toBe("caller_supplied_sample");
    expect(read("server/services/tenantIsolationAuditService.ts")).toContain("VERIFICADORES DE AMOSTRA");
  });
});

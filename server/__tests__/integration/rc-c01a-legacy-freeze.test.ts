/**
 * RC-C0.1A — Congelamento formal do legado documental (Licitação / Processo
 * Licitatório). Transforma o congelamento MAINTENANCE_ONLY registrado em
 * docs/architecture/LEGACY_INVENTORY.md e server/kernel/architecture/legacyBoundaries.ts
 * em regras obrigatórias do CI.
 *
 * Estratégia de allowlist (snapshot do estado em 2026-07-20, dia da Sprint C0.1A):
 * o legado já tem consumidores — não é possível proibi-los retroativamente sem quebrar
 * o produto em uso. A partir daqui, QUALQUER consumidor/rota/tipo NOVO faz o CI falhar;
 * REDUÇÃO (migração de um consumidor para o canônico) é sempre permitida e não quebra
 * este arquivo — os testes usam inclusão de baseline (todo item atual deve estar no
 * baseline), nunca igualdade estrita de conjunto.
 *
 * Para atualizar a allowlist: só em migração autorizada explicitamente (ver
 * docs/architecture/LEGACY_INVENTORY.md, critério de saída). Adicionar um novo arquivo
 * ao baseline é uma decisão arquitetural revisável — nunca um atalho para silenciar
 * este teste.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import {
  LEGACY_ACTIVE_MAINTENANCE_ONLY, CANONICAL_NOT_YET_WIRED, normalizeBoundaryPath,
} from "../../kernel/architecture/legacyBoundaries";

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) acc.push(full);
  }
  return acc;
}

const CLIENT_SRC = walk("client/src").filter(f => !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"));
const SERVER_SRC = walk("server").filter(f => !f.includes("__tests__") && !f.endsWith(".test.ts"));
const read = (f: string) => fs.readFileSync(f, "utf-8");

// ─── Baselines congelados (RC-C0.1A) ───────────────────────────────────────────

const DOCUMENTS_CONSUMERS_BASELINE: readonly string[] = [
  "client/src/components/VersionHistoryDialog.tsx",
  "client/src/components/document-flow/DocumentApprovalPanel.tsx",
  "client/src/hooks/documents/useProcessDocuments.ts",
  "client/src/pages/ProcessDetails.tsx",
];

const PROCESSES_CONSUMERS_BASELINE: readonly string[] = [
  "client/src/components/CatmatSuggestionsModal.tsx",
  "client/src/components/EditItemDialog.tsx",
  "client/src/components/ImportItemsModal.tsx",
  "client/src/components/TRItemsModal.tsx",
  "client/src/pages/ActivityReport.tsx",
  "client/src/pages/Admin.tsx",
  "client/src/pages/Dashboard.tsx",
  "client/src/pages/ModuleSelectionDashboard.tsx",
  "client/src/pages/NewLegalOpinion.tsx",
  "client/src/pages/NewProcess.tsx",
  "client/src/pages/ProcessDetails.tsx",
];

const GEMINI_IMPORTERS_BASELINE: readonly string[] = [
  "server/routers/documentsRouter.ts",
  "server/routers/processesRouter.ts",
];

// 7 tipos documentais do legado — DOC_ORDER (client) e docType (server) devem
// permanecer exatamente iguais a este conjunto. Ata NUNCA foi migrada para o
// canônico (ver LEGACY_INVENTORY.md) — se um dia for, remova daqui igual ao resto.
const LEGACY_DOC_TYPES_BASELINE = ["dfd", "etp", "tr", "edital", "contrato", "ata", "parecer"] as const;

// Rotas legadas de Licitação → componente. Nenhuma OUTRA rota pode montar estes
// componentes (isso seria "nova rota apontando para página legada").
const LEGACY_PROCESS_ROUTES_BASELINE: Record<string, string> = {
  "/processos": "Dashboard",
  "/processo/:id": "ProcessDetails",
  "/novo-processo": "NewProcess",
};

describe("RC-C0.1A — Congelamento do legado documental (Licitação)", () => {
  // ── 1. novo consumidor de trpc.documents.* ──────────────────────────────────
  it("nenhum novo consumidor de trpc.documents.* além do baseline congelado", () => {
    const consumers = CLIENT_SRC.filter(f => read(f).includes("trpc.documents."));
    const novos = consumers.filter(f => !DOCUMENTS_CONSUMERS_BASELINE.includes(f));
    expect(novos, `novo(s) consumidor(es) de trpc.documents.* fora do baseline: ${novos.join(", ")}`).toEqual([]);
  });

  // ── 2. novo consumidor de trpc.processes.* ──────────────────────────────────
  it("nenhum novo consumidor de trpc.processes.* além do baseline congelado", () => {
    const consumers = CLIENT_SRC.filter(f => read(f).includes("trpc.processes."));
    const novos = consumers.filter(f => !PROCESSES_CONSUMERS_BASELINE.includes(f));
    expect(novos, `novo(s) consumidor(es) de trpc.processes.* fora do baseline: ${novos.join(", ")}`).toEqual([]);
  });

  // ── 3. nova importação de server/services/gemini.ts ─────────────────────────
  it("nenhum novo importador de server/services/gemini.ts além do baseline (documentsRouter, processesRouter)", () => {
    // Só linhas de import reais (ignora comentários/docstrings que mencionem o caminho).
    const isRealImport = (src: string) =>
      src.split("\n").some(line => {
        const t = line.trim();
        return (t.startsWith("import ") || t.startsWith("import{") || /=\s*require\(/.test(t))
          && /["']\.\.?\/.*services\/gemini["']/.test(t);
      });
    const importers = SERVER_SRC.filter(f => isRealImport(read(f)));
    const novos = importers.filter(f => !GEMINI_IMPORTERS_BASELINE.includes(f));
    expect(novos, `novo(s) importador(es) de gemini.ts: ${novos.join(", ")}`).toEqual([]);
  });

  // 4. Nova chamada direta a @google/generative-ai fora de AI_SDK_ALLOWLIST já é
  //    coberta continuamente por rc352-boundary-enforcement.test.ts (allowlist
  //    fechada — qualquer novo acesso exige editar legacyBoundaries.ts). Não duplicado aqui.

  // ── 5. novo tipo documental no legado ────────────────────────────────────────
  it("o conjunto de tipos documentais do legado não cresce (dfd/etp/tr/edital/contrato/ata/parecer)", () => {
    const routerSrc = read("server/routers/documentsRouter.ts");
    const typesSrc = read("client/src/components/document-flow/types.ts");
    const routerMatches = [...routerSrc.matchAll(/docType:\s*z\.enum\(\[([^\]]+)\]\)/g)];
    expect(routerMatches.length, "documentsRouter.ts deveria ter 2 declarações de docType enum (generateNext, generateDocument)").toBe(2);
    for (const m of routerMatches) {
      const types = m[1].split(",").map(s => s.trim().replace(/["']/g, "")).filter(Boolean);
      expect(types.sort()).toEqual([...LEGACY_DOC_TYPES_BASELINE].sort());
    }
    expect(typesSrc).toContain(`export const DOC_ORDER: DocType[] = [${LEGACY_DOC_TYPES_BASELINE.map(t => `"${t}"`).join(", ")}];`);
  });

  // ── 6. nova rota apontando para página de Processo Licitatório legada ───────
  it("apenas as rotas congeladas montam Dashboard/ProcessDetails/NewProcess (nenhuma rota nova)", () => {
    const appSrc = read("client/src/App.tsx");
    for (const route of Object.keys(LEGACY_PROCESS_ROUTES_BASELINE)) {
      expect(appSrc, `rota ${route} deveria continuar existindo em App.tsx`).toContain(route);
    }
    // Cada componente legado só pode ser referenciado (word-boundary, para não
    // colidir com nomes parecidos como ModuleSelectionDashboard/DashboardLayout)
    // em contextos de montagem de rota: component={X}, withAuthenticatedShell(X),
    // ou como wrapper const que alimenta uma dessas duas formas.
    for (const component of Object.values(LEGACY_PROCESS_ROUTES_BASELINE)) {
      const wordBoundary = new RegExp(`\\b${component}\\b`); // sem flag "g": .test() reutilizado por linha
      const mountLines = appSrc.split("\n").filter(l =>
        wordBoundary.test(l) && (l.includes("component={") || l.includes("withAuthenticatedShell(") || l.includes("component:"))
      );
      expect(mountLines.length, `${component} deveria ser montado por no máximo 1 caminho de rota (via wrapper ou direto), achou ${mountLines.length}: ${mountLines.join(" | ")}`).toBeLessThanOrEqual(1);
    }
  });

  // ── 7. service canônico não importa service/entry-point legado ──────────────
  it("nenhum componente de CANONICAL_NOT_YET_WIRED importa um path de LEGACY_ACTIVE_MAINTENANCE_ONLY", () => {
    const offenders: string[] = [];
    for (const canonicalPath of CANONICAL_NOT_YET_WIRED) {
      if (!fs.existsSync(canonicalPath)) continue;
      const src = read(canonicalPath);
      for (const legacyPath of LEGACY_ACTIVE_MAINTENANCE_ONLY) {
        const legacyModuleGuess = normalizeBoundaryPath(legacyPath).replace(/\.tsx?$/, "");
        const base = legacyModuleGuess.split("/").pop()!;
        if (src.includes(`/${base}"`) || src.includes(`/${base}'`)) {
          offenders.push(`${canonicalPath} → ${legacyPath}`);
        }
      }
    }
    expect(offenders, `canônico importando legado: ${offenders.join(", ")}`).toEqual([]);
  });

  // ── 8. Business Domain declarando rota legada como canônica ─────────────────
  it("só 'processo_licitatorio' é a exceção conhecida (path canônico == rota legada); nenhum outro domínio pode repetir isso", async () => {
    const src = read("client/src/config/businessDomains.ts");
    // Todo domínio, exceto o já registrado processo_licitatorio, deve ter legacyPath.
    const blockRegex = /\{\s*id:\s*"([^"]+)"[\s\S]*?\n\s*\},/g;
    const blocks = [...src.matchAll(blockRegex)];
    expect(blocks.length).toBeGreaterThan(0);
    const semLegacyPath: string[] = [];
    for (const b of blocks) {
      const id = b[1];
      const body = b[0];
      if (id === "processo_licitatorio") continue; // exceção já registrada e documentada
      if (!/legacyPath:/.test(body)) semLegacyPath.push(id);
    }
    expect(semLegacyPath, `domínio(s) sem legacyPath além da exceção conhecida: ${semLegacyPath.join(", ")}`).toEqual([]);
  });

  // ── 9. inventário deixa de classificar Licitação ────────────────────────────
  it("LEGACY_INVENTORY.md continua classificando Licitação / Processo Licitatório / Geração Documental", () => {
    const inv = read("docs/architecture/LEGACY_INVENTORY.md");
    expect(inv).toContain("## Licitação / Processo Licitatório / Geração Documental");
    expect(inv).toContain("LEGACY_ACTIVE_MAINTENANCE_ONLY");
    expect(inv).toContain("CANONICAL_NOT_YET_WIRED");
  });

  // ── 10. o conjunto atual de consumidores legados não cresce (guarda numérica) ─
  it("contagem total de consumidores legados (documents + processes) não excede o baseline", () => {
    const docsCount = CLIENT_SRC.filter(f => read(f).includes("trpc.documents.")).length;
    const procCount = CLIENT_SRC.filter(f => read(f).includes("trpc.processes.")).length;
    expect(docsCount, "redução é permitida, mas não deveria exceder o baseline").toBeLessThanOrEqual(DOCUMENTS_CONSUMERS_BASELINE.length);
    expect(procCount, "redução é permitida, mas não deveria exceder o baseline").toBeLessThanOrEqual(PROCESSES_CONSUMERS_BASELINE.length);
  });
});
